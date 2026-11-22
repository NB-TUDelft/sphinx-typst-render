---
summary: >-
  The work order (`2026-11-22`): get the SonarQube gate to `OK` (in progress;
  it failed on 19 reliability and 127 maintainability issues in older code);
  fix the console script with no `main`; decide on the unmerged
  `claude/editor-test-gradient`; add `editor/coverage.mjs` to Biome's files.
always_read: true
---

# Work order

Take these in order. When an item is done, delete it here and, if it was more
than a fix, record it at the end of History.

1. **Get the SonarQube gate to `OK`** (in progress, `2026-11-22`). The gate
   is `ZAM` and fails on the whole codebase, not only on new code (SonarQube
   and coverage, under Reference). The second scan, with JavaScript on the
   `Zam` profile, found 19 reliability issues (`0` allowed) and 127
   maintainability issues (`100` allowed); every new-code condition passed.
   Of the 135 open issues, 112 were in `editor/src/`, including all 19
   reliability ones, 20 in the Python package and 3 elsewhere. Fix them here,
   with the browser test passing after each change to the editor.
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
