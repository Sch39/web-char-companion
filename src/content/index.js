/**
 * Content script bootstrap.
 *
 * Reads settings + site rules, decides whether the companion may appear, then
 * wires up Renderer + Scanner + Selector + Movement + Behavior + Interaction.
 * Listens for popup messages to pause/hide/reload-settings.
 */
(async () => {
  "use strict";
  const WCC = window.__WCC;
  if (window.__WCC_BOOTED) return;
  window.__WCC_BOOTED = true;

  const app = { settings: null, modules: null };

  const getSettings = () => app.settings;

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
      return res?.character || globalChar || "hutao";
    } catch {
      return globalChar || "hutao";
    }
  }

  async function boot() {
    const { settings, siteRules } = await loadStorage();
    app.settings = settings;

    if (!settings.enabled || !siteAllowed(siteRules)) {
      WCC.log("companion disabled for this page");
      return;
    }

    const character = await resolveCharacter(settings.character);
    const renderer = new WCC.Renderer();
    try {
      await renderer.init(character);
    } catch (e) {
      console.error("[WCC] renderer init failed:", e);
      return;
    }

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
      scanner,
      selector,
      movement,
      behavior,
      interaction,
    };
    WCC.log("companion active on", location.hostname);
  }

  function teardown() {
    const m = app.modules;
    if (!m) return;
    m.behavior.stop();
    m.scanner.stop();
    m.interaction.stop();
    m.renderer.destroy();
    app.modules = null;
  }

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
        teardown();
        boot();
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
