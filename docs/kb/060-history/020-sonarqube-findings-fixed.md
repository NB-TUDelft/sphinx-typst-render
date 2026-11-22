---
summary: >-
  Record (`2026-11-22`): after merging `origin/main` (1.1.2), the SonarQube
  findings went from 133 to 1 in eight signed commits: reliability fixes,
  mechanical clean-ups, the Python findings, async loops, and the export, hints
  and wrapping split into named steps; the browser test gained checks 19 to 21;
  the `tabindex` on the viewer is left for the maintainer.
---

# SonarQube findings fixed (`2026-11-22`)

The maintainer asked for the findings to be fixed once `origin/main` was
merged (`8dbb049`), and said the EI_Logbooks editor is discontinued, so the
editor's code no longer has to stay close to it (Mission).

The scan of the merged tree found 133 open issues: 19 reliability (the gate
allows none) and 125 maintainability (it allows 100). In order:

1. `9f68b81`: the reliability findings: `replaceAll`, `Number.*`, `void` on
   promises nobody waits for, and the DA string read with a tokenizer instead
   of regular expressions that backtrack on long digit runs.
2. `ed023b6`: 67 mechanical maintainability fixes in the editor and the
   download menu's script.
3. `0a55c52`: the Python findings, and two the previous commit left.
4. `841504a`: the 21 awaits in loops, with `inSequence()` for work that must
   not overlap.
5. `439f212`: browser-test checks 19 to 21, for save migration, printing and
   deleting saved work, which the last commit reworked and nothing tested.
6. `f74adf0`: the three Python functions that were too complex.
7. `c41a9ec` and `8109a77`: the export (complexity 149), the live hints and
   line wrapping, split into named steps; the export checked identical to one
   made before, but for the photo's insertion time.

The conventions these settled are in Editor code conventions, under
Reference.

**Checks.** pytest 52 passed, 1 skipped, at every step; the browser test
passed every check at every step, 27 by the end; editor coverage rose from
78.7% to 83.0% of lines. The last scan left one issue, the gate red on it
alone: every new-code condition passed (85.2% coverage on new code).

**Left open.** Reliability finding `Web:S6845` on the `tabindex` of
`#viewerContainer` in `viewer.html`. It is pdf.js's keyboard-scrollable
region, and `editor/biome.json` already exempts the same rule; whether to
accept it on the server or drop the `tabindex` is the maintainer's call
(work order).
