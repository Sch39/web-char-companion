const STORAGE_KEYS = {
  SETTINGS: "wcc.settings",
  SITE_RULES: "wcc.siteRules",
  TAB_CHARS: "wcc.tabChars", // chrome.storage.session: { [tabId]: characterId }
  TAB_POSITIONS: "wcc.tabPositions", // chrome.storage.session: { [tabId]: {x, y} }
};

const DEFAULT_SETTINGS = {
  enabled: true,
  character: "luna",
  activity: "medium",
  reduceMotion: false,
  behaviors: {
    reactToPage: true,
    readHeadings: true,
    lookAtImages: true,
    sitOnElements: true,
    sleep: true,
    reactToInput: true,
    watchFilm: true,
    reactToDrag: true,
    reactToSensitive: true,
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

// Per-tab characters and positions live in storage.session (cleared when the
// browser closes). Content scripts can't access storage.session directly,
// and don't know their own tab id either — they go through here, using
// sender.tab.id to know which tab is asking.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WCC_RESOLVE_CHARACTER") {
    const tabId = sender.tab?.id;
    chrome.storage.session.get(STORAGE_KEYS.TAB_CHARS, (data) => {
      const map = data[STORAGE_KEYS.TAB_CHARS] || {};
      sendResponse({ character: tabId != null ? map[tabId] || null : null });
    });
    return true; // async
  }

  if (msg?.type === "WCC_GET_POSITION") {
    const tabId = sender.tab?.id;
    chrome.storage.session.get(STORAGE_KEYS.TAB_POSITIONS, (data) => {
      const map = data[STORAGE_KEYS.TAB_POSITIONS] || {};
      sendResponse({ position: tabId != null ? map[tabId] || null : null });
    });
    return true; // async
  }

  if (msg?.type === "WCC_SAVE_POSITION") {
    const tabId = sender.tab?.id;
    if (tabId == null || typeof msg.x !== "number" || typeof msg.y !== "number") {
      sendResponse?.({ ok: false });
      return;
    }
    chrome.storage.session.get(STORAGE_KEYS.TAB_POSITIONS, (data) => {
      const map = data[STORAGE_KEYS.TAB_POSITIONS] || {};
      map[tabId] = { x: msg.x, y: msg.y };
      chrome.storage.session.set({ [STORAGE_KEYS.TAB_POSITIONS]: map }, () => {
        sendResponse?.({ ok: true });
      });
    });
    return true; // async
  }
});

// Drop a tab's override/position when it closes so the maps don't pile up.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const data = await chrome.storage.session.get([
    STORAGE_KEYS.TAB_CHARS,
    STORAGE_KEYS.TAB_POSITIONS,
  ]);
  const chars = data[STORAGE_KEYS.TAB_CHARS] || {};
  const positions = data[STORAGE_KEYS.TAB_POSITIONS] || {};
  let changed = false;
  if (chars[tabId] != null) {
    delete chars[tabId];
    changed = true;
  }
  if (positions[tabId] != null) {
    delete positions[tabId];
    changed = true;
  }
  if (changed) {
    await chrome.storage.session.set({
      [STORAGE_KEYS.TAB_CHARS]: chars,
      [STORAGE_KEYS.TAB_POSITIONS]: positions,
    });
  }
});
