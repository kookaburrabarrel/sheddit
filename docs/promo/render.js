#!/usr/bin/env node
/**
 * render.js — turns docs/promo/*.html into the two Chrome Web Store promo images.
 *
 *   node docs/promo/render.js                 # writes both into docs/assets/
 *   node docs/promo/render.js --out /tmp/x    # somewhere else, to look before committing
 *   node docs/promo/render.js tile            # just the one
 *   node docs/promo/render.js --scale 2       # 2x, for reading the type up close
 *
 * WHY A SCRIPT AND NOT A DESIGN FILE
 * The artwork's product shot is the extension's own output — listing.html links
 * src/styles/old-reddit.css and themes.css directly — so the promo cards cannot drift away
 * from the layout they advertise: change the stylesheet, re-run this, and the store art
 * follows. That only holds if regenerating is one command with no design tool in it.
 *
 * The browser driving, and the reason it is not `chrome --screenshot`, lives in
 * ../../headless.js, which export-icons.js shares. docs/ is not in either zip
 * (package-extension.js reads a fixed list), so nothing here reaches a user.
 */
const fs = require('fs');
const path = require('path');
const { withChrome, pngInfo } = require('../../headless.js');

const ROOT = path.join(__dirname, '..', '..');

/* Exactly the sizes the store validates on upload. They live here as well as in each
   card's CSS because this is what asserts them afterwards: a card whose <body> disagrees
   with its entry here is a silently wrong-sized upload, and the store rejects those with a
   message that does not say which dimension moved. */
const CARDS = [
  { name: 'tile',    src: 'tile.html',    out: 'store-tile-440x280.png', w: 440,  h: 280 },
  { name: 'marquee', src: 'marquee.html', out: 'store-marquee.png',      w: 1400, h: 560 }
];

/**
 * The store's two hard requirements on a promo image are its exact pixel size and 24-bit
 * colour with no alpha channel, and it rejects a bad one at upload with a message that does
 * not say which. Both are readable out of the IHDR, so both are checked here — where the
 * failure is one line of output — rather than in a submission form.
 *
 * Colour type 2 is truecolour RGB, which is what Chrome writes when every pixel it painted
 * was opaque. Type 6 (RGBA) means something on the card let the page background through:
 * that is a real bug in the artwork, not a channel to strip afterwards.
 */
function verify(buf, w, h) {
  const got = pngInfo(buf);
  const bad = [];
  if (got.w !== w || got.h !== h) bad.push(`is ${got.w}x${got.h}, must be ${w}x${h}`);
  if (got.depth !== 8) bad.push(`is ${got.depth}-bit per channel, must be 8`);
  if (got.colour !== 2) {
    bad.push(got.colour === 6
      ? 'has an alpha channel — a layer on the card is not opaque, and the store wants 24-bit RGB'
      : `has PNG colour type ${got.colour}, must be 2 (truecolour RGB)`);
  }
  if (bad.length) throw new Error(bad.join('; '));
  return `${got.w}x${got.h}, 24-bit RGB, ${(buf.length / 1024).toFixed(0)} KB`;
}

async function main() {
  const args = process.argv.slice(2);
  /* `skip` holds the index of each flag's VALUE, so it is only ever added for a flag that
     is actually present — an absent flag's indexOf is -1, and -1 + 1 is 0, which would
     silently swallow the first card name and render both. */
  const skip = new Set();
  const flag = (name, fallback) => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    skip.add(i + 1);
    return args[i + 1];
  };
  const outDir = flag('--out', path.join(ROOT, 'docs', 'assets'));
  const scale = Number(flag('--scale', 1));
  const wanted = args.filter((a, i) => !a.startsWith('--') && !skip.has(i));
  const unknown = wanted.filter(w => !CARDS.some(c => c.name === w));
  if (unknown.length) {
    console.error(`unknown card: ${unknown.join(', ')} — known: ${CARDS.map(c => c.name).join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  let failed = 0;
  await withChrome(async (shoot) => {
    for (const card of CARDS) {
      if (wanted.length && !wanted.includes(card.name)) continue;
      const dest = path.join(outDir, card.out);
      try {
        const buf = await shoot({
          url: 'file://' + path.join(__dirname, card.src),
          width: card.w, height: card.h, scale,
          /* Waits for the icon key and the webfont together. An icon that did not key is a
             pale rectangle on the card's gradient — perfectly legible, which is exactly why
             it has to stop the render: nothing downstream would notice and the store would
             take the upload. promo.js explains what the key is for. */
          settle: `Promise.all([window.shdPromoReady, document.fonts.ready])
                     .then(() => window.shdPromoKeyed === true)`
        });
        fs.writeFileSync(dest, buf);
        const detail = scale === 1
          ? verify(buf, card.w, card.h)
          : `${card.w * scale}x${card.h * scale} (${scale}x preview — not for upload)`;
        console.log(`${card.name.padEnd(8)} ${path.relative(ROOT, dest)}  —  ${detail}`);
      } catch (e) {
        const hint = /not ready to be shot/.test(e.message)
          ? ' — the icon background did not key; is --allow-file-access-from-files still being passed?'
          : '';
        console.error(`${card.name.padEnd(8)} FAILED: ${e.message}${hint}`);
        failed += 1;
      }
    }
  }, [
    /* promo.js reads the icon's pixels back off a canvas to key its flat background out,
       and a canvas holding a file:// image is tainted without this. Scoped to a throwaway
       profile rendering two local files, and the alternative is committing a second,
       background-free copy of the icon that goes stale the first time the real one moves. */
    '--allow-file-access-from-files'
  ]);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
