#!/usr/bin/env node
/**
 * export-icons.js — rasterises icons/icon.svg into the four PNGs manifest.json names.
 *
 *   node export-icons.js               # rewrite all four in icons/
 *   node export-icons.js --check       # rebuild in memory and diff; exit 1 if any is stale
 *   node export-icons.js --out /tmp/x  # somewhere else, to look before overwriting
 *
 * WHY THIS IS A SCRIPT
 * icons/README.md's standing warning is that editing one PNG and not the others is the
 * failure mode: a browser picks per context, so a stale 16 is invisible everywhere except
 * the one strip that uses it. Four exports done by hand is four chances to skip one. One
 * command cannot skip one, and --check makes the question "are these current?" answerable
 * without re-exporting anything.
 *
 * It lives at the root, beside build.js and package-extension.js, and NOT in icons/ —
 * package-extension.js zips that whole directory (minus *.md), so a build script left there
 * would ship inside the extension.
 */
const fs = require('fs');
const path = require('path');
const { withChrome, pngInfo } = require('./headless.js');

const ROOT = __dirname;
const SVG = path.join(ROOT, 'icons', 'icon.svg');
const SIZES = [16, 32, 48, 128];

/* An <img> at the exact size, on a data: URL, so the SVG file stays the single source and
   nothing is written to disk to be read back. A data: page also needs no file-access flag
   for the image, because the image is in the page. */
function page(svg, size) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    img{display:block;width:${size}px;height:${size}px}
  </style><img src="${src}" alt="">`;
  return 'data:text/html;base64,' + Buffer.from(html).toString('base64');
}

/**
 * The icon has to keep real transparency outside the tile's rounded corners: both browsers
 * composite it onto a background that is light in one theme and dark in the other, so a
 * corner baked against white is a white notch on every dark toolbar. Colour type 6 is RGBA,
 * and it is asserted rather than assumed because the failure is invisible on the machine
 * that exported it.
 */
function verify(buf, size) {
  const { w, h, depth, colour } = pngInfo(buf);
  if (w !== size || h !== size) throw new Error(`is ${w}x${h}, must be ${size}x${size}`);
  if (depth !== 8) throw new Error(`is ${depth}-bit per channel, must be 8`);
  if (colour !== 6) {
    throw new Error(colour === 2
      ? 'has no alpha channel — the tile\'s rounded corners would be opaque'
      : `has PNG colour type ${colour}, must be 6 (RGBA)`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outFlag = args.indexOf('--out');
  const outDir = outFlag === -1 ? path.join(ROOT, 'icons') : args[outFlag + 1];

  const svg = fs.readFileSync(SVG, 'utf8');
  const built = await withChrome(async (shoot) => {
    const out = [];
    for (const size of SIZES) {
      out.push([size, await shoot({
        url: page(svg, size), width: size, height: size, transparent: true
      })]);
    }
    return out;
  });

  let stale = 0;
  if (!check) fs.mkdirSync(outDir, { recursive: true });
  for (const [size, buf] of built) {
    const dest = path.join(outDir, `icon${size}.png`);
    try {
      verify(buf, size);
    } catch (e) {
      console.error(`icon${size}.png FAILED: ${e.message}`);
      stale += 1;
      continue;
    }
    const current = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    const same = current && current.equals(buf);
    if (check) {
      if (!same) { console.error(`icon${size}.png is stale — re-run: node export-icons.js`); stale += 1; }
      else console.log(`icon${size}.png  up to date`);
      continue;
    }
    fs.writeFileSync(dest, buf);
    console.log(`icon${size}.png  ${size}x${size} RGBA, ${(buf.length / 1024).toFixed(1)} KB` +
                (same ? '  (unchanged)' : ''));
  }
  process.exit(stale ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
