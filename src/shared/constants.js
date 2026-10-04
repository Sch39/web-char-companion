/**
 * Konstanta & namespace global untuk content scripts.
 *
 * Content script MV3 (yang di-list di manifest) berbagi satu global scope per
 * halaman, tetapi tidak mendukung `import`. Jadi tiap modul menempel ke
 * namespace `window.__WCC` ini. File ini HARUS dimuat paling awal.
 */
(() => {
  "use strict";

  if (window.__WCC) return; // sudah di-init (mis. di-inject dua kali)

  const WCC = {};

  // Kunci penyimpanan chrome.storage.sync
  WCC.STORAGE_KEYS = {
    SETTINGS: "wcc.settings",
    SITE_RULES: "wcc.siteRules",
  };

  // Pengaturan default
  WCC.DEFAULT_SETTINGS = {
    enabled: true,
    character: "hutao",
    activity: "medium", // low | medium | high
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

  // Domain yang otomatis di-disable demi keamanan
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

  // Skor semantik per tipe target
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

  // Pemetaan tipe target -> action kontekstual
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

  // Durasi perilaku (ms) per level aktivitas
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

  // Tuning gerak & penilaian
  WCC.CONFIG = {
    minTargetSize: 20, // px, elemen lebih kecil diabaikan
    walkSpeed: 220, // px per detik
    recentTargetMemory: 6, // berapa target terakhir diingat untuk novelty
    recentPenalty: 60,
    randomFactorMax: 40,
    scrollCancelThreshold: 120, // px, target bergeser > ini saat beraksi -> batalkan
    floorOffset: 1, // jarak karakter dari "lantai" visual (tepi bawah viewport)
    topMargin: 6, // jarak minimum kepala karakter dari batas atas / bawah bar
    maxBarInset: 0.05, // batas aman: bar dianggap maks 40% tinggi viewport
    zIndex: 2147483000,
  };

  // State machine
  WCC.STATE = {
    IDLE: "IDLE",
    FIND_TARGET: "FIND_TARGET",
    MOVE_TO_TARGET: "MOVE_TO_TARGET",
    PERFORM_ACTION: "PERFORM_ACTION",
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
