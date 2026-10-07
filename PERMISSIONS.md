# Permission justifications

Single purpose of the extension: display an animated character overlay on web
pages that reacts to page structure, and ring user-configured alarms.

## Required permissions

### `storage`

Stores the user's settings (character choice, activity level, which reactions
are enabled, per-site rules, auto-disable keywords) and the alarm list. Also
used for per-tab state that must not outlive the browser session: which
character a tab was given and where the character was last standing, both kept
in `chrome.storage.session`.

Used in: `src/background/service-worker.js`, `src/popup/popup.js`,
`src/options/options.js`, every content script.

### `unlimitedStorage`

A user-imported character is a set of PNG sprite sheets stored locally as data
URLs. A single character can exceed the default `storage.local` quota, so
without this an import of ordinary size fails. Only user-supplied files are
stored, and only in the local profile.

Used in: `src/options/options.js` (character import).

### `activeTab`

The popup shows per-site controls ("always on here", "disable here"), which
requires the hostname of the tab the user is currently looking at
(`chrome.tabs.query({active: true, currentWindow: true})`). The popup also
messages that tab's content script so a setting change takes effect
immediately instead of on the next reload. Nothing is read out of the page —
only the active tab's URL, and only while the popup is open.

Used in: `src/popup/popup.js`.

### `alarms`

Wakes the extension's service worker when a user-set alarm time is due. MV3
service workers are terminated when idle, so a timer alone cannot survive until
the alarm fires. `chrome.alarms` is granularity-limited, so it is used to wake
the worker slightly early and a short in-worker timer lands on the exact second.

A second, short-lived alarm (`wcc.ringEnd`) ends a ring that nothing dismissed.
It is used instead of a timer because the worker can be terminated mid-ring.

Used in: `src/background/service-worker.js`.

### `offscreen`

Plays the alarm sound. The sound was previously played from the content script,
which made it the host page's audio: browser autoplay policy then refused
playback with `NotAllowedError` in any tab the user had not yet interacted
with, so alarms rang silently and the user had no way to fix it (there is no
web API to request audio permission, and the padlock menu's "Sound" control is
a per-site mute toggle, not a grantable permission).

Playback now happens in a hidden extension-owned document created with
`reasons: ["AUDIO_PLAYBACK"]`. The document exists only while an alarm is
actually ringing and is closed on dismiss, snooze, or a 60-second ring
deadline. That deadline is enforced in two independent places — a
`chrome.alarms` entry (which survives service-worker termination) and a timer
inside the document itself — so no combination of worker shutdown and looping
audio can leave a sound playing. It loads only the bundled chime or a sound
file the user imported themselves.

This permission shows no install-time warning and grants no access to page
content, browsing data, or the network.

Used in: `src/background/service-worker.js` (lifecycle),
`src/offscreen/audio.html` + `src/offscreen/audio.js` (playback).

## Optional permission

### `notifications`

Requested at runtime, only when the user enables alarms, and the extension
still rings without it.

An alarm is announced as a system notification with "Snooze 5m" and "Dismiss"
buttons, so it can be acted on while the browser is in the background. This is
the primary way an alarm reaches the user: the character's speech bubble only
appears in tabs where the companion is actually running and which currently
have focus, so a user working in another application would otherwise get no
visible alarm at all. The notification is retracted automatically when a tab
does show the bubble, or when the alarm is dismissed or snoozed anywhere.

If the permission is declined, the popup says so and offers to request it
again, rather than letting alarms fail quietly.

Used in: `src/background/service-worker.js` (`notifyRing`, the button
handlers), `src/popup/popup.js` (the request and the warning).

## Host permissions

### `http://*/*`, `https://*/*` (content script matches)

The extension's purpose is a companion that appears on the pages the user
browses, so the overlay has to be injected on ordinary web pages. The match
pattern is in `content_scripts`, not `host_permissions`; no page is fetched and
no cross-origin request is made.

What the content scripts read:

- The geometry and type of visible elements (headings, images, videos, buttons,
  paragraphs) to choose where the character walks and which reaction to play.
- Focus events on form fields, to trigger the "take notes" reaction. The value
  of a field is never read.
- Attributes and visible label text of a focused field, to decide whether it
  looks sensitive (password, card number, OTP…) and should get the "tiptoe
  past" reaction instead. The value is still never read.
- Whether a `<video>` is currently playing, read from the element's own
  `paused`/`readyState` properties.

A second, minimal script runs in all frames for the single purpose of reporting
a "video is playing" boolean out of cross-origin iframes, which the top frame
cannot otherwise see.

## Remote code

None. No `eval`, no remotely hosted scripts, no CDN, no package manager. All
HTML, CSS, and JavaScript ships in the package.

The two `fetch` calls in the source (`src/shared/character-loader.js`,
`src/shared/builtin-characters.js`) both read a bundled `animation.json`
through `chrome.runtime.getURL`, i.e. a file inside the extension package.
Neither contacts a remote host.

## Data collection

None. The extension has no server, no analytics, and contacts no remote host.
All settings, imported characters, and alarms stay in the browser's local
profile (`chrome.storage`), except settings the user's browser chooses to sync
via `chrome.storage.sync`, which is handled by the browser rather than by this
extension.

For the store's data-disclosure form, every category should be answered "not
collected": personally identifiable information, health information, financial
information, authentication information, personal communications, location, web
history, user activity, and website content.
