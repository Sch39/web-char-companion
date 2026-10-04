/**
 * Interaction
 *
 * - Scroll besar saat bergerak -> batalkan/recalculate (anti-glitch).
 * - Resize -> jaga karakter di dalam viewport.
 * - Klik karakter -> reaksi singkat (happy/surprised).
 * - Drag karakter -> ikuti cursor, lepas -> diam di tempat
 *
 * Catatan: handler pointermove/up dipasang di `window` (bukan di elemen
 * karakter) selama drag, agar karakter tetap mengikuti cursor meski cursor
 * bergerak cepat keluar dari kotak karakter yang kecil.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  const DRAG_THRESHOLD = 4; // px, geser lebih dari ini dianggap drag (bukan klik)

  class Interaction {
    constructor({ renderer, movement, behavior }) {
      this.r = renderer;
      this.move = movement;
      this.behavior = behavior;
      this._lastScrollY = window.scrollY;
      this._onScroll = this._throttle(this._handleScroll.bind(this), 120);
      this._onResize = this._handleResize.bind(this);
      this._onPointerDown = this._handlePointerDown.bind(this);
      this._onPointerMove = this._handlePointerMove.bind(this);
      this._onPointerUp = this._handlePointerUp.bind(this);
      this._drag = null; // state drag aktif
    }

    start() {
      window.addEventListener("scroll", this._onScroll, { passive: true });
      window.addEventListener("resize", this._onResize, { passive: true });

      // Karakter interaktif agar bisa diklik & digeser.
      this.r.setInteractive(true);
      const el = this.r.container;
      el.addEventListener("pointerdown", this._onPointerDown);
      el.addEventListener("dragstart", (e) => e.preventDefault());
    }

    stop() {
      window.removeEventListener("scroll", this._onScroll);
      window.removeEventListener("resize", this._onResize);
      this._detachDrag();
    }

    // --- Drag ---------------------------------------------------------------

    _handlePointerDown(e) {
      if (e.button != null && e.button !== 0) return; // hanya klik kiri
      e.preventDefault();
      e.stopPropagation();
      this._drag = {
        id: e.pointerId,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        // jaga titik genggam konsisten relatif ke kaki karakter
        offsetX: e.clientX - this.r.pos.x,
        offsetY: e.clientY - this.r.pos.y,
        prevX: e.clientX,
      };
      // Dengar di window agar tidak kehilangan event saat cursor keluar kotak.
      window.addEventListener("pointermove", this._onPointerMove);
      window.addEventListener("pointerup", this._onPointerUp);
      window.addEventListener("pointercancel", this._onPointerUp);
    }

    _handlePointerMove(e) {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;

      if (!d.moved) {
        const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (dist <= DRAG_THRESHOLD) return; // masih dianggap (calon) klik
        d.moved = true;
        this.behavior.pause(); // hentikan gerak otomatis agar tidak berebut kendali
        this.r.container.classList.add("dragging");
      }

      const dx = e.clientX - d.prevX;
      if (dx < -0.5) this.r.setFacing("left");
      else if (dx > 0.5) this.r.setFacing("right");
      this.r.play(Math.abs(dx) > 0.5 ? "walk" : "idle");
      this._place(e.clientX - d.offsetX, e.clientY - d.offsetY);
      d.prevX = e.clientX;
    }

    _handlePointerUp(e) {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;
      this._detachDrag();
      this.r.container.classList.remove("dragging");
      this._drag = null;

      if (d.moved) {
        // selesai di-drag: diam di tempat, lanjutkan gerak otomatis setelah jeda singkat
        this.r.play("idle");
        setTimeout(() => this.behavior.resume(), 1200);
      } else {
        // tidak bergeser -> dianggap klik -> reaksi
        this._react();
      }
    }

    _detachDrag() {
      window.removeEventListener("pointermove", this._onPointerMove);
      window.removeEventListener("pointerup", this._onPointerUp);
      window.removeEventListener("pointercancel", this._onPointerUp);
    }

    /** Tempatkan kaki karakter di (x,y), dijaga tetap dalam viewport. */
    _place(x, y) {
      const c = this.r.clampFoot(x, y);
      this.r.setPosition(c.x, c.y);
    }

    // --- Scroll / resize / klik --------------------------------------------

    _handleScroll() {
      const dy = Math.abs(window.scrollY - this._lastScrollY);
      this._lastScrollY = window.scrollY;
      if (dy > WCC.CONFIG.scrollCancelThreshold) {
        this.behavior.onDisrupt();
      }
    }

    _handleResize() {
      this.move.clampToViewport();
    }

    _react() {
      const reactions = ["happy", "surprised"];
      const pick = reactions[Math.floor(Math.random() * reactions.length)];
      this.r.play(pick); // fallback idle bila sheet belum ada
      WCC.log("interaction: click ->", pick);
      setTimeout(() => this.r.play("idle"), 1500);
    }

    _throttle(fn, wait) {
      let t = 0;
      return (...a) => {
        const now = Date.now();
        if (now - t >= wait) {
          t = now;
          fn(...a);
        }
      };
    }
  }

  WCC.Interaction = Interaction;
})();
