"""The in-browser editor: a page on pdf.js where students fill in a PDF.

The bundle lives in ``_editor/`` beside this module. It is built from the
``editor/`` folder of the source repository with npm (see RELEASING.md) and
ships in every wheel. A source checkout that has not run that build has no
editor, and asking for one then fails with :data:`MISSING`.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from urllib.parse import quote

from sphinx.errors import ExtensionError
from sphinx.util import logging

LOGGER = logging.getLogger(__name__)

#: The prebuilt bundle inside the package.
ASSETS = Path(__file__).parent / "_editor"

#: Where the bundle goes, below the HTML output root.
URI_PREFIX = "_static/typst-editor"
VIEWER = f"{URI_PREFIX}/viewer.html"

#: From the viewer page back up to the output root.
TO_ROOT = "../../"

MISSING = (
    "the editor is not built into this installation of sphinx-typst-render. "
    "Install a release from PyPI, or run `npm ci && npm run build` in the "
    "editor/ folder of a source checkout."
)

#: What ``typst_render_editor`` may set, with defaults. The editor has the
#: same defaults, so a key left out behaves the same either way.
DEFAULTS: dict[str, object] = {
    # One name for the browser storage, the tab channel and the sidebar
    # setting, so two sites on one origin keep their saves apart.
    "storage": "typst-render-editor",
    # JavaScript regular expression turning a PDF's file stem into its save
    # key: the first group, or the whole match. Unset, the stem is the key.
    "key_pattern": None,
    # Old key or stem -> new key, for renumbered or merged documents. Either
    # {"keys": {...}} or the mapping itself.
    "aliases": {},
    # Exports wrap every answer in invisible [[<label_prefix>:...]] labels.
    "label_prefix": "FORM",
    # What the documents are called in the editor's messages.
    "noun": "worksheet",
    "noun_plural": None,
    # Optional short mark before the title in the toolbar, e.g. a course code.
    "brand": "",
    # Shown after an export.
    "export_message": "Exported. You can come back to change it and export again.",
}


def available() -> bool:
    """Whether this installation carries the built editor."""
    return (ASSETS / "viewer.html").is_file() and (ASSETS / "editor.js").is_file()


def settings(config) -> dict[str, object]:
    """``typst_render_editor`` merged with the defaults, as the editor reads it."""
    given = config.typst_render_editor or {}
    if not isinstance(given, dict):
        raise ExtensionError("typst_render_editor must be a mapping")
    unknown = sorted(set(given) - set(DEFAULTS))
    if unknown:
        LOGGER.warning(
            "sphinx-typst-render: typst_render_editor has unknown keys, ignored: %s",
            ", ".join(unknown),
            type="typst_render",
        )
    merged = {**DEFAULTS, **{key: value for key, value in given.items() if key in DEFAULTS}}
    aliases = dict(merged["aliases"] or {})
    if aliases and "keys" not in aliases:
        aliases = {"keys": aliases}
    return {
        "storage": str(merged["storage"]),
        "keyPattern": merged["key_pattern"],
        "aliases": aliases,
        "labelPrefix": str(merged["label_prefix"]),
        "noun": str(merged["noun"]),
        "nounPlural": merged["noun_plural"],
        "brand": str(merged["brand"]),
        "exportMessage": str(merged["export_message"]),
    }


def install(app) -> Path:
    """Copy the bundle into the HTML output and write the settings beside it."""
    if not available():
        raise ExtensionError(f"sphinx-typst-render: {MISSING}")
    target = Path(app.builder.outdir) / URI_PREFIX
    shutil.copytree(ASSETS, target, dirs_exist_ok=True)
    data = json.dumps(settings(app.config), indent=1, ensure_ascii=False)
    (target / "config.js").write_text(f"window.typstEditorConfig = {data};\n", encoding="utf-8")
    return target


def link(pathto, pdf_uri: str, page_uri: str) -> str:
    """The URL, relative to the current page, that opens ``pdf_uri`` in the editor.

    ``back`` leads to the page the menu sits on; the editor offers it as Back
    to the page, and only follows it within the same site.
    """
    query = f"file={quote(TO_ROOT + pdf_uri)}&back={quote(TO_ROOT + page_uri)}"
    return f"{pathto(VIEWER, 1)}?{query}"
