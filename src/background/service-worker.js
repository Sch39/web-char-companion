const STORAGE_KEYS = {
  SETTINGS: "wcc.settings",
  SITE_RULES: "wcc.siteRules",
  TAB_CHARS: "wcc.tabChars", // chrome.storage.session: { [tabId]: characterId }
};

const DEFAULT_SETTINGS = {
  enabled: true,
  character: "companion",
  activity: "medium",
  reduceMotion: false,
  behaviors: {
    reactToPage: true,
    readHeadings: true,
    lookAtImages: true,
    sitOnElements: true,
    sleep: true,
    reactToInput: true,
  },
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.sync.get([STORAGE_KEYS.SETTINGS]);
  if (!data[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
  const rules = await chrome.storage.sync.get(STORAGE_KEYS.SITE_RULES);
  if (!rules[STORAGE_KEYS.SITE_RULES]) {
    await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: {} });
  }
});

// Per-tab characters live in storage.session (cleared when the browser closes).
// Content scripts can't access storage.session directly, so they go through
// here — we use sender.tab.id to know which tab is asking.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WCC_RESOLVE_CHARACTER") {
    const tabId = sender.tab?.id;
    chrome.storage.session.get(STORAGE_KEYS.TAB_CHARS, (data) => {
      const map = data[STORAGE_KEYS.TAB_CHARS] || {};
      sendResponse({ character: tabId != null ? map[tabId] || null : null });
    });
    return true; // async
  }
});

// Drop the override when a tab closes so the map doesn't pile up.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.session.get(STORAGE_KEYS.TAB_CHARS);
  const map = data[STORAGE_KEYS.TAB_CHARS] || {};
  if (map[tabId] != null) {
    delete map[tabId];
    await chrome.storage.session.set({ [STORAGE_KEYS.TAB_CHARS]: map });
  }
});
