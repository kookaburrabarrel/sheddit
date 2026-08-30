#!/usr/bin/env node
/**
 * render.js — turns docs/promo/*.html into the two Chrome Web Store promo images.
 *
 *   node docs/promo/render.js                 # writes both into docs/assets/
 *   node docs/promo/render.js --out /tmp/x    # somewhere else, to look before committing
 *   node docs/promo/render.js tile            # just the one
 *   node docs/promo/render.js --scale 2       # 2x, for inspecting the type up close
 *
 * WHY A SCRIPT AND NOT A DESIGN FILE
 * The artwork's product shot is the extension's own output — listing.html links
 * src/styles/old-reddit.css and themes.css directly — so the promo cards cannot drift away
 * from the layout they advertise: change the stylesheet, re-run this, and the store art
 * follows. That only holds if regenerating is one command with no design tool in it.
 *
 * NO DEPENDENCIES ON PURPOSE
 * package.json's three dependencies belong to the test suite, and docs/ is not in the
 * shipped zip (package-extension.js reads a fixed list: manifest, icons, src, options).
 * So this drives a Chrome over the DevTools protocol using node's own WebSocket — no
 * Puppeteer, no install step, and it finds a browser the way the browser tests do.
 *
 * WHY NOT `chrome --screenshot --window-size=440,280`
 * Because it silently produces the wrong picture. Old Headless was removed from the Chrome
 * binary in 132; under new Headless `--window-size` is the OS WINDOW, so the viewport comes
 * out roughly 80px shorter and the screenshot is padded to the requested height with the
 * page's background colour. The bottom of the card is simply missing, at the exact size the
 * store accepts without complaint. Emulation.setDeviceMetricsOverride sets the viewport
 * itself, and Page.captureScreenshot's clip crops to the pixel.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* Exactly the sizes the store validates on upload. They live here as well as in each
   card's CSS because this is what asserts them afterwards: a card whose <body> disagrees
   with its entry here is a silently wrong-sized upload, and the store rejects those with a
   message that does not say which dimension moved. */
const CARDS = [
  { name: 'tile',    src: 'tile.html',    out: 'store-tile-440x280.png', w: 440,  h: 280 },
  { name: 'marquee', src: 'marquee.html', out: 'store-marquee.png',      w: 1400, h: 560 }
];

/** Chrome, wherever this machine keeps it. Playwright's copy first: CI has that one. */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  console.error('no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** The port Chrome actually chose, which is why it is asked for 0 rather than a guess. */
async function devtoolsUrl(profile) {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (fs.existsSync(file)) {
      const [port, route] = fs.readFileSync(file, 'utf8').split('\n');
      if (port && route) return `ws://127.0.0.1:${port.trim()}${route.trim()}`;
    }
    await sleep(50);
  }
  throw new Error('chrome never wrote DevToolsActivePort — it failed to start');
}

/** A DevTools connection: send(), and once() for the one event this script waits on. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const waiters = new Map();
    let seq = 0;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else p.resolve(msg.result);
      } else if (waiters.has(msg.method)) {
        waiters.get(msg.method)(msg.params);
        waiters.delete(msg.method);
      }
    });
    ws.addEventListener('error', () => reject(new Error('devtools websocket failed')));
    ws.addEventListener('open', () => resolve({
      send(method, params = {}, sessionId) {
        const id = ++seq;
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        return new Promise((resolve2, reject2) => pending.set(id, { resolve: resolve2, reject: reject2 }));
      },
      once(method) { return new Promise(r => waiters.set(method, r)); },
      close() { ws.close(); }
    }));
  });
}

/**
 * PNG header check, and the reason this script asserts anything at all.
 *
 * The store's two hard requirements on a promo image are its exact pixel size and 24-bit
 * colour with no alpha channel, and it rejects a bad one at upload with a message that does
 * not say which. Both are readable out of the IHDR's first 13 bytes, so both are checked
 * here — where the failure is one line of output — rather than in a submission form.
 *
 * Colour type 2 is truecolour RGB, which is what Chrome writes when every pixel it painted
 * was opaque. Type 6 (RGBA) means something on the card let the page background through:
 * that is a real bug in the artwork, not a channel to strip afterwards.
 */
