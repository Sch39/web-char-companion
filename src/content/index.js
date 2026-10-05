/**
 * Content script bootstrap.
 *
 * Reads settings + site rules, decides whether the companion may appear, then
 * wires up Renderer + Scanner + Selector + Movement + Behavior + Interaction.
 * Listens for popup messages to pause/hide/reload-settings.
 *
 * Also re-evaluates on in-page (SPA) navigation: many sites change the URL via
 * history.pushState without reloading the document, so the companion must
 * re-decide enabled/disabled instead of staying stuck from the first page.
 */
(async () => {
  "use strict";
  const WCC = window.__WCC;
  if (window.__WCC_BOOTED) return;
  window.__WCC_BOOTED = true;

  const app = { settings: null, modules: null };
  let bootSeq = 0; // guards against overlapping async boots
  let currentHref = location.href;

  const getSettings = () => app.settings;

  // Same leading+trailing throttle shape used in dom-scanner.js/interaction.js.
  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    const wrapped = (...args) => {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn(...args);
        }, remaining);
      }
    };
    wrapped.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return wrapped;
  }

  function savePositionNow(renderer) {
    if (!renderer?.pos) return;
    chrome.runtime.sendMessage(
      { type: "WCC_SAVE_POSITION", x: renderer.pos.x, y: renderer.pos.y },
      () => void chrome.runtime.lastError,
    );
  }

  // This tab's last known position (if any). Restored on boot so a hard
  // refresh or navigation resumes roughly where the character was instead of
  // respawning at the default spot.
  async function getSavedPosition() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "WCC_GET_POSITION" });
      return res?.position || null;
    } catch {
      return null;
    }
  }

  async function loadStorage() {
    const { SETTINGS, SITE_RULES } = WCC.STORAGE_KEYS;
    const data = await chrome.storage.sync.get([SETTINGS, SITE_RULES]);
    const settings = { ...WCC.DEFAULT_SETTINGS, ...(data[SETTINGS] || {}) };
    settings.behaviors = {
      ...WCC.DEFAULT_SETTINGS.behaviors,
      ...(data[SETTINGS]?.behaviors || {}),
    };
    const siteRules = data[SITE_RULES] || {};
    return { settings, siteRules };
  }

  function isSensitivePage() {
    const hay = (location.hostname + location.pathname).toLowerCase();
    const list = Array.isArray(app.settings?.sensitiveHints)
      ? app.settings.sensitiveHints
      : WCC.SENSITIVE_HINTS;
    return list.some((h) => h && hay.includes(h));
  }

  function siteAllowed(siteRules) {
    const rule = siteRules[location.hostname];
    if (rule === "off") return false;
    if (rule === "on") return true;
    // default: auto-disable on sensitive pages
    return !isSensitivePage();
  }

  // This tab may have its own character (stored per-tab in the background).
  // If it doesn't, fall back to the global character.
  async function resolveCharacter(globalChar) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "WCC_RESOLVE_CHARACTER",
      });
      return res?.character || globalChar || "luna";
    } catch {
      return globalChar || "luna";
    }
  }

  async function boot() {
    const seq = ++bootSeq;
    const { settings, siteRules } = await loadStorage();
    if (seq !== bootSeq) return; // superseded by a newer boot
    app.settings = settings;

    if (!settings.enabled || !siteAllowed(siteRules)) {
      WCC.log("companion disabled for this page");
      return;
    }

    const id = await resolveCharacter(settings.character);
    if (seq !== bootSeq) return;

    let data;
    try {
      data = await WCC.loadCharacterData(id);
    } catch {
      // selected character missing (e.g. a deleted import) -> use the default
      try {
        data = await WCC.loadCharacterData("luna");
      } catch (e) {
        console.error("[WCC] no character available:", e);
        return;
      }
    }
    if (seq !== bootSeq) return;

    const renderer = new WCC.Renderer();
    try {
      await renderer.init(data);
    } catch (e) {
      console.error("[WCC] renderer init failed:", e);
      return;
    }
    if (seq !== bootSeq) {
      renderer.destroy(); // navigation happened during init; discard this one
      return;
    }

    // Resume from this tab's last known position, if we have one.
    const savedPos = await getSavedPosition();
    if (seq !== bootSeq) {
      renderer.destroy();
      return;
    }
    if (savedPos) {
      const c = renderer.clampFoot(savedPos.x, savedPos.y);
      renderer.setPosition(c.x, c.y);
    }
    const savePosition = throttle(
      () => savePositionNow(renderer),
      WCC.CONFIG.positionSaveThrottleMs,
    );
    renderer.onMove = savePosition;

    const videoWatcher = new WCC.VideoWatcher();
    const scanner = new WCC.DomScanner();
    // Detected fixed/sticky bars -> constrain the character's movement area.
    scanner.onInsets = (insets) =>
      renderer.setInsets(insets.top, insets.bottom);
    const selector = new WCC.TargetSelector();
    const movement = new WCC.MovementEngine(renderer);
    const behavior = new WCC.BehaviorEngine({
      renderer,
      scanner,
      selector,
      movement,
      getSettings,
    });
    const interaction = new WCC.Interaction({ renderer, movement, behavior });

    videoWatcher.start();
    scanner.start();
    interaction.start();
    behavior.start();

    // Respect prefers-reduced-motion
    if (
      settings.reduceMotion ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      behavior.pause();
      renderer.play("idle");
    }

    app.modules = {
      renderer,
      videoWatcher,
      scanner,
      selector,
      movement,
      behavior,
      interaction,
      savePosition,
    };
    WCC.log("companion active on", location.hostname);
  }

  function teardown() {
    const m = app.modules;
    if (!m) return;
    // Flush the latest position immediately rather than waiting on the
    // throttle, so an SPA navigation doesn't lose a few hundred ms of motion.
    m.savePosition?.cancel?.();
    savePositionNow(m.renderer);
    m.behavior.stop();
    m.scanner.stop();
    m.videoWatcher.stop();
    m.interaction.stop();
    m.renderer.destroy();
    app.modules = null;
  }

  // Rebuild from scratch (re-reads settings & re-checks the current URL).
  function reevaluate() {
    teardown();
    boot();
  }

  // --- SPA / in-page navigation -------------------------------------------
  // pushState happens in the page's own JS world, which this isolated content
  // script can't hook, so a lightweight href poll backs up the real events.
  function onLocationChange() {
    if (location.href === currentHref) return;
    currentHref = location.href;
    WCC.log("navigation ->", location.href);
    reevaluate();
  }

  window.addEventListener("popstate", onLocationChange);
  window.addEventListener("hashchange", onLocationChange);
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) reevaluate(); // restored from bfcache; content didn't re-run
  });
  setInterval(onLocationChange, 1000);

  // Best-effort final save before an actual page unload (hard refresh, or
  // navigating away entirely) — teardown() only runs for in-page navigation,
  // so this is the one chance to catch a position reached in the last
  // moments before the whole document (and this script) is torn down.
  window.addEventListener("pagehide", () => {
    savePositionNow(app.modules?.renderer);
  });

  // Messages from the popup / service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const m = app.modules;
    switch (msg?.type) {
      case "WCC_PAUSE":
        m?.behavior.pause();
        break;
      case "WCC_RESUME":
        m?.behavior.resume();
        break;
      case "WCC_HIDE":
        m?.renderer.setVisible(false);
        m?.behavior.pause();
        break;
      case "WCC_SHOW":
        m?.renderer.setVisible(true);
        m?.behavior.resume();
        break;
      case "WCC_SETTINGS_CHANGED":
        // full reload so enabled/character/site-rule changes take effect
        reevaluate();
        break;
      case "WCC_GET_STATE":
        sendResponse({ active: !!m, paused: m ? !!m.behavior.paused : false });
        return true;
      case "WCC_PING":
        sendResponse({ active: !!m });
        return true;
    }
    sendResponse?.({ ok: true });
    return true;
  });

  boot();
})();
