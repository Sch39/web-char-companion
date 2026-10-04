(() => {
  "use strict";
  const WCC = window.__WCC;

  class BehaviorEngine {
    constructor({ renderer, scanner, selector, movement, getSettings }) {
      this.r = renderer;
      this.scanner = scanner;
      this.selector = selector;
      this.move = movement;
      this.getSettings = getSettings;
      this.state = WCC.STATE.IDLE;
      this.running = false;
      this.paused = false;
      this._timer = null;
      this._activeTarget = null;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.paused = false;
      this._scheduleIdle(1200);
    }

    pause() {
      this.paused = true;
      this._clearTimer();
      this.move.cancel();
      this.r.play("idle");
      this.state = WCC.STATE.IDLE;
    }

    resume() {
      if (!this.running) return this.start();
      if (!this.paused) return;
      this.paused = false;
      this._scheduleIdle(600);
    }

    stop() {
      this.running = false;
      this._clearTimer();
      this.move.cancel();
    }

    _profile() {
      const s = this.getSettings();
      return WCC.ACTIVITY_PROFILES[s.activity] || WCC.ACTIVITY_PROFILES.medium;
    }

    _scheduleIdle(overrideMs) {
      if (!this.running || this.paused) return;
      this.state = WCC.STATE.IDLE;
      this.r.play("idle");
      const p = this._profile();
      const wait =
        overrideMs != null ? overrideMs : WCC.rand(p.idleMin, p.idleMax);
      this._clearTimer();
      this._timer = setTimeout(() => this._tick(), wait);
    }

    async _tick() {
      if (!this.running || this.paused) return;
      const settings = this.getSettings();

      // Peluang tidur bila diaktifkan
      if (settings.behaviors?.sleep && Math.random() < this._sleepChance()) {
        return this._doSleep();
      }

      // FIND_TARGET
      this.state = WCC.STATE.FIND_TARGET;
      const candidates = this.scanner.scan();
      const target = this.selector.pick(candidates, settings, this.r.pos.x);
      if (!target) return this._scheduleIdle();

      // MOVE_TO_TARGET
      this.state = WCC.STATE.MOVE_TO_TARGET;
      this._activeTarget = target;
      const action = WCC.ACTION_BY_TYPE[target.type] || "look";
      const anchor = this.move.anchorFor(action, target.rect);
      const result = await this.move.walkTo(anchor.x, anchor.y);
      if (result === "cancelled" || !this.running || this.paused) return;

      // PERFORM_ACTION
      await this._perform(action, target);
      this._activeTarget = null;
      this._scheduleIdle();
    }

    async _perform(action, target) {
      this.state = WCC.STATE.PERFORM_ACTION;
      this.r.play(action); // renderer fallback ke 'idle' bila sheet belum ada
      const p = this._profile();
      const dur = WCC.rand(p.actionMin, p.actionMax);
      WCC.log("perform", action, "on", target.type, `${Math.round(dur)}ms`);
      await this._sleep(dur);
    }

    _doSleep() {
      this.state = WCC.STATE.SLEEP;
      this.r.play("sleep");
      const dur = WCC.rand(8000, 16000);
      WCC.log("sleep", `${Math.round(dur)}ms`);
      this._clearTimer();
      this._timer = setTimeout(() => this._scheduleIdle(500), dur);
    }

    _sleepChance() {
      const s = this.getSettings();
      return s.activity === "low" ? 0.18 : s.activity === "high" ? 0.05 : 0.1;
    }

    /** Dipanggil interaction.js saat scroll besar membatalkan aksi. */
    onDisrupt() {
      if (this.state === WCC.STATE.MOVE_TO_TARGET) {
        this.move.cancel();
      }
    }

    _sleep(ms) {
      return new Promise((res) => {
        this._clearTimer();
        this._timer = setTimeout(res, ms);
      });
    }

    _clearTimer() {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
    }
  }

  WCC.BehaviorEngine = BehaviorEngine;
})();
