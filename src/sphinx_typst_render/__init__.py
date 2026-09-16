"""Render Typst sources into Sphinx and Jupyter Book output."""

from __future__ import annotations

from ._compile import RenderRequest, RenderResult, render, stage_field_library
from ._directive import TypstDirective

__all__ = [
    "RenderRequest",
    "RenderResult",
    "TypstDirective",
    "render",
    "setup",
    "stage_field_library",
]
__version__ = "0.1.0"


def setup(app):
    app.add_config_value("typst_render_preview", "svg", "env")
    app.add_config_value("typst_render_ppi", 144.0, "env")
    app.add_config_value("typst_render_stage_field_library", True, "env")
    app.add_directive("typst", TypstDirective)
    return {
        "version": __version__,
        # Rendering writes files during the read phase, so parallel readers
        # could race on the same output. Correctness over throughput here.
        "parallel_read_safe": False,
        "parallel_write_safe": True,
    }