function verify(file, w, h) {
  const buf = fs.readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('no IHDR');
  const got = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  const depth = buf[24], colour = buf[25];
  const bad = [];
  if (got.w !== w || got.h !== h) bad.push(`is ${got.w}x${got.h}, must be ${w}x${h}`);
  if (depth !== 8) bad.push(`is ${depth}-bit per channel, must be 8`);
  if (colour !== 2) {
    bad.push(colour === 6
      ? 'has an alpha channel — a layer on the card is not opaque, and the store wants 24-bit RGB'
      : `has PNG colour type ${colour}, must be 2 (truecolour RGB)`);
  }
  if (bad.length) throw new Error(bad.join('; '));
  return `${got.w}x${got.h}, 24-bit RGB, ${(buf.length / 1024).toFixed(0)} KB`;
}

async function shoot(cdp, card, dest, scale) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  try {
    await cdp.send('Page.enable', {}, sessionId);
    /* The viewport, set explicitly — this is the line that `--window-size` cannot do
       correctly under new Headless. screenWidth/Height match so nothing reads a screen
       larger than the card and lays out for it. */
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: card.w, height: card.h, deviceScaleFactor: scale, mobile: false,
      screenWidth: card.w, screenHeight: card.h
    }, sessionId);

    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: 'file://' + path.join(__dirname, card.src) }, sessionId);
    await loaded;                                    // includes the product-shot <iframe>

    /* The icon key, the webfont, then two frames. load fires before an @font-face file is
       necessarily applied, and a card screenshotted mid-swap is one rendered in the fallback
       face — a failure that looks like a design choice rather than like a bug. */
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `Promise.all([window.shdPromoReady, document.fonts.ready])
        .then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
        .then(() => window.shdPromoKeyed === true)`,
      awaitPromise: true, returnByValue: true
    }, sessionId);
    /* An icon that did not key is a pale rectangle sitting on the card's gradient. It is
       perfectly legible, which is exactly why it has to fail here: nothing downstream would
       notice, and the store would take the upload. */
    if (result.value !== true) {
      throw new Error('the icon background did not key — promo.js could not read the canvas ' +
                      '(is --allow-file-access-from-files still being passed?)');
    }

    /* clip.scale stays 1 and the magnification is entirely the device scale factor set
       above. The two MULTIPLY — passing the scale in both places asked for 3x and wrote a
       9x image — and the device scale factor is the one that rasterises the type at the
       higher resolution rather than upscaling a 1x raster. */
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: card.w, height: card.h, scale: 1 }
    }, sessionId);
    fs.writeFileSync(dest, Buffer.from(data, 'base64'));
  } finally {
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  }
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sheddit-promo-'));
  const chrome = spawn(findChrome(), [
    '--headless',
    '--no-sandbox',                     // the usual container case; harmless elsewhere
    '--disable-gpu',
    /* promo.js reads the icon's pixels back off a canvas to key its flat background out,
       and a canvas holding a file:// image is tainted without this. Scoped to a throwaway
       profile rendering two local files, and the alternative is committing a second,
       background-free copy of the icon that goes stale the first time the real one moves. */
    '--allow-file-access-from-files',
    '--hide-scrollbars',
    '--force-color-profile=srgb',       // else the same card differs per display profile
    '--disable-lcd-text',               // subpixel AA would leave colour fringes on the type
    '--font-render-hinting=none',
    '--disable-extensions',
    '--remote-debugging-port=0',        // whatever is free; the port comes back in a file
    `--user-data-dir=${profile}`,       // never touch the developer's own Chrome profile
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let failed = 0;
  let cdp;
  try {
    cdp = await connect(await devtoolsUrl(profile));
    for (const card of CARDS) {
      if (wanted.length && !wanted.includes(card.name)) continue;
      const dest = path.join(outDir, card.out);
      try {
        await shoot(cdp, card, dest, scale);
        const detail = scale === 1
          ? verify(dest, card.w, card.h)
          : `${card.w * scale}x${card.h * scale} (${scale}x preview — not for upload)`;
        console.log(`${card.name.padEnd(8)} ${path.relative(ROOT, dest)}  —  ${detail}`);
      } catch (e) {
        console.error(`${card.name.padEnd(8)} FAILED: ${e.message}`);
        failed += 1;
      }
    }
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
