# Web Chibi Companion

A chibi virtual companion that lives on top of any web page. It walks around,
reads headings, looks at images, sits on buttons, reacts when you type, and
dozes off when idle — a small, playful presence that never gets in the way.

> Manifest V3 browser extension (Chrome / Edge / Chromium). No build step, no
> dependencies — plain HTML, CSS, and JavaScript.

---

## Features

- **Lives on the page** — a transparent overlay in a Shadow DOM. It never
  changes the page layout and, by default, doesn't block your clicks.
- **Context-aware behavior** — scans visible elements (headings, images,
  videos, buttons, paragraphs…), scores them, and picks a target with a bit of
  randomness so it never feels like a scripted loop.
- **Contextual actions** — reads headings/paragraphs, looks at images, sits on
  buttons, watches videos, and takes notes while you type. A video that's
  actually *playing* (including inside an embedded YouTube/Vimeo-style
  iframe) heavily favors a dedicated "watching a film" reaction over the
  usual random picks.
- **Interactive** — click it for a quick reaction, or drag it anywhere; it stays
  where you drop it, then resumes on its own.
- **Stays out of the way** — pause anytime, keep it clear of fixed/sticky site
  headers, and respect `prefers-reduced-motion`.
- **Per-tab characters** — optionally give one tab its own character without
  affecting the others.
- **Remembers where it was** — each tab keeps the character's last position,
  so a hard refresh or an in-page navigation resumes roughly where it left
  off instead of respawning at the default spot.
- **Per-site control** — always on, always off, or automatic; plus a keyword
  list that auto-hides the companion on sensitive URLs (login, banking, …).

## Privacy

The companion reads only the **structure** of the page (which elements exist and
where they are) to decide where to walk. It does **not** read, store, or send
the text you type, your clipboard, form values, or page content. Everything runs
locally in your browser; there is no server and no analytics.

The "take notes while typing" reaction is triggered purely by focus events on
input fields — the typed text is never inspected.

Detecting playback inside a cross-origin iframe (e.g. a YouTube embed) needs a
small, dependency-free script injected into every frame on every page, since a
page can't normally see into another origin's iframe. It only reports a
"video is playing" boolean to the top frame — nothing about the iframe's
content is read. That signal isn't cryptographically verified, so a page could
in theory spoof it; the only consequence is a cosmetic one (the companion
reacts to a false signal), never a data or permission issue.

For video in the page itself, playback state is read straight off the
`<video>` element's own `paused`/`readyState` properties at the moment it's
needed — no event bookkeeping, and nothing about the media is inspected
beyond "is it running". That also means players built on Media Source
Extensions (Shaka Player, hls.js, dash.js, video.js…) work without the
extension knowing anything about the library: they all drive a real
`<video>` element underneath.

Decorative background video is left alone. A clip that is muted, looping,
has no controls, and runs under `CONFIG.decorativeMaxDurationSec` (30s) reads
as a hero/banner loop, so the companion won't settle in to watch it — it
stays an ordinary video target instead. Set that value to `0` to react to
every playing video.

---

## Installation (load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the `web-char-companion` folder (the one
   containing `manifest.json`).
5. Open any website — the companion appears and starts wandering.

Click the extension icon to open the settings popup.

## Usage

- **Click** the character for a quick reaction.
- **Drag** it to reposition; release to drop it there.
- **Type** in a text field and it walks over to "take notes".
- Open the **popup** to change character, activity level, which reactions are
  enabled, per-site behavior, and to pause/resume.

### Settings

| Setting              | What it does |
| -------------------- | ------------ |
| Enabled              | Master on/off. |
| Character            | Which character to show. |
| This tab only        | Use the selected character for the current tab only. |
| Activity             | How often it moves (Low / Medium / High). |
| Page reactions       | Toggle read / look / sit / sleep / take-notes / watch-videos individually. |
| Reduce motion        | Keep it still (also honored automatically via the OS setting). |
| Site rule            | Default (auto) / Always on here / Disable here, per domain. |
| Auto-disable         | Keywords that hide the companion when the URL contains them. |

