/**
 * harness.js — shared plumbing for the browser-backed tests.
 *
 * Finding a Chromium is the awkward part. This project was originally built on an
 * aarch64 sandbox where no browser could be installed, which is why the layout tests
 * did not exist for so long. So: look everywhere a browser plausibly is — including the
 * ordinary macOS/Linux install locations, which were missing long enough that
 * `npm run verify:live` needed a hand-typed SHEDDIT_CHROME on a Mac with Chrome sitting
 * in /Applications — and if none of them pan out, SKIP loudly rather than fail, because
 * `npm test` must stay usable on a machine without one. Set SHEDDIT_REQUIRE_BROWSER=1
 * (CI) to turn that skip into a failure.
 *
 * A skip that does not say where it looked is a dead end for whoever hits it, so the
 * message lists every candidate path and the two ways to fix it.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { listingPage, commentsPage } = require('./fixtures');

/** How many comments /r/…/pager/ delivers up front, before anything is lazy-loaded. */
const COMMENT_SLICE = 8;

/** How long /slowstream/ holds its closing tags — past the gate's 1500ms tick, with margin. */
const SLOW_STREAM_HOLD_MS = 2600;

/**
 * Where a browser might already be, in the order we prefer them. Ordering rationale:
 * an explicit override always wins; then the CI/sandbox-provisioned builds, so automated
 * runs stay deterministic and reproducible; then whatever the developer already has
 * installed, which is the case that used to fail for no good reason.
 */
const CHROME_CANDIDATES = [
  // macOS — the ordinary developer machine. Omitting these is why `npm run verify:live`
  // needed a hand-typed SHEDDIT_CHROME on a Mac with Chrome sitting in /Applications.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
];

/** @returns {string|null} absolute path to a Chromium binary, or null. */
function resolveChrome() {
  for (const p of searchedPaths()) {
    if (p.explicit) return fs.existsSync(p.path) ? p.path : null;   // an override that is
    if (fs.existsSync(p.path)) return p.path;                       // wrong should not
  }                                                                  // silently fall through
  return null;
}

/**
 * Every location resolveChrome() will try, in order — so a failure can say where it looked
 * instead of just "not found", which tells the reader nothing about how to fix it.
 * @returns {Array<{path: string, why: string, explicit?: boolean}>}
 */
function searchedPaths() {
  const out = [];

  const explicit = process.env.SHEDDIT_CHROME || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit) {
    out.push({ path: explicit, why: 'SHEDDIT_CHROME / PUPPETEER_EXECUTABLE_PATH', explicit: true });
    return out;   // an explicit path is a decision, not a hint — do not look elsewhere
  }

  // Playwright-style install root. Present in many CI images and sandboxes.
  // Prefer chromium-* (the full build) over chromium_headless_shell-*, which cannot load
  // extensions — test/extension.js needs a real one.
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    const dirs = fs.readdirSync(base)
      .filter(d => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        out.push({ path: path.join(base, d, rel), why: 'Playwright browsers dir' });
      }
    }
  }

  // Whatever puppeteer downloaded for itself, if anything.
  try {
    const p = require('puppeteer').executablePath();
    if (p) out.push({ path: p, why: "puppeteer's own download" });
  } catch { /* puppeteer absent or has no browser */ }

  for (const p of CHROME_CANDIDATES) out.push({ path: p, why: 'installed browser' });
  return out;
}

/**
 * Bail out of a browser-backed suite when there is no browser.
 * @returns {string} the resolved executable path (never returns if absent)
 */
function requireChrome(suiteName) {
  const exe = resolveChrome();
  if (exe) return exe;

  const msg = noChromeMessage();
  if (process.env.SHEDDIT_REQUIRE_BROWSER === '1') {
    console.log(`\n\x1b[1m${suiteName}\x1b[0m\n  \x1b[31mFAIL\x1b[0m ${msg} ` +
                `\n  (SHEDDIT_REQUIRE_BROWSER=1 turns this skip into a failure)`);
    process.exit(1);
  }
  console.log(`\n\x1b[1m${suiteName}\x1b[0m\n  \x1b[33mSKIP\x1b[0m ${msg}`);
  process.exit(0);
}

