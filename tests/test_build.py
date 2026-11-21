"""A real Sphinx build: the directive, the menu entries and the editor's files."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from sphinx.application import Sphinx

from sphinx_typst_render import _editor

pytestmark = pytest.mark.skipif(
    not _editor.available(), reason="editor bundle not built (pnpm run build in editor/)"
)


def _build(tmp_path: Path, conf: str) -> Path:
    src = tmp_path / "src"
    src.mkdir()
    (src / "conf.py").write_text('extensions = ["sphinx_typst_render"]\n' + conf)
    (src / "sheet.typ").write_text("#set page(width: 80mm, height: 40mm)\n= Sheet\n")
    (src / "index.rst").write_text("Test\n====\n\n.. typst:: sheet.typ\n   :label: Sheet\n")
    out = tmp_path / "out"
    app = Sphinx(str(src), str(src), str(out), str(tmp_path / "doctrees"), "html",
                 status=None, warning=io.StringIO(), freshenv=True)
    app.build()
    return out


def test_an_editor_only_menu_still_ships_the_pdf_and_the_editor(tmp_path: Path) -> None:
    out = _build(tmp_path, 'typst_render_open = ["editor"]\ntypst_render_editor = {"noun": "logbook"}\n')
    # The PDF is not in the menu, but the editor opens it.
    assert len(list((out / "_downloads" / "typst").rglob("sheet.pdf"))) == 1
    editor = out / "_static" / "typst-editor"
    assert (editor / "viewer.html").is_file()
    assert '"noun": "logbook"' in (editor / "config.js").read_text(encoding="utf-8")


def test_without_the_editor_nothing_of_it_is_shipped(tmp_path: Path) -> None:
    out = _build(tmp_path, "")
    assert len(list((out / "_downloads" / "typst").rglob("sheet.pdf"))) == 1
    assert not (out / "_static" / "typst-editor").exists()
