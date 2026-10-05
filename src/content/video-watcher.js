/**
 * Video Watcher (top frame)
 *
 * Tracks which video-bearing elements are *currently playing* so behavior
 * can favor them. Two sources feed the same set:
 *  - native <video> elements in this document, tracked directly via capturing
 *    play/pause/ended/emptied listeners on `document` (these media events
 *    don't bubble, but a capturing listener still sees them on the way down
 *    to the target — no per-element listener bookkeeping needed, and
 *    dynamically-added videos are covered automatically).
 *  - <video> elements inside cross-origin iframes (YouTube/Vimeo embeds,
 *    etc.), reported by video-watcher-frame.js via postMessage, since this
 *    document can't see into a cross-origin iframe directly.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  WCC.playingVideoHosts = new WeakSet();

  class VideoWatcher {
    constructor() {
      this._onPlay = (e) => this._mark(e.target, true);
      this._onStop = (e) => this._mark(e.target, false);
      this._onMessage = this._onMessage.bind(this);
    }

    start() {
      document.addEventListener("play", this._onPlay, true);
      document.addEventListener("pause", this._onStop, true);
      document.addEventListener("ended", this._onStop, true);
      document.addEventListener("emptied", this._onStop, true);
      window.addEventListener("message", this._onMessage);
    }

    stop() {
      document.removeEventListener("play", this._onPlay, true);
      document.removeEventListener("pause", this._onStop, true);
      document.removeEventListener("ended", this._onStop, true);
      document.removeEventListener("emptied", this._onStop, true);
      window.removeEventListener("message", this._onMessage);
    }

    _mark(el, playing) {
      if (el?.tagName !== "VIDEO") return;
      if (playing) WCC.playingVideoHosts.add(el);
      else WCC.playingVideoHosts.delete(el);
    }

    // Messages from video-watcher-frame.js running inside a sub-frame. Not
    // cryptographically verified — a page could spoof this shape, but the
    // worst case is purely cosmetic (reacting to a false "playing" signal),
    // not a data or permission issue, so a loose shape check is enough.
    _onMessage(e) {
      const data = e.data;
      if (!data || data.source !== "wcc-video-watcher") return;
      const frame = [...document.querySelectorAll("iframe")].find(
        (f) => f.contentWindow === e.source,
      );
      if (!frame) return;
      if (data.playing) WCC.playingVideoHosts.add(frame);
      else WCC.playingVideoHosts.delete(frame);
    }
  }

  WCC.VideoWatcher = VideoWatcher;
})();
