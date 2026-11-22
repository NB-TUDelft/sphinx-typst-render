---
summary: >-
  SonarQube project `sphinx-typst-render` (`sonar-project.properties`): plain
  `sonar-scanner` with host and token from the scanner's own configuration,
  never an empty `SONAR_TOKEN`, never either recorded here; Python coverage
  from `pytest --cov`, the editor's from its browser test through V8 and c8
  (`pnpm run coverage`), and why c8's `--exclude-after-remap` is not used; what
  coverage leaves out; `sonar.projectVersion` advances with releases.
---

# SonarQube and coverage

`sonar-project.properties` holds the project key, `sphinx-typst-render`, and
what is scanned: the package, the editor's source, `tools/` and
`docs/kb/housekeeping.py`, with `tests/` as tests. The generated editor bundle
(`src/sphinx_typst_render/_editor/`) is excluded; its source is what counts.
`.vscode/settings.json` binds SonarQube for IDE (SonarLint) to the same project
in connected mode, through the maintainer's connection named `plohnen`.

## Running a scan

```bash
uv run pytest --cov --cov-report=xml   # coverage.xml
(cd editor && pnpm run coverage)       # editor/coverage/lcov.info
sonar-scanner
```

`sonar-scanner` is plain: on the maintainer's machine it is installed at
`/opt/sonar-scanner` (`SONAR_SCANNER_HOME`) and takes the server address and
token from `conf/sonar-scanner.properties` there. Never override them
(`-Dsonar.host.url`, `SONAR_HOST_URL`, `SONAR_TOKEN`), and never record the
address or the token anywhere in this repository. **Never prefix the command
with an empty `SONAR_TOKEN=`**: the environment variable takes precedence over
the configured token, so the scan runs anonymously and fails with
`401 Unauthorized` on `/api/v2/analysis/version`, although a valid token is
configured.

The project's quality gate is the server's `ZAM`. Besides its new-code
conditions (coverage at least 85%, at most 5 new issues, no new high-impact
issues, duplication at most 1%), it has conditions on the whole codebase: no
reliability, security or blocker issues, at most 100 maintainability issues,
and maintainability rating A. Findings in old code therefore fail it whatever
the new-code period. JavaScript is analysed with the `Zam` profile; Python,
CSS and HTML with Sonar way comprehensive (`2026-11-22`). Read the current
assignment off the server (`/api/qualityprofiles/search?project=...`) rather
than trusting this note.

The scanner only uploads the report. Read `ceTaskUrl` from
`.scannerwork/report-task.txt`, poll that task until it finishes, then read
the gate from `/api/qualitygates/project_status?analysisId=<id>`. A scan of an
uncommitted tree logs `Missing blame information` for new and changed files;
that is expected and does not replace polling the gate. A scan without fresh
coverage records stale or no coverage, so produce both reports right before
it.

## Python coverage

`pytest-cov` (dev dependency) with `[tool.coverage.*]` in `pyproject.toml`:
branch coverage of the `sphinx_typst_render` package and of
`docs/kb/housekeeping.py`, written to `coverage.xml` with repository-relative
paths (`relative_files`), which is what the scanner matches.

## Editor coverage

The editor has no unit tests; `tools/editor_test.py` exercises it in a real
browser, and `editor/coverage.mjs` (`pnpm run coverage`) turns that run into
`editor/coverage/lcov.info`:

1. `node build.mjs --coverage` builds the bundle unminified, with linked
   source maps. That build must never ship, so `coverage.mjs` puts the release
   build back in a `finally`, whether the test passed or not.
2. The browser test runs with `EDITOR_COVERAGE` set. Its `Coverage` class
   starts V8 precise coverage over the Chrome DevTools Protocol
   (`Profiler.startPreciseCoverage` with call counts and block detail) before
   the first navigation, and saves `Profiler.takePreciseCoverage` before each
   navigation and at the end, in the format of `NODE_V8_COVERAGE`. Each take
   resets the counts, and the profiler stays on across the page's navigations
   and reloads (checked `2026-11-22`: all three saves hold the bundle).
   Served URLs under `_static/typst-editor/` are rewritten to the package's
   `_editor/` files they were copied from verbatim; the per-site `config.js`
   has no counterpart and is skipped.
3. c8 maps the coverage through the source maps, run from the repository root
   so `lcov.info` names files as `editor/src/...`, the paths the scanner
   looks up.

c8's own `--include editor/src/** --exclude-after-remap` is not used, because
it reports every file as fully covered with no functions or branches (c8
12.0.0, v8-to-istanbul 9.3.0): on a source map with many sources,
v8-to-istanbul tests each range against the map's relative source path
(`../../../editor/src/main.js`), which never matches the glob, so it drops
every range, yet it resolves the paths before listing the files. So c8 remaps
everything, pdf.js and pdf-lib included, and `coverage.mjs` keeps only the
`editor/src/` records. The first run (`2026-11-22`) measured 74.4% of lines,
63.0% of branches and 74.1% of functions over the 18 modules.

## Left out of coverage

`sonar.coverage.exclusions` leaves out tooling with no tests of its own
(`editor/build.mjs`, `editor/coverage.mjs`, `tools/`) and the download menu's
script, `src/sphinx_typst_render/static/`, which no test exercises yet (A
test for the download menu script, under Future work). Do not add to the list
to get a change through the gate.

## Project version

`sonar.projectVersion` follows the package version, advanced in the release
commit (`RELEASING.md`). SonarQube's "Previous version" new-code period starts
at the analysis where it last changed, so a version that lags measures new code
against an older release.
