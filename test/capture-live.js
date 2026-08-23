#!/usr/bin/env node
/**
 * capture-live.js — characterise a REAL Reddit page state we cannot otherwise see.
 *
 *   npm run capture:live -- --path=/r/SomeSub/
 *   npm run capture:live -- --path=/r/SomeSub/ --headed --click
 *
 * WHY THIS EXISTS
 * TESTING.md's first known gap: "Real logged-out page states are approximated, not
 * captured." Age gates, quarantine notices, private communities and rate-limit pages are
 * routine when logged out, and every one of them is represented in the suite by
 * `/r/gated/` — a stand-in someone wrote from memory. Whether our handling is right is
 * therefore reasoning, not evidence.
 *
 * The single fact that decides it is whether the page has a FEED CONTAINER. gate.js splits
 * on exactly that:
 *
 *   no shreddit-feed / shreddit-comment-tree   "not our kind of page" — un-blank at once and
 *                                              leave native Reddit completely alone
 *   container present, nothing renders         suspicious — blank, wait, then fail loudly
 *
 * Get that wrong on an interstitial and the failure screen lands on top of the button the
 * user has to press, after twelve seconds of white. That already happened once (docs/engineering-log.md
 * bug 21), which is why it is worth measuring rather than assuming.
 *
 * ON CONTENT: this prints and saves a tag/attribute SKELETON — element names, ids, classes,
 * our own contract attributes, and Reddit's own UI strings on buttons. It deliberately does
 * not capture post titles, comment bodies, author names or media URLs. A fixture needs the
 * shape, not the content, and the pages worth capturing are exactly the ones whose content
 * has no business in a git repository.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer');
const { resolveChrome, noChromeMessage } = require('./harness');

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const HEADED = process.argv.includes('--headed');
const CLICK = process.argv.includes('--click');
const PATHNAME = arg('path', '/');
const SAVE = arg('save', null);
/* Overridable so this script can be smoke-tested against the local fixture server before
   anyone relies on its output. A capture tool that has never been run is not a tool. */
const ORIGIN = arg('origin', 'https://www.reddit.com');

const EXE = resolveChrome();
if (!EXE) { console.error('\n  ' + noChromeMessage() + '\n'); process.exit(1); }

// Same trick live-contracts.js uses: read contracts.js without a browser.
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'contracts.js'), 'utf8'),
  ctx, { filename: 'contracts.js' });
const C = ctx.SHD.C;

// route.js reads a bare `location`, so give it one per path we want to classify.
function classify(pathname) {
  const rctx = vm.createContext({ location: { pathname } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'route.js'), 'utf8'), rctx);
  return rctx.SHD.route.classify(pathname);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

