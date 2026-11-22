---
summary: >-
  Record (`2026-11-22`): the broken console script dropped; the JavaScript
  formatted with Biome and the Python with Ruff; browser-test checks 22 to 30,
  which found live hints missing on every reopened export (fixed); c8's wrong
  sum of coverage snapshots replaced by one in `coverage.mjs`; the SonarQube
  gate `OK` again at 89.0% coverage on new code.
---

# Formatting, live hints and the coverage sum (`2026-11-22`)

After the clean-up above, the maintainer asked for the work order to be
worked through and for all JavaScript and Python to be formatted.

- `403a1e5`: the `sphinx-typst-render` console script, a template leftover
  pointing at a `main` that never existed, is gone; `tests/test_metadata.py`
  loads every entry point the package declares.
- `2bd3851`: every JavaScript file formatted with the editor's Biome settings,
  imports sorted, the linter's fixes off. `editor.css` and `biome.json` were
  left alone (Work order).
- `c4b8d4b`: every Python file formatted with Ruff, a dev dependency now,
  line length 120 to match how the code was written.

The formatting turned nearly every line into new code for SonarQube, so the
gate's coverage condition fell to 76.9%. Rather than move the new-code period,
the browser test gained checks 22 to 30 (`a75679c`): text pages, live hints,
exporting from the toolbar through the overflow dialog, dialogs and the
keyboard, the page overview, zoom, downloading an editable copy, and
restoring or discarding saved work. They found a bug older than this
session: on an export opened again, no box had live hints, because each
page's fields were cached by page number alone and an export first opens
flattened, without fields. The cache is now per document.

The coverage still read low where it should not: the restore bar showed as
never run though its button's handler had. c8 adds V8 snapshots up wrongly
after an `await`; `coverage.mjs` now reports each snapshot alone and adds
them up itself (`1bf0b1b`, `189e215`), and the editor measures 94.4% of
lines instead of 85.7%. SonarQube and coverage, under Reference, has the
details.

**Checks.** pytest 53 passed, 1 skipped; `ruff format --check` clean; the
browser test 36/36; the last scan found no open issues and the gate passed,
with 89.0% coverage on new code.
