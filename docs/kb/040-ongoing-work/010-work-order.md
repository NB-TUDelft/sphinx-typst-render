---
summary: >-
  The work order (`2026-11-22`): in `editor/biome.json`, lint `coverage.mjs`
  and drop the HTML `tabindex` exemption.
always_read: true
---

# Work order

Take these in order. When an item is done, delete it here and, if it was more
than a fix, record it at the end of History.

1. **`editor/biome.json`.** Add `coverage.mjs` to `files.includes`, so
   `pnpm run lint` checks it as it does `build.mjs`; and drop the override
   that turns off `a11y/noNoninteractiveTabindex` for `src/**/*.html`, which
   nothing needs since `0bb7961` removed the viewer's `tabindex`. An agent's
   edit of `biome.json` was stopped by a local config-protection hook, so this
   one is the maintainer's.
