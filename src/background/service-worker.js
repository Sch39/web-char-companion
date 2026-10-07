import "../shared/alarm-schedule.js";

const ALARM = self.WCC_ALARM;

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
  await openRingChannel();
  await rescheduleAlarm();
});

// --- alarms -----------------------------------------------------------------

const ALARM_NAME = "wcc.nextAlarm";

// Ends a ring that nothing dismissed. A setTimeout cannot do this job: the
// worker is terminated while idle, which would drop the timer and leave the
// ring record behind to pop a stale bubble in the next tab to get focus.
const RING_END_ALARM = "wcc.ringEnd";

// Lands on the exact second after chrome.alarms wakes us a bit early. Only
// meaningful while this worker instance is alive, which is why the wake-up
// alarm — not this timer — is what the schedule actually rests on.
let fineTimer = null;

// storage.session is hidden from content scripts by default, and the ring
// record is how they hear about a firing alarm.
async function openRingChannel() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  } catch {
    // Older builds don't expose setAccessLevel; the ring then stays invisible
    // to content scripts and only the notification fallback can report it.
  }
}

async function readAlarms() {
  const data = await chrome.storage.sync.get(ALARM.ALARMS_KEY);
  return ALARM.normalize(data[ALARM.ALARMS_KEY]);
}

function clearFineTimer() {
  if (fineTimer) clearTimeout(fineTimer);
  fineTimer = null;
}

/**
 * Point the single wake-up alarm at whatever comes next. Called on startup and
 * whenever the list changes, because chrome.alarms persistence can't be relied
 * on across browsers and updates.
 */
async function rescheduleAlarm() {
  clearFineTimer();
  const cfg = await readAlarms();
  const next = ALARM.nextFire(cfg);
  if (!next) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }

  const lead = Math.max(0, next.when - ALARM.WAKE_LEAD_MS);
  await chrome.alarms.create(ALARM_NAME, {
    when: Math.max(Date.now() + 1000, lead),
    persistAcrossSessions: true,
  });

  // Already inside the lead window, so hold the exact moment in this instance.
  if (next.when - Date.now() <= ALARM.WAKE_LEAD_MS) armFineTimer(next.when);
}

function armFineTimer(when) {
  clearFineTimer();
  const delay = Math.max(0, when - Date.now());
  fineTimer = setTimeout(() => {
    fineTimer = null;
    fireDueAlarms();
  }, delay);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RING_END_ALARM) {
    endRing();
    return;
  }
  if (alarm.name !== ALARM_NAME) return;
  (async () => {
    const cfg = await readAlarms();
    const next = ALARM.nextFire(cfg);
    const now = Date.now();

    // Woken early on purpose: wait out the remaining seconds precisely.
    if (next && next.when > now) {
      if (next.when - now <= ALARM.WAKE_LEAD_MS + 5000) {
        armFineTimer(next.when);
        return;
      }
      await rescheduleAlarm();
      return;
    }
    await fireDueAlarms();
  })();
});

chrome.runtime.onStartup.addListener(async () => {
  await openRingChannel();
  await rescheduleAlarm();
});

// A change from any surface (popup, options) re-points the schedule.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[ALARM.ALARMS_KEY]) rescheduleAlarm();
});

async function fireDueAlarms() {
  const cfg = await readAlarms();
  const due = ALARM.dueItems(cfg);
  if (!due.length) {
    await rescheduleAlarm();
    return;
  }

  // Firing clears a snooze and retires a one-shot, so the list is rewritten
  // before the schedule is recomputed.
  const items = cfg.items.map((item) => {
    if (!due.some((d) => d.id === item.id)) return item;
    const updated = { ...item, snoozeUntil: 0 };
    if (item.repeat === "once") updated.on = false;
    return updated;
  });
  await chrome.storage.sync.set({ [ALARM.ALARMS_KEY]: { ...cfg, items } });

  const first = due[0];
  const ringId = `${Date.now()}-${first.id}`;
  await chrome.storage.session.set({
    [ALARM.RING_KEY]: {
      ringId,
      alarmId: first.id,
      label: first.label || "",
      time: first.time,
      sound: cfg.sound,
      firedAt: Date.now(),
      claimedBy: null,
    },
  });

  await startRingAudio(cfg.sound);

  // Announced right away: waiting to see whether some tab claims it first meant
  // an alarm could end up with no sound cue, no bubble and no notification.
  await notifyRing({
    ringId,
    label: first.label || "",
    time: first.time,
  });

  // Only a ringing sound needs a cutoff. A silent ring is just a pending
  // bubble, and those stay presentable until RING_EXPIRY_MS so returning to
  // the browser still shows the alarm you missed.
  if (cfg.sound?.on !== false) await scheduleRingTimeout();
  await rescheduleAlarm();
}

// --- sound ------------------------------------------------------------------

const OFFSCREEN_PATH = "src/offscreen/audio.html";

// A ring nobody ever dismisses stops on its own, so a browser left unattended
// doesn't loop the sound indefinitely. The offscreen document enforces the same
// deadline independently, because this worker can be terminated mid-ring.
const MAX_RING_MS = 60000;

