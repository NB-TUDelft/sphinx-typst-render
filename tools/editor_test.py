"""Playwright + pypdf end-to-end test of the in-browser editor.

Builds a small Sphinx site with one fillable worksheet, opens it in the
shipped editor, fills it in, exports it, and opens the export again to check
that the parked editable layer comes back: same fields, same image, overflow
pages dropped, and a second export identical to the first. It also checks
the restore bar that offers saved work after a reload. Screenshots and a
report.md go to editor-test/<date>/. Exit code 0 means PASS, 1 means FAIL.

Needs the editor bundle built (`pnpm run check` in editor/) plus playwright
and pypdf in the Python environment. Locally set CHROMIUM_PATH to a Chromium
binary if Playwright's own browser is not installed; on GitHub the
editor-test workflow installs it.

With EDITOR_COVERAGE set to a folder it also saves the editor's V8 coverage
there, for `pnpm run coverage` in editor/ (see editor/coverage.mjs).
"""

import base64
import functools
import http.server
import io
import json
import os
import struct
import sys
import tempfile
import threading
import time
import zlib
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from sphinx.application import Sphinx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parent.parent
TODAY = datetime.now().strftime("%Y-%m-%d")
OUT_DIR = REPO / "editor-test" / TODAY
PARK_KEY = "/FORMEditable"  # default label_prefix, see editor/src/config.js

