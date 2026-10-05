/**
 * DOM Scanner
 *
 * Scans elements visible in the viewport and produces a list of candidate
 * targets. Defensive against hidden / too-small elements and the extension's
 * own nodes. Scanning is throttled & event-driven.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  const SELECTOR = "h1,h2,h3,p,img,video,iframe,button,a,input,code,pre,article";

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
      const nodes = document.querySelectorAll(SELECTOR);
      for (const el of nodes) {
        if (this._isOwn(el)) continue;
        const rect = el.getBoundingClientRect();
        if (!this._isVisible(el, rect, vw, vh)) continue;
        const type = this._typeOf(el);
        if (!type) continue;
        out.push({
          el,
          type,
          rect,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          area: rect.width * rect.height,
          isPlaying: type === "VIDEO" && !!WCC.playingVideoHosts?.has(el),
        });
      }
      this.targets = out;
      if (this.onInsets) this.onInsets(this.detectInsets());
      WCC.log("scan ->", out.length, "targets");
      return out;
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
      // An iframe is only a candidate once it's reported as playing video
      // (via video-watcher.js) — ordinary iframes (ads, widgets, maps...)
      // stay invisible to the scanner, same as before this existed.
      if (tag === "IFRAME")
        return WCC.playingVideoHosts?.has(el) ? "VIDEO" : null;
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
