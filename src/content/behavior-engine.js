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
      this._focusEl = null; // input element currently being reacted to
      this._alarmHold = false; // an alarm bubble is on screen
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.paused = false;
      this._scheduleIdle(1200);
    }

    pause() {
      this.paused = true;
      this._focusEl = null;
      this._alarmHold = false;
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
      this._focusEl = null;
      this._alarmHold = false;
      this._clearTimer();
      this.move.cancel();
    }

    _profile() {
      const s = this.getSettings();
      return WCC.ACTIVITY_PROFILES[s.activity] || WCC.ACTIVITY_PROFILES.medium;
    }

    _scheduleIdle(overrideMs) {
      if (!this.running || this.paused || this._alarmHold) return;
      this.state = WCC.STATE.IDLE;
      this.r.play("idle");
      const p = this._profile();
      const wait =
        overrideMs != null ? overrideMs : WCC.rand(p.idleMin, p.idleMax);
      this._clearTimer();
      this._timer = setTimeout(() => this._tick(), wait);
    }

    async _tick() {
      if (!this.running || this.paused || this._alarmHold) return;
      const settings = this.getSettings();

      // chance to sleep, if enabled
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
      // A playing video gets its own action (character sits and watches,
      // overridden over the plain "watch" otherwise used for a static video),
      // unless the user turned that reaction off.
      const action =
        target.type === "VIDEO" &&
        target.isPlaying &&
        settings.behaviors?.watchFilm !== false
          ? "watch_film"
          : WCC.ACTION_BY_TYPE[target.type] || "look";
      const anchor = this.move.anchorFor(action, target.rect);
      const result = await this.move.walkTo(anchor.x, anchor.y);
      if (result === "cancelled" || !this.running || this.paused) return;
      if (this._alarmHold) return;

      // PERFORM_ACTION
      this._faceElement(target.el);
      await this._perform(action, target);
      this._activeTarget = null;
      this._scheduleIdle();
    }

    /**
     * Turn toward the element just reached.
     *
     * Travel direction alone gets this wrong, and silently: walkTo() sets
     * facing from the direction of movement, so any action anchored on the
     * *far* side of its target — `look` beside an image, `sneak` past a
     * password field — leaves the character still facing the way it came
     * and therefore turned away from the thing it just walked over to look
     * at. Re-reading the rect here also beats the one captured at scan
     * time, which the walk itself may have outdated.
     */
    _faceElement(el) {
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return;
      const centerX = rect.left + rect.width / 2;
      this.r.setFacing(centerX < this.r.pos.x ? "left" : "right");
    }

    async _perform(action, target) {
      this.state = WCC.STATE.PERFORM_ACTION;
      this.r.play(action); // renderer falls back to 'idle' if the sheet is missing
      const p = this._profile();
      const dur = WCC.rand(p.actionMin, p.actionMax);
      WCC.log("perform", action, "on", target.type, `${Math.round(dur)}ms`);
      await this._sleep(dur);
    }

    /**
     * Sleeping happens in two beats: a short drowsy yawn (`sleepy`) to lead
     * into it, then the `sleep` loop itself. A character with no `sleepy`
     * sheet falls back to `idle` for that first beat, which still reads as
     * settling down before nodding off.
     */
    _doSleep() {
      this.state = WCC.STATE.DROWSY;
      this.r.play("sleepy");
      const dur = WCC.rand(WCC.CONFIG.drowsyMin, WCC.CONFIG.drowsyMax);
      WCC.log("drowsy", `${Math.round(dur)}ms`);
      this._clearTimer();
      this._timer = setTimeout(() => this._enterSleep(), dur);
    }

    /** Second beat of _doSleep() — the actual sleep loop. */
    _enterSleep() {
      // the drowsy beat is a timer gap, so re-check in case of pause/stop
      if (!this.running || this.paused) return;
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

    /**
     * React when the user focuses an input/textarea: stop the routine, walk
     * over to the field, then hold a pose while that field keeps focus (no
     * new target is scheduled meanwhile). No typed content is read — this is
     * purely a reaction to the focus event.
     *
     * A field that looks private (password, card number, one-time code) gets
     * `sneak` instead of `write`, behind its own setting. The two can never
     * both fire: the field is either sensitive or it isn't, and each case
     * checks only its own toggle — so turning the sneak reaction off means
     * the character ignores such fields entirely rather than falling back to
     * leaning in and taking notes at them.
     *
     * @param {Element} el
     * @param {boolean} [sensitive] from interaction.js's _isSensitiveField
     */
    onInputFocus(el, sensitive = false) {
      if (!this.running || this.paused || this._alarmHold) return;
      const b = this.getSettings().behaviors || {};
      if (sensitive ? b.reactToSensitive === false : b.reactToInput === false) {
        return;
      }
      this._focusEl = el;
      this._clearTimer();
      this.move.cancel();
      this._runFocus(el, sensitive ? "sneak" : "write");
    }

    async _runFocus(el, action) {
      const anchor = this.move.anchorFor(action, el.getBoundingClientRect());
      this.state = WCC.STATE.MOVE_TO_TARGET;
      const res = await this.move.walkTo(anchor.x, anchor.y);
      if (res === "cancelled" || this._focusEl !== el || this.paused) return;
      this._faceElement(el);
      this.state = action === "sneak" ? WCC.STATE.SNEAK : WCC.STATE.WRITE;
      this.r.play(action); // falls back to idle until that sheet exists
      WCC.log(`reaction: ${action} at`, el.tagName.toLowerCase());
    }

    /**
     * An alarm is showing: hold still underneath the bubble.
     *
     * `_alarmHold` makes the in-flight `_tick`/`_perform` continuation bail out
     * when it resumes, instead of walking off mid-alarm. The pending timer is
     * deliberately left alone — `_perform` awaits on that same handle, and
     * clearing it would strand the promise and kill the loop for good.
     */
    onAlarmStart(action) {
      this._alarmHold = true;
      this._focusEl = null;
      this.move.cancel();
      this.state = WCC.STATE.ALARM;
      if (action) this.r.play(action);
      else this._playAlarmFallback();
    }

    /** No `alarm` sheet: anything visible beats a frozen idle pose. */
    _playAlarmFallback() {
      for (const name of ["surprised", "happy", "look"]) {
        if (this.r.has(name)) {
          this.r.play(name);
          return;
        }
      }
      this.r.play("idle");
    }

    /** Alarm dismissed — this owns restarting the idle loop. */
    onAlarmEnd() {
      if (!this._alarmHold) return;
      this._alarmHold = false;
      if (!this.running || this.paused) return;
      this._scheduleIdle(900);
    }

    onInputBlur(el) {
      if (this._focusEl !== el) return;
      this._focusEl = null;
      if (!this.running || this.paused) return;
      this.state = WCC.STATE.IDLE;
      this.r.play("idle");
      this._scheduleIdle(1500);
    }

    /** Called by interaction.js when a large scroll should cancel the action. */
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
