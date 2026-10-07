/**
 * Alarm list helpers, shared by the popup, the service worker and the content
 * scripts. Loaded as a plain script in every context, so it defines its helpers
 * on `self` rather than using exports.
 */
(() => {
  "use strict";

  if (self.WCC_ALARM) return;

  const ALARMS_KEY = "wcc.alarms";
  const SOUND_KEY = "wcc.alarmSound";
  const RING_KEY = "wcc.alarmRing";

  const DEFAULT_ALARMS = {
    enabled: true,
    sound: { on: true, volume: 0.7 },
    items: [],
  };

  // A ring older than this is stale: showing it would mean a bubble popping up
  // long after the moment it was about to announce.
  const RING_EXPIRY_MS = 10 * 60 * 1000;

  const SNOOZE_MS = 5 * 60 * 1000;

  // chrome.alarms is coarse: at most once per 30s, and the docs allow an
  // arbitrary extra delay. Times here are second-precision, so the alarm is
  // only used to wake the worker a little early; a short timer lands on the
  // exact second.
  const WAKE_LEAD_MS = 20000;

  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

  /** Parse "HH:MM" or "HH:MM:SS" into components, or null when malformed. */
  function parseTime(value) {
    const m = TIME_RE.exec(String(value || "").trim());
    if (!m) return null;
    return { h: +m[1], m: +m[2], s: m[3] ? +m[3] : 0 };
  }

  function normalizeTime(value) {
    const t = parseTime(value);
    if (!t) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`;
  }

  /** Display form: drop the seconds when they carry no information. */
  function formatTime(value) {
    const t = parseTime(value);
    if (!t) return String(value || "");
    const pad = (n) => String(n).padStart(2, "0");
    return t.s
      ? `${pad(t.h)}:${pad(t.m)}:${pad(t.s)}`
      : `${pad(t.h)}:${pad(t.m)}`;
  }

  function normalize(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const sound = base.sound && typeof base.sound === "object" ? base.sound : {};
    const items = Array.isArray(base.items) ? base.items : [];
    return {
      enabled: base.enabled !== false,
      sound: {
        on: sound.on !== false,
        volume:
          typeof sound.volume === "number" && sound.volume >= 0 && sound.volume <= 1
            ? sound.volume
            : DEFAULT_ALARMS.sound.volume,
      },
      items: items
        .map((it) => {
          const time = normalizeTime(it?.time);
          if (!time) return null;
          return {
            id: typeof it.id === "string" && it.id ? it.id : newId(),
            time,
            label: typeof it.label === "string" ? it.label.slice(0, 60) : "",
            repeat: it.repeat === "once" ? "once" : "daily",
            on: it.on !== false,
            // Set while snoozed; overrides `time` for the next fire only.
            snoozeUntil: typeof it.snoozeUntil === "number" ? it.snoozeUntil : 0,
          };
        })
        .filter(Boolean),
    };
  }

  function newId() {
    return "a" + Math.random().toString(36).slice(2, 9);
  }

  /**
   * When should `item` next go off, as an epoch ms, or null if never.
   * `once` entries that already passed today are done — they don't roll over to
   * tomorrow, otherwise "once" would mean "once a day".
   */
  function nextFireFor(item, now = Date.now()) {
    if (!item || item.on === false) return null;
    if (item.snoozeUntil && item.snoozeUntil > now) return item.snoozeUntil;

    const t = parseTime(item.time);
    if (!t) return null;

    const d = new Date(now);
    d.setHours(t.h, t.m, t.s, 0);
    let when = d.getTime();

    if (when <= now) {
      if (item.repeat === "once") return null;
      // Re-derive via setDate so DST shifts keep the wall-clock time intact.
      const next = new Date(when);
      next.setDate(next.getDate() + 1);
      next.setHours(t.h, t.m, t.s, 0);
      when = next.getTime();
    }
    return when;
  }

  /** The soonest upcoming alarm across the list: {item, when} or null. */
  function nextFire(config, now = Date.now()) {
    const cfg = normalize(config);
    if (!cfg.enabled) return null;
    let best = null;
    for (const item of cfg.items) {
      const when = nextFireFor(item, now);
      if (when == null) continue;
      if (!best || when < best.when) best = { item, when };
    }
    return best;
  }

  /**
   * Which alarms are due at `now`. Normally one, but a shared time or a late
   * wake-up can make it several, and dropping the extras would silently lose an
   * alarm the user set.
   *
   * Asking nextFireFor() about a moment that has already passed would roll the
   * answer forward to tomorrow, so the due window is measured from slightly
   * before `now` instead.
   */
  function dueItems(config, now = Date.now(), toleranceMs = 30000) {
    const cfg = normalize(config);
    if (!cfg.enabled) return [];
    const from = now - toleranceMs;
    return cfg.items.filter((item) => {
      const when = nextFireFor(item, from);
      return when != null && when <= now + toleranceMs;
    });
  }

  self.WCC_ALARM = {
    ALARMS_KEY,
    SOUND_KEY,
    RING_KEY,
    DEFAULT_ALARMS,
    RING_EXPIRY_MS,
    SNOOZE_MS,
    WAKE_LEAD_MS,
    parseTime,
    normalizeTime,
    formatTime,
    normalize,
    newId,
    nextFireFor,
    nextFire,
    dueItems,
  };
})();
