---
summary: >-
  Names this knowledge base the single source of truth for maintainers and
  agents; `README.md` stays the public entry point (it is also the PyPI page)
  and `RELEASING.md` the release procedure; the one agent file, `AGENTS.md`
  (`CLAUDE.md` and `CODEX.md` are symlinks to it), stays pointer-only.
always_read: true
---

# Maintainer and Agent Source of Truth

This knowledge base is the central maintainer and agent knowledge base for this
repository, started `2026-11-22`. Rules, standing reference, the work order
and the record of finished work belong here, not in commit messages or in
anyone's memory.

Other documents keep their own jobs, and the knowledge base links to them
rather than repeating them:

- `README.md` is the public entry point. It is also the package's description
  on PyPI, so it stays written for users of the extension; its developer
  notes ("Developing the editor", "Code analysis") stay short and point here.
- `RELEASING.md` is the release procedure: version bumps, tags, the publish
  workflow, the editor bundle in releases, and conda.
- `editor/build.mjs`, `editor/coverage.mjs` and `tools/editor_test.py`
  explain themselves in their header comments.

There is one agent file, `AGENTS.md`, and it only points here; `CLAUDE.md` and
`CODEX.md` are symlinks to it, so each agent finds it under the name it looks
for. Durable rules never go into it. There is deliberately no lowercase
`agents.md`: on the case-insensitive file systems macOS and Windows use by
default it would collide with `AGENTS.md`.

If anything conflicts with the knowledge base, the knowledge base wins. Raise
the conflict with the maintainer instead of guessing.
