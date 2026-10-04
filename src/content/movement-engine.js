/**
 * Movement Engine
 *
 * Menggerakkan karakter pada visual plane (bukan mengikuti layout fisik DOM).
 * Hanya sumbu X yang di-"jalankan"; Y menempel pada lantai visual / posisi
 * target. Mengembalikan Promise yang resolve saat tiba atau dibatalkan.
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

    /** Preferred position karakter relatif target per action*/
    anchorFor(action, rect) {
      const floor = window.innerHeight - WCC.CONFIG.floorOffset;
      let raw;
      switch (action) {
        case "read": // bottom-left heading
          raw = { x: rect.left + 24, y: rect.bottom + 4 };
          break;
        case "sit": // di atas button/elemen
          raw = { x: rect.left + rect.width / 2, y: rect.top };
          break;
        case "watch": // di bawah video
          raw = { x: rect.left + rect.width / 2, y: rect.bottom + 8 };
          break;
        case "look": // di samping gambar
          raw = { x: rect.right + 8, y: rect.top + rect.height / 2 };
          break;
        default:
          raw = { x: rect.left + rect.width / 2, y: floor };
      }
      // Pastikan target tetap di dalam viewport & terjangkau.
      return this.r.clampFoot(raw.x, raw.y);
    }

    /** Jalan ke titik (x,y). Resolve: 'arrived' | 'cancelled'. */
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

    /** Jaga karakter tetap di dalam viewport & di luar bar (mis. setelah resize). */
    clampToViewport() {
      const c = this.r.clampFoot(this.r.pos.x, this.r.pos.y);
      this.r.setPosition(c.x, c.y);
    }
  }

  WCC.MovementEngine = MovementEngine;
})();
