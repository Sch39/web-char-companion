/**
 * Interaction
 *
 * - Large scroll while moving -> cancel/recalculate (anti-glitch).
 * - Resize -> keep the character inside the viewport.
 * - Click the character -> brief reaction (happy/surprised).
 * - Drag the character -> follow the cursor, release -> stay put.
 *
 * Note: pointermove/up handlers are attached to `window` (not the character
 * element) during a drag, so the character keeps following the cursor even
 * when it moves quickly outside the small character box.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  const DRAG_THRESHOLD = 4; // px, moving more than this counts as a drag (not a click)

  class Interaction {
    constructor({ renderer, movement, behavior, getSettings }) {
      this.r = renderer;
      this.move = movement;
      this.behavior = behavior;
      this.getSettings = getSettings || (() => WCC.DEFAULT_SETTINGS);
      this._lastScrollY = window.scrollY;
      this._onScroll = this._throttle(this._handleScroll.bind(this), 120);
      this._onResize = this._handleResize.bind(this);
      this._onPointerDown = this._handlePointerDown.bind(this);
      this._onPointerMove = this._handlePointerMove.bind(this);
      this._onPointerUp = this._handlePointerUp.bind(this);
      this._onFocusIn = this._handleFocusIn.bind(this);
      this._onFocusOut = this._handleFocusOut.bind(this);
      this._drag = null; // active drag state
    }

    start() {
      window.addEventListener("scroll", this._onScroll, { passive: true });
      window.addEventListener("resize", this._onResize, { passive: true });
      document.addEventListener("focusin", this._onFocusIn, true);
      document.addEventListener("focusout", this._onFocusOut, true);

      // Make the character interactive so it can be clicked & dragged.
      this.r.setInteractive(true);
      const el = this.r.container;
      el.addEventListener("pointerdown", this._onPointerDown);
      el.addEventListener("dragstart", (e) => e.preventDefault());
    }

    stop() {
      window.removeEventListener("scroll", this._onScroll);
      window.removeEventListener("resize", this._onResize);
      document.removeEventListener("focusin", this._onFocusIn, true);
      document.removeEventListener("focusout", this._onFocusOut, true);
      this._detachDrag();
    }

    // --- Input focus (writing reaction) ------------------------------------

    _isEditable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        return [
          "text", "search", "email", "url", "tel",
          "password", "number", "",
        ].includes(t);
      }
      return false;
    }

    _handleFocusIn(e) {
      if (this._isEditable(e.target)) this.behavior.onInputFocus(e.target);
    }

    _handleFocusOut(e) {
      if (this._isEditable(e.target)) this.behavior.onInputBlur(e.target);
    }

    // --- Drag ---------------------------------------------------------------

    _handlePointerDown(e) {
      if (e.button != null && e.button !== 0) return; // left click only
      e.preventDefault();
      e.stopPropagation();
      this._drag = {
        id: e.pointerId,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
        // keep the grab point consistent relative to the character's foot
        offsetX: e.clientX - this.r.pos.x,
        offsetY: e.clientY - this.r.pos.y,
        prevX: e.clientX,
      };
      // Listen on window so we don't lose events when the cursor leaves the box.
      window.addEventListener("pointermove", this._onPointerMove);
      window.addEventListener("pointerup", this._onPointerUp);
      window.addEventListener("pointercancel", this._onPointerUp);
    }

    _handlePointerMove(e) {
      const d = this._drag;
      if (!d || e.pointerId !== d.id) return;

      if (!d.moved) {
        const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
        if (dist <= DRAG_THRESHOLD) return; // still treated as a (potential) click
        d.moved = true;
        this.behavior.pause(); // stop autonomous movement so it doesn't fight for control
        this.r.container.classList.add("dragging");
      }

      const dx = e.clientX - d.prevX;
      if (dx < -0.5) this.r.setFacing("left");
      else if (dx > 0.5) this.r.setFacing("right");
      this.r.play(this._dragAnimation(dx));
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
        // drag done: stay put, resume autonomous movement after a short pause
        this.r.play("idle");
        setTimeout(() => this.behavior.resume(), 1200);
      } else {
        // didn't move -> treated as a click -> react
        this._react();
      }
    }

    /**
     * What to show while the character is held. A dedicated `drag` sheet
     * reads best — a walk cycle in mid-air looks like the character is
     * strolling through the sky — so it wins whenever the character has one
     * and the user hasn't switched the reaction off.
     *
     * Without that sheet, fall back to the older walk/idle behavior rather
     * than to a static idle: play() alone would resolve `drag` to idle and
     * make dragging look frozen, which is worse than the walk cycle it
     * replaced.
     */
    _dragAnimation(dx) {
      const wanted = this.getSettings().behaviors?.reactToDrag !== false;
      if (wanted && this.r.has("drag")) return "drag";
      return Math.abs(dx) > 0.5 ? "walk" : "idle";
    }

    _detachDrag() {
      window.removeEventListener("pointermove", this._onPointerMove);
      window.removeEventListener("pointerup", this._onPointerUp);
      window.removeEventListener("pointercancel", this._onPointerUp);
    }

    /** Place the character's foot at (x,y), kept inside the viewport. */
    _place(x, y) {
      const c = this.r.clampFoot(x, y);
      this.r.setPosition(c.x, c.y);
    }

    // --- Scroll / resize / click -------------------------------------------

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
      this.r.play(pick); // falls back to idle if the sheet is missing
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
