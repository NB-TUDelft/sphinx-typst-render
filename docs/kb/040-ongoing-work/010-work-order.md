---
summary: >-
  The work order (`2026-11-22`): bring in `origin/main`'s 1.1.2 and advance
  `sonar.projectVersion`; get the SonarQube gate to `OK` (fails on 19
  reliability and 127 maintainability issues, mostly in the ported editor);
  fix the console script with no `main`; correct README's stale "Not
  ported" note on dropped images; decide on the unmerged
  `claude/editor-test-gradient`; add `editor/coverage.mjs` to Biome's files.
always_read: true
---

# Work order

Take these in order. When an item is done, delete it here and, if it was more
than a fix, record it at the end of History.

1. **Bring in `origin/main`.** `0a7c4da` (#7, blank image pages and the
   restore banner size) is on `origin/main` but not yet in the local `main`
   this knowledge base was started on. It bumps the version to 1.1.2 and
   touches `tools/editor_test.py`, `pyproject.toml` and `uv.lock`, which the
   SonarQube change also touched. After merging, set `sonar.projectVersion` to
   the package version and rerun the gate.
2. **Get the SonarQube gate to `OK`.** The first scans (`2026-11-22`) created
   the project; the gate is `ZAM` and fails on the whole codebase, not on new
   code (SonarQube and coverage, under Reference). After the second scan, with
   JavaScript on the `Zam` profile: 19 reliability issues (`0` allowed) and
   127 maintainability issues (`100` allowed); every new-code condition
   passed. Of the 135 open issues, 112 are in `editor/src/`, including all 19
   reliability ones (`replace` over `replaceAll`, global `parseFloat`,
   unhandled promises, regular expressions with super-linear backtracking, a
   `tabindex` on a non-interactive element), 20 in the Python package and 3
   elsewhere. Fixing `editor/src/` moves it away from the EI_Logbooks editor it
   follows, which makes the module-by-module port of later changes (`README.md`,
   "Developing the editor") harder; decide with the maintainer whether to fix
   it here, upstream first, or both.
3. **The console script.** `pyproject.toml` declares
   `sphinx-typst-render = "sphinx_typst_render:main"`, but there is no
   `main`, so the command every install puts on the path fails with
   `ImportError`. Decide whether the package should have a command; then
   either write `main` with a test, or drop `[project.scripts]`.
4. **README, "Developing the editor".** It still says labelling images
   dragged onto a page was not ported, but `772f258` ported it, and the
   browser test checks it (`07b_loose_photo_labelled`).
5. **`claude/editor-test-gradient`.** One commit, `82fe662`, not merged: the
   browser test uses a gradient photo so that crops and flips show. Merge it
   or delete the branch.
6. **Lint `editor/coverage.mjs`.** `files.includes` in `editor/biome.json`
   lists `build.mjs` but not `coverage.mjs`, so `pnpm run lint` skips it. Add
   it there; an agent's edit of `biome.json` was stopped by a local
   config-protection hook, so this one is the maintainer's.
