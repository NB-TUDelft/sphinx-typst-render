"""The download menu: what a block offers, the editor link, and the editor's files."""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from sphinx_typst_render import _downloads, _editor

editor_built = pytest.mark.skipif(
    not _editor.available(), reason="editor bundle not built (pnpm run build in editor/)"
)


def _config(**overrides) -> SimpleNamespace:
    values = {
        "typst_render_open": None,
        "typst_render_link_source": False,
        "typst_render_open_labels": {},
        "typst_render_editor": {},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_default_kinds_keep_the_old_behaviour() -> None:
    assert _downloads.default_kinds(_config()) == ["pdf"]
    assert _downloads.default_kinds(_config(typst_render_link_source=True)) == ["pdf", "raw"]


def test_open_takes_a_list_or_a_string_and_keeps_the_order() -> None:
    config = _config(typst_render_open=["editor", "raw", "pdf"])
    assert _downloads.default_kinds(config) == ["editor", "raw", "pdf"]
    assert _downloads.parse_kinds("pdf, editor editor", ":open:") == ["pdf", "editor"]


def test_an_unknown_kind_is_named_in_the_error() -> None:
    with pytest.raises(ValueError, match="unknown viewer"):
        _downloads.parse_kinds(["pdf", "viewer"], "typst_render_open")


def test_labels_can_be_changed_per_kind() -> None:
    config = _config(typst_render_open_labels={"editor": "{label}", "pdf": "{label} (printable)"})
    assert _downloads.label_for(config, "editor", "Entry 1.1") == "Entry 1.1"
    assert _downloads.label_for(config, "pdf", "Entry 1.1") == "Entry 1.1 (printable)"
    assert _downloads.label_for(config, "raw", "Entry 1.1") == "Entry 1.1 (source)"


def _menu(kinds: list[str], tmp_path: Path):
    """Register ``kinds`` for one page and build its menu, as Sphinx would."""
    env = SimpleNamespace()
    pdf = tmp_path / "1.1_sheet.pdf"
    pdf.write_bytes(b"%PDF-1.7")
    source = tmp_path / "1.1_sheet.typ"
    source.write_text("= Sheet\n")
    for kind in kinds:
        _downloads.register(
            env, "week1/page", digest="abc123",
            path=source if kind == "raw" else pdf, label=f"Entry ({kind})", kind=kind,
        )
    app = SimpleNamespace(env=env, builder=SimpleNamespace(get_target_uri=lambda name: f"{name}.html"))
    group = {"type": "group", "label": _downloads.THEME_GROUP_LABEL, "buttons": []}
    context = {"header_buttons": [group], "pathto": lambda uri, resource=False: f"../{uri}"}
    _downloads.add_download_buttons(app, "week1/page", "page.html", context, None)
    return group["buttons"], env


def test_menu_entries_come_in_order_with_their_links(tmp_path: Path) -> None:
    buttons, _ = _menu(["editor", "raw", "pdf"], tmp_path)
    assert [button["text"] for button in buttons] == ["Entry (editor)", "Entry (raw)", "Entry (pdf)"]
    editor, raw, pdf = buttons
    assert pdf["url"] == "../_downloads/typst/abc123/1.1_sheet.pdf"
    assert raw["url"] == "../_downloads/typst/abc123/1.1_sheet.typ"
    assert editor["url"] == (
        "../_static/typst-editor/viewer.html"
        "?file=../../_downloads/typst/abc123/1.1_sheet.pdf&back=../../week1/page.html"
    )
    assert editor["icon"] == "fas fa-pen-to-square"
    # The dropdown script groups our entries by this label.
    assert {button["label"] for button in buttons} == {_downloads.BUTTON_LABEL}


def test_the_editor_and_the_pdf_share_a_file_but_not_an_entry(tmp_path: Path) -> None:
    _, env = _menu(["pdf", "editor", "pdf"], tmp_path)
    entries = env.typst_render_downloads["week1/page"]
    assert [entry["kind"] for entry in entries] == ["pdf", "editor"]
    assert {entry["uri"] for entry in entries} == {"_downloads/typst/abc123/1.1_sheet.pdf"}
    assert _downloads.uses_editor(env)


def test_editor_settings_reach_the_editor_under_its_own_names() -> None:
    settings = _editor.settings(_config(typst_render_editor={
        "storage": "nb2420-logbooks",
        "key_pattern": r"^(\d+\.\d+)(?=[_ ]|$)",
        "label_prefix": "NB2420",
        "noun": "logbook",
        "aliases": {"2.3": "2.2"},
    }))
    assert settings["storage"] == "nb2420-logbooks"
    assert settings["keyPattern"] == r"^(\d+\.\d+)(?=[_ ]|$)"
    assert (settings["labelPrefix"], settings["noun"]) == ("NB2420", "logbook")
    assert settings["aliases"] == {"keys": {"2.3": "2.2"}}
    assert _editor.settings(_config())["storage"] == "typst-render-editor"
    # Print stays in the editor menu unless the book hides it.
    assert _editor.settings(_config())["showPrint"] is True
    hidden = _editor.settings(_config(typst_render_editor={"show_print": False}))
    assert hidden["showPrint"] is False


def test_favicon_url_mirrors_the_book() -> None:
    """The editor tab carries the book's favicon, resolved as Sphinx resolves it."""
    resolve = lambda **overrides: _editor.favicon_url(_config(**overrides))
    assert resolve() is None
    assert resolve(html_favicon="images/book icon.png") == "../../_static/book%20icon.png"
    assert resolve(html_favicon="favicon.ico") == "../../_static/favicon.ico"
    assert resolve(html_favicon="https://example.com/icon.ico") == "https://example.com/icon.ico"


@editor_built
def test_install_gives_the_editor_page_the_books_favicon(tmp_path: Path) -> None:
    def installed_page(**overrides) -> str:
        app = SimpleNamespace(
            builder=SimpleNamespace(outdir=str(tmp_path)),
            config=_config(**overrides),
        )
        return (_editor.install(app) / "viewer.html").read_text(encoding="utf-8")

    assert '<link rel="icon" href="../../_static/logo.svg">' in installed_page(
        html_favicon="_static/logo.svg")
    assert 'href="https://example.com/i.ico?a=1&amp;b=2"' in installed_page(
        html_favicon="https://example.com/i.ico?a=1&b=2")
    assert 'rel="icon"' not in installed_page()


@editor_built
def test_install_copies_the_bundle_and_writes_the_settings(tmp_path: Path) -> None:
    app = SimpleNamespace(
        builder=SimpleNamespace(outdir=str(tmp_path)),
        config=_config(typst_render_editor={"noun": "logbook"}),
    )
    target = _editor.install(app)
    for name in ("viewer.html", "editor.js", "editor.css", "pdf.worker.mjs",
                 "pdfjs/pdf_viewer.css", "pdfjs/standard_fonts/LiberationSans-Regular.ttf"):
        assert (target / name).is_file(), name
    text = (target / "config.js").read_text(encoding="utf-8")
    prefix = "window.typstEditorConfig = "
    assert text.startswith(prefix)
    assert json.loads(text[len(prefix):].rstrip().rstrip(";"))["noun"] == "logbook"


def test_release_builds_carry_the_editor() -> None:
    """The publish workflow runs `pnpm run build` before packaging. A wheel built
    without it would offer no editor, so CI must not get this far without one."""
    if not os.environ.get("CI"):
        pytest.skip("enforced in CI only")
    assert _editor.available(), _editor.MISSING
