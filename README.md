# sphinx-typst-render

Compile [Typst](https://typst.app) sources during a Sphinx or Jupyter Book
build. Each source becomes a PDF students can download, plus an optional inline
preview image that follows the page theme. A fillable PDF can also open in a
built-in editor, where students fill it in, draw, add pictures and export the
result to hand in.

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
```
````

The block renders **nothing into the page**. It compiles `worksheets/week3.typ`
and adds the resulting PDF to the theme's download menu, beside the page's own
`.ipynb` and `.pdf` entries, under a heading you configure.

Pass `:inline:` to also show a preview image and a download link in the body.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `:preview:` | `none`, or `svg` with `:inline:` | `svg`, `png`, or `none`. |
| `:page:` | `1` | Which page to preview in a multi page document. |
| `:height:` | unset | Height of the preview image, e.g. `420px`. |
| `:alt:` | generated | Alt text for the preview image. |
| `:label:` | generated | Text of the download link. |
| `:ppi:` | `144` | Resolution of a `png` preview. |
| `:class:` | none | Extra CSS classes on the wrapper. |
| `:inline:` | off | Also show a preview and link in the page body. |
| `:fillable:` | off | Add interactive form fields. See below. |
| `:open:` | from config | Menu entries for this block, e.g. `pdf, editor`. See below. |
| `:source:` | from config | `yes` or `no`: add or drop the `.typ` source entry. |
| `:max-length:` | from config | Characters a text field accepts. `0` strips the limit. |

### Configuration

| Value | Default | Meaning |
| --- | --- | --- |
| `typst_render_preview` | `"svg"` | Default for `:preview:`. |
| `typst_render_ppi` | `144.0` | Default for `:ppi:`. |
| `typst_render_stage_field_library` | `True` | Stage `capture_field.typ` into the source root. |
| `typst_render_source_label` | `"Source"` | Heading above the page's own downloads. |
| `typst_render_downloads_label` | `"Worksheets"` | Heading above the rendered PDFs. |
| `typst_render_field_max_length` | `10000` | Characters a text field accepts. `0` strips the limit. |
| `typst_render_link_source` | `False` | Also offer the `.typ` source, when `typst_render_open` is unset. |
| `typst_render_open` | unset | Menu entries for every block, in order: any of `pdf`, `raw`, `editor`. |
| `typst_render_open_labels` | `{}` | Menu text per entry, e.g. `{"editor": "{label}"}`. |
| `typst_render_editor` | `{}` | Settings for the editor. See below. |

## The download menu

Rendered PDFs are added to the download dropdown that sphinx-book-theme puts in
the article header, so students find them where they already look for the page
source. Two headings separate the groups, and both are configurable because
what the page *is* differs per project:

```yaml
sphinx:
  config:
    typst_render_source_label: Manual      # or Chapter, Page, Book
    typst_render_downloads_label: Worksheets
```

That renders as:

```
Manual
  .ipynb
  .pdf
Worksheets
  Organizer 1.1 (fillable)
```

Set either to an empty string to leave that group unlabelled.

The headings are inserted by a small stylesheet and script shipped with this
package. They are not built server side because the theme's button macro
dispatches on a fixed set of item types and forces its own CSS class, so a
non-link entry cannot be expressed through the `header_buttons` context.

Without a theme that provides such a menu, the PDFs are still written and
copied, and a warning names the page whose downloads are unreachable. Use
`:inline:` in that case.

## Choosing what the menu offers

Each block can offer three entries in the download menu:

| Entry | Opens |
| --- | --- |
| `pdf` | the compiled PDF |
| `raw` | the `.typ` source |
| `editor` | the PDF in the editor, where students fill it in |

Pick them for the whole book, in menu order, and change their text per entry.
`{label}` stands for the block's `:label:`:

```yaml
sphinx:
  config:
    typst_render_open: [editor, raw, pdf]
    typst_render_open_labels:
      editor: "{label}"
      pdf: "{label} (printable)"
```

A single block can choose its own with `:open: pdf, editor`. Without
`typst_render_open` nothing changes: the PDF, plus the source when
`typst_render_link_source` is set or the block says `:source: yes`.

## The editor

The `editor` entry opens the PDF in a page built on [pdf.js](https://mozilla.github.io/pdf.js/)
that ships inside this package. It is copied to `_static/typst-editor/` (about
6 MB) only when some page offers it. Students type into the form fields, draw,
insert pictures, add text and image pages at the end, print, and export a PDF to
hand in. Their work saves itself in the browser as they go, and the editor offers
to restore it next time. The menu also downloads an editable copy, for moving to
another computer, and leads back to the page that opened the editor.

It works on any fillable PDF, and two conventions in the Typst source add to it:

- **Image boxes.** A text field named `img_<name>` becomes a box students put a
  picture in, fitted to the box:

  ```typ
  #import "/_typst_lib/capture_field.typ": capture_field
  #let image_box(name, height: 150pt) = capture_field(
    field_name: "img_" + name, field_type: "text", fill_cell: true, min_height: height,
  )[#box(width: 100%, height: height, stroke: 0.5pt + gray)]
  ```

- **Sections.** Every bookmarked heading is a section, and an inserted picture or
  an added page is tagged with the section it belongs to. Typst bookmarks headings
  by default, and fillable PDFs keep those bookmarks. A section can be named
  without printing anything: `#place(hide(heading(bookmarked: true)[Tasks A1 to A3]))`.

Settings, all optional:

```yaml
sphinx:
  config:
    typst_render_editor:
      storage: nb2420-logbooks
      key_pattern: '^(\d+\.\d+)(?=[_ ]|$)'
      label_prefix: NB2420
      noun: logbook
      brand: NB2420
      export_message: Exported. Hand in this PDF on Brightspace.
```

| Key | Default | Meaning |
| --- | --- | --- |
| `storage` | `typst-render-editor` | Name of the browser storage that holds the saves. Use one per site. |
| `key_pattern` | unset | JavaScript regular expression for the save key: its first group, or the whole match, taken from the PDF's file stem. Unset, the stem is the key. With a key like `1.1`, a renamed file keeps its students' work. |
| `aliases` | `{}` | Old key or stem to new key, for documents that were renumbered or merged. |
| `label_prefix` | `FORM` | Prefix of the labels in exports, see below. |
| `noun`, `noun_plural` | `worksheet`, noun + s | What the editor calls the documents in its messages. |
| `brand` | none | Short mark before the title in the toolbar, e.g. a course code. |
| `export_message` | a neutral line | Shown after an export. |

**Exports.** The exported PDF has no form fields left: every answer, drawing and
picture is painted onto the page, so any reader shows the same thing. Code can
still read it back. Each answer sits between invisible
`[[<label_prefix>:field name="..."]]` and `[[/<label_prefix>:field]]` labels in
the page text, and the PDF's `LogbookFields` metadata holds every answer as JSON.

**Saves** stay in the browser of the computer used. Browsers keep them per site
origin, so books on one origin (say `<org>.github.io`) that use the same
`storage` name share them.

## An overview page

`typst-overview` puts every document the `typst` directive offers in the book
on one page: a card per block, in reading order, grouped under the page one
level up in the table of contents (each week's page, say). The whole card
opens the block's first menu entry, which is the editor when
`typst_render_open` starts with it, and the editor's Back link then returns to
the overview. Underneath, a card links to the page the block is on and to the
block's other entries.

````markdown
```{typst-overview}
:highlight: Entry 3.1
```
````

| Option | Meaning |
|---|---|
| `:highlight:` | Labels of entries to repeat in a box on top, comma separated |
| `:highlight-title:` | The heading of that box (default `Highlight`) |

The list is filled in once every page has been read, and the overview page is
rebuilt whenever another page changes, so an incremental build does not leave
it out of date. Builders other than HTML leave it out.

## Why SVG previews

With `:inline:`, an SVG preview is line art, so a theme that inverts diagrams for dark mode
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

Fillable PDFs keep the source document's metadata, including its title and
author. Set a title in Typst to use it in PDF viewer tabs:

```typ
#set document(title: "Worksheet", author: "NB2420")
= Worksheet
```

## Field length

ReportLab caps every text field at 100 characters by default, which stops a
worksheet answer mid-sentence. This package overrides that with an explicit,
generous cap:

```yaml
sphinx:
  config:
    typst_render_field_max_length: 10000   # 0 strips the limit entirely
```

The value is written explicitly rather than omitted because **some readers
treat a missing `/MaxLen` as zero** and then refuse all input. Stripping it is
still available with `0`, for projects that have checked their readers cope.
Either way it is a config change, not a new release of this package. A single
block can override it with `:max-length:`.

Only text fields are affected. A cap on a checkbox would be meaningless.

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

## Developing the editor

The editor's source is in `editor/` and builds with pnpm into
`src/sphinx_typst_render/_editor/`, which git ignores:

```bash
cd editor
pnpm install
pnpm run check    # lint, then build
```

`packageManager` in `package.json` names the pnpm version CI uses. pnpm stops
an install when a dependency's install script has been neither allowed nor
denied; `pnpm-workspace.yaml` allows esbuild's, and `pnpm approve-builds`
records the choice for any new one.

Everything comes from the npm registry. `src/viewer.js` assembles the viewer
from pdf.js's own components (`PDFViewer`, `EventBus`, `PDFLinkService`,
`DownloadManager`, `ProgressBar`) the way pdf.js's stock viewer app wires them;
the other modules in `src/` add the editing. The release workflow runs the
build before packaging, so every wheel and sdist carries it (see RELEASING.md).

The editing modules are the logbook site's editor
([NB-TUDelft/EI_Logbooks](https://github.com/NB-TUDelft/EI_Logbooks),
`site/editor/logbook.js`) split up and made configurable, in step with its
commit `8f9aede` (2026-11-21). To take in later changes, diff `site/editor/`
from that commit and port them module by module. One fix is this package's
own: an empty picture box's form field is hidden (`editor.css`), because
pdf.js stacks a page's fields with a rising z-index, and on a busy page the
field would cover the box's "Insert image" button.

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).

The editor bundle includes pdf.js (Apache 2.0), pdf-lib and fontkit (MIT),
pako (MIT and Zlib), tslib (0BSD) and the Inter font (OFL 1.1). Their licences
are in `_editor/THIRD_PARTY_LICENSES.txt` and beside pdf.js's data files.
