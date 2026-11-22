// SPDX-License-Identifier: AGPL-3.0-or-later
// Measures how much of src/ the browser test, tools/editor_test.py, runs, and
// writes coverage/lcov.info for SonarQube (see sonar-project.properties).
//
//   1. builds the bundle unminified, with source maps (build.mjs --coverage)
//   2. runs the browser test with EDITOR_COVERAGE set, so it saves V8 coverage
//   3. c8 follows the source maps back to src/, one snapshot at a time, and the
//      reports are added up here
//
// The coverage build must never ship, so the release build is put back
// afterwards, whether or not the test passed. A failed check still reports
// what ran, and the exit code is the test's.
//
// Run with `pnpm run coverage`. It needs what the browser test needs: the
// Python environment set up with uv, playwright and pypdf in it, and Chromium.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reports = path.join(here, 'coverage');
const raw = path.join(reports, 'v8');
const c8 = path.join(here, 'node_modules', 'c8', 'bin', 'c8.js');

function run(cmd, args, options) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status;
}
const node = (args, cwd) => run(process.execPath, args, { cwd });

// c8 adds snapshots up wrongly: code after an `await` that ran in one of them
// can read as never run in the sum (c8 12.0.0: the restore bar, 2026-11-22).
// So each snapshot is reported on its own, and the reports are added up here.
// From the repository root, so lcov.info names files the way SonarQube, which
// scans from there, looks them up: editor/src/....
function reportEach() {
  const files = new Map();
  for (const snapshot of readdirSync(raw).filter((f) => f.endsWith('.json'))) {
    const alone = path.join(reports, 'alone', snapshot);
    const out = path.join(reports, 'each', snapshot);
    mkdirSync(alone, { recursive: true });
    copyFileSync(path.join(raw, snapshot), path.join(alone, snapshot));
    if (node([c8, 'report', '--temp-directory', alone, '--reports-dir', out, '--reporter', 'lcovonly', '--include', 'src/sphinx_typst_render/_editor/**'], root) !== 0) return null;
    addUp(files, readFileSync(path.join(out, 'lcov.info'), 'utf8'));
  }
  return files;
}

// One snapshot's report added to the sum. The bundle's source maps also lead
// into pdf.js, pdf-lib and the rest of node_modules; only src/ is kept. (c8's
// --exclude-after-remap cannot do that: on a map with many sources it drops
// every range, and all of src/ would read as covered.) Lines are summed;
// branch and function numbers differ between snapshots, so per line the best
// snapshot counts.
function addUp(files, lcov) {
  for (const record of lcov.split('end_of_record')) {
    const file = /^SF:(editor\/src\/.+)$/m.exec(record)?.[1];
    if (!file) continue;
    if (!files.has(file)) files.set(file, { lines: new Map(), branches: new Map(), functions: new Map() });
    addRecord(files.get(file), record);
  }
}
// One file's record from one snapshot, added to that file's sum.
function addRecord(sum, record) {
  const entries = [...record.matchAll(/^(DA|BRDA|FN|FNDA):(.+)$/gm)].map(([, kind, data]) => [kind, data.split(',')]);
  const of = (wanted) => entries.filter(([kind]) => kind === wanted).map(([, parts]) => parts);
  for (const [line, hits] of of('DA')) sum.lines.set(+line, (sum.lines.get(+line) ?? 0) + +hits);
  const branches = new Map(); // line -> [found, hit] in this snapshot
  for (const [line, , , taken] of of('BRDA')) {
    const [found, hit] = branches.get(+line) ?? [0, 0];
    branches.set(+line, [found + 1, hit + (+taken > 0 ? 1 : 0)]);
  }
  for (const [line, counts] of branches) bestOf(sum.branches, line, counts);
  const fnLines = new Map(of('FN').map(([line, ...name]) => [name.join(','), +line]));
  for (const [hits, ...name] of of('FNDA')) bestOf(sum.functions, fnLines.get(name.join(',')), [name.join(','), +hits > 0 ? 1 : 0]);
}
// Keep, per line, the snapshot with the most covered.
function bestOf(map, line, [a, b]) {
  if (line === undefined) return;
  const [x, y] = map.get(line) ?? [a, -1];
  map.set(line, b > y ? [a, b] : [x, y]);
}

function toLcov(files) {
  const out = [];
  for (const [file, { lines, branches, functions }] of files) {
    const fns = [...functions].sort((p, q) => p[0] - q[0]);
    const brs = [...branches].sort((p, q) => p[0] - q[0]);
    const das = [...lines].sort((p, q) => p[0] - q[0]);
    out.push(
      'TN:',
      `SF:${file}`,
      ...fns.map(([line, [name]]) => `FN:${line},${name}`),
      ...fns.map(([, [name, hit]]) => `FNDA:${hit},${name}`),
      `FNF:${fns.length}`,
      `FNH:${fns.filter(([, [, hit]]) => hit).length}`,
      ...das.map(([line, hits]) => `DA:${line},${hits}`),
      `LF:${das.length}`,
      `LH:${das.filter(([, hits]) => hits).length}`,
      ...brs.flatMap(([line, [found, hit]]) => Array.from({ length: found }, (_, i) => `BRDA:${line},0,${i},${i < hit ? 1 : 0}`)),
      `BRF:${brs.reduce((n, [, [found]]) => n + found, 0)}`,
      `BRH:${brs.reduce((n, [, [, hit]]) => n + hit, 0)}`,
      'end_of_record',
    );
  }
  return `${out.join('\n')}\n`;
}

function summarise(lcov, count) {
  const total = (key) => [...lcov.matchAll(new RegExp(String.raw`^${key}:(\d+)$`, 'gm'))].reduce((sum, m) => sum + Number(m[1]), 0);
  const share = (hit, found) => (total(found) ? `${((100 * total(hit)) / total(found)).toFixed(1)}%` : 'n/a');
  console.log(`editor/src coverage: lines ${share('LH', 'LF')}, branches ${share('BRH', 'BRF')}, functions ${share('FNH', 'FNF')}, in ${count} files`);
}

rmSync(reports, { recursive: true, force: true });
try {
  if (node(['build.mjs', '--coverage'], here) !== 0) throw new Error('the coverage build failed');
  const tested = run('uv', ['run', 'python', 'tools/editor_test.py'], {
    cwd: root,
    env: { ...process.env, EDITOR_COVERAGE: raw },
  });
  // Before the release build replaces the files the coverage refers to.
  const files = reportEach();
  if (files) {
    const lcov = toLcov(files);
    writeFileSync(path.join(reports, 'lcov.info'), lcov);
    summarise(lcov, files.size);
  }
  process.exitCode = tested || (files ? 0 : 1);
} finally {
  if (node(['build.mjs'], here) !== 0) process.exitCode = 1;
}
