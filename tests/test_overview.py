"""The typst-overview directive: every document of the book on one page."""

from __future__ import annotations

import html
import io
import os
import re
import time
from pathlib import Path

import pytest
from sphinx.application import Sphinx

from sphinx_typst_render import _editor

editor_built = pytest.mark.skipif(not _editor.available(), reason="editor bundle not built (pnpm run build in editor/)")

PAGES = {
    "index.rst": "Book\n====\n\n.. toctree::\n\n   week1/index\n   week2/index\n   misc/logbooks\n",
    "week1/index.rst": "Week 1\n======\n\n.. toctree::\n\n   divider\n   filters\n",
    "week1/divider.rst": "Voltage divider\n===============\n\n.. typst:: divider.typ\n   :label: Entry 1.1\n",
    "week1/filters.rst": "Filters\n=======\n\n.. typst:: filters.typ\n   :label: Entry 1.2\n",
    "week2/index.rst": "Week 2\n======\n\n.. toctree::\n\n   mole\n",
    "week2/mole.rst": "Whack a mole\n============\n\n.. typst:: mole.typ\n   :label: Entry 2.1\n",
    # One level down, so every link has to climb out of misc/ first.
    "misc/logbooks.rst": "Log books\n=========\n\n.. typst-overview::\n   :highlight: Entry 2.1\n",
}


def _project(tmp_path: Path, conf: str) -> Path:
    src = tmp_path / "src"
    for name, text in PAGES.items():
        (src / name).parent.mkdir(parents=True, exist_ok=True)
        (src / name).write_text(text)
    for name in ("week1/divider", "week1/filters", "week2/mole"):
        (src / f"{name}.typ").write_text(f"#set page(width: 80mm, height: 40mm)\n= {name}\n")
    (src / "conf.py").write_text('extensions = ["sphinx_typst_render"]\n' + conf)
    return src


def _build(src: Path, tmp_path: Path, *, fresh: bool = True) -> str:
    out = tmp_path / "out"
    app = Sphinx(
        str(src),
        str(src),
        str(out),
        str(tmp_path / "doctrees"),
        "html",
        status=None,
        warning=io.StringIO(),
        freshenv=fresh,
    )
    app.build()
    return (out / "misc" / "logbooks.html").read_text(encoding="utf-8")


def _cards(page: str) -> list[dict]:
    """Each card: its title, main link, and the links underneath."""
    cards = []
    for item in re.findall(r'<li class="typst-overview-item">(.*?)</li>', page, re.S):
        main = re.search(r'class="typst-overview-open" href="([^"]*)"[^>]*>(.*?)</a>', item)
        more = re.findall(r'<a href="([^"]*)">(.*?)</a>', item.split("typst-overview-more", 1)[1])
        cards.append(
            {
                "title": main.group(2),
                "href": html.unescape(main.group(1)),
                "more": [(text, html.unescape(href)) for href, text in more],
            }
        )
    return cards


def test_cards_follow_the_book_grouped_by_section(tmp_path: Path) -> None:
    page = _build(_project(tmp_path, 'typst_render_open = ["pdf", "raw"]\n'), tmp_path)
    groups = re.findall(r'<h2 class="typst-overview-group">(.*?)</h2>', page)
    assert groups == ["Highlight", "Week 1", "Week 2"]
    cards = _cards(page)
    assert [card["title"] for card in cards] == ["Entry 2.1", "Entry 1.1", "Entry 1.2", "Entry 2.1"]

    divider = cards[1]
    assert re.fullmatch(r"\.\./_downloads/typst/\w+/divider\.pdf", divider["href"])
    page_link, source_link = divider["more"]
    assert page_link == ("Voltage divider", "../week1/divider.html")
    assert source_link[0] == "Source"
    assert source_link[1].endswith("/divider.typ")
    # Every link resolves to a file the build wrote.
    misc = tmp_path / "out" / "misc"
    for href in (divider["href"], page_link[1], source_link[1]):
        assert (misc / href).resolve().is_file(), href


@editor_built
def test_cards_open_the_editor_and_come_back_to_the_overview(tmp_path: Path) -> None:
    page = _build(_project(tmp_path, 'typst_render_open = ["editor", "raw"]\n'), tmp_path)
    divider = _cards(page)[1]
    assert re.fullmatch(
        r"\.\./_static/typst-editor/viewer\.html\?file=\.\./\.\./_downloads/typst/\w+/divider\.pdf"
        r"&back=\.\./\.\./misc/logbooks\.html",
        divider["href"],
    )
    assert [text for text, _ in divider["more"]] == ["Voltage divider", "Source"]
    assert (tmp_path / "out" / "_static" / "typst-editor" / "viewer.html").is_file()


def test_the_overview_follows_changes_on_other_pages(tmp_path: Path) -> None:
    src = _project(tmp_path, "")
    _build(src, tmp_path)
    mole = src / "week2" / "mole.rst"
    mole.write_text(PAGES["week2/mole.rst"].replace("Entry 2.1", "Entry 2.9"))
    later = time.time() + 10
    os.utime(mole, (later, later))
    page = _build(src, tmp_path, fresh=False)  # incremental: only mole.rst changed
    assert [card["title"] for card in _cards(page)] == ["Entry 1.1", "Entry 1.2", "Entry 2.9"]


def test_a_weekly_box_per_group_from_the_first_day(tmp_path: Path) -> None:
    src = _project(tmp_path, "")
    (src / "misc" / "logbooks.rst").write_text(
        "Log books\n=========\n\n.. typst-overview::\n"
        "   :highlight-title: This week\n   :highlight-weekly: Week 1, 2026-11-21\n"
    )
    page = _build(src, tmp_path)
    boxes = re.findall(
        r'<section class="typst-overview-highlight" data-from="([\d-]+)" data-until="([\d-]+)" hidden>'
        r'\s*<h2 class="typst-overview-group">(.*?)</h2>(.*?)</section>',
        page,
        re.S,
    )
    assert [(begin, end, title) for begin, end, title, _ in boxes] == [
        ("2026-11-21", "2026-11-28", "This week"),
        ("2026-11-28", "2026-12-05", "This week"),
    ]
    assert [card["title"] for card in _cards(boxes[0][3])] == ["Entry 1.1", "Entry 1.2"]
    assert [card["title"] for card in _cards(boxes[1][3])] == ["Entry 2.1"]
    assert "document.currentScript" in page


def test_a_weekly_box_needs_a_group_and_a_date(tmp_path: Path) -> None:
    src = _project(tmp_path, "")
    (src / "misc" / "logbooks.rst").write_text(
        "Log books\n=========\n\n.. typst-overview::\n   :highlight-weekly: Week 1\n"
    )
    page = _build(src, tmp_path)
    assert "data-from" not in page
