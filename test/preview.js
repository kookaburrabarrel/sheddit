#!/usr/bin/env node
/**
 * preview.js — turns the test output into standalone, openable HTML.
 *
 * test/run.js writes the post-render DOM (which already contains our injected <style>),
 * so the only thing needed for a faithful offline preview is to swap the fixture's fake
 * image URLs for inline placeholders. Open dist/preview.listing.html in any browser.
 *
 *   node build.js && node test/run.js && node test/preview.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

const swatch = (label, hue) =>
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="104">
       <rect width="140" height="104" fill="hsl(${hue},45%,72%)"/>
       <text x="70" y="57" font-family="Verdana" font-size="13" fill="#fff"
             text-anchor="middle">${label}</text>
     </svg>`);

const PALETTE = [[210, 'img'], [340, 'img'], [110, 'img'], [30, 'img'], [265, 'img']];

function build(name) {
  const src = path.join(__dirname, `out.${name}.html`);
  if (!fs.existsSync(src)) {
    console.error(`missing ${src} — run: node test/run.js`);
    process.exit(1);
  }
  let html = fs.readFileSync(src, 'utf8');

  // Replace every fixture image with a deterministic coloured placeholder.
  let i = 0;
  html = html.replace(/src="https:\/\/[^"]*"/g, () => {
    const [hue, label] = PALETTE[i++ % PALETTE.length];
    return `src="${swatch(label, hue)}"`;
  });

  // Reveal the native tree's absence explicitly: the suppression rule is already in the
  // inlined <style>, so what you see is exactly what the extension produces.
  const banner = `<div style="font:11px Verdana;background:#ffffe0;border-bottom:1px solid #ccc;padding:5px 10px">
    sheddit preview — generated from test output. Images are placeholders;
    everything else is the real rendered markup.</div>`;
  html = html.replace(/<body([^>]*)>/, `<body$1>${banner}`);

  const dest = path.join(OUT, `preview.${name}.html`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(dest, html);
  console.log(`wrote ${path.relative(ROOT, dest)}`);
}

build('listing');
build('comments');
/* A listing with nothing in it — the page bug 94 was reported against. Worth an eye
   because it is mostly empty space, and the difference between "deliberate" and
   "abandoned" there is layout, which no assertion in run.js can see. */
build('empty');
