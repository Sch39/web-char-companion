const STORAGE_KEYS = {
  SETTINGS: "wcc.settings",
  SITE_RULES: "wcc.siteRules",
  TAB_CHARS: "wcc.tabChars",
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

// Initial list shown when the user hasn't customized it yet.
const DEFAULT_SENSITIVE = [
  "login", "signin", "sign-in", "auth", "account",
  "bank", "payment", "checkout", "wallet", "password",
];

function parseHints(text) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const $ = (id) => document.getElementById(id);

let activeTabId = null;
let currentHost = null;
let globalChar = DEFAULT_SETTINGS.character;
let runMode = "off"; // off | active | paused
let alarmCfg = null; // kept out of wcc.settings on purpose, see saveAlarms()
let previewAudio = null;

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

async function getCustomChars() {
  const data = await chrome.storage.local.get("wcc.customChars");
  return data["wcc.customChars"] || {};
}

async function populateCharacters(customs, selectedId) {
  const sel = $("character");
  sel.innerHTML = "";
  for (const { id, label } of await window.WCC_characterOptions(customs)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = selectedId;
  // the saved character may no longer exist (assets moved, import deleted) —
  // fall back to whatever is actually available so the picker can't show a
  // selection the loader won't honor
  if (!sel.value && sel.options.length) sel.selectedIndex = 0;
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
  // modules rebuild asynchronously; read state after they've had time to start
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
  const customs = await getCustomChars();

  $("enabled").checked = settings.enabled;
  $("activity").value = settings.activity;
  $("reduceMotion").checked = settings.reduceMotion;
  $("readHeadings").checked = settings.behaviors.readHeadings;
  $("lookAtImages").checked = settings.behaviors.lookAtImages;
  $("sitOnElements").checked = settings.behaviors.sitOnElements;
  $("sleep").checked = settings.behaviors.sleep;
  $("reactToInput").checked = settings.behaviors.reactToInput !== false;
  $("watchFilm").checked = settings.behaviors.watchFilm !== false;
  $("reactToDrag").checked = settings.behaviors.reactToDrag !== false;
  $("reactToSensitive").checked = settings.behaviors.reactToSensitive !== false;

  const hints = Array.isArray(settings.sensitiveHints)
    ? settings.sensitiveHints
    : DEFAULT_SENSITIVE;
  $("sensitiveHints").value = hints.join("\n");

  $("perTab").checked = !!override;
  await populateCharacters(customs, override || globalChar);

  $("site-host").textContent = currentHost || "this page";
  $("site-rule").value =
    currentHost && siteRules[currentHost] ? siteRules[currentHost] : "default";

  queryState();
}

function collectSettings() {
  return {
    enabled: $("enabled").checked,
    character: globalChar, // global character isn't changed by the per-tab choice
    activity: $("activity").value,
    reduceMotion: $("reduceMotion").checked,
    behaviors: {
      reactToPage: true,
      readHeadings: $("readHeadings").checked,
      lookAtImages: $("lookAtImages").checked,
      sitOnElements: $("sitOnElements").checked,
      sleep: $("sleep").checked,
      reactToInput: $("reactToInput").checked,
      watchFilm: $("watchFilm").checked,
      reactToDrag: $("reactToDrag").checked,
      reactToSensitive: $("reactToSensitive").checked,
    },
    sensitiveHints: parseHints($("sensitiveHints").value),
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
    await setTabChar(activeTabId, null); // follow the global character again
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
    text.textContent = "Active";
    btn.textContent = "Pause";
    btn.disabled = false;
  } else if (mode === "paused") {
    text.textContent = "Paused";
    btn.textContent = "Resume";
    btn.disabled = false;
  } else {
    text.textContent = "Inactive on this page";
    btn.textContent = "Inactive";
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

// --- alarms -----------------------------------------------------------------
//
// Alarm data lives under its own storage key rather than inside wcc.settings,
// because collectSettings() rebuilds that object from the form fields and would
// drop anything without a matching input.

const ALARM = window.WCC_ALARM;

async function loadAlarms() {
  const data = await chrome.storage.sync.get(ALARM.ALARMS_KEY);
  alarmCfg = ALARM.normalize(data[ALARM.ALARMS_KEY]);
  const sound = await chrome.storage.local.get(ALARM.SOUND_KEY);
  const custom = sound[ALARM.SOUND_KEY];
  $("alarmSoundName").textContent = custom && custom.name
    ? custom.name
    : "Default (bundled)";
}

async function saveAlarms() {
  await chrome.storage.sync.set({ [ALARM.ALARMS_KEY]: alarmCfg });
  renderAlarmHint();
}

function renderAlarms() {
  const list = $("alarmList");
  list.textContent = "";
  for (const item of alarmCfg.items) {
    list.appendChild(buildAlarmRow(item));
  }
  $("alarmEnabled").checked = alarmCfg.enabled;
  $("alarmSoundOn").checked = alarmCfg.sound.on;
  $("alarmVolume").value = Math.round(alarmCfg.sound.volume * 100);
  renderAlarmHint();
}

function renderAlarmHint() {
  const next = ALARM.nextFire(alarmCfg);
  if (!alarmCfg.enabled || !next) {
    $("alarmHint").textContent = "";
    $("alarmNotifyWarn").hidden = true;
    return;
  }
  const mins = Math.max(0, Math.round((next.when - Date.now()) / 60000));
  const rel = mins < 1 ? "under a minute" : mins < 60 ? mins + " min" : null;
  $("alarmHint").textContent = rel
    ? "Next: " + ALARM.formatTime(next.item.time) + " (in " + rel + ")."
    : "Next: " + ALARM.formatTime(next.item.time) + ".";
  renderNotifyWarning();
}

// Without notification access an alarm firing while the browser is in the
// background has no way to reach the user, so say so rather than letting it
// fail quietly.
function renderNotifyWarning() {
  const warn = $("alarmNotifyWarn");
  if (!warn) return;
  try {
    chrome.permissions.contains({ permissions: ["notifications"] }, (has) => {
      warn.hidden = !!has || !alarmCfg.enabled;
    });
  } catch {
    warn.hidden = true;
  }
}

async function onNotifyWarnClick() {
  try {
    chrome.permissions.request({ permissions: ["notifications"] }, () => {
      void chrome.runtime.lastError;
      renderNotifyWarning();
    });
  } catch {
    /* permissions API unavailable */
  }
}

function buildAlarmRow(item) {
  const row = document.createElement("div");
  row.className = "alarm-row" + (item.on ? "" : " off");

  const on = document.createElement("input");
  on.type = "checkbox";
  on.checked = item.on;
  on.title = "Enable this alarm";
  on.addEventListener("change", () => {
    item.on = on.checked;
    item.snoozeUntil = 0;
    row.classList.toggle("off", !item.on);
    saveAlarms();
  });

  // step=1 makes the browser expose a seconds field, which these times use.
  const time = document.createElement("input");
  time.type = "time";
  time.step = "1";
  time.value = item.time;
  time.addEventListener("change", () => {
    const normalized = ALARM.normalizeTime(time.value);
    if (!normalized) {
      time.value = item.time;
      return;
    }
    item.time = normalized;
    item.snoozeUntil = 0;
    saveAlarms();
  });

  const repeat = document.createElement("select");
  const options = [["daily", "Daily"], ["once", "Once"]];
  for (const pair of options) {
    const opt = document.createElement("option");
    opt.value = pair[0];
    opt.textContent = pair[1];
    repeat.appendChild(opt);
  }
  repeat.value = item.repeat;
  repeat.addEventListener("change", () => {
    item.repeat = repeat.value;
    saveAlarms();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "\u00d7";
  remove.title = "Remove";
  remove.addEventListener("click", () => {
    alarmCfg.items = alarmCfg.items.filter((it) => it.id !== item.id);
    renderAlarms();
    saveAlarms();
  });

  const labelWrap = document.createElement("div");
  labelWrap.className = "alarm-row-label";
  const label = document.createElement("input");
  label.type = "text";
  label.placeholder = "Label (optional)";
  label.maxLength = 60;
  label.value = item.label;
  label.addEventListener("change", () => {
    item.label = label.value.trim();
    saveAlarms();
  });
  labelWrap.appendChild(label);

  row.append(on, time, repeat, remove, labelWrap);
  return row;
}

function onAlarmAdd() {
  // Seed a minute ahead so a freshly added row isn't already in the past.
  const d = new Date(Date.now() + 60000);
  const pad = (n) => String(n).padStart(2, "0");
  alarmCfg.items.push({
    id: ALARM.newId(),
    time: pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":00",
    label: "",
    repeat: "daily",
    on: true,
    snoozeUntil: 0,
  });
  renderAlarms();
  saveAlarms();
}

async function onAlarmMasterChange() {
  alarmCfg.enabled = $("alarmEnabled").checked;
  // The OS notification is only a fallback for when no tab can show the
  // bubble, so the permission is asked for here rather than at install time.
  if (alarmCfg.enabled) requestNotificationPermission();
  await saveAlarms();
}

function requestNotificationPermission() {
  try {
    chrome.permissions.contains({ permissions: ["notifications"] }, (has) => {
      if (has) return;
      chrome.permissions.request({ permissions: ["notifications"] }, () => {
        // Declining is fine: a visible tab still shows the bubble.
        void chrome.runtime.lastError;
      });
    });
  } catch {
    /* permissions API unavailable */
  }
}

async function onAlarmSoundChange() {
  alarmCfg.sound.on = $("alarmSoundOn").checked;
  alarmCfg.sound.volume = Number($("alarmVolume").value) / 100;
  await saveAlarms();
}

async function onAlarmPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
    return;
  }
  const data = await chrome.storage.local.get(ALARM.SOUND_KEY);
  const custom = data[ALARM.SOUND_KEY];
  const url =
    (custom && custom.dataUrl) ||
    chrome.runtime.getURL("assets/sounds/alarm-default.wav");
  const audio = new Audio(url);
  audio.volume = Number($("alarmVolume").value) / 100;
  previewAudio = audio;
  audio.addEventListener("ended", () => {
    previewAudio = null;
  });
  try {
    await audio.play();
  } catch {
    previewAudio = null;
    $("alarmHint").textContent = "Could not play the sound file.";
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
    "reactToInput",
    "watchFilm",
    "reactToDrag",
    "reactToSensitive",
    "sensitiveHints",
  ];
  for (const id of globalInputs) {
    $(id).addEventListener("change", saveSettingsAndReload);
  }
  $("alarmEnabled").addEventListener("change", onAlarmMasterChange);
  $("alarmAdd").addEventListener("click", onAlarmAdd);
  $("alarmSoundOn").addEventListener("change", onAlarmSoundChange);
  $("alarmVolume").addEventListener("change", onAlarmSoundChange);
  $("alarmPreview").addEventListener("click", onAlarmPreview);
  $("alarmNotifyWarn").addEventListener("click", onNotifyWarnClick);
  $("alarmSoundManage").addEventListener("click", () =>
    chrome.runtime.openOptionsPage(),
  );
  $("character").addEventListener("change", onCharacterChange);
  $("perTab").addEventListener("change", onPerTabChange);
  $("site-rule").addEventListener("change", (e) => saveSiteRule(e.target.value));
  $("toggle").addEventListener("click", onToggle);
  $("manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

document.addEventListener("DOMContentLoaded", async () => {
  await load();
  await loadAlarms();
  renderAlarms();
  bind();
});
