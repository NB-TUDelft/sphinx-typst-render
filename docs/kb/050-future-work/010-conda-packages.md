---
summary: >-
  Conda publishing stays off until `typst` (the Python binding) and
  `typst-fillable` are on conda-forge; `RELEASING.md`, "Conda is off, and why",
  has the reasons and the steps to turn it on.
---

# Conda packages

The publish workflow can build a conda package from `[tool.conda-recipe]` in
`pyproject.toml`, but it is switched off: two runtime dependencies are on PyPI
only. conda-forge's `typst` is the Rust command-line tool, not the importable
binding, so mapping to it would be wrong. `RELEASING.md` keeps the full
reasoning and the steps for turning conda on; this entry only keeps the item
on the list.
