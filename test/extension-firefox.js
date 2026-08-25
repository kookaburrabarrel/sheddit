#!/usr/bin/env node
/**
 * extension-firefox.js — installs the Firefox build into a real Firefox and drives it.
 *
 * THE GAP THIS FILLS
 * Gecko is a second engine with its own rules, and every one of them is invisible to the
 * Chromium suites:
 *
 *   - Content scripts see the page through Xray wrappers, a stricter realm separation
 *     than Chromium's isolated worlds. Everything that crosses the boundary — attribute
 *     reads, deepQuery, cloned bodies, the main-world bridge — re-earns its keep here.
 *   - On Firefox ESR 128 — the strict_min_version floor — there is no `navigation` API,
 *     so bridge.js's history relay is the ONLY signal route.js gets for a client-side
 *     navigation. Current Firefox release HAS the API (measured here: 154 ships it), so
 *     one session runs with defaults to test whatever this Firefox is, and a second
 *     prefs the API off to model the ESR floor and isolate the relay.
 *   - The manifest is the FIREFOX manifest — the derived one with the gecko block — and
 *     content_scripts `world: "MAIN"` is a Firefox 128 capability this suite proves the
 *     shipping zip actually gets.
 *   - chrome.* promise-style calls (pipeline.js and themes.js await chrome.storage.sync)
 *     ride Firefox's compatibility surface. If that surface shifted, nothing would
 *     render — which is why the first check is a control.
 *
 * HOW
 * geckodriver speaks the W3C WebDriver protocol over HTTP, and its moz:addon/install
 * endpoint temporary-installs an unsigned zip into a release Firefox — the same
 * mechanism as about:debugging. No client library: the protocol is a handful of JSON
 * endpoints, driven with fetch. The fixture-server mapping is the pref
 * `network.dns.localDomains`, Gecko's equivalent of Chromium's --host-resolver-rules —
 * only DNS is overridden, so the port in the URL survives.
 *
 *   node build.js && node test/extension-firefox.js
 *
 * Needs a Firefox and a geckodriver; skips cleanly when either is missing, and
 * SHEDDIT_REQUIRE_FIREFOX=1 turns that skip into a failure. On a Mac:
 *
 *   brew install geckodriver        # Firefox itself from firefox.com, if not installed
 *
 * WHAT THIS SUITE CANNOT SEE
 * document_start CSS *timing* — whether Gecko delivers suppress.css before first paint.
 * WebDriver returns after load, so a flash of native Reddit is over before anything can
 * be measured from here. That one is assessed by eye on a real machine.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { COMMENT_DEPTHS, POSTS, PAGER_PAGE_SIZE } = require('./fixtures');
const { makeChecker, serveFixtures, PATHS } = require('./harness');
const { buildTarget, firefoxManifest } = require('../package-extension.js');

const { check, report } = makeChecker();
const settle = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- discovery -- */

function firstExisting(cands) {
  for (const c of cands) if (c.path && fs.existsSync(c.path)) return c.path;
  return null;
}

function which(name) {
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}

function firefoxCandidates() {
  const explicit = process.env.SHEDDIT_FIREFOX;
  if (explicit) return [{ path: explicit, why: 'SHEDDIT_FIREFOX' }];
  const out = [
    { path: '/Applications/Firefox.app/Contents/MacOS/firefox', why: 'installed browser' },
    { path: '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox', why: 'installed browser' },
    { path: '/usr/bin/firefox', why: 'installed browser' },
    { path: '/usr/bin/firefox-esr', why: 'installed browser' },
    { path: '/snap/bin/firefox', why: 'installed browser' },
    { path: which('firefox'), why: 'on PATH' }
  ];
  // What @puppeteer/browsers installs, if anyone ran `npx @puppeteer/browsers install firefox`.
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'firefox');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache)) {
      out.push({ path: path.join(cache, d, 'firefox', 'firefox'), why: 'puppeteer browsers cache' });
      out.push({ path: path.join(cache, d, 'Firefox.app', 'Contents', 'MacOS', 'firefox'), why: 'puppeteer browsers cache' });
    }
  }
  return out;
}