/** "not found" is useless on its own; say what was tried and what would fix it. */
function noChromeMessage() {
  const tried = searchedPaths().map(p => `      ${p.path}  (${p.why})`).join('\n');
  return 'no Chrome or Chromium found. Looked in:\n' + tried +
         '\n\n    Fix it with either:\n' +
         '      npx puppeteer browsers install chrome\n' +
         '      SHEDDIT_CHROME="/path/to/chrome" <the command you just ran>';
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  // Sandboxes often export HTTPS_PROXY; an inherited proxy makes Chrome refuse the
  // loopback navigations these tests rely on (ERR_BLOCKED_BY_CLIENT).
  '--no-proxy-server'
];

/** Pass/fail reporter with the same output shape as the other suites. */
function makeChecker() {
  const state = { passed: 0, failed: 0, failures: [] };
  function check(name, cond, detail) {
    if (cond) {
      state.passed++;
      console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
    } else {
      state.failed++;
      state.failures.push(name);
      console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail != null ? ' — ' + detail : ''}`);
    }
  }
  function report() {
    console.log(`\n\x1b[1m${state.passed} passed, ${state.failed} failed\x1b[0m`);
    if (state.failed) {
      console.log('failures:\n  - ' + state.failures.join('\n  - '));
      process.exit(1);
    }
  }
  return { check, report, state };
}

/**
 * Serve the fixtures over real URLs on loopback.
 *
 * page.setContent() is not usable here: it leaves the document at about:blank, whose
 * pathname is "/blank", so route.js correctly classifies it as OTHER and the extension
 * stands down without rendering anything. The route logic is part of what we are
 * testing, so the paths have to be real.
 *
 * @returns {Promise<{port:number, close:()=>Promise<void>}>}
 */
function serveFixtures() {
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    // /r/pager/ gets a faceplate-partial with a working loadContent(), so the browser
    // suites can drive real infinite scroll across the isolated/main world boundary.
    const wantsPager = /pager/.test(pathname);
    // /branches/ is the shape verify:live actually saw: a partial per truncated branch that
    // does NOT remove itself when driven. A paginator that re-queries its selector picks the
    // same one for ever, so this is the fixture that can tell a working advance from a spin.
    const wantsBranches = /branches/.test(pathname);
    // An image submission, for the browser suites: the picture's box is layout, and layout
    // is the one thing jsdom cannot answer for.
    const wantsImage = /\/image1\//.test(pathname);
    /* An ADULT video submission, for the browser suites. The blur gate puts an absolutely
       positioned button over the player, and "does the control stay inside the box it is
       centred on" is a layout question — the one class of bug css-lint reads one
       declaration at a time and cannot answer. */
    const wantsNsfwVideo = /\/dead1\//.test(pathname);
    // ...and an ADULT image submission, for the same reason: the blur and its button are a
    // box over a box, which is layout.
    const wantsNsfwImage = /\/image1nsfw\//.test(pathname);
    let body = /\/comments\//.test(pathname)
      // A thread that ships a slice and lazy-loads the rest, which is what a real one does.
      ? commentsPage(wantsBranches ? { deliver: COMMENT_SLICE, branchPager: true }
        : wantsImage ? { imagePost: true }
          : wantsNsfwVideo ? { deadLinkPost: true }
            : wantsNsfwImage ? { imagePost: true }
              : wantsPager ? { deliver: COMMENT_SLICE, pager: true } : {})
      : listingPage({ pager: wantsPager });
    // /r/paintprobe/ samples the page's computed state at the EARLIEST moment body
    // content exists — a parser-inserted script right after <body> opens, which runs
    // before anything after it could possibly paint. If the pre-render blackout is not
    // already computed at that instant, the native feed that follows can flash before
    // the extension's CSS lands. This is the only way to put eyes on document_start CSS
    // timing from inside a suite: the flash itself is over before WebDriver returns.
    // The same post, flagged: the fixture is shared with run.js, and the flag is what the
    // blur gate keys on.
    if (wantsNsfwVideo) body = body.replace('post-type="video"', 'post-type="video" nsfw=""');
    if (wantsNsfwImage) body = body.replace('post-type="image"', 'post-type="image" nsfw=""');
    if (/\/r\/paintprobe\//.test(pathname)) {
      body = body.replace('<body>', `<body><script>
        window.__shdPaint = {
          gateClass: document.documentElement.classList.contains('shd-gate'),
          bodyVisibility: getComputedStyle(document.body).visibility,
          htmlBg: getComputedStyle(document.documentElement).backgroundColor
        };
      </script>`);
    }
    // /r/spa/ is a listing whose page-world script does what Reddit's router does: it
    // intercepts sort-tab navigations via the real Navigation API — reporting
    // sameDocument:false and then calling intercept(), exactly the combination measured
    // live — and swaps the feed's contents ~120ms after the commit. This is the only
    // fixture that can exercise route.js's navigate-event path, because jsdom has no
    // `navigation` object and pushState-driven tests dodge the pre-commit trap by
    // accident (pushState commits synchronously before microtasks drain).
    if (/\/r\/spa\//.test(pathname)) {
      body = body.replace('</body>', `<script>
        window.__spaSwaps = 0;
        // Reddit's router REUSES cached DOM on history traversals — measured live in
        // testing, where every back/forward re-inserted the same nodes, data-shd stamps
        // and all, and the extension's sweep skipped every one of them. The cache below
        // models that: outgoing articles are stashed by path at navigate time (pre-commit,
        // so location still names the outgoing page) and a destination we have seen before
        // gets its ORIGINAL nodes back, never fresh ones.
        window.__spaCache = {};
        navigation.addEventListener('navigate', (e) => {
          let dest; try { dest = new URL(e.destination.url); } catch { return; }
          if (!e.canIntercept || dest.origin !== location.origin) return;
          const m = dest.pathname.match(/^\\/r\\/spa\\/(?:([a-z]+)\\/)?$/);
          if (!m) return;
          const sort = m[1] || 'hot';
          const feed0 = document.querySelector('shreddit-feed');
          window.__spaCache[location.pathname] = [...feed0.querySelectorAll('article')];
          e.intercept({ handler: async () => {
            await new Promise(r => setTimeout(r, 120));
            const feed = document.querySelector('shreddit-feed');
            feed.querySelectorAll('article').forEach(el => el.remove());
            const cached = window.__spaCache[dest.pathname];
            if (cached) { cached.forEach(a => feed.appendChild(a)); window.__spaSwaps++; return; }
            for (let i = 0; i < 5; i++) {
              const art = document.createElement('article');
              const p = document.createElement('shreddit-post');
              p.setAttribute('id', 't3_' + sort + i);
              p.setAttribute('post-title', sort + ' post ' + i);
              p.setAttribute('permalink', '/r/spa/comments/' + sort + i + '/x/');
              p.setAttribute('post-type', 'text');
              p.setAttribute('score', '1');
              p.setAttribute('comment-count', '0');
              p.setAttribute('created-timestamp', '2026-08-12T08:00:00.000000+0000');
              p.setAttribute('domain', 'self.spa');
              p.setAttribute('author', 'spa');
              p.setAttribute('subreddit-name', 'spa');
              p.setAttribute('award-count', '0');
              art.appendChild(p);
              feed.appendChild(art);
            }
            window.__spaSwaps++;
          }});
        });
      </script></body>`);
    }
    // /r/broken/ serves posts stripped of a required attribute — what a Reddit redesign
    // looks like from our side. Lets the browser suites drive a REAL render failure
    // instead of reaching in and calling gate.fail(), which a content script's isolated
    // world does not expose to the page anyway.
    if (/broken/.test(pathname)) body = body.replace(/post-title="[^"]*"/g, '');
    // /r/renamed/ is the OTHER redesign shape, and the one that tests gate.js's leniency
    // about empty feeds. /r/broken/ still ships <shreddit-post> elements, so sourceCount()
    // is non-zero and the deadline fails on "we rendered none of them" long before it asks
    // whether the feed is populated. Rename the element and sourceCount() drops to zero
    // while the feed stays full of <article> wrappers — which is exactly what a renamed
    // post element looks like from our side, and must still fail loudly.
    /* /r/empty/ is a subreddit Reddit itself says has no posts — observed live 2026-08-20
       on a quarantined sub, logged out, where Reddit serves zero posts and renders its own
       "this community doesn't have any posts yet" panel INSIDE shreddit-feed. That panel is
       real markup, and the old descendant-count heuristic read it as a populated feed, so
       an empty subreddit got the failure screen (bug 52). The panel here is deliberately
       chunky — heading, paragraph, button, wrapper divs — because a thin one would pass the
       old check too and prove nothing. */
    if (/\/r\/empty\//.test(pathname)) {
      body = body.replace(/<shreddit-feed>[\s\S]*<\/shreddit-feed>/, `<shreddit-feed>
        <!-- The CAPTURED live shape (live testing, r/911truth): one div, children H1/P/A.
             Different from the first guess at this panel, and the round proved the
             structure heuristic classifies the real thing correctly — keep it real. -->
        <div class="mt-[100px] flex justify-center items-center flex-col" id="empty-feed-content">
          <h1 data-testid="no-content">This community doesn't have any posts yet</h1>
          <p>Make one and get this feed started.</p>
          <a href="/r/911truth/submit">Create a post</a>
        </div>
      </shreddit-feed>`);
    }
    if (/renamed/.test(pathname)) {
      body = body.replace(/<shreddit-post(?=[\s>])/g, '<shreddit-postx')
                 .replace(/<\/shreddit-post>/g, '</shreddit-postx>');
    }
    // /r/gated/ is what a logged-out viewer gets for an NSFW or private community: a real
    // page with no feed, no comment tree and no posts anywhere.
    //
    // /r/gated-feed/ is the SAME interstitial but carrying an empty <shreddit-feed>, and the
    // difference is the whole ballgame. gate.js splits on `hasFeedContainer()`: no container
    // means "not our kind of page" (un-blank, stand aside), a container with nothing in it
    // means "Reddit gave us somewhere to put posts and we rendered none" — which blanks the
    // page for MAX_WAIT_MS and then draws the failure screen over whatever is there. On an
    // age gate, "whatever is there" is the button the user has to press (bug 21).
    //
    // Nobody has ever looked at a real one. Both shapes are plausible, so both are fixtures,
    // and the suite records what we actually do with each rather than what we assume.
    // /r/gate-modal/ is what a REAL 18+ subreddit turned out to be (captured 2026-08-14, live,
    // /r/UkraineWarVideoReport/): the feed and its posts are present and populated the whole
    // time, and the age gate is a MODAL OVERLAY portalled to a body-level <div> on top of
    // them. Neither /r/gated/ nor /r/gated-feed/ describes it — both assume the gate replaces
    // the content, and here it merely covers it.
    //
    // Which means gate.js is never consulted: sourceCount() > 0, so we render the posts and
    // reveal. And suppress.css hides EVERY body child, so the modal goes with it. The user
    // gets the posts and never sees the age check.
    //
    // The button lives behind a shadow root — 3 buttons were visible to a light-DOM
    // querySelectorAll on the live page and the "Yes, I'm Over 18" control was not among
    // them — so the fixture puts it in one too. A light-DOM-only check for "is there a
    // dialog" would miss it on the real page.
    if (/gate-modal/.test(pathname)) {
      // /strange/ is the same gate with text the affirm matcher cannot place (a locale we
      // never captured) AND an adversarial decline whose text contains "18" — the exact
      // trap in C.AGE_GATE. Correct behaviour is the FAIL-SAFE: click nothing, fall back
      // to suppression (gate hidden, lock stripped, inline overflow overridden by the CSS
      // backstop — this page is what keeps that backstop under test now that the plain
      // gate gets answered and clears its own styles).
      const strange = /strange/.test(pathname);
      // Structure taken from the live capture, not invented:
      //   - the modal is INSIDE shreddit-app (bodyChild reported "shreddit-app" for both the
      //     panel and the button), not a body-level portal
      //   - the panel is `div.dialog-panel` inside a SHADOW root, while the button is
      //     light-DOM — the slot pattern, so the host renders the chrome and projects the
      //     real controls through it
      //   - <body> carries `rpl-scroll-lock` and overflow:hidden only while it is up
      //   - it is NOT role="dialog" / aria-modal, and shreddit-app gets neither aria-hidden
      //     nor inert, so there is no accessibility signal to key on
      body = body.replace('</shreddit-app>', `
        <shd-fake-gate class="rpl-dialog configured-xpromo configured-xpromo-modal">
          ${strange
            ? '<button id="over18">Continuar (18)</button><button id="nope">No, I am under 18</button>'
            : '<button id="over18">Yes, I\'m Over 18</button><button id="nope">No, take me back</button>'}
        </shd-fake-gate>
        </shreddit-app>
        <script>
          class ShdFakeGate extends HTMLElement {
            connectedCallback() {
              const r = this.attachShadow({ mode: 'open' });
              r.innerHTML =
                '<div class="dialog-panel" style="position:fixed;inset:0;z-index:9999;' +
                'background:rgba(0,0,0,.8);display:flex;align-items:center;' +
                'justify-content:center"><div style="background:#fff;padding:24px">' +
                '<slot></slot></div></div>';
              document.body.classList.add('rpl-scroll-lock');
              document.body.style.overflow = 'hidden';
              this.addEventListener('click', (e) => {
                if (e.target.tagName !== 'BUTTON') return;
                // Records WHICH button was pressed — the whole point of answering the gate
                // is that it must be the affirmative, never the one that navigates away.
                document.documentElement.dataset.shdGateAnswer =
                  e.target.id === 'over18' ? 'yes' : 'no';
                document.body.classList.remove('rpl-scroll-lock');
                document.body.style.overflow = '';
                this.remove();
              });
            }
          }
          customElements.define('shd-fake-gate', ShdFakeGate);
        </script>
      `).replace('</shreddit-app>\n        </shreddit-app>', '</shreddit-app>');
    }
    // /r/gate-upsell/ is Reddit's OWN login/signup upsell (`desktop_auth_blocking_upsell`),
    // captured live and NOT the age gate — see the long comment on C.NATIVE_UPSELL in
    // contracts.js for the full recon. Fires client-side ~30s after page load, independent
    // of scroll or interaction, and sets the SAME rpl-scroll-lock class the age gate does —
    // but carries no close control, and neither a real Escape nor clicking its own overlay
    // dismisses it. Standing aside for it (gate.js's default native-modal policy) would trap
    // a logged-out reader behind an unremovable wall, so this one is suppressed outright.
    //
    // Delivered on a DELAYED timer, not present in the initial HTML — matching how the real
    // page actually ships it (an async partial fetch), and the only way to exercise the
    // MutationObserver path rather than the synchronous first-check. Both elements are
    // direct children of shreddit-app, matching the captured shape.
    // /r/modal-transient/ is the bug reported from real use: a Reddit overlay that sets the
    // scroll lock and then DISMISSES ITSELF a moment later. gate.js used to stand aside the
    // instant the lock appeared, so every one of these threw the reader back to native Reddit
    // and handed the layout back seconds later, unprompted. The lock here is held for
    // 200ms and clears itself; the correct behaviour is that nothing happens at all.
    //
    // Asserting "the layout never left" cannot be done by sampling — the window would be
    // short and a poll can land between a swap and its return. So the PAGE records it
    // itself: .shd-active lives on <html> class, which is shared DOM, so a page-world
    // observer sees it even though the extension runs in the isolated world.
    if (/modal-transient/.test(pathname)) {
      body = body.replace('</shreddit-app>', `
        </shreddit-app>
        <script>
          // Counts every time the layout LEAVES (.shd-active observed present, then gone).
          // Policy is that a popup never takes the layout, so the expected count is ZERO —
          // and only a page-world recorder can assert "never, not even for one frame",
          // because a poll can land between a swap and its return.
          window.__shdSwapSeen = 0;
          let had = false;
          new MutationObserver(() => {
            const has = document.documentElement.classList.contains('shd-active');
            if (had && !has) { window.__shdSwapSeen++; had = false; }
            if (has) had = true;
          }).observe(document.documentElement,
                     { attributes: true, attributeFilter: ['class'] });
          setTimeout(() => {
            document.body.classList.add('rpl-scroll-lock');
            setTimeout(() => document.body.classList.remove('rpl-scroll-lock'), 200);
          }, 400);
        </script>
      `);
    }
    // Two orderings, because which one Reddit uses is an assumption and the failure modes
    // differ. `/r/gate-upsell/` appends the elements and THEN sets the scroll lock, which is
    // what the live recon implies. `/r/gate-upsell-lockfirst/` reverses it — the lock lands a
    // tick BEFORE the elements exist, so the class observer fires with nothing to remove
    // and the insertion observer must catch the elements when they arrive. Only the second one exercises the childList observer and the fall-through in
    // syncNativeModal(); with lock-last, the class observer alone is enough and both would
    // pass while the ordering hazard sat there unnoticed.
    if (/gate-upsell/.test(pathname)) {
      const lockFirst = /lockfirst/.test(pathname);
      const insert = `
        const app = document.querySelector('shreddit-app');
        const host = document.createElement('desktop-dynamic-upsell-modal');
        const dialog = document.createElement('div');
        dialog.id = 'desktop-dynamic-upsell-dialog';
        dialog.className = 'rpl-dialog';
        dialog.innerHTML =
          '<div class="dialog-panel"><h1>Join the most real place on the internet</h1>' +
          '<button>Get Started</button><button>I already have an account</button></div>';
        app.append(host, dialog);`;
      const lock = `document.body.classList.add('rpl-scroll-lock');`;
      body = body.replace('</shreddit-app>', `
        <script>
          setTimeout(() => {
            ${lockFirst ? lock : insert}
            ${lockFirst ? `setTimeout(() => { ${insert} }, 150);` : lock}
          }, 300);
        </script>
        </shreddit-app>
      `);
    }
    if (/gated/.test(pathname)) {
      const emptyFeed = /feed/.test(pathname) ? '<shreddit-feed></shreddit-feed>' : '';
      body = `<!DOCTYPE html><html><head><title>reddit</title></head><body>
        <shreddit-app><div><div id="subgrid-container"><div><main id="main-content">
        <div class="interstitial"><h1>You must be 18+ to view this community</h1>
        <button id="through">Yes, I am over 18</button></div>
        ${emptyFeed}
        </main></div></div></div></shreddit-app></body></html>`;
    }
    // Any path containing /slowstream/ is served the way real Reddit serves everything —
    // STREAMED. The document through the feed markup arrives at once; the closing tags
    // are held back SLOW_STREAM_HOLD_MS, so DOMContentLoaded (and with it document_idle,
    // where the pipeline boots) cannot happen until the hold expires. That puts the
    // gate's 1500ms tick BEFORE the pipeline exists, which is the shape every heavy real
    // page has and no all-at-once fixture can reproduce — the fixture law about delivery,
    // applied to the gate. A page-world recorder logs every <html> class transition,
    // because the failure being hunted is a TRANSIENT: the blackout dropping while
    // neither it nor the layout is up is a flash no post-load read can see.
    if (/\/slowstream\//.test(pathname)) {
      body = body.replace('<body>', `<body><script>
        window.__shdGateTrace = [];
        (function () {
          const t0 = performance.now();
          const log = () => {
            const c = document.documentElement.classList;
            window.__shdGateTrace.push({
              t: Math.round(performance.now() - t0),
              gate: c.contains('shd-gate'),
              active: c.contains('shd-active')
            });
          };
          new MutationObserver(log).observe(document.documentElement,
            { attributes: true, attributeFilter: ['class'] });
          log();
        })();
      </script>`);
      const cut = body.lastIndexOf('</body>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write(body.slice(0, cut));
      setTimeout(() => { try { res.end(body.slice(cut)); } catch { /* client gone */ } },
        SLOW_STREAM_HOLD_MS);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise(r => server.close(r))
    }));
  });
}

/** Fixture paths, matching what route.js classifies as LISTING / COMMENTS. */
const PATHS = {
  listing: '/',
  subreddit: '/r/programming/',
  comments: '/r/programming/comments/link1/nasa/',
  imageComments: '/r/aww/comments/image1/a_very_good_dog/',   // an image submission
  nsfwVideoComments: '/r/funny/comments/dead1/expired/',      // an ADULT video submission
  nsfwImageComments: '/r/aww/comments/image1nsfw/a_very_good_dog/',  // an ADULT image submission
  broken: '/r/broken/',         // posts missing a required attribute -> real render failure
  pager: '/r/pager/',           // faceplate-partial with a working loadContent()
  spa: '/r/spa/',               // page-world router intercepts sort navs like live Reddit
  paintProbe: '/r/paintprobe/', // records whether the blackout beat the body's first content
  slowStream: '/r/slowstream/', // a LISTING delivered the way real Reddit delivers: streamed
  slowStreamOther: '/search/slowstream/',  // the same delivery on a route nobody takes
  commentPager: '/r/programming/comments/link1/pager/',   // a thread that lazy-loads
  commentBranches: '/r/programming/comments/link1/branches/',  // per-branch surviving partials
  gated: '/r/gated/',           // age gate: a real page with no feed at all
  gatedFeed: '/r/gated-feed/',  // ...and the same gate carrying an EMPTY shreddit-feed
  gateModal: '/r/gate-modal/',  // the REAL 18+ shape: a modal over a populated feed
  gateModalStrange: '/r/gate-modal-strange/',  // ...whose buttons the affirm matcher cannot place
  gateUpsell: '/r/gate-upsell/', // Reddit's own login upsell — suppressed, not deferred to
  gateUpsellLockFirst: '/r/gate-upsell-lockfirst/',  // ...with the scroll lock set FIRST
  modalTransient: '/r/modal-transient/',  // a lock that clears itself — must NOT swap layouts
  renamed: '/r/renamed/',       // a POPULATED feed whose post element we no longer recognise
  empty: '/r/empty/'            // a subreddit Reddit itself says has no posts
};

module.exports = { resolveChrome, requireChrome, noChromeMessage, makeChecker,
                   serveFixtures, PATHS, COMMENT_SLICE, SLOW_STREAM_HOLD_MS, LAUNCH_ARGS };
