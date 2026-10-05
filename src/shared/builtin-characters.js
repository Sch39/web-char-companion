// Characters packaged with the extension, plus the helpers the popup,
// options and preview pages use to build their character pickers.
//
// Extensions can't enumerate a packaged directory at runtime, so this list
// has to be written by hand — which means it can drift from what's actually
// in assets/chars/ when a character is moved or dropped. Nothing here
// trusts the list blindly for that reason: WCC_resolveBuiltins() checks each
// entry's files really exist before it reaches a dropdown.
window.WCC_BUILTINS = [{ id: "luna", name: "Luna" }];

/**
 * The packaged characters whose files are actually present. An entry left
 * in WCC_BUILTINS after its assets were removed simply drops out instead of
 * sitting in a picker and failing on selection.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
window.WCC_resolveBuiltins = async function resolveBuiltins() {
  const checked = await Promise.all(
    (window.WCC_BUILTINS || []).map(async (b) => {
      try {
        const res = await fetch(
          chrome.runtime.getURL(`assets/chars/${b.id}/animation.json`),
        );
        return res.ok ? b : null;
      } catch {
        return null;
      }
    }),
  );
  return checked.filter(Boolean);
};

/**
 * Everything that belongs in a character picker: present packaged
 * characters plus imported ones.
 *
 * An import whose id matches a packaged character **replaces** that row
 * rather than adding a second one. Two <option>s sharing a value would
 * leave the picker showing the built-in's label while the loader actually
 * used the import (loadCharacterData checks imports first), so the list
 * would be quietly lying about which character is in use.
 *
 * @param {Record<string, {displayName?: string, manifest?: object}>} customs
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
window.WCC_characterOptions = async function characterOptions(customs) {
  const options = (await window.WCC_resolveBuiltins()).map((b) => ({
    id: b.id,
    label: b.name,
  }));

  for (const [id, c] of Object.entries(customs || {})) {
    const name = c?.displayName || c?.manifest?.displayName || id;
    const at = options.findIndex((o) => o.id === id);
    if (at === -1) {
      options.push({ id, label: `${name} (imported)` });
    } else {
      options[at] = { id, label: `${name} (imported — overrides built-in)` };
    }
  }

  return options;
};
