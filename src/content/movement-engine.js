/**
 * Movement Engine
 *
 * Moves the character on a visual plane (it doesn't follow the physical DOM
 * layout). Only the X axis is "walked"; Y snaps to the visual floor or the
 * target position. Returns a Promise that resolves on arrival or cancel.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  class MovementEngine {
    constructor(renderer) {
      this.r = renderer;
      this._rafId = null;
      this._cancel = null;
    }

    /** Preferred character position relative to the target, per action. */
    anchorFor(action, rect) {
      const floor = window.innerHeight - WCC.CONFIG.floorOffset;
      let raw;
      switch (action) {
        case "read": // bottom-left of the heading
          raw = { x: rect.left + 24, y: rect.bottom + 4 };
          break;
        case "sit": // on top of the button/element
          raw = { x: rect.left + rect.width / 2, y: rect.top };
          break;
        case "watch": // below the video
          raw = { x: rect.left + rect.width / 2, y: rect.bottom + 8 };
          break;
        case "look": // beside the image
          raw = { x: rect.right + 8, y: rect.top + rect.height / 2 };
          break;
        case "write": // perched at the bottom-left of the field being typed in
          raw = { x: rect.left + 20, y: rect.bottom + 4 };
          break;
        default:
          raw = { x: rect.left + rect.width / 2, y: floor };
      }
      // Keep the target inside the viewport and reachable.
      return this.r.clampFoot(raw.x, raw.y);
    }

    /** Walk to point (x,y). Resolves: 'arrived' | 'cancelled'. */
    walkTo(x, y) {
      this.cancel();
      const speed = WCC.CONFIG.walkSpeed;
      const r = this.r;
      r.play("walk");
      return new Promise((resolve) => {
        let cancelled = false;
        this._cancel = () => {
          cancelled = true;
          resolve("cancelled");
        };
        let prev = performance.now();
        const step = (now) => {
          if (cancelled) return;
          const dt = (now - prev) / 1000;
          prev = now;
          const dx = x - r.pos.x;
          const dy = y - r.pos.y;
          const dist = Math.hypot(dx, dy);
          const move = speed * dt;
          r.setFacing(dx < 0 ? "left" : "right");
          if (dist <= move || dist < 2) {
            r.setPosition(x, y);
            this._rafId = null;
            r.play("idle");
            resolve("arrived");
            return;
          }
          r.setPosition(
            r.pos.x + (dx / dist) * move,
            r.pos.y + (dy / dist) * move,
          );
          this._rafId = requestAnimationFrame(step);
        };
        this._rafId = requestAnimationFrame(step);
      });
    }

    cancel() {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = null;
      if (this._cancel) {
        const c = this._cancel;
        this._cancel = null;
        c();
      }
    }

    /** Keep the character inside the viewport and clear of bars (e.g. after resize). */
    clampToViewport() {
      const c = this.r.clampFoot(this.r.pos.x, this.r.pos.y);
      this.r.setPosition(c.x, c.y);
    }
  }

  WCC.MovementEngine = MovementEngine;
})();