// createDocument throws if one already exists, and two near-simultaneous rings
// would both try. A single in-flight promise serializes them.
let creatingOffscreen = null;

// Fallback for builds without chrome.runtime.getContexts: without it we cannot
// ask whether the document exists, and guessing "no" would make stop a no-op.
let offscreenOpen = false;

async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return offscreenOpen;
  try {
    const url = chrome.runtime.getURL(OFFSCREEN_PATH);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url],
    });
    return contexts.length > 0;
  } catch {
    return offscreenOpen;
  }
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return true;

  // Never let a rejected creation escape: the caller runs inside alarm
  // dispatch, and a throw there would skip rescheduling and strand the
  // whole alarm list.
  if (creatingOffscreen) {
    await creatingOffscreen.catch(() => {});
    return hasOffscreen();
  }
  try {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play the alarm sound when a scheduled alarm fires.",
    });
    await creatingOffscreen;
    offscreenOpen = true;
    return true;
  } catch {
    // Usually "a document already exists" after losing a race, in which case
    // one is open and usable.
    offscreenOpen = true;
    return hasOffscreen();
  } finally {
    creatingOffscreen = null;
  }
}

async function soundUrl() {
  try {
    const data = await chrome.storage.local.get(ALARM.SOUND_KEY);
    const custom = data[ALARM.SOUND_KEY];
    if (custom?.dataUrl) return custom.dataUrl;
  } catch {
    /* fall through to the bundled file */
  }
  return chrome.runtime.getURL("assets/sounds/alarm-default.wav");
}

async function startRingAudio(sound) {
  if (sound?.on === false) return;
  try {
    if (!(await ensureOffscreen())) return;
    await chrome.runtime.sendMessage({
      target: "wcc-offscreen",
      type: "WCC_AUDIO_PLAY",
      url: await soundUrl(),
      volume: typeof sound?.volume === "number" ? sound.volume : 0.7,
      maxMs: MAX_RING_MS,
    });
  } catch {
    // No sound this time; the bubble still shows, and the alarm schedule must
    // survive regardless.
  }
}

async function stopRingAudio() {
  // Closing the document is what actually stops the sound, so it is attempted
  // even when the existence check is unreliable or the message goes unheard.
  try {
    await chrome.runtime.sendMessage({
      target: "wcc-offscreen",
      type: "WCC_AUDIO_STOP",
    });
  } catch {
    /* nothing listening */
  }
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* already closed */
  }
  offscreenOpen = false;
}

async function scheduleRingTimeout() {
  // chrome.alarms has a 30s floor on some builds; MAX_RING_MS is 60s, so the
  // delay is expressible. `when` keeps it absolute across a worker restart.
  await chrome.alarms.create(RING_END_ALARM, { when: Date.now() + MAX_RING_MS });
}

/**
 * Stop the sound and drop the shared record so every tab hides its bubble.
 * `ringId` guards against a late dismiss from one tab killing a newer ring.
 */
async function endRing(ringId) {
  // The named ring's notification goes regardless: it is stale whether or not
  // that ring is still the current one.
  if (ringId) clearRingNotification(ringId);

  const data = await chrome.storage.session.get(ALARM.RING_KEY);
  const current = data[ALARM.RING_KEY];
  if (ringId && current && current.ringId !== ringId) return;
  if (current?.ringId) clearRingNotification(current.ringId);

  await chrome.alarms.clear(RING_END_ALARM);
  await stopRingAudio();
  await chrome.storage.session.remove(ALARM.RING_KEY);
}

// The notification carries the ring id so a click can act on the right alarm
// even after this worker has been restarted.
const NOTIFICATION_PREFIX = "wcc-ring-";

/**
 * Announce a ring through the OS. This is the primary channel, not a fallback:
 * the character's bubble only exists in tabs where the companion is running and
 * which are focused, so an alarm that fires while the browser sits behind an
 * editor would otherwise be silent and invisible.
 */
async function notifyRing(ring) {
  try {
    const allowed = await chrome.permissions.contains({
      permissions: ["notifications"],
    });
    if (!allowed) return;

    const opts = {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: ring.label || "Alarm",
      message: ALARM.formatTime(ring.time),
      // Stay up until acted on, so an alarm isn't missed by being away.
      requireInteraction: true,
      buttons: [{ title: "Snooze 5m" }, { title: "Dismiss" }],
    };

    try {
      await chrome.notifications.create(NOTIFICATION_PREFIX + ring.ringId, opts);
    } catch {
      // Buttons and requireInteraction aren't supported everywhere; a plain
      // notification is still better than none.
      delete opts.buttons;
      delete opts.requireInteraction;
      await chrome.notifications.create(
        NOTIFICATION_PREFIX + ring.ringId,
        opts,
      );
    }
  } catch {
    // Notifications unavailable or declined; the sound and any visible tab's
    // bubble still report the alarm.
  }
}

function clearRingNotification(ringId) {
  if (!chrome.notifications?.clear) return;
  try {
    chrome.notifications.clear(NOTIFICATION_PREFIX + ringId);
  } catch {
    /* nothing to clear */
  }
}