SHEET = """\
#import "/_typst_lib/capture_field.typ": capture_field, text_field, textarea_field
#set page(width: 170mm, height: 135mm, margin: 12mm)
= Exercise 1
Name: #text_field("name")

Preparation:
#textarea_field("preparation", height: 36pt)

Photo:
#capture_field(field_name: "img_photo", field_type: "text", fill_cell: true, min_height: 80pt)[#box(width: 100%, height: 80pt, stroke: 0.5pt + gray)]
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # No request log: the output stays the list of checks.
        pass


def start_server(directory):
    handler = functools.partial(QuietHandler, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def make_png(w=60, h=40, rgb=(0xD0, 0x30, 0x30)):
    """A small valid solid-colour PNG, as bytes."""

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def build_site(work):
    """A one-page Sphinx site offering the worksheet in the editor."""
    src = work / "src"
    src.mkdir(parents=True)
    (src / "conf.py").write_text(
        'extensions = ["sphinx_typst_render"]\n'
        'typst_render_open = ["editor"]\n'
    )
    (src / "sheet.typ").write_text(SHEET)
    (src / "index.rst").write_text("Test\n====\n\n.. typst:: sheet.typ\n   :label: Sheet\n   :fillable:\n")
    out = work / "out"
    app = Sphinx(str(src), str(src), str(out), str(work / "doctrees"), "html",
                 status=None, warning=io.StringIO(), freshenv=True)
    app.build()
    assert (out / "_static" / "typst-editor" / "viewer.html").is_file()
    pdf = next((out / "_downloads" / "typst").rglob("sheet.pdf"))
    return out, pdf.relative_to(out).as_posix()


# Export through the editor with a scripted overflow choice, bytes as base64.
EXPORT_JS = """
async (pick) => {
    const r = await window.typstRenderEditor.exportBytesWith(pick);
    let s = '';
    for (let i = 0; i < r.bytes.length; i += 32768)
        s += String.fromCharCode(...r.bytes.subarray(i, i + 32768));
    return { b64: btoa(s), asked: r.asked };
}
"""


def wait_editor(pg, timeout=60000):
    pg.wait_for_function(
        "() => !!(window.typstRenderEditor && window.typstRenderEditor.state().id)",
        timeout=timeout,
    )
    pg.wait_for_selector('[name="name"], [name="preparation"]', state="attached", timeout=timeout)
    time.sleep(1.0)
    # A document with nothing saved in this browser first offers an import.
    pg.evaluate("document.getElementById('lbWelcomeStart')?.click()")
    time.sleep(0.3)


def set_field(pg, name, value):
    pg.fill(f'[name="{name}"]', value)
    pg.keyboard.press("Tab")  # pdf.js commits the value on blur
    time.sleep(0.2)


def field_value(pg, name):
    return pg.evaluate(f"document.querySelector('[name={name}]')?.value")


class Coverage:
    """The editor's V8 coverage, when EDITOR_COVERAGE names a folder.

    Each save() writes what ran since the last one, in the format c8 reads
    (that of NODE_V8_COVERAGE). The served URLs become the bundle files they
    were copied from, so c8 can follow their source maps back to editor/src/.
    Save before every navigation: a page's counts go with it.
    """

    def __init__(self, ctx, pg, served, assets):
        folder = os.environ.get("EDITOR_COVERAGE")
        self.dir = Path(folder) if folder else None
        if not self.dir:
            return
        self.dir.mkdir(parents=True, exist_ok=True)
        self.served, self.assets, self.saved = served, assets, 0
        self.cdp = ctx.new_cdp_session(pg)
        self.cdp.send("Profiler.enable")
        self.cdp.send("Profiler.startPreciseCoverage", {"callCount": True, "detailed": True})

    def save(self):
        if not self.dir:
            return
        result = []
        for script in self.cdp.send("Profiler.takePreciseCoverage")["result"]:
            url = script["url"].split("?")[0]
            if not url.startswith(self.served):
                continue
            # config.js is written per site and has no counterpart here.
            file = self.assets / url[len(self.served):]
            if file.suffix == ".js" and file.is_file():
                result.append({**script, "url": file.as_uri()})
        self.saved += 1
        (self.dir / f"editor-{os.getpid()}-{self.saved}.json").write_text(
            json.dumps({"result": result}), encoding="utf-8")


def run_suite():
    from sphinx_typst_render import _editor
    if not _editor.available():
        print("editor bundle not built: run `pnpm install && pnpm run check` in editor/")
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / "test_pic.png"
    png_path.write_bytes(make_png())
    states = []
    console_errors = []

    def record(name, ok, note=""):
        states.append((name, "PASS" if ok else "FAIL", note))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {note}", flush=True)

    def snap(pg, name):
        pg.screenshot(path=str(OUT_DIR / f"{name}.png"))

    with tempfile.TemporaryDirectory(prefix="editor-test-") as tmp:
        out, pdf_rel = build_site(Path(tmp))
        httpd, port = start_server(out)
        base = f"http://127.0.0.1:{port}"
        editor_url = (
            f"{base}/_static/typst-editor/viewer.html?file=../../{pdf_rel}"
            "&back=../../index.html"
        )

        short_answer = "Short answer with Ünïcode."
        long_answer = "A very long answer. " * 120

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None)
            try:
                ctx = browser.new_context(viewport={"width": 1300, "height": 1000}, accept_downloads=True)
                pg = ctx.new_page()
                cov = Coverage(ctx, pg, f"{base}/{_editor.URI_PREFIX}/", _editor.ASSETS)
                pg.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

                # Fill the worksheet and put a photo in the image box.
                pg.goto(editor_url)
                wait_editor(pg)
                has_print = pg.evaluate("!!document.getElementById('lbMenuPrint')")
                record("00_print_item_shown_by_default", has_print, "show_print defaults to true")
                has_back = pg.evaluate("!!document.getElementById('lbMenuBack')")
                record("00_back_item_shown_by_default", has_back, "show_back defaults to true")
                set_field(pg, "name", short_answer)
                set_field(pg, "preparation", long_answer)
                pg.evaluate("""() => {
                    const inp = document.createElement('input');
                    inp.type = 'file'; inp.id = 'etTestFile'; inp.style.display = 'none';
                    document.body.appendChild(inp);
                    window.typstRenderEditor.setTestFile('etTestFile');
                }""")
                pg.set_input_files("#etTestFile", str(png_path))
                slot_name = pg.evaluate("window.typstRenderEditor.state().slots[0]?.name || null")
                record("01_image_slot_found", slot_name == "photo", f"slot={slot_name!r}")
                pg.evaluate("""(sname) => new Promise(cb => {
                    window.typstRenderEditor.slotInsert(sname);
                    const waitIdle = () => {
                        if (!document.body.classList.contains('lb-busy')
                            && window.typstRenderEditor.state().images['slot:' + sname]) cb(true);
                        else setTimeout(waitIdle, 200);
                    };
                    setTimeout(waitIdle, 400);
                })""", slot_name)
                # And a photo dropped onto the page itself, outside any image box.
                pg.evaluate("""(b64) => {
                    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                    const dt = new DataTransfer();
                    dt.items.add(new File([bin], 'loose.png', { type: 'image/png' }));
                    const t = document.querySelector('.page[data-page-number="1"]');
                    t.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
                    t.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
                }""", base64.b64encode(png_path.read_bytes()).decode())
                time.sleep(2)
                pg.click("#lbToolSelect")
                pages_before = pg.evaluate("window.typstRenderEditor.state().pageInfo.length")
                snap(pg, "01_filled")

                # Export, moving the overflow to an extra page.
                res = pg.evaluate(EXPORT_JS, "overflow")
                asked = [i["name"] for i in res["asked"]]
                record("02_overflow_asked", asked == ["preparation"], f"asked={asked}")
                exp = base64.b64decode(res["b64"])
                (OUT_DIR / "reopen_export.pdf").write_bytes(exp)
                r = PdfReader(io.BytesIO(exp))
                root = r.trailer["/Root"]
                lf = json.loads(r.metadata["/LogbookFields"])
                record("03_export_is_flat", "/AcroForm" not in root, "export has no form")
                record("04_no_live_annotations", all(
                    not any(a.get_object()["/Subtype"] in ("/Widget", "/Ink", "/Stamp")
                            for a in (page.get("/Annots", []) or []))
                    for page in r.pages), "no widgets or stamps left as annotations")
                record("05_editable_layer_parked", PARK_KEY in root, "editable layer parked in the catalog")
                record("06_overflow_page_added", len(r.pages) > pages_before,
                       f"{pages_before} -> {len(r.pages)} pages")
                slots = sum(1 for v in lf["images"].values() if v and v.get("kind") == "slot")
                record("07_photo_listed", slots == 1, f"slot images={slots}")
                loose = [k for k, v in lf["images"].items() if v and v.get("kind") == "loose"]
                text1 = r.pages[0].extract_text()
                record("07b_loose_photo_labelled", loose == ["loose:1-1"] and 'loose="1-1"' in text1,
                       f"loose images={loose}")

                # Open the export as a fresh file: the editable layer comes back.
                (out / "reopen_export.pdf").write_bytes(exp)
                cov.save()
                pg.goto(f"{base}/_static/typst-editor/viewer.html?file=../../reopen_export.pdf")
                wait_editor(pg)
                toasts = pg.evaluate("[...document.querySelectorAll('.lb-toast')].map(t => t.innerText)")
                record("08_reopen_toast", any("Opened your exported" in t for t in toasts), str(toasts))
                pages_now = pg.evaluate("window.typstRenderEditor.state().pageInfo.length")
                record("09_overflow_page_removed_on_reopen", pages_now == pages_before,
                       f"{len(r.pages)} -> {pages_now} pages")
                record("10_short_answer_back", field_value(pg, "name") == short_answer,
                       "short answer in a live field")
                record("11_long_answer_back_in_full", field_value(pg, "preparation") == long_answer,
                       "long answer in a live field, uncut")
                images_back = pg.evaluate("Object.keys(window.typstRenderEditor.state().images)")
                record("12_photo_back", "slot:photo" in images_back, f"images={images_back}")
                snap(pg, "02_reopened")

                # A second export of the reopened file matches the first.
                r2 = PdfReader(io.BytesIO(base64.b64decode(pg.evaluate(EXPORT_JS, "overflow")["b64"])))
                lf2 = json.loads(r2.metadata["/LogbookFields"])
                for k in ("fields", "checks", "images", "overflow"):
                    record(f"13_second_export_same_{k}", lf2[k] == lf[k], f"LogbookFields.{k} unchanged")
                record("14_second_export_same_pages", len(r2.pages) == len(r.pages),
                       f"{len(r.pages)} vs {len(r2.pages)}")

                # Saved work is offered back after a reload, in a bar that is
                # not easily missed (1.5x the normal size).
                set_field(pg, "name", short_answer + "!")
                pg.evaluate("window.typstRenderEditor.autosaveNow(true).then(() => true)")
                cov.save()
                pg.reload()
                wait_editor(pg)
                pg.wait_for_selector("#lbRestoreYes", state="attached", timeout=30000)
                bar = pg.evaluate("""() => {
                    const el = document.querySelector('.lb-restore');
                    const btn = document.getElementById('lbRestoreYes');
                    return { font: getComputedStyle(el).fontSize, btn: btn.offsetHeight };
                }""")
                record("15_restore_bar_large", bar["font"] == "20px" and bar["btn"] >= 51, str(bar))
                snap(pg, "03_restore_bar")

                record("16_no_reopen_errors",
                       not any("could not reopen" in e for e in console_errors),
                       "; ".join(console_errors) or "no console errors")
                cov.save()
                ctx.close()
            finally:
                browser.close()
                httpd.shutdown()

    return write_report(states)


def write_report(states):
    """Write report.md beside the screenshots; return 0 if every check passed, else 1."""
    lines = [f"# Editor Test Report ({TODAY})", "", "| State | Result | Note |", "|---|---|---|"]
    lines += [f"| `{name}` | **{res}** | {note} |" for name, res, note in states]
    (OUT_DIR / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nREPORT: {OUT_DIR / 'report.md'}")
    all_ok = all(r[1] == "PASS" for r in states)
    print("OVERALL:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(run_suite())
