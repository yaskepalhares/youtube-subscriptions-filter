(() => {
  'use strict';

  const Y = globalThis.YTCat;
  const { api, t } = Y;
  const $ = (id) => document.getElementById(id);

  const LIST_LIMIT = 400; // rows drawn at once in the channel review
  const FILTER_NONE = '__none__';
  const FILTER_MANUAL = '__manual__';
  const FILTER_ALL = 'all';

  let state = null;
  let themesSaveTimer = null; // debounce for saving theme edits

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'cls') e.className = v;
      else if (k.includes('-') || k === 'role') e.setAttribute(k, v);
      else e[k] = v;
    }
    for (const c of children || []) if (c) e.append(c);
    return e;
  }

  // Fills the static page texts in the system language.
  function translatePage() {
    document.documentElement.lang = t('@@ui_locale').replace('_', '-');
    for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
    for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
    for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }

  function message(id, text, isError) {
    const m = $(id);
    m.textContent = text;
    m.classList.toggle('error', !!isError);
    m.hidden = !text;
  }

  function formatDate(ms) {
    return new Date(ms).toLocaleString(undefined, {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function channelEntries() {
    return Object.entries(state.channels)
      .map(([key, channel]) => ({ key, channel }))
      .sort((a, b) => (a.channel.name || '').localeCompare(b.channel.name || ''));
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function saveChannels() {
    await Y.save({ channels: state.channels });
  }

  function saveThemesLater() {
    clearTimeout(themesSaveTimer);
    themesSaveTimer = setTimeout(async () => {
      themesSaveTimer = null;
      await Y.save({ themes: state.themes });
    }, 400);
  }

  // Removes themes that no longer exist from every channel.
  function dropOrphanThemes() {
    const valid = new Set(state.themes.map((c) => c.id));
    for (const channel of Object.values(state.channels)) {
      channel.themes = (channel.themes || []).filter((id) => valid.has(id));
    }
  }

  function uniqueThemeId(name) {
    let id = Y.slug(name);
    const used = new Set(state.themes.map((c) => c.id));
    for (let i = 2; used.has(id); i++) id = Y.slug(name) + '-' + i;
    return id;
  }

  const uncategorizedCount = () => Object.values(state.channels).filter((c) => !(c.themes || []).length).length;

  // ---------------------------------------------------------------------------
  // 1. Channels
  // ---------------------------------------------------------------------------

  function drawStatus() {
    const total = Object.keys(state.channels).length;
    const manual = Object.values(state.channels).filter((c) => c.manual).length;
    let text = total === 0
      ? t('statusNoChannels')
      : t('statusSummary', total, uncategorizedCount(), manual);
    const last = state.lastImport;
    if (last && last.at) {
      text += ' ' + (typeof last.read === 'number'
        ? t('statusLastImportCount', formatDate(last.at), last.read)
        : t('statusLastImport', formatDate(last.at)));
    }
    const withYoutube = Object.values(state.channels).filter((c) => c.yt && c.yt.fetchedAt).length;
    if (total > 0) {
      text += ' ' + (withYoutube < total ? t('statusYoutubePartial', withYoutube, total) : t('statusYoutubeComplete'));
    }
    $('channels-status').textContent = text;
    $('welcome').hidden = total > 0;
  }

  // ---------------------------------------------------------------------------
  // Access to YouTube
  // ---------------------------------------------------------------------------

  const ORIGINS = ['*://www.youtube.com/*'];
  // true/false when Safari tells us; null when the API is not available.
  let permissionGranted = null;

  async function checkPermission() {
    try {
      if (!api.permissions || !api.permissions.contains) return null;
      return !!(await api.permissions.contains({ origins: ORIGINS }));
    } catch (e) {
      return null;
    }
  }

  async function drawPermission() {
    permissionGranted = await checkPermission();
    $('permission').hidden = permissionGranted !== false;
  }

  // Must be called straight from the click (no await before it), otherwise
  // Safari does not show its permission prompt.
  function requestPermission() {
    let request;
    try {
      request = api.permissions.request({ origins: ORIGINS });
    } catch (e) {
      $('permission-help').hidden = false;
      return Promise.resolve(false);
    }
    return Promise.resolve(request)
      .then(async (ok) => {
        await drawPermission();
        if (!ok || permissionGranted === false) $('permission-help').hidden = false;
        return !!ok;
      })
      .catch(() => {
        $('permission-help').hidden = false;
        return false;
      });
  }

  function importFromYoutube() {
    // Asks for access in the same click, before any waiting.
    const request = permissionGranted === false ? requestPermission() : Promise.resolve(true);
    return request.then(openImport);
  }

  async function openImport() {
    await Y.save({ pendingImport: Date.now() });
    const url = 'https://www.youtube.com/feed/channels';
    try {
      await api.tabs.create({ url });
    } catch (e) {
      window.open(url, '_blank');
    }
    message('msg-import', t('msgImportOpened'));
  }

  async function importCsv(file) {
    try {
      const text = await readFile(file);
      const read = Y.parseTakeoutCsv(text);
      if (!read.length) {
        message('msg-import', t('msgCsvEmpty'), true);
        return;
      }
      const r = Y.mergeImport(state.channels, read, state.themes);
      state.lastImport = { at: Date.now(), read: read.length, added: r.added, source: 'takeout' };
      await Y.save({ channels: state.channels, lastImport: state.lastImport });
      message('msg-import', t('msgCsvImported', read.length, r.added));
      drawAll();
    } catch (e) {
      message('msg-import', t('msgFileError', e.message), true);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Themes
  // ---------------------------------------------------------------------------

  function countByTheme() {
    const n = {};
    for (const channel of Object.values(state.channels)) {
      for (const id of channel.themes || []) n[id] = (n[id] || 0) + 1;
    }
    return n;
  }

  function drawThemes() {
    const n = countByTheme();
    $('theme-list').replaceChildren(...state.themes.map((theme) => {
      const name = el('input', { type: 'text', value: theme.name, 'aria-label': t('themeNameLabel') });
      name.addEventListener('input', () => {
        theme.name = name.value.trim() || theme.name;
        saveThemesLater();
        drawListFilter();
        drawChannels();
      });

      const keywords = el('textarea', { value: (theme.keywords || []).join(', '), 'aria-label': t('themeKeywordsLabel') });
      keywords.spellcheck = false;
      keywords.addEventListener('input', () => {
        theme.keywords = keywords.value.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
        saveThemesLater();
      });

      const remove = el('button', { type: 'button', cls: 'remove', text: t('themeRemove') });
      remove.addEventListener('click', async () => {
        if (!confirm(t('confirmRemoveTheme', theme.name))) return;
        state.themes = state.themes.filter((c) => c !== theme);
        dropOrphanThemes();
        clearTimeout(themesSaveTimer);
        await Y.save({ themes: state.themes, channels: state.channels });
        drawAll();
      });

      const yt = Y.themeYoutubeCategories(theme);
      const ytText = [...yt.strong, ...yt.weak.map((c) => t('themeYoutubeWeak', c))].join(', ');
      return el('div', { cls: 'theme', 'data-id': theme.id }, [
        el('div', { cls: 'row' }, [name]),
        keywords,
        ytText ? el('div', { cls: 'yt-categories', text: t('themeYoutubeCategory', ytText) }) : null,
        el('div', { cls: 'footer' }, [
          el('span', { cls: 'count', text: t('themeChannelCount', n[theme.id] || 0) }),
          remove
        ])
      ]);
    }));
  }

  function updateThemeCounts() {
    const n = countByTheme();
    for (const card of document.querySelectorAll('.theme')) {
      const span = card.querySelector('.count');
      if (span) span.textContent = t('themeChannelCount', n[card.dataset.id] || 0);
    }
  }

  async function newTheme() {
    const name = (prompt(t('promptNewTheme')) || '').trim();
    if (!name) return;
    const id = uniqueThemeId(name);
    state.themes.push({ id, name, keywords: [Y.normalize(name)] });
    clearTimeout(themesSaveTimer);
    await Y.save({ themes: state.themes });
    drawAll();
    const field = document.querySelector(`.theme[data-id="${CSS.escape(id)}"] textarea`);
    if (field) field.focus();
  }

  async function restoreDefaults() {
    if (!confirm(t('confirmRestoreDefaults'))) return;
    state.themes = Y.defaultThemes();
    dropOrphanThemes();
    clearTimeout(themesSaveTimer);
    await Y.save({ themes: state.themes, channels: state.channels });
    drawAll();
  }

  async function classify() {
    const total = Object.keys(state.channels).length;
    if (!total) {
      message('msg-classify', t('msgImportFirst'), true);
      return;
    }
    const includeManual = $('chk-include-manual').checked;
    if (includeManual && !confirm(t('confirmIncludeManual'))) return;
    clearTimeout(themesSaveTimer);
    const created = currentSuggestions.filter((s) => checked.has(s.id));
    for (const s of created) {
      const theme = Y.catalogTheme(s.id);
      if (theme && !state.themes.some((c) => c.id === theme.id)) state.themes.push(theme);
    }
    const changed = Y.classifyAll(state.channels, state.themes, includeManual);
    await Y.save({ themes: state.themes, channels: state.channels });
    const parts = [];
    if (created.length) parts.push(t('msgCreatedThemes', created.map((s) => s.name).join(', ')));
    parts.push(includeManual ? t('msgClassified', changed) : t('msgClassifiedKeptManual', changed, total - changed));
    parts.push(t('msgUncategorizedLeft', uncategorizedCount()));
    message('msg-classify', parts.join(' '));
    drawAll();
  }

  // ---------------------------------------------------------------------------
  // Theme suggestions
  // ---------------------------------------------------------------------------

  let currentSuggestions = [];
  const checked = new Set();
  const alreadySuggested = new Set();

  function drawSuggestions() {
    currentSuggestions = Y.suggestThemes(state.channels, state.themes, state.settings.dismissedSuggestions);
    for (const s of currentSuggestions) {
      // Comes pre-checked the first time it shows up, if it fits 3+ channels.
      if (!alreadySuggested.has(s.id)) {
        alreadySuggested.add(s.id);
        if (s.total >= 3) checked.add(s.id);
      }
    }
    const words = Y.frequentWords(state.channels, state.themes);

    $('suggestion-list').replaceChildren(...currentSuggestions.map((s) => {
      const box = el('input', { type: 'checkbox', checked: checked.has(s.id), 'data-id': s.id });
      box.addEventListener('change', () => {
        if (box.checked) checked.add(s.id); else checked.delete(s.id);
      });
      const dismiss = el('button', { type: 'button', cls: 'dismiss', text: t('suggestionDismiss'), title: t('suggestionDismissTitle') });
      dismiss.addEventListener('click', async () => {
        checked.delete(s.id);
        state.settings.dismissedSuggestions = [...new Set([...(state.settings.dismissedSuggestions || []), s.id])];
        await Y.save({ settings: state.settings });
        drawSuggestions();
      });
      const examples = s.examples.join(', ') + (s.total > s.examples.length ? '…' : '');
      return el('div', { cls: 'suggestion' }, [
        el('label', {}, [
          box,
          el('span', { cls: 'suggestion-name', text: s.name }),
          el('span', { cls: 'detail', text: t('suggestionDetail', s.total, examples) })
        ]),
        dismiss
      ]);
    }));

    $('frequent-words').replaceChildren(...words.map((w) => {
      const b = el('button', { type: 'button', cls: 'word', title: t('wordTitle', w.total) }, [
        document.createTextNode(w.word),
        el('span', { text: String(w.total) })
      ]);
      b.addEventListener('click', () => createFromWord(w.word));
      return b;
    }));
    $('words-block').hidden = words.length === 0;
    $('suggestions').hidden = currentSuggestions.length === 0 && words.length === 0;
  }

  async function createFromWord(word) {
    const proposed = word.charAt(0).toUpperCase() + word.slice(1);
    const name = (prompt(t('promptThemeFromWord', word), proposed) || '').trim();
    if (!name) return;
    state.themes.push({ id: uniqueThemeId(name), name, keywords: [word] });
    clearTimeout(themesSaveTimer);
    const changed = Y.classifyAll(state.channels, state.themes, false);
    await Y.save({ themes: state.themes, channels: state.channels });
    message('msg-classify', t('msgCreatedFromWord', name, changed));
    drawAll();
  }

  // ---------------------------------------------------------------------------
  // 3. Channel review
  // ---------------------------------------------------------------------------

  function drawListFilter() {
    const select = $('list-filter');
    const current = select.value || FILTER_ALL;
    const options = [
      [FILTER_ALL, t('listAllChannels')],
      [FILTER_NONE, t('listUncategorized')],
      [FILTER_MANUAL, t('listManual')],
      ...state.themes.map((c) => [c.id, c.name])
    ];
    select.replaceChildren(...options.map(([value, text]) => el('option', { value, text })));
    select.value = options.some(([v]) => v === current) ? current : FILTER_ALL;
  }

  function passesFilter(channel) {
    const filter = $('list-filter').value || FILTER_ALL;
    const themes = channel.themes || [];
    if (filter === FILTER_NONE && themes.length) return false;
    if (filter === FILTER_MANUAL && !channel.manual) return false;
    if (![FILTER_ALL, FILTER_NONE, FILTER_MANUAL].includes(filter) && !themes.includes(filter)) return false;
    const query = Y.normalize($('search').value).trim();
    if (!query) return true;
    return Y.normalize(`${channel.name} ${channel.handle} ${channel.description}`).includes(query);
  }

  function channelRow(key, channel) {
    const url = channel.handle
      ? 'https://www.youtube.com/' + channel.handle
      : channel.id ? 'https://www.youtube.com/channel/' + channel.id : null;

    const avatar = channel.avatar
      ? el('img', { cls: 'avatar', src: channel.avatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
      : el('div', { cls: 'avatar', text: (channel.name || '?').trim().charAt(0).toUpperCase() });

    const info = el('div', { cls: 'info' }, [
      url
        ? el('a', { cls: 'name', href: url, target: '_blank', rel: 'noopener', text: channel.name || channel.handle })
        : el('span', { cls: 'name', text: channel.name || t('channelNoName') }),
      channel.handle ? el('span', { cls: 'handle', text: channel.handle }) : null,
      channel.description ? el('p', { cls: 'desc', text: channel.description, title: channel.description }) : null
    ]);

    const chips = el('div', { cls: 'theme-chips' });
    for (const theme of state.themes) {
      const on = (channel.themes || []).includes(theme.id);
      chips.append(el('button', {
        type: 'button',
        cls: 'chip' + (on ? ' on' : ''),
        'data-theme': theme.id,
        'aria-pressed': String(on),
        text: theme.name
      }));
    }
    if (channel.manual) {
      chips.append(el('span', { cls: 'manual-mark', text: t('channelManual') }, [
        el('button', { type: 'button', 'data-action': 'auto', title: t('channelBackToAuto'), text: '↺' })
      ]));
    }
    chips.append(el('button', { type: 'button', cls: 'delete', 'data-action': 'delete', title: t('channelDelete'), text: '✕' }));

    return el('div', { cls: 'channel', 'data-key': key }, [avatar, info, chips]);
  }

  function drawChannels() {
    const container = $('channel-list');
    const all = channelEntries();
    const filtered = all.filter(({ channel }) => passesFilter(channel));
    const shown = filtered.slice(0, LIST_LIMIT);
    if (!all.length) {
      container.replaceChildren(el('p', { cls: 'empty', text: t('listEmptyNoImport') }));
    } else if (!filtered.length) {
      container.replaceChildren(el('p', { cls: 'empty', text: t('listEmptyFilter') }));
    } else {
      container.replaceChildren(...shown.map(({ key, channel }) => channelRow(key, channel)));
    }
    $('list-count').textContent = filtered.length > LIST_LIMIT
      ? t('listShowingLimit', LIST_LIMIT, filtered.length)
      : t('listCount', filtered.length, all.length);
  }

  async function onChannelListClick(ev) {
    const button = ev.target.closest('button');
    const row = ev.target.closest('.channel');
    if (!button || !row) return;
    const key = row.dataset.key;
    const channel = state.channels[key];
    if (!channel) return;

    if (button.dataset.theme) {
      const id = button.dataset.theme;
      const current = new Set(channel.themes || []);
      if (current.has(id)) current.delete(id); else current.add(id);
      channel.themes = state.themes.map((c) => c.id).filter((c) => current.has(c));
      channel.manual = true;
    } else if (button.dataset.action === 'auto') {
      channel.manual = false;
      channel.themes = Y.classifyChannel(channel, Y.compileThemes(state.themes));
    } else if (button.dataset.action === 'delete') {
      if (!confirm(t('confirmDeleteChannel', channel.name))) return;
      delete state.channels[key];
      row.remove();
      await saveChannels();
      drawStatus();
      updateThemeCounts();
      return;
    } else {
      return;
    }
    row.replaceWith(channelRow(key, channel));
    await saveChannels();
    drawStatus();
    updateThemeCounts();
  }

  // ---------------------------------------------------------------------------
  // 4. Options and backup
  // ---------------------------------------------------------------------------

  function drawOptions() {
    $('opt-hide-shorts').checked = !!state.settings.hideShorts;
    $('opt-show-uncategorized').checked = !!state.settings.showUncategorized;
  }

  async function saveOptions() {
    state.settings.hideShorts = $('opt-hide-shorts').checked;
    state.settings.showUncategorized = $('opt-show-uncategorized').checked;
    await Y.save({ settings: state.settings });
  }

  function exportBackup() {
    const data = {
      format: 'youtube-subscriptions-filter',
      version: 2,
      exportedAt: new Date().toISOString(),
      themes: state.themes,
      channels: state.channels,
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `subscriptions-filter-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function restoreBackup(file) {
    try {
      let data = JSON.parse(await readFile(file));
      // Backups made by versions up to 0.4 use Portuguese field names.
      if (data && Array.isArray(data.categorias)) data = Y.migrateLegacy(data);
      if (!data || !Array.isArray(data.themes) || typeof data.channels !== 'object') {
        throw new Error(t('errorNotABackup'));
      }
      if (!confirm(t('confirmRestoreBackup'))) return;
      state.themes = data.themes;
      state.channels = data.channels || {};
      state.settings = { ...Y.DEFAULT_SETTINGS, ...(data.settings || {}) };
      await Y.save({ themes: state.themes, channels: state.channels, settings: state.settings });
      message('msg-backup', t('msgBackupRestored', state.themes.length, Object.keys(state.channels).length));
      drawAll();
    } catch (e) {
      message('msg-backup', t('msgRestoreError', e.message), true);
    }
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  function drawAll() {
    drawStatus();
    drawThemes();
    drawSuggestions();
    drawListFilter();
    drawChannels();
    drawOptions();
  }

  async function start() {
    translatePage();
    state = await Y.loadState();
    // Saves the default themes on first open, so the feed already has pills.
    const saved = await api.storage.local.get('themes');
    if (!saved || !Array.isArray(saved.themes)) await Y.save({ themes: state.themes });

    drawAll();
    await drawPermission();

    $('btn-permission').addEventListener('click', requestPermission);
    if (api.permissions && api.permissions.onAdded) api.permissions.onAdded.addListener(drawPermission);
    if (api.permissions && api.permissions.onRemoved) api.permissions.onRemoved.addListener(drawPermission);
    // Access can also be granted in Safari's settings, outside this page.
    window.addEventListener('focus', drawPermission);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) drawPermission();
    });

    $('btn-import-youtube').addEventListener('click', importFromYoutube);
    $('btn-import-csv').addEventListener('click', () => $('file-csv').click());
    $('file-csv').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) importCsv(f);
      ev.target.value = '';
    });
    $('btn-new-theme').addEventListener('click', newTheme);
    $('btn-restore-defaults').addEventListener('click', restoreDefaults);
    $('btn-classify').addEventListener('click', classify);
    $('search').addEventListener('input', drawChannels);
    $('list-filter').addEventListener('change', drawChannels);
    $('channel-list').addEventListener('click', onChannelListClick);
    $('opt-hide-shorts').addEventListener('change', saveOptions);
    $('opt-show-uncategorized').addEventListener('change', saveOptions);
    $('btn-export').addEventListener('click', exportBackup);
    $('btn-restore-backup').addEventListener('click', () => $('file-json').click());
    $('file-json').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) restoreBackup(f);
      ev.target.value = '';
    });

    // Changes made elsewhere (e.g. an import finishing in the YouTube tab).
    api.storage.onChanged.addListener(async (changes, area) => {
      if (area && area !== 'local') return;
      if (!changes.channels && !changes.lastImport && !changes.themes) return;
      const fresh = await Y.loadState();
      const editingThemes = themesSaveTimer !== null ||
        (document.activeElement && document.activeElement.closest('#theme-list'));
      state.channels = fresh.channels;
      state.lastImport = fresh.lastImport;
      if (!editingThemes) state.themes = fresh.themes;
      drawStatus();
      if (editingThemes) updateThemeCounts(); else drawThemes();
      drawSuggestions();
      drawListFilter();
      drawChannels();
      if (changes.lastImport && fresh.lastImport && fresh.lastImport.source === 'youtube') {
        message('msg-import', t('msgImportFinished', fresh.lastImport.read, fresh.lastImport.added));
      }
    });
  }

  start();
})();
