/**
 * headless.js — one Chrome, driven over the DevTools protocol, for the two things in this
 * repository that turn a local page into a PNG: export-icons.js and docs/promo/render.js.
 *
 * It exists because both need the same four awkward things — find a browser, get an exact
 * viewport, wait until the page has actually finished, capture at the pixel — and neither
 * is worth a dependency. package.json's three belong to the test suite; this uses node's
 * own WebSocket.
 *
 * WHY NOT `chrome --screenshot --window-size=W,H`
 * Because it silently produces the wrong picture. Old Headless was removed from the Chrome
 * binary in 132; under new Headless `--window-size` is the OS WINDOW, so the viewport comes
 * out roughly 80px shorter and the screenshot is padded to the requested height with the
 * page's background colour. The bottom of the image is simply missing, at exactly the size
 * asked for. Emulation.setDeviceMetricsOverride sets the viewport itself, and
 * Page.captureScreenshot's clip crops to the pixel.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  throw new Error('no Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
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

/** A DevTools connection: send(), and once() for the events these scripts wait on. */
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
        return new Promise((ok, no) => pending.set(id, { resolve: ok, reject: no }));
      },
      once(method) { return new Promise(r => waiters.set(method, r)); },
      close() { ws.close(); }
    }));
  });
}

/**
 * Read a PNG's IHDR. Both callers assert on what comes back, because both write files whose
 * size and colour type are a store requirement rather than a detail:
 * colour type 2 is truecolour RGB, 6 is RGBA.
 */
function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  if (buf.toString('latin1', 12, 16) !== 'IHDR') throw new Error('no IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), depth: buf[24], colour: buf[25] };
}

/**
 * Run `body` with a browser, and close it however that goes.
 *
 * `body` is handed a shoot() taking:
 *   url          what to load (file://, data:, anything Chrome will open)
 *   width/height the CSS viewport, which is also the image size before `scale`
 *   scale        device scale factor; 2 rasterises at 2x rather than upscaling a 1x raster.
 *                Deliberately NOT also passed as captureScreenshot's clip scale — the two
 *                MULTIPLY, and asking for 3 in both places writes a 9x image.
 *   transparent  let the page's own transparency through, for an icon with rounded corners
 *   settle       a JS expression, awaited, that must resolve truthy before the shot. This is
 *                where "the webfont is applied" or "the icon keyed" goes; a page that says
 *                it is not ready throws rather than being photographed anyway.
 */
async function withChrome(body, extraArgs = []) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sheddit-shot-'));
  const chrome = spawn(findChrome(), [
    '--headless',
    '--no-sandbox',                     // the usual container case; harmless elsewhere
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',       // else the same page differs per display profile
    '--disable-lcd-text',               // subpixel AA would leave colour fringes on the type
    '--font-render-hinting=none',
    '--disable-extensions',
    '--remote-debugging-port=0',        // whatever is free; the port comes back in a file
    `--user-data-dir=${profile}`,       // never touch the developer's own Chrome profile
    ...extraArgs,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let cdp;
  try {
    cdp = await connect(await devtoolsUrl(profile));
    return await body(async ({ url, width, height, scale = 1, transparent = false, settle }) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      try {
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: scale, mobile: false,
          screenWidth: width, screenHeight: height
        }, sessionId);
        if (transparent) {
          await cdp.send('Emulation.setDefaultBackgroundColorOverride',
            { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
        }
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url }, sessionId);
        await loaded;
        if (settle) {
          const { result } = await cdp.send('Runtime.evaluate',
            { expression: settle, awaitPromise: true, returnByValue: true }, sessionId);
          if (result.value !== true) throw new Error('the page reported it was not ready to be shot');
        }
        /* Two frames after everything else: load fires before a late style or an @font-face
           file is necessarily applied, and a page photographed mid-swap is one rendered in
           the fallback — a failure that looks like a design choice rather than a bug. */
        await cdp.send('Runtime.evaluate', {
          expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
          awaitPromise: true
        }, sessionId);
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width, height, scale: 1 }
        }, sessionId);
        return Buffer.from(data, 'base64');
      } finally {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    });
  } finally {
    if (cdp) cdp.close();
    chrome.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = { findChrome, withChrome, pngInfo };
