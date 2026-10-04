const STORAGE_KEYS = {
  SETTINGS: "wcc.settings",
  SITE_RULES: "wcc.siteRules",
  TAB_CHARS: "wcc.tabChars",
};

const DEFAULT_SETTINGS = {
  enabled: true,
  character: "hutao",
  activity: "medium",
  reduceMotion: false,
  behaviors: {
    reactToPage: true,
    readHeadings: true,
    lookAtImages: true,
    sitOnElements: true,
    sleep: true,
  },
};

const $ = (id) => document.getElementById(id);

let activeTabId = null;
let currentHost = null;
let globalChar = DEFAULT_SETTINGS.character;
let runMode = "off"; // off | active | paused

// --- storage helpers --------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function getTabChars() {
  const data = await chrome.storage.session.get(STORAGE_KEYS.TAB_CHARS);
  return data[STORAGE_KEYS.TAB_CHARS] || {};
}

async function setTabChar(id, char) {
  const map = await getTabChars();
  if (char == null) delete map[id];
  else map[id] = char;
  await chrome.storage.session.set({ [STORAGE_KEYS.TAB_CHARS]: map });
}

// --- messaging to the content script of the active tab ----------------------

function sendToTab(payload, cb) {
  if (activeTabId == null) {
    cb?.(null);
    return;
  }
  chrome.tabs.sendMessage(activeTabId, payload, (res) => {
    if (chrome.runtime.lastError) cb?.(null);
    else cb?.(res);
  });
}

function reloadTab() {
  sendToTab({ type: "WCC_SETTINGS_CHANGED" });
  // modul di-rebuild secara async; ambil status setelah sempat jalan
  setTimeout(queryState, 450);
}

// --- load / save ------------------------------------------------------------

async function load() {
  const data = await chrome.storage.sync.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.SITE_RULES,
  ]);
  const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  settings.behaviors = {
    ...DEFAULT_SETTINGS.behaviors,
    ...(data[STORAGE_KEYS.SETTINGS]?.behaviors || {}),
  };
  globalChar = settings.character;
  const siteRules = data[STORAGE_KEYS.SITE_RULES] || {};

  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;
  currentHost = hostFromUrl(tab?.url);

  const tabChars = await getTabChars();
  const override = activeTabId != null ? tabChars[activeTabId] : undefined;

  $("enabled").checked = settings.enabled;
  $("activity").value = settings.activity;
  $("reduceMotion").checked = settings.reduceMotion;
  $("readHeadings").checked = settings.behaviors.readHeadings;
  $("lookAtImages").checked = settings.behaviors.lookAtImages;
  $("sitOnElements").checked = settings.behaviors.sitOnElements;
  $("sleep").checked = settings.behaviors.sleep;

  $("perTab").checked = !!override;
  $("character").value = override || globalChar;

  $("site-host").textContent = currentHost || "halaman ini";
  $("site-rule").value =
    currentHost && siteRules[currentHost] ? siteRules[currentHost] : "default";

  queryState();
}

function collectSettings() {
  return {
    enabled: $("enabled").checked,
    character: globalChar, // karakter global tak diubah oleh pilihan per-tab
    activity: $("activity").value,
    reduceMotion: $("reduceMotion").checked,
    behaviors: {
      reactToPage: true,
      readHeadings: $("readHeadings").checked,
      lookAtImages: $("lookAtImages").checked,
      sitOnElements: $("sitOnElements").checked,
      sleep: $("sleep").checked,
    },
  };
}

async function saveGlobal() {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: collectSettings() });
}

async function saveSettingsAndReload() {
  await saveGlobal();
  reloadTab();
}

async function saveSiteRule(value) {
  if (!currentHost) return;
  const data = await chrome.storage.sync.get([STORAGE_KEYS.SITE_RULES]);
  const rules = data[STORAGE_KEYS.SITE_RULES] || {};
  if (value === "default") delete rules[currentHost];
  else rules[currentHost] = value;
  await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: rules });
  reloadTab();
}

// --- character (global vs per-tab) ------------------------------------------

async function onCharacterChange() {
  const val = $("character").value;
  if ($("perTab").checked) {
    await setTabChar(activeTabId, val);
  } else {
    globalChar = val;
    await saveGlobal();
    await setTabChar(activeTabId, null); // ikut global lagi
  }
  reloadTab();
}

async function onPerTabChange() {
  if ($("perTab").checked) {
    await setTabChar(activeTabId, $("character").value || globalChar);
  } else {
    await setTabChar(activeTabId, null);
    $("character").value = globalChar;
  }
  reloadTab();
}

// --- run state (pause / resume) ---------------------------------------------

function setStateUI(mode) {
  runMode = mode;
  const dot = $("state-dot");
  const text = $("state-text");
  const btn = $("toggle");
  dot.className = "dot " + mode;
  if (mode === "active") {
    text.textContent = "Aktif";
    btn.textContent = "Jeda";
    btn.disabled = false;
  } else if (mode === "paused") {
    text.textContent = "Dijeda";
    btn.textContent = "Lanjutkan";
    btn.disabled = false;
  } else {
    text.textContent = "Nonaktif di halaman ini";
    btn.textContent = "Tidak aktif";
    btn.disabled = true;
  }
}

function queryState() {
  sendToTab({ type: "WCC_GET_STATE" }, (res) => {
    if (!res || !res.active) return setStateUI("off");
    setStateUI(res.paused ? "paused" : "active");
  });
}

function onToggle() {
  if (runMode === "active") {
    sendToTab({ type: "WCC_PAUSE" });
    setStateUI("paused");
  } else if (runMode === "paused") {
    sendToTab({ type: "WCC_RESUME" });
    setStateUI("active");
  }
}

// --- wiring -----------------------------------------------------------------

function bind() {
  const globalInputs = [
    "enabled",
    "activity",
    "reduceMotion",
    "readHeadings",
    "lookAtImages",
    "sitOnElements",
    "sleep",
  ];
  for (const id of globalInputs) {
    $(id).addEventListener("change", saveSettingsAndReload);
  }
  $("character").addEventListener("change", onCharacterChange);
  $("perTab").addEventListener("change", onPerTabChange);
  $("site-rule").addEventListener("change", (e) => saveSiteRule(e.target.value));
  $("toggle").addEventListener("click", onToggle);
}

document.addEventListener("DOMContentLoaded", async () => {
  await load();
  bind();
});
