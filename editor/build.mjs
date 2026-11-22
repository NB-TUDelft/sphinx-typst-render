// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the editor into src/sphinx_typst_render/_editor/, the folder the
// Python wheel ships. Everything comes from the npm registry:
//
//   viewer.html          the page, with the package version as cache key
//   editor.js, chunks/   our modules, pdf.js and its viewer components and
//                        pdf-lib, minified; fontkit is a chunk of its own
//   editor.css           our styles, minified
//   pdf.worker.mjs       pdf.js's worker
//   pdfjs/               pdf.js's stylesheet and its images, and the files a
//                        PDF may need while loading: cmaps, standard fonts, an
//                        ICC profile and wasm decoders
//   fonts/               Inter, the interface font
//   THIRD_PARTY_LICENSES.txt
//
// Run with `pnpm run build`. The folder is generated: it is deleted and
// written again on every run, and git ignores it.
//
// `node build.mjs --coverage` builds for coverage.mjs instead: unminified,
// with source maps that lead back to src/. That build must never ship.
import { build, transform } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'src', 'sphinx_typst_render', '_editor');
const nodeModule = name => path.join(here, 'node_modules', name);
const pdfjs = nodeModule('pdfjs-dist');
const coverage = process.argv.includes('--coverage');

const pyproject = await readFile(path.join(root, 'pyproject.toml'), 'utf8');
const version = pyproject.match(/^version\s*=\s*"([^"]+)"/m)[1];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Our code and everything it imports, as ES modules, so the export-only
// fontkit can be a chunk that loads on first use.
const { metafile } = await build({
  absWorkingDir: here,
  entryPoints: { editor: path.join(here, 'src', 'main.js') },
  outdir: out,
  bundle: true,
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  minify: !coverage,
  sourcemap: coverage ? 'linked' : false,
  target: ['es2022'],
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
});

async function minifyCss(from, to) {
  const { code } = await transform(await readFile(from, 'utf8'), { loader: 'css', minify: true });
  await writeFile(to, code);
}
await minifyCss(path.join(here, 'src', 'editor.css'), path.join(out, 'editor.css'));

// pdf.js's runtime files. Not quickjs: it only runs scripts inside PDFs,
// which the editor does not.
await cp(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(out, 'pdf.worker.mjs'));
await mkdir(path.join(out, 'pdfjs'));
await minifyCss(path.join(pdfjs, 'web', 'pdf_viewer.css'), path.join(out, 'pdfjs', 'pdf_viewer.css'));
await cp(path.join(pdfjs, 'web', 'images'), path.join(out, 'pdfjs', 'images'), { recursive: true });
await Promise.all(['cmaps', 'iccs', 'standard_fonts'].map(dir => cp(path.join(pdfjs, dir), path.join(out, 'pdfjs', dir), { recursive: true })));
await cp(path.join(pdfjs, 'wasm'), path.join(out, 'pdfjs', 'wasm'), {
  recursive: true,
  filter: src => !path.basename(src).toLowerCase().includes('quickjs'),
});

// The interface font.
await mkdir(path.join(out, 'fonts'));
await cp(path.join(nodeModule('@fontsource-variable/inter'), 'files', 'inter-latin-wght-normal.woff2'),
  path.join(out, 'fonts', 'inter-latin-wght.woff2'));

// The page.
const page = await readFile(path.join(here, 'src', 'viewer.html'), 'utf8');
await writeFile(path.join(out, 'viewer.html'), page.replaceAll('__VERSION__', version));

// Licences of every package that went into the bundle, from esbuild's list of
// inputs (which also finds nested copies), plus pdf.js and Inter, whose files
// are copied rather than bundled.
const packages = new Map([
  ['pdfjs-dist', pdfjs],
  ['@fontsource-variable/inter', nodeModule('@fontsource-variable/inter')],
]);
for (const input of Object.keys(metafile.inputs)) {
  const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
  if (m) packages.set(m[2], path.resolve(here, m[1]));
}
async function licenceSection([name, dir]) {
  const meta = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  const file = (await readdir(dir)).find(f => /^(licen[cs]e|copying)/i.test(f));
  const text = file ? (await readFile(path.join(dir, file), 'utf8')).trim() : '(the package has no licence file)';
  const rule = '='.repeat(78);
  return `${rule}\n${name} ${meta.version}\nLicense: ${meta.license}\n${rule}\n\n${text}\n`;
}
const sections = await Promise.all([...packages].sort(([a], [b]) => a.localeCompare(b)).map(licenceSection));
await writeFile(path.join(out, 'THIRD_PARTY_LICENSES.txt'),
  'Third-party software in the sphinx-typst-render editor.\n'
  + 'The data files in pdfjs/cmaps, pdfjs/iccs, pdfjs/standard_fonts and pdfjs/wasm\n'
  + 'keep their own licence files beside them.\n\n' + sections.join('\n'));

// What was written.
async function size(p) {
  const s = await stat(p);
  if (!s.isDirectory()) return s.size;
  const sizes = await Promise.all((await readdir(p)).map(f => size(path.join(p, f))));
  return sizes.reduce((total, n) => total + n, 0);
}
const mb = n => `${(n / 1024 / 1024).toFixed(2)} MB`;
const written = (await readdir(out)).sort();
const writtenSizes = await Promise.all(written.map(f => size(path.join(out, f))));
for (const [i, f] of written.entries()) console.log(`${mb(writtenSizes[i]).padStart(9)}  ${f}`);
console.log(`${mb(await size(out)).padStart(9)}  total, editor ${version}, pdf.js `
  + JSON.parse(await readFile(path.join(pdfjs, 'package.json'), 'utf8')).version);
