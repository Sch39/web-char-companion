/**
 * DOM Scanner
 *
 * Scans elements visible in the viewport and produces a list of candidate
 * targets. Defensive against hidden / too-small elements and the extension's
 * own nodes. Scanning is throttled & event-driven.
 *
 * Video gets two extra passes that other elements don't need: one for
 * <video> inside open shadow roots (web-component players), and a fallback
 * that targets the player's container when the <video> element's own box is
 * unusable. See _consider() and _playerBox().
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  const SELECTOR = "h1,h2,h3,p,img,video,iframe,button,a,input,code,pre,article";

  // How far above a <video> to look for the player container it sits in.
  // A handful of levels covers real players; more would start resolving to
  // page-level layout wrappers that have nothing to do with the video.
  const MAX_PLAYER_WRAPPER_DEPTH = 4;

  // Candidate selectors for fixed bars (header/nav/footer) at viewport edges.
  const BAR_SELECTOR = [
    "header",
    "nav",
    "footer",
    '[role="banner"]',
    '[role="navigation"]',
    '[role="contentinfo"]',
    '[class*="header" i]',
    '[class*="navbar" i]',
    '[class*="topbar" i]',
    '[class*="appbar" i]',
    '[class*="toolbar" i]',
    '[class*="sticky" i]',
    '[class*="footer" i]',
    '[id*="header" i]',
    '[id*="footer" i]',
  ].join(",");

  class DomScanner {
    constructor() {
      this.targets = [];
      this.onInsets = null; // callback({top, bottom}) when bars are detected
      this._throttled = this._throttle(() => this.scan(), 250);
    }

    start() {
      this.scan();
      window.addEventListener("scroll", this._throttled, { passive: true });
      window.addEventListener("resize", this._throttled, { passive: true });
      this._mo = new MutationObserver(this._throttled);
      this._mo.observe(document.body, { childList: true, subtree: true });
    }

    stop() {
      window.removeEventListener("scroll", this._throttled);
      window.removeEventListener("resize", this._throttled);
      this._mo?.disconnect();
    }

    scan() {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const out = [];
      const seen = new Set();

      for (const el of document.querySelectorAll(SELECTOR)) {
        this._consider(el, out, seen, vw, vh);
      }
      // A <video> inside an open shadow root — common for players built as
      // web components — isn't reachable by the selector above.
      for (const v of WCC.collectVideos?.() || []) {
        this._consider(v, out, seen, vw, vh);
      }

      this.targets = out;
      if (this.onInsets) this.onInsets(this.detectInsets());
      WCC.log("scan ->", out.length, "targets");
      return out;
    }

    /** Vet one element and, if it qualifies, push a candidate for it. */
    _consider(el, out, seen, vw, vh) {
      if (this._isOwn(el)) return;
      const type = this._typeOf(el);
      if (!type) return;

      // Playing *and* not background decoration — asked of the media
      // element, never of a wrapper standing in for it. A decorative loop
      // stays a candidate, it just doesn't earn the "watch_film" reaction.
      const playing = type === "VIDEO" && !!WCC.isWatchableVideo?.(el);

      let target = el;
      let rect = el.getBoundingClientRect();
      if (!this._isVisible(el, rect, vw, vh)) {
        // Fall back to the container only for a video that's genuinely worth
        // walking to — that's the case where the player is plainly on screen
        // but the <video> box itself is unusable. An idle hidden <video>
        // (preload stub, unfilled ad slot) gets no fallback, so its wrapper
        // can't be mistaken for a player the character should walk to.
        const box = playing ? this._playerBox(el, vw, vh) : null;
        if (!box) return;
        target = box.el;
        rect = box.rect;
      }

      if (seen.has(target)) return; // two <video>s in one player, or both passes
      seen.add(target);

      out.push({
        el: target,
        type,
        rect,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        area: rect.width * rect.height,
        isPlaying: playing,
      });
    }

    /**
     * The box to actually walk to for a video whose own element can't serve
     * as a target — zero-sized, letterboxed to nothing, or sitting under an
     * opaque controls overlay. Every player library (Shaka, hls.js, dash.js,
     * video.js, JW…) wraps the <video> in a sized container, so the nearest
     * visible ancestor is almost always what the user sees as "the player".
     *
     * Deliberately generic rather than a list of known class names: an
     * allowlist like `.shaka-video-container, .video-play__meta, …` only ever
     * covers the sites someone remembered to add, and rots silently when a
     * site renames a class. "Nearest visible ancestor" needs no list.
     */
    _playerBox(video, vw, vh) {
      // crossing out of a shadow root needs the host, which parentElement
      // doesn't give you
      const up = (node) => node.parentElement || node.getRootNode?.()?.host;
      let el = up(video);
      for (let i = 0; i < MAX_PLAYER_WRAPPER_DEPTH; i++) {
        if (!el || el === document.body || el === document.documentElement) break;
        const rect = el.getBoundingClientRect();
        if (this._isVisible(el, rect, vw, vh)) return { el, rect };
        el = up(el);
      }
      return null;
    }

    /**
     * Detect fixed/sticky bars pinned to the top/bottom viewport edges, so the
     * character can stop before being covered by one (e.g. a site header).
     * Returns the blocked thickness: { top, bottom } in px.
     */
    detectInsets() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cap = vh * WCC.CONFIG.maxBarInset;
      let top = 0;
      let bottom = 0;
      for (const el of document.querySelectorAll(BAR_SELECTOR)) {
        if (this._isOwn(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (parseFloat(cs.opacity) < 0.1) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.5) continue; // not a page-wide bar
        if (r.height <= 0 || r.height > cap) continue; // too thin/thick
        if (r.top <= 4 && r.bottom > top) top = Math.min(r.bottom, cap);
        if (r.bottom >= vh - 4 && vh - r.top > bottom)
          bottom = Math.min(vh - r.top, cap);
      }
      return { top, bottom };
    }

    _typeOf(el) {
      const tag = el.tagName.toUpperCase();
      if (tag === "A" && !el.getAttribute("href")) return null;
      // An iframe is only a candidate once its own probe reports playing
      // video — ordinary iframes (ads, widgets, maps...) stay invisible to
      // the scanner, same as before this existed.
      if (tag === "IFRAME") return WCC.isWatchableVideo?.(el) ? "VIDEO" : null;
      return WCC.SEMANTIC_SCORE[tag] != null ? tag : null;
    }

    _isOwn(el) {
      return el.id === "wcc-host" || el.closest?.("#wcc-host") != null;
    }

    _isVisible(el, rect, vw, vh) {
      const min = WCC.CONFIG.minTargetSize;
      if (rect.width < min || rect.height < min) return false;
      // inside the viewport
      if (rect.bottom <= 0 || rect.top >= vh) return false;
      if (rect.right <= 0 || rect.left >= vw) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity) < 0.1) return false;
      return true;
    }

    _throttle(fn, wait) {
      let last = 0;
      let timer = null;
      return (...args) => {
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
    }
  }

  WCC.DomScanner = DomScanner;
})();
