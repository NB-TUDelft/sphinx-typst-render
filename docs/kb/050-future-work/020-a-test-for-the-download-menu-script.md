---
summary: >-
  `static/typst-render.js` runs only in the browser and no test exercises it,
  so SonarQube's coverage leaves it out; a browser test of a built page would
  bring it in, reusing the editor test's Playwright and V8 coverage setup.
---

# A test for the download menu script

`src/sphinx_typst_render/static/typst-render.js` adds section headers to the
theme's download dropdown. Nothing tests it: `tests/` builds pages but runs no
JavaScript, and `tools/editor_test.py` opens the editor, not a book page. It is
therefore in `sonar.coverage.exclusions`.

A test would build a page with sphinx-book-theme, open it in Playwright, and
check the headers in the dropdown. With the same `Coverage` approach as the
editor test (SonarQube and coverage, under Reference) it would also report
the script's coverage, and the exclusion could go.
