/**
 * Service worker (MV3 module).
 *
 * - Set default settings saat install.
 * - Relay perubahan settings ke content script tab aktif.
 */

const STORAGE_KEYS = {
  SETTINGS: "wcc.settings",
  SITE_RULES: "wcc.siteRules",
};

const DEFAULT_SETTINGS = {
  enabled: true,
  character: "hutao",
  activity: "medium",
  sound: false,
  reduceMotion: false,
  behaviors: {
    reactToPage: true,
    readHeadings: true,
    lookAtImages: true,
    sitOnElements: true,
    sleep: true,
  },
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get([STORAGE_KEYS.SETTINGS]);
  if (!data[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
  if (!(await chrome.storage.sync.get(STORAGE_KEYS.SITE_RULES))[STORAGE_KEYS.SITE_RULES]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: {} });
  }
});

// Teruskan pesan dari popup ke content script tab aktif.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WCC_RELAY" && msg.payload) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id != null) {
        chrome.tabs.sendMessage(tab.id, msg.payload, () => void chrome.runtime.lastError);
      }
      sendResponse({ ok: true });
    });
    return true; // async
  }
});
