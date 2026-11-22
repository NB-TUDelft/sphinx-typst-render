"""Compare two editor exports, to check that a change to the export changed nothing it should not.

    uv run python tools/compare_exports.py BEFORE.pdf AFTER.pdf

Make BEFORE.pdf with the browser test (tools/editor_test.py) before the
change, copying editor-test/<date>/reopen_export.pdf aside, and AFTER.pdf by
running it again after. Compares the page count, each page's content stream
(pdf-lib gives resource names a random suffix, which is ignored) and text,
and the LogbookFields record, listing every entry that differs. The photo's
`inserted` time always differs between two runs. Exit code 0 means the two
match in everything else.
"""

import json
import re
import sys

from pypdf import PdfReader

SUFFIX = re.compile(rb"(/[A-Za-z][^\s/\[\]()<>{}%]*?)-\d+(?=[\s/\[\]()<>])")
EXPECTED = {".images.photo.inserted"}


def fingerprint(path):
    reader = PdfReader(path)
    pages = [(SUFFIX.sub(rb"\1-N", page.get_contents().get_data()), page.extract_text()) for page in reader.pages]
    return pages, json.loads(reader.metadata["/LogbookFields"])


def differences(a, b, path=""):
    """Paths into two JSON values where they differ."""
    if isinstance(a, dict) and isinstance(b, dict):
        return [d for k in sorted(set(a) | set(b)) for d in differences(a.get(k), b.get(k), f"{path}.{k}")]
    return [] if a == b else [path]


def main(before, after):
    pages_a, fields_a = fingerprint(before)
    pages_b, fields_b = fingerprint(after)
    same = len(pages_a) == len(pages_b)
    print(f"pages: {len(pages_a)} and {len(pages_b)}")
    for n, (a, b) in enumerate(zip(pages_a, pages_b), 1):
        print(f"page {n}: content {'same' if a[0] == b[0] else 'DIFFERENT'}, text {'same' if a[1] == b[1] else 'DIFFERENT'}")
        same = same and a == b
    for path in differences(fields_a, fields_b):
        print(f"LogbookFields{path}: {'differs, as expected' if path in EXPECTED else 'DIFFERENT'}")
        same = same and path in EXPECTED
    print("MATCH" if same else "MISMATCH")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