---

## Project structure

```
web-char-companion/
├── manifest.json              # MV3 manifest: permissions, scripts, popup, options
├── icons/                     # extension icons
├── assets/
│   └── chars/
│       ├── animation.schema.json  # JSON schema for editor autocomplete
│       └── luna/               # default character (original art)
│           ├── idle.png        # one sprite sheet per action
│           ├── walk.png
│           ├── …
│           └── animation.json
└── src/
    ├── shared/
    │   ├── constants.js        # shared namespace, defaults, tuning
    │   ├── character-loader.js # resolves a character id to render data
    │   └── builtin-characters.js  # list of bundled characters
    ├── content/                # runs on the page (load order set in manifest)
    │   ├── renderer.js          # Shadow DOM overlay + sprite animation
    │   ├── video-watcher.js     # tracks which videos are playing (top frame)
    │   ├── video-watcher-frame.js  # reports video playback from inside iframes
    │   ├── dom-scanner.js       # finds visible targets, detects fixed bars
    │   ├── target-selector.js   # scores & picks a target
    │   ├── movement-engine.js   # walks to a target on a visual plane
    │   ├── behavior-engine.js   # state machine (idle → move → act → idle)
    │   ├── interaction.js       # click, drag, scroll, typing reactions
    │   └── index.js             # bootstrap, boot sequencing, SPA navigation
    ├── background/
    │   └── service-worker.js   # defaults, per-tab character storage
    ├── popup/                  # quick settings UI
    │   ├── popup.html
    │   ├── popup.css
    │   └── popup.js
    ├── options/               # import & manage characters
    │   ├── options.html
    │   ├── options.css
    │   └── options.js
    └── debug/                 # animation preview/tuning page (dev tool)
        ├── debug.html
        ├── debug.css
        └── debug.js
```

Content scripts don't use ES modules (an MV3 constraint for scripts listed in
the manifest). Each module attaches to a shared `window.__WCC` namespace and is
loaded in dependency order from `manifest.json` (`constants.js` first).

For debugging, run `window.__WCC_DEBUG = true` in the page console to see
behavior logs.

---

## Characters & animations

A character is a folder under `assets/chars/<id>/` containing an
`animation.json` and one sprite sheet per animation.

### Sprite sheet format

- A sheet is a uniform grid of frames (e.g. 5 columns × 3 rows).
- Every frame is the same size (the default here is 256 × 256 px).
- Frames are read left → right, then top → bottom.
- Transparent background (PNG with alpha), one centered character per frame,
  feet on a consistent baseline.

### `animation.json`

```json
{
  "id": "luna",
  "displayName": "Luna",
  "sprite": { "frameWidth": 256, "frameHeight": 256 },
  "renderScale": 0.5,
  "defaultFacing": "right",
  "animations": {
    "idle": { "sheet": "idle.png", "columns": 4, "rows": 2, "frames": 8, "fps": 10, "loop": true },
    "walk": { "sheet": "walk.png", "columns": 4, "rows": 2, "frames": 8, "fps": 14, "loop": true },
    "read": { "sheet": "read.png", "columns": 6, "rows": 2, "frames": 12, "fps": 8, "loop": true, "scale": 0.8 }
  }
}
```

- `sprite` is the **default** grid for all animations. Each animation inherits
  it and may override any field (`columns`, `rows`, `frames`, `fps`, …) when its
  sheet differs — this is required whenever a sheet's grid isn't the default.
- `renderScale` sets the on-screen size (0.5 = half the frame size).
- `defaultFacing` is the direction the sheet is drawn in; the renderer mirrors
  it automatically for the opposite direction.
- `scale` (optional, per animation, default `1`) corrects sheets that draw the
  character larger or smaller within their cell than the others — without it,
  switching to that animation looks like a sudden zoom. It scales from the
  bottom-center, so `offsetX`/`offsetY` (px) are available to nudge the result
  back onto the same baseline if needed.
