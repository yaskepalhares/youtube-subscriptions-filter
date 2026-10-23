'use strict';

const api = globalThis.browser || globalThis.chrome;

// On first install, open the settings page so the user can import channels.
api.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === 'install') {
    api.runtime.openOptionsPage();
  }
});

// Clicking the toolbar icon opens the settings.
api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});

// Requests from YouTube pages (settings button in the pill bar, import panel).
api.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'openSettings') {
    api.runtime.openOptionsPage();
  }
});
