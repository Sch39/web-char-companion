(() => {
  "use strict";
  const WCC = window.__WCC;
  const A = window.WCC_ALARM;

  class AlarmPresenter {
    constructor({ renderer, movement, behavior }) {
      this.r = renderer;
      this.move = movement;
      this.behavior = behavior;
      this.activeRingId = null;
      this._onStorage = this._onStorage.bind(this);
      this._onFocus = this._onFocus.bind(this);
    }

    start() {
      chrome.storage.onChanged.addListener(this._onStorage);
      // A ring that nobody could show stays pending; coming back to the tab is
      // the moment to pick it up.
      window.addEventListener("focus", this._onFocus);
      document.addEventListener("visibilitychange", this._onFocus);
      this._checkPending();
    }

    stop() {
      chrome.storage.onChanged.removeListener(this._onStorage);
      window.removeEventListener("focus", this._onFocus);
      document.removeEventListener("visibilitychange", this._onFocus);
      this.activeRingId = null;
    }

    _onStorage(changes, area) {
      if (area !== "session" || !changes[A.RING_KEY]) return;
      const ring = changes[A.RING_KEY].newValue;
      if (!ring) {
        // Cleared elsewhere (dismissed or snoozed in another tab).
        if (this.activeRingId) this._close(false);
        return;
      }
      this._consider(ring);
    }

    _onFocus() {
      // Showing a bubble in a tab the user just left would keep the ring to
      // ourselves while nobody can see it, so give it up and let whichever tab
      // they look at next take over.
      if (this.activeRingId && !this._isVisible()) {
        const ringId = this.activeRingId;
        this.activeRingId = null;
        this.r.hideBubble();
        this.behavior?.onAlarmEnd?.();
        chrome.runtime
          .sendMessage({ type: "WCC_RELEASE_RING", ringId })
          .catch(() => {});
        return;
      }
      this._checkPending();
    }

    async _checkPending() {
      try {
        const data = await chrome.storage.session.get(A.RING_KEY);
        const ring = data[A.RING_KEY];
        if (ring) this._consider(ring);
      } catch {
        // storage.session not reachable from this context; nothing to show.
      }
    }

    _isVisible() {
      return document.visibilityState === "visible" && document.hasFocus();
    }

    async _consider(ring) {
      if (!ring || this.activeRingId === ring.ringId) return;
      if (Date.now() - ring.firedAt > A.RING_EXPIRY_MS) return;
      if (!this._isVisible()) return;

      // Whether an existing claim blocks this one is the background's call —
      // it lets the same tab re-claim, which is what makes a reload mid-alarm
      // recover its own bubble instead of losing it.

      let granted = false;
      try {
        const res = await chrome.runtime.sendMessage({
          type: "WCC_CLAIM_RING",
          ringId: ring.ringId,
        });
        granted = !!res?.granted;
      } catch {
        granted = false;
      }
      if (!granted) return;

      this._present(ring);
    }

    _present(ring) {
      this.activeRingId = ring.ringId;

      const action = this.r.has("alarm") ? "alarm" : null;
      this.behavior?.onAlarmStart?.(action);

      // The OS notification already announced this one; seeing the character
      // deliver it makes the duplicate in the tray redundant.
      chrome.runtime
        .sendMessage({ type: "WCC_NOTIFICATION_SEEN", ringId: ring.ringId })
        .catch(() => {});

      this.r.showBubble({
        label: ring.label || "Alarm",
        time: A.formatTime(ring.time),
        note: "",
        actions: [
          { label: "Snooze 5m", onClick: () => this._snooze(ring.alarmId) },
          { label: "OK", primary: true, onClick: () => this._close(true) },
        ],
      });
    }

    async _snooze(alarmId) {
      const ringId = this.activeRingId;
      this._close(false);
      try {
        await chrome.runtime.sendMessage({
          type: "WCC_SNOOZE_ALARM",
          alarmId,
          ringId,
        });
      } catch {
        /* worker asleep; the schedule is re-derived on its next startup */
      }
    }

    /** `release` clears the shared ring record so other tabs drop it too. */
    _close(release) {
      const ringId = this.activeRingId;
      this.r.hideBubble();
      this.activeRingId = null;
      this.behavior?.onAlarmEnd?.();
      if (release) {
        chrome.runtime
          .sendMessage({ type: "WCC_DISMISS_ALARM", ringId })
          .catch(() => {});
      }
    }
  }

  WCC.AlarmPresenter = AlarmPresenter;
})();
