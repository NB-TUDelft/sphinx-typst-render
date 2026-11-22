"""Compile Typst sources to PDF and to inline preview images."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import typst

#: Directory, relative to the Typst root, where the field helper is staged.
LIB_DIRNAME = "_typst_lib"
MAX_LEN = "/MaxLen"
METADATA = "/Metadata"

#: Directory, beside each source, holding generated output.
OUT_DIRNAME = "_typst"
LIB_FILENAME = "capture_field.typ"

#: Bumped whenever the generated output changes, to invalidate stale caches.
#: 5: fillable PDFs keep the document's bookmarks.
#: 6: the bundled Maple Mono font is available to every render.
_CACHE_VERSION = 6

#: Fonts shipped inside this package (Maple Mono, a variable font), offered
#: to every render alongside the system fonts, so a worksheet can name them
#: without anything installed on the build machine.
FONT_DIR = Path(__file__).parent / "fonts"


def _font_paths() -> list[str]:
    return [str(FONT_DIR)] if FONT_DIR.is_dir() else []

#: Characters a generated text field accepts unless configured otherwise.
#: Large enough that no worksheet answer reaches it, and written explicitly
#: because some readers treat a missing /MaxLen as zero and refuse all input.
DEFAULT_MAX_LENGTH = 10000


@dataclass(frozen=True)
class RenderRequest:
    """Everything that determines the bytes of a render."""

    source: Path
    root: Path
    preview: str = "svg"
    fillable: bool = False
    ppi: float | None = None
    preview_page: int = 1
    #: Characters a text field accepts. 0 removes the limit entirely, which
    #: some readers mis-handle as zero. See _apply_field_lengths.
    max_length: int = DEFAULT_MAX_LENGTH


@dataclass(frozen=True)
class RenderResult:
    """Paths written by :func:`render`."""

    pdf: Path
    preview: Path | None


def stage_field_library(root: Path) -> Path | None:
    """Copy typst-fillable's ``capture_field.typ`` into the Typst root.

    Authors then import it by a stable root absolute path, which does not
    change when a worksheet moves between week folders::

        #import "/_typst_lib/capture_field.typ": text_field, checkbox_field

    Returns the staged path, or ``None`` when typst-fillable is not installed.
    """
    try:
        from importlib.resources import files

        data = (files("typst_fillable") / "typst" / LIB_FILENAME).read_bytes()
    except (ImportError, FileNotFoundError):
        return None

    target = root / LIB_DIRNAME / LIB_FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    # Only write when the content differs, so the mtime stays stable and the
    # fingerprint below does not churn on every build.
    if not target.is_file() or target.read_bytes() != data:
        target.write_bytes(data)
    return target


def _options(request: RenderRequest) -> dict[str, object]:
    try:
        source_key = request.source.resolve().relative_to(request.root.resolve()).as_posix()
    except ValueError:
        source_key = request.source.name
    return {
        "version": _CACHE_VERSION,
        # Output lives outside the source tree, so the key must identify the
        # source. Two worksheets may share a stem in different week folders.
        "source": source_key,
        "preview": request.preview,
        "fillable": request.fillable,
        "ppi": request.ppi,
        "page": request.preview_page,
        "max_length": request.max_length,
    }


def _variant(request: RenderRequest) -> str:
    """Short digest of the render options.

    Two directives may point at one source with different options. Keying the
    output directory on the options keeps them from overwriting each other,
    while the file inside keeps the source stem so the download is named
    ``week3.pdf`` rather than something hashed.
    """
    payload = json.dumps(_options(request), sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest()[:8]


def _fingerprint(request: RenderRequest) -> str:
    """Hash everything that can change the output.

    Covers the source, every other ``.typ`` file beside it (worksheets that
    import shared partials keep them in the same folder), the staged helper,
    and the render options. Imports reaching outside the source folder are not
    tracked; touch the importing file to force a rebuild.
    """
    digest = hashlib.sha256()
    digest.update(json.dumps(_options(request), sort_keys=True).encode())
    for path in sorted(request.source.parent.glob("*.typ")):
        digest.update(path.name.encode())
        digest.update(path.read_bytes())

    library = request.root / LIB_DIRNAME / LIB_FILENAME
    if library.is_file():
        digest.update(library.read_bytes())
    for font in sorted(FONT_DIR.glob("*.ttf")) if FONT_DIR.is_dir() else []:
        digest.update(font.name.encode())
        digest.update(font.read_bytes())
    return digest.hexdigest()


def _apply_field_lengths(writer, max_length: int) -> None:
    """Set, or remove, the character cap on every text field.

    Three behaviours are in play here. ReportLab's ``AcroForm.textfield()``
    defaults to ``maxlen=100`` and typst-fillable does not override it, so a
    field silently refuses input after 100 characters. Removing ``/MaxLen``
    altogether is not safe either, because some readers treat a missing cap as
    zero and then refuse all input. So the default is to write an explicit,
    generous value, and ``max_length = 0`` drops the key for anyone who has
    checked that their readers cope.

    Only text fields are touched. A cap on a checkbox would be meaningless.
    """
    seen: set[int] = set()
    annots = [annot for page in writer.pages for annot in page.get("/Annots", []) or []]
    acroform = writer._root_object.get("/AcroForm")
    fields = (acroform.get("/Fields", []) or []) if acroform else []
    for ref in annots + list(fields):
        _cap_text_field(ref.get_object(), max_length, seen)


def _cap_text_field(obj, max_length: int, seen: set[int]) -> None:
    """Set or remove one field's character cap, then its kids' (each object once)."""
    from pypdf.generic import NameObject, NumberObject

    if obj is None or id(obj) in seen:
        return
    seen.add(id(obj))
    if obj.get("/FT") == "/Tx":
        if max_length > 0:
            obj[NameObject(MAX_LEN)] = NumberObject(max_length)
        elif MAX_LEN in obj:
            del obj[MAX_LEN]
    for kid in obj.get("/Kids", []) or []:
        _cap_text_field(kid.get_object(), max_length, seen)


def _copy_outline(reader, writer) -> None:
    """Carry the document's bookmarks over to the fillable PDF.

    The fillable PDF is built from the overlay, so the outline Typst wrote,
    one entry per bookmarked heading, would otherwise be lost. Readers show it
    as the bookmark panel, and the editor reads each entry's page and height
    to tag an inserted image with the section it belongs to.
    """
    _copy_outline_items(reader, writer, reader.outline)


def _copy_outline_items(reader, writer, items, parent=None) -> None:
    last = None
    for item in items:
        if isinstance(item, list):  # the children of the entry before it
            if last is not None:
                _copy_outline_items(reader, writer, item, last)
            continue
        page = reader.get_destination_page_number(item)
        if page is not None and 0 <= page < len(writer.pages):
            last = writer.add_outline_item(item.title, page, parent=parent, fit=_outline_fit(item))


def _outline_fit(item):
    """Where a bookmark lands: the same spot for /XYZ (page, height, zoom), else the whole page."""
    from pypdf.generic import Fit, NullObject

    def number(value):
        return None if value is None or isinstance(value, NullObject) else float(value)

    if item.typ == "/XYZ":
        return Fit.xyz(left=number(item.left), top=number(item.top), zoom=number(item.zoom))
    return Fit.fit()


def _add_form_fields(base: bytes, request: RenderRequest) -> bytes:
    """Overlay interactive AcroForm fields onto an already compiled PDF.

    Only the field extraction and the ReportLab overlay come from
    typst-fillable. Its ``make_fillable()`` copies the whole Typst root into a
    temp dir and then expects the template at the top of it, which breaks for
    worksheets in subfolders, and its ``merge_with_overlay()`` merges page
    content without carrying the widget annotations, so the result has an
    /AcroForm whose /Fields point at nothing and no reader shows a field.

    Cloning the overlay instead keeps the form dictionary and its widgets
    intact in one document, and the Typst content is stamped underneath.
    """
    from io import BytesIO

    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import BooleanObject, NameObject
    from typst_fillable import create_form_overlay, extract_field_metadata

    fields = extract_field_metadata(request.source, root=request.root)
    if not fields:
        return base

    reader = PdfReader(BytesIO(base))
    first = reader.pages[0]
    overlay = create_form_overlay(
        fields=fields,
        page_count=len(reader.pages),
        page_size=(float(first.mediabox.width), float(first.mediabox.height)),
    )

    writer = PdfWriter(clone_from=overlay)
    # Keep the document's metadata instead of ReportLab's "untitled" defaults.
    # Replace the info dictionary so absent values do not inherit overlay data.
    writer.metadata = reader.metadata
    if METADATA in reader.trailer["/Root"]:
        writer.root_object[NameObject(METADATA)] = (
            reader.trailer["/Root"].raw_get(METADATA).clone(writer)
        )
    if reader.metadata and reader.metadata.title:
        writer.create_viewer_preferences()[NameObject("/DisplayDocTitle")] = (
            BooleanObject(True)
        )
    for index, page in enumerate(reader.pages):
        if index < len(writer.pages):
            writer.pages[index].merge_page(page, over=False)
    _copy_outline(reader, writer)
    _apply_field_lengths(writer, request.max_length)
    # Ask the reader to build field appearances, so a blank field is visible.
    writer.set_need_appearances_writer(True)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _compile_pdf(request: RenderRequest) -> bytes:
    base = typst.compile(str(request.source), root=str(request.root), format="pdf", font_paths=_font_paths())
    if not request.fillable:
        return base
    return _add_form_fields(base, request)


def _compile_preview(request: RenderRequest) -> bytes:
    options: dict[str, object] = {
        "root": str(request.root), "format": request.preview, "font_paths": _font_paths(),
    }
    if request.preview == "png":
        options["ppi"] = request.ppi or 144.0

    rendered = typst.compile(str(request.source), **options)
    # A multi page document comes back as one bytes object per page.
    if isinstance(rendered, list):
        index = max(1, request.preview_page) - 1
        if index >= len(rendered):
            raise IndexError(
                f"{request.source.name} has {len(rendered)} pages, "
                f"cannot preview page {request.preview_page}"
            )
        return rendered[index]
    return rendered


def render(request: RenderRequest, basedir: Path) -> RenderResult:
    """Compile ``request`` under ``basedir``, reusing cached output when valid.

    Output lands in ``<basedir>/_typst/<options digest>/``.
    """
    outdir = basedir / OUT_DIRNAME / _variant(request)
    outdir.mkdir(parents=True, exist_ok=True)
    stem = request.source.stem
    pdf = outdir / f"{stem}.pdf"
    preview = None if request.preview == "none" else outdir / f"{stem}.{request.preview}"
    stamp = outdir / f"{stem}.typst-stamp"

    expected = _fingerprint(request)
    if stamp.is_file() and stamp.read_text().strip() == expected:
        if pdf.is_file() and (preview is None or preview.is_file()):
            return RenderResult(pdf, preview)

    pdf.write_bytes(_compile_pdf(request))
    if preview is not None:
        preview.write_bytes(_compile_preview(request))
    stamp.write_text(expected)
    return RenderResult(pdf, preview)
