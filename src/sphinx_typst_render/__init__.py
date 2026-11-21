"""Render Typst sources into Sphinx and Jupyter Book output."""

from __future__ import annotations

import json
from pathlib import Path

from sphinx.errors import ExtensionError

from . import _editor
from ._compile import (
    DEFAULT_MAX_LENGTH,
    RenderRequest,
    RenderResult,
    render,
    stage_field_library,
)
from ._directive import TypstDirective
from ._downloads import (
    KINDS,
    add_download_buttons,
    copy_downloads,
    default_kinds,
    merge_info,
    purge_doc,
    uses_editor,
)

__all__ = [
    "DEFAULT_MAX_LENGTH",
    "RenderRequest",
    "RenderResult",
    "TypstDirective",
    "render",
    "setup",
    "stage_field_library",
]
__version__ = "0.2.5"

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


def _check_config(app, config) -> None:
    """Fail when the build starts, not halfway through it."""
    try:
        kinds = default_kinds(config)
    except ValueError as error:
        raise ExtensionError(f"sphinx-typst-render: {error}") from error
    unknown = sorted(set(config.typst_render_open_labels or {}) - set(KINDS))
    if unknown:
        raise ExtensionError(
            f"sphinx-typst-render: typst_render_open_labels: unknown {', '.join(unknown)}; "
            f"choose from {', '.join(KINDS)}"
        )
    if "editor" in kinds and not _editor.available():
        raise ExtensionError(f"sphinx-typst-render: {_editor.MISSING}")
    _editor.settings(config)


def _install_editor(app, exception) -> None:
    """Ship the editor with the HTML, when any page offers it."""
    if exception is not None or getattr(app.builder, "format", None) != "html":
        return
    if uses_editor(app.env):
        _editor.install(app)


def setup(app):
    app.add_config_value("typst_render_preview", "svg", "env")
    app.add_config_value("typst_render_ppi", 144.0, "env")
    app.add_config_value("typst_render_stage_field_library", True, "env")
    # Characters a generated text field accepts. Set to 0 to strip the limit
    # entirely, which some readers mis-handle as zero, so it is opt in.
    app.add_config_value("typst_render_field_max_length", DEFAULT_MAX_LENGTH, "env")
    # Headings inserted into the theme's download menu. The first names what
    # the page itself is, which differs per project: a manual, a chapter, a
    # page. An empty string leaves that group unlabelled.
    # Offer the .typ source next to each rendered PDF.
    app.add_config_value("typst_render_link_source", False, "env")
    app.add_config_value("typst_render_source_label", "Source", "html")
    app.add_config_value("typst_render_downloads_label", "Worksheets", "html")
    # What each rendered document offers in the download menu, in menu order:
    # "pdf" (the compiled PDF), "raw" (the .typ source) and "editor" (the PDF
    # opened in the in-browser editor). None keeps the old behaviour: the PDF,
    # plus the source when typst_render_link_source is set.
    app.add_config_value("typst_render_open", None, "env", types=(list, tuple, str, type(None)))
    # Menu text per kind, a format string over the block's label, e.g.
    # {"editor": "{label}", "pdf": "{label} (printable)"}.
    app.add_config_value("typst_render_open_labels", {}, "env", types=(dict,))
    # The editor's settings; see _editor.DEFAULTS.
    app.add_config_value("typst_render_editor", {}, "html", types=(dict,))

    app.add_directive("typst", TypstDirective)

    app.connect("config-inited", _check_config)
    app.connect("builder-inited", _install_assets)
    app.connect("env-purge-doc", purge_doc)
    app.connect("env-merge-info", merge_info)
    # After sphinx-book-theme builds the download group at priority 501.
    app.connect("html-page-context", add_download_buttons, priority=600)
    app.connect("build-finished", copy_downloads)
    app.connect("build-finished", _install_editor)

    return {
        "version": __version__,
        # Rendering writes files during the read phase, so parallel readers
        # could race on the same output. Correctness over throughput here.
        "parallel_read_safe": False,
        "parallel_write_safe": True,
    }