function ringIdFromNotification(id) {
  return id?.startsWith(NOTIFICATION_PREFIX)
    ? id.slice(NOTIFICATION_PREFIX.length)
    : null;
}

async function snoozeAlarm(alarmId, ringId) {
  const cfg = await readAlarms();
  const items = cfg.items.map((item) =>
    item.id === alarmId
      ? { ...item, on: true, snoozeUntil: Date.now() + ALARM.SNOOZE_MS }
      : item,
  );
  await chrome.storage.sync.set({ [ALARM.ALARMS_KEY]: { ...cfg, items } });
  await endRing(ringId);
  await rescheduleAlarm();
}

/** Look up which alarm a ring belongs to, for notification clicks. */
async function alarmIdForRing(ringId) {
  const data = await chrome.storage.session.get(ALARM.RING_KEY);
  const ring = data[ALARM.RING_KEY];
  return ring && ring.ringId === ringId ? ring.alarmId : null;
}

if (chrome.notifications?.onButtonClicked) {
  chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
    const ringId = ringIdFromNotification(notifId);
    if (!ringId) return;
    (async () => {
      // requireInteraction keeps a notification up after its ring already
      // ended, so a click can arrive for an alarm that is long over. Snoozing
      // then would resurrect it; just clear the stale notification instead.
      const alarmId = await alarmIdForRing(ringId);
      if (!alarmId) {
        clearRingNotification(ringId);
        return;
      }
      if (buttonIndex === 0) await snoozeAlarm(alarmId, ringId);
      else await endRing(ringId);
    })();
  });
}

if (chrome.notifications?.onClicked) {
  // Clicking the body just acknowledges it.
  chrome.notifications.onClicked.addListener((notifId) => {
    const ringId = ringIdFromNotification(notifId);
    if (!ringId) return;
    // Clears the notification whether or not the ring is still live.
    clearRingNotification(ringId);
    endRing(ringId);
  });
}

// Per-tab characters and positions live in storage.session (cleared when the
// browser closes). Content scripts can't access storage.session directly,
// and don't know their own tab id either — they go through here, using
// sender.tab.id to know which tab is asking.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Audio messages are broadcast, so they land here too. They belong to the
  // offscreen document.
  if (msg?.target === "wcc-offscreen") return;

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

  // First tab to ask gets the ring; everyone else is told no. Doing this here
  // keeps it serial — two visible windows can't both start ringing.
  if (msg?.type === "WCC_CLAIM_RING") {
    const tabId = sender.tab?.id;
    chrome.storage.session.get(ALARM.RING_KEY, (data) => {
      const ring = data[ALARM.RING_KEY];
      if (!ring || ring.ringId !== msg.ringId) {
        sendResponse({ granted: false });
        return;
      }
      if (ring.claimedBy != null && ring.claimedBy !== tabId) {
        sendResponse({ granted: false });
        return;
      }
      if (Date.now() - ring.firedAt > ALARM.RING_EXPIRY_MS) {
        sendResponse({ granted: false });
        return;
      }
      chrome.storage.session.set(
        { [ALARM.RING_KEY]: { ...ring, claimedBy: tabId ?? -1 } },
        () => sendResponse({ granted: true }),
      );
    });
    return true; // async
  }

  // Snooze re-arms the same entry a few minutes out and drops the ring so no
  // other tab picks it up.
  if (msg?.type === "WCC_SNOOZE_ALARM") {
    snoozeAlarm(msg.alarmId, msg.ringId).then(() => sendResponse({ ok: true }));
    return true; // async
  }

  // A tab that claimed a ring but then lost focus hands it back, so the next
  // tab the user looks at can pick the bubble up instead of the ring staying
  // owned by a window nobody is watching.
  if (msg?.type === "WCC_RELEASE_RING") {
    const tabId = sender.tab?.id;
    chrome.storage.session.get(ALARM.RING_KEY, (data) => {
      const ring = data[ALARM.RING_KEY];
      if (!ring || ring.ringId !== msg.ringId || ring.claimedBy !== tabId) {
        sendResponse?.({ ok: false });
        return;
      }
      chrome.storage.session.set(
        { [ALARM.RING_KEY]: { ...ring, claimedBy: null } },
        () => sendResponse?.({ ok: true }),
      );
    });
    return true; // async
  }

  // A tab is showing the bubble for this ring, so the tray copy is noise.
  if (msg?.type === "WCC_NOTIFICATION_SEEN") {
    if (msg.ringId) clearRingNotification(msg.ringId);
    sendResponse?.({ ok: true });
    return false;
  }

  if (msg?.type === "WCC_DISMISS_ALARM") {
    endRing(msg.ringId).then(() => sendResponse({ ok: true }));
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
  // A ring owned by a tab that no longer exists would never be shown again.
  const ringData = await chrome.storage.session.get(ALARM.RING_KEY);
  const ring = ringData[ALARM.RING_KEY];
  if (ring && ring.claimedBy === tabId) {
    await chrome.storage.session.set({
      [ALARM.RING_KEY]: { ...ring, claimedBy: null },
    });
  }

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
