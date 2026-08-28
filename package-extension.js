// Builds the download zips: exactly what manifest.json references (manifest.json,
// icons/, src/, options/) — nothing from test/, docs/, .github/, or the root markdown
// files, none of which ship inside the packed extension. Two artifacts from one tree:
//
//   dist/sheddit.zip          Chrome — the Web Store upload and the README download
//   dist/sheddit-firefox.zip  Firefox — identical files, manifest transformed below
//
// The Firefox manifest is DERIVED, never hand-maintained: the canonical manifest.json
// stays Chrome's, and firefoxManifest() is the single place the two may differ, so they
// cannot drift anywhere else. What the transform changes and why:
//
//   - browser_specific_settings.gecko.id             AMO requires a stable add-on id
//   - strict_min_version 140.0                       two keys set a floor and the higher wins:
//                                                    content_scripts "world" (the MAIN-world
//                                                    bridge) needs 128, and the data-collection
//                                                    declaration below is a Firefox 140 key.
//                                                    140 is the current ESR, so the higher
//                                                    floor costs no supported user
//   - gecko_android strict_min_version 142.0         the same declaration landed later on
//                                                    Android. Without this key the Android
//                                                    floor INHERITS gecko's, which is a key
//                                                    declared below the version that reads it
//                                                    — AMO warns about exactly that, once per
//                                                    application. It is also the key that
//                                                    lists the add-on as Android-compatible
//   - data_collection_permissions required:["none"]  AMO requires the declaration; the
//                                                    extension collects nothing, so it is
//                                                    the one-word truthful answer
//   - minimum_chrome_version removed                 Chrome-only key
//
//   node package-extension.js            rebuild both zips
//   node package-extension.js --check    compare both against the working tree, exit 1 if stale
//
// The committed zips are build artifacts living in version control, which means they go
// stale the moment src/ changes without a rebuild — and a stale download fails silently,
// installing code nobody is looking at any more. --check is what makes that visible.
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const ENTRIES = ['manifest.json', 'icons', 'src', 'options'];

/* The id is an identifier in AMO's email-like format, not a mailbox. Changing it after
   the first AMO submission orphans every installed copy — treat it as permanent. */
const GECKO_ID = 'sheddit@kookaburrabarrel.github.io';

function firefoxManifest(m) {
  const out = { ...m };
  delete out.minimum_chrome_version;
  out.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: '140.0',
      data_collection_permissions: { required: ['none'] }
    },
    gecko_android: { strict_min_version: '142.0' }
  };
  return out;
}

const renderManifest = (m) => JSON.stringify(m, null, 2) + '\n';

const TARGETS = [
  { out: path.join(ROOT, 'dist', 'sheddit.zip'), transform: null },
  { out: path.join(ROOT, 'dist', 'sheddit-firefox.zip'), transform: firefoxManifest }
];

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Every shippable file, as repo-relative paths — the set each zip is supposed to hold.
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => walk(path.join(rel, name)));
}

/* What a file inside the zip should hash to: the tree's copy, except the Firefox
   manifest, which must match the transform of the CURRENT tree manifest — so editing
   manifest.json stales both zips, not just Chrome's. */
function expectedBytes(rel, transform) {
  const raw = fs.readFileSync(path.join(ROOT, rel));
  if (transform && rel === 'manifest.json') {
    return Buffer.from(renderManifest(transform(JSON.parse(raw.toString('utf8')))));
  }
  return raw;
}

function check() {
  for (const { out, transform } of TARGETS) {
    if (!fs.existsSync(out)) {
      console.error(`${path.relative(ROOT, out)} does not exist — run: npm run package`);
      process.exit(1);
    }
    // Compare contents rather than zip bytes: a zip records mtimes, so rebuilding an
    // unchanged tree produces a different file and a byte comparison would always differ.
    const inZip = new Map();
    for (const line of execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n')) {
      const name = line.trim();
      if (name && !name.endsWith('/')) {
        inZip.set(name, hash(execFileSync('unzip', ['-p', out, name], { maxBuffer: 1 << 28 })));
      }
    }

    const onDisk = ENTRIES.flatMap(walk);
    const problems = [];
    for (const rel of onDisk) {
      const zipped = inZip.get(rel);
      if (zipped === undefined) problems.push(`missing from the zip:  ${rel}`);
      else if (zipped !== hash(expectedBytes(rel, transform))) problems.push(`differs:               ${rel}`);
      inZip.delete(rel);
    }
    for (const rel of inZip.keys()) problems.push(`in the zip but gone:   ${rel}`);

    if (problems.length) {
      console.error(`${path.relative(ROOT, out)} is stale:\n  ${problems.join('\n  ')}`);
      console.error('\nRebuild it before pushing, or the README download serves old code:\n  npm run package');
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, out)} matches the working tree (${onDisk.length} files)`);
  }
}

/* One zip. Exported so test/extension-firefox.js can stage a fresh Firefox build in a
   temp path instead of installing (and possibly trusting a stale copy of) the committed
   artifact. `quiet` keeps a test run's output to the suite's own lines. */
function buildTarget({ out, transform }, { quiet = false } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out)) fs.unlinkSync(out);
  const zipArgs = ['-r', '-X', ...(quiet ? ['-q'] : []), out, ...ENTRIES];
  if (!transform) {
    execFileSync('zip', zipArgs, { cwd: ROOT, stdio: 'inherit' });
  } else {
    // Stage a copy so the transformed manifest sits at the zip root under its real
    // name; zipping from ROOT would capture the tree's Chrome manifest instead.
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sheddit-pkg-'));
    try {
      for (const rel of ENTRIES.filter((e) => e !== 'manifest.json')) {
        fs.cpSync(path.join(ROOT, rel), path.join(stage, rel), { recursive: true });
      }
      fs.writeFileSync(path.join(stage, 'manifest.json'),
        renderManifest(transform(JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')))));
      execFileSync('zip', zipArgs, { cwd: stage, stdio: 'inherit' });
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  return out;
}

function build() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
  for (const target of TARGETS) {
    buildTarget(target);
    const { size } = fs.statSync(target.out);
    console.log(`\n${path.relative(ROOT, target.out)} — ${(size / 1024).toFixed(1)} KB, version ${version}`);
  }
}

module.exports = { firefoxManifest, renderManifest, buildTarget, GECKO_ID };
if (require.main === module) process.argv.includes('--check') ? check() : build();
