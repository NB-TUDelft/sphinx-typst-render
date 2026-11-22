---
summary: >-
  What sphinx-typst-render is (a Sphinx and Jupyter Book extension that turns
  Typst sources into PDFs, previews, fillable forms, download-menu entries, an
  overview page and an in-browser editor) and whom it serves (NB-TUDelft course
  books); the editor is maintained here alone, never ported from or kept close
  to the discontinued EI_Logbooks site; `AGPL-3.0-or-later` since 1.0.0, MIT
  up to 0.2.5; bundled third-party code keeps its own licence and notice.
always_read: true
---

# Mission

sphinx-typst-render turns Typst sources into parts of a Sphinx or Jupyter Book
site. The `typst` directive compiles a `.typ` file to a PDF, shows an inline
preview (SVG by default) and lists the PDF in the theme's download menu; with
`typst-fillable` the PDF's fields become a fillable form. `typst-overview`
lists every rendered document of the book on one page. The in-browser editor,
built on pdf.js, lets a student fill a worksheet or logbook in, export it, and
reopen the export later to keep working. `README.md` documents all of this for
users; this knowledge base does not repeat it.

It is maintained under NB-TUDelft for TU Delft course books and published on
PyPI; conda is off (Conda packages, under Future work).

**The editor is this project's own, maintained here alone.** It began as the
editor of the `NB-TUDelft/EI_Logbooks` site, which is discontinued, redirects
to the book, and will not be maintained (maintainer, `2026-11-22`). Never port
from it, compare with it, or keep the editor's code close to it; change the
editor on its own merits.

## Licence

The project is licensed under `AGPL-3.0-or-later` from 1.0.0 (`f7dfd32`,
`2026-11-21`); releases up to 0.2.5 were MIT. `LICENSE`, the `license` field in
`pyproject.toml` and the Licence section of `README.md` must agree.

Bundled third-party code keeps its own licence, and its notice ships with it:

- The editor bundle carries pdf.js (Apache-2.0), pdf-lib and fontkit (MIT),
  pako (MIT and Zlib), tslib (0BSD) and the Inter font (OFL-1.1).
  `editor/build.mjs` writes their licences into the bundle's
  `THIRD_PARTY_LICENSES.txt` from esbuild's list of inputs, so a new npm
  dependency is picked up there without a hand edit. pdf.js's data files keep
  their licence files beside them.
- Maple Mono (OFL-1.1) ships in `src/sphinx_typst_render/fonts/` with
  `MapleMono-OFL.txt`.

Before adding anything that ships in the wheel or the editor bundle, check that
its licence can be combined with the AGPL and that its notice reaches the
package.
