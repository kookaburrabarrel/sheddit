#!/usr/bin/env node
/**
 * extension.js — loads Sheddit as a REAL unpacked extension and drives it.
 *
 * THE GAP THIS FILLS
 * Every other suite runs dist/sheddit.dev.js, which is the same source concatenated by
 * build.js. That proves the logic but not the packaging: manifest match patterns, the
 * document_start / document_idle split, script order, and delivery of the two
 * stylesheets are all invented by the manifest and exercised by nothing. TESTING.md
 * listed "not yet run as a packed extension end-to-end" as a known gap.
 *
 * HOW
 * Content scripts only run on URLs matching `*://*.reddit.com/*`, so a loopback server
 * alone is not enough. Chrome's --host-resolver-rules maps the hostname onto the fixture
 * server, giving a real reddit.com origin with no network access.
 *
 *   node build.js && node test/extension.js
 */
const path = require('path');
const puppeteer = require('puppeteer');
const { COMMENT_DEPTHS, POSTS, PAGER_PAGE_SIZE, COMMENT_PAGER_BATCH,
        BRANCH_PAGER_BRANCHES } = require('./fixtures');
const { requireChrome, makeChecker, serveFixtures, PATHS, COMMENT_SLICE,
        LAUNCH_ARGS } = require('./harness');

const EXE = requireChrome('PACKED EXTENSION');
const ROOT = path.join(__dirname, '..');
const { check, report } = makeChecker();

/** A deliberate pause, for asserting that something does NOT happen. */
const settle = (ms = 700) => new Promise(r => setTimeout(r, ms));

/**
 * Poll the page until `fn` returns truthy. Fixed sleeps make this suite report bugs that
 * are not there whenever the machine is busy — and a browser suite on CI always is.
 */
async function until(page, fn, { timeout = 15000, step = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { if (await page.evaluate(fn)) return true; } catch { /* navigating */ }
    if (Date.now() >= deadline) return false;
    await new Promise(r => setTimeout(r, step));
  }
}

