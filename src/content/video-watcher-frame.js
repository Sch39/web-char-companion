/**
 * Video Watcher — sub-frame probe.
 *
 * Injected into every frame of every page (manifest `all_frames: true`) so
 * it can see <video> elements inside cross-origin iframes (YouTube/Vimeo
 * embeds, etc.) that the top frame can't reach directly. Only ever does
 * anything inside an actual sub-frame — the top frame reads its own videos'
 * properties directly instead, via video-watcher.js.
 *
 * Deliberately dependency-free (no WCC namespace) so it stays tiny: this
 * runs in every iframe on every page, including plenty with no video at all.
 */
(() => {
  "use strict";
  if (window.top === window.self) return;

  let lastReported = null;

  // Mirrors WCC.CONFIG.decorativeMaxDurationSec — duplicated because this
  // probe is deliberately dependency-free (it loads in every iframe on every
  // page). Keep the two in step if you change one.
  const DECORATIVE_MAX_SECONDS = 30;

  /** Same test as video-watcher.js's isDecorativeVideo — see it for the reasoning. */
  function isDecorative(v) {
    if (!v.muted || !v.loop || v.controls) return false;
    return Number.isFinite(v.duration) && v.duration <= DECORATIVE_MAX_SECONDS;
  }

  // Recomputed from the live elements rather than counted up and down from
  // events: a counter drifts permanently out of step the moment one event is
  // missed (a video removed mid-playback never pauses, two sources swap on
  // one element, and so on).
  function anyPlaying() {
    for (const v of document.querySelectorAll("video")) {
      if (v.paused || v.ended || v.readyState < 2) continue;
      if (isDecorative(v)) continue;
      return true;
    }
    return false;
  }

  function report() {
    const playing = anyPlaying();
    if (playing === lastReported) return; // only transitions are worth a message
    lastReported = playing;
    try {
      window.top.postMessage({ source: "wcc-video-watcher", playing }, "*");
    } catch {
      /* top frame unreachable (e.g. detached) — nothing to do */
    }
  }

  for (const type of ["play", "pause", "ended", "emptied"]) {
    document.addEventListener(type, report, true);
  }

  // The embed may already be playing by the time this probe runs — in that
  // case no further event is coming, so state it once up front. Also covers
  // a player that only attaches its <video> after the frame loads.
  report();
  document.addEventListener("DOMContentLoaded", report);
  window.addEventListener("load", report);
})();
