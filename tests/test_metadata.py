"""What the installed package declares."""

from __future__ import annotations

from importlib.metadata import distribution


def test_every_declared_entry_point_loads() -> None:
    # Up to 1.1.2, pyproject.toml declared a console script for a main() that
    # never existed, so the command every install put on the path failed.
    for entry_point in distribution("sphinx-typst-render").entry_points:
        entry_point.load()
