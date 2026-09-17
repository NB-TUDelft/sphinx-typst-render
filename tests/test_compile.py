"""Tests for the compile layer."""

from __future__ import annotations

from pathlib import Path

import pytest
from pypdf import PdfReader

from sphinx_typst_render import RenderRequest, render, stage_field_library

SINGLE = "#set page(width: 80mm, height: 40mm)\n= Worksheet\n"
DOUBLE = SINGLE + "#pagebreak()\nSecond page\n"


def _request(tmp_path: Path, body: str, **kwargs) -> RenderRequest:
    source = tmp_path / "sheet.typ"
    source.write_text(body)
    return RenderRequest(source=source, root=tmp_path, **kwargs)


def test_pdf_and_svg_are_written(tmp_path: Path) -> None:
    result = render(_request(tmp_path, SINGLE), tmp_path)
    assert result.pdf.read_bytes().startswith(b"%PDF")
    assert result.preview is not None
    assert result.preview.read_bytes().startswith(b"<svg")


def test_preview_can_be_disabled(tmp_path: Path) -> None:
    result = render(_request(tmp_path, SINGLE, preview="none"), tmp_path)
    assert result.preview is None
    assert result.pdf.is_file()


def test_second_render_reuses_cache(tmp_path: Path) -> None:
    request = _request(tmp_path, SINGLE)
    first = render(request, tmp_path)
    stamp = first.pdf.parent / "sheet.typst-stamp"
    marker = stamp.read_text()
    mtime = first.pdf.stat().st_mtime_ns

    render(request, tmp_path)
    assert stamp.read_text() == marker
    assert first.pdf.stat().st_mtime_ns == mtime


def test_edit_invalidates_cache(tmp_path: Path) -> None:
    request = _request(tmp_path, SINGLE)
    result = render(request, tmp_path)
    stamp = result.pdf.parent / "sheet.typst-stamp"
    before = stamp.read_text()

    request.source.write_text(SINGLE + "Extra line\n")
    render(request, tmp_path)
    assert stamp.read_text() != before


def test_multi_page_preview_selects_page(tmp_path: Path) -> None:
    first = render(_request(tmp_path, DOUBLE, preview_page=1), tmp_path)
    second = render(_request(tmp_path, DOUBLE, preview_page=2), tmp_path)
    assert first.preview.read_bytes() != second.preview.read_bytes()


def test_option_variants_do_not_clobber(tmp_path: Path) -> None:
    """Two directives on one source must not overwrite each other."""
    with_preview = render(_request(tmp_path, SINGLE), tmp_path)
    without = render(_request(tmp_path, SINGLE, preview="none"), tmp_path)

    assert with_preview.pdf != without.pdf
    assert with_preview.preview is not None
    assert with_preview.preview.is_file()
    assert with_preview.pdf.is_file()
    assert without.pdf.is_file()


def test_page_out_of_range_raises(tmp_path: Path) -> None:
    with pytest.raises(IndexError):
        render(_request(tmp_path, DOUBLE, preview_page=9), tmp_path)


def test_field_library_is_staged(tmp_path: Path) -> None:
    staged = stage_field_library(tmp_path)
    assert staged is not None
    assert staged == tmp_path / "_typst_lib" / "capture_field.typ"
    assert "capture_field" in staged.read_text()


def test_fillable_pdf_has_form_fields(tmp_path: Path) -> None:
    stage_field_library(tmp_path)
    body = (
        '#import "/_typst_lib/capture_field.typ": text_field, checkbox_field\n'
        "#set page(width: 80mm, height: 40mm)\n"
        '= Worksheet\n\nValue: #text_field("u_in")\n\n'
        'Clipped? #checkbox_field("clipped")\n'
    )
    result = render(_request(tmp_path, body, fillable=True), tmp_path)
    assert result.pdf.read_bytes().startswith(b"%PDF")

    # Assert real, typed fields. Checking for the "AcroForm" byte string alone
    # passes even when /Fields is dangling and no reader shows anything.
    fields = PdfReader(str(result.pdf)).get_fields()
    assert fields is not None
    assert {name: entry.get("/FT") for name, entry in fields.items()} == {
        "u_in": "/Tx",
        "clipped": "/Btn",
    }


def test_text_fields_have_no_length_cap(tmp_path: Path) -> None:
    """ReportLab caps text fields at 100 characters by default."""
    stage_field_library(tmp_path)
    body = (
        '#import "/_typst_lib/capture_field.typ": text_field, textarea_field\n'
        "#set page(width: 120mm, height: 60mm)\n"
        '= Worksheet\n\nValue: #text_field("u_in")\n\n'
        '#textarea_field("discussion", height: 30pt)\n'
    )
    result = render(_request(tmp_path, body, fillable=True), tmp_path)

    reader = PdfReader(str(result.pdf))
    capped = []
    for page in reader.pages:
        for annot in page.get("/Annots", []) or []:
            obj = annot.get_object()
            if "/MaxLen" in obj:
                capped.append((str(obj.get("/T")), obj["/MaxLen"]))
    assert not capped, f"fields still capped: {capped}"
