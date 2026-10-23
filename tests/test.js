'use strict';
// Tests the extension on simulated pages with jsdom. Run with: npm test
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let failures = 0;
function check(condition, label) {
  console.log((condition ? '  ok   ' : '  FAIL ') + label);
  if (!condition) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal browser.i18n backed by the real _locales files.
function fakeI18n(locale) {
  const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
  return {
    getMessage(key, subs = []) {
      if (key === '@@ui_locale') return locale;
      const m = messages[key];
      if (!m) return '';
      return m.message.replace(/\$P(\d)\$/g, (_, n) => (subs[Number(n) - 1] !== undefined ? subs[Number(n) - 1] : ''));
    }
  };
}

function fakeBrowser(initial = {}, locale = 'en') {
  const data = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  const messages = [];
  const tabs = [];
  const fire = (changes) => setTimeout(() => listeners.forEach((f) => f(changes, 'local')), 0);
  return {
    _data: data, _messages: messages, _tabs: tabs,
    i18n: fakeI18n(locale),
    storage: {
      local: {
        async get(keys) {
          const ks = Array.isArray(keys) ? keys : [keys];
          const r = {};
          for (const k of ks) if (k in data) r[k] = JSON.parse(JSON.stringify(data[k]));
          return r;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) { changes[k] = { newValue: v }; data[k] = JSON.parse(JSON.stringify(v)); }
          fire(changes);
        },
        async remove(keys) {
          const changes = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) { delete data[k]; changes[k] = {}; }
          fire(changes);
        }
      },
      onChanged: { addListener: (f) => listeners.push(f) }
    },
    runtime: { sendMessage: (m) => messages.push(m) },
    tabs: { create: async (o) => tabs.push(o) }
  };
}

// Simulates the YouTube responses used to read each channel's category.
// channels: { '@handle': { id, cats: [...], tags: [...] } }
function fakeYoutube(channels) {
  const requests = [];
  const byId = {};
  for (const [h, c] of Object.entries(channels)) byId[c.id] = { ...c, h };
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const fetch = async (url, options = {}) => {
    requests.push(url);
    const u = new URL(url, 'https://www.youtube.com');
    const body = options.body ? JSON.parse(options.body) : {};
    if (u.pathname === '/youtubei/v1/navigation/resolve_url') {
      const p = decodeURI(new URL(body.url).pathname).slice(1);
      if (p === 'canaltech-legacy') return response({ endpoint: { browseEndpoint: { browseId: channels['@canaltech'].id } } });
      if (p === '@canaltech') return response({ endpoint: { urlEndpoint: { url: 'https://www.youtube.com/canaltech-legacy' } } });
      const c = channels[p];
      return response(c ? { endpoint: { browseEndpoint: { browseId: c.id } } } : {});
    }
    if (u.pathname === '/feeds/videos.xml') {
      const c = byId[u.searchParams.get('channel_id')];
      if (!c) return response('', 404);
      const ids = c.cats.map((_, i) => (c.id.slice(2, 12) + i).padEnd(11, 'x'));
      return response('<feed>' + ids.map((v) => `<entry><yt:videoId>${v}</yt:videoId></entry>`).join('') + '</feed>');
    }
    if (u.pathname === '/youtubei/v1/player') {
      const v = body.videoId;
      const c = Object.values(byId).find((x) => v.startsWith(x.id.slice(2, 12)));
      const i = Number(v[10]);
      return response({ microformat: { playerMicroformatRenderer: { category: c.cats[i] } }, videoDetails: { keywords: c.tags || [] } });
    }
    return response('', 404);
  };
  return { fetch, requests };
}

function loadInto(dom, browser, files, fakeFetch) {
  const w = dom.window;
  if (fakeFetch) w.fetch = fakeFetch;
  w.browser = browser;
  w.scrollTo = () => {};
  w.CSS = w.CSS || { escape: (s) => s };
  for (const f of files) w.eval(read(f));
}

const SHARED = ['catalog.js', 'shared.js'];
const blankPage = () => new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
const optionsPage = () => new JSDOM(read('options.html').replace(/<script[^>]*><\/script>/g, ''),
  { url: 'safari-web-extension://x/options.html', runScripts: 'outside-only' });