function geckodriverCandidates() {
  const explicit = process.env.GECKODRIVER;
  if (explicit) return [{ path: explicit, why: 'GECKODRIVER' }];
  return [
    { path: path.join(__dirname, '..', 'node_modules', '.bin', 'geckodriver'), why: 'npm geckodriver package' },
    { path: '/opt/homebrew/bin/geckodriver', why: 'homebrew' },
    { path: '/usr/local/bin/geckodriver', why: 'installed' },
    { path: '/usr/bin/geckodriver', why: 'installed' },
    { path: which('geckodriver'), why: 'on PATH' }
  ];
}

const FIREFOX = firstExisting(firefoxCandidates());
const DRIVER = firstExisting(geckodriverCandidates());
if (!FIREFOX || !DRIVER) {
  const tried = (c) => c.map(x => `      ${x.path || '(not on PATH)'}  (${x.why})`).join('\n');
  const msg = `${FIREFOX ? '' : 'no Firefox found. Looked in:\n' + tried(firefoxCandidates()) + '\n'}` +
    `${DRIVER ? '' : 'no geckodriver found. Looked in:\n' + tried(geckodriverCandidates()) + '\n'}` +
    '\n    Fix it with either:\n' +
    '      brew install geckodriver   (or: npm i --no-save geckodriver)\n' +
    '      SHEDDIT_FIREFOX=/path/to/firefox GECKODRIVER=/path/to/geckodriver <the command you just ran>';
  if (process.env.SHEDDIT_REQUIRE_FIREFOX === '1') {
    console.log(`\n\x1b[1mFIREFOX EXTENSION\x1b[0m\n  \x1b[31mFAIL\x1b[0m ${msg}` +
      '\n  (SHEDDIT_REQUIRE_FIREFOX=1 turns this skip into a failure)');
    process.exit(1);
  }
  console.log(`\n\x1b[1mFIREFOX EXTENSION\x1b[0m\n  \x1b[33mSKIP\x1b[0m ${msg}`);
  process.exit(0);
}

/* ------------------------------------------------- a minimal WebDriver client -- */

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});

let driverPort, sid;
const DRIVER_LOG = path.join(os.tmpdir(), `sheddit-geckodriver-${process.pid}.log`);

async function wd(method, pathname, body) {
  const res = await fetch(`http://127.0.0.1:${driverPort}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ` +
      `${(json.value && json.value.message) || JSON.stringify(json)}`);
  }
  return json.value;
}

/* execute/sync takes a function BODY; the page's return value comes back JSON-cloned.
   It runs in the page's MAIN world — which is exactly right for this suite: a pushState
   issued here is indistinguishable from one issued by Reddit's router. */
const run = (body, ...args) => wd('POST', `/session/${sid}/execute/sync`, { script: body, args });
const goto = (url) => wd('POST', `/session/${sid}/url`, { url });

async function until(expr, { timeout = 15000, step = 120 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { if (await run(`return !!(${expr});`)) return true; } catch { /* navigating */ }
    if (Date.now() >= deadline) return false;
    await settle(step);
  }
}

/* ---------------------------------------------------------------- the run -- */

