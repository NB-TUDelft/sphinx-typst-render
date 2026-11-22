---
summary: >-
  Standing rules: `main` is the release branch and work branches merge into it
  (`claude/<topic>` for agents; `v0` keeps the 0.x line); commits and tags are
  signed and signing is never bypassed; commit or push only when the maintainer
  asks; subject lines in the style of the recent history.
always_read: true
---

# Commits and branches

- `main` is the release branch: a release is a tag on it (`RELEASING.md`).
  Work happens on branches that merge into `main`; agents' branches are named
  `claude/<topic>`. `v0` ends at 0.2.5, the last MIT release.
- Commits and tags are signed: the maintainer's git configuration sets
  `commit.gpgsign` and `tag.gpgsign`. Never pass `--no-gpg-sign` or switch
  signing off; if signing fails, stop and tell the maintainer. Check with
  `git log --format='%h %G? %s'`. Commits made in cloud agent sessions can
  arrive unsigned (`N`, as `772f258`); the merge that brings them in is signed.
- Commit or push only when the maintainer asks.
- Write the subject as a short sentence in the imperative, without a type
  prefix, as the recent history does: `Switch editor linting from ESLint to
  Biome`. A release commit is `Release X.Y.Z`.