- `idleFootGap` (optional, top-level, default `0`) is the gap between idle's
  own drawn feet and the position anchor (the sprite box's edge, which is what
  movement targets actually aim at — not the drawn feet). `scale`/`offsetY`
  above only keep every animation's feet matching *idle's* gap, so switching
  animations doesn't jump; they don't make the anchor itself land exactly on a
  target element. Behavior that needs real contact (e.g. "sit" standing flush
  on top of a button) adds `idleFootGap` back in when computing where to walk.
  Measure it once from idle's sheet with the animation preview page.
- `animations` keys **are** the action names — behavior code plays an action
  by using its name as the key directly, so there's no mapping table to keep
  in sync. The full set is `idle`, `walk`, `hop`, `read`, `look`, `sit`,
  `watch`, `watch_film`, `write`, `sleepy`, `sleep`, `happy`, `surprised`;
  the schema rejects anything else, since an entry under another name would
  never play. Only `idle` is required — every other action falls back to it
  when its sheet is absent, so a character can ship with just `idle` and
  grow from there.
- `sleepy` and `sleep` are one sequence: the random sleep state plays
  `sleepy` as a short yawn first (`CONFIG.drowsyMin`–`drowsyMax`), then
  settles into the `sleep` loop.
- `walk` and `hop` are *travel* animations rather than destination actions:
  `movement-engine.js` picks between them by the angle of travel, switching to
  `hop` past `CONFIG.steepWalkAngleDeg`, since a horizontal walk cycle looks
  like it's sliding sideways once travel isn't mostly left-right.

The `$schema` field points at `assets/chars/animation.schema.json`, which gives
autocomplete and validation in editors like VS Code and JetBrains — the
animation names autocomplete from the schema, and hovering one explains
exactly when that action fires.

### Adding a new animation

1. Add the sprite sheet to the character folder (e.g. `look.png`).
2. Register it under `animations` with its grid and fps. The key must be one
   of the action names above — start typing inside `animations` and the
   editor will offer the ones you haven't used yet.

### Adding a bundled character

Create `assets/chars/<id>/` with its own `animation.json` and sheets, then add
it to `src/shared/builtin-characters.js` so it shows up in the picker.

### Import your own character (no file editing)

Right-click the extension icon → **Options** (or click "Manage characters…" in
the popup). Pick an `animation.json` and all the sprite sheet PNGs it
references, then **Import**. The character is stored locally in your browser and
appears in the popup's character picker; delete it anytime from the same page.
Nothing is uploaded anywhere.

### Tuning animations (animation preview)

Open **Options → Open animation preview** to compare two animations of a
character side by side on a shared ground line, with live sliders for `scale`,
`offsetX`, and `offsetY`. It's the fastest way to fix a size or baseline
mismatch between sheets — e.g. a character that visibly jumps when switching
from `idle` to another action — without repeatedly reloading the extension on
a real page. "Copy JSON" gives you the tuned fields to paste into
`animation.json`.

---

## Permissions

| Permission            | Why |
| --------------------- | --- |
| `storage`             | Save settings and per-tab character choices. |
| `unlimitedStorage`    | Store imported character sprite sheets locally. |
| `activeTab`           | Read the active tab's URL in the popup for per-site rules. |
| `scripting`           | Standard for the content overlay. |
| `http://*`, `https://*` | Run the overlay on web pages. |

No background network access, no data collection.

---

## Development

- Edit any file and click the reload icon on the extension card in
  `chrome://extensions`, then refresh the page.
- Changes to the popup or service worker require that reload; most content
  changes just need a page refresh.
- The code targets modern Chromium and uses no bundler or package manager.

---

## Assets & attribution

The bundled character (`luna`) is original artwork, covered by the project
license. No third-party character art ships with the extension. See
[`NOTICE.md`](NOTICE.md), and make sure you have the rights to any character
art you add or distribute yourself.

## License

The source code is released under the MIT License (see [`LICENSE`](LICENSE)).
The license covers the code only, not the bundled art (see above).

## Contributing

Issues and pull requests are welcome. Please keep the extension dependency-free
and lightweight, and make sure new behavior can be disabled from the settings.