(async () => {
  const server = await serveFixtures();
  // The port must stay in the URL: MAP with an explicit port is refused
  // (ERR_BLOCKED_BY_CLIENT), while MAP to a bare host and an explicit port works.
  const origin = `http://www.reddit.com:${server.port}`;

  const browser = await puppeteer.launch({
    executablePath: EXE,
    args: [
      ...LAUNCH_ARGS,
      '--host-resolver-rules=MAP www.reddit.com 127.0.0.1',
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.isNavigationRequest() ? req.continue() : req.abort()));

  /* ================================================================== *
   * LISTING — the whole manifest pipeline, unassisted
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — LISTING\x1b[0m');
  await page.goto(origin + PATHS.listing, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('#shd-root .thing.link'));

  const listing = await page.evaluate(() => {
    const title = document.querySelector('#shd-root a.title');
    const app = document.querySelector('shreddit-app');
    return {
      rows: document.querySelectorAll('#shd-root .thing.link').length,
      rootIsBodyChild: document.querySelector('#shd-root')?.parentElement === document.body,
      active: document.documentElement.classList.contains('shd-active'),
      fail: document.documentElement.getAttribute('data-shd-fail'),
      header: !!document.querySelector('#shd-header'),
      sidebar: !!document.querySelector('#shd-sidebar'),
      sentinel: !!document.querySelector('.shd-sentinel'),
      // proves old-reddit.css arrived via the manifest, not via our own <style>
      titleFontSize: title && getComputedStyle(title).fontSize,
      titleColor: title && getComputedStyle(title).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      // proves suppress.css arrived
      nativeClip: app && getComputedStyle(app).clipPath,
      nativeOpacity: app && getComputedStyle(app).opacity,
      injectedStyleTag: !!document.getElementById('shd-style')   // dev-harness marker
    };
  });

  check('content scripts run on a reddit.com origin', listing.rows > 0, JSON.stringify(listing));
  check(`renders one row per post (${POSTS.length})`, listing.rows === POSTS.length, `got ${listing.rows}`);
  check('mounts #shd-root as a direct child of <body>', listing.rootIsBodyChild);
  check('activates the skin', listing.active);
  check('does not fail', !listing.fail, listing.fail);
  check('header and sidebar are built', listing.header && listing.sidebar,
    `header=${listing.header} sidebar=${listing.sidebar}`);
  check('pagination sentinel is attached', listing.sentinel);

  check('old-reddit.css is delivered by the manifest',
    listing.titleFontSize === '16px' && listing.titleColor === 'rgb(0, 0, 255)',
    `font-size ${listing.titleFontSize}, color ${listing.titleColor}`);
  check('the page background comes from the skin',
    listing.bodyBg === 'rgb(218, 224, 230)', listing.bodyBg);
  check('suppress.css is delivered by the manifest and hides the native tree',
    listing.nativeClip === 'inset(50%)' && listing.nativeOpacity === '0',
    `clip-path ${listing.nativeClip}, opacity ${listing.nativeOpacity}`);
  check('this is the packed extension, not the dev harness', !listing.injectedStyleTag);
  check('no page errors on the listing route', pageErrors.length === 0, pageErrors.join(' | '));

  /* ================================================================== *
   * THEMES — the one thing the dev harness structurally cannot check
   *
   * The bundle concatenates every stylesheet into a single <style> with themes.css last,
   * so a palette wins there even if its selector were no more specific than the base. The
   * packed extension delivers themes.css at document_start and old-reddit.css at
   * document_idle — the adverse order — so here a tie loses and the theme silently does
   * nothing. Same shape as the pagination bug: green in the harness, broken when installed.
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — THEMES\x1b[0m');
  {
    await page.click('.shd-theme-btn[data-theme="night"]');
    const themed = await page.evaluate(() => {
      const title = document.querySelector('#shd-root a.title');
      return {
        attr: document.documentElement.getAttribute('data-shd-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        titleColor: getComputedStyle(title).color,
        sheets: [...document.styleSheets].length
      };
    });
    check('clicking a theme button applies it', themed.attr === 'night', themed.attr);
    check('the palette beats the base block despite loading BEFORE it',
      themed.bodyBg === 'rgb(15, 17, 21)' && themed.titleColor === 'rgb(127, 176, 255)',
      `bg ${themed.bodyBg}, link ${themed.titleColor} — themes.css arrives at document_start, ` +
      `old-reddit.css at document_idle, so this rides entirely on specificity`);

    /* Persistence, through the real chrome.storage.sync rather than a shim, and read back
       by the document_start preload rather than by the pipeline.
       NB: SHD lives in the isolated world, so page.evaluate() cannot reach it from here —
       the whole exercise has to be driven through the buttons, exactly as a user would.
       That is the same wall the paginator hit; it is not a limitation to work around.
       The write is a storage round trip with no observable completion from this side, so
       reload-and-look is retried rather than slept on. */
    async function reloadAndRead() {
      await page.goto(origin + PATHS.listing, { waitUntil: 'domcontentloaded' });
      await until(page, () => !!document.querySelector('#shd-root .thing.link'));
      return page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-shd-theme'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        pressed: document.querySelector('.shd-theme-btn.selected')?.getAttribute('data-theme')
      }));
    }
    let persisted = await reloadAndRead();
    for (let i = 0; i < 10 && persisted.attr !== 'night'; i++) persisted = await reloadAndRead();

    check('the choice survives a reload', persisted.attr === 'night' &&
      persisted.bodyBg === 'rgb(15, 17, 21)', JSON.stringify(persisted));
    check('and the header comes back with the right button pressed',
      persisted.pressed === 'night', persisted.pressed);

    // Back to the default, so nothing below inherits a dark page.
    await page.click('.shd-theme-btn[data-theme="classic"]');
    const restored = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('switching back restores the classic palette', restored === 'rgb(218, 224, 230)', restored);
    check('no page errors while theming', pageErrors.length === 0, pageErrors.join(' | '));
  }

  /* ================================================================== *
   * VOTE DELEGATION — the highest-risk unverified behaviour
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — VOTE DELEGATION\x1b[0m');
  // The action bar hydrates inside a shreddit-async-loader, which ARCHITECTURE §1.2
  // records as having a shadow root. A light-DOM-only querySelector would miss a button
  // placed there permanently, not transiently. Build that exact shape and click through.
  await page.evaluate(() => {
    const post = document.querySelector('shreddit-post[id="t3_link1"]');
    const loader = post.querySelector('shreddit-async-loader');
    const shadow = loader.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.setAttribute('upvote', '');
    btn.setAttribute('aria-label', 'upvote');
    btn.addEventListener('click', () => { window.__nativeUpvotes = (window.__nativeUpvotes || 0) + 1; });
    shadow.appendChild(btn);
  });
  await page.click('#shd-root .thing[data-fullname="t3_link1"] .midcol .arrow.up');
  check('an upvote click reaches a native button inside an OPEN shadow root',
    await page.evaluate(() => window.__nativeUpvotes === 1),
    `__nativeUpvotes = ${await page.evaluate(() => window.__nativeUpvotes)}`);

  // A post with no vote bar at all must stay silent-but-safe, not throw.
  const beforeErrs = pageErrors.length;
  await page.click('#shd-root .thing[data-fullname="t3_text1"] .midcol .arrow.up');
  check('an upvote click with no vote bar present does not throw',
    pageErrors.length === beforeErrs, pageErrors.slice(beforeErrs).join(' | '));

  /* ================================================================== *
   * SPA NAVIGATION — the chrome-rebuild fixes, in the real extension
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — SPA NAVIGATION\x1b[0m');
  const beforeNav = await page.evaluate(() => ({
    selected: [...document.querySelectorAll('#shd-header .tabmenu li.selected a')].map(a => a.textContent)
  }));
  await page.evaluate(() => {
    // Reddit swaps feed content client-side; the fixture DOM is static, so un-stamp the
    // posts to stand in for a fresh batch of markup arriving.
    document.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    history.pushState({}, '', '/r/programming/');
  });
  await until(page, () => [...document.querySelectorAll('#shd-header .tabmenu li.selected a')]
    .some(a => a.textContent === 'r/programming'));
  const afterNav = await page.evaluate(() => ({
    rows: document.querySelectorAll('#shd-root .thing.link').length,
    roots: document.querySelectorAll('#shd-root').length,
    headers: document.querySelectorAll('#shd-header').length,
    sidebar: !!document.querySelector('#shd-sidebar'),
    selected: [...document.querySelectorAll('#shd-header .tabmenu li.selected a')].map(a => a.textContent),
    fail: document.documentElement.getAttribute('data-shd-fail')
  }));

  check('client-side navigation re-renders without duplicating rows',
    afterNav.rows === POSTS.length && afterNav.roots === 1 && afterNav.headers === 1,
    JSON.stringify(afterNav));
  // Both of these were broken: reveal() latches true, so the flush that rebuilt the
  // chrome never ran again after the first route.
  check('the sidebar survives a client-side navigation', afterNav.sidebar);
  check('the header follows the new subreddit',
    afterNav.selected.includes('r/programming'),
    `was ${JSON.stringify(beforeNav.selected)}, now ${JSON.stringify(afterNav.selected)}`);
  check('still has not failed', !afterNav.fail, afterNav.fail);

  /* ================================================================== *
   * COMMENTS
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — COMMENTS\x1b[0m');
  await page.goto(origin + PATHS.comments, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('#shd-root .thing.comment'));
  const comments = await page.evaluate(() => ({
    count: document.querySelectorAll('#shd-root .thing.comment').length,
    selfpost: !!document.querySelector('.shd-selfpost'),
    nested: [...document.querySelectorAll('#shd-root .thing.comment')].every(c => {
      let actual = 0, n = c.parentElement;
      while (n) { if (n.classList?.contains('comment')) actual++; n = n.parentElement; }
      return Number(c.dataset.depth) === actual;
    }),
    fail: document.documentElement.getAttribute('data-shd-fail')
  }));
  check(`renders all ${COMMENT_DEPTHS.length} comments`,
    comments.count === COMMENT_DEPTHS.length, `got ${comments.count}`);
  check('renders the submission above the thread', comments.selfpost);
  check('nesting matches every depth attribute', comments.nested);
  check('does not fail on the comments route', !comments.fail, comments.fail);

  /* ================================================================== *
   * PAGINATION — across the isolated/main world boundary
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — PAGINATION\x1b[0m');
  // THE regression test. faceplate-partial is a custom element defined by page JS, so
  // loadContent() exists in the MAIN world and is invisible to a content script. That made
  // the feed dead-end at 3 posts in the shipped extension while working perfectly in the
  // dev harness — which is why pasting into DevTools "verified" a feature that had never
  // once worked when installed. Only a packed-extension run can tell the two apart.
  await page.goto(origin + PATHS.pager, { waitUntil: 'domcontentloaded' });
  await until(page, () => window.__shdPager && window.__shdPager.loads >= 1);

  const pageState = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#shd-root .thing.link')];
    return {
      loads: window.__shdPager.loads,
      rows: rows.length,
      unique: new Set(rows.map(r => r.dataset.fullname)).size,
      posts: document.querySelectorAll('shreddit-post').length,
      sentinels: document.querySelectorAll('.shd-sentinel').length,
      ranksSequential: rows.every((r, i) => r.querySelector('.rank').textContent === String(i + 1)),
      sentinelLast: (() => {
        const s = document.querySelector('.shd-sentinel'), t = document.querySelector('#siteTable');
        return !!s && !!t && s.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1;
      })()
    };
  });

  const before = await pageState();
  // On a short page the sentinel is already inside the 1200px trigger margin, so one load
  // firing immediately is correct auto-pagination, not a bug.
  check('the bridge works end to end — a page actually loads',
    before.loads >= 1 && before.rows > POSTS.length,
    JSON.stringify(before) + '  (0 loads = the isolated world cannot reach loadContent)');

  // Keep the sentinel in view and let time pass. IntersectionObserver only reports
  // CHANGES, so a feed that only advances when intersection toggles will stall here.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(1100);
  }
  const after = await pageState();

  check('the feed keeps advancing while the sentinel stays in view',
    after.loads > before.loads + 1,
    `loads ${before.loads} -> ${after.loads} (a stall pins this at ${before.loads + 1})`);
  check('every loaded post becomes exactly one row',
    after.rows === after.posts, `${after.rows} rows for ${after.posts} posts`);
  check('pagination never duplicates a row',
    after.rows === after.unique, `${after.rows} rows, ${after.unique} unique`);
  check('ranks stay sequential across pages', after.ranksSequential);
  check('exactly one sentinel survives repeated loads',
    after.sentinels === 1, String(after.sentinels));
  check('the sentinel stays below the last row', after.sentinelLast);
  check(`each load adds a full page of ${PAGER_PAGE_SIZE}`,
    after.rows === POSTS.length + after.loads * PAGER_PAGE_SIZE,
    `${after.rows} rows after ${after.loads} loads`);

  // The 800ms cooldown must hold even under continuous scrolling.
  const gaps = await page.evaluate(() => {
    const t = window.__shdPager.times;
    return t.slice(1).map((x, i) => x - t[i]);
  });
  check('the cooldown between loads is respected',
    gaps.every(g => g >= 750), `gaps: [${gaps.join(', ')}]ms`);

  // autoPaginate: false must fetch nothing until clicked — the "strictly zero network" mode.
  await page.goto(origin + PATHS.pager, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('.shd-loadmore'));
  const manual = await page.evaluate(async () => {
    const before = window.__shdPager.loads;
    // Deliberately clicked immediately, inside the cooldown window: a button that silently
    // does nothing is worse than one that fetches twice.
    document.querySelector('.shd-loadmore').click();
    await new Promise(r => setTimeout(r, 900));
    return { before, after: window.__shdPager.loads };
  });
  check('clicking "load more" fetches a page even inside the cooldown',
    manual.after === manual.before + 1, JSON.stringify(manual));

  /* ================================================================== *
   * FAILURE SCREEN — what the user actually sees when we cannot render
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — FAILURE SCREEN\x1b[0m');
  // A REAL failure, not a poked internal: /r/broken/ serves posts with the required
  // post-title attribute stripped, which is what a Reddit redesign looks like from here.
  // (SHD lives in the content script's isolated world and is unreachable from the page,
  // so reaching in to call gate.fail() is not an option — which is as it should be.)
  await page.goto(origin + PATHS.broken, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('#shd-error'));

  const failScreen = await page.evaluate(() => {
    const box = document.querySelector('#shd-error');
    if (!box) return { present: false };
    const r = box.getBoundingClientRect();
    const app = document.querySelector('shreddit-app');
    const btn = box.querySelector('button.shd-error-primary');
    const br = btn.getBoundingClientRect();
    return {
      present: true,
      painted: box.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      coversViewport: r.width >= innerWidth - 1 && r.height >= innerHeight - 1,
      // the failure text must be readable, not clipped to nothing
      textHeight: Math.round(box.querySelector('.shd-error-what').getBoundingClientRect().height),
      // native Reddit must NOT be showing through
      nativePainted: app.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      // the escape hatch must be clickable, not covered
      buttonHit: (() => {
        const el = document.elementFromPoint((br.left + br.right) / 2, (br.top + br.bottom) / 2);
        return el === btn || btn.contains(el);
      })(),
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ourLayoutGone: !document.querySelector('#shd-root')
    };
  });

  check('an unrenderable page produces a visible failure screen, not a blank page',
    failScreen.present && failScreen.painted && failScreen.textHeight > 0,
    JSON.stringify(failScreen));
  check('the failure is detected without being told — real markup, real deadline',
    await page.evaluate(() => document.documentElement.getAttribute('data-shd-fail')) === 'render-failed',
    await page.evaluate(() => document.documentElement.getAttribute('data-shd-fail')));
  check('the failure screen owns the viewport', failScreen.coversViewport);
  check('native Reddit is NOT silently restored behind it', !failScreen.nativePainted);
  check('our half-built layout is gone', failScreen.ourLayoutGone);
  check('the escape-hatch button is actually clickable', failScreen.buttonHit);
  check('the failure screen does not overflow horizontally',
    failScreen.hOverflow <= 0, `+${failScreen.hOverflow}px`);

  await page.click('#shd-error button.shd-error-primary');
  await until(page, () => !document.querySelector('#shd-error'));
  const afterRelease = await page.evaluate(() => ({
    errorGone: !document.querySelector('#shd-error'),
    nativePainted: document.querySelector('shreddit-app')
      .checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    released: document.documentElement.getAttribute('data-shd-released')
  }));
  check('pressing the escape hatch hands the page back to Reddit',
    afterRelease.errorGone && afterRelease.nativePainted && afterRelease.released === 'user-request',
    JSON.stringify(afterRelease));

  // Narrow viewport: the screen has to stay usable on a phone.
  await page.setViewport({ width: 360, height: 720 });
  await page.goto(origin + PATHS.broken, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('#shd-error .shd-error-box'));
  const narrow = await page.evaluate(() => {
    const box = document.querySelector('#shd-error .shd-error-box');
    if (!box) return { missing: true };
    return {
      fits: box.getBoundingClientRect().right <= innerWidth + 0.5,
      hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      namesTheFile: /contracts\.js/.test(box.textContent),
      buttonsStacked: [...document.querySelectorAll('#shd-error button')]
        .every(b => b.getBoundingClientRect().right <= innerWidth + 0.5)
    };
  });
  check('the failure screen fits a 360px viewport',
    !narrow.missing && narrow.fits && narrow.hOverflow <= 0 && narrow.buttonsStacked,
    JSON.stringify(narrow));
  check('it still names the file to edit at narrow widths', narrow.namesTheFile);
  await page.setViewport({ width: 1280, height: 900 });

  /* ================================================================== *
   * COMMENT PAGINATION — the same world boundary, the main content
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — COMMENT PAGINATION\x1b[0m');
  // Comment threads lazy-load exactly like feeds, and the partial is the same page-defined
  // custom element — so this needs the main-world bridge too. It also needs a sentinel on
  // comment pages, which pipeline.js did not attach. Before both, a thread showed only the
  // slice Reddit put in the initial HTML.
  await page.goto(origin + PATHS.commentPager, { waitUntil: 'domcontentloaded' });
  await until(page, () => !!document.querySelector('#shd-root .thing.comment'));

  const threadState = () => page.evaluate(() => {
    const all = [...document.querySelectorAll('#shd-root .thing.comment')];
    return {
      loads: (window.__shdCommentPager || {}).loads || 0,
      rendered: all.length,
      unique: new Set(all.map(c => c.dataset.fullname)).size,
      sources: document.querySelectorAll('shreddit-comment').length,
      declared: Number(document.querySelector('shreddit-comment-tree')?.getAttribute('totalcomments') || 0),
      sentinel: document.querySelectorAll('.shd-sentinel').length,
      nestingOk: all.every(c => {
        let actual = 0, n = c.parentElement;
        while (n) { if (n.classList && n.classList.contains('comment')) actual++; n = n.parentElement; }
        return Number(c.dataset.depth) === actual;
      })
    };
  });

  const t0 = await threadState();
  // On a short page the sentinel is already inside the trigger margin, so a load may have
  // fired before this first look. Assert the invariant instead of a fixed baseline:
  // whatever the load count, rendered == the delivered slice + loads * batch.
  check('the thread really is truncated (more declared than delivered up front)',
    t0.declared > COMMENT_SLICE, `declared ${t0.declared}, slice ${COMMENT_SLICE}`);
  check('rendered count matches the slice plus whatever has loaded',
    t0.rendered === COMMENT_SLICE + t0.loads * COMMENT_PAGER_BATCH, JSON.stringify(t0));
  check('a comments page gets a pagination sentinel', t0.sentinel === 1, String(t0.sentinel));

  // Drive it the way a reader does.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(1100);
  }
  const t1 = await threadState();

  check('scrolling a thread loads more comments (bridge + sentinel on COMMENTS)',
    t1.loads > 0 && t1.rendered > t0.rendered,
    `loads=${t1.loads}, rendered ${t0.rendered} -> ${t1.rendered} ` +
    `(0 loads = the comment partial is not being driven)`);
  check('every delivered comment becomes exactly one node',
    t1.rendered === t1.sources, `${t1.rendered} rendered for ${t1.sources} sources`);
  check('comment pagination never duplicates a node',
    t1.rendered === t1.unique, `${t1.rendered} rendered, ${t1.unique} unique`);
  check('late batches still nest against the existing depth stack', t1.nestingOk);
  check(`each load adds a full batch of ${COMMENT_PAGER_BATCH}`,
    t1.rendered === COMMENT_SLICE + t1.loads * COMMENT_PAGER_BATCH,
    `${t1.rendered} rendered after ${t1.loads} loads (expected ` +
    `${COMMENT_SLICE} + ${t1.loads}x${COMMENT_PAGER_BATCH})`);
  check('still exactly one sentinel', t1.sentinel === 1, String(t1.sentinel));

  /* ================================================================== *
   * BRANCH PARTIALS — the shape the live thread actually had
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — PARTIALS THAT SURVIVE BEING DRIVEN\x1b[0m');
  // verify:live found ten partials in one comment tree, none loading="programmatic", beside
  // controls reading "16 more replies" — one partial per truncated branch, not one per page.
  // If such a partial fills its branch in place instead of replacing itself, re-querying the
  // selector returns the same element for ever and the rest of the thread is unreachable.
  //
  // paginator.js avoids that by stamping partials it has driven — and the stamp is written in
  // the ISOLATED world while the bridge resolves the selector in the MAIN world. That split
  // is where two of this project's silent failures came from, so it gets asserted against the
  // packed extension rather than only in jsdom.
  {
    const page3 = await browser.newPage();
    await page3.setViewport({ width: 1100, height: 900 });
    await page3.goto(origin + PATHS.commentBranches, { waitUntil: 'domcontentloaded' });
    await until(page3, () => !!document.querySelector('#shd-root .thing.comment'));

    for (let i = 0; i < 5; i++) {
      await page3.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await settle(1100);
    }

    const b = await page3.evaluate(() => {
      const st = window.__shdBranchPager || { loads: 0, driven: [] };
      const all = [...document.querySelectorAll('#shd-root .thing.comment')];
      return {
        loads: st.loads,
        driven: st.driven,
        uniqueDriven: new Set(st.driven).size,
        partials: document.querySelectorAll('shreddit-comment-tree faceplate-partial').length,
        stamped: document.querySelectorAll(
          'shreddit-comment-tree faceplate-partial[data-shd="done"]').length,
        rendered: all.length,
        unique: new Set(all.map(c => c.dataset.fullname)).size,
        sources: document.querySelectorAll('shreddit-comment').length
      };
    });

    check('a surviving partial is driven through the real bridge', b.loads > 0,
      `loads=${b.loads} — the fallback selector clause is not reaching a non-programmatic partial`);
    check('the partials are all still in the DOM (the fixture models survival)',
      b.partials === BRANCH_PAGER_BRANCHES, `${b.partials} partials`);
    check('every branch was driven, none of them twice',
      b.uniqueDriven === b.loads && b.loads === BRANCH_PAGER_BRANCHES,
      `drove ${JSON.stringify(b.driven)} — a repeat means the isolated-world stamp is not ` +
      `visible to the main-world bridge, so the paginator is spinning on one branch`);
    check('the driven partials carry the stamp across the world boundary',
      b.stamped === BRANCH_PAGER_BRANCHES, `${b.stamped} of ${BRANCH_PAGER_BRANCHES} stamped`);
    check('every reply that arrived is rendered exactly once',
      b.rendered === b.sources && b.rendered === b.unique,
      `${b.rendered} rendered, ${b.sources} sources, ${b.unique} unique`);
    await page3.close();
  }

  /* ================================================================== *
   * REDDIT'S OWN MODALS — the real 18+ shape
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — THE AGE GATE IS ANSWERED, NOT SHOWN\x1b[0m');
  // POLICY (project decision, 2026-08-20): a popup never takes the layout, and the 18+ gate —
  // alone among modals — is ANSWERED, by clicking Reddit's own affirmative button. That is
  // strictly better than hiding it: Reddit clears its own lock, remembers the answer, and
  // pagination serves an attested session. The wrong button navigates away, so the click
  // fires only on one confident match; the strange-gate page below is the fail-safe path.
  {
    const page4 = await browser.newPage();
    await page4.setViewport({ width: 1200, height: 900 });
    await page4.goto(origin + PATHS.gateModal, { waitUntil: 'domcontentloaded' });
    await until(page4, () => !!document.querySelector('#shd-root .thing.link'));

    // The gate's own click handler removes it — waiting for that IS the assertion that we
    // pressed a button at all.
    const answered = await until(page4, () => !document.querySelector('shd-fake-gate'), { timeout: 4000 });
    const st = await page4.evaluate(() => ({
      answer: document.documentElement.dataset.shdGateAnswer || null,
      active: document.documentElement.classList.contains('shd-active'),
      rows: document.querySelectorAll('#shd-root .thing.link').length,
      lockClass: document.body.classList.contains('rpl-scroll-lock'),
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      stampLeft: !!document.querySelector('[data-shd-answered]')
    }));

    check('the gate is answered and gone', answered === true, 'shd-fake-gate still present');
    check('and it was the AFFIRMATIVE button — the other one navigates away',
      st.answer === 'yes', `gate recorded answer=${JSON.stringify(st.answer)}`);
    check('the layout never left while it happened', st.active === true && st.rows > 0);
    check('the lock is gone with the gate', st.lockClass === false);
    await page4.close();
  }
  {
    // The FAIL-SAFE: a gate whose buttons the matcher cannot confidently place — including
    // a decline whose text contains "18", the exact trap recorded on C.AGE_GATE. Correct
    // behaviour is to click NOTHING and fall back to suppression: gate hidden, lock
    // stripped, and the page still scrollable via the CSS overflow backstop (this page is
    // what keeps that backstop under test, since the answered gate clears its own styles).
    const pageS = await browser.newPage();
    await pageS.setViewport({ width: 1200, height: 900 });
    await pageS.goto(origin + PATHS.gateModalStrange, { waitUntil: 'domcontentloaded' });
    await until(pageS, () => !!document.querySelector('#shd-root .thing.link'));
    await settle(1200);

    const st = await pageS.evaluate(() => {
      const gate = document.querySelector('shd-fake-gate');
      const vis = (el) => el ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : null;
      return {
        answer: document.documentElement.dataset.shdGateAnswer || null,
        gateInDom: !!gate,
        gateVisible: vis(gate),
        active: document.documentElement.classList.contains('shd-active'),
        lockClass: document.body.classList.contains('rpl-scroll-lock'),
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        inlineOverflow: document.body.style.overflow
      };
    });

    check('an unmatchable gate is NOT clicked — neither button, ever',
      st.answer === null, `answer=${JSON.stringify(st.answer)} — a wrong click navigates away`);
    check('it falls back to suppression: hidden, not deleted',
      st.gateInDom === true && st.gateVisible === false && st.active === true, JSON.stringify(st));
    check('its scroll lock class is stripped', st.lockClass === false);
    check('and the INLINE overflow lock is overridden by the CSS backstop',
      st.inlineOverflow === 'hidden' && st.bodyOverflowY !== 'hidden',
      `inline=${JSON.stringify(st.inlineOverflow)} computed=${st.bodyOverflowY}`);
    await pageS.close();
  }

  /* ================================================================== *
   * PAGINATOR DIAGNOSTICS — the isolated world's only channel out
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — PAGINATOR DIAGNOSTICS\x1b[0m');
  // A live stall could not be diagnosed because every candidate explanation predicts the
  // same DOM, and `SHD` is unreachable from a page-world console. The sentinel now carries
  // the paginator's state as data attributes. Asserted here because a diagnostic that
  // quietly stops publishing is worse than none — it makes the next stall report confidently
  // wrong rather than merely inconclusive.
  {
    const pageD = await browser.newPage();
    await pageD.setViewport({ width: 1280, height: 2000 });
    await pageD.goto(origin + PATHS.pager, { waitUntil: 'domcontentloaded' });
    await until(pageD, () => !!document.querySelector('.shd-sentinel'));
    await settle(1500);   // let at least one load happen

    const d = await pageD.evaluate(() => ({ ...document.querySelector('.shd-sentinel').dataset }));
    check('the sentinel publishes paginator state to the page world',
      d.shdVisible !== undefined && d.shdPages !== undefined && d.shdRefusal !== undefined,
      JSON.stringify(d));
    check('the published state is live, not a placeholder',
      Number(d.shdPages) > 0 && d.shdAuto === 'true' && d.shdObserving === 'true',
      JSON.stringify(d));
    check('a refusal reason is always present', typeof d.shdRefusal === 'string' && d.shdRefusal.length > 0,
      d.shdRefusal);
    check('the freshness probe agrees with the selector loadNext uses',
      d.shdFresh === 'true' || d.shdFresh === 'false', d.shdFresh);
    check('both answers to "is the list near the viewport" are published',
      d.shdInRange !== undefined && d.shdTop !== undefined && d.shdIoTicks !== undefined,
      JSON.stringify(d));
    check('the sentinel says which sentinel it is, so a stale read is detectable',
      Number(d.shdSerial) > 0, d.shdSerial);
    await pageD.close();
  }

  /* ================================================================== *
   * GEOMETRY IS WHAT GATES PAGINATION
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — GEOMETRY GATES PAGINATION\x1b[0m');
  // The counterweight to "keep loading when the observer goes quiet". Driving ourselves from
  // geometry rather than from the observer's last word must not become driving for ever: a
  // reader who scrolls back to the top of a long feed should stop pulling pages. Written as
  // two assertions because the second is vacuous without the first — if the page is not
  // actually tall enough to put the sentinel outside the 1200px trigger margin, "it stopped"
  // is true for no reason at all, so that failure has to be loud rather than silent.
  {
    const pageG = await browser.newPage();
    await pageG.setViewport({ width: 1000, height: 400 });
    await pageG.goto(origin + PATHS.pager, { waitUntil: 'domcontentloaded' });
    await until(pageG, () => !!document.querySelector('.shd-loadmore'));

    // Manual clicks skip the cooldown, so this builds a tall page far faster than a
    // cooldown-respecting auto chain would. A click during a load is refused, though, so
    // this polls for the count to move rather than assuming every click lands.
    await pageG.evaluate(async () => {
      const deadline = Date.now() + 15000;
      while (window.__shdPager.loads < 10 && Date.now() < deadline) {
        document.querySelector('.shd-loadmore')?.click();
        await new Promise(r => setTimeout(r, 120));
      }
    });
    await settle(1200);
    // Start the AUTO chain before scrolling away, or "it stopped" is true because nothing
    // was running: a manual click loads a page but never pumps, so without this the check
    // below passes with the geometry gate torn out entirely. Measured — it did.
    await pageG.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(2000);           // two cooldowns with the sentinel in view: the chain is live
    const running = await pageG.evaluate(() => window.__shdPager.loads);

    await pageG.evaluate(() => window.scrollTo(0, 0));
    await settle(1200);           // past a cooldown, so a live chain would have fired

    const far = await pageG.evaluate(() => {
      const s = document.querySelector('.shd-sentinel');
      const r = s.getBoundingClientRect();
      return {
        top: Math.round(r.top), h: innerHeight, margin: 1200,
        beyond: r.top - (innerHeight + 1200),
        inRange: s.dataset.shdInRange, loads: window.__shdPager.loads
      };
    });
    check('the auto chain was running before we scrolled away',
      far.loads > running - 1 && running > 0,
      `${running} loads when the sentinel was in view (0 = nothing to stop)`);
    check('the page really is tall enough to put the sentinel out of range',
      far.beyond > 0, JSON.stringify(far) + '  (if this fails the next check proves nothing)');
    check('...and the paginator agrees it is out of range', far.inRange === 'false',
      JSON.stringify(far));

    await settle(1600);           // two more cooldowns at the top of the page
    const still = await pageG.evaluate(() => window.__shdPager.loads);
    check('a feed scrolled back to the top stops pulling pages',
      still === far.loads, `${far.loads} -> ${still}`);
    await pageG.close();
  }

  /* ================================================================== *
   * SORT TABS THROUGH THE REAL NAVIGATION API
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — SORT TABS THROUGH THE REAL NAVIGATION API\x1b[0m');
  // The one path jsdom cannot exercise. Chrome's `navigate` event is PRE-COMMIT, and the
  // /r/spa/ fixture's page-world router does what live Reddit was measured to do: report
  // destination.sameDocument === false, intercept() anyway, and swap the feed ~120ms after
  // the commit. Before the route.js fix, the first click was swallowed outright (URL moved,
  // content stayed, new rows appended under stale ones) and every later click was handled
  // one navigation late — reproduced live, click by click. docs/engineering-log.md bug 34.
  {
    const pageS = await browser.newPage();
    await pageS.setViewport({ width: 1280, height: 900 });
    await pageS.goto(origin + PATHS.spa, { waitUntil: 'domcontentloaded' });
    await until(pageS, () => !!document.querySelector('#shd-root .thing.link'));
    const before = await pageS.evaluate(() =>
      document.querySelectorAll('#shd-root .thing.link').length);
    check('the spa fixture renders like any listing', before === POSTS.length, String(before));

    const state = () => pageS.evaluate(() => ({
      path: location.pathname,
      swaps: window.__spaSwaps,
      rows: document.querySelectorAll('#shd-root .thing.link').length,
      titles: [...document.querySelectorAll('#shd-root .thing.link a.title')]
        .map(a => a.textContent),
      selected: document.querySelector('#shd-root .tabmenu li.selected a')?.textContent,
      roots: document.querySelectorAll('#shd-root').length
    }));

    // Click OUR sort tab, exactly as a reader does.
    await pageS.click('#shd-root .tabmenu a[href="/r/spa/new/"]');
    await until(pageS, () =>
      location.pathname === '/r/spa/new/' &&
      document.querySelectorAll('#shd-root .thing.link').length === 5);
    const s1 = await state();
    check('first click: URL and content BOTH moved to the new sort',
      s1.path === '/r/spa/new/' && s1.rows === 5 &&
      s1.titles.every(t => /^new post/.test(t)),
      JSON.stringify(s1));
    // The tester's metric, and the reason it matters: splicing is invisible above the
    // fold. A run that only counts rows sails past "28 rows, 25 unique" — the stale sort
    // spliced under the new one — because the top of the list looks perfectly correct.
    check('first click: no duplicate rows (total === unique)',
      s1.rows === new Set(s1.titles).size,
      `${s1.rows} rows, ${new Set(s1.titles).size} unique`);
    check('no stale rows from the outgoing sort survive', 
      !s1.titles.some(t => !/^new post/.test(t)), s1.titles.join(' | '));
    check('the active tab highlight agrees with the render', s1.selected === 'new', s1.selected);

    // The second hop is the one that caught the phase error live: the broken version
    // handled THIS click using the PREVIOUS click's destination.
    await pageS.click('#shd-root .tabmenu a[href="/r/spa/top/"]');
    await until(pageS, () =>
      location.pathname === '/r/spa/top/' &&
      document.querySelectorAll('#shd-root .thing.link').length === 5 &&
      [...document.querySelectorAll('#shd-root .thing.link a.title')]
        .every(a => /^top post/.test(a.textContent)));
    const s2 = await state();
    check('second click: no one-navigation phase error',
      s2.path === '/r/spa/top/' && s2.rows === 5 &&
      s2.titles.every(t => /^top post/.test(t)),
      JSON.stringify(s2));
    check('second click: still no duplicates',
      s2.rows === new Set(s2.titles).size,
      `${s2.rows} rows, ${new Set(s2.titles).size} unique`);
    check('both swaps actually ran in the page world', s2.swaps === 2, String(s2.swaps));
    check('still exactly one root across the whole sequence', s2.roots === 1, String(s2.roots));

    /* -------- history traversals: Reddit restores the SAME nodes, stamps and all --------
       Live testing, on a verified build: every back/forward landed on the error card,
       9/9 — sources 3, stamped 3, rendered 0. Sort clicks replace post elements, but a
       traversal re-inserts the nodes it removed, data-shd stamps included, and the sweep
       skipped every one of them as already-rendered. The fixture's cache reproduces the
       reuse; these are the round-trips that failed live. */
    await pageS.goBack();
    await until(pageS, () =>
      location.pathname === '/r/spa/new/' &&
      document.querySelectorAll('#shd-root .thing.link').length === 5, { timeout: 5000 });
    const b1 = await state();
    check('back: the restored (stamped) nodes render again',
      b1.path === '/r/spa/new/' && b1.rows === 5 && b1.titles.every(t => /^new post/.test(t)),
      JSON.stringify(b1));
    check('back: no error card, layout active', await pageS.evaluate(() =>
      !document.querySelector('#shd-error') &&
      !document.documentElement.hasAttribute('data-shd-fail') &&
      document.documentElement.classList.contains('shd-active')));
    // The reused elements really are the cached ones (re-stamped by the re-render), not
    // fresh copies — otherwise this proves nothing about the stale-stamp path.
    check('back: the page-world cache was used, not a rebuild', await pageS.evaluate(() =>
      window.__spaSwaps === 3));

    await pageS.goBack();
    await until(pageS, () =>
      location.pathname === '/r/spa/' &&
      document.querySelectorAll('#shd-root .thing.link').length > 0, { timeout: 5000 });
    const b2 = await state();
    check('back to the original listing: the first page renders again',
      b2.path === '/r/spa/' && b2.rows > 0 && !b2.titles.some(t => /^(new|top) post/.test(t)),
      JSON.stringify(b2));

    await pageS.goForward();
    await until(pageS, () =>
      location.pathname === '/r/spa/new/' &&
      document.querySelectorAll('#shd-root .thing.link').length === 5, { timeout: 5000 });
    const f1 = await state();
    check('forward: the same nodes survive a third insertion',
      f1.path === '/r/spa/new/' && f1.rows === 5 && f1.titles.every(t => /^new post/.test(t)) &&
      f1.rows === new Set(f1.titles).size,
      JSON.stringify(f1));
    await pageS.close();
  }

  /* ================================================================== *
   * SELF-DISMISSING OVERLAYS — must not swap the layout at all
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — A TRANSIENT LOCK NEVER SWAPS THE LAYOUT\x1b[0m');
  // Reported from real use: "I periodically get thrown back to the regular layout to view some
  // interstitial popup, and after a few seconds it reverts without intervention." Reddit sets
  // rpl-scroll-lock for every overlay it raises, including ones that dismiss themselves. The
  // old defer machinery debounced its way around this; the suppression policy makes the
  // stronger promise this section now asserts — the layout never leaves AT ALL.
  {
    const page6 = await browser.newPage();
    await page6.setViewport({ width: 1200, height: 900 });
    await page6.goto(origin + PATHS.modalTransient, { waitUntil: 'domcontentloaded' });
    await until(page6, () => !!document.querySelector('#shd-root .thing.link'));
    const rowsBefore = await page6.evaluate(() =>
      document.querySelectorAll('#shd-root .thing.link').length);

    // The fixture locks at 400ms and clears at 600ms. Wait well past both.
    await settle(2000);

    const t = await page6.evaluate(() => ({
      // Counted by a page-world observer on <html> class mutations, so a swap cannot slip
      // through between polls: the count is every time .shd-active went away after being on.
      swapSeen: window.__shdSwapSeen,
      lockCleared: !document.body.classList.contains('rpl-scroll-lock'),
      active: document.documentElement.classList.contains('shd-active'),
      rows: document.querySelectorAll('#shd-root .thing.link').length
    }));

    check('the fixture really did set and clear the lock', t.lockCleared === true);
    check('a self-dismissing overlay never swaps the layout, not even briefly',
      t.swapSeen === 0,
      `.shd-active was dropped ${t.swapSeen} time(s) — this is the reported bug: the reader ` +
      `is thrown out to native Reddit and handed the layout back seconds later`);
    check('we end where we started, still active', t.active === true);
    check('with every row intact', t.rows === rowsBefore, `${rowsBefore} -> ${t.rows}`);
    await page6.close();
  }

  /* ================================================================== *
   * THE LOGIN UPSELL — the one modal we do NOT defer to
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — SUPPRESSING THE LOGIN UPSELL\x1b[0m');
  // Captured live: desktop_auth_blocking_upsell, a login/signup wall that fires ~30s after
  // load with no interaction, sets the same rpl-scroll-lock class the age gate does, but has
  // no close control and does not respond to Escape or its own overlay. The default
  // stand-aside policy above would trap a logged-out reader behind it. See the long comment
  // on C.NATIVE_UPSELL in contracts.js for the full recon.
  // Both delivery orderings. The fixture inserts on a delayed timer either way, matching how
  // the real page ships this (an async partial fetch ~30s in) rather than in the initial HTML
  // — the only way to exercise the MutationObserver paths instead of gate.js's synchronous
  // first check. `lock-first` additionally covers the case where the scroll lock lands before
  // the elements exist, so we defer and then have to recover.
  for (const [label, fixturePath] of [
    ['elements first, then the scroll lock', PATHS.gateUpsell],
    ['scroll lock first, elements a tick later', PATHS.gateUpsellLockFirst]
  ]) {
    const page5 = await browser.newPage();
    await page5.setViewport({ width: 1200, height: 900 });
    await page5.goto(origin + fixturePath, { waitUntil: 'domcontentloaded' });
    await until(page5, () => !!document.querySelector('#shd-root .thing.link'));
    const before = await page5.evaluate(() => document.querySelectorAll('#shd-root .thing.link').length);

    await until(page5, () =>
      !document.querySelector('desktop-dynamic-upsell-modal') &&
      !document.getElementById('desktop-dynamic-upsell-dialog') &&
      document.readyState === 'complete', { timeout: 5000 });
    // A generous settle: prove it STAYS gone and that we END un-deferred, rather than passing
    // on a lucky sample midway through the fixture's own two-step insertion.
    await settle(1000);

    const s = await page5.evaluate(() => ({
      dialogPresent: !!document.getElementById('desktop-dynamic-upsell-dialog'),
      hostPresent: !!document.querySelector('desktop-dynamic-upsell-modal'),
      scrollLocked: document.body.classList.contains('rpl-scroll-lock'),
      deferred: document.documentElement.getAttribute('data-shd-deferred'),
      active: document.documentElement.classList.contains('shd-active'),
      rows: document.querySelectorAll('#shd-root .thing.link').length
    }));

    check(`[${label}] the portaled dialog is removed, not merely hidden`, s.dialogPresent === false);
    check(`[${label}] the host element is removed too`, s.hostPresent === false,
      'hiding the host alone was confirmed live to do nothing — the portal is what renders');
    check(`[${label}] body scroll lock is cleared`, s.scrollLocked === false);
    // The load-bearing one for lock-first: we may defer momentarily, but we must not be
    // stranded there once the wall is gone.
    check(`[${label}] we do not end up deferred to a wall we deleted`,
      s.deferred === null, `data-shd-deferred=${JSON.stringify(s.deferred)}`);
    check(`[${label}] our layout is up, with every row intact`,
      s.active === true && s.rows === before, `active=${s.active}, rows ${before} -> ${s.rows}`);
    await page5.close();
  }

  /* ================================================================== *
   * PAGES WITH NOTHING TO RENDER — the common logged-out case
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — AGE GATE / NO FEED\x1b[0m');
  // Age gates, private communities and rate-limit pages are routine when logged out, and
  // they classify as LISTING because the URL looks like one. The pre-render blackout used
  // to stay up for the full patience window and then put an error screen over the button
  // the user needed to press. Measured: twelve seconds of white.
  {
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1100, height: 700 });
    const started = Date.now();
    await page2.goto(origin + PATHS.gated, { waitUntil: 'domcontentloaded' });

    // Poll for the moment the page becomes readable.
    let visibleAt = null;
    for (let i = 0; i < 60 && visibleAt === null; i++) {
      const ok = await page2.evaluate(() =>
        document.querySelector('shreddit-app')
          .checkVisibility({ opacityProperty: true, visibilityProperty: true }));
      if (ok) visibleAt = Date.now() - started;
      else await settle(100);
    }
    // Measured at 25-52ms via the `load` listener. The threshold sits well under
    // gate.js's 1500ms first tick on purpose: at 2500ms this passed even when the fast
    // path was removed and the page only cleared on the fallback deadline, which is
    // exactly the regression it is meant to catch.
    check('the age gate clears before the deadline tick, not because of it',
      visibleAt !== null && visibleAt < 800,
      visibleAt === null ? 'never became visible'
        : `${visibleAt}ms — expected well under gate.js's 1500ms first check`);

    await until(page2, () =>
      document.documentElement.getAttribute('data-shd-waiting') === 'no-feed-container');
    const gated = await page2.evaluate(() => ({
      error: !!document.querySelector('#shd-error'),
      root: !!document.querySelector('#shd-root'),
      waiting: document.documentElement.getAttribute('data-shd-waiting'),
      buttonClickable: (() => {
        const b = document.querySelector('#through');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return el === b;
      })()
    }));
    check('no error screen over a page that is not broken',
      !gated.error && !gated.root, JSON.stringify(gated));
    check('the reason is recorded', gated.waiting === 'no-feed-container', gated.waiting);
    // The whole point: an error screen here would physically block the age gate.
    check('the user can actually click through the gate', gated.buttonClickable);
    await page2.close();
  }

  console.log('\n\x1b[1mPACKED EXTENSION — AGE GATE THAT SHIPS AN EMPTY FEED\x1b[0m');
  // The same interstitial, but carrying <shreddit-feed></shreddit-feed>. gate.js used to
  // split on "is there a feed container" alone, which read that as "Reddit gave us somewhere
  // to put posts and we rendered none" — the redesign signature. Measured before the fix:
  // the page NEVER un-blanked and #shd-error landed on top of the "Yes, I am over 18"
  // button. Bug 21 by a second route.
  //
  // Nobody has yet looked at a real one, so both shapes are fixtures. This one also covers a
  // case that needs no interstitial at all: a subreddit with no posts in it, which the
  // no-feed branch already claimed in its own comment to handle and did not.
  {
    const page3 = await browser.newPage();
    await page3.setViewport({ width: 1100, height: 700 });
    const started = Date.now();
    await page3.goto(origin + PATHS.gatedFeed, { waitUntil: 'domcontentloaded' });

    let visibleAt = null;
    for (let i = 0; i < 60 && visibleAt === null; i++) {
      const ok = await page3.evaluate(() =>
        document.querySelector('shreddit-app')
          .checkVisibility({ opacityProperty: true, visibilityProperty: true }));
      if (ok) visibleAt = Date.now() - started;
      else await settle(100);
    }
    // Measured at ~128ms via the `load` listener; NEVER before the fix. The threshold sits
    // under gate.js's 1500ms first tick for the same reason its sibling above does: at 2000ms
    // this passed even when the fast path was reverted and the page only cleared on the
    // fallback deadline — which is precisely the regression it exists to catch.
    check('an empty feed does not blank the page (measured: never, before the fix)',
      visibleAt !== null && visibleAt < 800,
      visibleAt === null ? 'never became visible — the empty-feed branch is gone'
        : `${visibleAt}ms — expected well under gate.js's 1500ms first check`);

    await until(page3, () =>
      document.documentElement.getAttribute('data-shd-waiting') === 'empty-feed');
    const empty = await page3.evaluate(() => ({
      error: !!document.querySelector('#shd-error'),
      waiting: document.documentElement.getAttribute('data-shd-waiting'),
      feedPresent: !!document.querySelector('shreddit-feed'),
      buttonClickable: (() => {
        const b = document.querySelector('#through');
        if (!b) return false;
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return el === b;
      })()
    }));
    check('the fixture really does carry a feed container', empty.feedPresent);
    check('an empty feed is reported as empty, not as a failure',
      empty.waiting === 'empty-feed', empty.waiting);
    check('no error screen over an interstitial that merely has a feed shell', !empty.error);
    check('the age-gate button is still clickable', empty.buttonClickable);
    await page3.close();
  }

  console.log('\n\x1b[1mPACKED EXTENSION — A POPULATED FEED STILL FAILS LOUDLY\x1b[0m');
  // The counterweight to the two above. Being lenient about an EMPTY feed must not make us
  // lenient about a feed full of markup we cannot read — that is what a redesign renaming
  // shreddit-post looks like, and failing loudly there is the entire purpose of the deadline.
  //
  // This must NOT use /r/broken/, which was the first mistake here: /r/broken/ still ships
  // <shreddit-post> elements, so sourceCount() is non-zero and the deadline fails on
  // "Reddit sent posts and we rendered none" without ever consulting feedIsPopulated(). The
  // assertion passed while protecting nothing — gutting feedIsPopulated() to `return false`
  // left the suite green. /r/renamed/ renames the element, so sourceCount() is zero and the
  // populated-feed branch is the only thing standing between us and a silent stand-down.
  {
    const page4 = await browser.newPage();
    await page4.setViewport({ width: 1100, height: 700 });
    await page4.goto(origin + PATHS.renamed, { waitUntil: 'domcontentloaded' });
    const seen = await page4.evaluate(() => ({
      sources: document.querySelectorAll('shreddit-post, shreddit-comment').length,
      articles: document.querySelectorAll('shreddit-feed article').length
    }));
    check('the fixture hides the posts from sourceCount() but keeps the feed populated',
      seen.sources === 0 && seen.articles > 0, JSON.stringify(seen));
    const failed = await until(page4, () => !!document.querySelector('#shd-error'), { timeout: 20000 });
    check('a feed with unrenderable content still shows the failure screen', failed,
      'no #shd-error — the empty-feed leniency has swallowed a real redesign');
    const state = await page4.evaluate(() => ({
      waiting: document.documentElement.getAttribute('data-shd-waiting'),
      failedClass: document.documentElement.classList.contains('shd-failed')
    }));
    check('and it is not mistaken for an empty page', state.waiting !== 'empty-feed',
      `data-shd-waiting=${state.waiting}`);
    check('the failure is recorded on <html>', state.failedClass);
    await page4.close();
  }

  /* ================================================================== *
   * SUPPRESSION HIDES FROM EVERYONE, NOT ONLY FROM SIGHTED USERS
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — THE NATIVE TREE IS HIDDEN ACCESSIBLY\x1b[0m');
  // The suppression rule was the textbook "visually hidden" recipe — absolute + 1px + clip
  // + opacity — which is precisely what you write when you WANT screen readers to keep
  // reading something. So the whole native page stayed in the accessibility tree and in
  // find-in-page: every post announced twice, once from our layout and once from Reddit's.
  // Reported from a real session on r/UkraineWarVideoReport, where a page-text extraction
  // returned a native <article> with `u/username • 2 days ago` that is nowhere in our list.
  //
  // Asserted against Chrome's real accessibility tree rather than the computed style,
  // because the computed style is the mechanism and the tree is the thing users get.
  {
    const pageA = await browser.newPage();
    await pageA.goto(origin + PATHS.listing, { waitUntil: 'domcontentloaded' });
    await until(pageA, () => !!document.querySelector('#shd-root .thing.link'));
    await settle(400);

    const title = POSTS[0].title;
    const seen = await pageA.evaluate(() => ({
      ours: [...document.querySelectorAll('#shd-root .thing.link a.title')].map(a => a.textContent),
      nativeText: (document.querySelector('shreddit-post a[slot="full-post-link"]') || {}).textContent,
      nativeVis: getComputedStyle(document.querySelector('shreddit-app')).visibility,
      rootVis: getComputedStyle(document.querySelector('#shd-root')).visibility
    }));
    // Control: the native copy really is present in the DOM and really does carry the same
    // text. Without this the a11y count below could read 1 because the fixture is thin.
    check('the native tree still holds its own copy of the post text',
      seen.nativeText === title, `native: ${JSON.stringify(seen.nativeText)}`);
    check('...and we render that title exactly once ourselves',
      seen.ours.filter(t => t === title).length === 1, JSON.stringify(seen.ours));

    // Count LINKS carrying the title, not every node mentioning it: one rendered anchor
    // contributes both a `link` node and a `StaticText` child, so a raw node count reads 2
    // for a single correctly-rendered row and could never be 1.
    const snap = await pageA.accessibility.snapshot();
    const links = [];
    (function walk(n) { if (!n) return; if (n.role === 'link') links.push(n.name || ''); (n.children || []).forEach(walk); })(snap);
    const hits = links.filter(n => n === title).length;
    check('the post title reaches a screen reader once, not twice',
      hits === 1, `${hits} link(s) named "${title}" in the accessibility tree — 2 = read twice`);
    check('native Reddit is visibility:hidden, which is what removes it from that tree',
      seen.nativeVis === 'hidden', seen.nativeVis);
    check('...and our own layout is not caught by the same rule',
      seen.rootVis === 'visible', seen.rootVis);
    await pageA.close();
  }

  /* ================================================================== *
   * UNHANDLED ROUTES — must be left completely alone
   * ================================================================== */
  console.log('\n\x1b[1mPACKED EXTENSION — UNHANDLED ROUTE\x1b[0m');
  await page.goto(origin + '/search/?q=test', { waitUntil: 'domcontentloaded' });
  await settle(1800);   // deliberate: must outlast gate.js's deadline to prove nothing fires
  const other = await page.evaluate(() => {
    const app = document.querySelector('shreddit-app');
    return {
      root: !!document.querySelector('#shd-root'),
      header: !!document.querySelector('#shd-header'),
      gate: document.documentElement.classList.contains('shd-gate'),
      active: document.documentElement.classList.contains('shd-active'),
      nativeVisible: app.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      bodyVisibility: getComputedStyle(document.body).visibility
    };
  });
  check('mounts nothing on an unhandled route', !other.root && !other.header, JSON.stringify(other));
  check('releases the pre-render blackout', !other.gate && other.bodyVisibility === 'visible');
  check('leaves native Reddit visible and unsuppressed',
    other.nativeVisible && !other.active, JSON.stringify(other));

  check('no page errors across the whole run', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  await server.close();
  report();
})().catch((e) => { console.error(e); process.exit(1); });
