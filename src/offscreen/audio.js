// Audio lives here because a page-side <audio> is governed by the host page's
// autoplay policy: an alarm firing in a tab the user hasn't clicked gets
// NotAllowedError and rings silently. An extension-owned document has no such
// restriction, and it keeps playing while tabs are muted or switched away.
(() => {
  "use strict";

  let audio = null;
  let deadline = null;

  // The looping sound never falls silent, so the AUDIO_PLAYBACK auto-close
  // never kicks in, and the worker that started it may be terminated before it
  // can say stop. Owning the deadline here is what guarantees the alarm
  // eventually goes quiet.
  const MAX_RING_MS = 60000;

  function stop() {
    if (deadline) clearTimeout(deadline);
    deadline = null;
    if (!audio) return;
    try {
      audio.pause();
      audio.src = "";
    } catch {
      /* already torn down */
    }
    audio = null;
  }

  function play({ url, volume, maxMs }) {
    stop();
    const el = new Audio(url);
    el.loop = true;
    el.volume = typeof volume === "number" ? volume : 0.7;
    audio = el;
    deadline = setTimeout(stop, typeof maxMs === "number" ? maxMs : MAX_RING_MS);
    return el.play().then(
      () => ({ ok: true }),
      (err) => {
        if (audio === el) stop();
        return { ok: false, error: err?.name || "PlaybackFailed" };
      },
    );
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== "wcc-offscreen") return;

    if (msg.type === "WCC_AUDIO_PLAY") {
      play(msg).then(sendResponse);
      return true; // async
    }

    if (msg.type === "WCC_AUDIO_STOP") {
      stop();
      sendResponse({ ok: true });
      return false;
    }
  });
})();
