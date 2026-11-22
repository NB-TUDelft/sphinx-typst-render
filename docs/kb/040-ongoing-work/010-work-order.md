---
summary: >-
  The work order (`2026-11-22`): in `editor/biome.json`, add `coverage.mjs`
  and the download menu's script to Biome's files and drop the HTML
  `tabindex` exemption (the maintainer's, behind a local hook).
always_read: true
---

# Work order

Take these in order. When an item is done, delete it here and, if it was more
than a fix, record it at the end of History.

1. **`editor/biome.json`.** In `files.includes`, add `coverage.mjs`, so
   `pnpm run lint` checks it as it does `build.mjs`, and the download menu's
   script, `../src/sphinx_typst_render/static/*.js`, if Biome accepts a path
   outside `editor/` (untried). Until then both are formatted through standard
   input (Documentation and Verification Rules). Also drop the override that
   turns off `a11y/noNoninteractiveTabindex` for `src/**/*.html`: nothing
   needs it since `0bb7961` removed the viewer's `tabindex`. Then `editor.css`
   and `biome.json` itself, left unformatted on purpose, can be formatted too,
   and `pnpm run check` could check formatting (`biome ci`). A local
   config-protection hook stops agents from editing `biome.json`, so this one
   is the maintainer's.
