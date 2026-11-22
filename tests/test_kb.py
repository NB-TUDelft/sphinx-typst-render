"""The knowledge base's index (docs/kb/housekeeping.py), and that this repository's is current."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "docs" / "kb" / "housekeeping.py"
_spec = importlib.util.spec_from_file_location("kb_housekeeping", SCRIPT)
kb = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = kb  # dataclasses look their module up there
_spec.loader.exec_module(kb)

README_HEAD = "# Knowledge base\n\nHand-written intro.\n\n"
MARKERS = "<!-- kb-index:start -->\n<!-- kb-index:end -->\n"


def section(title: str, summary: str, always_read: bool = False, body: str = "") -> str:
    flag = "always_read: true\n" if always_read else ""
    return f"---\nsummary: >-\n  {summary}\n{flag}---\n\n# {title}\n\n{body or f'Body of {title}.'}\n"


def make_kb(root: Path, files: dict[str, str]) -> Path:
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text, encoding="utf-8")
    return root


def readme(root: Path) -> str:
    return (root / "README.md").read_text(encoding="utf-8")


def test_this_repositorys_knowledge_base_is_current(capsys) -> None:
    status = kb.main(["--check"])
    assert status == 0, capsys.readouterr().err


def test_the_index_comes_from_titles_and_front_matter_in_prefix_order(tmp_path: Path, capsys) -> None:
    root = make_kb(
        tmp_path,
        {
            "README.md": README_HEAD + MARKERS,
            "010-rules.md": section("Rules", "how to work here."),
            "010-rules/020-later.md": section("Later [b]", "comes second"),
            "010-rules/010-first.md": section("First", "comes first: with a colon", always_read=True),
            "010-rules/010-first/010-child.md": section("Child", "nested under First", always_read=True),
            "020-history.md": section("History", "finished work."),
            "020-history/010-record.md": section("Record", "an old record"),
        },
    )

    assert kb.main(["--root", str(root)]) == 0
    assert (
        readme(root)
        == README_HEAD
        + """<!-- kb-index:start -->

**Always read**, in this order:

1. [First](010-rules/010-first.md)
2. [Child](010-rules/010-first/010-child.md)

**Rules**: how to work here.

- [First](010-rules/010-first.md) (*always read*) — comes first: with a colon
  - [Child](010-rules/010-first/010-child.md) (*always read*) — nested under First
- [Later \\[b\\]](010-rules/020-later.md) — comes second

**History**: finished work.

- [Record](020-history/010-record.md) — an old record

<!-- kb-index:end -->
"""
    )
    assert "rewritten" in capsys.readouterr().out
    assert kb.main(["--root", str(root)]) == 0
    assert "already current" in capsys.readouterr().out
    assert kb.main(["--check", "--root", str(root)]) == 0


def test_a_summary_folds_its_lines_into_one(tmp_path: Path) -> None:
    folded = "---\nsummary: >-\n  first line,\n  second line.\n---\n\n# Group\n"
    root = make_kb(tmp_path, {"README.md": MARKERS, "010-group.md": folded})
    assert kb.main(["--root", str(root)]) == 0
    assert "**Group**: first line, second line." in readme(root)


def test_check_fails_on_a_stale_index_and_changes_nothing(tmp_path: Path, capsys) -> None:
    root = make_kb(tmp_path, {"README.md": MARKERS, "010-group.md": section("Group", "a group.")})
    assert kb.main(["--check", "--root", str(root)]) == 1
    assert "out of date" in capsys.readouterr().err
    assert readme(root) == MARKERS


def test_a_title_inside_a_code_fence_is_not_a_second_title(tmp_path: Path) -> None:
    body = "```markdown\n# Not a title\n```"
    root = make_kb(tmp_path, {"README.md": MARKERS, "010-group.md": section("Group", "a group.", body=body)})
    assert kb.main(["--root", str(root)]) == 0


GROUP = section("Group", "a group.")


@pytest.mark.parametrize(
    ("files", "problem"),
    [
        ({"010-Bad Name.md": GROUP}, "not a section name"),
        ({"010-a.md": GROUP, "010-b.md": GROUP}, "prefix 010 is used twice"),
        ({"010-group.md": GROUP, "020-orphan/010-x.md": GROUP}, "has no 020-orphan.md beside it"),
        ({"010-group.md": GROUP, "notes/010-x.md": GROUP}, "not a section directory name"),
        ({"010-group.md": "# Group\n"}, "does not start with front matter"),
        ({"010-group.md": "---\nsummary: >-\n  a group.\n"}, "front matter is never closed"),
        ({"010-group.md": "---\ntitle: Group\n---\n\n# Group\n"}, 'unsupported front matter line "title: Group"'),
        ({"010-group.md": "---\nalways_read: true\n---\n\n# Group\n"}, "no summary"),
        ({"010-group.md": "---\nsummary: >-\n  a group.\n---\n\nNo title.\n"}, 'must be its "# Title"'),
        ({"010-group.md": section("Group", "a group.", body="# Another")}, 'more than one "# " title'),
    ],
)
def test_a_broken_layout_is_reported_and_the_index_left_alone(tmp_path: Path, capsys, files, problem) -> None:
    root = make_kb(tmp_path, {"README.md": MARKERS, **files})
    assert kb.main(["--root", str(root)]) == 1
    assert problem in capsys.readouterr().err
    assert readme(root) == MARKERS


def test_an_index_without_its_markers_is_reported(tmp_path: Path, capsys) -> None:
    root = make_kb(tmp_path, {"README.md": "# Knowledge base\n", "010-group.md": GROUP})
    assert kb.main(["--check", "--root", str(root)]) == 1
    assert "missing <!-- kb-index:start -->" in capsys.readouterr().err


def test_root_needs_a_directory(capsys) -> None:
    assert kb.main(["--root"]) == 2
    assert "--root needs a directory" in capsys.readouterr().err
