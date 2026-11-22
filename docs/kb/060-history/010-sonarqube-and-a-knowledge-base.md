---
summary: >-
  Record (`2026-11-22`): SonarQube analysis set up, with Python coverage and
  the editor's coverage from its browser test, and this knowledge base started,
  its index script in Python and checked by the test suite; the checks run, the
  first two scans, and what was left open.
---

# SonarQube and a knowledge base (`2026-11-22`)

At the maintainer's request the repository got the SonarQube setup and the
knowledge-base layout the maintainer already uses on another project.

**SonarQube.** `sonar-project.properties`, `pytest-cov` with its
configuration in `pyproject.toml`, ignore rules for the scanner's and
coverage's output, and the SonarLint binding in `.vscode/settings.json`. The
editor was first left out of coverage for lack of tests; the maintainer asked
for it to be included, so `editor/coverage.mjs` now measures it under the
browser test. How it works, and the c8 pitfall it avoids, are in SonarQube and
coverage, under Reference. `RELEASING.md` gained the step that advances
`sonar.projectVersion`, and `README.md` a short "Code analysis" section.

**Knowledge base.** `AGENTS.md` (with `CLAUDE.md` and `CODEX.md` symlinked to
it) points here; `docs/kb/housekeeping.py` generates the index, and
`tests/test_kb.py` tests it and checks this knowledge base. The first sections
record what the code and the history showed on `2026-11-22`; the Commits and
branches rules describe the practice found in the history, for the
maintainer to confirm.

**Checks run.** `uv run pytest --cov --cov-report=xml`: 52 passed, 1 skipped
(CI only); the package at 88% coverage and `housekeeping.py` at 99%.
`pnpm run coverage` in `editor/`: all 22 browser-test checks passed, the
editor at 74.4% of lines, and the release build came back without source
maps. `pnpm run lint` in `editor/` reported no new findings; `coverage.mjs`,
which its configuration does not yet include (work order), was linted with
the same rules through standard input and came out clean.

**First scans.** The first `sonar-scanner` run created the project; the gate
failed on the whole codebase (19 reliability, 117 maintainability issues).
Two of its findings were in this change's new files and nine more in files it
touched (`editor/build.mjs`, `tools/editor_test.py`); all eleven were fixed,
`build.mjs`'s with a byte-for-byte comparison of the release bundle before
and after. The second scan, by then with JavaScript on the `Zam` profile,
passed every new-code condition with 100% coverage on new code; the gate stays
red on old code, which is item 2 of the work order.

**Left open.** The graph tooling the other project pairs with its knowledge
base was not set up.
