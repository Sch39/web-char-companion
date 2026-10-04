// Resolves a character id into render data for the Renderer. Shared between
// the content script and the debug/preview page so there's one source of
// truth for where character data comes from.
(() => {
  "use strict";
  const WCC = window.__WCC;

  /**
   * Imported characters live in chrome.storage.local as data URLs; built-in
   * ones ship as packaged files under assets/chars/<id>/.
   * @returns {Promise<{manifest: object, sheets: Record<string,string>}>}
   */
  WCC.loadCharacterData = async function loadCharacterData(id) {
    try {
      const store = await chrome.storage.local.get("wcc.customChars");
      const custom = store["wcc.customChars"]?.[id];
      if (custom?.manifest && custom?.sheets) {
        return { manifest: custom.manifest, sheets: custom.sheets };
      }
    } catch {
      /* fall through to built-in */
    }
    const base = `assets/chars/${id}`;
    const res = await fetch(chrome.runtime.getURL(`${base}/animation.json`));
    if (!res.ok) throw new Error(`character "${id}" not found`);
    const manifest = await res.json();
    const sheets = {};
    for (const [name, def] of Object.entries(manifest.animations)) {
      sheets[name] = chrome.runtime.getURL(`${base}/${def.sheet}`);
    }
    return { manifest, sheets };
  };
})();
