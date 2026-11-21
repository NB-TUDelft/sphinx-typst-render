"""Put rendered PDFs into the theme's download menu instead of the page body."""

from __future__ import annotations

import shutil
from pathlib import Path

from sphinx.util import logging

from . import _editor

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

#: What a rendered document can offer in the menu: the compiled PDF, the .typ
#: source, and the PDF opened in the in-browser editor.
KINDS = ("pdf", "raw", "editor")

#: Menu text per kind, a format string over the block's label. The
#: ``typst_render_open_labels`` config value overrides any of them.
LABELS = {"pdf": "{label}", "raw": "{label} (source)", "editor": "{label} (editor)"}

ICONS = {"pdf": "fas fa-file-pdf", "raw": "fas fa-file-code", "editor": "fas fa-pen-to-square"}


def parse_kinds(value, where: str) -> list[str]:
    """Kinds from a list, or from a comma or space separated string."""
    items = value.replace(",", " ").split() if isinstance(value, str) else list(value)
    unknown = [str(item) for item in items if item not in KINDS]
    if unknown:
        raise ValueError(f"{where}: unknown {', '.join(unknown)}; choose from {', '.join(KINDS)}")
    return list(dict.fromkeys(items))


def default_kinds(config) -> list[str]:
    """What a block offers unless its ``:open:`` option says otherwise.

    Without ``typst_render_open`` this is what the package always did: the
    PDF, plus the source when ``typst_render_link_source`` is set.
    """
    if config.typst_render_open is None:
        return ["pdf", "raw"] if config.typst_render_link_source else ["pdf"]
    return parse_kinds(config.typst_render_open, "typst_render_open")


def label_for(config, kind: str, label: str) -> str:
    templates = {**LABELS, **(config.typst_render_open_labels or {})}
    return templates[kind].format(label=label)


def _store(env) -> dict[str, list[dict]]:
    if not hasattr(env, ENV_KEY):
        setattr(env, ENV_KEY, {})
    return getattr(env, ENV_KEY)


def register(env, docname: str, *, digest: str, path: Path, label: str, kind: str = "pdf") -> str:
    """Record one menu entry for ``docname`` and return the file's output URI.

    An editor entry points at the PDF, which is copied like any other, so the
    editor works even when the PDF itself is not offered in the menu.
    """
    uri = f"{URI_PREFIX}/{digest}/{path.name}"
    entries = _store(env).setdefault(docname, [])
    # A page may hold several documents, but re-reading it must not duplicate.
    for entry in entries:
        if entry["uri"] == uri and entry.get("kind", "pdf") == kind:
            entry["label"] = label
            return uri
    entries.append({"uri": uri, "path": str(path), "label": label, "kind": kind, "icon": ICONS[kind]})
    return uri


def uses_editor(env) -> bool:
    """Whether any page offers the editor, so the build must ship it."""
    return any(entry.get("kind") == "editor" for entries in _store(env).values() for entry in entries)


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
        if entry.get("kind") == "editor":
            url = _editor.link(pathto, entry["uri"], app.builder.get_target_uri(pagename))
        else:
            url = pathto(entry["uri"], 1)
        group["buttons"].append(
            {
                "type": "link",
                "url": url,
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
    copied: set[str] = set()
    for entries in _store(app.env).values():
        for entry in entries:
            source = Path(entry["path"])
            if entry["uri"] in copied or not source.is_file():
                continue
            copied.add(entry["uri"])
            destination = outdir / entry["uri"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
