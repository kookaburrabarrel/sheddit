// Builds the download zip: exactly what manifest.json references (manifest.json,
// icons/, src/, options/) — nothing from test/, docs/, .github/, or the root markdown
// files, none of which ship inside the packed extension. The same file is the Chrome
// Web Store upload and the download the README links, so what people install by hand
// is what the store review saw.
//
//   node package-extension.js            rebuild it
//   node package-extension.js --check    compare it against the working tree, exit 1 if stale
//
// The committed zip is a build artifact living in version control, which means it goes
// stale the moment src/ changes without a rebuild — and a stale download fails silently,
// installing code nobody is looking at any more. --check is what makes that visible.
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist', 'sheddit.zip');
const ENTRIES = ['manifest.json', 'icons', 'src', 'options'];

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Every shippable file, as repo-relative paths — the set the zip is supposed to hold.
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => walk(path.join(rel, name)));
}

function check() {
  if (!fs.existsSync(OUT)) {
    console.error(`${path.relative(ROOT, OUT)} does not exist — run: npm run package`);
    process.exit(1);
  }
  // Compare contents rather than zip bytes: a zip records mtimes, so rebuilding an
  // unchanged tree produces a different file and a byte comparison would always differ.
  const inZip = new Map();
  for (const line of execFileSync('unzip', ['-Z1', OUT], { encoding: 'utf8' }).split('\n')) {
    const name = line.trim();
    if (name && !name.endsWith('/')) {
      inZip.set(name, hash(execFileSync('unzip', ['-p', OUT, name], { maxBuffer: 1 << 28 })));
    }
  }

  const onDisk = ENTRIES.flatMap(walk);
  const problems = [];
  for (const rel of onDisk) {
    const zipped = inZip.get(rel);
    if (zipped === undefined) problems.push(`missing from the zip:  ${rel}`);
    else if (zipped !== hash(fs.readFileSync(path.join(ROOT, rel)))) problems.push(`differs:               ${rel}`);
    inZip.delete(rel);
  }
  for (const rel of inZip.keys()) problems.push(`in the zip but gone:   ${rel}`);

  if (problems.length) {
    console.error(`${path.relative(ROOT, OUT)} is stale:\n  ${problems.join('\n  ')}`);
    console.error('\nRebuild it before pushing, or the README download serves old code:\n  npm run package');
    process.exit(1);
  }
  console.log(`${path.relative(ROOT, OUT)} matches the working tree (${onDisk.length} files)`);
}

function build() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
  execFileSync('zip', ['-r', '-X', OUT, ...ENTRIES], { cwd: ROOT, stdio: 'inherit' });
  const { size } = fs.statSync(OUT);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  console.log(`\n${path.relative(ROOT, OUT)} — ${(size / 1024).toFixed(1)} KB, version ${version}`);
}

process.argv.includes('--check') ? check() : build();