(async () => {
  // Always a fresh zip from the working tree — installing the committed artifact would
  // quietly test the previous build whenever someone forgot `npm run package`.
  const ZIP = path.join(os.tmpdir(), `sheddit-ff-suite-${process.pid}.zip`);
  buildTarget({ out: ZIP, transform: firefoxManifest }, { quiet: true });

  const server = await serveFixtures();
  const origin = `http://www.reddit.com:${server.port}`;

  driverPort = await freePort();
  // geckodriver's stderr carries Firefox's own words — the difference between
  // "Process unexpectedly closed with status 0" and knowing why. Captured to a file,
  // printed by the failure handler at the bottom.
  const logFd = fs.openSync(DRIVER_LOG, 'w');
  const driver = spawn(DRIVER, ['--port', String(driverPort)], { stdio: ['ignore', logFd, logFd] });
  const cleanup = async () => {
    try { if (sid) await wd('DELETE', `/session/${sid}`); } catch { /* already down */ }
    driver.kill();
    fs.rmSync(ZIP, { force: true });
    await server.close();
  };
  process.on('SIGINT', () => cleanup().then(() => process.exit(1)));

  try {
    // Wait for geckodriver to listen, then open the session.
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      try { await fetch(`http://127.0.0.1:${driverPort}/status`); ready = true; }
      catch { await settle(100); }
    }
    if (!ready) throw new Error('geckodriver never started listening');

    const BASE_PREFS = {
      // Gecko's --host-resolver-rules: these hostnames resolve to loopback,
      // ports untouched, so the manifest's *.reddit.com matches fire.
      'network.dns.localDomains': 'www.reddit.com',
      // Sandboxes export HTTPS_PROXY; an inherited proxy swallows the loopback
      // navigations exactly as it did for Chromium (see LAUNCH_ARGS).
      'network.proxy.type': 0,
      // reddit.com is on the built-in HSTS preload list and Firefox also ships
      // HTTPS-First — either one silently rewrites the plain-http fixture origin
      // to https and the navigation dies on a certificate it can never have.
      'network.stricttransportsecurity.preloadlist': false,
      'dom.security.https_first': false,
      'dom.security.https_first_schemeless': false,
      'datareporting.policy.dataSubmissionEnabled': false,
      'app.update.disabledForTesting': true
    };

    // Temporary install: unsigned zips are accepted on release Firefox through this
    // endpoint (it is what about:debugging uses). A permanent install would need AMO
    // signing, which is the store's job, not the suite's.
    const caps = (extraPrefs) => ({
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            binary: FIREFOX,
            args: ['-headless', '-width', '1280', '-height', '900'],
            prefs: { ...BASE_PREFS, ...extraPrefs }
          }
        }
      }
    });
    async function openSession(extraPrefs = {}) {
      let session;
      try {
        session = await wd('POST', '/session', caps(extraPrefs));
      } catch {
        // One retry. A Firefox that dies during first-launch housekeeping (profile
        // creation racing an update check, a stale lock) often comes up clean a moment
        // later; a structural failure fails identically twice, and then the geckodriver
        // log is printed on the way out.
        await settle(1500);
        session = await wd('POST', '/session', caps(extraPrefs));
      }
      sid = session.sessionId;
      await wd('POST', `/session/${sid}/moz/addon/install`, { path: ZIP, temporary: true });
    }
    async function closeSession() {
      if (sid) { const s = sid; sid = null; await wd('DELETE', `/session/${s}`); }
    }

    await openSession();

    /* ============================================================== *
     * LISTING — the derived manifest, end to end
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — LISTING\x1b[0m');
    await goto(origin + PATHS.listing);
    const rendered = await until(`document.querySelector('#shd-root .thing.link')`);

    const listing = await run(`
      const title = document.querySelector('#shd-root a.title');
      const app = document.querySelector('shreddit-app');
      return {
        rows: document.querySelectorAll('#shd-root .thing.link').length,
        rootIsBodyChild: document.querySelector('#shd-root')?.parentElement === document.body,
        active: document.documentElement.classList.contains('shd-active'),
        fail: document.documentElement.getAttribute('data-shd-fail'),
        header: !!document.querySelector('#shd-header'),
        sidebar: !!document.querySelector('#shd-sidebar'),
        titleFontSize: title && getComputedStyle(title).fontSize,
        titleColor: title && getComputedStyle(title).color,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        nativeVisibility: app && getComputedStyle(app).visibility,
        navigationApi: typeof navigation
      };`);

    // The one control everything else leans on. It also proves the chrome.* promise
    // calls resolved: pipeline.js awaits chrome.storage.sync.get before rendering
    // anything, so a broken promise surface reads 0 rows here, not a subtle wrongness.
    check('content scripts run — Firefox accepted the derived manifest, world:MAIN included',
      rendered && listing.rows > 0, JSON.stringify(listing));
    check(`renders one row per post (${POSTS.length})`, listing.rows === POSTS.length, `got ${listing.rows}`);
    check('mounts #shd-root as a direct child of <body>', listing.rootIsBodyChild);
    check('activates the skin, does not fail', listing.active && !listing.fail, listing.fail);
    check('header and sidebar are built', listing.header && listing.sidebar,
      `header=${listing.header} sidebar=${listing.sidebar}`);
    check('old-reddit.css is delivered by the manifest',
      listing.titleFontSize === '16px' && listing.titleColor === 'rgb(0, 0, 255)',
      `font-size ${listing.titleFontSize}, color ${listing.titleColor}`);
    check('suppress.css is delivered and hides the native tree',
      listing.nativeVisibility === 'hidden', String(listing.nativeVisibility));
    // Informative, not asserted: ESR 128 answers 'undefined', release 154+ 'object', and
    // the suite must pass on both. Which branch routes in THIS session follows from it;
    // the relay-in-isolation session at the end is version-independent.
    const hasNavApi = listing.navigationApi !== 'undefined';
    console.log(`  navigation API in this Firefox: ${hasNavApi ? 'present' : 'absent'} ` +
      `(${hasNavApi ? 'route.js prefers it; the relay is the safety net' :
        'the relay is the only route signal'})`);

    /* ============================================================== *
     * THE EXPANDO CLOSES — the reported [-] that did nothing
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — THE EXPANDO CLOSES\x1b[0m');
    // Reported from a real machine, on Firefox: [+] opened the picture, [-] left it up.
    // The cause was engine-independent CSS (.expando's display declaration beating the
    // UA's [hidden] rule — see css-lint), but this is the engine the report came from,
    // so this is the engine that re-verifies it.
    const exp = await run(`
      const btn = document.querySelector('#shd-root .thing.link .expando-button');
      if (!btn) return null;
      const box = btn.closest('.thing').querySelector('.expando');
      btn.click();
      const openDisplay = getComputedStyle(box).display;
      btn.click();
      return { openDisplay, closedDisplay: getComputedStyle(box).display,
               imgKept: !!box.querySelector('img') };`);
    check('a listing row offers the expando', exp !== null, 'no .expando-button in the listing');
    check('[+] opens the picture', exp && exp.openDisplay !== 'none', JSON.stringify(exp));
    check('[-] actually closes it', exp && exp.closedDisplay === 'none', JSON.stringify(exp));

    /* ============================================================== *
     * THE BLACKOUT MUST BEAT THE BODY'S FIRST CONTENT
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — THE BLACKOUT BEATS FIRST PAINT\x1b[0m');
    // The suspect that measurement CLEARED: Gecko was thought not to guarantee manifest
    // CSS before first paint, which would flash native Reddit no matter what the gate
    // did. The probe samples computed state at the instant body content starts existing
    // — the earliest anything could paint — and Gecko had the blackout computed by then.
    // Kept as the regression sentinel: if this ever goes red, Gecko's injection timing
    // moved, and the flash comes back through CSS rather than through the gate.
    await goto(origin + PATHS.paintProbe);
    await until(`document.querySelector('#shd-root .thing.link')`);
    const paint = await run(`return window.__shdPaint;`);
    check('the parse-time probe ran', !!paint, 'no __shdPaint — the fixture injection is broken');
    check('gate.js had engaged before body content existed (document_start JS held)',
      paint && paint.gateClass === true, JSON.stringify(paint));
    check('the blackout was computed before body content existed (document_start CSS held)',
      paint && paint.bodyVisibility === 'hidden',
      `visibility=${paint && paint.bodyVisibility} — Gecko delivered the manifest CSS after ` +
      `parsing began; the pre-paint flash is back and it is a CSS-timing problem this time`);

    /* ============================================================== *
     * A STREAMED PAGE MUST NOT FLASH THE NATIVE FEED
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — A STREAMED PAGE NEVER FLASHES THE NATIVE FEED\x1b[0m');
    // Reported from a real machine: a quick flash of the native feed before the layout.
    // Not the CSS-timing gap the probe above rules out — the mechanism is the gate's own
    // not-started unblank: real Reddit STREAMS its document, document_idle waits for
    // DOMContentLoaded, so on a heavy page the 1500ms tick lands while the pipeline has
    // not booted, and unblanking there shows the native feed until the render arrives.
    // The recorder logs every <html> class transition because the failure is a transient
    // no post-load read can see.
    await goto(origin + PATHS.slowStream);
    await until(`document.querySelector('#shd-root .thing.link')`);
    const gateTrace = (await run(`return window.__shdGateTrace;`)) || [];
    const flashes = gateTrace.filter(e => !e.gate && !e.active);
    const revealAt = (gateTrace.find(e => e.active) || {}).t;
    check('control: the stream really held the pipeline past the first tick',
      typeof revealAt === 'number' && revealAt > 1500,
      `reveal at ${revealAt}ms — if this fails, the no-flash check below proves nothing`);
    check('the blackout held from first paint to reveal — no native-feed flash',
      flashes.length === 0,
      `blackout dropped at ${JSON.stringify(flashes.map(e => e.t))}ms with nothing of ours up ` +
      `— the reported flash: the not-started unblank firing on a page we were about to take`);

    // The counterweight — the protection the unblank exists for: a route nobody will
    // take must STILL unblank at the first tick, or the hold blanks pages we are about
    // to disown (an unhandled route carrying shreddit-post elements, like a thread on a
    // profile post).
    await goto(origin + PATHS.slowStreamOther);
    const otherTrace = (await run(`return window.__shdGateTrace;`)) || [];
    const drop = otherTrace.find(e => !e.gate);
    check('an unhandled route still unblanks at the first tick, not at stream end',
      !!drop && drop.t > 1300 && drop.t < 2400,
      `gate dropped at ${drop && drop.t}ms — later than the 2600ms stream end means the ` +
      `hold is blanking pages it will never render`);

    /* ============================================================== *
     * THE THEME TIE, UNDER GECKO'S CASCADE
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — THEMES\x1b[0m');
    // Same trap as Chromium: themes.css arrives at document_start, old-reddit.css at
    // document_idle, so the palette rides entirely on selector specificity. Gecko owns
    // its own cascade order for injected sheets — asserted, not assumed.
    // (Back to the listing first: the section above ends on an unhandled route, where
    // there is no header to click.)
    await goto(origin + PATHS.listing);
    await until(`document.querySelector('.shd-theme-btn[data-theme="night"]')`);
    await run(`document.querySelector('.shd-theme-btn[data-theme="night"]').click();`);
    const themed = await run(`
      return {
        attr: document.documentElement.getAttribute('data-shd-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        titleColor: getComputedStyle(document.querySelector('#shd-root a.title')).color
      };`);
    check('clicking a theme button applies it', themed.attr === 'night', themed.attr);
    check('the palette beats the base block despite loading BEFORE it',
      themed.bodyBg === 'rgb(15, 17, 21)' && themed.titleColor === 'rgb(127, 176, 255)',
      `bg ${themed.bodyBg}, link ${themed.titleColor}`);

    // Reload: the choice comes back through Firefox's real storage.sync, read by the
    // document_start preload — themes.js's await chrome.storage.sync.get, round-tripped.
    let persisted = {};
    for (let i = 0; i < 10 && persisted.attr !== 'night'; i++) {
      await goto(origin + PATHS.listing);
      await until(`document.querySelector('#shd-root .thing.link')`);
      persisted = await run(`
        return {
          attr: document.documentElement.getAttribute('data-shd-theme'),
          bodyBg: getComputedStyle(document.body).backgroundColor
        };`);
    }
    check('the choice survives a reload (chrome.storage.sync round trip in Firefox)',
      persisted.attr === 'night' && persisted.bodyBg === 'rgb(15, 17, 21)',
      JSON.stringify(persisted));
    await run(`document.querySelector('.shd-theme-btn[data-theme="classic"]').click();`);

    /* ============================================================== *
     * THE HISTORY RELAY — the assertion this suite exists for
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — SPA NAVIGATION\x1b[0m');
    // This pushState is issued in the page's main world, exactly where Reddit's router
    // issues its own. Under an ESR-era Firefox the only path from it to a route change
    // is the relay (page-realm patched pushState -> BRIDGE.navigated -> route.js); under
    // a release Firefox the navigation API handles it and the relay is the safety net.
    // Either way the route must move — the relay-only claim is isolated at the end.
    await run(`
      document.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
      history.pushState({}, '', '/r/programming/');`);
    const navigated = await until(
      `[...document.querySelectorAll('#shd-header .tabmenu li.selected a')]` +
      `.some(a => a.textContent === 'r/programming')`);
    const afterNav = await run(`
      return {
        rows: document.querySelectorAll('#shd-root .thing.link').length,
        roots: document.querySelectorAll('#shd-root').length,
        headers: document.querySelectorAll('#shd-header').length,
        sidebar: !!document.querySelector('#shd-sidebar'),
        fail: document.documentElement.getAttribute('data-shd-fail')
      };`);
    check('a page-realm pushState reaches route.js — the relay crosses the Xray boundary',
      navigated === true,
      'header never followed: the bridge event is not arriving in the content script world');
    check('the navigation re-renders without duplicating anything',
      afterNav.rows === POSTS.length && afterNav.roots === 1 && afterNav.headers === 1,
      JSON.stringify(afterNav));
    check('the sidebar survives, nothing failed', afterNav.sidebar && !afterNav.fail, JSON.stringify(afterNav));

    // Back: popstate is the traversal half of the fallback.
    await run(`history.back();`);
    const backOk = await until(
      `location.pathname === '/' && ` +
      `[...document.querySelectorAll('#shd-header .tabmenu li.selected a')]` +
      `.every(a => a.textContent !== 'r/programming')`);
    check('a history traversal (popstate) routes too', backOk === true);

    /* ============================================================== *
     * SORT TABS THROUGH GECKO'S NAVIGATION API — when this Firefox has one
     * ============================================================== */
    // Chromium's pre-commit findings (bug 34: `navigate` dispatches with the OLD url,
    // destination.sameDocument lies) were measured against Blink. If this Firefox ships
    // the API, Gecko's implementation gets the same interception fixture; on an ESR-era
    // Firefox the fixture's page script cannot even run, so the section skips honestly.
    if (hasNavApi) {
      console.log('\n\x1b[1mFIREFOX EXTENSION — SORT TABS THROUGH GECKO\'S NAVIGATION API\x1b[0m');
      await goto(origin + PATHS.spa);
      await until(`document.querySelector('#shd-root .thing.link')`);
      await run(`document.querySelector('#shd-root .tabmenu a[href="/r/spa/new/"]').click();`);
      const sorted = await until(
        `location.pathname === '/r/spa/new/' && ` +
        `document.querySelectorAll('#shd-root .thing.link').length === 5 && ` +
        `[...document.querySelectorAll('#shd-root .thing.link a.title')]` +
        `.every(a => /^new post/.test(a.textContent))`);
      const spa = await run(`
        const titles = [...document.querySelectorAll('#shd-root .thing.link a.title')]
          .map(a => a.textContent);
        return {
          titles,
          unique: new Set(titles).size,
          selected: document.querySelector('#shd-root .tabmenu li.selected a')?.textContent,
          swaps: window.__spaSwaps,
          roots: document.querySelectorAll('#shd-root').length
        };`);
      check('a sort click through Gecko\'s navigate event moves URL and content together',
        sorted === true, JSON.stringify(spa));
      check('no stale rows spliced under the new sort',
        spa.titles.length === spa.unique && spa.swaps === 1 && spa.roots === 1,
        JSON.stringify(spa));
      check('the active tab highlight agrees with the render', spa.selected === 'new', spa.selected);
    } else {
      console.log('\n  \x1b[33mSKIP\x1b[0m sort tabs via the navigation API — absent in this Firefox');
    }

    /* ============================================================== *
     * PAGINATION — the world boundary under Xray vision
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — PAGINATION ACROSS THE WORLD BOUNDARY\x1b[0m');
    // The original bridge bug, replayed against Gecko: loadContent() is page-defined, so
    // only the MAIN-world half can call it, and the request/result protocol rides window
    // events plus <html> data attributes across a boundary Firefox polices harder than
    // Chromium does. 0 loads here = the port's pagination is dead.
    await goto(origin + PATHS.pager);
    await until(`window.__shdPager && window.__shdPager.loads >= 1`);
    for (let i = 0; i < 2; i++) {
      await run(`window.scrollTo(0, document.body.scrollHeight);`);
      await settle(1100);
    }
    const pager = await run(`
      const rows = [...document.querySelectorAll('#shd-root .thing.link')];
      return {
        loads: window.__shdPager.loads,
        rows: rows.length,
        unique: new Set(rows.map(r => r.dataset.fullname)).size,
        result: document.documentElement.dataset.shdLoadMore
      };`);
    check('the bridge drives loadContent end to end in Firefox', pager.loads >= 2,
      JSON.stringify(pager) + '  (0-1 loads = the request or result event is not crossing)');
    check('every loaded post becomes exactly one row',
      pager.rows === POSTS.length + pager.loads * PAGER_PAGE_SIZE && pager.rows === pager.unique,
      JSON.stringify(pager));
    check('the bridge records its result on <html>', pager.result === 'ok', pager.result);

    /* ============================================================== *
     * COMMENTS — attribute reads and body clones through Xrays
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — COMMENTS\x1b[0m');
    await goto(origin + PATHS.comments);
    await until(`document.querySelector('#shd-root .thing.comment')`);
    const comments = await run(`
      const all = [...document.querySelectorAll('#shd-root .thing.comment')];
      return {
        count: all.length,
        selfpost: !!document.querySelector('.shd-selfpost'),
        bodies: document.querySelectorAll('#shd-root .thing.comment .usertext-body').length,
        nested: all.every(c => {
          let actual = 0, n = c.parentElement;
          while (n) { if (n.classList && n.classList.contains('comment')) actual++; n = n.parentElement; }
          return Number(c.dataset.depth) === actual;
        }),
        fail: document.documentElement.getAttribute('data-shd-fail')
      };`);
    check(`renders all ${COMMENT_DEPTHS.length} comments`,
      comments.count === COMMENT_DEPTHS.length, `got ${comments.count}`);
    check('renders the submission above the thread', comments.selfpost);
    check('every comment body was cloned across the boundary',
      comments.bodies === COMMENT_DEPTHS.length, `${comments.bodies} bodies`);
    check('nesting matches every depth attribute', comments.nested);
    check('does not fail on the comments route', !comments.fail, comments.fail);

    /* ============================================================== *
     * UNHANDLED ROUTE — Gecko timing must not spring the gate
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — UNHANDLED ROUTE\x1b[0m');
    await goto(origin + '/search/?q=test');
    await settle(1800);   // outlast gate.js's first deadline tick to prove nothing fires
    const other = await run(`
      return {
        root: !!document.querySelector('#shd-root'),
        header: !!document.querySelector('#shd-header'),
        gate: document.documentElement.classList.contains('shd-gate'),
        active: document.documentElement.classList.contains('shd-active'),
        nativeVisibility: getComputedStyle(document.querySelector('shreddit-app')).visibility,
        bodyVisibility: getComputedStyle(document.body).visibility
      };`);
    check('mounts nothing on an unhandled route', !other.root && !other.header, JSON.stringify(other));
    check('releases the pre-render blackout', !other.gate && other.bodyVisibility === 'visible',
      JSON.stringify(other));
    check('leaves native Reddit visible and unsuppressed',
      other.nativeVisibility === 'visible' && !other.active, JSON.stringify(other));

    /* ============================================================== *
     * THE RELAY IN ISOLATION — a fresh session modelling ESR 128
     * ============================================================== */
    console.log('\n\x1b[1mFIREFOX EXTENSION — THE RELAY IN ISOLATION (ESR-era Firefox)\x1b[0m');
    // strict_min_version is 128, and 128 has no navigation API — for that whole line the
    // relay is the ONLY signal a sort click produces. A release Firefox routes the main
    // session's navigations through the API, so nothing above pins the relay by itself;
    // this session prefs the API off and repeats the navigation. The control comes first:
    // if the pref stops existing, this session quietly becomes a duplicate of the main
    // one and would keep passing with the relay dead — the exact green-but-worthless
    // shape this suite exists to prevent.
    await closeSession();
    await openSession({ 'dom.navigation.webidl.enabled': false });

    await goto(origin + PATHS.listing);
    await until(`document.querySelector('#shd-root .thing.link')`);
    const apiOff = await run(`return typeof navigation;`);
    check('control: the pref really removed the navigation API from this session',
      apiOff === 'undefined',
      `typeof navigation = ${apiOff} — the pref is gone; this section no longer isolates the relay`);

    await run(`
      document.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
      history.pushState({}, '', '/r/programming/');`);
    const relayed = await until(
      `[...document.querySelectorAll('#shd-header .tabmenu li.selected a')]` +
      `.some(a => a.textContent === 'r/programming')`);
    check('with no navigation API, the relay ALONE routes a page-realm pushState',
      relayed === true,
      'the route never changed — on ESR-era Firefox every sort click would go unseen (bug 82)');
    const relayNav = await run(`
      return {
        rows: document.querySelectorAll('#shd-root .thing.link').length,
        roots: document.querySelectorAll('#shd-root').length,
        fail: document.documentElement.getAttribute('data-shd-fail')
      };`);
    check('and the re-render is clean', relayNav.rows === POSTS.length &&
      relayNav.roots === 1 && !relayNav.fail, JSON.stringify(relayNav));
  } finally {
    await cleanup();
  }
  report();
})().catch((e) => {
  console.error(e);
  // The error above is geckodriver's one-liner; the log is Firefox's side of the story
  // (a missing library, a profile it could not write, an instance handoff). Without
  // this, "unexpectedly closed" is the whole report and the reader is left guessing.
  try {
    const lines = fs.readFileSync(DRIVER_LOG, 'utf8').trim().split('\n');
    console.error(`\nFirefox binary: ${FIREFOX}`);
    console.error(`geckodriver log (last ${Math.min(40, lines.length)} lines of ${DRIVER_LOG}):`);
    console.error('  ' + lines.slice(-40).join('\n  '));
  } catch { /* the driver never wrote a log */ }
  process.exit(1);
});
