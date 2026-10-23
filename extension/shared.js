/*
 * Logic shared by the YouTube content script (content.js) and the settings
 * page (options.js): storage, translations, classification and channel lookup.
 */
(function (global) {
  'use strict';

  const api = global.browser || global.chrome;
  const { CATALOG, YOUTUBE_CATEGORIES, LEGACY_THEME_IDS } = global.YTCatCatalog;

  // ---------------------------------------------------------------------------
  // Translations (the browser picks the locale from the system language)
  // ---------------------------------------------------------------------------

  function t(key, ...substitutions) {
    let message = '';
    try {
      message = api.i18n.getMessage(key, substitutions.map(String));
    } catch (e) {
      /* i18n not available */
    }
    return message || key;
  }

  function themeName(id) {
    const key = 'theme_' + String(id).replace(/[^a-zA-Z0-9]/g, '_');
    const name = t(key);
    return name === key ? id : name;
  }

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  const DEFAULT_THEME_IDS = ['technology', 'runescape', 'investing', 'politics'];

  // A copy of a catalog theme, named in the current language.
  function catalogTheme(id) {
    const entry = CATALOG.find((c) => c.id === id);
    if (!entry) return null;
    return { ...JSON.parse(JSON.stringify(entry)), name: themeName(id) };
  }

  function defaultThemes() {
    return DEFAULT_THEME_IDS.map(catalogTheme);
  }

  const DEFAULT_SETTINGS = {
    hideShorts: true,          // hide the Shorts shelf while a filter is active
    showUncategorized: true,   // show the "Uncategorized" pill
    hideWatched: false,        // hide videos already watched (switch in the pill bar)
    watchedThreshold: 90,      // % of the progress bar from which a video counts as watched
    dismissedSuggestions: []   // catalog themes the user does not want suggested
  };

  const KEYS = ['themes', 'channels', 'settings', 'activeFilters', 'lastImport'];

  // ---------------------------------------------------------------------------
  // Text
  // ---------------------------------------------------------------------------

  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function slug(text) {
    return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
  }

  // ---------------------------------------------------------------------------
  // Channel identity
  // ---------------------------------------------------------------------------

  function normalizeHandle(handle) {
    let h = String(handle || '').trim();
    if (!h) return '';
    try { h = decodeURIComponent(h); } catch (e) { /* already decoded */ }
    h = h.normalize('NFC').toLowerCase();
    if (!h.startsWith('@')) h = '@' + h;
    return h;
  }

  function normalizeName(name) {
    return normalize(name).replace(/\s+/g, ' ').trim();
  }

  // Reads the channel identity from a YouTube link.
  function channelFromHref(href) {
    if (!href) return null;
    let path;
    try {
      path = new URL(href, 'https://www.youtube.com').pathname;
    } catch (e) {
      return null;
    }
    try { path = decodeURIComponent(path); } catch (e) { /* keep as is */ }
    let m = path.match(/^\/(@[^/?#]+)/);
    if (m) return { handle: normalizeHandle(m[1]) };
    m = path.match(/^\/channel\/(UC[\w-]{10,})/);
    if (m) return { id: m[1] };
    m = path.match(/^\/(?:c|user)\/([^/?#]+)/);
    if (m) return { legacy: normalize(m[1]) };
    return null;
  }

  function channelKey(channel) {
    if (channel.handle) return 'h:' + normalizeHandle(channel.handle);
    if (channel.id) return 'c:' + channel.id;
    return 'n:' + normalizeName(channel.name);
  }

  // Indexes to find a saved channel by handle, id or name.
  function buildIndex(channels) {
    const byHandle = new Map();
    const byId = new Map();
    const byName = new Map();
    for (const channel of Object.values(channels || {})) {
      if (channel.handle) byHandle.set(normalizeHandle(channel.handle), channel);
      if (channel.id) byId.set(channel.id, channel);
      const name = normalizeName(channel.name);
      if (name && !byName.has(name)) byName.set(name, channel);
    }
    return { byHandle, byId, byName };
  }

  function findChannel(index, { handle, id, name } = {}) {
    if (handle) {
      const c = index.byHandle.get(normalizeHandle(handle));
      if (c) return c;
    }
    if (id) {
      const c = index.byId.get(id);
      if (c) return c;
    }
    if (name) {
      const c = index.byName.get(normalizeName(name));
      if (c) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Keywords
  // ---------------------------------------------------------------------------

  function compileKeyword(keyword) {
    let k = normalize(keyword).trim();
    if (!k) return null;
    const prefix = k.endsWith('*');
    if (prefix) k = k.slice(0, -1).trim();
    if (!k) return null;
    const body = escapeRegex(k).replace(/\s+/g, '\\s+');
    const end = prefix ? '' : '(?![a-z0-9])';
    return {
      base: k,
      compact: k.replace(/\s+/g, ''),
      re: new RegExp('(?:^|[^a-z0-9])' + body + end)
    };
  }

  // ---------------------------------------------------------------------------
  // Official YouTube categories
  // ---------------------------------------------------------------------------

  const YOUTUBE_ALIASES = new Map();
  for (const [official, aliases] of Object.entries(YOUTUBE_CATEGORIES)) {
    YOUTUBE_ALIASES.set(normalize(official), official);
    for (const a of aliases) YOUTUBE_ALIASES.set(normalize(a), official);
  }

  function canonicalYoutubeCategory(name) {
    const original = String(name || '').trim();
    if (!original) return null;
    return YOUTUBE_ALIASES.get(normalize(original)) || original;
  }

  // Most frequent category among the channel's recent videos.
  function mainCategory(channel) {
    const list = (channel.yt && channel.yt.categories) || [];
    const n = {};
    let best = null;
    for (const c of list) {
      if (!c) continue;
      n[c] = (n[c] || 0) + 1;
      if (!best || n[c] > n[best]) best = c;
    }
    return best;
  }

  // Themes created by the user have no YouTube categories of their own; if the
  // id matches a catalog theme, the catalog's categories are used.
  function themeYoutubeCategories(theme) {
    if (theme.youtube !== undefined || theme.youtubeWeak !== undefined) {
      return { strong: theme.youtube || [], weak: theme.youtubeWeak || [] };
    }
    const entry = CATALOG.find((c) => c.id === theme.id) || {};
    return { strong: entry.youtube || [], weak: entry.youtubeWeak || [] };
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  const MIN_SCORE = 2;

  function compileThemes(themes) {
    return (themes || []).map((theme) => {
      const yt = themeYoutubeCategories(theme);
      return {
        id: theme.id,
        rules: (theme.keywords || []).map(compileKeyword).filter(Boolean),
        youtube: yt.strong,
        youtubeWeak: yt.weak
      };
    });
  }

  // A keyword in the name or @handle is worth 3; in the description or the
  // video tags, 1. The official YouTube category (the most common one among
  // recent videos) is worth 3.
  function scoreChannel(channel, compiled) {
    const name = normalize(channel.name);
    const handle = normalize(channel.handle || '').replace(/^@/, '').replace(/[^a-z0-9]/g, '');
    const description = normalize(channel.description);
    const tags = normalize(((channel.yt && channel.yt.tags) || []).join(' | '));
    const category = mainCategory(channel);
    const scores = {};
    for (const theme of compiled) {
      let sum = 0;
      for (const rule of theme.rules) {
        const inName = rule.re.test(name) ||
          (rule.compact.length >= 4 && handle.includes(rule.compact));
        if (inName) sum += 3;
        if (description && rule.re.test(description)) sum += 1;
        if (tags && rule.re.test(tags)) sum += 1;
      }
      if (category && theme.youtube.includes(category)) sum += 3;
      if (sum > 0) scores[theme.id] = sum;
    }
    return scores;
  }

  // A channel joins every theme with at least 2 points and at least half of
  // the top score. If nothing fits, a broad YouTube category (e.g.
  // "Entertainment") decides, when some theme uses it.
  function classifyChannel(channel, compiled) {
    const scores = scoreChannel(channel, compiled);
    const top = Math.max(0, ...Object.values(scores));
    if (top >= MIN_SCORE) {
      const cut = Math.max(MIN_SCORE, top / 2);
      return Object.keys(scores).filter((id) => scores[id] >= cut);
    }
    const category = mainCategory(channel);
    if (category) {
      return compiled.filter((c) => c.youtubeWeak.includes(category)).map((c) => c.id);
    }
    return [];
  }

  // Reclassifies every channel. Channels adjusted by hand are kept unless
  // includeManual is true.
  function classifyAll(channels, themes, includeManual) {
    const compiled = compileThemes(themes);
    let changed = 0;
    for (const channel of Object.values(channels)) {
      if (channel.manual && !includeManual) continue;
      channel.themes = classifyChannel(channel, compiled);
      channel.manual = false;
      changed++;
    }
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Suggestions
  // ---------------------------------------------------------------------------

  // Catalog themes not in use yet that would fit at least two channels,
  // sorted from the one that fits the most channels.
  function suggestThemes(channels, themes, dismissed) {
    const current = new Set((themes || []).map((c) => c.id));
    const skip = new Set(dismissed || []);
    const candidates = CATALOG.filter((c) => !current.has(c.id) && !skip.has(c.id));
    if (!candidates.length) return [];
    const compiled = compileThemes([...(themes || []), ...candidates]);
    const found = new Map(candidates.map((c) => [c.id, []]));
    for (const channel of Object.values(channels || {})) {
      for (const id of classifyChannel(channel, compiled)) {
        if (found.has(id)) found.get(id).push(channel.name || channel.handle || '');
      }
    }
    return candidates
      .map((c) => ({ id: c.id, name: themeName(c.id), total: found.get(c.id).length, examples: found.get(c.id).slice(0, 3) }))
      .filter((s) => s.total >= 2)
      .sort((a, b) => b.total - a.total);
  }

  const STOP_WORDS = new Set((
    // Portuguese
    'para como mais sobre todos todas toda todo canal canais videos video aqui este esta esse essa ' +
    'isso isto voce voces nosso nossa nossos nossas seus suas pelo pela pelos pelas quem quando onde ' +
    'porque entao tambem muito muita muitos muitas sempre cada novo novos nova novas semana segunda ' +
    'terca quarta quinta sexta sabado domingo dias inscreva inscrevase inscreve inscricao inscritos ' +
    'contato oficial comercial parcerias parceria conteudo conteudos mundo vida melhor melhores brasil ' +
    'brasileiro brasileira sejam vindos ainda agora depois antes entre desde mesmo outros outras coisa ' +
    'coisas fazer feito ser sua seu tudo nada ate pra pro vamos ' +
    // English
    'the and with your this that from about more have will just what business inquiries contact ' +
    'subscribe follow every week channel official videos video welcome here new best world life ' +
    'also into they them their there were been being only some other than then over make like ' +
    // Web
    'email gmail hotmail instagram twitter tiktok facebook youtube twitch discord http https www link links'
  ).split(/\s+/));

  // Words repeated among channels that are still uncategorized (counted once
  // per channel), so the user can create new themes from them.
  function frequentWords(channels, themes, limit = 12) {
    const used = new Set();
    for (const theme of themes || []) {
      for (const k of theme.keywords || []) used.add(normalize(k).replace(/\*$/, '').trim());
    }
    const counts = new Map();
    for (const channel of Object.values(channels || {})) {
      if ((channel.themes || []).length) continue;
      const text = normalize([channel.name, channel.description, ...((channel.yt && channel.yt.tags) || [])].join(' '));
      const terms = new Set(text.split(/[^a-z0-9]+/).filter((w) =>
        w.length >= 4 && !/^\d+$/.test(w) && !STOP_WORDS.has(w) && !used.has(w)));
      for (const w of terms) counts.set(w, (counts.get(w) || 0) + 1);
    }
    return [...counts]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([word, total]) => ({ word, total }));
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  // Merges a freshly imported list into the saved channels. New channels are
  // classified; existing ones get their data updated and are reclassified only
  // if they were not adjusted by hand. Nothing is deleted.
  function mergeImport(channels, imported, themes) {
    const compiled = compileThemes(themes);
    const index = buildIndex(channels);
    let added = 0;
    let updated = 0;
    for (const raw of imported) {
      if (!raw || (!raw.handle && !raw.id && !raw.name)) continue;
      const item = {
        handle: raw.handle ? normalizeHandle(raw.handle) : '',
        id: raw.id || '',
        name: String(raw.name || '').trim(),
        description: String(raw.description || '').trim(),
        avatar: raw.avatar || ''
      };
      const existing = findChannel(index, item);
      if (existing) {
        const oldKey = channelKey(existing);
        existing.handle = item.handle || existing.handle || '';
        existing.id = item.id || existing.id || '';
        existing.name = item.name || existing.name;
        existing.description = item.description || existing.description || '';
        existing.avatar = item.avatar || existing.avatar || '';
        if (!existing.manual) existing.themes = classifyChannel(existing, compiled);
        const newKey = channelKey(existing);
        if (newKey !== oldKey) {
          delete channels[oldKey];
          channels[newKey] = existing;
        }
        updated++;
      } else {
        const channel = { ...item, themes: [], manual: false, addedAt: Date.now() };
        channel.themes = classifyChannel(channel, compiled);
        channels[channelKey(channel)] = channel;
        if (channel.handle) index.byHandle.set(channel.handle, channel);
        if (channel.id) index.byId.set(channel.id, channel);
        const n = normalizeName(channel.name);
        if (n && !index.byName.has(n)) index.byName.set(n, channel);
        added++;
      }
    }
    return { added, updated };
  }

  // Google Takeout CSV (subscriptions.csv): channel id, URL, title.
  function parseTakeoutCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let quoted = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    row.push(field);
    if (row.some((c) => c.trim())) rows.push(row);

    const channels = [];
    for (const cols of rows) {
      const cells = cols.map((c) => c.trim());
      const id = cells.find((c) => /^UC[\w-]{20,}$/.test(c));
      if (!id) continue; // header or invalid row
      const url = cells.find((c) => /youtube\.com/i.test(c)) || '';
      const name = cells.find((c) => c && c !== id && c !== url) || '';
      const fromLink = channelFromHref(url) || {};
      channels.push({ id, handle: fromLink.handle || '', name });
    }
    return channels;
  }

  // ---------------------------------------------------------------------------
  // Migration from versions up to 0.4 (Portuguese storage keys and fields)
  // ---------------------------------------------------------------------------

  const LEGACY_KEYS = ['categorias', 'canais', 'config', 'filtrosAtivos', 'filtroAtivo', 'ultimaImportacao', 'importacaoPendente'];

  const newThemeId = (id) => LEGACY_THEME_IDS[id] || id;

  function migrateLegacy(old) {
    const themes = (old.categorias || []).map((c) => {
      const theme = { id: newThemeId(c.id), name: c.nome || c.id, keywords: c.palavras || [] };
      if (c.youtube !== undefined) theme.youtube = c.youtube;
      if (c.youtubeFraco !== undefined) theme.youtubeWeak = c.youtubeFraco;
      return theme;
    });
    const channels = {};
    for (const [key, c] of Object.entries(old.canais || {})) {
      const channel = {
        handle: c.handle || '',
        id: c.id || '',
        name: c.nome || '',
        description: c.descricao || '',
        avatar: c.avatar || '',
        themes: (c.categorias || []).map(newThemeId),
        manual: !!c.manual
      };
      if (c.adicionadoEm) channel.addedAt = c.adicionadoEm;
      if (c.yt) {
        channel.yt = { id: c.yt.id || null, categories: c.yt.categorias || [], tags: c.yt.tags || [], fetchedAt: c.yt.quando || 0 };
      }
      channels[key] = channel;
    }
    const cfg = old.config || {};
    const settings = { ...DEFAULT_SETTINGS };
    if (cfg.ocultarShorts !== undefined) settings.hideShorts = cfg.ocultarShorts;
    if (cfg.mostrarSemCategoria !== undefined) settings.showUncategorized = cfg.mostrarSemCategoria;
    settings.dismissedSuggestions = (cfg.sugestoesIgnoradas || []).map(newThemeId);
    const oldFilters = Array.isArray(old.filtrosAtivos)
      ? old.filtrosAtivos
      : old.filtroAtivo && old.filtroAtivo !== 'todos' ? [old.filtroAtivo] : [];
    const activeFilters = oldFilters.map((f) => (f === '__sem__' ? '__none__' : newThemeId(f)));
    const result = { channels, settings, activeFilters };
    if (themes.length || Array.isArray(old.categorias)) result.themes = themes;
    const u = old.ultimaImportacao;
    if (u) result.lastImport = { at: u.quando, read: u.lidos, added: u.novos, source: u.origem };
    return result;
  }

  async function migrateIfNeeded() {
    const old = (await api.storage.local.get(LEGACY_KEYS)) || {};
    if (!LEGACY_KEYS.some((k) => k in old)) return false;
    const current = (await api.storage.local.get(KEYS)) || {};
    if (!current.themes && !current.channels) {
      await api.storage.local.set(migrateLegacy(old));
    }
    await api.storage.local.remove(LEGACY_KEYS);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  async function loadState() {
    await migrateIfNeeded();
    const d = (await api.storage.local.get(KEYS)) || {};
    return {
      themes: Array.isArray(d.themes) ? d.themes : defaultThemes(),
      channels: d.channels && typeof d.channels === 'object' ? d.channels : {},
      settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
      // Themes selected in the pill bar; empty means "All".
      activeFilters: Array.isArray(d.activeFilters) ? d.activeFilters : [],
      lastImport: d.lastImport || null
    };
  }

  function save(partial) {
    return api.storage.local.set(partial);
  }

  global.YTCat = {
    api,
    t,
    themeName,
    CATALOG,
    DEFAULT_SETTINGS,
    defaultThemes,
    catalogTheme,
    normalize,
    normalizeName,
    normalizeHandle,
    slug,
    clone,
    channelFromHref,
    channelKey,
    buildIndex,
    findChannel,
    canonicalYoutubeCategory,
    mainCategory,
    themeYoutubeCategories,
    compileThemes,
    scoreChannel,
    classifyChannel,
    classifyAll,
    suggestThemes,
    frequentWords,
    mergeImport,
    parseTakeoutCsv,
    migrateLegacy,
    loadState,
    save
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
