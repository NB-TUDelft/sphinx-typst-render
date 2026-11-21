"""The ``typst-overview`` directive: every rendered document of the book on one page.

The directive only marks the spot. The list is filled in once every page has
been read (``doctree-resolved``), because it gathers what the ``typst``
directives on all the other pages registered. Cards come in reading order,
grouped under the page one level up in the table of contents ("Week 1", say),
and each opens its block's first menu entry: the editor, in a book that offers
it first.
"""

from __future__ import annotations

import html

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.util.docutils import SphinxDirective

from . import _downloads, _editor

#: Attribute on the build environment holding the pages that show an overview.
ENV_KEY = "typst_render_overview_docs"

#: Link text for a card's other entries, after its main one.
KIND_NAMES = {"pdf": "PDF", "raw": "Source", "editor": "Editor"}


class overview(nodes.General, nodes.Element):
    """Where the list goes; replaced once every page has been read."""


def _skip(translator, node) -> None:
    raise nodes.SkipNode


#: Builders that never see the list (it is HTML only) skip the placeholder.
VISITORS = {name: (_skip, None) for name in ("html", "latex", "text", "man", "texinfo")}


def _docs(env) -> set[str]:
    if not hasattr(env, ENV_KEY):
        setattr(env, ENV_KEY, set())
    return getattr(env, ENV_KEY)


def _labels(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class TypstOverviewDirective(SphinxDirective):
    """List every document the ``typst`` directive offers in this book.

    ::

        ```{typst-overview}
        :highlight: Entry 3.1
        ```

    ``:highlight:`` repeats the named entries (their ``:label:``, comma
    separated) in a box on top, headed ``:highlight-title:`` ("Highlight").
    """

    has_content = False
    option_spec = {
        "highlight": directives.unchanged,
        "highlight-title": directives.unchanged,
    }

    def run(self) -> list[nodes.Node]:
        _docs(self.env).add(self.env.docname)
        node = overview()
        node["highlight"] = _labels(self.options.get("highlight", ""))
        node["highlight_title"] = self.options.get("highlight-title") or "Highlight"
        return [node]


def purge_doc(app, env, docname: str) -> None:
    _docs(env).discard(docname)


def merge_info(app, env, docnames, other) -> None:
    _docs(env).update(_docs(other))


def outdated(app, env, added, changed, removed) -> list[str]:
    """Rebuild the overview pages whenever any page changed, so they stay current."""
    if added or changed or removed:
        return sorted(_docs(env) - set(removed))
    return []


def _title(env, docname: str) -> str:
    title = env.titles.get(docname)
    return title.astext() if title is not None else docname


def _blocks(entries: list[dict]) -> list[list[dict]]:
    """A page's entries per ``typst`` block, each in its menu order."""
    blocks: dict[str, list[dict]] = {}
    for entry in entries:
        key = entry.get("digest") or entry["uri"].split("/")[-2]
        blocks.setdefault(key, []).append(entry)
    return list(blocks.values())


def render(app, docname: str, node: overview) -> str:
    """The overview as HTML, its links relative to ``docname``."""
    env, builder = app.env, app.builder
    here = builder.get_target_uri(docname)
    to_root = "../" * here.count("/")

    def pathto(uri: str, resource: bool = False) -> str:
        return to_root + uri

    def url(entry: dict) -> str:
        if entry.get("kind") == "editor":
            # The editor's Back link returns here, where the student came from.
            return _editor.link(pathto, entry["uri"], here)
        return to_root + entry["uri"]

    store = _downloads._store(env)
    relations = env.collect_relations()
    # Reading order: the table of contents, then any page outside it.
    order = [doc for doc in relations if store.get(doc)]
    order += sorted(doc for doc in store if store[doc] and doc not in relations)
    root = app.config.root_doc
    groups: dict[str, list[str]] = {}
    highlighted: list[str] = []
    for doc in order:
        parent = relations.get(doc, [None])[0]
        group = _title(env, parent if parent and parent != root else doc)
        for block in _blocks(store[doc]):
            card = _card(block, url, _title(env, doc), builder.get_relative_uri(docname, doc))
            groups.setdefault(group, []).append(card)
            if (block[0].get("title") or block[0]["label"]) in node["highlight"]:
                highlighted.append(card)

    if not groups:
        return '<div class="typst-overview"><p class="typst-overview-empty">Nothing to list yet.</p></div>'
    parts = ['<div class="typst-overview">']
    if highlighted:
        parts.append(
            '<section class="typst-overview-highlight">'
            + _group(node["highlight_title"], highlighted)
            + "</section>"
        )
    parts += [_group(title, cards) for title, cards in groups.items()]
    parts.append("</div>")
    return "\n".join(parts)


def _group(title: str, cards: list[str]) -> str:
    return (
        f'<h2 class="typst-overview-group">{html.escape(title)}</h2>\n'
        '<ul class="typst-overview-list">\n' + "\n".join(cards) + "\n</ul>"
    )


def _card(block: list[dict], url, page_title: str, page_url: str) -> str:
    """One block: its first entry opens from the whole card; the page and the
    block's other entries are links underneath."""
    main, others = block[0], block[1:]
    title = main.get("title") or main["label"]
    more = [f'<a href="{html.escape(page_url)}">{html.escape(page_title)}</a>']
    more += [
        f'<a href="{html.escape(url(entry))}">{html.escape(KIND_NAMES.get(entry.get("kind"), entry["label"]))}</a>'
        for entry in others
    ]
    return (
        '<li class="typst-overview-item">'
        f'<a class="typst-overview-open" href="{html.escape(url(main))}" title="{html.escape(main["label"])}">'
        f"{html.escape(title)}</a>"
        f'<span class="typst-overview-more">{" · ".join(more)}</span>'
        "</li>"
    )


def resolve(app, doctree, docname: str) -> None:
    for node in list(doctree.findall(overview)):
        if getattr(app.builder, "format", None) == "html":
            node.replace_self(nodes.raw("", render(app, docname, node), format="html"))
        else:
            node.replace_self([])
