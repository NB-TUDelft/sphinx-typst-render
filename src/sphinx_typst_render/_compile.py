"""Compile Typst sources to PDF and to inline preview images."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import typst

#: Directory, relative to the Typst root, where the field helper is staged.
LIB_DIRNAME = "_typst_lib"

#: Directory, beside each source, holding generated output.
OUT_DIRNAME = "_typst"
LIB_FILENAME = "capture_field.typ"

#: Bumped whenever the output layout changes, to invalidate stale caches.
_CACHE_VERSION = 1


@dataclass(frozen=True)
class RenderRequest:
    """Everything that determines the bytes of a render."""

    source: Path
    root: Path
    preview: str = "svg"
    fillable: bool = False
    ppi: float | None = None
    preview_page: int = 1


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
    except (ImportError, FileNotFoundError, ModuleNotFoundError):
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
    return digest.hexdigest()


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
    for index, page in enumerate(reader.pages):
        if index < len(writer.pages):
            writer.pages[index].merge_page(page, over=False)
    # Ask the reader to build field appearances, so a blank field is visible.
    writer.set_need_appearances_writer(True)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _compile_pdf(request: RenderRequest) -> bytes:
    base = typst.compile(str(request.source), root=str(request.root), format="pdf")
    if not request.fillable:
        return base
    return _add_form_fields(base, request)


def _compile_preview(request: RenderRequest) -> bytes:
    options: dict[str, object] = {"root": str(request.root), "format": request.preview}
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
