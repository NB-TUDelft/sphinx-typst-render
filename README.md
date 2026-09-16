# sphinx-typst-render

Compile [Typst](https://typst.app) sources during a Sphinx or Jupyter Book
build. Each source becomes a PDF students can download, plus an optional inline
preview image that follows the page theme.

Typst ships inside the [`typst`](https://pypi.org/project/typst/) wheel as a
statically linked extension module, so there is no `typst` CLI to install and no
Rust toolchain on the build machine.

## Install

```bash
pip install sphinx-typst-render
```

## Enable

In a Jupyter Book `_config.yml`:

```yaml
sphinx:
  extra_extensions:
    - sphinx_typst_render
```

In a plain Sphinx `conf.py`:

```python
extensions = ["sphinx_typst_render"]
```

## Use

````markdown
```{typst} worksheets/week3.typ
:label: Week 3 worksheet
:height: 420px
```
````

That compiles `worksheets/week3.typ`, writes `week3.pdf` and `week3.svg` beside
it, shows the SVG inline, and renders a download link for the PDF.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `:preview:` | `svg` | `svg`, `png`, or `none` to skip the inline image. |
| `:page:` | `1` | Which page to preview in a multi page document. |
| `:height:` | unset | Height of the preview image, e.g. `420px`. |
| `:alt:` | generated | Alt text for the preview image. |
| `:label:` | generated | Text of the download link. |
| `:ppi:` | `144` | Resolution of a `png` preview. |
| `:class:` | none | Extra CSS classes on the wrapper. |
| `:fillable:` | off | Add interactive form fields. See below. |

### Configuration

| Value | Default | Meaning |
| --- | --- | --- |
| `typst_render_preview` | `"svg"` | Default for `:preview:`. |
| `typst_render_ppi` | `144.0` | Default for `:ppi:`. |
| `typst_render_stage_field_library` | `True` | Stage `capture_field.typ` into the source root. |

## Why SVG previews

An SVG preview is line art, so a theme that inverts diagrams for dark mode
handles it correctly, and it stays sharp at any zoom. Use `:preview: png` for a
worksheet that contains photographs, and pair it with whatever class your theme
uses to opt out of inversion:

````markdown
```{typst} worksheets/week5.typ
:preview: png
:class: no-invert
```
````

## Fillable PDFs

Typst cannot emit interactive form fields on its own. Support is requested in
[typst/typst#1765](https://github.com/typst/typst/issues/1765) and is still
open. This package therefore delegates to
[typst-fillable](https://github.com/carpe-diem/typst-fillable), which reads
field geometry back out of the compiled document with `typst.query()`, draws a
transparent AcroForm overlay with ReportLab, and merges it with pypdf.

Mark fields in the Typst source with the helper, then add `:fillable:`:

```typ
#import "/_typst_lib/capture_field.typ": text_field, checkbox_field, textarea_field

Measured $U_(i n)$: #text_field("u_in", width: 80pt)

Did the output clip? #checkbox_field("clipped")

Explain the discrepancy:
#textarea_field("discussion", height: 60pt)
```

`capture_field.typ` is staged into `_typst_lib/` at the root of your Sphinx
source directory on every build, so the import path above is stable wherever the
worksheet lives. Set `typst_render_stage_field_library = False` to manage it
yourself.

Available helpers are `text_field`, `textarea_field`, `checkbox_field`, and
`radio_field`, plus the lower level `capture_field`.

## Caching

Output is written beside the source and skipped when nothing relevant changed.
The cache key covers the source, every other `.typ` file in the same folder, the
staged helper, and the render options.

Imports that reach outside the source folder are not tracked. Keep shared
partials next to the worksheets that use them, or touch the importing file to
force a rebuild.

Add the generated artefacts to `.gitignore`:

```gitignore
*.typst-stamp
```

Commit the PDFs if you want the book to build without recompiling, or ignore
them too and let CI regenerate them.

## Licence

MIT
