/**
 * Global constants & namespace for the content scripts.
 *
 * MV3 content scripts (listed in the manifest) share one global scope per page
 * but do not support `import`. Each module attaches to this `window.__WCC`
 * namespace, so this file MUST be loaded first.
 */
(() => {
  "use strict";

  if (window.__WCC) return; // already initialized (e.g. injected twice)

  const WCC = {};

  // chrome.storage.sync keys
  WCC.STORAGE_KEYS = {
    SETTINGS: "wcc.settings",
    SITE_RULES: "wcc.siteRules",
  };

  // Default settings
  WCC.DEFAULT_SETTINGS = {
    enabled: true,
    character: "luna",
    activity: "medium", // low | medium | high
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

  // Keywords that auto-disable the companion for safety
  WCC.SENSITIVE_HINTS = [
    "login",
    "signin",
    "sign-in",
    "auth",
    "account",
    "bank",
    "payment",
    "checkout",
    "wallet",
    "password",
  ];

  // --- Sensitive field detection (see interaction.js's _isSensitiveField) ---
  //
  // Only attributes and visible label text are ever examined. A field's
  // value is never read, by this or anything else in the extension.

  // Standards-based and therefore the most reliable signal: these are the
  // same tokens browsers and password managers key off.
  WCC.SENSITIVE_AUTOCOMPLETE = [
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-name",
  ];

  // Matched against a field's own human-readable text: name, id, placeholder,
  // aria-label and its <label>. Prose tolerates broader wording than CSS
  // class names do, so this list can afford to be more generous.
  WCC.SENSITIVE_TEXT =
    /pass(word|wd|phrase)|\bpin\b|\botp\b|\bcvv\b|\bcvc\b|security code|card number|credit card|\bssn\b|social security|\biban\b|secret|token|verification code|one[-\s]?time[-\s]?code/i;

  // Matched against class and id on the field *and its ancestors*. Narrower
  // on purpose: bare UI words are everywhere in ordinary markup — Bootstrap's
  // `.card` alone would flag inputs on half the web — so only unambiguous
  // compounds belong here.
  WCC.SENSITIVE_MARKUP =
    /password|passwd|\bpwd\b|credit-?card|card-?number|cvv|cvc|one-?time-?code|\botp\b|\bssn\b|iban/i;

  // Semantic score per target type
  WCC.SEMANTIC_SCORE = {
    H1: 100,
    H2: 90,
    H3: 80,
    VIDEO: 90,
    IMG: 80,
    BUTTON: 70,
    A: 50,
    PRE: 45,
    CODE: 45,
    ARTICLE: 35,
    P: 30,
    INPUT: 10,
  };

  // Target type -> contextual action
  WCC.ACTION_BY_TYPE = {
    H1: "read",
    H2: "read",
    H3: "read",
    P: "read",
    ARTICLE: "read",
    IMG: "look",
    VIDEO: "watch",
    BUTTON: "sit",
    A: "sit",
    PRE: "look",
    CODE: "look",
    INPUT: "look",
  };

  // Behavior durations (ms) per activity level
  WCC.ACTIVITY_PROFILES = {
    low: { idleMin: 20000, idleMax: 45000, actionMin: 4000, actionMax: 8000 },
    medium: {
      idleMin: 10000,
      idleMax: 30000,
      actionMin: 3000,
      actionMax: 7000,
    },
    high: { idleMin: 5000, idleMax: 15000, actionMin: 2500, actionMax: 6000 },
  };

  // Movement & scoring tuning
  WCC.CONFIG = {
    minTargetSize: 20, // px, smaller elements are ignored
    walkSpeed: 220, // px per second
    recentTargetMemory: 6, // how many recent targets to remember for novelty
    recentPenalty: 60,
    randomFactorMax: 40,
    playingVideoBonus: 250, // dominates scoring while a video is playing (still weighted, not absolute)
    scrollCancelThreshold: 120, // px, target moved more than this mid-action -> cancel
    floorOffset: 1, // gap between the character and the visual floor (viewport bottom)
    topMargin: 6, // minimum gap between the character's head and the top/bottom bar
    maxBarInset: 0.05, // safety cap: a bar counts as at most this fraction of viewport height
    zIndex: 2147483000,
    positionSaveThrottleMs: 400, // how often the current position is persisted per tab while moving
    steepWalkAngleDeg: 40, // travel angle (from horizontal) above which "hop" replaces "walk"
    drowsyMin: 2000, // ms, the yawn/stretch beat that leads into the sleep loop
    drowsyMax: 4000,
    // A muted, looping, control-less clip no longer than this reads as
    // background decoration (hero/banner loops) rather than something a
    // person is watching. Set to 0 to treat every playing video as watchable.
    decorativeMaxDurationSec: 30,
    // How many ancestors above a focused field to inspect for sensitive
    // class/id markers — enough to reach a wrapping form group or fieldset
    // without climbing into page-level layout.
    sensitiveAncestorDepth: 5,
  };

  // State machine
  WCC.STATE = {
    IDLE: "IDLE",
    FIND_TARGET: "FIND_TARGET",
    MOVE_TO_TARGET: "MOVE_TO_TARGET",
    PERFORM_ACTION: "PERFORM_ACTION",
    WRITE: "WRITE",
    SNEAK: "SNEAK", // tiptoeing past a sensitive field instead of writing
    DROWSY: "DROWSY", // the brief yawn that leads into SLEEP
    SLEEP: "SLEEP",
  };

  WCC.log = (...args) => {
    if (window.__WCC_DEBUG) console.log("%c[WCC]", "color:#b23b3b", ...args);
  };

  WCC.rand = (min, max) => min + Math.random() * (max - min);
  WCC.randInt = (min, max) => Math.floor(WCC.rand(min, max + 1));
  WCC.clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  window.__WCC = WCC;
})();
