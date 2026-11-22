---
summary: >-
  The work order (`2026-11-22`): decide on the one SonarQube finding left, the
  viewer's `tabindex`; fix the console script with no `main`; decide on the unmerged
  `claude/editor-test-gradient`; add `editor/coverage.mjs` to Biome's files.
always_read: true
---

# Work order

Take these in order. When an item is done, delete it here and, if it was more
than a fix, record it at the end of History.

1. **The SonarQube gate's last condition.** Every finding but one is fixed
   (SonarQube findings fixed, under History). The one left is reliability
   finding `Web:S6845`: the `tabindex` on `#viewerContainer` in
   `editor/src/viewer.html`. It makes the page area, pdf.js's scrolling
   region, reachable and scrollable from the keyboard, as in pdf.js's own
   viewer, and `editor/biome.json` exempts the same rule. The maintainer
   decides: accept the finding on the server with that reason, or drop the
   `tabindex` and rely on browsers making scrolling regions focusable (recent
   Chrome and Firefox do; Safari may not).
2. **The console script.** `pyproject.toml` declares
   `sphinx-typst-render = "sphinx_typst_render:main"`, but there is no
   `main`, so the command every install puts on the path fails with
   `ImportError`. Decide whether the package should have a command; then
   either write `main` with a test, or drop `[project.scripts]`.
3. **`claude/editor-test-gradient`.** One commit, `82fe662`, not merged: the
   browser test uses a gradient photo so that crops and flips show. Merge it
   or delete the branch.
4. **Lint `editor/coverage.mjs`.** `files.includes` in `editor/biome.json`
   lists `build.mjs` but not `coverage.mjs`, so `pnpm run lint` skips it. Add
   it there; an agent's edit of `biome.json` was stopped by a local
   config-protection hook, so this one is the maintainer's.
