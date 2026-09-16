"""The ``typst`` directive."""

from __future__ import annotations

from pathlib import Path

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx import addnodes
from sphinx.util.docutils import SphinxDirective

from ._compile import RenderRequest, render, stage_field_library
from ._downloads import register


def _preview(argument: str) -> str:
    return directives.choice(argument, ("svg", "png", "none"))


class TypstDirective(SphinxDirective):
    """Compile a Typst source and offer it as a download.

    The block renders nothing into the page. The PDF is added to the theme's
    download menu, next to the page's own source files. Pass ``:inline:`` to
    also show a preview and a link in the body.

    ::

        ```{typst} worksheets/week3.typ
        :label: Week 3 worksheet
        :fillable:
        ```
    """

    required_arguments = 1
    optional_arguments = 0
    final_argument_whitespace = True
    has_content = False
    option_spec = {
        "preview": _preview,
        "fillable": directives.flag,
        "inline": directives.flag,
        "label": directives.unchanged,
        "alt": directives.unchanged,
        "height": directives.length_or_unitless,
        "ppi": directives.positive_int,
        "page": directives.positive_int,
        "class": directives.class_option,
    }

    def run(self) -> list[nodes.Node]:
        config = self.env.config
        relative, absolute = self.env.relfn2path(self.arguments[0].strip())
        source = Path(absolute)
        if not source.is_file():
            raise self.error(f"Typst source not found: {relative}")

        # Rebuild the page whenever the source changes.
        self.env.note_dependency(relative)

        root = Path(self.env.srcdir)
        if config.typst_render_stage_field_library:
            stage_field_library(root)

        inline = "inline" in self.options
        # Without an inline block there is nothing to show a preview in, so do
        # not spend a second Typst compile on one.
        default_preview = config.typst_render_preview if inline else "none"

        request = RenderRequest(
            source=source,
            root=root,
            preview=self.options.get("preview", default_preview),
            fillable="fillable" in self.options,
            ppi=self.options.get("ppi", config.typst_render_ppi),
            preview_page=self.options.get("page", 1),
        )

        try:
            result = render(request, source.parent)
        except Exception as error:
            # A clean build is a hard requirement, so surface this as an error
            # rather than a warning that scrolls past unnoticed.
            raise self.error(f"Typst render failed for {relative}: {error}") from error

        label = self.options.get("label") or result.pdf.stem
        register(
            self.env,
            self.env.docname,
            digest=result.pdf.parent.name,
            pdf=result.pdf,
            label=label,
        )
        if not inline:
            return []

        container = nodes.container(
            classes=["typst-render", *self.options.get("class", [])]
        )

        if result.preview is not None:
            uri = "/" + result.preview.relative_to(root).as_posix()
            image = nodes.image(uri=uri)
            image["candidates"] = {"*": uri}
            image["alt"] = self.options.get("alt", f"Preview of {source.name}")
            if "height" in self.options:
                image["height"] = self.options["height"]
            container += image

        reference = addnodes.download_reference(
            "",
            "",
            reftarget="/" + result.pdf.relative_to(root).as_posix(),
            refdoc=self.env.docname,
            refexplicit=True,
            refwarn=False,
        )
        reference += nodes.literal(label, label, classes=["xref", "download"])
        container += nodes.paragraph("", "", reference, classes=["typst-download"])
        return [container]
