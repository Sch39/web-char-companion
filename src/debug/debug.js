const WCC = window.__WCC;
const $ = (id) => document.getElementById(id);

let charData = null;
let renderer = null;
let currentlyShowing = "ref"; // 'ref' | 'cmp'
let autoFlipTimer = null;

function round(v, decimals) {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

async function getCustomChars() {
  const data = await chrome.storage.local.get("wcc.customChars");
  return data["wcc.customChars"] || {};
}

async function populateCharSelect() {
  const sel = $("charSelect");
  sel.innerHTML = "";
  for (const b of window.WCC_BUILTINS || []) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    sel.appendChild(o);
  }
  const customs = await getCustomChars();
  for (const [id, c] of Object.entries(customs)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = `${c.displayName || id} (imported)`;
    sel.appendChild(o);
  }
  // default to hutao when present — it's the one most likely needing tuning
  if ([...sel.options].some((o) => o.value === "hutao")) sel.value = "hutao";
}

function positionStage() {
  if (!renderer) return;
  const r = $("stage").getBoundingClientRect();
  // keep the -6 in sync with .guide-h's `bottom` in debug.css
  renderer.setPosition(r.left + r.width / 2, r.bottom - 6);
}

function currentCmpDef() {
  return renderer?.defs?.[$("cmpAnim").value];
}

function setTuningInputs(def) {
  if (!def) return;
  $("scaleRange").value = def.scale;
  $("scaleNum").value = def.scale;
  $("offsetXRange").value = def.offsetX;
  $("offsetXNum").value = def.offsetX;
  $("offsetYRange").value = def.offsetY;
  $("offsetYNum").value = def.offsetY;
}

function applyTuning(key, value) {
  const def = currentCmpDef();
  if (!def || Number.isNaN(value)) return;
  def[key] = value;
  if (currentlyShowing === "cmp") renderer._drawFrame();
}

function wireTuningPair(key) {
  const range = $(key + "Range");
  const num = $(key + "Num");
  range.addEventListener("input", () => {
    num.value = range.value;
    applyTuning(key, parseFloat(range.value));
  });
  num.addEventListener("input", () => {
    if (num.value === "" || num.value === "-") return;
    range.value = num.value;
    applyTuning(key, parseFloat(num.value));
  });
}

function updateTuneHint() {
  const name = $("cmpAnim").value;
  $("tuneHint").textContent =
    currentlyShowing === "cmp"
      ? `Editing "${name}" — watch the stage above.`
      : `Editing "${name}" — switch "Show" to Compare to see it live.`;
}

function updateFrameSliderRange() {
  const def = renderer.defs[renderer.current];
  const slider = $("frameSlider");
  slider.max = String(def.frames - 1);
  slider.value = String(renderer.frame);
  $("frameLabel").textContent = renderer.frame;
}

function showAnimation(which) {
  currentlyShowing = which;
  const name = which === "ref" ? $("refAnim").value : $("cmpAnim").value;
  renderer.play(name);
  if ($("freeze").checked) {
    renderer.frame = 0;
    renderer._drawFrame();
  }
  updateFrameSliderRange();
  updateTuneHint();
}

function populateAnimSelectors() {
  const names = Object.keys(charData.manifest.animations);
  for (const sel of [$("refAnim"), $("cmpAnim")]) {
    sel.innerHTML = "";
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    }
  }
  $("refAnim").value = names.includes("idle") ? "idle" : names[0];
  const rest = names.filter((n) => n !== $("refAnim").value);
  $("cmpAnim").value = rest.includes("read") ? "read" : rest[0] || names[0];
}

function stopAutoFlip() {
  if (autoFlipTimer) clearInterval(autoFlipTimer);
  autoFlipTimer = null;
  $("autoFlip").checked = false;
}

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

async function loadChar(id) {
  stopAutoFlip();
  charData = await WCC.loadCharacterData(id);
  renderer?.destroy();
  renderer = new WCC.Renderer();
  await renderer.init(charData);
  positionStage();
  populateAnimSelectors();
  setTuningInputs(currentCmpDef());
  showAnimation(currentlyShowing);
  setStatus("");
}

// --- wiring ------------------------------------------------------------

$("charSelect").addEventListener("change", (e) => loadChar(e.target.value));
$("reload").addEventListener("click", () => loadChar($("charSelect").value));

$("refAnim").addEventListener("change", () => {
  if (currentlyShowing === "ref") showAnimation("ref");
});
$("cmpAnim").addEventListener("change", () => {
  setTuningInputs(currentCmpDef());
  if (currentlyShowing === "cmp") showAnimation("cmp");
  updateTuneHint();
});

$("showWhich").addEventListener("change", (e) => showAnimation(e.target.value));

$("autoFlip").addEventListener("change", (e) => {
  if (e.target.checked) {
    const ms = Math.max(100, parseInt($("flipMs").value, 10) || 700);
    autoFlipTimer = setInterval(() => {
      const next = currentlyShowing === "ref" ? "cmp" : "ref";
      $("showWhich").value = next;
      showAnimation(next);
    }, ms);
  } else {
    stopAutoFlip();
  }
});

$("freeze").addEventListener("change", (e) => {
  renderer.visible = !e.target.checked;
  $("frameSlider").disabled = !e.target.checked;
  if (e.target.checked) updateFrameSliderRange();
});
$("frameSlider").addEventListener("input", (e) => {
  renderer.frame = parseInt(e.target.value, 10);
  renderer._drawFrame();
  $("frameLabel").textContent = e.target.value;
});

for (const key of ["scale", "offsetX", "offsetY"]) wireTuningPair(key);

$("copy").addEventListener("click", async () => {
  const def = currentCmpDef();
  if (!def) return;
  const snippet = JSON.stringify(
    {
      scale: round(def.scale, 2),
      offsetX: round(def.offsetX, 1),
      offsetY: round(def.offsetY, 1),
    },
    null,
    2,
  );
  try {
    await navigator.clipboard.writeText(snippet);
    setStatus(`Copied — paste into "${$("cmpAnim").value}" in animation.json.`, "ok");
  } catch {
    setStatus(snippet); // clipboard blocked; show it so it can be copied by hand
  }
});

window.addEventListener("resize", positionStage);
window.addEventListener("scroll", positionStage, { passive: true });

(async () => {
  await populateCharSelect();
  await loadChar($("charSelect").value);
})();
