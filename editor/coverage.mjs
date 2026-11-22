// SPDX-License-Identifier: AGPL-3.0-or-later
// Measures how much of src/ the browser test, tools/editor_test.py, runs, and
// writes coverage/lcov.info for SonarQube (see sonar-project.properties).
//
//   1. builds the bundle unminified, with source maps (build.mjs --coverage)
//   2. runs the browser test with EDITOR_COVERAGE set, so it saves V8 coverage
//   3. c8 follows the source maps back to src/ and writes the report
//
// The coverage build must never ship, so the release build is put back
// afterwards, whether or not the test passed. A failed check still reports
// what ran, and the exit code is the test's.
//
// Run with `pnpm run coverage`. It needs what the browser test needs: the
// Python environment set up with uv, playwright and pypdf in it, and Chromium.
import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reports = path.join(here, 'coverage');
const raw = path.join(reports, 'v8');

function run(cmd, args, options) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result.status;
}
const node = (args, cwd) => run(process.execPath, args, { cwd });

// The bundle's source maps also lead into pdf.js, pdf-lib and the rest of
// node_modules; keep only src/. c8's own --exclude-after-remap cannot do it:
// on a map with many sources it tests each range against the map's relative
// path, which never matches, and drops every range, so all of src/ would
// read as covered.
async function keepOwnFiles(lcov) {
  const records = (await readFile(lcov, 'utf8')).split('end_of_record\n')
    .filter(record => /^SF:editor\/src\//m.test(record));
  await writeFile(lcov, records.map(record => `${record}end_of_record\n`).join(''));
  const total = key => records.reduce(
    (sum, record) => sum + Number(record.match(new RegExp(String.raw`^${key}:(\d+)$`, 'm'))?.[1] ?? 0), 0);
  const share = (hit, found) => (total(found) ? `${((100 * total(hit)) / total(found)).toFixed(1)}%` : 'n/a');
  console.log(`editor/src coverage: lines ${share('LH', 'LF')}, branches ${share('BRH', 'BRF')}, `
    + `functions ${share('FNH', 'FNF')}, in ${records.length} files`);
}

await rm(reports, { recursive: true, force: true });
try {
  if (node(['build.mjs', '--coverage'], here) !== 0) throw new Error('the coverage build failed');
  const tested = run('uv', ['run', 'python', 'tools/editor_test.py'], {
    cwd: root,
    env: { ...process.env, EDITOR_COVERAGE: raw },
  });
  // Before the release build replaces the files the coverage refers to. From
  // the repository root, so lcov.info names files the way SonarQube, which
  // scans from there, looks them up: editor/src/....
  const c8 = path.join(here, 'node_modules', 'c8', 'bin', 'c8.js');
  const reported = node([c8, 'report', '--temp-directory', raw, '--reports-dir', reports,
    '--reporter', 'lcovonly', '--include', 'src/sphinx_typst_render/_editor/**'], root);
  if (reported === 0) await keepOwnFiles(path.join(reports, 'lcov.info'));
  process.exitCode = tested || reported;
} finally {
  if (node(['build.mjs'], here) !== 0) process.exitCode = 1;
}
