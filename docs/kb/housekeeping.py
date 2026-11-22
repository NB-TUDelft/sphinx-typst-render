"""Knowledge-base housekeeping: rebuild the index in ``README.md`` from the sections themselves.

    uv run python docs/kb/housekeeping.py           rewrite the index between the markers
    uv run python docs/kb/housekeeping.py --check   change nothing; fail if the index is stale
                                                    or a section breaks the layout rules
    ... [--root <dir>]                              work on another knowledge base (the tests)

``tests/test_kb.py`` runs the check, so a stale index fails the test suite.

Every section is one Markdown file named ``<NNN>-<slug>.md``. Its children, if it has any, live
in the directory of the same name beside it, and the three-digit prefix orders siblings. The
files directly in the root are the groups (Mission, Rules, ... History). A section file starts
with front matter, then its one ``# Title``::

    ---
    summary: >-
      What the index says about this section, wrapped over as many indented lines as needed.
    always_read: true
    ---

    # Title

``summary`` is required and always written as a folded block (``>-``), which needs no quoting
whatever the text contains. ``always_read`` is optional and only ever ``true``; it puts the
section on the always-read list and marks its entry *always read*.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

INDEX_FILE = "README.md"
START_MARKER = "<!-- kb-index:start -->"
END_MARKER = "<!-- kb-index:end -->"
SECTION_NAME = re.compile(r"\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.md")
DIRECTORY_NAME = re.compile(r"\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*")
#: What lives in the root beside the groups: the index, this script, and its bytecode.
NOT_GROUPS = {INDEX_FILE, Path(__file__).name, "__pycache__"}
COMMAND = "uv run python docs/kb/housekeeping.py"


@dataclass
class Section:
    title: str
    summary: str
    always_read: bool
    path: str = ""
    children: list[Section] = field(default_factory=list)


def parse_section(text: str, file: str, problems: list[str]) -> Section | None:
    """Read the supported front-matter subset: a folded ``summary`` and an optional ``always_read``."""
    lines = text.split("\n")
    if lines[0] != "---":
        problems.append(f"{file}: does not start with front matter (---)")
        return None
    try:
        end = lines.index("---", 1)
    except ValueError:
        problems.append(f"{file}: front matter is never closed")
        return None
    meta = _front_matter(lines[1:end], file, problems)
    title = _title(lines[end + 1 :], file, problems)
    if meta is None or title is None:
        return None
    return Section(title, *meta)


def _front_matter(lines: list[str], file: str, problems: list[str]) -> tuple[str, bool] | None:
    summary, always_read = "", False
    i = 0
    while i < len(lines):
        line = lines[i]
        if line == "summary: >-":
            folded = []
            while i + 1 < len(lines) and lines[i + 1].startswith("  "):
                i += 1
                folded.append(lines[i].strip())
            summary = " ".join(folded)
        elif line == "always_read: true":
            always_read = True
        else:
            problems.append(f'{file}: unsupported front matter line "{line}"')
            return None
        i += 1
    if not summary:
        problems.append(f'{file}: no summary (write it as "summary: >-" and indented lines)')
        return None
    return summary, always_read


def _title(lines: list[str], file: str, problems: list[str]) -> str | None:
    first = next((line for line in lines if line.strip()), None)
    if first is None or not first.startswith("# "):
        problems.append(f'{file}: the first line after the front matter must be its "# Title"')
        return None
    in_fence, titles = False, 0
    for line in lines:
        if line.startswith("```"):
            in_fence = not in_fence
        elif not in_fence and line.startswith("# "):
            titles += 1
    if titles > 1:
        problems.append(f'{file}: has more than one "# " title; split it instead')
    return first[2:].strip()


def read_tree(root: Path, rel: str, problems: list[str]) -> list[Section]:
    """The sections of one directory, in prefix order, each with its children."""
    folder = root / rel
    names = sorted(entry.name for entry in folder.iterdir())
    sections: list[Section] = []
    prefixes: set[str] = set()
    for name in names:
        path = f"{rel}/{name}" if rel else name
        if not rel and name in NOT_GROUPS:
            continue
        if (folder / name).is_dir():
            _check_directory(name, path, names, problems)
            continue
        section = _read_section(root, path, names, prefixes, problems)
        if section is not None:
            sections.append(section)
    return sections


def _check_directory(name: str, path: str, siblings: list[str], problems: list[str]) -> None:
    if not DIRECTORY_NAME.fullmatch(name):
        problems.append(f"{path}/: not a section directory name")
    elif f"{name}.md" not in siblings:
        problems.append(f"{path}/: has no {name}.md beside it")


def _read_section(
    root: Path, path: str, siblings: list[str], prefixes: set[str], problems: list[str]
) -> Section | None:
    """One section file with its children, or None when it is broken."""
    name = Path(path).name
    if not SECTION_NAME.fullmatch(name):
        problems.append(f"{path}: not a section name like 010-some-title.md")
        return None
    prefix = name[:3]
    if prefix in prefixes:
        problems.append(f"{path}: prefix {prefix} is used twice here")
    prefixes.add(prefix)
    section = parse_section((root / path).read_text(encoding="utf-8"), path, problems)
    if section is None:
        return None
    section.path = path
    if name.removesuffix(".md") in siblings:
        section.children = read_tree(root, path.removesuffix(".md"), problems)
    return section


def _link_text(text: str) -> str:
    return text.replace("[", r"\[").replace("]", r"\]")


def _entries(sections: list[Section], depth: int) -> list[str]:
    lines = []
    for section in sections:
        flag = " (*always read*)" if section.always_read else ""
        link = f"[{_link_text(section.title)}]({section.path})"
        lines.append(f"{'  ' * depth}- {link}{flag} — {section.summary}")
        lines += _entries(section.children, depth + 1)
    return lines


def always_read(sections: list[Section]) -> list[Section]:
    found = []
    for section in sections:
        if section.always_read:
            found.append(section)
        found += always_read(section.children)
    return found


def render_index(groups: list[Section]) -> str:
    """The generated part of README.md, markers included."""
    out = [START_MARKER, "", "**Always read**, in this order:", ""]
    out += [f"{i}. [{_link_text(s.title)}]({s.path})" for i, s in enumerate(always_read(groups), 1)]
    for group in groups:
        out += ["", f"**{group.title}**: {group.summary}", "", *_entries(group.children, 0)]
    out += ["", END_MARKER]
    return "\n".join(out)


def splice_index(readme: str, index: str) -> str | None:
    """Replace the marked region of ``readme``, or return None when the markers are missing."""
    start, end = readme.find(START_MARKER), readme.find(END_MARKER)
    if start == -1 or end == -1 or end < start:
        return None
    return readme[:start] + index + readme[end + len(END_MARKER) :]


def main(argv: list[str]) -> int:
    check = "--check" in argv
    root = Path(__file__).resolve().parent
    if "--root" in argv:
        at = argv.index("--root") + 1
        if at == len(argv) or argv[at].startswith("--"):
            print("kb: --root needs a directory", file=sys.stderr)
            return 2
        root = Path(argv[at]).resolve()
    problems: list[str] = []
    groups = read_tree(root, "", problems)
    readme_path = root / INDEX_FILE
    readme = readme_path.read_text(encoding="utf-8")
    updated = splice_index(readme, render_index(groups))
    if updated is None:
        problems.append(f"{INDEX_FILE}: missing {START_MARKER} / {END_MARKER}")
    if problems:
        for problem in problems:
            print(f"kb: {problem}", file=sys.stderr)
        return 1
    if check:
        if updated == readme:
            return 0
        print(f"kb: {INDEX_FILE} is out of date; run {COMMAND}", file=sys.stderr)
        return 1
    if updated != readme:
        readme_path.write_text(updated, encoding="utf-8")
    print(f"kb: {INDEX_FILE} {'already current' if updated == readme else 'rewritten'}")
    print(f"kb: {len(groups)} groups, {len(always_read(groups))} always-read sections")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
