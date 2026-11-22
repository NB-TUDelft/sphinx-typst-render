---
summary: >-
  Standing guidance from the SonarQube clean-up (`2026-11-22`): independent
  async work runs together, work that must not overlap goes through
  `inSequence()` with the reason beside it; `void` only on promises whose
  function handles its own errors; long functions become named steps, since
  SonarQube counts nested functions into the outer one; a change to the export
  is checked against an export made before it (`tools/compare_exports.py`).
---

# Editor code conventions

These come from fixing the editor's SonarQube findings (`2026-11-22`) and
hold for new and touched code in `editor/src/`.

- **Async work.** Run independent work together with `Promise.all`, keeping
  the order of the results where it matters: the outline keeps each entry
  before its sub-parts. Work that must not overlap goes through
  `inSequence(items, fn)` from `util.js`, with the reason in a comment:
  moving saves, where two saves of one document would both read its key before
  either wrote it, and printing, where every page holds a full-size canvas.
  No `await` inside a loop.
- **Promises nobody waits for** are marked `void`, and only when the function
  handles its own errors (`drawThumb`, a slot's `insert`) or failing does no
  harm (`task.destroy()`).
- **Complexity.** SonarQube counts a nested function into the function around
  it, in JavaScript and Python alike. A long function becomes named steps at
  module level that share state through a small object, as the export's
  context and a hint box do, rather than closures in one body.
- **A catch block that ignores its error** says why in a comment; one that
  does something else instead uses an optional catch binding (`catch {`).
- **Browser globals** go through `globalThis`, and guarded property access
  through optional chaining.

## Changing the export

The export (`export.js`) is what students hand in, and its labels are what
grading scripts read. Before changing it, run the browser test and copy
`editor-test/<date>/reopen_export.pdf` aside; after, run it again and compare:

```bash
uv run python tools/compare_exports.py before.pdf editor-test/<date>/reopen_export.pdf
```

It compares every page's content stream and text, and `LogbookFields`; only
the photo's `inserted` time may differ. A change meant to alter the export
shows exactly where it did. The split of `flattenedBytes()` (`2026-11-22`)
matched in everything else.
