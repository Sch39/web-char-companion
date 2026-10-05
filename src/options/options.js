const CUSTOM_KEY = "wcc.customChars";
const $ = (id) => document.getElementById(id);

function readText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function getCustoms() {
  const data = await chrome.storage.local.get(CUSTOM_KEY);
  return data[CUSTOM_KEY] || {};
}

async function setCustoms(map) {
  await chrome.storage.local.set({ [CUSTOM_KEY]: map });
}

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

/** Validate a parsed manifest and return the list of referenced sheet files. */
function validateManifest(m) {
  if (!m || typeof m !== "object") throw new Error("animation.json is not an object.");
  if (typeof m.id !== "string" || !/^[a-z0-9_-]+$/.test(m.id))
    throw new Error('Missing or invalid "id" (use lowercase letters, digits, - or _).');
  if (!m.animations || typeof m.animations !== "object")
    throw new Error('Missing "animations".');
  const entries = Object.entries(m.animations);
  if (!entries.length) throw new Error('"animations" is empty.');
  const needed = {}; // animName -> sheet filename
  for (const [name, def] of entries) {
    if (!def || typeof def.sheet !== "string")
      throw new Error(`Animation "${name}" is missing a "sheet".`);
    needed[name] = def.sheet;
  }
  return needed;
}

async function onImport() {
  try {
    setStatus("Importing…");
    const mFile = $("manifestFile").files[0];
    const sheetFiles = [...$("sheetFiles").files];
    if (!mFile) throw new Error("Choose an animation.json file.");
    if (!sheetFiles.length) throw new Error("Choose the sprite sheet PNG(s).");

    let manifest;
    try {
      manifest = JSON.parse(await readText(mFile));
    } catch {
      throw new Error("animation.json is not valid JSON.");
    }
    const needed = validateManifest(manifest);

    // index uploaded files by name
    const byName = {};
    for (const f of sheetFiles) byName[f.name] = f;

    const sheets = {};
    for (const [animName, fileName] of Object.entries(needed)) {
      const f = byName[fileName];
      if (!f) throw new Error(`Missing sprite sheet file: ${fileName}`);
      sheets[animName] = await readDataUrl(f);
    }

    const id = manifest.id;
    const displayName =
      $("displayName").value.trim() || manifest.displayName || id;

    const customs = await getCustoms();
    customs[id] = { manifest, sheets, displayName };
    await setCustoms(customs);

    $("displayName").value = "";
    $("manifestFile").value = "";
    $("sheetFiles").value = "";
    setStatus(`Imported "${displayName}".`, "ok");
    renderList();
  } catch (e) {
    setStatus(e.message || String(e), "err");
  }
}

async function removeChar(id) {
  const customs = await getCustoms();
  delete customs[id];
  await setCustoms(customs);
  renderList();
}

async function renderList() {
  const customs = await getCustoms();
  const ul = $("list");
  ul.innerHTML = "";
  const ids = Object.keys(customs);
  if (!ids.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No imported characters yet.";
    ul.appendChild(li);
  } else {
    for (const id of ids) {
      const c = customs[id];
      const li = document.createElement("li");
      const left = document.createElement("div");
      const anims = Object.keys(c.manifest?.animations || {}).length;
      left.innerHTML =
        `<div class="name"></div><div class="meta">id: ${id} · ${anims} animation(s)</div>`;
      left.querySelector(".name").textContent = c.displayName || id;
      const del = document.createElement("button");
      del.className = "btn small";
      del.textContent = "Delete";
      del.addEventListener("click", () => removeChar(id));
      li.append(left, del);
      ul.appendChild(li);
    }
  }

  // resolved, not the raw list — a packaged character whose assets were
  // removed shouldn't be advertised as available
  const builtins = (await window.WCC_resolveBuiltins())
    .map((b) => b.name)
    .join(", ");
  $("builtins").textContent = builtins
    ? `Built-in: ${builtins}`
    : "No built-in characters are available — import one above.";
}

$("import").addEventListener("click", onImport);
$("openPreview").addEventListener("click", () => {
  window.open(chrome.runtime.getURL("src/debug/debug.html"), "_blank");
});
renderList();