// ---------------------------------------------------------------------------
async function testClassifier() {
  console.log('\nClassifier');
  const dom = blankPage();
  loadInto(dom, fakeBrowser(), SHARED);
  const Y = dom.window.YTCat;
  const compiled = Y.compileThemes(Y.defaultThemes());
  const cases = [
    [{ name: 'Canaltech', handle: '@canaltech', description: 'Notícias de tecnologia, reviews de celulares' }, ['technology']],
    [{ name: 'Coisa de Nerd', handle: '@coisadenerd', description: 'Games, tecnologia e reviews de gadgets' }, ['technology']],
    [{ name: 'Framed', handle: '@framedrs', description: 'Old School RuneScape content: ironman, PvM and more' }, ['runescape']],
    [{ name: 'Me Poupe!', handle: '@mepoupe', description: 'Educação financeira para você investir melhor' }, ['investing']],
    [{ name: 'The Plain Bagel', handle: '@theplainbagel', description: 'Personal finance and investing explained' }, ['investing']],
    [{ name: 'Meteoro Brasil', handle: '@meteorobrasil', description: 'Análise política e cultural' }, ['politics']],
    [{ name: 'Receitas da Vó', handle: '@receitasdavo', description: 'Bolo, pão e muito amor' }, []],
    [{ name: 'OSRS Wiki', handle: '@osrswiki', description: '' }, ['runescape']]
  ];
  for (const [channel, expected] of cases) {
    const r = Y.classifyChannel(channel, compiled);
    check(JSON.stringify(r.sort()) === JSON.stringify(expected.sort()), `${channel.name} -> [${r}] (expected [${expected}])`);
  }
  check(JSON.stringify(Y.channelFromHref('/@Fulano%C3%A7/videos')) === JSON.stringify({ handle: '@fulanoç' }), 'accented handle is decoded');
  check(Y.channelFromHref('/channel/UCabcdefghijklmnopqrstuv').id === 'UCabcdefghijklmnopqrstuv', '/channel/UC… link');
  check(Y.channelFromHref('/watch?v=123') === null, 'video link is ignored');

  const csv = 'Channel Id,Channel Url,Channel Title\nUCaaaaaaaaaaaaaaaaaaaaaa,http://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa,"Channel, with comma"\nUCbbbbbbbbbbbbbbbbbbbbbb,http://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb,OSRS Daily\n';
  const parsed = Y.parseTakeoutCsv(csv);
  check(parsed.length === 2 && parsed[0].name === 'Channel, with comma', 'Takeout CSV with quotes');

  // Merging keeps manual adjustments and matches by id/handle.
  const channels = {};
  Y.mergeImport(channels, parsed, Y.defaultThemes());
  const key = Object.keys(channels).find((k) => channels[k].name === 'OSRS Daily');
  check(channels[key].themes.includes('runescape'), 'CSV channel classified by its name');
  channels[key].themes = ['politics']; channels[key].manual = true;
  const r = Y.mergeImport(channels, [{ id: 'UCbbbbbbbbbbbbbbbbbbbbbb', handle: '@osrsdaily', name: 'OSRS Daily', description: 'runescape' }], Y.defaultThemes());
  check(r.added === 0 && Object.keys(channels).length === 2, 're-import does not duplicate (matched by id)');
  check(channels['h:@osrsdaily'] && channels['h:@osrsdaily'].themes[0] === 'politics', 'manual adjustment kept and key updated to the handle');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testSuggestions() {
  console.log('\nYouTube categories and suggestions');
  const dom = blankPage();
  loadInto(dom, fakeBrowser(), SHARED);
  const Y = dom.window.YTCat;
  const channel = (name, cats, extra = {}) => ({ name, handle: '@' + Y.slug(name), description: '', themes: [], yt: { categories: cats, tags: [], fetchedAt: 1 }, ...extra });
  const channels = {
    a: channel('Coldplay', ['Music', 'Music', 'Music']),
    b: channel('Anitta', ['Music', 'Music']),
    c: channel('Tim Maia Oficial', ['Music']),
    d: channel('Gaules', ['Gaming', 'Gaming']),
    e: channel('Alanzoka', ['Gaming']),
    f: channel('Casimiro', ['Entertainment', 'Entertainment']),
    g: channel('Random Channel', ['People & Blogs']),
    h: channel('Ana Podcast', [], { description: 'weekly show about parenting' }),
    i: channel('Bia e Lu', [], { description: 'real parenting' }),
    j: channel('Real Moms', [], { description: 'parenting and family' })
  };
  const defaults = Y.defaultThemes();
  check(Y.classifyChannel(channels.a, Y.compileThemes(defaults)).length === 0, 'without a music theme, Coldplay is uncategorized');
  const suggestions = Y.suggestThemes(channels, defaults, []);
  const byId = Object.fromEntries(suggestions.map((s) => [s.id, s]));
  check(byId.music && byId.music.total === 3, `suggests Music with 3 channels (${byId.music && byId.music.examples.join(', ')})`);
  check(byId.music && byId.music.name === 'Music', 'suggestion name comes from the locale');
  check(byId.gaming && byId.gaming.total === 2, 'suggests Gaming with 2 channels');
  check(suggestions[0].id === 'music', 'suggestions sorted by size');
  check(!byId.entertainment, 'broad category with 1 channel is not suggested');
  check(!Y.suggestThemes(channels, defaults, ['music']).some((s) => s.id === 'music'), 'dismissed suggestion does not come back');
  const withMusic = [...defaults, Y.catalogTheme('music')];
  check(Y.classifyChannel(channels.a, Y.compileThemes(withMusic)).join() === 'music', 'once Music exists, Coldplay joins it');
  const withEnt = [...defaults, Y.catalogTheme('entertainment'), Y.catalogTheme('music')];
  check(Y.classifyChannel(channels.f, Y.compileThemes(withEnt)).join() === 'entertainment', 'broad category counts when nothing else fits');
  check(Y.canonicalYoutubeCategory('Ciência e tecnologia') === 'Science & Technology', 'Portuguese category name is recognized');
  const words = Y.frequentWords(channels, defaults);
  check(words[0] && words[0].word === 'parenting' && words[0].total === 3, 'frequent word among uncategorized channels: ' + JSON.stringify(words.slice(0, 3)));
  check(!words.some((w) => w.word === 'about'), 'stop words are left out');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testMigration() {
  console.log('\nMigration from version 0.4 (Portuguese storage)');
  const dom = blankPage();
  const browser = fakeBrowser({
    categorias: [
      { id: 'tecnologia', nome: 'Tecnologia', palavras: ['tech'] },
      { id: 'musica', nome: 'Música', palavras: ['banda'], youtube: ['Music'] },
      { id: 'culinaria-2', nome: 'Receitas', palavras: ['bolo'] }
    ],
    canais: {
      'h:@coldplay': { handle: '@coldplay', nome: 'Coldplay', descricao: 'band', categorias: ['musica'], manual: true,
        yt: { id: 'UCx', categorias: ['Music'], tags: ['rock'], quando: 123 } }
    },
    config: { ocultarShorts: false, mostrarSemCategoria: true, sugestoesIgnoradas: ['games'] },
    filtrosAtivos: ['musica', '__sem__'],
    ultimaImportacao: { quando: 5, lidos: 1, novos: 1, origem: 'youtube' }
  });
  loadInto(dom, browser, SHARED);
  const s = await dom.window.YTCat.loadState();
  check(s.themes.map((x) => x.id).join() === 'technology,music,culinaria-2', 'theme ids moved to English, custom ids kept');
  check(s.themes[1].name === 'Música' && s.themes[1].keywords[0] === 'banda', 'user-chosen names and keywords kept');
  const c = s.channels['h:@coldplay'];
  check(c.name === 'Coldplay' && c.themes.join() === 'music' && c.manual === true, 'channel fields migrated');
  check(c.yt.categories.join() === 'Music' && c.yt.fetchedAt === 123, 'YouTube data migrated');
  check(s.settings.hideShorts === false && s.settings.dismissedSuggestions.join() === 'gaming', 'settings migrated');
  check(s.activeFilters.join() === 'music,__none__', 'pill selection migrated');
  check(s.lastImport.read === 1, 'last import migrated');
  check(!('canais' in browser._data) && !('categorias' in browser._data), 'old keys removed');
  dom.window.close();
}

// ---------------------------------------------------------------------------
function legacyCard(handle, name, title) {
  return `<ytd-rich-item-renderer><div id="content"><ytd-rich-grid-media>
    <a id="thumbnail" href="/watch?v=${title}"></a>
    <a id="avatar-link" href="/${handle}"></a>
    <ytd-channel-name><div id="text-container"><yt-formatted-string id="text"><a href="/${handle}">${name}</a></yt-formatted-string></div></ytd-channel-name>
  </ytd-rich-grid-media></div></ytd-rich-item-renderer>`;
}
function lockupCard(href, name, title, withLink = true) {
  return `<ytd-rich-item-renderer><div id="content"><yt-lockup-view-model>
    <a href="/watch?v=${title}"></a>
    <yt-lockup-metadata-view-model><h3><a href="/watch?v=${title}">${title}</a></h3>
    <yt-content-metadata-view-model><div class="yt-content-metadata-view-model__metadata-row">
      ${withLink ? `<a href="${href}">${name}</a>` : `<span>${name}</span>`}
    </div><div class="yt-content-metadata-view-model__metadata-row"><span>10K views</span></div></yt-content-metadata-view-model>
    </yt-lockup-metadata-view-model></yt-lockup-view-model></div></ytd-rich-item-renderer>`;
}

const feedChannels = {
  'h:@canaltech': { handle: '@canaltech', name: 'Canaltech', themes: ['technology'] },
  'h:@framedrs': { handle: '@framedrs', name: 'Framed', themes: ['runescape'] },
  'c:UCcccccccccccccccccccccc': { id: 'UCcccccccccccccccccccccc', name: 'Me Poupe!', themes: ['investing'] },
  'h:@meteorobrasil': { handle: '@meteorobrasil', name: 'Meteoro Brasil', themes: ['politics', 'technology'] }
};

async function testFeed() {
  console.log('\nSubscriptions feed');
  const html = `<!doctype html><body><ytd-app>
    <ytd-browse page-subtype="home" hidden></ytd-browse>
    <ytd-browse page-subtype="subscriptions"><ytd-two-column-browse-results-renderer><div id="primary">
      <ytd-rich-grid-renderer><div id="header"><h2>Latest</h2></div><div id="contents">
        ${legacyCard('@canaltech', 'Canaltech', 'v1')}
        ${lockupCard('/@framedrs', 'Framed', 'v2')}
        ${lockupCard('/channel/UCcccccccccccccccccccccc', 'Me Poupe!', 'v3')}
        ${lockupCard('', 'Meteoro Brasil', 'v4', false)}
        ${lockupCard('/@unknown', 'New Channel', 'v5')}
        <ytd-rich-item-renderer><ytd-ad-slot-renderer></ytd-ad-slot-renderer></ytd-rich-item-renderer>
        <ytd-rich-section-renderer><ytd-rich-shelf-renderer is-shorts>
          <ytd-rich-item-renderer><a href="/shorts/abc"></a></ytd-rich-item-renderer>
        </ytd-rich-shelf-renderer></ytd-rich-section-renderer>
        ${legacyCard('@canaltech', 'Canaltech', 'v6')}
        <ytd-continuation-item-renderer></ytd-continuation-item-renderer>
      </div></ytd-rich-grid-renderer>
    </div></ytd-two-column-browse-results-renderer></ytd-browse>
  </ytd-app></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/subscriptions', runScripts: 'outside-only' });
  const browser = fakeBrowser({ themes: [], channels: feedChannels });
  // Themes from the catalog so the pills exist.
  loadInto(dom, browser, SHARED);
  browser._data.themes = dom.window.YTCat.defaultThemes();
  dom.window.eval(read('content.js'));
  await sleep(400);
  const d = dom.window.document;
  const bar = d.getElementById('ytcat-bar');
  check(!!bar, 'bar inserted');
  check(bar && bar.parentElement.tagName === 'YTD-RICH-GRID-RENDERER' &&
    bar.previousElementSibling.id === 'header' && bar.nextElementSibling.id === 'contents',
    'bar sits between the "Latest" header and the videos');
  check(!!bar.querySelector('.ytcat-settings svg'), 'settings button uses an SVG icon');
  check(bar.querySelector('[data-filter="all"]').textContent.startsWith('All'), 'pill labels follow the locale (English)');
  const count = (id) => {
    const b = bar.querySelector(`[data-filter="${id}"] .ytcat-count`);
    return b ? Number(b.textContent) : NaN;
  };
  check(count('all') === 7, `"All" count = ${count('all')} (6 videos + 1 ad)`);
  check(count('technology') === 3, `Technology count = ${count('technology')} (2 Canaltech + Meteoro)`);
  check(count('politics') === 1, 'Meteoro identified by name only');
  check(count('__none__') === 1, `Uncategorized = ${count('__none__')} (new channel)`);

  const hidden = () => [...d.querySelectorAll('[data-ytcat-hidden]')];
  check(hidden().length === 0, 'nothing hidden under "All"');

  bar.querySelector('[data-filter="runescape"]').click();
  await sleep(50);
  const shown = [...d.querySelectorAll('#contents > ytd-rich-item-renderer:not([data-ytcat-hidden])')];
  check(shown.length === 1 && shown[0].textContent.includes('Framed'), 'RuneScape filter shows only Framed');
  check(d.querySelector('ytd-rich-section-renderer').hasAttribute('data-ytcat-hidden'), 'Shorts shelf hidden with a filter on');
  await sleep(300);
  check(JSON.stringify(browser._data.activeFilters) === '["runescape"]', 'selected filter is saved');

  // Videos arriving through infinite scroll are filtered too.
  const extra = d.createElement('div');
  extra.innerHTML = legacyCard('@canaltech', 'Canaltech', 'v7');
  d.querySelector('#contents').append(extra.firstElementChild);
  await sleep(400);
  check(d.querySelector('#contents > ytd-rich-item-renderer:last-of-type').hasAttribute('data-ytcat-hidden'), 'later-loaded video is filtered too');

  // Multiple selection.
  const click = async (id) => {
    d.getElementById('ytcat-bar').querySelector(`[data-filter="${id}"]`).click();
    await sleep(50);
  };
  const active = (id) => d.getElementById('ytcat-bar').querySelector(`[data-filter="${id}"]`).classList.contains('ytcat-active');
  const visibleNames = () => [...d.querySelectorAll('#contents > ytd-rich-item-renderer:not([data-ytcat-hidden])')]
    .map((c) => c.textContent.replace(/\s+/g, ' ').trim());
  const shows = (name) => visibleNames().some((text) => text.includes(name));

  await click('technology');
  check(active('runescape') && active('technology') && !active('all'), 'a second theme adds to the selection');
  check(shows('Framed') && shows('Canaltech') && shows('Meteoro') && !shows('Me Poupe'), 'shows videos from any selected theme');
  await sleep(300);
  check(JSON.stringify(browser._data.activeFilters) === '["runescape","technology"]', 'multiple selection is saved');

  await click('runescape');
  check(!active('runescape') && active('technology'), 'unselecting one of two keeps the other');
  check(!shows('Framed') && shows('Canaltech'), 'feed now shows only the remaining one');

  await click('technology');
  check(hidden().length === 0 && active('all'), 'unselecting the only one goes back to "All"');
  await sleep(300);
  check(JSON.stringify(browser._data.activeFilters) === '[]', 'going back to "All" is saved');

  await click('all');
  check(hidden().length === 0 && active('all'), 'clicking "All" while on "All" changes nothing');

  await click('politics');
  await click('__none__');
  check(shows('Meteoro') && shows('New Channel') && !shows('Framed'), 'theme + "Uncategorized" together');
  await click('all');
  check(hidden().length === 0 && !active('politics') && !active('__none__'), '"All" clears the selection');

  d.getElementById('ytcat-bar').querySelector('[data-action="settings"]').click();
  check(browser._messages.some((m) => m.type === 'openSettings'), 'settings button asks to open the settings');

  // YouTube rebuilds the grid: the bar has to come back.
  d.getElementById('ytcat-bar').remove();
  d.querySelector('#primary').append(d.createElement('span'));
  await sleep(400);
  check(!!d.getElementById('ytcat-bar'), 'bar is put back if YouTube removes it');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testHeaderPosition() {
  console.log('\nBar position with the header inside the grid');
  // As seen on YouTube: "Latest" + "All subscriptions" come in a section
  // inside #contents, and arrive after the first videos.
  const html = `<!doctype html><body><ytd-browse page-subtype="subscriptions"><div id="primary">
    <ytd-rich-grid-renderer><div id="contents">
      ${legacyCard('@canaltech', 'Canaltech', 'v1')}
      ${legacyCard('@framedrs', 'Framed', 'v2')}
    </div></ytd-rich-grid-renderer></div></ytd-browse></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/subscriptions', runScripts: 'outside-only' });
  const browser = fakeBrowser({ channels: feedChannels });
  loadInto(dom, browser, [...SHARED, 'content.js']);
  await sleep(400);
  const d = dom.window.document;
  check(!!d.getElementById('ytcat-bar'), 'bar shows up before the header exists');

  const section = d.createElement('ytd-rich-section-renderer');
  const title = d.createElement('h2');
  title.textContent = 'Latest';
  const link = d.createElement('a');
  link.setAttribute('href', '/feed/channels');
  link.textContent = 'All subscriptions';
  section.append(title, link);
  d.querySelector('#contents').prepend(section);
  await sleep(400);
  const bar = d.getElementById('ytcat-bar');
  check(bar.previousElementSibling === section, 'bar moves right after "Latest"');
  check(bar.nextElementSibling && bar.nextElementSibling.tagName === 'YTD-RICH-ITEM-RENDERER', 'and stays before the videos');

  bar.querySelector('[data-filter="runescape"]').click();
  await sleep(300);
  check(!section.hasAttribute('data-ytcat-hidden'), 'header stays visible with a filter on');
  check(d.getElementById('ytcat-bar').previousElementSibling === section, 'bar stays in place after filtering');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testImport() {
  console.log('\nImport on /feed/channels');
  const channelCard = (href, name, sub, desc) => `<ytd-channel-renderer>
    <div id="avatar-section"><a href="${href}"><img src="https://yt3.ggpht.com/${name}.jpg"></a></div>
    <div id="info-section"><a id="main-link" href="${href}">
      <div id="channel-title"><ytd-channel-name><yt-formatted-string id="text">${name}</yt-formatted-string></ytd-channel-name></div>
      <div id="metadata"><span id="subscribers">${sub}</span><span id="video-count">1.2M subscribers</span></div>
      <yt-formatted-string id="description">${desc}</yt-formatted-string>
    </a></div></ytd-channel-renderer>`;
  const html = `<!doctype html><body><ytd-browse page-subtype="channels"><div id="contents">
    ${channelCard('/@canaltech', 'Canaltech', '@canaltech', 'Notícias de tecnologia')}
    ${channelCard('/@framedrs', 'Framed', '@framedrs', 'Old School RuneScape videos')}
    ${channelCard('/@primorico', 'Primo Rico', '@primorico', 'Investimentos e finanças')}
    ${channelCard('/@meteorobrasil', 'Meteoro Brasil', '@meteorobrasil', 'Política, cultura e sociedade')}
    ${channelCard('/@recipes', 'Grandma Recipes', '@recipes', 'Cakes and bread')}
    ${channelCard('/@coldplay', 'Coldplay', '@coldplay', '')}
    ${channelCard('/@anitta', 'Anitta', '@anitta', 'Official site')}
  </div></ytd-browse></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/channels', runScripts: 'outside-only' });
  const browser = fakeBrowser({ pendingImport: Date.now() });
  const yt = fakeYoutube({
    '@canaltech': { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', cats: ['Science & Technology', 'Science & Technology', 'News & Politics'], tags: ['tecnologia'] },
    '@framedrs': { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', cats: ['Gaming', 'Gaming', 'Gaming'], tags: ['osrs'] },
    '@primorico': { id: 'UCcccccccccccccccccccccc', cats: ['Education', 'Education', 'Education'], tags: [] },
    '@meteorobrasil': { id: 'UCdddddddddddddddddddddd', cats: ['News & Politics', 'News & Politics', 'Entertainment'], tags: [] },
    '@recipes': { id: 'UCeeeeeeeeeeeeeeeeeeeeee', cats: ['Howto & Style'], tags: ['recipe', 'cake'] },
    '@coldplay': { id: 'UCffffffffffffffffffffff', cats: ['Music', 'Music', 'Music'], tags: [] },
    '@anitta': { id: 'UCgggggggggggggggggggggg', cats: ['Music', 'Music'], tags: ['funk'] }
  });
  loadInto(dom, browser, [...SHARED, 'content.js'], yt.fetch);
  await sleep(4500);
  const channels = browser._data.channels || {};
  const names = Object.values(channels).map((c) => c.name).sort();
  check(names.length === 7, `7 channels imported (${names.join(', ')})`);
  check(channels['h:@framedrs'] && channels['h:@framedrs'].themes.includes('runescape'), 'Framed classified as RuneScape');
  check(channels['h:@primorico'] && channels['h:@primorico'].themes.includes('investing'), 'Primo Rico classified as Investing');
  check(channels['h:@recipes'] && channels['h:@recipes'].themes.length === 0, 'channel outside the themes stays uncategorized');
  check(channels['h:@canaltech'] && channels['h:@canaltech'].avatar.includes('yt3.ggpht.com'), 'avatar saved');
  check(!('pendingImport' in browser._data), 'import request cleared');
  const status = dom.window.document.querySelector('.ytcat-imp-status');
  check(status && /Done: 7 channels/.test(status.textContent), 'panel shows the result: ' + (status && status.textContent));
  check(channels['h:@coldplay'].yt && channels['h:@coldplay'].yt.categories.join() === 'Music,Music,Music', 'YouTube category read from the 3 recent videos');
  check(channels['h:@canaltech'].yt.id === 'UCaaaaaaaaaaaaaaaaaaaaaa', 'redirect from @handle to the legacy URL is followed');
  check(channels['h:@meteorobrasil'].themes.includes('politics'), 'Meteoro joins Politics through the YouTube category');
  check(channels['h:@anitta'].yt.tags.includes('funk'), 'video tags saved');
  check(/YouTube category read for 7 of 7/.test(status.textContent), 'panel reports how many channels had their category read');
  check(/new themes to suggest/.test(status.textContent), 'panel says there are suggestions');
  const total = yt.requests.length;
  check(total > 0 && yt.requests.every((u) => u.startsWith('https://www.youtube.com/')), `${total} requests, all to www.youtube.com`);
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testSettingsPage() {
  console.log('\nSettings page');
  const dom = optionsPage();
  const browser = fakeBrowser({
    channels: {
      'h:@canaltech': { handle: '@canaltech', name: 'Canaltech', description: 'tecnologia', themes: ['technology'], manual: false },
      'h:@recipes': { handle: '@recipes', name: 'Grandma Recipes', description: '', themes: [], manual: false }
    },
    lastImport: { at: Date.now(), read: 2, added: 2, source: 'youtube' }
  });
  dom.window.confirm = () => true;
  dom.window.prompt = () => 'Baking';
  loadInto(dom, browser, [...SHARED, 'options.js']);
  await sleep(200);
  const d = dom.window.document;
  check(d.querySelector('h1').textContent === 'Subscriptions Filter', 'static texts filled from the locale');
  check(d.getElementById('search').placeholder === 'Search channels…', 'placeholders translated');
  check(d.querySelectorAll('.theme').length === 4, '4 default themes drawn');
  check(Array.isArray(browser._data.themes), 'default themes saved on first open');
  check(d.querySelectorAll('.channel').length === 2, '2 channels in the review');
  check(/2 channels saved · 1 uncategorized/.test(d.getElementById('channels-status').textContent), 'status: ' + d.getElementById('channels-status').textContent);
  check(d.getElementById('welcome').hidden, 'welcome hidden when there are channels');

  // Manual adjustment.
  d.querySelector('.channel[data-key="h:@recipes"] [data-theme="investing"]').click();
  await sleep(100);
  check(browser._data.channels['h:@recipes'].manual === true &&
    browser._data.channels['h:@recipes'].themes.join() === 'investing', 'clicking a theme adjusts the channel and marks it manual');
  check(!!d.querySelector('.channel[data-key="h:@recipes"] .manual-mark'), '"manual" mark shows up');

  // New theme + keywords + reclassification that respects manual channels.
  d.getElementById('btn-new-theme').click();
  await sleep(100);
  const field = d.querySelector('.theme[data-id="baking"] textarea');
  check(!!field, 'new theme created');
  field.value = 'recipe*, baking, cake*';
  field.dispatchEvent(new dom.window.Event('input'));
  d.getElementById('btn-classify').click();
  await sleep(600);
  check(browser._data.themes.some((c) => c.id === 'baking' && c.keywords.includes('recipe*')), 'keywords saved');
  check(browser._data.channels['h:@recipes'].themes.join() === 'investing', 'automatic classification respects the manual adjustment');

  // Back to automatic.
  d.querySelector('.channel[data-key="h:@recipes"] [data-action="auto"]').click();
  await sleep(100);
  check(browser._data.channels['h:@recipes'].themes.join() === 'baking' && !browser._data.channels['h:@recipes'].manual, '↺ goes back to automatic (now Baking)');

  // Review filter.
  const select = d.getElementById('list-filter');
  select.value = 'technology';
  select.dispatchEvent(new dom.window.Event('change'));
  check(d.querySelectorAll('.channel').length === 1, 'review filter by theme');

  // Import from YouTube flags the request and opens the tab.
  d.getElementById('btn-import-youtube').click();
  await sleep(50);
  check(browser._tabs[0] && browser._tabs[0].url === 'https://www.youtube.com/feed/channels' && browser._data.pendingImport, 'import button opens /feed/channels');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testPortugueseLocale() {
  console.log('\nPortuguese locale');
  const dom = optionsPage();
  const browser = fakeBrowser({}, 'pt_BR');
  loadInto(dom, browser, [...SHARED, 'options.js']);
  await sleep(200);
  const d = dom.window.document;
  check(d.querySelector('h1').textContent === 'Filtro de Inscrições', 'page title in Portuguese');
  check(d.documentElement.lang === 'pt-BR', 'page language set to pt-BR');
  const names = [...d.querySelectorAll('.theme input[type="text"]')].map((i) => i.value).join(', ');
  check(names === 'Tecnologia, RuneScape, Investimentos, Política', 'default theme names in Portuguese: ' + names);
  check(/Nenhum canal importado/.test(d.getElementById('channels-status').textContent), 'dynamic texts in Portuguese');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testPermission() {
  console.log('\nRequesting access to YouTube');
  const dom = optionsPage();
  const browser = fakeBrowser();
  let granted = false;
  const requests = [];
  browser.permissions = {
    contains: async () => granted,
    request: (p) => { requests.push(p); granted = true; return Promise.resolve(true); },
    onAdded: { addListener: () => {} },
    onRemoved: { addListener: () => {} }
  };
  loadInto(dom, browser, [...SHARED, 'options.js']);
  await sleep(200);
  const d = dom.window.document;
  check(!d.getElementById('permission').hidden, 'access notice shows when permission is missing');

  d.getElementById('btn-import-youtube').click();
  check(requests.length === 1, 'import asks for access in the click itself (before any waiting)');
  check(JSON.stringify(requests[0]) === JSON.stringify({ origins: ['*://www.youtube.com/*'] }), 'request is only for www.youtube.com');
  await sleep(100);
  check(d.getElementById('permission').hidden, 'notice goes away once access is granted');
  check(browser._tabs.length === 1, 'import continues after the request');

  // Denied: shows the manual path.
  granted = false;
  browser.permissions.request = () => Promise.resolve(false);
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await sleep(50);
  check(!d.getElementById('permission').hidden, 'notice comes back if access is removed');
  d.getElementById('btn-permission').click();
  await sleep(50);
  check(!d.getElementById('permission-help').hidden, 'denial shows how to allow it in Safari settings');

  // Without the permissions API the notice stays hidden (state unknown).
  const dom2 = optionsPage();
  loadInto(dom2, fakeBrowser(), [...SHARED, 'options.js']);
  await sleep(150);
  check(dom2.window.document.getElementById('permission').hidden, 'without the permissions API the notice stays hidden');
  dom.window.close();
  dom2.window.close();
}

// ---------------------------------------------------------------------------
async function testSuggestionsOnPage() {
  console.log('\nSuggestions on the settings page');
  const dom = optionsPage();
  const yt = (cats) => ({ categories: cats, tags: [], fetchedAt: 1 });
  const browser = fakeBrowser({
    channels: {
      'h:@coldplay': { handle: '@coldplay', name: 'Coldplay', description: '', themes: [], manual: false, yt: yt(['Music', 'Music']) },
      'h:@anitta': { handle: '@anitta', name: 'Anitta', description: '', themes: [], manual: false, yt: yt(['Music']) },
      'h:@timmaia': { handle: '@timmaia', name: 'Tim Maia', description: '', themes: [], manual: false, yt: yt(['Music']) },
      'h:@gaules': { handle: '@gaules', name: 'Gaules', description: '', themes: [], manual: false, yt: yt(['Gaming']) },
      'h:@alan': { handle: '@alan', name: 'Alanzoka', description: '', themes: [], manual: false, yt: yt(['Gaming']) }
    }
  });
  dom.window.confirm = () => true;
  loadInto(dom, browser, [...SHARED, 'options.js']);
  await sleep(200);
  const d = dom.window.document;
  check(!d.getElementById('suggestions').hidden, 'suggestions block shows up');
  const box = (id) => d.querySelector(`#suggestion-list input[data-id="${id}"]`);
  check(box('music') && box('music').checked, 'Music comes checked (3 channels)');
  check(box('gaming') && !box('gaming').checked, 'Gaming comes unchecked (2 channels)');
  check(/Every channel has its YouTube category/.test(d.getElementById('channels-status').textContent), 'status reports the YouTube data');
  d.getElementById('btn-classify').click();
  await sleep(150);
  const data = browser._data;
  check(data.themes.some((c) => c.id === 'music') && !data.themes.some((c) => c.id === 'gaming'), 'classify creates only the checked suggestions');
  check(data.channels['h:@coldplay'].themes.join() === 'music', 'music channels join the new theme');
  check(/Created Music/.test(d.getElementById('msg-classify').textContent), 'message names the created theme');
  check(!box('music') && !!box('gaming'), 'Music leaves the suggestions; Gaming stays');
  d.querySelector('#suggestion-list .dismiss').click();
  await sleep(100);
  check((data.settings.dismissedSuggestions || []).includes('gaming') && !box('gaming'), 'Dismiss saves the choice and hides the suggestion');
  dom.window.close();
}

(async () => {
  await testClassifier();
  await testSuggestions();
  await testMigration();
  await testFeed();
  await testHeaderPosition();
  await testImport();
  await testSettingsPage();
  await testPortugueseLocale();
  await testPermission();
  await testSuggestionsOnPage();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll tests passed.');
  process.exit(failures ? 1 : 0);
})();
