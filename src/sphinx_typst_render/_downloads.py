"""Put rendered PDFs into the theme's download menu instead of the page body."""

from __future__ import annotations

import shutil
from pathlib import Path

from sphinx.util import logging

LOGGER = logging.getLogger(__name__)

#: Attribute on the build environment holding {docname: [entry, ...]}.
ENV_KEY = "typst_render_downloads"

#: Output subdirectory, below the HTML output root.
URI_PREFIX = "_downloads/typst"

#: Button label, which the theme turns into a "btn-<label>" class. The
#: companion JavaScript uses that class to find our entries in the menu.
BUTTON_LABEL = "typst-download"

#: Label of the download group that sphinx-book-theme builds.
THEME_GROUP_LABEL = "download-buttons"


def _store(env) -> dict[str, list[dict]]:
    if not hasattr(env, ENV_KEY):
        setattr(env, ENV_KEY, {})
    return getattr(env, ENV_KEY)


def register(
    env, docname: str, *, digest: str, path: Path, label: str, icon: str = "fas fa-file-pdf"
) -> str:
    """Record one download for ``docname`` and return its output relative URI."""
    uri = f"{URI_PREFIX}/{digest}/{path.name}"
    entries = _store(env).setdefault(docname, [])
    # A page may hold several worksheets, but re-reading it must not duplicate.
    for entry in entries:
        if entry["uri"] == uri:
            entry["label"] = label
            return uri
    entries.append({"uri": uri, "path": str(path), "label": label, "icon": icon})
    return uri


def purge_doc(app, env, docname: str) -> None:
    _store(env).pop(docname, None)


def merge_info(app, env, docnames, other) -> None:
    _store(env).update(_store(other))


def add_download_buttons(app, pagename, templatename, context, doctree) -> None:
    """Append this page's worksheets to the theme's download dropdown.

    Runs after sphinx-book-theme has built ``header_buttons`` (priority 501),
    so the group already exists and we only extend it.
    """
    entries = _store(app.env).get(pagename)
    if not entries:
        return

    group = next(
        (
            item
            for item in context.get("header_buttons", [])
            if item.get("type") == "group" and item.get("label") == THEME_GROUP_LABEL
        ),
        None,
    )
    if group is None:
        LOGGER.warning(
            "sphinx-typst-render: no download menu on %s, so %d worksheet(s) are "
            "not reachable. The theme must provide one, as sphinx-book-theme does "
            "with use_download_button enabled.",
            pagename,
            len(entries),
            type="typst_render",
        )
        return

    pathto = context["pathto"]
    for entry in entries:
        group["buttons"].append(
            {
                "type": "link",
                "url": pathto(entry["uri"], 1),
                "text": entry["label"],
                "icon": entry.get("icon", "fas fa-file-pdf"),
                "tooltip": entry["label"],
                "label": BUTTON_LABEL,
            }
        )


def copy_downloads(app, exception) -> None:
    """Copy the rendered PDFs into the output tree."""
    if exception is not None or getattr(app.builder, "format", None) != "html":
        return
    outdir = Path(app.builder.outdir)
    for entries in _store(app.env).values():
        for entry in entries:
            source = Path(entry["path"])
            if not source.is_file():
                continue
            destination = outdir / entry["uri"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
