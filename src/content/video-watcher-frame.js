/**
 * Video Watcher — sub-frame probe.
 *
 * Injected into every frame of every page (manifest `all_frames: true`) so
 * it can see <video> elements inside cross-origin iframes (YouTube/Vimeo
 * embeds, etc.) that the top frame can't reach directly. Only ever does
 * anything inside an actual sub-frame — the top frame runs the full
 * video-watcher.js instead, as part of the main content script group.
 *
 * Deliberately dependency-free (no WCC namespace) so it stays tiny: this
 * runs in every iframe on every page, including plenty with no video at all.
 */
(() => {
  "use strict";
  if (window.top === window.self) return;

  let playingCount = 0;

  function report(playing) {
    try {
      window.top.postMessage({ source: "wcc-video-watcher", playing }, "*");
    } catch {
      /* top frame unreachable (e.g. detached) — nothing to do */
    }
  }

  function onPlay(e) {
    if (e.target?.tagName !== "VIDEO") return;
    playingCount++;
    if (playingCount === 1) report(true);
  }

  function onStop(e) {
    if (e.target?.tagName !== "VIDEO") return;
    if (playingCount > 0) playingCount--;
    if (playingCount === 0) report(false);
  }

  document.addEventListener("play", onPlay, true);
  document.addEventListener("pause", onStop, true);
  document.addEventListener("ended", onStop, true);
  document.addEventListener("emptied", onStop, true);
})();
