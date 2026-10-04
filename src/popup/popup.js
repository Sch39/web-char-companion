/**
 * Popup UI logic.
 *
 * Membaca & menyimpan settings di chrome.storage.sync, mengatur site rule
 * per-domain, dan mengirim perintah (pause/resume/reload) ke content script
 * tab aktif lewat service worker relay.
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

const $ = (id) => document.getElementById(id);
let currentHost = null;

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

async function load() {
  const data = await chrome.storage.sync.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.SITE_RULES,
  ]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data[STORAGE_KEYS.SETTINGS] || {}),
  };
  settings.behaviors = {
    ...DEFAULT_SETTINGS.behaviors,
    ...(data[STORAGE_KEYS.SETTINGS]?.behaviors || {}),
  };
  const siteRules = data[STORAGE_KEYS.SITE_RULES] || {};

  $("enabled").checked = settings.enabled;
  $("character").value = settings.character;
  $("activity").value = settings.activity;
  $("sound").checked = settings.sound;
  $("reduceMotion").checked = settings.reduceMotion;
  $("readHeadings").checked = settings.behaviors.readHeadings;
  $("lookAtImages").checked = settings.behaviors.lookAtImages;
  $("sitOnElements").checked = settings.behaviors.sitOnElements;
  $("sleep").checked = settings.behaviors.sleep;

  const tab = await getActiveTab();
  currentHost = hostFromUrl(tab?.url);
  $("site-host").textContent = currentHost || "halaman ini";
  $("site-rule").value = currentHost && siteRules[currentHost] ? siteRules[currentHost] : "default";
}

function collectSettings() {
  return {
    enabled: $("enabled").checked,
    character: $("character").value,
    activity: $("activity").value,
    sound: $("sound").checked,
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

function relay(payload) {
  chrome.runtime.sendMessage({ type: "WCC_RELAY", payload }, () => void chrome.runtime.lastError);
}

async function saveAndReload() {
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: collectSettings() });
  relay({ type: "WCC_SETTINGS_CHANGED" });
}

async function saveSiteRule(value) {
  if (!currentHost) return;
  const data = await chrome.storage.sync.get([STORAGE_KEYS.SITE_RULES]);
  const rules = data[STORAGE_KEYS.SITE_RULES] || {};
  if (value === "default") delete rules[currentHost];
  else rules[currentHost] = value;
  await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: rules });
  relay({ type: "WCC_SETTINGS_CHANGED" });
}

function bind() {
  const settingInputs = [
    "enabled", "character", "activity", "sound", "reduceMotion",
    "readHeadings", "lookAtImages", "sitOnElements", "sleep",
  ];
  for (const id of settingInputs) {
    $(id).addEventListener("change", saveAndReload);
  }
  $("site-rule").addEventListener("change", (e) => saveSiteRule(e.target.value));
  $("pause").addEventListener("click", () => relay({ type: "WCC_PAUSE" }));
  $("resume").addEventListener("click", () => relay({ type: "WCC_RESUME" }));
}

document.addEventListener("DOMContentLoaded", async () => {
  await load();
  bind();
});
