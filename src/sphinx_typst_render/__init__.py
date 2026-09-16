"""Render Typst sources into Sphinx and Jupyter Book output."""

from __future__ import annotations

import json
from pathlib import Path

from ._compile import RenderRequest, RenderResult, render, stage_field_library
from ._directive import TypstDirective
from ._downloads import (
    add_download_buttons,
    copy_downloads,
    merge_info,
    purge_doc,
)

__all__ = [
    "RenderRequest",
    "RenderResult",
    "TypstDirective",
    "render",
    "setup",
    "stage_field_library",
]
__version__ = "0.2.0"

STATIC_DIR = Path(__file__).parent / "static"

#: Written into the output at build time, so the labels reach the browser as a
#: file rather than an inline script. An inline script added through
#: add_js_file(None, body=...) is emitted twice by sphinx-book-theme, which
#: re-processes the asset list in its own html-page-context handler.
LABELS_FILENAME = "typst-render-labels.js"


def _install_assets(app) -> None:
    """Register the dropdown header assets.

    The labels file is generated here rather than at build-finished because
    sphinx-book-theme fingerprints each asset by reading it while pages are
    written. A file that does not exist yet at that point is dropped from the
    page instead of being linked.
    """
    if getattr(app.builder, "format", None) != "html":
        return

    generated = Path(app.doctreedir).parent / "typst-render-static"
    generated.mkdir(parents=True, exist_ok=True)
    labels = {
        "source": app.config.typst_render_source_label,
        "downloads": app.config.typst_render_downloads_label,
    }
    (generated / LABELS_FILENAME).write_text(
        f"window.typstRenderLabels = {json.dumps(labels)};\n"
    )

    app.config.html_static_path.append(str(STATIC_DIR))
    app.config.html_static_path.append(str(generated))
    # Labels first: typst-render.js reads the global this one defines.
    app.add_js_file(LABELS_FILENAME)
    app.add_js_file("typst-render.js")
    app.add_css_file("typst-render.css")


def setup(app):
    app.add_config_value("typst_render_preview", "svg", "env")
    app.add_config_value("typst_render_ppi", 144.0, "env")
    app.add_config_value("typst_render_stage_field_library", True, "env")
    # Headings inserted into the theme's download menu. The first names what
    # the page itself is, which differs per project: a manual, a chapter, a
    # page. An empty string leaves that group unlabelled.
    app.add_config_value("typst_render_source_label", "Source", "html")
    app.add_config_value("typst_render_downloads_label", "Worksheets", "html")

    app.add_directive("typst", TypstDirective)

    app.connect("builder-inited", _install_assets)
    app.connect("env-purge-doc", purge_doc)
    app.connect("env-merge-info", merge_info)
    # After sphinx-book-theme builds the download group at priority 501.
    app.connect("html-page-context", add_download_buttons, priority=600)
    app.connect("build-finished", copy_downloads)

    return {
        "version": __version__,
        # Rendering writes files during the read phase, so parallel readers
        # could race on the same output. Correctness over throughput here.
        "parallel_read_safe": False,
        "parallel_write_safe": True,
    }
