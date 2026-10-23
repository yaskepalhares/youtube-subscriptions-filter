/*
 * Runs on all of youtube.com (the site is a single-page app and does not
 * reload between pages), but only acts in two places:
 *   /feed/subscriptions -> pill bar and video filter
 *   /feed/channels      -> import of the subscribed channels list
 */
(() => {
  'use strict';
  if (window.__ytcatLoaded) return;
  window.__ytcatLoaded = true;

  const Y = globalThis.YTCat;
  const { api, t } = Y;

  const BAR_ID = 'ytcat-bar';
  const IMPORTER_ID = 'ytcat-importer';
  const HIDDEN_ATTR = 'data-ytcat-hidden';
  const FILTER_ALL = 'all';
  const FILTER_NONE = '__none__'; // "Uncategorized"

  const CARD_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer';
  const SHELF_SELECTOR = 'ytd-rich-section-renderer, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer';
  const CHANNEL_LIST_SELECTOR = 'ytd-channel-renderer';

  // Red "resume playback" bar YouTube draws under the thumbnail of videos you
  // have watched: the old card layout and the newer "lockup" layout.
  const PROGRESS_SELECTORS = [
    'ytd-thumbnail-overlay-resume-playback-renderer #progress',
    '[class*="WatchedProgressBarSegment"]',
    'yt-thumbnail-overlay-progress-bar-view-model [style*="width"]',
    '[class*="resume-playback"] [style*="width"]'
  ];

  const CARD_CHANNEL_NAME_SELECTORS = [
    'ytd-channel-name #text',
    '#channel-name #text',
    'ytd-channel-name a',
    'yt-content-metadata-view-model [class*="metadata-row"]'
  ];

  const log = (...args) => console.debug('[Subscriptions Filter]', ...args);

  let state = null;
  let index = null;
  let importPending = false;
  let importing = false;
  let barSignature = '';
  let timer = null;
  let lastNudge = 0;
  let lastNoCardsWarning = 0;
  let lastUnidentifiedLog = '';

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function textOf(root, selectors) {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      const text = el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      if (text) return text;
    }
    return '';
  }

  function isShown(el) {
    return !el.closest('[hidden]');
  }

  function create(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'text') el.textContent = v;
      else if (k.includes('-') || k === 'role') el.setAttribute(k, v);
      else el[k] = v;
    }
    for (const c of children || []) if (c) el.append(c);
    return el;
  }

  function openSettings() {
    try {
      api.runtime.sendMessage({ type: 'openSettings' });
    } catch (e) {
      log('Could not open the settings page', e);
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  async function reload() {
    state = await Y.loadState();
    index = Y.buildIndex(state.channels);
    const extra = (await api.storage.local.get('pendingImport')) || {};
    importPending = !!extra.pendingImport && Date.now() - extra.pendingImport < 10 * 60 * 1000;
    barSignature = '';
    schedule(0);
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    reload();
  });

  // ---------------------------------------------------------------------------
  // Scheduling: YouTube changes the DOM all the time, so work is debounced.
  // ---------------------------------------------------------------------------

  function schedule(delay = 200) {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  function run() {
    if (!state) return;
    const path = location.pathname;
    if (path === '/feed/subscriptions') processFeed();
    if (path === '/feed/channels') processChannelList();
    else if (!importing) removeImporter();
  }

  const PROGRESS_MATCH = PROGRESS_SELECTORS.join(', ');
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const target = m.target;
      if (target && target.closest && target.closest('#' + BAR_ID + ', #' + IMPORTER_ID)) continue;
      // Style changes are everywhere on YouTube; only the watched-progress bar matters.
      if (m.type === 'attributes' && !(state && state.settings.hideWatched && target.matches && target.matches(PROGRESS_MATCH))) continue;
      schedule();
      return;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

  document.addEventListener('yt-navigate-finish', () => schedule(0));
  document.addEventListener('yt-page-data-updated', () => schedule(0));

  // ---------------------------------------------------------------------------
  // Subscriptions feed
  // ---------------------------------------------------------------------------

  function feedRoot() {
    const all = document.querySelectorAll('ytd-browse[page-subtype="subscriptions"]');
    for (const el of all) if (!el.hasAttribute('hidden')) return el;
    return all[0] || null;
  }

  // Finds the card's channel: first by its links (/@handle or /channel/UC...),
  // then by the channel name written on the card.
  function identifyCard(card) {
    let hasHint = false;
    for (const a of card.querySelectorAll('a[href]')) {
      const info = Y.channelFromHref(a.getAttribute('href'));
      if (!info) continue;
      hasHint = true;
      const channel = Y.findChannel(index, info);
      if (channel) return { channel, identified: true };
    }
    const name = textOf(card, CARD_CHANNEL_NAME_SELECTORS);
    if (name) {
      hasHint = true;
      const channel = Y.findChannel(index, { name });
      if (channel) return { channel, identified: true };
    }
    return { channel: null, identified: hasHint };
  }

  // How much of the video was watched (0-100), from the thumbnail's red bar.
  function watchedPercent(card) {
    let best = 0;
    for (const sel of PROGRESS_SELECTORS) {
      for (const bar of card.querySelectorAll(sel)) {
        const m = (bar.style && bar.style.width || '').match(/^([\d.]+)%$/);
        if (m) best = Math.max(best, Number(m[1]));
      }
    }
    return best;
  }

  function isWatched(card) {
    const threshold = Number(state.settings.watchedThreshold) || 90;
    return watchedPercent(card) >= threshold;
  }

  // Selected themes that still exist. An empty list means "All".
  function validFilters() {
    const ids = new Set(state.themes.map((c) => c.id));
    if (state.settings.showUncategorized) ids.add(FILTER_NONE);
    return (state.activeFilters || []).filter((f, i, list) => ids.has(f) && list.indexOf(f) === i);
  }

  function isVideoCard(card) {
    return !card.parentElement || !card.parentElement.closest(SHELF_SELECTOR);
  }

  function processFeed() {
    const root = feedRoot();
    if (!root) return;

    const filters = validFilters();
    const showAll = filters.length === 0;
    const counts = { [FILTER_ALL]: 0, [FILTER_NONE]: 0 };
    for (const c of state.themes) counts[c.id] = 0;

    let visible = 0;
    let unidentified = 0;
    let watchedHidden = 0;
    const hideWatched = !!state.settings.hideWatched;
    const cards = [...root.querySelectorAll(CARD_SELECTOR)].filter(isVideoCard);

    for (const card of cards) {
      // Watched videos leave the feed (and the counts) while the switch is on.
      if (hideWatched && isWatched(card)) {
        watchedHidden++;
        if (!card.hasAttribute(HIDDEN_ATTR)) card.setAttribute(HIDDEN_ATTR, '');
        continue;
      }

      // Ads and empty cards have no channel.
      const { channel, identified } = identifyCard(card);
      const themes = channel ? channel.themes || [] : [];
      if (!identified) unidentified++;

      counts[FILTER_ALL]++;
      if (identified && themes.length === 0) counts[FILTER_NONE]++;
      for (const id of themes) if (id in counts) counts[id]++;

      // With several themes selected, a video shows if it belongs to any of them.
      const show = showAll || filters.some((f) =>
        f === FILTER_NONE ? identified && themes.length === 0 : themes.includes(f));

      if (show) visible++;
      if (card.hasAttribute(HIDDEN_ATTR) === show) card.toggleAttribute(HIDDEN_ATTR, !show);
    }

    const hideShelves = !showAll && state.settings.hideShorts;
    const header = feedHeader(root);
    for (const shelf of root.querySelectorAll(SHELF_SELECTOR)) {
      // The "Latest" header may live inside a section; it never hides.
      const hide = hideShelves && !(header && (shelf === header || shelf.contains(header)));
      if (shelf.hasAttribute(HIDDEN_ATTR) !== hide) shelf.toggleAttribute(HIDDEN_ATTR, hide);
    }

    if (cards.length === 0 && Date.now() - lastNoCardsWarning > 15000) {
      lastNoCardsWarning = Date.now();
      log('No video cards found in the feed (YouTube may have changed its layout).');
    }

    ensureBar(root, filters, counts, visible, watchedHidden);
    nudgeLoading(root, showAll, visible);
    const summary = `${unidentified}/${cards.length}`;
    if (unidentified > 0 && summary !== lastUnidentifiedLog) {
      lastUnidentifiedLog = summary;
      log(`${unidentified} of ${cards.length} cards without an identified channel (ads count here).`);
    }
  }

  // With a filter on, the page gets short and YouTube may be slow to request
  // more videos. If the "load more" spinner is in view, nudge the scroll.
  function nudgeLoading(root, showAll, visible) {
    if (showAll || visible > 24) return;
    if (Date.now() - lastNudge < 1500) return;
    const spinner = root.querySelector('ytd-continuation-item-renderer');
    if (!spinner || !spinner.getBoundingClientRect) return;
    const r = spinner.getBoundingClientRect();
    if (r.height === 0 && r.top === 0) return;
    if (r.top < window.innerHeight + 400) {
      lastNudge = Date.now();
      window.dispatchEvent(new Event('scroll'));
    }
  }

  // The feed's "Latest" header is the block holding the "All subscriptions"
  // button, a link to /feed/channels, which works in any language. Returns the
  // ancestor of that link that sits at the same level as the videos.
  function feedHeader(root) {
    const link = [...root.querySelectorAll('a[href*="/feed/channels"]')].find((a) => {
      try {
        return new URL(a.getAttribute('href'), 'https://www.youtube.com').pathname === '/feed/channels';
      } catch (e) {
        return false;
      }
    });
    const card = [...root.querySelectorAll(CARD_SELECTOR)].find(isVideoCard);
    if (!link || !card) return null;
    let el = link;
    while (el.parentElement && el.parentElement !== root && !el.parentElement.contains(card)) {
      el = el.parentElement;
    }
    return el.parentElement && el.parentElement.contains(card) && !el.contains(card) ? el : null;
  }

  // The bar goes right after the "Latest" header and before the videos.
  // Without a header, it goes at the top of the grid.
  function insertionPoint(root) {
    const header = feedHeader(root);
    if (header) return { after: header };
    const grid = root.querySelector('ytd-rich-grid-renderer');
    const contents = grid && [...grid.children].find((el) => el.id === 'contents');
    if (contents) return { before: contents };
    if (grid && grid.parentElement) return { before: grid };
    const list = root.querySelector('ytd-section-list-renderer');
    if (list && list.parentElement) return { before: list };
    const primary = root.querySelector('#primary');
    if (primary) return { inside: primary };
    return null;
  }

  function ensureBar(root, filters, counts, visible, watchedHidden) {
    const showAll = filters.length === 0;
    let bar = root.querySelector('#' + BAR_ID);
    const spot = insertionPoint(root);
    if (!bar) {
      if (!spot) return;
      bar = create('div', { id: BAR_ID, className: 'ytcat-bar' });
      bar.addEventListener('click', onBarClick);
      barSignature = '';
    }
    // Puts (or moves back) the bar in place; YouTube builds the header after
    // the grid, so the right spot can change after the first insertion.
    if (spot) {
      if (spot.after && spot.after.nextElementSibling !== bar) spot.after.after(bar);
      else if (spot.before && spot.before.previousElementSibling !== bar) spot.before.before(bar);
      else if (spot.inside && spot.inside.firstElementChild !== bar) spot.inside.prepend(bar);
    }
    alignBar(root, bar);

    const noChannels = Object.keys(state.channels).length === 0;
    const signature = JSON.stringify([
      filters, counts, visible, noChannels, watchedHidden, state.settings.hideWatched,
      state.themes.map((c) => [c.id, c.name]),
      state.settings.showUncategorized
    ]);
    if (signature === barSignature && bar.childElementCount) return;
    barSignature = signature;

    const pill = (id, label, n) => {
      const active = id === FILTER_ALL ? showAll : filters.includes(id);
      return create(
        'button',
        {
          type: 'button',
          className: 'ytcat-pill' + (active ? ' ytcat-active' : ''),
          'aria-pressed': String(active),
          'data-filter': id,
          title: t('pillTooltip', label, n)
        },
        [create('span', { text: label }), create('span', { className: 'ytcat-count', text: String(n) })]
      );
    };

    const pills = create('div', { className: 'ytcat-pills', role: 'toolbar' });
    pills.append(pill(FILTER_ALL, t('pillAll'), counts[FILTER_ALL]));
    for (const c of state.themes) pills.append(pill(c.id, c.name, counts[c.id] || 0));
    if (state.settings.showUncategorized) {
      pills.append(pill(FILTER_NONE, t('pillUncategorized'), counts[FILTER_NONE]));
    }
    if (noChannels) {
      pills.append(create('button', {
        type: 'button',
        className: 'ytcat-hint',
        'data-action': 'settings',
        text: t('barImportHint')
      }));
    }

    const side = create('div', { className: 'ytcat-side' });
    if (!showAll) {
      side.append(create('span', {
        className: 'ytcat-status',
        text: t('barLoadedStatus', visible, counts[FILTER_ALL])
      }));
    }
    side.append(watchedSwitch(watchedHidden));
    const settingsButton = create('button', {
      type: 'button',
      className: 'ytcat-settings',
      'data-action': 'settings',
      title: t('barSettings'),
      'aria-label': t('barSettings')
    });
    settingsButton.append(slidersIcon());
    side.append(settingsButton);

    bar.replaceChildren(pills, side);
  }

  // "Hide watched" switch. Shows how many watched videos are hidden.
  function watchedSwitch(hiddenCount) {
    const on = !!state.settings.hideWatched;
    const label = on && hiddenCount ? t('barHideWatchedCount', hiddenCount) : t('barHideWatched');
    return create('button', {
      type: 'button',
      className: 'ytcat-switch' + (on ? ' ytcat-on' : ''),
      role: 'switch',
      'aria-checked': String(on),
      'data-action': 'toggle-watched',
      title: t('barHideWatchedTitle', Number(state.settings.watchedThreshold) || 90)
    }, [
      create('span', { className: 'ytcat-switch-label', text: label }),
      create('span', { className: 'ytcat-switch-track' }, [create('span', { className: 'ytcat-switch-thumb' })])
    ]);
  }

  // Settings icon (three sliders), drawn with SVG.
  function slidersIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('aria-hidden', 'true');
    const lines = [
      ['M4 6h9', 'M17 6h3', 15.5, 6],
      ['M4 12h3', 'M11 12h9', 9, 12],
      ['M4 18h11', 'M19 18h1', 17, 18]
    ];
    for (const [a, b, cx, cy] of lines) {
      for (const d of [a, b]) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        svg.append(p);
      }
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', '2');
      svg.append(c);
    }
    return svg;
  }

  // Lines the pills up with the first column of videos and keeps the bar just
  // below YouTube's top bar while scrolling.
  function alignBar(root, bar) {
    const top = document.querySelector('#masthead-container') || document.querySelector('ytd-masthead');
    const height = top && top.getBoundingClientRect ? Math.round(top.getBoundingClientRect().height) : 0;
    if (height > 0) bar.style.setProperty('--ytcat-top', height + 'px');

    const card = [...root.querySelectorAll(CARD_SELECTOR)].find((c) => !c.hasAttribute(HIDDEN_ATTR));
    if (!card || !card.getBoundingClientRect) return;
    const rc = card.getBoundingClientRect();
    const rb = bar.getBoundingClientRect();
    if (rc.width === 0 || rb.width === 0) return;
    const inset = Math.round(rc.left - rb.left);
    if (inset >= 0 && inset < 160) {
      bar.style.paddingLeft = inset + 'px';
      bar.style.paddingRight = inset + 'px';
    }
  }

  window.addEventListener('resize', () => {
    const root = feedRoot();
    const bar = root && root.querySelector('#' + BAR_ID);
    if (bar) alignBar(root, bar);
  });

  function onBarClick(event) {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.action === 'settings') {
      openSettings();
      return;
    }
    if (target.dataset.action === 'toggle-watched') {
      state.settings.hideWatched = !state.settings.hideWatched;
      if (!state.settings.hideWatched) {
        // Bring back the watched cards; the next pass applies the theme filter again.
        for (const card of feedRoot().querySelectorAll('[' + HIDDEN_ATTR + ']')) card.removeAttribute(HIDDEN_ATTR);
      }
      barSignature = '';
      processFeed();
      Y.save({ settings: state.settings });
      return;
    }
    const id = target.dataset.filter;
    if (!id) return;
    const current = validFilters();
    let next;
    if (id === FILTER_ALL) {
      // "All" clears the selection.
      if (!current.length) return;
      next = [];
    } else if (current.includes(id)) {
      // Unselect; if it was the only one, the list becomes empty = "All".
      next = current.filter((f) => f !== id);
    } else {
      next = [...current, id];
    }
    state.activeFilters = next;
    barSignature = '';
    processFeed();
    window.scrollTo({ top: 0 });
    Y.save({ activeFilters: next });
  }

  // ---------------------------------------------------------------------------
  // Import from /feed/channels
  // ---------------------------------------------------------------------------

  function channelCards() {
    return [...document.querySelectorAll(CHANNEL_LIST_SELECTOR)].filter(isShown);
  }

  function collectChannels() {
    const list = [];
    for (const el of channelCards()) {
      let info = {};
      for (const a of el.querySelectorAll('a[href]')) {
        const x = Y.channelFromHref(a.getAttribute('href'));
        if (x && (x.handle || x.id)) { info = x; break; }
      }
      let handle = info.handle || '';
      if (!handle) {
        const meta = textOf(el, ['#subscribers', '#video-count', '#metadata']);
        const m = meta.match(/@[^\s•·]+/);
        if (m) handle = m[0];
      }
      const name = textOf(el, [
        '#channel-title #text', 'ytd-channel-name #text', '#text.ytd-channel-name', '#channel-title', '#title'
      ]);
      const description = textOf(el, ['#description']);
      const img = el.querySelector('img');
      const avatar = img && /^https?:/.test(img.src || '') ? img.src : '';
      if (handle || info.id || name) {
        list.push({ handle, id: info.id || '', name, description, avatar });
      }
    }
    return list;
  }

  function ensureImporter() {
    let panel = document.getElementById(IMPORTER_ID);
    if (panel) return panel;
    panel = create('div', { id: IMPORTER_ID, className: 'ytcat-importer' }, [
      create('div', { className: 'ytcat-imp-title', text: t('extName') }),
      create('div', { className: 'ytcat-imp-status', text: t('importerIntro') }),
      create('div', { className: 'ytcat-imp-actions' }, [
        create('button', { type: 'button', className: 'ytcat-button', 'data-action': 'import', text: t('importerImport') })
      ])
    ]);
    panel.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.action === 'import') startImport();
      if (b.dataset.action === 'settings') openSettings();
      if (b.dataset.action === 'close') panel.remove();
    });
    document.body.append(panel);
    return panel;
  }

  function removeImporter() {
    const p = document.getElementById(IMPORTER_ID);
    if (p) p.remove();
  }

  const RETRY_BUTTONS = () => [['import', t('importerRetry')], ['close', t('importerClose')]];

  // progress: a number between 0 and 1 shows the progress bar; null hides it.
  function importerStatus(text, buttons, progress) {
    const panel = ensureImporter();
    panel.querySelector('.ytcat-imp-status').textContent = text;
    let bar = panel.querySelector('.ytcat-imp-progress');
    if (typeof progress === 'number') {
      if (!bar) {
        bar = create('div', { className: 'ytcat-imp-progress' }, [create('div')]);
        panel.querySelector('.ytcat-imp-status').after(bar);
      }
      bar.firstElementChild.style.width = Math.round(Math.min(1, Math.max(0, progress)) * 100) + '%';
    } else if (bar) {
      bar.remove();
    }
    if (buttons) {
      panel.querySelector('.ytcat-imp-actions').replaceChildren(
        ...buttons.map(([action, label]) =>
          create('button', { type: 'button', className: 'ytcat-button', 'data-action': action, text: label })
        )
      );
    }
  }

  let waitingSince = 0;

  function processChannelList() {
    if (importing) return;
    ensureImporter();
    if (!importPending) return;
    if (channelCards().length > 0) {
      startImport();
      return;
    }
    if (!waitingSince) waitingSince = Date.now();
    if (Date.now() - waitingSince > 20000) {
      importPending = false;
      api.storage.local.remove('pendingImport');
      importerStatus(t('importerNoList'), RETRY_BUTTONS());
    } else {
      importerStatus(t('importerWaiting'), []);
      schedule(1000);
    }
  }

  async function startImport() {
    if (importing) return;
    importing = true;
    importPending = false;
    waitingSince = 0;
    try {
      await api.storage.local.remove('pendingImport');

      let previous = -1;
      let stable = 0;
      for (let i = 0; i < 400; i++) {
        const n = channelCards().length;
        importerStatus(t('importerScrolling', n), []);
        const spinner = [...document.querySelectorAll('ytd-continuation-item-renderer')].some(isShown);
        stable = n === previous ? stable + 1 : 0;
        if ((!spinner && stable >= 2) || stable >= 8) break;
        previous = n;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(900);
      }

      const list = collectChannels();
      if (list.length === 0) {
        importerStatus(t('importerNoChannels'), RETRY_BUTTONS());
        return;
      }

      const current = await Y.loadState();
      const r = Y.mergeImport(current.channels, list, current.themes);
      await Y.save({
        channels: current.channels,
        lastImport: { at: Date.now(), read: list.length, added: r.added, source: 'youtube' }
      });
      window.scrollTo(0, 0);

      const fetchResult = await fetchYoutubeData(current, (done, total) => importerStatus(
        t('importerReadingCategories', done, total), [], total ? done / total : 1
      ));
      Y.classifyAll(current.channels, current.themes, false);
      await Y.save({ channels: current.channels });

      const uncategorized = Object.values(current.channels).filter((c) => !(c.themes || []).length).length;
      const suggestions = Y.suggestThemes(current.channels, current.themes, current.settings.dismissedSuggestions);
      const parts = [t('importerDone', list.length, r.added)];
      if (fetchResult.total) parts.push(t('importerCategoriesRead', fetchResult.withCategory, fetchResult.total));
      if (fetchResult.error) parts.push(t('importerStoppedEarly', fetchResult.error));
      parts.push(suggestions.length
        ? t('importerSuggestions', suggestions.length)
        : t('importerUncategorized', uncategorized));
      importerStatus(parts.join(' '), [['settings', t('importerOpenSettings')], ['close', t('importerClose')]]);
      log('Import finished', r, fetchResult);
    } catch (e) {
      log('Import error', e);
      importerStatus(t('importerError', e && e.message ? e.message : String(e)), RETRY_BUTTONS());
    } finally {
      importing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Official YouTube category of each channel
  //
  // For each channel: resolve the channel id (UC...) from the @handle, take
  // the 3 most recent videos from the channel's RSS feed and read the category
  // and tags of each video. Requests are small (about 50 KB per channel) and
  // run for 4 channels at a time.
  // ---------------------------------------------------------------------------

  const YT = 'https://www.youtube.com';
  const FALLBACK_CLIENT_VERSION = '2.20261022.01.00';
  const DATA_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
  const CONCURRENCY = 4;
  let clientVersion = null;

  class HttpError extends Error {
    constructor(status) {
      super('HTTP ' + status);
      this.status = status;
    }
  }

  function getClientVersion() {
    if (clientVersion) return clientVersion;
    for (const s of document.querySelectorAll('script')) {
      const m = (s.textContent || '').match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
      if (m) { clientVersion = m[1]; break; }
    }
    return clientVersion || FALLBACK_CLIENT_VERSION;
  }

  async function innertube(endpoint, body) {
    const r = await fetch(`${YT}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // English, so category names always come back the same way.
        context: { client: { clientName: 'WEB', clientVersion: getClientVersion(), hl: 'en' } },
        ...body
      })
    });
    if (!r.ok) throw new HttpError(r.status);
    return r.json();
  }

  async function resolveChannelId(channel) {
    if (channel.id) return channel.id;
    if (!channel.handle) return null;
    let url = YT + '/' + encodeURI(channel.handle);
    for (let i = 0; i < 3; i++) {
      const j = await innertube('navigation/resolve_url', { url });
      const e = (j && j.endpoint) || {};
      const id = e.browseEndpoint && e.browseEndpoint.browseId;
      if (id && /^UC[\w-]{22}$/.test(id)) return id;
      // Older channels redirect from the @handle to /name; follow it.
      const next = e.urlEndpoint && e.urlEndpoint.url;
      if (!next || next === url) break;
      url = next;
    }
    return null;
  }

  async function youtubeData(channel) {
    const id = await resolveChannelId(channel);
    if (!id) return { id: null, categories: [], tags: [], fetchedAt: Date.now() };
    const r = await fetch(`${YT}/feeds/videos.xml?channel_id=${id}`, { credentials: 'omit' });
    if (r.status === 429) throw new HttpError(429);
    const xml = r.ok ? await r.text() : '';
    const videos = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]).slice(0, 3);
    const categories = [];
    const tags = new Set();
    for (const v of videos) {
      const j = await innertube('player', { videoId: v });
      const mf = j && j.microformat && j.microformat.playerMicroformatRenderer;
      const category = mf && Y.canonicalYoutubeCategory(mf.category);
      if (category) categories.push(category);
      for (const tag of ((j && j.videoDetails && j.videoDetails.keywords) || []).slice(0, 12)) tags.add(String(tag));
    }
    return { id, categories, tags: [...tags].slice(0, 30), fetchedAt: Date.now() };
  }

  // Reads the data of channels that have none yet (or older than 30 days).
  async function fetchYoutubeData(current, progress) {
    const pending = Object.values(current.channels).filter(
      (c) => !c.yt || !c.yt.fetchedAt || Date.now() - c.yt.fetchedAt > DATA_MAX_AGE
    );
    const total = pending.length;
    let next = 0;
    let done = 0;
    let withCategory = 0;
    let failuresInARow = 0;
    let sinceSave = 0;
    let error = null;
    progress(0, total);

    const worker = async () => {
      while (next < pending.length && !error) {
        const channel = pending[next++];
        try {
          const data = await youtubeData(channel);
          channel.yt = data;
          if (data.id && !channel.id) channel.id = data.id;
          if (data.categories.length) withCategory++;
          failuresInARow = 0;
        } catch (e) {
          failuresInARow++;
          log('Could not read channel data', channel.name, e);
          if (e && e.status === 429) error = t('errorRateLimited');
          else if (failuresInARow >= 6) error = t('errorTooManyFailures');
        }
        done++;
        sinceSave++;
        progress(done, total);
        if (sinceSave >= 15) {
          sinceSave = 0;
          await Y.save({ channels: current.channels });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await Y.save({ channels: current.channels });
    return { total, done, withCategory, error };
  }

  // For the automated tests.
  window.__ytcatInternals = { run, reload, identifyCard, collectChannels, startImport, youtubeData };

  reload();
})();
