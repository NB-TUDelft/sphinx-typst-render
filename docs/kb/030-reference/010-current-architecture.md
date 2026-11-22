---
summary: >-
  Layer map: `__init__.py` (`setup()`, the `typst_render_*` config values,
  event hooks), `_compile.py`, `_directive.py`, `_downloads.py`,
  `_overview.py`, `_editor.py` with its generated `_editor/` bundle built from
  `editor/`, `static/` and `fonts/`; the tests, the browser test and the two
  workflows; the declared console script with no `main` behind it.
---

# Current Architecture

The package is `src/sphinx_typst_render/`, built with `uv_build`.

- `__init__.py`: `setup()` registers the `typst_render_*` config values, the
  `typst` and `typst-overview` directives, the `static/` assets, and the event
  hooks that tie the modules below together.
- `_compile.py`: compiles a Typst source to PDF and to preview images with the
  `typst` Python binding; stages `typst-fillable`'s field library as
  `_typst_lib/` and turns the fields into a fillable form; skips the work when
  the `.typst-stamp` beside the output matches the cache key (`README.md`,
  "Caching").
- `_directive.py`: the `typst` directive. It renders its source, places the
  preview, and registers the document's menu entries with `_downloads.py`.
- `_downloads.py`: which entries a document's menu offers (PDF, editor,
  source), kept in the build environment; puts them into the theme's download
  menu at `html-page-context` and copies the PDFs at `build-finished`.
- `_overview.py`: the `typst-overview` directive, filled in at
  `doctree-resolved` from what every page's `typst` directives registered.
- `_editor.py`: copies the editor bundle into the HTML output under
  `_static/typst-editor/` and writes the book's editor settings there as
  `config.js`.
- `_editor/`: the editor bundle. `pnpm run build` generates it from `editor/`
  and git ignores it; every wheel and sdist carries it (`RELEASING.md`, "The
  editor bundle").
- `static/typst-render.js` and `typst-render.css`: section headers in the
  theme's download dropdown, added in the browser.
- `fonts/`: Maple Mono, bundled.

`editor/src/` holds the editor's modules: `main.js` starts it, `viewer.js`
assembles pdf.js's viewer components, and the rest add the editing
(`README.md`, "Developing the editor").

Tests: `tests/` runs under pytest, with real Sphinx builds in process;
`tests/test_kb.py` checks this knowledge base's index. `tools/editor_test.py`
drives the built editor in headless Chromium through Playwright. Workflows:
`.github/workflows/publish.yml` releases through
`NB-TUDelft/actions/python-publish` and runs as a dry run on every pull
request; `editor-test.yml` runs the browser test on pull requests that touch
the editor.

Known defect (`2026-11-22`): `pyproject.toml` declares a console script,
`sphinx-typst-render = "sphinx_typst_render:main"`, but the package defines no
`main`, so the installed command fails with `ImportError`. It is on the work
order.