(async () => {
  const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(ORIGIN);
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: !HEADED,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled',
      // Only for the local smoke test: an inherited HTTPS_PROXY makes Chrome refuse loopback
      // navigations. Never set for a real capture, where the machine's proxy config — if it
      // has one — is the thing that gets us out to reddit.com.
      ...(LOOPBACK ? ['--no-proxy-server'] : [])]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  const url = ORIGIN + PATHNAME;
  console.log(`\n${bold('CAPTURE — ' + url)}`);

  try {
    // Deliberately NOT networkidle2. Reddit holds long-lived connections open and a page
    // whose network never goes quiet would time out here having loaded perfectly well —
    // reporting "could not load" for a page sitting fully rendered on screen.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.error(`  could not load: ${String(e).split('\n')[0]}`);
    await browser.close();
    process.exit(1);
  }
  // Wait for the app shell, then settle. Reporting "absent" for something that simply had
  // not arrived yet is the mistake gate.js's deadline used to make; do not repeat it here.
  await page.waitForSelector(C.APP, { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  const probe = async () => page.evaluate((C) => {
    const skeleton = (el, depth = 0) => {
      if (!el || depth > 3) return null;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? '#' + el.id : '';
      const cls = typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      return { tag: tag + id + cls, children: [...el.children].slice(0, 8).map(c => skeleton(c, depth + 1)).filter(Boolean) };
    };
    // Which direct child of <body> holds a given node? suppress.css clips at that level,
    // so it is the element our passthrough would have to un-hide.
    const bodyChildOf = (el) => {
      let n = el;
      while (n && n.parentElement && n.parentElement !== document.body) n = n.parentElement;
      if (!n || n.parentElement !== document.body) return null;
      return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '');
    };
    const controls = [...document.querySelectorAll('button, a[role="button"], faceplate-tracker button')]
      .map(b => ({ text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), host: bodyChildOf(b) }))
      .filter(b => b.text)
      .slice(0, 12);
    return {
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      // THE decision input for gate.js.
      feed: !!document.querySelector(C.FEED),
      commentTree: !!document.querySelector(C.COMMENT_TREE),
      posts: document.querySelectorAll(C.POST).length,
      comments: document.querySelectorAll(C.COMMENT).length,
      app: !!document.querySelector(C.APP),
      main: !!document.querySelector(C.MAIN),
      bodyChildren: [...document.body.children].map(el =>
        el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')),
      // Reddit's own interstitial copy, which is UI chrome rather than user content.
      heading: (document.querySelector('h1, h2')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      controls,
      skeleton: skeleton(document.body)
    };
  }, C);

  const before = await probe();
  const report = (r, label) => {
    console.log(`\n${bold(label)}`);
    console.log(`  final URL          ${r.url}`);
    console.log(`  document.title     ${JSON.stringify(r.title)}`);
    console.log(`  route classifies   ${classify(r.pathname)}   ${dim('(LISTING/COMMENTS = we render it; OTHER = we stay out)')}`);
    console.log(`  ${bold('shreddit-feed')}      ${r.feed ? bold('PRESENT') : 'absent'}`);
    console.log(`  ${bold('comment-tree')}       ${r.commentTree ? bold('PRESENT') : 'absent'}`);
    console.log(`  shreddit-post      ${r.posts}`);
    console.log(`  shreddit-comment   ${r.comments}`);
    console.log(`  shreddit-app       ${r.app ? 'present' : 'absent'}`);
    console.log(`  #main-content      ${r.main ? 'present' : 'absent'}`);
    console.log(`  body children      ${r.bodyChildren.join(', ')}`);
    console.log(`  heading            ${JSON.stringify(r.heading)}`);
    console.log(`  controls           ${r.controls.map(c => `${JSON.stringify(c.text)} (under ${c.host})`).join('\n                     ')}`);

    const container = r.feed || r.commentTree;
    console.log(`\n  ${bold('VERDICT')}`);
    if (r.posts + r.comments > 0) {
      console.log(`  Content is present — this is an ordinary page we render, not a gate.`);
    } else if (!container) {
      console.log(`  ${bold('SAFE')} — no feed container and no sources. gate.js takes the ` +
                  `"not our page" branch:\n  it un-blanks immediately and leaves native Reddit alone. ` +
                  `This is the case /r/gated/ models.`);
    } else {
      console.log(`  ${bold('DANGER')} — a feed container is present with zero posts in it. ` +
                  `gate.js reads that as\n  "Reddit gave us somewhere to put posts and we rendered ` +
                  `none", keeps the page blanked for\n  MAX_WAIT_MS, and then puts #shd-error over ` +
                  `this page — including over the button above.\n  This is exactly docs/engineering-log.md bug 21, ` +
                  `and it needs a fixture plus a fix.`);
    }
  };
  report(before, 'AS DELIVERED (logged out)');

  let after = null;
  if (CLICK) {
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, a[role="button"]')]
        .find(x => /over 18|18\+|yes|continue|i understand|view/i.test(x.textContent || ''));
      if (!b) return null;
      b.click();
      return (b.textContent || '').trim().slice(0, 40);
    });
    if (!clicked) {
      console.log(`\n  ${dim('--click: no over-18 style control found to press')}`);
    } else {
      console.log(`\n  ${dim('--click: pressed ' + JSON.stringify(clicked) + ', re-probing in 5s')}`);
      await new Promise(r => setTimeout(r, 5000));
      after = await probe();
      report(after, 'AFTER CLICKING THROUGH THE GATE');
    }
  }

  const out = SAVE || path.join(__dirname, '..', 'dist',
    'capture' + PATHNAME.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ path: PATHNAME, before, after }, null, 2));
  console.log(`\n  ${dim('skeleton saved: ' + path.relative(process.cwd(), out))}`);
  console.log(`  ${dim('(tags/ids/classes and Reddit\'s own button text only — no post or comment content)')}`);

  if (HEADED) {
    console.log(`\n  ${dim('--headed: window stays open 30s')}`);
    await new Promise(r => setTimeout(r, 30000));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
