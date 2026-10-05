/**
 * Video Watcher (top frame)
 *
 * Answers one question for the behavior code: is this element currently
 * playing video? Two very different cases, handled differently on purpose.
 *
 * **Native `<video>` in this document** — read `.paused`/`.ended` live, at the
 * moment the question is asked. An earlier version listened for play/pause
 * events and cached the result, which quietly failed whenever no event was
 * there to hear:
 *   - playback already running before this script loaded (autoplay, an SPA
 *     navigation that rebuilt the companion, or a reloaded extension) — the
 *     `play` event fired before anyone was listening, so the video looked
 *     paused forever;
 *   - media events are NOT composed, so a `<video>` inside a shadow root
 *     never reaches a document-level listener at all.
 * Reading the property has neither problem and needs no state to keep in
 * sync. Players built on Media Source Extensions — Shaka Player, hls.js,
 * dash.js, video.js and friends — all drive a real `<video>` element, so
 * this covers them without knowing anything about the library.
 *
 * **Cross-origin `<iframe>`** — the property is unreachable, so state has to
 * be pushed in from video-watcher-frame.js via postMessage and cached here.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  // Only iframes live here now; native <video> is read live (see above).
  WCC.playingVideoHosts = new WeakSet();

  // A full tree walk is needed to reach videos inside open shadow roots, so
  // the result is cached briefly — a player appearing is a DOM mutation, not
  // something that needs sub-second discovery.
  const VIDEO_CACHE_MS = 1000;
  const MAX_SHADOW_DEPTH = 8;
  let cache = { at: 0, videos: [] };

  function walkForVideos(root, out, depth) {
    if (depth > MAX_SHADOW_DEPTH) return;
    for (const v of root.querySelectorAll("video")) out.push(v);
    // Open shadow roots only. A closed root is unreachable by design — a
    // player that uses one can't be detected, and that's a hard boundary,
    // not something to work around.
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) walkForVideos(host.shadowRoot, out, depth + 1);
    }
  }

  /** Every <video> in the document, including inside open shadow roots. */
  WCC.collectVideos = function collectVideos() {
    const now = Date.now();
    if (now - cache.at < VIDEO_CACHE_MS) return cache.videos;
    const out = [];
    try {
      walkForVideos(document, out, 0);
    } catch {
      /* a hostile page can throw from a getter — fall back to what we have */
    }
    cache = { at: now, videos: out };
    return out;
  };

  /**
   * A decorative background loop rather than something a person is watching.
   * Hero and banner videos are muted (a requirement for autoplay), looping,
   * carry no controls, and run only a few seconds.
   *
   * All four signals have to agree, deliberately: the costs here are
   * asymmetric. Ignoring a real video is a reaction the user notices
   * missing, while quietly skipping a decorative one is invisible — so this
   * errs heavily toward treating things as watchable.
   *
   * Known blind spot: a short, muted, looping clip with a custom UI instead
   * of native controls — some social embeds look exactly like this — also
   * matches, and gets skipped. CONFIG.decorativeMaxDurationSec moves that
   * line, and 0 switches the filter off entirely.
   */
  WCC.isDecorativeVideo = function isDecorativeVideo(el) {
    if (el?.tagName !== "VIDEO") return false;
    const maxSec = WCC.CONFIG.decorativeMaxDurationSec;
    if (!maxSec) return false; // filter disabled
    if (!el.muted || !el.loop || el.controls) return false;
    // duration is NaN until metadata lands, and Infinity for a live stream —
    // neither is evidence of decoration, so don't suppress on a guess
    return Number.isFinite(el.duration) && el.duration <= maxSec;
  };

  /**
   * Is this element showing video worth reacting to? Playing in the plain
   * sense, minus background decoration (see isDecorativeVideo) — named for
   * that meaning rather than "isPlaying", since the two aren't the same.
   * @param {Element} el a <video> or an <iframe>
   */
  WCC.isWatchableVideo = function isWatchableVideo(el) {
    if (!el) return false;
    if (el.tagName === "VIDEO") {
      // readyState guards against a source that's attached but has no frames
      // yet, which would otherwise read as "playing" the instant play() is
      // called and before anything is actually on screen.
      if (el.paused || el.ended || el.readyState < 2) return false;
      return !WCC.isDecorativeVideo(el);
    }
    if (el.tagName === "IFRAME") return WCC.playingVideoHosts.has(el);
    return false;
  };

  class VideoWatcher {
    constructor() {
      this._onMessage = this._onMessage.bind(this);
    }

    start() {
      window.addEventListener("message", this._onMessage);
    }

    stop() {
      window.removeEventListener("message", this._onMessage);
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
