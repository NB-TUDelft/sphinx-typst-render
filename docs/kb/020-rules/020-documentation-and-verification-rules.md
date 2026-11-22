---
summary: >-
  Standing rules: tests ship with behaviour changes; Python is formatted with
  Ruff and JavaScript with Biome; the gate before a commit (Ruff's check and
  pytest with coverage, then for editor changes Biome, the build and the
  browser test with coverage, then SonarQube `OK`); fix touched-file issues;
  never weaken a check; small commits; record the checks run; keep this
  knowledge base current while working.
always_read: true
---

# Documentation and Verification Rules

- Keep `README.md` as the entry point and link deeper docs from it.
- Add or update tests in the same change as a behaviour change: `tests/` for
  the Python package, `tools/editor_test.py` for the editor.
- Format what you touch before committing: Python with `uv run ruff format`
  (settings in `pyproject.toml`), JavaScript with
  `pnpm exec biome check --write --linter-enabled=false <files>` in `editor/`
  (the settings in `editor/biome.json`: layout, and imports sorted). Until the
  work order's `biome.json` item lands, `coverage.mjs` and the download menu's
  `static/typst-render.js` are outside Biome's file list; format them through
  standard input, `pnpm exec biome format --stdin-file-path=build.mjs`.
  The two whole-tree formatting commits are in `.git-blame-ignore-revs`.
- Run the gate on the finished working tree, before committing, in this order:
  1. `uv run ruff format --check .`, then
     `uv run pytest --cov --cov-report=xml`: the tests, this knowledge base's
     index check, and `coverage.xml`.
  2. When `editor/` changed, or there is no `editor/coverage/lcov.info` yet:
     `pnpm run check` in `editor/` (Biome, then the build), then
     `pnpm run coverage` there, which runs the browser test and writes the
     editor's coverage.
  3. `sonar-scanner`, then poll the analysis until the quality gate is `OK`
     (SonarQube and coverage, under Reference).

  Fix what the gate finds, rerun the affected checks and the coverage, and
  rescan until it passes; only then commit.
- While touching a file, fix the existing issues in it that are reasonable to
  fix in the same change: SonarQube and Biome findings and obvious
  maintainability problems. Keep unrelated whole-tree cleanup in a change of
  its own.
- Never weaken a check, a test or an analysis rule to make a change pass.
- Prefer small commits, one concern each.
- Before calling work complete, record the exact checks run and any known gaps
  in the commit message or the handoff note.
- Keep this knowledge base current while you work: update the work order as
  items start and finish, and write down what the next person would otherwise
  have to rediscover, so an interrupted task can be picked up from here.
