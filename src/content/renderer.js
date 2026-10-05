/**
 * Character renderer.
 *
 * Creates the overlay via Shadow DOM, then animates the sprite sheet with
 * requestAnimationFrame + background-position stepping. The container uses
 * position:fixed + pointer-events:none so it doesn't interfere with the page.
 */
(() => {
  "use strict";
  const WCC = window.__WCC;

  class Renderer {
    constructor() {
      this.host = null;
      this.shadow = null;
      this.container = null;
      this.sprite = null;
      this.anim = null; // animation.json definition
      this.sheetUrls = {}; // name -> objectURL/getURL
      this.current = null; // active animation name
      this.facing = "left"; // 'left' | 'right'
      this.frame = 0;
      this.lastFrameTime = 0;
      this.rafId = null;
      this.visible = true;
      this.pos = { x: 80, y: 0 }; // foot coords (bottom-center) in the viewport
      this.size = { w: 128, h: 128 };
      this.insets = { top: 0, bottom: 0 }; // area blocked by fixed/sticky bars
      this.onMove = null; // optional callback(x, y), fired on every setPosition
    }

    /** @param {{manifest: object, sheets: Record<string,string>}} data */
    async init(data) {
      this.anim = data.manifest;
      // Resolve config: default grid from the `sprite` block, overridable per
      // animation. defs[name] = the full config the renderer uses.
      const grid = this.anim.sprite || {};
      this.defs = {};
      for (const [name, def] of Object.entries(this.anim.animations)) {
        this.defs[name] = {
          frameWidth: 256,
          frameHeight: 256,
          columns: 5,
          rows: 3,
          frames: 15,
          fps: 8,
          loop: true,
          scale: 1, // compensates sheets where the art is drawn larger/smaller within the cell
          offsetX: 0,
          offsetY: 0,
          ...grid,
          ...def,
        };
        // sheet URL is either a packaged getURL() or an imported data: URL
        this.sheetUrls[name] = data.sheets[name];
      }
      const scale = this.anim.renderScale || 0.5;
      const base = this.defs.idle || Object.values(this.defs)[0];
      this.size = {
        w: Math.round(base.frameWidth * scale),
        h: Math.round(base.frameHeight * scale),
      };
      // How far (rendered px) idle's own drawn feet sit above the position
      // anchor. Movement targets that need literal contact with an element
      // edge (e.g. "sit") add this back in — see movement-engine.js.
      this.idleFootGap = this.anim.idleFootGap || 0;
      this._buildDom();
      this.pos.y = window.innerHeight - WCC.CONFIG.floorOffset;
      this.play("idle");
      this._loop = this._loop.bind(this);
      this.rafId = requestAnimationFrame(this._loop);
      WCC.log("renderer ready", this.anim.displayName, this.size);
    }

    _buildDom() {
      this.host = document.createElement("div");
      this.host.id = "wcc-host";
      // the host itself must not affect page layout
      this.host.style.cssText =
        "all: initial; position: fixed; z-index:" +
        WCC.CONFIG.zIndex +
        "; top:0; left:0; width:0; height:0;";
      this.shadow = this.host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = this._css();
      this.shadow.appendChild(style);

      this.container = document.createElement("div");
      this.container.className = "wcc-char";

      this.sprite = document.createElement("div");
      this.sprite.className = "wcc-sprite";
      this.container.appendChild(this.sprite);

      this.shadow.appendChild(this.container);
      (document.body || document.documentElement).appendChild(this.host);
      this._applyTransform();
    }

    _css() {
      return `
        :host { all: initial; }
        .wcc-char {
          position: fixed;
          left: 0; top: 0;
          width: ${this.size.w}px;
          height: ${this.size.h}px;
          pointer-events: none;
          will-change: transform;
          transition: opacity .25s ease;
          image-rendering: auto;
        }
        .wcc-char.interactive { pointer-events: auto; cursor: grab; touch-action: none; }
        .wcc-char.dragging { cursor: grabbing; }
        .wcc-char.hidden { opacity: 0; }
        .wcc-sprite {
          width: 100%; height: 100%;
          background-repeat: no-repeat;
          transform-origin: center bottom;
        }
        @media (prefers-reduced-motion: reduce) {
          .wcc-char { transition: none; }
        }
      `;
    }

    /** Switch the active animation. */
    play(name) {
      const resolved = this.defs[name] ? name : "idle";
      if (this.current === resolved) return;
      this.current = resolved;
      this.frame = 0;
      this.lastFrameTime = 0;
      const def = this.defs[resolved];
      this.sprite.style.backgroundImage = `url("${this.sheetUrls[resolved]}")`;
      this.sprite.style.backgroundSize = `${def.columns * 100}% ${def.rows * 100}%`;
      this._drawFrame();
    }

    setFacing(dir) {
      if (dir !== "left" && dir !== "right") return;
      this.facing = dir;
      this._drawFrame();
    }

    /** Character foot position (bottom-center) in viewport coordinates. */
    setPosition(x, y) {
      this.pos.x = x;
      this.pos.y = y;
      this._applyTransform();
      this.onMove?.(x, y);
    }

    /**
     * Clamp the foot coordinates so the whole character stays inside the
     * viewport (not off-window / hidden behind browser chrome). Used by target
     * anchors & drag. Not used inside the walk loop so "arrived" detection stays
     * accurate — the target is clamped beforehand instead.
     */
    clampFoot(x, y) {
      const w = this.size.w;
      const h = this.size.h;
      const margin = WCC.CONFIG.topMargin || 0;
      const maxX = Math.max(w / 2, window.innerWidth - w / 2);
      // the head (foot - h) must sit below the top bar + margin
      const minY = this.insets.top + margin + h;
      let maxY =
        window.innerHeight - WCC.CONFIG.floorOffset - this.insets.bottom;
      if (maxY < minY) maxY = minY;
      return {
        x: WCC.clamp(x, w / 2, maxX),
        y: WCC.clamp(y, minY, maxY),
      };
    }

    /** Update top/bottom bar thickness, then re-clamp position if now out of range. */
    setInsets(top, bottom) {
      this.insets.top = Math.max(0, top || 0);
      this.insets.bottom = Math.max(0, bottom || 0);
      const c = this.clampFoot(this.pos.x, this.pos.y);
      this.setPosition(c.x, c.y);
    }

    _applyTransform() {
      const left = Math.round(this.pos.x - this.size.w / 2);
      const top = Math.round(this.pos.y - this.size.h);
      this.container.style.transform = `translate(${left}px, ${top}px)`;
    }

    _drawFrame() {
      const def = this.defs[this.current];
      const col = this.frame % def.columns;
      const row = Math.floor(this.frame / def.columns) % def.rows;
      // background-position as a percentage for the sheet grid
      const px = def.columns > 1 ? (col / (def.columns - 1)) * 100 : 0;
      const py = def.rows > 1 ? (row / (def.rows - 1)) * 100 : 0;
      this.sprite.style.backgroundPosition = `${px}% ${py}%`;
      // sheet faces `defaultFacing`; flip when heading the other way
      const flip = this.facing !== (this.anim.defaultFacing || "left");
      const s = def.scale || 1;
      const sx = flip ? -s : s;
      // transform-origin is center bottom, so scale zooms toward the feet and
      // offsetX/offsetY nudge the art afterward (e.g. to line up a baseline)
      this.sprite.style.transform =
        `translate(${def.offsetX}px, ${def.offsetY}px) scale(${sx}, ${s})`;
    }

    _loop(now) {
      this.rafId = requestAnimationFrame(this._loop);
      if (!this.visible || !this.current) return;
      const def = this.defs[this.current];
      const interval = 1000 / (def.fps || 8);
      if (now - this.lastFrameTime < interval) return;
      this.lastFrameTime = now;
      this.frame++;
      if (this.frame >= def.frames) {
        this.frame = def.loop ? 0 : def.frames - 1;
      }
      this._drawFrame();
    }

    setVisible(v) {
      this.visible = v;
      this.container.classList.toggle("hidden", !v);
    }

    setInteractive(v) {
      this.container.classList.toggle("interactive", v);
    }

    get footY() {
      return this.pos.y;
    }

    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.host?.remove();
      this.host = null;
    }
  }

  WCC.Renderer = Renderer;
})();
