/**
 * Movement Engine
 *
 * Moves the character on a visual plane (it doesn't follow the physical DOM
 * layout). Position is interpolated straight toward the target on both axes
 * at once, so travel can be diagonal — the walk cycle is swapped for "hop"
 * when that diagonal gets steep, since a horizontal stride looks like it's
 * sliding sideways otherwise. Returns a Promise that resolves on arrival or
 * cancel.
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
        case "sit": {
          // On top of the button/element. "y: rect.top" places the sprite
          // box's bottom edge there, not the drawn feet — every animation has
          // some empty margin below its feet (idle's own gap, which other
          // sheets are calibrated via scale/offsetY to match). idleFootGap
          // compensates for that margin so the feet actually touch the edge.
          const gap = this.r.idleFootGap || 0;
          raw = { x: rect.left + rect.width / 2, y: rect.top + gap };
          break;
        }
        case "watch": // below the video
        case "watch_film": // same spot, for an actively playing video
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
      // The regular walk cycle is a side-view horizontal stride; it reads as
      // sliding sideways once the travel direction leans steeply up/down
      // (e.g. heading to a target well above or below the current spot).
      // Pick "hop" instead whenever the angle from horizontal is steep —
      // decided once up front, not re-evaluated mid-trip, so the animation
      // doesn't flicker between the two near the threshold.
      const angleDeg =
        (Math.atan2(Math.abs(y - r.pos.y), Math.abs(x - r.pos.x)) * 180) /
        Math.PI;
      r.play(angleDeg > WCC.CONFIG.steepWalkAngleDeg ? "hop" : "walk");
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
