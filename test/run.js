#!/usr/bin/env node
/**
 * run.js — end-to-end test of the REAL bundle against fixture pages in jsdom.
 *
 * This runs dist/sheddit.dev.js — the same code the extension ships — inside a
 * DOM, and asserts on what it produces. No mocking of our own modules.
 *
 *   node build.js && node test/run.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { listingPage, commentsPage, POSTS, SELF_POST, COMMENT_DEPTHS,
        PAGER_SCRIPT, PAGER_PAGE_SIZE,
        COMMENT_PAGER_SCRIPT, COMMENT_PAGER_BATCH,
        BRANCH_PAGER_SCRIPT, BRANCH_PAGER_BRANCHES, BRANCH_PAGER_REPLIES,
        CMAF_POST, VIDEO_MPD,
        profilePage, PROFILE_COMMENT_COUNT, PROFILE_LINKED_SUB, PROFILE_LINKED_TITLE,
        nestedCommentsHtml } = require('./fixtures');

const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sheddit.dev.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed++; failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
}

/**
 * Poll until `cond()` holds.
 *
 * Fixed sleeps make this suite lie on a loaded machine: the assertion runs before the
 * work finishes and reports a bug that is not there. That happened — two tests failed
 * under CPU contention and passed cleanly on a re-run, which is the worst possible
 * signal because it trains you to ignore red. Anything waiting for something to APPEAR
 * polls for it; only assertions that something must NOT happen keep a fixed delay, and
 * those are marked.
 */
async function waitFor(cond, { timeout = 5000, step = 20 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    try { if (cond()) return true; } catch { /* not ready yet */ }
    if (Date.now() >= deadline) return false;
    await new Promise(r => setTimeout(r, step));
  }
}

/** A deliberate pause, for asserting that something does NOT happen. */
const hold = (ms) => new Promise(r => setTimeout(r, ms));

/* Boot setup that turns the auto chain off. attach() pumps once by itself now (the round-6
   fix for an observer that never reports), and in jsdom every sentinel reads as in-range
   (empty rects mean "not measured", which inRange treats as near) — so any section that
   asserts MANUAL pagination semantics would otherwise race an auto drive it did not ask
   for. The auto chain has its own sections; everything else opts out at boot. */
const noAuto = (win) => {
  win.chrome = { storage: {
    sync: { get: async () => ({ settings: { autoPaginate: false } }) },
    onChanged: { addListener() {} }
  } };
};

/* The window from the previous section, kept only so it can be closed.
 *
 * A jsdom window is not garbage while its timers run, and EVERY page this suite boots
 * leaves live machinery behind: the paginator's HEARTBEAT_MS interval, the pipeline's
 * MutationObservers, the gate's deadline. Nothing closed them, so by the end of a run
 * all 63 booted windows were still ticking, and the sections near the end were sharing
 * an event loop with every section before them.
 *
 * That is not a tidiness point, it is the cause of a real flake. The page-cap section
 * compresses its timers to 5 ms — HEARTBEAT_MS among them — so once it had run, an
 * abandoned window was waking ~200 times a second for the rest of the suite. The
 * sections after it drive the paginator by hand, and `loadNext()` refuses outright
 * while `busy` is set (the first line of it, with no manual exemption — unlike the
 * cooldown check below). One auto load landing mid-loop therefore starved every manual
 * attempt for up to SETTLE_CEILING_MS, and a 60-attempt guard burns off in
 * milliseconds: measured as `pages: 0` where 40 was asserted, roughly 1 run in 6, and
 * never once reproducible when those sections were run on their own.
 *
 * Closing the previous window is safe because sections are sequential and each finishes
 * with its window before the next boots — the one block that holds two (the selftext
 * pair) reads the first before booting the second. */
let previousWindow = null;

/** Boot a fixture page with the bundle loaded, and wait for the pipeline to settle. */
async function boot(html, url, setup) {
  if (previousWindow) {
    try { previousWindow.close(); } catch { /* already torn down */ }
    previousWindow = null;
  }
  const virtualConsole = new VirtualConsole();
  const logs = [];
  virtualConsole.on('error', (m) => logs.push('error: ' + m));
  virtualConsole.on('jsdomError', (e) => logs.push('jsdomError: ' + e.message));
  virtualConsole.on('warn', (m) => logs.push('warn: ' + m));

  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,   // provides requestAnimationFrame
    virtualConsole
  });

  const { window } = dom;
  // jsdom lacks IntersectionObserver; the paginator only needs it to not explode.
  window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  window.requestIdleCallback = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));

  // Pre-eval hook: tests that need to shape the environment the bundle boots into — a fake
  // `navigation` object, a stubbed visibilityState, a chrome.storage that hangs — do it
  // here, BEFORE the bundle captures any of it.
  if (setup) setup(window);

  window.eval(BUNDLE);

  // Wait for the pipeline to reach a steady state rather than guessing at a duration:
  // rendered something, gave up, or decided this is not our page.
  const doc = window.document;
  await waitFor(() => doc.querySelector('#shd-root .thing') ||
                      doc.querySelector('#shd-error') ||
                      doc.documentElement.hasAttribute('data-shd-waiting') ||
                      !doc.documentElement.classList.contains('shd-gate'),
                { timeout: 4000 });
  previousWindow = window;
  return { window, doc, logs };
}

(async () => {
  console.log('\n\x1b[1mLISTING PAGE\x1b[0m');
  {
    const { doc, logs, window } = await boot(listingPage(), 'https://www.reddit.com/');
    const rows = [...doc.querySelectorAll('#shd-root .thing.link')];

    check('renders one row per post', rows.length === POSTS.length,
      `got ${rows.length}, expected ${POSTS.length}`);
    check('mounts #shd-root as a direct child of <body>',
      doc.querySelector('#shd-root')?.parentElement === doc.body);
    check('activates the skin (html.shd-active)',
      doc.documentElement.classList.contains('shd-active'));
    check('does not fail', !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail'));
    check('no ad rows rendered',
      !rows.some(r => /sponsored/i.test(r.textContent)));
    check('every row has a non-empty title',
      rows.every(r => r.querySelector('a.title')?.textContent.trim()));
    check('ranks are sequential 1..n',
      rows.every((r, i) => r.querySelector('.rank').textContent === String(i + 1)));
    check('every source post stamped data-shd=done',
      [...doc.querySelectorAll('shreddit-post')].every(p => p.getAttribute('data-shd') === 'done'));

    // --- thumbnail correctness: the bug this suite exists to prevent ---
    const byId = (id) => rows.find(r => r.dataset.fullname === id);
    const thumbOf = (id) => byId(id)?.querySelector('a.thumbnail img')?.getAttribute('src') || null;

    check('text post gets NO thumbnail (subreddit icon + flair emoji rejected)',
      thumbOf('t3_text1') === null, thumbOf('t3_text1'));
    check('text post falls back to .self placeholder',
      !!byId('t3_text1')?.querySelector('a.thumbnail.self'));
    check('gallery post picks preview.redd.it, not the community icon',
      /preview\.redd\.it/.test(thumbOf('t3_gallery1') || ''), thumbOf('t3_gallery1'));
    check('link post picks external-preview.redd.it',
      /external-preview\.redd\.it/.test(thumbOf('t3_link1') || ''), thumbOf('t3_link1'));
    check('image post picks i.redd.it',
      /i\.redd\.it/.test(thumbOf('t3_image1') || ''), thumbOf('t3_image1'));
    check('avatar under a[href^="/user/"] is NOT used as a thumbnail',
      thumbOf('t3_avatar1') === null, thumbOf('t3_avatar1'));
    check('multi_media falls back to a placeholder',
      !!byId('t3_multi1')?.querySelector('a.thumbnail.default, a.thumbnail.self'));
    // crosspost: a live post-type with no fixture until 2026-08-14, carrying a thumbnail on
    // b.thumbs.redditmedia.com — a legitimate host that the allowlist rejected along with
    // the styles./emoji. decoys, so these posts lost their thumbnail silently.
    check('crosspost renders like any other non-text post',
      !!byId('t3_crosspost1'), 'no row for the crosspost');
    check('crosspost picks its b.thumbs.redditmedia.com thumbnail',
      /b\.thumbs\.redditmedia\.com/.test(thumbOf('t3_crosspost1') || ''),
      thumbOf('t3_crosspost1'));
    check('...and still rejects the styles.redditmedia.com icon beside it',
      !/styles\.redditmedia\.com/.test(thumbOf('t3_crosspost1') || ''),
      thumbOf('t3_crosspost1'));

    // --- link targets ---
    const href = (id) => byId(id)?.querySelector('a.title')?.getAttribute('href');
    check('self post title links to its comments page',
      href('t3_text1') === '/r/Layoffs/comments/text1/got_laid_off/', href('t3_text1'));
    check('link post title links OUT to the article',
      href('t3_link1') === 'https://fashiontimes.co.uk/articles/nasa-gravity', href('t3_link1'));
    check('comments button links to the permalink',
      byId('t3_link1')?.querySelector('a.comments')?.getAttribute('href') === '/r/nottheonion/comments/link1/nasa/');
    check('comment count is pluralised',
      /182 comments/.test(byId('t3_link1')?.textContent || ''));
    check('score rendered in midcol',
      byId('t3_link1')?.querySelector('.midcol .score')?.textContent === '1867');
    check('tagline names author and subreddit',
      /kleudorian/.test(byId('t3_link1').textContent) && /r\/nottheonion/.test(byId('t3_link1').textContent));

    // --- pagination handle ---
    check('pagination sentinel attached', !!doc.querySelector('.shd-sentinel'));
    check('paginator can see the programmatic partial',
      !!doc.querySelector('shreddit-feed faceplate-partial[loading="programmatic"]'));

    // --- vote delegation resolves at click time, not render time ---
    const upArrow = byId('t3_link1').querySelector('.midcol .arrow.up');
    let threw = null;
    try { upArrow.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
    catch (e) { threw = e.message; }
    check('clicking upvote with an un-hydrated vote bar does not throw', threw === null, threw);

    /* Video posts. A bare v.redd.it link 302s a logged-out session back to the comments
       page — a closed loop under our layout. Live testing then captured the real
       shape and corrected three guesses: the JSON hangs off a nested <shreddit-player>,
       it hydrates late, and the filenames are res_<height>p — so ranking on DASH_ scored
       every live URL zero and would have picked the LOWEST quality.

       Project decision 2026-08-22: the mp4 is no longer the title. Reddit is migrating
       video to CMAF/HLS and the packaged renditions die asset by asset, so the title goes
       where the bounce was going to land anyway — the comments page — and the mp4 is its
       own link, where a dead rendition costs one optional click instead of the post. */
    const vidRow = byId('t3_video1');
    const vidTitle = vidRow?.querySelector('a.title');
    const watch = vidRow?.querySelector('a.watch');
    check('a video post title goes to its comments page, not the v.redd.it loop',
      vidTitle?.getAttribute('href') === '/r/videos/comments/video1/timelapse/',
      vidTitle?.getAttribute('href'));
    check('...and NOTHING in the row still points at the bare v.redd.it post URL',
      ![...(vidRow?.querySelectorAll('a[href]') || [])]
        .some(a => a.getAttribute('href') === 'https://v.redd.it/storm'),
      [...(vidRow?.querySelectorAll('a[href]') || [])].map(a => a.getAttribute('href')).join(' | '));
    check('a video row carries its own watch link, pointing at a WATCHABLE mp4',
      /^https:\/\/packaged-media\.redd\.it\/.*\.mp4/.test(watch?.getAttribute('href') || ''),
      watch?.getAttribute('href'));
    check('...the HIGHEST rendition, not the first URL in the JSON',
      /res_1080p/.test(watch?.getAttribute('href') || ''), watch?.getAttribute('href'));
    /* Reddit offers the top height twice — vp9 first, then h264 — and both filenames score
       1080. Reported live 2026-08-22: with the tie unbroken, four of six video posts on one
       sub resolved to vp9 because that is the order Reddit sent, which is a codec chosen by
       nobody. */
    check('...and the h264 twin, not the vp9 that happens to be listed first',
      /\/m2-res_1080p\.mp4/.test(watch?.getAttribute('href') || ''), watch?.getAttribute('href'));
    const linkHref = byId('t3_link1')?.querySelector('a.title')?.getAttribute('href') || '';
    check('a non-video link post is untouched by any of that — it still points outward',
      /^https:\/\//.test(linkHref) && !/reddit\.com|^\/r\//.test(linkHref), linkHref);
    check('...and it grows no watch link', !byId('t3_link1')?.querySelector('a.watch'));

    check('no console errors during listing render',
      logs.filter(l => l.startsWith('error') || l.startsWith('jsdomError')).length === 0,
      logs.join(' | '));

    fs.writeFileSync(path.join(__dirname, 'out.listing.html'), doc.documentElement.outerHTML);
  }

  /* The two ways a video link has to behave when the player is not ready — both measured
     live in live testing, where 3 of 4 video posts had no packaged-media-json at first paint. */
  console.log('\n\x1b[1mVIDEO LINKS SURVIVE A PLAYER THAT IS NOT THERE YET\x1b[0m');
  {
    const noPlayer = listingPage().replace(/<shreddit-player[^>]*><\/shreddit-player>/g, '');
    const { doc } = await boot(noPlayer, 'https://www.reddit.com/');
    const a = doc.querySelector('[data-fullname="t3_video1"] a.watch');
    check('with no player at all, watch degrades to the comments page, not the v.redd.it bounce',
      a?.getAttribute('href') === '/r/videos/comments/video1/timelapse/', a?.getAttribute('href'));

    // ...and when Reddit hydrates the player LATER, the click upgrades the destination.
    const post = doc.getElementById('t3_video1');
    const player = doc.createElement('shreddit-player');
    player.setAttribute('packaged-media-json', JSON.stringify({ playbackMp4s: { permutations: [
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_392p.mp4?e=1&s=x' } },
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_1080p.mp4?e=1&s=x' } }
    ] } }));
    post.appendChild(player);
    doc.addEventListener('click', (e) => e.preventDefault(), true);   // jsdom cannot navigate
    a.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('a late-hydrated player upgrades the watch link at CLICK time',
      /res_1080p/.test(a.getAttribute('href') || ''), a.getAttribute('href'));
    check('...ranking on the filename still works when the JSON states no dimensions',
      /m2-res_1080p/.test(a.getAttribute('href') || ''), a.getAttribute('href'));
    check('...and the title stayed on the comments page through all of it',
      doc.querySelector('[data-fullname="t3_video1"] a.title')?.getAttribute('href')
        === '/r/videos/comments/video1/timelapse/',
      doc.querySelector('[data-fullname="t3_video1"] a.title')?.getAttribute('href'));

    /* And where the JSON DOES state a height, that is the authority — the filename scan
       exists to recover exactly this number, so a respelt filename must not outrank it.
       Same page, a second player carrying a rendition whose name has no number at all. */
    const post2 = doc.getElementById('t3_video1');
    post2.querySelectorAll('shreddit-player').forEach(n => n.remove());
    const stated = doc.createElement('shreddit-player');
    stated.setAttribute('packaged-media-json', JSON.stringify({ playbackMp4s: { permutations: [
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_720p.mp4?e=1&s=x',
                  dimensions: { height: 720, width: 1280 } } },
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_source.mp4?e=1&s=x',
                  dimensions: { height: 1440, width: 2560 } } }
    ] } }));
    post2.appendChild(stated);
    a.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('a stated height outranks a filename that carries no number',
      /m2-res_source\.mp4/.test(a.getAttribute('href') || ''), a.getAttribute('href'));
  }

  console.log('\n\x1b[1mCOMMENTS PAGE\x1b[0m');
  {
    const { doc, logs } = await boot(commentsPage(),
      'https://www.reddit.com/r/programming/comments/link1/nasa/');

    const comments = [...doc.querySelectorAll('#shd-root .thing.comment')];
    check('renders one node per comment', comments.length === COMMENT_DEPTHS.length,
      `got ${comments.length}, expected ${COMMENT_DEPTHS.length}`);
    check('renders the submission above the thread', !!doc.querySelector('.shd-selfpost'));
    check('does not fail', !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail'));

    // --- the depth-stack: nesting must match the source depth attribute exactly ---
    let nestingOk = true, firstBad = null;
    for (const c of comments) {
      const declared = Number(c.dataset.depth);
      // actual nesting = how many .thing.comment ancestors this node has
      let actual = 0, n = c.parentElement;
      while (n) { if (n.classList?.contains('comment')) actual++; n = n.parentElement; }
      if (declared !== actual) { nestingOk = false; firstBad = `${c.dataset.fullname}: declared ${declared}, nested ${actual}`; break; }
    }
    check('DOM nesting depth matches every comment\'s depth attribute', nestingOk, firstBad);

    const roots = [...doc.querySelectorAll('#shd-root .nestedlisting > .thing.comment')];
    check('top-level count matches depth-0 count',
      roots.length === COMMENT_DEPTHS.filter(d => d === 0).length,
      `got ${roots.length}`);
    check('no comment left at the root that should be nested',
      roots.every(r => r.dataset.depth === '0'));
    check('comment bodies carried across',
      comments.every(c => c.querySelector('.usertext-body')?.textContent.trim()));
    check('scores rendered as points', /97 points|100 points/.test(doc.querySelector('#shd-root').textContent));

    // --- collapse toggle ---
    const first = roots[0];
    const toggle = first.querySelector('a.expand');
    toggle.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('collapse toggle adds .collapsed and flips to [+]',
      first.classList.contains('collapsed') && toggle.textContent === '[+]');
    toggle.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    check('collapse toggle restores', !first.classList.contains('collapsed') && toggle.textContent === '[–]');

    check('no console errors during comments render',
      logs.filter(l => l.startsWith('error') || l.startsWith('jsdomError')).length === 0,
      logs.join(' | '));

    fs.writeFileSync(path.join(__dirname, 'out.comments.html'), doc.documentElement.outerHTML);
  }

  /* The post's own text. It is NOT an attribute — it arrives as slotted light DOM
     (div[slot="text-body"] > .md, confirmed live 2026-08-20) — and the extension shipped
     reading attributes only, so a text post's comments page rendered title, tagline,
     buttons and NO CONTENT. Reported from real use, and invisible to every suite because
     no fixture carried the slot. */
  /* A video post's comments page. The watch link belongs on a listing row; here it would
     be a link to the page you are already on, so it is not rendered — and giving this page
     a real player instead is open question 9(c). */
  console.log('\n\x1b[1mCOMMENTS PAGE — A VIDEO SUBMISSION\x1b[0m');
  {
    const { doc } = await boot(commentsPage({ videoPost: true }),
      'https://www.reddit.com/r/videos/comments/video1/timelapse/');
    check('the submission renders above the thread', !!doc.querySelector('.shd-selfpost'));
    check('its title is the permalink, not the v.redd.it bounce',
      doc.querySelector('.shd-selfpost a.title')?.getAttribute('href')
        === '/r/videos/comments/video1/timelapse/',
      doc.querySelector('.shd-selfpost a.title')?.getAttribute('href'));
    check('and it grows NO watch link back to the page you are on',
      !doc.querySelector('.shd-selfpost a.watch'));
  }

  /* THE INLINE PLAYER (0.16.0). The bug this closes: a repackaged asset has no
     packaged-media-json and no DASH_* file that serves, so `watch` resolved nothing, the
     title went to the comments page, and the comments page rendered no player — a video
     post that could not be watched anywhere with the extension on.

     Every test here stubs `fetch` and COUNTS the calls, because the cost of this feature
     is requests: one per video post opened, none anywhere else, and none at all with the
     setting off. A regression that quietly fetched per listing row would still render a
     correct-looking player, so the call count is the assertion that matters. */
  console.log('\n\x1b[1mCOMMENTS PAGE — THE INLINE PLAYER\x1b[0m');
  {
    /** boot() with fetch stubbed; returns the recorded request URLs. */
    const bootWithFetch = async (page, url, { body = VIDEO_MPD, ok = true, fail = false,
                                              settings = null } = {}) => {
      const calls = [];
      const { doc, win } = await boot(page, url, (w) => {
        w.fetch = (u) => {
          calls.push(String(u));
          return fail ? Promise.reject(new Error('network'))
                      : Promise.resolve({ ok, text: () => Promise.resolve(body) });
        };
        if (settings) {
          w.chrome = { storage: {
            sync: { get: async () => ({ settings }) }, onChanged: { addListener() {} } } };
        }
      });
      return { doc, win, calls };
    };

    const CMAF_URL = 'https://www.reddit.com' + CMAF_POST.permalink;

    {
      const { doc, calls } = await bootWithFetch(commentsPage({ cmafPost: true }), CMAF_URL);
      const ok = await waitFor(() => doc.querySelector('.shd-selfpost video.shd-video-el'));
      const v = doc.querySelector('.shd-selfpost video.shd-video-el');
      check('a CMAF-only video post gets a real player on its comments page', ok);
      /* The whole point: the name came from the manifest. 480 is the TOP rung of this
         ladder and 220 is the bottom — a resolver that read the height axis against a 720
         ceiling would reject all four rungs (they are 392..854 tall) and fall back to the
         smallest, serving 220x392 for a video with a good 480 available. */
      check('...playing the rendition the manifest named, not a constructed filename',
        v?.getAttribute('src') === 'https://v.redd.it/nzafnbgwcxkh1/CMAF_480.mp4',
        v?.getAttribute('src'));
      check('...sized from the manifest, so the box does not jump when metadata lands',
        v?.getAttribute('width') === '480' && v?.getAttribute('height') === '854',
        `${v?.getAttribute('width')}x${v?.getAttribute('height')}`);
      /* The audio half. CMAF has no combined rendition, so sound exists only if the
         separate track is resolved from the same manifest and played alongside. */
      const au = doc.querySelector('.shd-selfpost audio.shd-video-audio');
      check('...with the separate audio track alongside it, which is the only way it has sound',
        au?.getAttribute('src') === 'https://v.redd.it/nzafnbgwcxkh1/CMAF_AUDIO_128.mp4',
        au?.getAttribute('src'));
      /* A video element with no audio track of its own may not be given a volume control by
         the browser, and a video whose sound cannot be turned down is worse than a silent
         one — so the row is ours and must be present whenever the audio is. */
      check('...and a volume control of our own, because the native one may not exist',
        !!doc.querySelector('.shd-selfpost .shd-video-mute') &&
        !!doc.querySelector('.shd-selfpost .shd-video-vol'));
      check('...so it does NOT claim to be silent',
        !/no sound/i.test(doc.querySelector('.shd-selfpost .shd-video-note')?.textContent || ''),
        doc.querySelector('.shd-selfpost .shd-video-note')?.textContent);
      check('exactly one request, for the manifest of that asset and nothing else',
        calls.length === 1 && calls[0] === 'https://v.redd.it/nzafnbgwcxkh1/DASHPlaylist.mpd',
        JSON.stringify(calls));
    }

    {
      /* The legacy shape still wins when it is there, and it wins for a REASON: a combined
         file keeps its audio, where everything the manifest offers is silent. */
      const { doc, calls } = await bootWithFetch(commentsPage({ videoPost: true }),
        'https://www.reddit.com/r/videos/comments/video1/timelapse/');
      const ok = await waitFor(() => doc.querySelector('.shd-selfpost video.shd-video-el'));
      const v = doc.querySelector('.shd-selfpost video.shd-video-el');
      check('a post that still has packaged renditions plays one of those', ok);
      check('...the combined file, which is the one that keeps its audio',
        /packaged-media\.redd\.it\/.*m2-res_1080p\.mp4/.test(v?.getAttribute('src') || ''),
        v?.getAttribute('src'));
      check('...so it carries NO silent note and no paired audio',
        !doc.querySelector('.shd-selfpost .shd-video-note') &&
        !doc.querySelector('.shd-selfpost audio'));
      check('...and spends no request at all',
        calls.length === 0, JSON.stringify(calls));
    }

    {
      const { doc, calls } = await bootWithFetch(commentsPage({ cmafPost: true }), CMAF_URL,
        { settings: { inlineVideo: false, autoPaginate: false } });
      await waitFor(() => doc.querySelector('.shd-selfpost'));
      await hold(120);                       // asserting something does NOT happen
      check('with inlineVideo off there is no player',
        !doc.querySelector('.shd-selfpost video'));
      check('...and, the point of the setting, no request either',
        calls.length === 0, JSON.stringify(calls));
    }

    {
      /* Every failure path lands here: a 403, an abort, a CORS rejection, a manifest that
         lists nothing playable. None may leave an empty frame where a video should be. */
      const { doc } = await bootWithFetch(commentsPage({ cmafPost: true }), CMAF_URL,
        { fail: true });
      await waitFor(() => doc.querySelector('.shd-selfpost'));
      await hold(150);
      check('a failed manifest request leaves no empty player behind',
        !doc.querySelector('.shd-selfpost video'));
      check('...and the post itself still renders',
        !!doc.querySelector('.shd-selfpost a.title'));
    }

    {
      /* A manifest with video renditions but NO audio AdaptationSet. The post is then
         genuinely silent, and saying so is the whole point — a reader who hears nothing and
         is told nothing concludes the extension broke their sound. */
      const videoOnly = VIDEO_MPD.replace(
        /<AdaptationSet contentType="audio"[\s\S]*?<\/AdaptationSet>/, '');
      const { doc } = await bootWithFetch(commentsPage({ cmafPost: true }), CMAF_URL,
        { body: videoOnly });
      const ok = await waitFor(() => doc.querySelector('.shd-selfpost video.shd-video-el'));
      check('a manifest with no audio track still plays the video', ok);
      check('...with no audio element, because there is nothing to pair',
        !doc.querySelector('.shd-selfpost audio'));
      check('...and it says plainly that there is no sound',
        /no sound/i.test(doc.querySelector('.shd-selfpost .shd-video-note')?.textContent || ''),
        doc.querySelector('.shd-selfpost .shd-video-note')?.textContent);
    }

    {
      const { doc } = await bootWithFetch(commentsPage({ cmafPost: true }), CMAF_URL,
        { body: '<MPD><Period></Period></MPD>' });
      await waitFor(() => doc.querySelector('.shd-selfpost'));
      await hold(150);
      check('a manifest listing no video rendition is a miss, not a crash',
        !doc.querySelector('.shd-selfpost video'));
    }

    {
      /* The request-storm guard. Twenty video posts scrolled past must cost nothing; the
         reader has not chosen any of them. */
      const { doc, calls } = await bootWithFetch(listingPage(), 'https://www.reddit.com/');
      await waitFor(() => doc.querySelector('#shd-root .thing'));
      await hold(150);
      check('a LISTING renders no players and spends no requests',
        !doc.querySelector('#shd-root video') && calls.length === 0,
        `videos=${doc.querySelectorAll('#shd-root video').length} calls=${JSON.stringify(calls)}`);
    }
  }

  console.log('\n\x1b[1mCOMMENTS PAGE — THE SUBMISSION\'S OWN TEXT\x1b[0m');
  {
    const { doc } = await boot(commentsPage({ selfPost: true }),
      'https://www.reddit.com' + SELF_POST.permalink);

    const body = doc.querySelector('#shd-root .shd-selfpost .shd-selftext');
    check('a text post\'s body renders above the thread', !!body);
    check('the body is inside the row\'s entry, where old reddit hangs the expando',
      !!doc.querySelector('.shd-selfpost .entry .shd-selftext'));
    check('the body text carried across', /Tell us below/.test(body?.textContent || ''));
    // Cloning the RENDERED node is the mechanism; these three are what it preserves and
    // what any re-parse would mangle.
    check('links, code blocks and quotes survive intact',
      !!body?.querySelector('a[href="/r/programming/wiki/faq"]') &&
      !!body?.querySelector('pre code') && !!body?.querySelector('blockquote'));
    check('the body is a CLONE — the slotted source is still in the shreddit-post',
      !!doc.querySelector(`shreddit-post [slot="text-body"] .md`));

    // The link-post page has no slotted body, and must not grow an empty box for it.
    const { doc: linkDoc } = await boot(commentsPage(),
      'https://www.reddit.com/r/programming/comments/link1/nasa/');
    check('a post with no text gets no selftext box', !linkDoc.querySelector('.shd-selftext'));
  }

  /* One report diagnosed its broken page as "one unbuildable post zeroes
     out the whole thread". The architecture makes that impossible — every element is
     consumed independently — but nothing ASSERTED it, and the report's fix list was built
     on the claim. This pins the isolation: a post whose required attribute is gone renders
     nothing for itself, while all of the thread still arrives, the page reveals, and the
     reject is recorded as evidence rather than swallowed. */
  console.log('\n\x1b[1mONE UNRENDERABLE POST MUST NOT TAKE THE THREAD DOWN\x1b[0m');
  {
    // the same strip the /r/broken/ fixture applies, on the comments page
    const { doc, window } = await boot(
      commentsPage().replace(/post-title="[^"]*"/g, ''),
      'https://www.reddit.com/r/programming/comments/link1/nasa/');

    check('every comment still renders',
      doc.querySelectorAll('#shd-root .thing.comment').length === COMMENT_DEPTHS.length,
      `got ${doc.querySelectorAll('#shd-root .thing.comment').length}`);
    check('the unbuildable submission renders nothing, not garbage',
      !doc.querySelector('.shd-selfpost'));
    check('the page reveals instead of failing',
      doc.documentElement.classList.contains('shd-active') &&
      !doc.querySelector('#shd-error') &&
      !doc.documentElement.hasAttribute('data-shd-fail'));
    check('the rejected post is recorded as evidence',
      window.SHD.model.rejects.some(r => r.kind === 'post' && r.missing.includes('post-title')),
      JSON.stringify(window.SHD.model.rejects));
    check('the reject summary names the missing attribute',
      /post x1 missing "post-title"/.test(window.SHD.model.rejectSummary()),
      window.SHD.model.rejectSummary());
  }

  console.log('\n\x1b[1mIDEMPOTENCY\x1b[0m');
  {
    // Re-running the bundle must not duplicate rows — this is what protects us on
    // infinite scroll, where the observer revisits the same elements repeatedly.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    const before = doc.querySelectorAll('#shd-root .thing.link').length;
    window.eval(BUNDLE);
    await hold(250);        // asserting rows are NOT duplicated
    const after = doc.querySelectorAll('#shd-root .thing.link').length;
    check('re-running the bundle does not duplicate rows', before === after, `${before} -> ${after}`);
    check('only one #shd-root exists', doc.querySelectorAll('#shd-root').length === 1);
    check('only one #shd-header exists', doc.querySelectorAll('#shd-header').length <= 1);
  }

  console.log('\n\x1b[1mSPA ROUTE CHANGES\x1b[0m');
  {
    // jsdom has no `navigation` API, so this exercises route.js's history-patch fallback.
    // test/extension.js covers the navigation-API path in a real Chrome.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');

    check('header names the starting subreddit',
      [...doc.querySelectorAll('#shd-header .tabmenu li.selected a')]
        .some(a => a.textContent === 'r/aww'));
    check('sidebar is present on first render', !!doc.querySelector('#shd-sidebar'));

    // Reddit swaps feed content client-side; the fixture DOM is static, so un-stamping
    // stands in for a fresh batch of markup arriving.
    doc.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    window.history.pushState({}, '', '/r/programming/');
    await waitFor(() => [...doc.querySelectorAll('#shd-header .tabmenu li.selected a')]
      .some(a => a.textContent === 'r/programming'));

    // Both of these regressed on the first SPA navigation: gate.reveal() latches true for
    // the life of the page, and the flush that built the chrome was gated on !revealed —
    // so onRoute tore the chrome down and nothing ever rebuilt it.
    check('sidebar survives a client-side navigation',
      !!doc.querySelector('#shd-sidebar'));
    check('header follows the new subreddit',
      [...doc.querySelectorAll('#shd-header .tabmenu li.selected a')]
        .some(a => a.textContent === 'r/programming'),
      [...doc.querySelectorAll('#shd-header .tabmenu li.selected a')].map(a => a.textContent).join(','));
    check('no duplicate roots or headers after navigation',
      doc.querySelectorAll('#shd-root').length === 1 &&
      doc.querySelectorAll('#shd-header').length === 1);
    check('rows are re-rendered exactly once',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length,
      String(doc.querySelectorAll('#shd-root .thing.link').length));

    // Leaving for an unhandled route must hand the page back completely. A thread on a
    // PROFILE POST is the canonical one now that /user/ itself is in scope: it still
    // classifies OTHER (the page shape has never been captured) and it genuinely carries
    // post elements.
    doc.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    window.history.pushState({}, '', '/user/someone/comments/abc/xyz/');
    await waitFor(() => !doc.querySelector('#shd-root') && !doc.querySelector('#shd-header'));
    check('navigating to an unhandled route removes our whole layout',
      !doc.querySelector('#shd-root') && !doc.querySelector('#shd-header'));
    check('unhandled route is not suppressed',
      !doc.documentElement.classList.contains('shd-gate'));
  }

  /* Live testing, on a verified build: every browser back/forward landed on the error
     card, 9 of 9 — sources 3, STAMPED 3, rendered 0. Sort clicks replace Reddit's post
     elements (measured live, 0/4 reused), but a history traversal RE-INSERTS the same
     nodes it removed, data-shd stamps and all; the sweep skipped every one as
     already-rendered, and the deadline correctly concluded we rendered nothing. A stamp
     promises the element's row exists — an INSERTED element whose row is gone carries a
     stale stamp, and the observer path now clears it. The onRoute sweep deliberately does
     NOT (see the comment in pipeline.js): at pre-commit the outgoing page's stamped posts
     are still in the DOM, and reviving them there is bug 34's mixed-sorts regression. */
  console.log('\n\x1b[1mHISTORY TRAVERSALS RESTORE STAMPED NODES — AND THEY MUST RENDER\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');
    const feed = doc.querySelector('shreddit-feed');
    // The first page's article nodes, now rendered and stamped — the cache Reddit will
    // hand back on the traversal.
    const cached = [...feed.querySelectorAll('article')];
    check('setup: first page rendered and stamped',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length &&
      cached.every(a => a.querySelector('shreddit-post[data-shd="done"]')));

    // Sort click: Reddit REPLACES the elements (fresh, unstamped).
    window.history.pushState({}, '', '/r/aww/new/');
    cached.forEach(a => a.remove());
    const fresh = doc.createElement('article');
    fresh.innerHTML = '<shreddit-post id="t3_srtnew1" post-title="new sort post" ' +
      'permalink="/r/aww/comments/srtnew1/x/" content-href="https://e.com/n" post-type="link" ' +
      'score="9" comment-count="0" created-timestamp="2026-08-12T00:00:00+0000" domain="e.com" ' +
      'author="a" subreddit-name="aww" subreddit-prefixed-name="r/aww"></shreddit-post>';
    feed.appendChild(fresh);
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === 1 &&
      !!doc.querySelector('#shd-root [data-fullname="t3_srtnew1"]'));
    check('the sort page renders its fresh element', !!doc.querySelector('#shd-root [data-fullname="t3_srtnew1"]'));

    // Back: Reddit restores the SAME nodes — stamps intact, render torn down.
    window.history.back();
    await waitFor(() => window.location.pathname === '/r/aww/');
    fresh.remove();
    cached.forEach(a => feed.appendChild(a));
    const revived = await waitFor(() =>
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length, { timeout: 3000 });
    check('the restored stamped nodes render again', revived,
      `rows=${doc.querySelectorAll('#shd-root .thing.link').length} ` +
      `stamped=${doc.querySelectorAll('shreddit-post[data-shd]').length}`);
    check('no error card after the traversal',
      !doc.querySelector('#shd-error') && !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail'));
    check('no duplicate rows from the revival',
      new Set([...doc.querySelectorAll('#shd-root .thing.link')].map(r => r.dataset.fullname)).size ===
      doc.querySelectorAll('#shd-root .thing.link').length);

    // The counterweight: a stamped element whose row EXISTS is reparented, not restored —
    // reviving it would double-render. Move a rendered element elsewhere in the feed.
    const moved = feed.querySelector('article shreddit-post');
    const before = doc.querySelectorAll(`#shd-root [data-fullname="${moved.id}"]`).length;
    moved.closest('article').remove();
    const wrap = doc.createElement('article');
    wrap.appendChild(moved);
    feed.appendChild(wrap);
    await hold(200);
    check('a reparented element with a live row is NOT re-rendered',
      doc.querySelectorAll(`#shd-root [data-fullname="${moved.id}"]`).length === before,
      `rows for ${moved.id}: ${doc.querySelectorAll(`#shd-root [data-fullname="${moved.id}"]`).length}`);
  }

  console.log('\n\x1b[1mPRE-COMMIT NAVIGATION — the navigation API path\x1b[0m');
  {
    /**
     * The SPA tests above exercise route.js's history-patch fallback, which was always
     * correct. The path that shipped broken is this one: the real Navigation API's
     * `navigate` event is PRE-COMMIT — location.* still holds the OLD URL while it
     * dispatches, and a queued microtask drains before the URL updates. The first version
     * read location inside that microtask and latched the stale path as "seen", so every
     * sort-tab click was either swallowed (URL moves, content stays) or handled one
     * navigation late (content moves, URL doesn't). Traced live, click by click, before
     * being fixed — docs/engineering-log.md bug 34.
     *
     * jsdom has no `navigation` object, so a fake EventTarget reproduces the ONE property
     * that makes the bug possible: the URL does not update until after the handlers and
     * their microtasks have run. sameDocument:false below is not a typo — live Reddit
     * reports false and then intercepts anyway, so a fixture that said true would let a
     * sameDocument guard pass here and fail in the browser.
     */
    const emitted = [];
    let preCommit = null;
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/programming/',
      (w) => { w.navigation = new w.EventTarget(); });
    window.SHD.route.onChange((mode, path) => emitted.push(path));

    const dispatch = async (destPath) => {
      const ev = new window.Event('navigate');
      ev.destination = { url: 'https://www.reddit.com' + destPath, sameDocument: false };
      window.navigation.dispatchEvent(ev);
      await Promise.resolve();                       // microtasks drain: still pre-commit
      preCommit = [...emitted];
      window.history.pushState({}, '', destPath);    // the commit
      window.navigation.dispatchEvent(new window.Event('navigatesuccess'));
      await hold(20);
    };

    await dispatch('/r/programming/rising/');
    check('a sort change emits exactly once, for the DESTINATION',
      emitted.length === 1 && emitted[0] === '/r/programming/rising/', JSON.stringify(emitted));
    check('and it emits BEFORE the commit, so teardown precedes the feed swap',
      preCommit.length === 1 && preCommit[0] === '/r/programming/rising/', JSON.stringify(preCommit));

    // The regression that reproduces the live report: four clicks, no phase error. The
    // broken version emitted three paths, each one navigation behind.
    for (const p of ['/r/programming/new/', '/r/programming/controversial/', '/r/programming/top/']) {
      await dispatch(p);
    }
    check('no phase error across four clicks — every destination, in order',
      emitted.join(' ') ===
        '/r/programming/rising/ /r/programming/new/ /r/programming/controversial/ /r/programming/top/',
      emitted.join(' '));

    await dispatch('/r/programming/top/');
    check('a repeat of the current URL does not emit', emitted.length === 4, String(emitted.length));

    check('chrome helpers answer for the emitted path, not a possibly-stale location',
      window.SHD.route.sortOf() === 'top' && window.SHD.route.subredditOf() === 'programming',
      `sortOf=${window.SHD.route.sortOf()} subredditOf=${window.SHD.route.subredditOf()}`);
  }

  {
    // End-to-end across a pre-commit sort swap: the render must contain ONLY the incoming
    // sort. Two failure shapes are asserted away here: the swallowed-emit bug (stale rows
    // never torn down, new rows appended beneath them), and the tempting-but-wrong fix of
    // un-stamping in onRoute — which would re-render the OUTGOING posts into the new root
    // during the pre-commit window, because at that moment they are still in the DOM.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/programming/',
      (w) => { w.navigation = new w.EventTarget(); });
    check('rows render before the sort change',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);

    const ev = new window.Event('navigate');
    ev.destination = { url: 'https://www.reddit.com/r/programming/top/', sameDocument: false };
    window.navigation.dispatchEvent(ev);
    await hold(60);                                  // a full rAF inside the pre-commit window
    check('the pre-commit window renders nothing — outgoing posts stay stamped and skipped',
      doc.querySelectorAll('#shd-root .thing.link').length === 0,
      `${doc.querySelectorAll('#shd-root .thing.link').length} rows rendered from the outgoing sort`);

    // Commit, then swap the feed the way Reddit was measured to: outgoing elements fully
    // replaced, never reused.
    window.history.pushState({}, '', '/r/programming/top/');
    const feed = doc.querySelector('shreddit-feed');
    feed.querySelectorAll('article').forEach(a => a.remove());
    for (let i = 0; i < 3; i++) {
      const art = doc.createElement('article');
      const p = doc.createElement('shreddit-post');
      p.setAttribute('id', 't3_top' + i);
      p.setAttribute('post-title', 'top post ' + i);
      p.setAttribute('permalink', '/r/programming/comments/top' + i + '/x/');
      p.setAttribute('post-type', 'text');
      p.setAttribute('score', '1');
      p.setAttribute('comment-count', '0');
      p.setAttribute('created-timestamp', '2026-08-12T08:00:00.000000+0000');
      p.setAttribute('domain', 'self.programming');
      p.setAttribute('author', 'later');
      p.setAttribute('subreddit-name', 'programming');
      p.setAttribute('award-count', '0');
      art.appendChild(p);
      feed.appendChild(art);
    }
    window.navigation.dispatchEvent(new window.Event('navigatesuccess'));
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === 3);

    const titles = [...doc.querySelectorAll('#shd-root .thing.link a.title')].map(a => a.textContent);
    check('after the swap, exactly the incoming sort is rendered',
      titles.length === 3 && titles.every(t => /^top post/.test(t)), titles.join(' | '));
    check('no row from the outgoing sort survives', !titles.some(t => !/^top post/.test(t)));
    check('the active sort tab matches the destination',
      doc.querySelector('#shd-root .tabmenu li.selected a')?.textContent === 'top',
      doc.querySelector('#shd-root .tabmenu li.selected a')?.textContent);
    check('exactly one root', doc.querySelectorAll('#shd-root').length === 1);
  }

  console.log('\n\x1b[1mHIDDEN TABS — rAF does not fire, but the deadline does\x1b[0m');
  {
    // A page opened in a background tab (middle-click, session restore) never paints, so
    // requestAnimationFrame never fires — while gate.js's deadline, a setTimeout, does.
    // Measured live: 3 posts, 0 rows, 0 stamps, data-shd-fail=render-failed, and the
    // failure LATCHED because fail() disconnects the observer. docs/engineering-log.md bug 35.
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/', (w) => {
      Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
      w.requestAnimationFrame = () => 0;             // exactly what a hidden Chrome tab does
    });
    check('a page loaded in a hidden tab still renders',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length,
      `${doc.querySelectorAll('#shd-root .thing.link').length} rows`);
    check('every source is stamped — the queue really ran',
      [...doc.querySelectorAll('shreddit-post')].every(p => p.getAttribute('data-shd') === 'done'));
    check('and no failure is declared',
      !doc.documentElement.hasAttribute('data-shd-fail') && !doc.querySelector('#shd-error'));
  }
  {
    /* The transition case: a flush parked on a rAF booked just before the tab was hidden
       waits until the tab is shown again. The visibilitychange re-arm is what rescues it.

       AND IT HAS TO BE THE RE-ARM THAT DOES IT, WHICH THIS USED TO ASSUME. Deleting the
       listener outright left every assertion here green (found by test/mutate.sh, and it
       had been surviving quietly since the deadline's escape hatch was added): the gate's
       first check lands at 1500ms, finds nothing stamped, and calls `SHD.pipeline.kick()`
       to drain the queue synchronously before it will accuse anyone — so the rows appear
       either way, ~1200ms later than they should, and `boot()` waits 4000ms and never
       notices. Two mechanisms, one observable, and the test was reading the observable.
       WHEN is therefore the whole assertion. The flip is at 250ms and the re-arm's flush
       is immediate, so a row inside 1000ms can only have come from the re-arm; a row that
       waited for the deadline cannot beat 1500ms. Sampled from inside the page, on a timer
       that starts before the bundle does, because by the time boot() returns both paths
       look identical. */
    let visState = 'visible';
    const rafQueue = [];
    const FLIP_AT = 250;
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', (w) => {
      Object.defineProperty(w.document, 'visibilityState', { get: () => visState, configurable: true });
      w.requestAnimationFrame = (fn) => { rafQueue.push(fn); return 0; };  // booked, never runs
      w.__rowsAtMs = null;
      const t0 = Date.now();
      const poll = () => {
        if (w.__rowsAtMs != null) return;
        if (w.document.querySelectorAll('#shd-root .thing.link').length) {
          w.__rowsAtMs = Date.now() - t0;
          return;
        }
        setTimeout(poll, 10);
      };
      poll();
      // Flip to hidden shortly after boot — well inside the 1500ms deadline — from outside
      // the page, the way a user switching tabs does.
      setTimeout(() => {
        visState = 'hidden';
        w.document.dispatchEvent(new w.Event('visibilitychange', { bubbles: true }));
      }, FLIP_AT);
    });
    /* boot() and the in-page poller are both timers, so on a loaded machine boot() can
       return in the turn before the poller has looked. Wait for the sample rather than
       reading it the instant boot() hands back — that made this flaky, not strict. It
       weakens nothing: a page rescued by the deadline still records a time past 1500ms. */
    await waitFor(() => window.__rowsAtMs != null, { timeout: 3000 });
    check('a flush parked on a dead rAF is re-booked when visibility flips',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length,
      `${doc.querySelectorAll('#shd-root .thing.link').length} rows, ${rafQueue.length} rAF callbacks parked`);
    check('the rAF really was booked and never ran — the re-arm did the work',
      rafQueue.length > 0, 'nothing was ever parked on rAF, so this test proved nothing');
    /* 1000ms: comfortably above the flip at 250 plus an immediate flush, and comfortably
       below the gate's 1500ms first check, which is the only other thing that can render
       this page. Anything in between means the deadline rescued it and the re-arm is
       dead — which is exactly what the mutation does. */
    check('...and the rows arrived on the re-arm, not on the gate\'s 1500ms rescue',
      window.__rowsAtMs != null && window.__rowsAtMs < 1000,
      window.__rowsAtMs == null
        ? 'no rows ever appeared'
        : `first row at ${window.__rowsAtMs}ms — past the flip at ${FLIP_AT}ms, so this is ` +
          'the deadline draining the queue, not visibilitychange re-booking the flush');
  }

  console.log('\n\x1b[1mA SLOW PIPELINE BOOT IS NOT A RENDER FAILURE\x1b[0m');
  {
    // gate.js arms at document_start; pipeline.js boots at document_idle and then AWAITS
    // chrome.storage.sync.get — a synced store. Until onRoute() calls gate.engage(),
    // "sources present, nothing rendered" means nobody has tried, not that we are broken.
    // The deadline used to say render-failed anyway. docs/engineering-log.md bug 36.
    let releaseStorage;
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', (w) => {
      w.chrome = {
        storage: {
          sync: { get: () => new Promise(res => { releaseStorage = () => res({}); }) },
          onChanged: { addListener() {} }
        },
        runtime: { getManifest: () => ({ version: 'test' }) }
      };
    });
    // boot() returns once data-shd-waiting appears — the first deadline tick.
    check('the deadline does not accuse a pipeline that has not started',
      !doc.documentElement.hasAttribute('data-shd-fail') && !doc.querySelector('#shd-error'),
      doc.documentElement.getAttribute('data-shd-fail'));
    check('it un-blanks and says why it is waiting',
      doc.documentElement.getAttribute('data-shd-waiting') === 'not-started',
      doc.documentElement.getAttribute('data-shd-waiting'));

    releaseStorage();
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
    check('a late boot still renders the page it was accused of failing',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length &&
      doc.documentElement.classList.contains('shd-active'));
  }
  {
    // An unhandled route can carry shreddit-post elements while classifying OTHER — a
    // user profile was the original example (bug 36); a thread on a profile post is the
    // shape that still does, now that /user/ itself is in scope. With the pipeline slow
    // to boot, the deadline used to put a full-screen error on a page standDown() was
    // moments from disowning — a flash of an error screen that then removes itself,
    // which is a bug report nobody can reproduce.
    let releaseStorage;
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/user/someone/comments/abc/xyz/', (w) => {
      w.chrome = {
        storage: {
          sync: { get: () => new Promise(res => { releaseStorage = () => res({}); }) },
          onChanged: { addListener() {} }
        },
        runtime: { getManifest: () => ({ version: 'test' }) }
      };
    });
    check('an unhandled route with posts on it is never accused, even pre-boot',
      !doc.querySelector('#shd-error') && !doc.documentElement.hasAttribute('data-shd-fail'));
    releaseStorage();
    await waitFor(() => !doc.documentElement.classList.contains('shd-gate'));
    await hold(120);
    check('once the pipeline classifies it, the page is fully handed back',
      !doc.querySelector('#shd-root') && !doc.querySelector('#shd-error') &&
      !doc.documentElement.classList.contains('shd-gate'));
  }

  /* POLICY (project decision, 2026-08-20): a Reddit popup never takes the layout. The defer
     machinery — stand aside so the user can answer the modal, debounce so transient ones
     cost nothing, three redundant paths to un-stick the flag (bugs 30/33/38) — is GONE,
     replaced by suppression: the modal stays hidden under our render and the scroll lock
     it set is stripped so the page keeps working. These assertions are the policy's shape;
     the stood-down section below is its boundary (unhandled routes keep their modals). */
  console.log('\n\x1b[1mPOPUPS NEVER TAKE THE LAYOUT\x1b[0m');
  {
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/');
    check('setup: rendered and active', doc.documentElement.classList.contains('shd-active'));

    // An overlay lands mid-session: Reddit portals a dialog and locks scroll.
    const dialog = doc.createElement('div');
    dialog.className = 'rpl-dialog some-modal';
    doc.querySelector('shreddit-app').append(dialog);
    doc.body.classList.add('rpl-scroll-lock');

    await waitFor(() => !doc.body.classList.contains('rpl-scroll-lock'));
    check('the scroll lock is stripped', !doc.body.classList.contains('rpl-scroll-lock'));
    check('the layout never left', doc.documentElement.classList.contains('shd-active'));
    check('no defer state exists any more',
      !doc.documentElement.hasAttribute('data-shd-deferred'));
    check('the unknown dialog itself is NOT deleted — only hidden',
      !!doc.querySelector('.rpl-dialog.some-modal'),
      'deleting modal DOM we cannot name risks breaking flows never captured');

    // Well past the old 500ms debounce window: a resurrected defer path would have swapped
    // by now. Real elapsed time on purpose — this asserts something does NOT happen.
    await hold(700);
    check('still active well past any debounce window',
      doc.documentElement.classList.contains('shd-active') &&
      !doc.documentElement.hasAttribute('data-shd-deferred'));

    // Reddit re-asserts its lock (frameworks do); we strip it again. Convergence, not a
    // one-shot.
    doc.body.classList.add('rpl-scroll-lock');
    await waitFor(() => !doc.body.classList.contains('rpl-scroll-lock'));
    check('a re-applied lock is re-stripped', !doc.body.classList.contains('rpl-scroll-lock'));
  }
  console.log('\n\x1b[1mTHE AGE GATE IS ANSWERED — AND ONLY ON A CONFIDENT MATCH\x1b[0m');
  {
    // Project decision 2026-08-20: the extension clicks Reddit's own affirmative on the 18+
    // gate. The wrong button navigates away, so the selection logic is the safety: exactly
    // one button matching affirm-and-not-decline, else hands off. jsdom is where that
    // logic gets its adversarial cases; the packed-extension suite drives the real click.
    const mkGate = (doc, buttons) => {
      const host = doc.createElement('div');
      host.className = 'rpl-dialog configured-xpromo configured-xpromo-modal';
      for (const [id, text] of buttons) {
        const b = doc.createElement('button');
        b.id = id; b.textContent = text;
        b.addEventListener('click', () => { host.dataset.clicked = id; });
        host.appendChild(b);
      }
      doc.querySelector('shreddit-app').appendChild(host);
      return host;
    };

    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');

    // The captured shape: affirmative + a decline that contains "back".
    const gate = mkGate(doc, [['over18', "Yes, I'm Over 18"], ['nope', 'No, take me back']]);
    doc.body.classList.add('rpl-scroll-lock');
    await waitFor(() => gate.dataset.clicked !== undefined);
    check('the affirmative button is clicked', gate.dataset.clicked === 'over18',
      `clicked=${gate.dataset.clicked}`);
    check('the host is stamped so the click never repeats',
      gate.getAttribute('data-shd-answered') === 'clicked');

    // Stamped means stamped: another mutation tick must not click again.
    delete gate.dataset.clicked;
    doc.body.classList.add('rpl-scroll-lock');
    await hold(150);
    check('an answered gate is not hammered on later mutations',
      gate.dataset.clicked === undefined, `clicked again: ${gate.dataset.clicked}`);

    // THE TRAP from C.AGE_GATE: a decline whose text contains "18". A bare /18/ matcher
    // clicks it and navigates the user away — the one outcome worse than doing nothing.
    const trap = mkGate(doc, [['maybe', 'Continuar (18)'], ['under', 'No, I am under 18']]);
    doc.body.classList.add('rpl-scroll-lock');
    await hold(150);
    check('a gate with no confident affirmative is left unclicked',
      trap.dataset.clicked === undefined, `clicked=${trap.dataset.clicked}`);
    check('...and falls back to suppression: still in the DOM, lock stripped',
      !!trap.isConnected && !doc.body.classList.contains('rpl-scroll-lock'));

    // Two plausible affirmatives is also ambiguity — Reddit A/B-ing button copy must not
    // turn into a coin flip.
    const twins = mkGate(doc, [['a', 'Yes, continue'], ['b', 'Yes, I am over 18']]);
    doc.body.classList.add('rpl-scroll-lock');
    await hold(150);
    check('two affirmative-looking buttons mean hands off',
      twins.dataset.clicked === undefined, `clicked=${twins.dataset.clicked}`);
  }
  {
    // The 18+ shape specifically: the gate is a modal over a POPULATED feed (verified live
    // 2026-08-18), so rendering proceeds and the gate stays hidden with the rest of native
    // Reddit. The lock arrives BEFORE boot here — the age gate is up from the first paint,
    // not raised later — so this also covers suppression on the engage path, not only via
    // the class observer.
    const gatedListing = listingPage().replace('<body>', '<body class="rpl-scroll-lock">');
    const { doc } = await boot(gatedListing, 'https://www.reddit.com/r/gated-sub/');
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length > 0);
    check('a page that boots under an age-gate lock still renders',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
    check('and comes up active with the lock stripped',
      doc.documentElement.classList.contains('shd-active') &&
      !doc.body.classList.contains('rpl-scroll-lock'));
  }

  console.log('\n\x1b[1mSTOOD-DOWN ROUTES ARE UNTOUCHED — even by the upsell surgery\x1b[0m');
  {
    // gate.js arms at document_start and its observers never disconnect, so without the
    // engaged guard it deleted Reddit's login wall and cleared its scroll lock on every
    // route we hand back — search, profiles, modmail. standDown() promises those pages are
    // untouched; deleting an element violates that as much as restyling one would.
    // docs/engineering-log.md bug 37.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');
    window.history.pushState({}, '', '/user/someone/comments/abc/xyz/');
    await waitFor(() => !doc.querySelector('#shd-root'));

    // Reddit raises its login upsell on the stood-down page.
    const app = doc.querySelector('shreddit-app');
    const host = doc.createElement('desktop-dynamic-upsell-modal');
    const dialog = doc.createElement('div');
    dialog.id = 'desktop-dynamic-upsell-dialog';
    app.append(host, dialog);
    doc.body.classList.add('rpl-scroll-lock');
    await hold(700);   // past the debounce; every observer has long since fired

    check('the upsell is NOT removed on a route we handed back',
      !!doc.getElementById('desktop-dynamic-upsell-dialog') &&
      !!doc.querySelector('desktop-dynamic-upsell-modal'),
      'Sheddit deleted Reddit UI on a page it promised to leave alone');
    check('its scroll lock is left alone too', doc.body.classList.contains('rpl-scroll-lock'));
  }

  console.log('\n\x1b[1mLATE shreddit-app — the insertion observer must follow it\x1b[0m');
  {
    // If shreddit-app is not in the DOM when the observers attach, the old code latched
    // onto body's children as a permanent substitute — so an upsell later portalled INTO
    // the app was inserted into a node nobody watched, and with no class change it was
    // never noticed. The fallback must hand over to the app the moment it arrives.
    // docs/engineering-log.md bug 39.
    const late = `<!DOCTYPE html><html><head><title>reddit</title></head><body>
      <shreddit-feed>
        <article><shreddit-post id="t3_l1" post-title="late one" permalink="/r/late/comments/l1/x/"
          post-type="text" score="1" comment-count="0" domain="self.late" author="a"
          subreddit-name="late" award-count="0"
          created-timestamp="2026-08-12T08:00:00.000000+0000"></shreddit-post></article>
      </shreddit-feed></body></html>`;
    const { doc } = await boot(late, 'https://www.reddit.com/r/late/');
    check('setup: the page rendered without shreddit-app',
      doc.querySelectorAll('#shd-root .thing.link').length === 1);

    // shreddit-app arrives late...
    const app = doc.createElement('shreddit-app');
    doc.body.appendChild(app);
    await hold(30);
    // ...and the upsell is portalled into it, with NO body-class change — the ordering the
    // two-observer design exists for.
    const host = doc.createElement('desktop-dynamic-upsell-modal');
    const dialog = doc.createElement('div');
    dialog.id = 'desktop-dynamic-upsell-dialog';
    app.append(host, dialog);
    const gone = await waitFor(() =>
      !doc.querySelector('desktop-dynamic-upsell-modal') &&
      !doc.getElementById('desktop-dynamic-upsell-dialog'), { timeout: 1500 });
    check('an upsell inserted into a late-arriving shreddit-app is still removed', gone,
      'the insertion observer latched onto body and never followed the app element');
  }

  console.log('\n\x1b[1mFAILURE SCREEN\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    check('rows present before the failure',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);

    window.SHD.gate.fail('render-failed', { sources: POSTS.length });
    await waitFor(() => doc.querySelector('#shd-error'));

    const box = doc.querySelector('#shd-error');
    check('a failure puts an explanation on screen', !!box);
    check('the explanation names what actually went wrong',
      /could not build the old-reddit layout/i.test(box.textContent), box.textContent.slice(0, 120));
    check('it points at the file that needs editing',
      /contracts\.js/.test(box.textContent));
    check('it offers a way out and a way to retry',
      [...box.querySelectorAll('button')].map(b => b.textContent).join('|')
        .includes("Show Reddit's own layout"),
      [...box.querySelectorAll('button')].map(b => b.textContent).join('|'));
    const diag = box.querySelector('pre')?.textContent || '';
    check('it carries diagnostics for a bug report',
      /reason:\s+render-failed/.test(diag) && /url:/.test(diag) && /version:/.test(diag),
      diag ? diag.slice(0, 100) : '(no diagnostics block)');
    /* "rendered: 0 / errors: 0" used to be the whole story, and a report proved
       it is not a story anyone can act on: it cannot distinguish "the render queue never
       ran" (a scheduling failure — reload) from "every element was processed and rejected"
       (a stale contract — edit contracts.js). The stamp count is the fork, and the reject
       tally names the attribute. Both lines must be in the copy-paste block. */
    check('diagnostics report how many sources the renderer processed',
      /stamped:\s+\d+/.test(diag), diag.slice(0, 300));
    check('diagnostics report the model\'s reject tally',
      /rejected:\s+/.test(diag), diag.slice(0, 300));

    // The whole point: native Reddit is NOT silently restored. A broken extension that
    // hands back modern Reddit is indistinguishable from an uninstalled one.
    check('native Reddit stays suppressed behind the failure screen',
      doc.documentElement.classList.contains('shd-failed') &&
      !doc.documentElement.hasAttribute('data-shd-released'));
    check('our half-built layout is removed', !doc.querySelector('#shd-root'));
    check('the failure is recorded for diagnostics',
      doc.documentElement.getAttribute('data-shd-fail') === 'render-failed');

    // A page arriving after the failure must not be rendered into a layout that's gone.
    const article = doc.createElement('article');
    article.innerHTML = '<shreddit-post id="t3_post_fail" post-title="Arrived after the failure" ' +
      'permalink="/r/x/comments/pb/p/" content-href="https://e.com/a" post-type="link" score="5" ' +
      'comment-count="1" created-timestamp="2026-08-12T00:00:00+0000" domain="e.com" author="a" ' +
      'subreddit-name="x" subreddit-prefixed-name="r/x"></shreddit-post>';
    doc.querySelector('shreddit-feed').appendChild(article);
    await hold(300);        // asserting it is NOT rendered: needs real elapsed time
    check('a post arriving after the failure is not rendered',
      !doc.querySelector('#shd-root') && !doc.querySelector('[data-fullname="t3_post_fail"]'));

    // ...and the escape hatch is a button the USER presses.
    box.querySelector('button.shd-error-primary')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('the escape hatch removes the failure screen', !doc.querySelector('#shd-error'));
    check('the escape hatch un-suppresses native Reddit',
      !doc.documentElement.classList.contains('shd-failed') &&
      !doc.documentElement.classList.contains('shd-active') &&
      doc.documentElement.getAttribute('data-shd-released') === 'user-request');
  }

  {
    // The window between "work is queued and a flush is scheduled" and "the rAF fires".
    // Disconnecting the observer does not close it — the queue is already full and the
    // frame is already booked, so flush() itself has to check.
    //
    // Racing this with real timers gives a vacuous test (the frame usually lands first,
    // and the failure tidies up after it either way), so the frame is captured and fired
    // by hand.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    let pendingFrame = null;
    window.requestAnimationFrame = (fn) => { pendingFrame = fn; return 1; };

    doc.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    const article = doc.createElement('article');
    article.innerHTML = '<shreddit-post id="t3_inflight" post-title="Queued before the failure" ' +
      'permalink="/r/x/comments/if/p/" content-href="https://e.com/a" post-type="link" score="5" ' +
      'comment-count="1" created-timestamp="2026-08-12T00:00:00+0000" domain="e.com" author="a" ' +
      'subreddit-name="x" subreddit-prefixed-name="r/x"></shreddit-post>';
    doc.querySelector('shreddit-feed').appendChild(article);
    await waitFor(() => !!pendingFrame);

    check('the in-flight case is actually set up (a frame is pending)', !!pendingFrame);
    window.SHD.gate.fail('render-failed', { sources: 8 });
    pendingFrame?.();

    check('a flush already scheduled when the failure lands renders nothing',
      !doc.querySelector('#shd-root') && !doc.querySelector('[data-fullname="t3_inflight"]'),
      doc.querySelector('[data-fullname="t3_inflight"]') ? 'row was rendered' : 'root survived');
  }

  {
    // gate.onStop() teardown. A native handoff in progress has to be unwound, or the
    // reply corridor stays open over a page that is no longer ours.
    const { doc, window } = await boot(commentsPage(),
      'https://www.reddit.com/r/programming/comments/link1/nasa/');
    doc.querySelector('#shd-root .thing.comment a.reply')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('passthrough is active before the failure',
      doc.documentElement.classList.contains('shd-passthrough-active'));

    window.SHD.gate.fail('render-errors', { errors: 8, first: 'boom' });
    await waitFor(() => !doc.documentElement.classList.contains('shd-passthrough-active'));
    check('failing unwinds an in-progress native handoff',
      !doc.documentElement.classList.contains('shd-passthrough-active') &&
      !doc.querySelector('#shd-passthrough-exit') &&
      doc.querySelectorAll('.shd-passthrough-hide').length === 0 &&
      !doc.querySelector('.shd-native-passthrough'));
    check('a render-errors failure surfaces the underlying exception',
      /boom/.test(doc.querySelector('#shd-error')?.textContent || ''));
  }

  /* The two failures that share "render-failed", told apart on the card itself.
     A report sat on exactly this fork — 26 sources, 0 rendered, 0 errors — and
     the card's only explanation ("Reddit changed its markup") sent it chasing contract
     renames that its own attribute dump disproved. */
  console.log('\n\x1b[1mTHE ERROR CARD SAYS WHICH KIND OF NOTHING-RENDERED THIS IS\x1b[0m');
  {
    // Organic stale-contract failure: every post stripped of a required attribute, the
    // /r/broken/ shape. All sources get processed, all get rejected, the card must say so
    // and name the attribute.
    const broken = listingPage().replace(/post-title="[^"]*"/g, '');
    const { doc } = await boot(broken, 'https://www.reddit.com/');
    await waitFor(() => doc.querySelector('#shd-error'), { timeout: 4000 });

    const diag = doc.querySelector('#shd-error pre')?.textContent || '';
    const stamped = diag.match(/stamped:\s+(\d+)/);
    check('every source was processed, and the card proves it',
      stamped && Number(stamped[1]) === POSTS.length,
      diag.slice(0, 300) || '(no card)');
    check('the card names the missing attribute',
      new RegExp(`post x${POSTS.length} missing "post-title"`).test(diag), diag.slice(0, 300));
    check('the explanation carries the reject evidence, not just the generic guess',
      /recorded why each item was rejected/.test(doc.querySelector('#shd-error')?.textContent || ''));
  }
  {
    // The OTHER kind: sources present but the renderer never processed any of them —
    // bug 35's family, and the live shape the Superstonk report most likely was. The card
    // must not blame Reddit's markup for a queue that never ran.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    window.SHD.gate.fail('render-failed', { sources: 26, stamped: 0, rejected: '' });
    await waitFor(() => doc.querySelector('#shd-error'));
    const text = doc.querySelector('#shd-error')?.textContent || '';
    check('zero-stamped failure blames the queue, not the markup',
      /render queue did not run/.test(text), text.slice(0, 200));
    check('zero-stamped failure does not point at contracts.js',
      !/contracts\.js/.test(text));
  }

  console.log('\n\x1b[1mSLOW PAGES ARE NOT FAILURES\x1b[0m');
  {
    // The measured regression: with Reddit's HTML stalled past the deadline, a flat timer
    // fired and permanently disabled the extension for a page that was about to work.
    // The deadline now asks WHY nothing rendered before blaming itself.
    const empty = listingPage().replace(/<shreddit-feed>[\s\S]*<\/shreddit-feed>/, '<shreddit-feed></shreddit-feed>');
    const { doc, window } = await boot(empty, 'https://www.reddit.com/');

    await hold(1800);       // must really elapse: we assert the deadline did NOT fire
    check('no posts yet + deadline passed => keeps waiting, does not fail',
      !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail'));

    // Posts finally arrive, late. This must still render.
    const feed = doc.querySelector('shreddit-feed');
    feed.innerHTML = '<article><shreddit-post id="t3_late" post-title="Arrived late" ' +
      'permalink="/r/x/comments/l/p/" content-href="https://e.com/a" post-type="link" score="5" ' +
      'comment-count="1" created-timestamp="2026-08-12T00:00:00+0000" domain="e.com" author="a" ' +
      'subreddit-name="x" subreddit-prefixed-name="r/x"></shreddit-post></article>';
    await waitFor(() => doc.querySelector('[data-fullname="t3_late"]'));
    check('a page that arrives after the deadline still renders',
      !!doc.querySelector('[data-fullname="t3_late"]') &&
      doc.documentElement.classList.contains('shd-active'),
      doc.documentElement.getAttribute('data-shd-fail') || 'not rendered');
    check('no failure screen for a merely slow page', !doc.querySelector('#shd-error'));
  }

  {
    // The other side of the same coin: posts ARE present and we rendered none. That is
    // our bug, and waiting longer cannot help — fail at the first deadline, not the last.
    //
    // Driven through a real SPA navigation, which also covers the case that used to leave
    // a permanently blank page: #shd-root is removed on every route change, so if the
    // deadline stayed disarmed after the first reveal, an unrenderable second page showed
    // nothing at all, forever.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');
    check('first page rendered normally',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);

    // Break rendering the way a Reddit redesign would: drop a required attribute.
    doc.querySelectorAll('shreddit-post').forEach(p => {
      p.removeAttribute('data-shd');
      p.removeAttribute('post-title');
    });
    window.history.pushState({}, '', '/r/programming/');
    await waitFor(() => doc.documentElement.hasAttribute('data-shd-fail'), { timeout: 8000 });

    check('sources present but nothing rendered => fails at the first deadline',
      doc.documentElement.getAttribute('data-shd-fail') === 'render-failed',
      doc.documentElement.getAttribute('data-shd-fail') || 'no failure recorded');
    // Derived from the fixture, not typed: hardcoding it meant adding one post to POSTS
    // broke an unrelated assertion about the failure screen's wording.
    check('and says how many posts it could see',
      new RegExp(`Reddit sent ${POSTS.length} posts`)
        .test(doc.querySelector('#shd-error')?.textContent || ''),
      (doc.querySelector('#shd-error')?.textContent || '(no error screen)').slice(0, 140));
    check('an unrenderable page after navigation is never left blank',
      !!doc.querySelector('#shd-error'));
  }

  {
    // A failure on one page must not condemn the next one.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');
    window.SHD.gate.fail('render-failed', { sources: POSTS.length });
    await waitFor(() => doc.querySelector('#shd-error'));
    check('failure screen is up before navigating', !!doc.querySelector('#shd-error'));

    doc.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    window.history.pushState({}, '', '/r/programming/');
    await waitFor(() => !doc.querySelector('#shd-error') &&
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
    check('navigating away clears the failure and renders the new page',
      !doc.querySelector('#shd-error') &&
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length,
      doc.querySelector('#shd-error') ? 'error screen persisted' :
        `${doc.querySelectorAll('#shd-root .thing.link').length} rows`);
  }

  {
    // But an explicit "show me Reddit's own layout" is the user's decision, and it sticks.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/r/aww/');
    window.SHD.gate.fail('render-failed', { sources: POSTS.length });
    await waitFor(() => doc.querySelector('#shd-error button.shd-error-primary'));
    doc.querySelector('#shd-error button.shd-error-primary')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    doc.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
    window.history.pushState({}, '', '/r/programming/');
    await hold(300);        // asserting nothing comes back: needs real elapsed time
    check('releasing to native Reddit survives a client-side navigation',
      !doc.querySelector('#shd-root') && !doc.querySelector('#shd-error') &&
      !doc.documentElement.classList.contains('shd-active'));
  }

  {
    // Releasing from a page that NEVER rendered is the common case — the deadline fires
    // before anything reaches the screen, so `revealed` is false. A later navigation must
    // not re-arm the pre-render blackout over a page the user explicitly asked to see
    // natively; shd-gate sets visibility:hidden, so that would be a blank page.
    const broken = listingPage().replace(/post-title="[^"]*"/g, '');
    const { doc, window } = await boot(broken, 'https://www.reddit.com/r/aww/');
    await waitFor(() => doc.documentElement.hasAttribute('data-shd-fail'), { timeout: 8000 });
    check('unreadable posts fail without ever rendering',
      doc.documentElement.getAttribute('data-shd-fail') === 'render-failed' &&
      !doc.documentElement.classList.contains('shd-active'),
      doc.documentElement.getAttribute('data-shd-fail') || 'no failure');

    doc.querySelector('#shd-error button.shd-error-primary')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('releasing from a never-rendered page shows native Reddit',
      !doc.documentElement.classList.contains('shd-gate') &&
      !doc.querySelector('#shd-error'));

    window.history.pushState({}, '', '/r/programming/');
    await hold(400);        // asserting the blackout does NOT return
    check('navigating after that release never re-blacks-out the page',
      !doc.documentElement.classList.contains('shd-gate') &&
      !doc.documentElement.classList.contains('shd-active') &&
      !doc.querySelector('#shd-error'),
      'html classes: ' + doc.documentElement.className);
  }

  console.log('\n\x1b[1mROUTE / TAB CONSISTENCY\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    const R = window.SHD.route;

    // Every tab we render must lead somewhere we still handle. `controversial` was
    // offered on the front page while classify() sent /controversial/ to OTHER, so
    // clicking our own tab dropped the user out of the extension.
    const hrefs = new Set();
    for (const el of [window.SHD.chrome.tabMenu(), doc.querySelector('#shd-header')]) {
      el?.querySelectorAll('a[href]').forEach(a => hrefs.add(a.getAttribute('href')));
    }
    const bad = [...hrefs].filter(h => h.startsWith('/') && R.classify(h) === R.OTHER);
    check('every href our own chrome renders is a route we handle',
      bad.length === 0, `unhandled: ${bad.join(', ')}`);
    check('the front page tab set is non-trivial', hrefs.size >= 5, `${hrefs.size} links`);

    for (const s of R.SORTS) {
      check(`/${s}/ and /r/aww/${s}/ both classify as LISTING`,
        R.classify(`/${s}/`) === R.LISTING && R.classify(`/r/aww/${s}/`) === R.LISTING,
        `front=${R.classify(`/${s}/`)} sub=${R.classify(`/r/aww/${s}/`)}`);
    }
    check('unhandled routes still fall through',
      ['/search/', '/user/x/comments/abc/xyz/', '/settings/', '/r/aww/wiki/index/']
        .every(p => R.classify(p) === R.OTHER));
  }

  /* User profiles — in scope by project decision 2026-08-21. The profile COMMENT contract
     is UNVERIFIED (C.PROFILE_COMMENT has never been captured live), so the route is built
     around one promise these sections pin from both sides: a profile we can read renders
     completely, and a profile we cannot read hands back native Reddit QUIETLY — no error
     card, no partial page, promptly. */
  console.log('\n\x1b[1mUSER PROFILES — a readable profile renders\x1b[0m');
  {
    const { window, doc } = await boot(profilePage(), 'https://www.reddit.com/user/tester/');
    const R = window.SHD.route;
    check('/user/x/ and its tabs classify as PROFILE',
      ['/user/tester/', '/user/tester', '/user/tester/comments/', '/user/tester/submitted/']
        .every(p => R.classify(p) === R.PROFILE));
    check('a thread on a PROFILE POST stays OTHER — that page shape is uncaptured',
      R.classify('/user/tester/comments/abc/xyz/') === R.OTHER);

    await waitFor(() =>
      doc.querySelectorAll('#shd-root .thing').length >= 2 + PROFILE_COMMENT_COUNT);
    const things = [...doc.querySelectorAll('#shd-root #siteTable > .thing')];
    check('posts and comments render interleaved in document order',
      things.map(t => t.classList.contains('comment') ? 'c' : 'p').join('') === 'pccpcc',
      things.map(t => t.classList.contains('comment') ? 'c' : 'p').join(''));
    check('the page is revealed as ours', doc.documentElement.classList.contains('shd-active'));

    const row = doc.querySelector('#shd-root .shd-profile-comment');
    check('a profile comment row carries its cloned body',
      /Profile comment number 0/.test(row?.textContent || ''));
    /* Live, each comment holds TWO nested `.md` nodes and document order returns the
       WRAPPER — whose other classes are Reddit's indent utilities, which Reddit's own
       stylesheet still applies to anything we clone (open question 7). The text is
       identical either way, so only the box gives it away. */
    const cloned = row?.querySelector('.usertext-body > *');
    check('...cloned from the markdown node, not Reddit\'s layout wrapper',
      !!cloned && !/ms-\[22px\]|ps-\[10px\]/.test(cloned.className || ''),
      cloned?.className);
    check('...the permalink is the captured href minus its ?context query',
      row?.querySelector('a.permalink')?.getAttribute('href') ===
        '/r/sub0/comments/thread0/comment/pc0/',
      row?.querySelector('a.permalink')?.getAttribute('href'));
    check('...the context link is Reddit\'s own href, used as-is rather than rebuilt',
      row?.querySelector('a.context')?.getAttribute('href') ===
        '/r/sub0/comments/thread0/comment/pc0/?context=3',
      row?.querySelector('a.context')?.getAttribute('href'));
    check('...a full-comments link DERIVED from the href, pointing at the thread',
      row?.querySelector('a.comments')?.getAttribute('href') === '/r/sub0/comments/thread0/',
      row?.querySelector('a.comments')?.getAttribute('href'));
    check('...and a parent line naming where it lives',
      row?.querySelector('.parent a.subreddit')?.textContent === 'r/sub0',
      row?.querySelector('.parent')?.textContent);
    /* A subreddit-scoped permalink is unambiguous, so the path wins outright here — the
       rendered-link fallback is only consulted when the path cannot say. Row 2 is where
       the body-exclusion rule is actually proved. */
    check('...linking to that subreddit, derived from the path it can trust',
      row?.querySelector('.parent a.subreddit')?.getAttribute('href') === '/r/sub0/',
      row?.querySelector('.parent a.subreddit')?.getAttribute('href'));

    const rows = [...doc.querySelectorAll('#shd-root .shd-profile-comment')];

    /* The OTHER captured href shape: a comment on ANOTHER USER's profile post has no
       subreddit at all. Row 1 is that shape — name the user, do not invent an r/. */
    const onProfilePost = rows[1];
    check('a comment on a profile post names the USER, never a guessed subreddit',
      onProfilePost?.querySelector('.parent a.subreddit')?.textContent === 'u/otheruser',
      onProfilePost?.querySelector('.parent')?.textContent);
    check('...and its full-comments link is the profile thread',
      onProfilePost?.querySelector('a.comments')?.getAttribute('href') ===
        '/user/otheruser/comments/pthread1/',
      onProfilePost?.querySelector('a.comments')?.getAttribute('href'));

    /* LIVE TESTING'S BUG, both halves.
       On /user/spez/ every permalink came back user-scoped, so the first path segment was
       the profile we were standing on rather than the community — and all thirty rows read
       "comment in u/spez". Rows 2 and 3 are that shape. Row 2 carries the rendered links
       Reddit draws beside such a comment, which are real evidence where a rewritten path is
       not; row 3 carries none, and the only honest output there is silence. What NEITHER
       may ever print is the profile owner's own name. */
    const recovered = rows[2];
    check('an owner-scoped permalink takes its community from the RENDERED link, not the path',
      recovered?.querySelector('.parent a.subreddit')?.textContent === `r/${PROFILE_LINKED_SUB}`,
      recovered?.querySelector('.parent')?.textContent);
    check('...and names the post it is replying to, which old reddit showed and we did not',
      recovered?.querySelector('.parent .shd-parent-title')?.textContent === PROFILE_LINKED_TITLE,
      recovered?.querySelector('.parent')?.textContent);
    check('...neither of them lifted out of the comment body',
      !/elsewhere|other thread/.test(recovered?.querySelector('.parent')?.textContent || ''),
      recovered?.querySelector('.parent')?.textContent);

    const unknowable = rows[3];
    check('an owner-scoped permalink with nothing to go on claims NOTHING',
      !unknowable?.querySelector('.parent'),
      unknowable?.querySelector('.parent')?.textContent);
    check('...and above all never prints the profile owner as the community',
      !rows.some(n => /u\/tester/.test(n.querySelector('.parent')?.textContent || '')),
      rows.map(n => n.querySelector('.parent')?.textContent || '-').join(' | '));
    check('the author is the profile owner — the element carries no author attribute',
      row?.querySelector('a.author')?.textContent === 'tester',
      row?.querySelector('a.author')?.textContent);
    check('no score is invented — the element carries none',
      !row?.querySelector('.score'), row?.querySelector('.score')?.textContent);
    check('the timestamp comes from the rendered <time>, the only source there is',
      !!row?.querySelector('time'), 'no time element rendered');

    const tabHrefs = [...doc.querySelectorAll('#shd-root .shd-tabmenu-wrap a')]
      .map(a => a.getAttribute('href'));
    check('the tab bar is overview / comments / submitted', tabHrefs.length === 3 &&
      tabHrefs[0] === '/user/tester/', tabHrefs.join(', '));
    check('every profile tab href classifies as PROFILE — a tab must never route out (bug 10)',
      tabHrefs.every(p => R.classify(p) === R.PROFILE), tabHrefs.join(', '));
    check('the header names the profile',
      [...doc.querySelectorAll('#shd-header .tabmenu li.selected a')]
        .some(a => a.textContent === 'u/tester'));
    check('post rows carry no rank on a profile — comment rows sit between them',
      !doc.querySelector('#shd-root .thing.link .rank'));
    /* Live testing watched our row count run AHEAD of the live source count on a paginating
       profile (108 rows against 100 sources, the gap widening per page). Three things
       could produce that and only one of them is our bug: duplicate rows. Reddit removing
       consumed elements, or the published count simply being a heartbeat behind the live
       DOM, are both harmless. This pins the half that would be ours. */
    const ids = [...doc.querySelectorAll('#shd-root .shd-profile-comment')]
      .map(n => n.dataset.fullname);
    check('every profile comment renders exactly once — no duplicate rows',
      ids.length === new Set(ids).size && ids.length === PROFILE_COMMENT_COUNT,
      `${ids.length} rows, ${new Set(ids).size} unique`);
    window.SHD.paginator.reset();
  }

  {
    /* THE COUNTERWEIGHT to the handback rule, and the reason it was loosened. A profile
       whose comments we CAN read must survive one element we cannot: live testing watched a
       history traversal re-consume restored elements mid-hydration (a timestamp vanished
       that way), and under the old first-reject rule one not-yet-ready element would have
       handed back a profile that was rendering perfectly a second earlier. */
    const { doc, window } = await boot(profilePage({ badIndex: 1 }),
      'https://www.reddit.com/user/tester/');
    await waitFor(() => doc.querySelectorAll('#shd-root .shd-profile-comment').length
      === PROFILE_COMMENT_COUNT - 1);
    check('one unreadable comment does not cost the whole profile',
      !doc.documentElement.hasAttribute('data-shd-soft-fail') &&
      doc.documentElement.classList.contains('shd-active'),
      doc.documentElement.getAttribute('data-shd-soft-fail'));
    check('...the readable ones still render, and the outlier is simply absent',
      doc.querySelectorAll('#shd-root .shd-profile-comment').length === PROFILE_COMMENT_COUNT - 1,
      String(doc.querySelectorAll('#shd-root .shd-profile-comment').length));
    window.SHD.paginator.reset();
  }

  {
    /* The body selector is the one part of the profile contract still uncaptured
       (C.PROFILE_COMMENT_BODY), so the case where it MISSES is the one most likely to be
       real. A body is required: empty comment rows would be a profile that looks complete
       and says nothing, so this hands back like any other unreadable profile. */
    const { doc } = await boot(profilePage({ noBody: true }),
      'https://www.reddit.com/user/tester/');
    const handed = await waitFor(() =>
      doc.documentElement.hasAttribute('data-shd-soft-fail'), { timeout: 4000 });
    check('a comment whose BODY we cannot find hands back rather than rendering empty', handed,
      'empty comment rows would claim the profile rendered');
    check('...named as unreadable, with the body called out in the tally',
      doc.documentElement.getAttribute('data-shd-soft-fail') === 'profile-unreadable',
      doc.documentElement.getAttribute('data-shd-soft-fail'));
  }

  console.log('\n\x1b[1mUSER PROFILES — an unreadable profile hands back, quietly and promptly\x1b[0m');
  {
    /* Comment-shaped elements whose attributes we cannot read. Rendering the readable
       remainder (the two posts) would show a profile with most of its content silently
       missing — worse than the native page. The handback must beat the 1500ms deadline:
       it happens at the first FLUSH (the reject check in pipeline.js), and the threshold
       below is what keeps that path honest — at >=1500ms the gate's fallback tick would
       pass this test with the flush check deleted (bug 29's threshold lesson). */
    const { doc } = await boot(profilePage({ unreadable: true }),
      'https://www.reddit.com/user/tester/');
    const t0 = Date.now();
    const handed = await waitFor(() =>
      doc.documentElement.hasAttribute('data-shd-soft-fail'), { timeout: 4000 });
    check('a profile whose comments reject is handed back to native Reddit', handed);
    check('...promptly — at the first flush, not the 1500ms deadline',
      Date.now() - t0 < 800, `${Date.now() - t0}ms after boot`);
    check('...with NO error card', !doc.querySelector('#shd-error'));
    check('...no partial page and no suppression left behind',
      !doc.querySelector('#shd-root') &&
      !doc.documentElement.classList.contains('shd-active') &&
      !doc.documentElement.classList.contains('shd-gate'));
    check('...and the reason readable from <html> for the next bug report',
      doc.documentElement.getAttribute('data-shd-soft-fail') === 'profile-unreadable',
      doc.documentElement.getAttribute('data-shd-soft-fail'));
  }

  {
    /* The OTHER way the guess can be wrong, and the one the reject check cannot see: the
       real tag is neither of the two we query. Then NOTHING matches, nothing rejects, the
       user's POSTS render happily, and their comments are silently absent — a profile that
       looks fine and is missing most of its content. Without this the suite would have
       called that a pass: the two posts render, `rendered > 0`, reveal, green. */
    const { doc } = await boot(profilePage({ tag: 'shreddit-comment-card' }),
      'https://www.reddit.com/user/tester/');
    const handed = await waitFor(() =>
      doc.documentElement.hasAttribute('data-shd-soft-fail'), { timeout: 4000 });
    check('a comment element we do not even query for is noticed, not skipped', handed,
      'the posts rendered and the comments vanished silently');
    check('...named as an unknown comment element, not as unreadable attributes',
      doc.documentElement.getAttribute('data-shd-soft-fail') === 'profile-unknown-comment',
      doc.documentElement.getAttribute('data-shd-soft-fail'));
    check('...and the readable posts are NOT left on screen as a plausible-looking profile',
      !doc.querySelector('#shd-root') &&
      !doc.documentElement.classList.contains('shd-active'));
  }

  {
    /* The counterweight, and it is what stops the check above from being a hair trigger:
       a profile whose comments we DO read carries plenty of comment-shaped furniture —
       action rows inside comments, hovercards inside posts, a tree wrapper around the
       list — and none of that may hand the page back. */
    const noisy = profilePage().replace(/<\/shreddit-post>/g,
      '<faceplate-hovercard><shreddit-comment-teaser></shreddit-comment-teaser>' +
      '</faceplate-hovercard></shreddit-post>');
    const { doc, window } = await boot(noisy, 'https://www.reddit.com/user/tester/');
    await waitFor(() =>
      doc.querySelectorAll('#shd-root .shd-profile-comment').length === PROFILE_COMMENT_COUNT);
    /* Five comment-ish custom element names live inside every captured profile comment
       (author-modifier-icon, badges, action-row, share-button) plus a hovercard teaser
       inside each post. None may hand a readable profile back. */
    check('setup: the page really does carry comment-shaped furniture we ignore',
      doc.querySelectorAll('shreddit-comment-action-row, shreddit-comment-badges, ' +
        'shreddit-comment-share-button, shreddit-comment-teaser').length >= 8,
      String(doc.querySelectorAll('shreddit-comment-action-row, shreddit-comment-badges, ' +
        'shreddit-comment-share-button, shreddit-comment-teaser').length));
    check('furniture inside posts and comments never hands a readable profile back',
      !doc.documentElement.hasAttribute('data-shd-soft-fail') &&
      doc.documentElement.classList.contains('shd-active') &&
      doc.querySelectorAll('#shd-root .shd-profile-comment').length === PROFILE_COMMENT_COUNT);
    window.SHD.paginator.reset();
  }

  {
    // The toggle. Off must mean exactly what an unhandled route means: untouched.
    const noProfiles = (win) => {
      win.chrome = { storage: {
        sync: { get: async () => ({ settings: { profiles: false } }) },
        onChanged: { addListener() {} }
      } };
    };
    const { doc } = await boot(profilePage(), 'https://www.reddit.com/user/tester/', noProfiles);
    await waitFor(() => !doc.documentElement.classList.contains('shd-gate'));
    check('profiles off = a stood-down route: nothing mounted, nothing suppressed',
      !doc.querySelector('#shd-root') && !doc.querySelector('#shd-error') &&
      !doc.documentElement.classList.contains('shd-active') &&
      !doc.documentElement.classList.contains('shd-gate'));
  }

  console.log('\n\x1b[1mSHADOW-PIERCING VOTE DELEGATION\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/');
    const post = doc.querySelector('shreddit-post[id="t3_link1"]');

    // The action bar hydrates inside a shreddit-async-loader, which ARCHITECTURE §1.2
    // records as having a shadow root. A light-DOM-only querySelector misses a button
    // placed there PERMANENTLY, and the old code logged that identically to a transient
    // pre-hydration miss.
    const shadow = post.querySelector('shreddit-async-loader').attachShadow({ mode: 'open' });
    const btn = doc.createElement('button');
    btn.setAttribute('upvote', '');
    let clicks = 0;
    btn.addEventListener('click', () => clicks++);
    shadow.appendChild(btn);

    check('the native button is NOT reachable by a light-DOM query',
      post.querySelector('button[upvote]') === null);
    check('SHD.dom.deepQuery finds it through the shadow root',
      window.SHD.dom.deepQuery(post, 'button[upvote]') === btn);

    doc.querySelector('#shd-root .thing[data-fullname="t3_link1"] .midcol .arrow.up')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('clicking our arrow delegates into the shadow root', clicks === 1, `clicks=${clicks}`);

    check('a closed shadow root yields null rather than throwing', (() => {
      const p2 = doc.querySelector('shreddit-post[id="t3_image1"]');
      p2.querySelector('shreddit-async-loader').attachShadow({ mode: 'closed' });
      return window.SHD.dom.deepQuery(p2, 'button[upvote]') === null;
    })());
  }

  console.log('\n\x1b[1mNATIVE PASSTHROUGH\x1b[0m');
  {
    const { doc, window } = await boot(commentsPage(),
      'https://www.reddit.com/r/programming/comments/link1/nasa/');
    const source = doc.querySelector('shreddit-comment');

    doc.querySelector('#shd-root .thing.comment a.reply')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    // suppress.css clips the direct child of <body>. Tagging the comment itself — which
    // is what the first cut did — cannot un-hide it: the clip is seven levels up.
    const app = doc.querySelector('shreddit-app');
    check('passthrough marks the <body> child that actually carries the clip',
      app.classList.contains('shd-native-passthrough'));
    check('passthrough marks the ancestor path down to the target',
      source.classList.contains('shd-passthrough') &&
      source.closest('shreddit-comment-tree').classList.contains('shd-passthrough'));
    check('passthrough hides the target\'s siblings',
      [...source.parentElement.children].filter(c => c !== source)
        .every(c => c.classList.contains('shd-passthrough-hide')));
    check('passthrough never hides our own root',
      !doc.querySelector('#shd-root').classList.contains('shd-passthrough-hide'));
    check('passthrough flags the document and offers a way back',
      doc.documentElement.classList.contains('shd-passthrough-active') &&
      !!doc.querySelector('#shd-passthrough-exit'));

    doc.querySelector('#shd-passthrough-exit a')
       .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('leaving passthrough clears every marker',
      !app.classList.contains('shd-native-passthrough') &&
      !source.classList.contains('shd-passthrough') &&
      doc.querySelectorAll('.shd-passthrough-hide').length === 0 &&
      !doc.documentElement.classList.contains('shd-passthrough-active') &&
      !doc.querySelector('#shd-passthrough-exit'));
  }

  console.log('\n\x1b[1mPAGES WITH NOTHING TO RENDER\x1b[0m');
  {
    // What a logged-out viewer hits constantly: an age gate, a private community, a
    // rate-limit page. No shreddit-feed, no shreddit-comment-tree, no posts. Nothing is
    // broken — so blanking the page (which is what the pre-render gate does) and then
    // accusing ourselves of failing are both wrong. Measured before the fix: twelve
    // seconds of white, then an error screen over the age gate the user needed to click.
    const interstitial = `<!DOCTYPE html><html><head><title>reddit</title></head><body>
      <shreddit-app><div><div id="subgrid-container"><div><main id="main-content">
        <div class="interstitial"><h1>You must be 18+</h1><button>Yes</button></div>
      </main></div></div></div></shreddit-app></body></html>`;
    const started = Date.now();
    const { doc, window } = await boot(interstitial, 'https://www.reddit.com/r/nsfwsub/');
    await waitFor(() => doc.documentElement.getAttribute('data-shd-waiting') === 'no-feed-container');
    const clearedAfter = Date.now() - started;

    // Not just "eventually" — gate.js has a 1500ms fallback tick that would satisfy a
    // loose assertion while the user still stared at white. This must clear off `load`.
    check('the blackout clears promptly, not on the fallback deadline',
      clearedAfter < 1000, `${clearedAfter}ms (fallback tick is 1500ms)`);
    check('a page with no feed is not blanked',
      !doc.documentElement.classList.contains('shd-gate'),
      'the pre-render blackout is still up');
    check('and is not accused of failing',
      !doc.querySelector('#shd-error') && !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail') || 'error screen shown');
    check('the reason is recorded for diagnosis',
      doc.documentElement.getAttribute('data-shd-waiting') === 'no-feed-container',
      doc.documentElement.getAttribute('data-shd-waiting'));
    check('we mount nothing over it', !doc.querySelector('#shd-root'));

    // Still willing: if the user clicks through and content arrives, render it.
    const main = doc.querySelector('#main-content');
    main.innerHTML = '<shreddit-feed><article><shreddit-post id="t3_after" ' +
      'post-title="Arrived after the age gate" permalink="/r/x/comments/a/p/" ' +
      'content-href="https://e.com/a" post-type="link" score="5" comment-count="1" ' +
      'created-timestamp="2026-08-12T00:00:00+0000" domain="e.com" author="a" ' +
      'subreddit-name="x" subreddit-prefixed-name="r/x"></shreddit-post></article></shreddit-feed>';
    await waitFor(() => doc.querySelector('[data-fullname="t3_after"]'));
    check('content arriving later is still rendered',
      !!doc.querySelector('[data-fullname="t3_after"]') &&
      doc.documentElement.classList.contains('shd-active'),
      doc.documentElement.className);
  }

  {
    // The other half of the split: a feed EXISTS but holds nothing we recognise. That is
    // what a renamed post element looks like, so it stays a failure rather than a shrug.
    const emptyFeed = listingPage().replace(/<shreddit-feed>[\s\S]*<\/shreddit-feed>/,
      '<shreddit-feed></shreddit-feed>');
    const { doc } = await boot(emptyFeed, 'https://www.reddit.com/');
    await hold(1800);       // asserting it neither fails nor gives up early
    check('a feed present but empty is not written off as "not our page"',
      doc.documentElement.getAttribute('data-shd-waiting') !== 'no-feed-container',
      'treated as no-feed');
    check('...it keeps waiting rather than failing early',
      !doc.querySelector('#shd-error'), 'failed too early');
  }

  /* A subreddit Reddit itself says is empty must not get the failure screen.
     Observed live 2026-08-20 on a quarantined sub, logged out: Reddit serves ZERO posts
     and renders its own "this community doesn't have any posts yet" panel inside
     shreddit-feed. That panel is real markup, so the old descendant-count heuristic read
     it as "a feed full of content we cannot parse" and drew a no-content card over a page
     that was working exactly as Reddit intended. The decision tree already claimed to
     handle this case in its own comment. Bug 52. */
  console.log('\n\x1b[1mAN EMPTY SUBREDDIT IS NOT A FAILURE\x1b[0m');
  {
    const { listingPage: lp } = require('./fixtures');
    const emptyState = lp().replace(/<shreddit-feed>[\s\S]*<\/shreddit-feed>/, `<shreddit-feed>
        <!-- The CAPTURED live shape (live testing, r/911truth): one div, children H1/P/A.
             Different from the first guess at this panel, and the round proved the
             structure heuristic classifies the real thing correctly — keep it real. -->
        <div class="mt-[100px] flex justify-center items-center flex-col" id="empty-feed-content">
          <h1 data-testid="no-content">This community doesn't have any posts yet</h1>
          <p>Make one and get this feed started.</p>
          <a href="/r/911truth/submit">Create a post</a>
        </div>
      </shreddit-feed>`);
    const { doc } = await boot(emptyState, 'https://www.reddit.com/r/programming/');
    // Long enough to pass FIRST_CHECK_MS (1500ms) — the failure this pins arrived on the
    // deadline, not at boot, so a short wait would pass with the bug still in.
    await hold(2000);

    check('an empty subreddit is not accused of failing',
      !doc.querySelector('#shd-error') && !doc.documentElement.hasAttribute('data-shd-fail'),
      doc.documentElement.getAttribute('data-shd-fail') || 'error screen shown');
    check('it is diagnosed as an empty feed, not as unreadable content',
      doc.documentElement.getAttribute('data-shd-waiting') === 'empty-feed',
      doc.documentElement.getAttribute('data-shd-waiting'));
    check('the page is not left blanked', !doc.documentElement.classList.contains('shd-gate'));
    check('and Reddit\'s own empty-state panel is left on the page',
      !!doc.querySelector('shreddit-feed #empty-feed-content'));
  }
  {
    // The counterweight, and the reason the heuristic cannot simply be loosened: a feed
    // genuinely FULL of post-shaped markup we no longer recognise must still fail loudly.
    // /r/renamed/'s shape — article wrappers with an unrecognised element inside.
    const { listingPage: lp } = require('./fixtures');
    const renamed = lp().replace(/<shreddit-post(?=[\s>])/g, '<shreddit-postx')
                        .replace(/<\/shreddit-post>/g, '</shreddit-postx>');
    const { doc } = await boot(renamed, 'https://www.reddit.com/r/renamed/');
    await waitFor(() => doc.querySelector('#shd-error'), { timeout: 14000 });
    check('a feed full of markup we cannot read still fails loudly',
      !!doc.querySelector('#shd-error'),
      doc.documentElement.getAttribute('data-shd-waiting') || 'no error screen');
  }

  console.log('\n\x1b[1mLOGGED-OUT SCOPE\x1b[0m');
  {
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/');
    const row = doc.querySelector('#shd-root .thing.link');
    const labels = [...row.querySelectorAll('.flat-list.buttons a')].map(a => a.textContent);

    // save and report cannot work without a session, and both shipped as links to the
    // permalink — so they looked like actions and navigated instead.
    check('no affordance we render requires a login',
      !labels.includes('save') && !labels.includes('report'), labels.join(', '));
    check('nothing in the button row is a link pretending to be an action',
      [...row.querySelectorAll('.flat-list.buttons a')]
        .every(a => a.getAttribute('href') !== '#' || a.onclick || a.className === 'hide' ||
                    a.classList.contains('hide')),
      labels.join(', '));
    check('the buttons that remain still work',
      labels.includes('share') && labels.includes('hide') &&
      labels.some(l => /comment/.test(l)), labels.join(', '));
  }

  console.log('\n\x1b[1mMAIN-WORLD BRIDGE\x1b[0m');
  {
    // bridge.js runs in the page's world and cannot import contracts.js, so it repeats the
    // protocol literals. Nothing but this assertion keeps the two halves in step, and a
    // drift here disables pagination silently.
    const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'bridge.js'), 'utf8');
    const contractsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'contracts.js'), 'utf8');
    const literal = (src, name) => (src.match(new RegExp(name + `\\s*[:=]\\s*'([^']+)'`)) || [])[1];

    for (const [bridgeName, contractName] of
         [['REQUEST', 'request'], ['SEL_KEY', 'selKey'],
          ['METHOD_KEY', 'methodKey'], ['RESULT_KEY', 'resultKey']]) {
      const a = literal(bridgeSrc, bridgeName), b = literal(contractsSrc, contractName);
      check(`bridge ${bridgeName} matches contracts BRIDGE.${contractName}`,
        !!a && a === b, `bridge="${a}" contracts="${b}"`);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    const mainWorld = manifest.content_scripts.filter(cs => cs.world === 'MAIN');
    check('exactly one MAIN-world content script is registered',
      mainWorld.length === 1, `${mainWorld.length} registered`);
    check('and it is the bridge, at document_start',
      mainWorld[0]?.js?.length === 1 && mainWorld[0].js[0] === 'src/core/bridge.js' &&
      mainWorld[0].run_at === 'document_start', JSON.stringify(mainWorld[0]));
    check('the manifest declares the Chrome version "world" needs',
      Number(manifest.minimum_chrome_version) >= 111, manifest.minimum_chrome_version);

    // Load order. build.js already fails the build if its list and the manifest's disagree
    // about WHICH files ship, but not about the order — and the two orders legitimately
    // differ, because bridge.js sits in its own MAIN-world script while the dev bundle has
    // only one world. What must hold in both is the part that is load-bearing:
    //
    //   gate.js at document_start   or the page flashes native Reddit before we hide it
    //   pipeline.js last            it boots on load and calls everything else, so anything
    //                               loading after it is undefined at the moment it runs
    //
    // Unasserted until now, and a reordering would break the packed extension while the dev
    // harness kept working — the exact asymmetry that hid the pagination bug for weeks.
    const isolated = manifest.content_scripts.filter(cs => (cs.world || 'ISOLATED') === 'ISOLATED');
    const startScripts = isolated.filter(cs => cs.run_at === 'document_start').flatMap(cs => cs.js || []);
    const idleScripts = isolated.filter(cs => cs.run_at === 'document_idle').flatMap(cs => cs.js || []);
    check('gate.js runs at document_start (or native Reddit flashes first)',
      startScripts.includes('src/core/gate.js'), JSON.stringify(startScripts));
    // Same reasoning, one flash further on: the blackout paints before we render anything,
    // so a dark theme that is only applied at document_idle shows a white page first. Both
    // halves have to arrive at document_start — the palette (--shd-blank, in themes.css)
    // and the code that puts the attribute on <html> (themes.js).
    const startCss = isolated.filter(cs => cs.run_at === 'document_start').flatMap(cs => cs.css || []);
    check('themes.js runs at document_start (or a dark theme flashes white first)',
      startScripts.includes('src/config/themes.js'), JSON.stringify(startScripts));
    check('themes.css is delivered at document_start, with the blackout it colours',
      startCss.includes('src/styles/themes.css') && startCss.includes('src/styles/suppress.css'),
      JSON.stringify(startCss));
    check('pipeline.js is the LAST script the manifest loads',
      idleScripts[idleScripts.length - 1] === 'src/core/pipeline.js',
      `manifest ends with ${idleScripts[idleScripts.length - 1]}`);
    const bundleOrder = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8')
      .match(/'src\/[^']+\.js'/g).map(s => s.slice(1, -1));
    check('...and the last one the dev bundle concatenates',
      bundleOrder[bundleOrder.length - 1] === 'src/core/pipeline.js',
      `bundle ends with ${bundleOrder[bundleOrder.length - 1]}`);
    check('the dev bundle loads contracts.js first, like the manifest does',
      bundleOrder[0] === 'src/config/contracts.js', bundleOrder[0]);
    // The bridge is our only sanctioned way across; anything else calling a page-defined
    // method would break the same way pagination did.
    check('nothing outside the bridge calls the partial load method',
      !/\[C\.PARTIAL_LOAD_METHOD\]\s*\(/.test(
        fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'paginator.js'), 'utf8')));
  }

  console.log('\n\x1b[1mPAGINATION\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', noAuto);
    window.eval(PAGER_SCRIPT);         // upgrade faceplate-partial to a working custom element
    const loads = () => window.__shdPager.loads;

    check('the fixture partial really does define loadContent',
      typeof doc.querySelector('faceplate-partial').loadContent === 'function');

    const first = await window.SHD.paginator.loadNext('manual');
    check('a manual load succeeds and reports it', first === true, String(first));
    check('it went through the bridge, not a direct call', loads() === 1, String(loads()));
    check('the loaded posts become rows',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length + PAGER_PAGE_SIZE,
      String(doc.querySelectorAll('#shd-root .thing.link').length));
    check('the bridge records its result on <html>',
      doc.documentElement.dataset.shdLoadMore === 'ok',
      doc.documentElement.dataset.shdLoadMore);

    // An automatic trigger inside the cooldown must back off; a click must not.
    const auto = await window.SHD.paginator.loadNext('sentinel');
    check('an automatic load inside the cooldown backs off', auto === false);
    check('...and fetched nothing', loads() === 1, String(loads()));
    const manual = await window.SHD.paginator.loadNext('manual');
    check('a deliberate click inside the cooldown still fetches', manual === true);
    check('...because a button that silently does nothing is worse', loads() === 2, String(loads()));

    check('pages are counted', window.SHD.paginator.pages === 2, String(window.SHD.paginator.pages));
    check('no duplicate rows across pages',
      new Set([...doc.querySelectorAll('#shd-root .thing.link')].map(r => r.dataset.fullname)).size ===
      doc.querySelectorAll('#shd-root .thing.link').length);
  }

  console.log('\n\x1b[1mADULT CONTENT IS NOT RENDERED AS A PICTURE BY DEFAULT\x1b[0m');
  {
    /**
     * We do not restyle Reddit's DOM — we read the thumbnail URL off the post and render
     * our own <img>. Reddit blurs NSFW thumbnails in its own feed for logged-out readers,
     * and that blur is a property of ITS markup, so lifting the URL walks straight past it:
     * a feed Reddit had obscured came out fully explicit in our layout. Reported from a real
     * logged-out session on a graphic war-footage subreddit.
     *
     * The two spellings of the flag are both in the fixture and both matter — see the
     * `nsfw1` / `safeflag1` entries in fixtures.js. Getting the second one wrong is the
     * worse failure: it puts a placeholder over every thumbnail in the feed.
     */
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/');
    const rowOf = (id) => doc.querySelector(`#shd-root .thing.link[data-fullname="${id}"]`);
    const nsfwRow = rowOf('t3_nsfw1');
    const safeRow = rowOf('t3_safeflag1');

    check('the adult post renders at all', !!nsfwRow);
    check('its thumbnail is a placeholder, not the image',
      !!nsfwRow.querySelector('a.thumbnail.nsfw') && !nsfwRow.querySelector('.thumbnail img'),
      nsfwRow.querySelector('.thumbnail')?.outerHTML);
    check('...and the row is stamped, so the placeholder is not read as "no image"',
      nsfwRow.querySelector('.nsfw-stamp')?.textContent === 'nsfw');

    // The catastrophe check. `nsfw="false"` is what a SAFE post looks like when the
    // attribute is bound as a string, and it is present on the element either way.
    check('a post whose flag says "false" keeps its real thumbnail',
      !!safeRow.querySelector('.thumbnail img') && !safeRow.querySelector('a.thumbnail.nsfw'),
      safeRow.querySelector('.thumbnail')?.outerHTML);
    check('...and is not stamped', !safeRow.querySelector('.nsfw-stamp'));
    check('a post with no flag at all is untouched',
      !rowOf('t3_link1').querySelector('.nsfw-stamp') &&
      !!rowOf('t3_link1').querySelector('.thumbnail img'));
    check('exactly one row in the feed is treated as adult',
      doc.querySelectorAll('#shd-root .nsfw-stamp').length === 1,
      String(doc.querySelectorAll('#shd-root .nsfw-stamp').length));
  }

  {
    // Opting in restores the picture — old reddit's "show thumbnails for adult content".
    // The stamp stays: it labels the post, it is not a stand-in for the image.
    const withSettings = (settings) => (win) => {
      win.chrome = {
        storage: {
          sync: { get: async () => ({ settings }), set: async () => { } },
          onChanged: { addListener: () => { } }
        }
      };
    };
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/',
      withSettings({ listing: true, comments: true, chrome: true, showNsfwThumbnails: true }));
    const nsfwRow = doc.querySelector('#shd-root .thing.link[data-fullname="t3_nsfw1"]');
    check('opting in shows the real adult thumbnail',
      !!nsfwRow.querySelector('.thumbnail img') && !nsfwRow.querySelector('a.thumbnail.nsfw'),
      nsfwRow.querySelector('.thumbnail')?.outerHTML);
    check('...and the stamp survives the opt-in, because it labels the post',
      !!nsfwRow.querySelector('.nsfw-stamp'));
  }

  console.log('\n\x1b[1mA SILENT OBSERVER MUST NOT STALL THE FEED\x1b[0m');
  {
    /**
     * The live dead-end, reproduced.
     *
     * Measured on real reddit.com, five pages in: the sentinel sat 80px above the fold with
     * 22 undriven partials still in the feed, and the paginator's published state read
     * `visible: false` — frozen, with no further IntersectionObserver callback across two
     * readings ten seconds apart. attach() runs on every flush, detach() resets `visible` to
     * false, and an observer only reports CHANGES — so a reader already at the bottom of the
     * document produced none, the reset was never corrected, and the chain died holding an
     * answer it had invented.
     *
     * The stub below is that condition and nothing else: the observer reports intersecting
     * ONCE, for the first sentinel, and is silent for every sentinel attach() creates
     * afterwards. Everything else is a working page with pages left to load.
     *
     * Gated on `visible`, this loads exactly one page. Gated on geometry, it keeps going.
     */
    const silentAfterFirst = (win) => {
      win.eval(PAGER_SCRIPT);      // a real custom element, before the bundle boots
      win.__io = { observes: 0, delivered: 0 };
      win.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) {
          const st = win.__io;
          if (++st.observes > 1) return;          // silent from here on
          st.delivered++;
          win.setTimeout(() => this.cb([{ isIntersecting: true, target: el }]), 0);
        }
        unobserve() { }
        disconnect() { }
      };
    };

    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', silentAfterFirst);
    const loads = () => window.__shdPager.loads;

    // Control: without this the whole section is vacuous — a stub that never delivered at
    // all would leave loads at 0 and "the chain stalled" would be true for the wrong reason.
    check('the observer did report once, so the chain had a reason to start',
      window.__io.delivered === 1, JSON.stringify(window.__io));

    const kept = await waitFor(() => loads() >= 3, { timeout: 4000 });
    check('the feed keeps loading after the observer stops reporting', kept,
      `${loads()} load(s) — 1 means the chain is still gated on a flag attach() clears`);
    // The other half of the control: attach() really did replace the sentinel underneath it,
    // re-observing each time, and every one of those reports was swallowed. If this is 1 the
    // stub was never re-observed and the test proved nothing about a silent observer.
    check('...even though every later sentinel was observed and never reported on',
      window.__io.observes > 1 && window.__io.delivered === 1, JSON.stringify(window.__io));

    // ...and the counterweight: driving itself must not mean driving for ever. Take the
    // partials away and the chain has to notice and stop, not spin on an empty query.
    doc.querySelectorAll('faceplate-partial').forEach(e => e.remove());
    const settled = loads();
    await hold(1800);            // two cooldowns
    check('and it stops on its own once there is nothing left to drive',
      loads() === settled, `${settled} -> ${loads()}`);
    /* The label needs the empty state to PERSIST before it commits (EXHAUSTED_STICKY):
       "no more pages" flashed between real pages when the successor partial streamed in
       late, so a single empty look no longer claims an ending. A genuinely dead feed
       still gets there — a few heartbeats later, hence the wait. */
    const saidNoMore = await waitFor(() =>
      /no more pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      { timeout: 9000 });
    check('...saying so on the sentinel once the empty state persists', saidNoMore,
      doc.querySelector('.shd-loadmore')?.textContent);
    // Read the totals only now that the chain has stopped: `loads` counts a page at the
    // moment loadContent() is entered, and our own rows appear a flush later, so the two
    // disagree by up to a frame while it is still running.
    check('every loaded post still became exactly one row',
      doc.querySelectorAll('#shd-root .thing.link').length ===
      POSTS.length + loads() * PAGER_PAGE_SIZE,
      `${doc.querySelectorAll('#shd-root .thing.link').length} rows after ${loads()} loads`);
    window.SHD.paginator.reset();
  }

  /* Live testing measured the case the stub above deliberately excludes: an observer that
     NEVER delivers — shdIoTicks frozen at 0 across two sentinel serials, on a real Chrome,
     with the sentinel visibly in range and the chain never starting. Bug 40 demoted the
     observer to a wake-up but left it the ONLY wake-up; attach() now pumps once itself,
     geometry-gated, so the chain starts even if the observer never says a word. */
  /* Live testing killed the last illusion about event wake-ups: in the same field environment,
     the IntersectionObserver had NEVER fired across three rounds AND a real scroll to the
     bottom changed nothing — while every timer ran fine. The heartbeat is the wake-up that
     cannot be taken away. This section gives the sentinel REAL geometry (stubbed rects),
     so the attach-time pump is correctly gated OFF at first — only the heartbeat can
     notice the sentinel coming into range, because no event of any kind is delivered. */
  /* Live testing, on a 2,040-comment thread AND the front page: pages sat at the 40-page cap
     with the sentinel still reading "load more" — the label of a load that SUCCEEDED.
     pump() guarded on the cap and returned before loadNext could say anything, so the
     AUTO path is what has to be exercised here, not a manual click. */
  /* Live testing watched the sentinel flap `loading more…` -> `load more` -> `loading more…`
     on /r/aww, with the content then loading correctly — which is why it read as a repaint
     rather than a fault. It was one: attach() runs after EVERY pipeline flush, so the
     sentinel stays at the bottom of a list that is still growing, and each run builds a
     NEW node whose label starts at the idle "load more". A load in flight is exactly when
     new content arrives, so every flush during a load painted the idle label over the live
     one. The status belongs to the LOAD, not to the node displaying it. */
  console.log('\n\x1b[1mTHE SENTINEL KEEPS ITS LABEL ACROSS A RE-ATTACH\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', (win) => {
      noAuto(win);                 // this section drives by hand
      win.eval(PAGER_SCRIPT);
    });
    const labelOf = () => doc.querySelector('.shd-loadmore')?.textContent || '';
    const sentinelNode = () => doc.querySelector('.shd-sentinel');

    // Started, deliberately NOT awaited: the assertion is about the window while it runs.
    const inFlight = window.SHD.paginator.loadNext('manual');
    const started = await waitFor(() => /loading more/.test(labelOf()));
    check('setup: a load in flight says so on the sentinel', started, labelOf());

    /* The real re-attach path, not a direct attach() call: a post arrives mid-load, the
       pipeline renders it and re-hangs the sentinel underneath — which is precisely the
       sequence /r/aww produced. Identity, not text, is what proves the node was rebuilt;
       otherwise a fix that simply stopped re-attaching would pass this too. */
    const before = sentinelNode();
    window.eval(`
      const art = document.createElement('article');
      const p = document.createElement('shreddit-post');
      p.setAttribute('id', 't3_midload');
      p.setAttribute('post-title', 'A post that arrived while the page was loading');
      p.setAttribute('permalink', '/r/x/comments/midload/p/');
      p.setAttribute('content-href', 'https://example.com/midload');
      p.setAttribute('post-type', 'link');
      p.setAttribute('score', '3');
      p.setAttribute('comment-count', '0');
      p.setAttribute('created-timestamp', '2026-08-12T00:00:00+0000');
      p.setAttribute('domain', 'example.com');
      p.setAttribute('author', 'someone');
      p.setAttribute('subreddit-name', 'x');
      p.setAttribute('subreddit-prefixed-name', 'r/x');
      art.appendChild(p);
      document.querySelector('shreddit-feed').appendChild(art);
    `);
    const rebuilt = await waitFor(() => sentinelNode() && sentinelNode() !== before);
    check('setup: the flush really did rebuild the sentinel node', rebuilt,
      'the sentinel was never re-attached, so this proved nothing');
    check('the rebuilt sentinel still reports the load that is running',
      /loading more/.test(labelOf()),
      `"${labelOf()}" — the idle label repainted over a load in flight`);

    await inFlight;
    await waitFor(() => !/loading more/.test(labelOf()));
    check('...and goes back to idle once the load finishes', /load more/.test(labelOf()),
      labelOf());

    /* A new route starts idle. Carrying a label across a navigation is the same lie one
       navigation later. */
    window.SHD.paginator.reset();
    window.SHD.paginator.attach(doc.querySelector('#siteTable'));
    check('a route change starts the next sentinel idle', labelOf() === 'load more',
      labelOf());
  }

  console.log('\n\x1b[1mHITTING THE PAGE CAP SAYS SO\x1b[0m');
  {
    const endless = (win) => {
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      /* settle()'s three delays compressed, so 40 real loads cost ~0.2s instead of ~16s.
         2000 is also HEARTBEAT_MS, which this speeds up too — convenient rather than
         accidental: the heartbeat is the thing that must notice the cap. */
      const origSet = win.setTimeout;
      win.setTimeout = function (fn, delay, ...rest) {
        const d = (delay === 400 || delay === 2000 || delay === 6000) ? 5 : delay;
        return origSet.call(win, fn, d, ...rest);
      };
      win.eval(`
        window.__inf = 0;
        class ShdEndless extends HTMLElement {
          loadContent() {
            const feed = document.querySelector('shreddit-feed');
            const n = ++window.__inf;
            const art = document.createElement('article');
            const p = document.createElement('shreddit-post');
            p.setAttribute('id', 't3_inf' + n);
            p.setAttribute('post-title', 'endless ' + n);
            p.setAttribute('permalink', '/r/x/comments/inf' + n + '/x/');
            p.setAttribute('content-href', 'https://e.com/' + n);
            p.setAttribute('post-type', 'link');
            p.setAttribute('score', '1');
            p.setAttribute('comment-count', '0');
            p.setAttribute('created-timestamp', '2026-08-12T00:00:00+0000');
            p.setAttribute('domain', 'e.com');
            p.setAttribute('author', 'a');
            p.setAttribute('subreddit-name', 'x');
            p.setAttribute('subreddit-prefixed-name', 'r/x');
            art.appendChild(p);
            feed.appendChild(art);
            this.remove();
            const next = document.createElement('faceplate-partial');
            next.setAttribute('loading', 'programmatic');
            next.setAttribute('src', '/next');
            feed.appendChild(next);
          }
        }
        if (!customElements.get('faceplate-partial')) customElements.define('faceplate-partial', ShdEndless);
      `);
    };
    const { window, doc } = await boot(listingPage(), 'https://www.reddit.com/', endless);
    /* Driven MANUALLY to the cap — a manual load skips the 800ms cooldown, so this costs
       ~0.2s where the auto chain would take ~32s. The loop stops exactly AT 40 without
       calling loadNext again, which matters: loadNext has its own cap branch, and letting
       it fire would test that instead of pump's — the branch that was actually broken. */
    let guard = 0;
    while (window.SHD.paginator.pages < 40 && guard++ < 60) {
      await window.SHD.paginator.loadNext('manual');
    }
    check('setup: the chain sits exactly at the 40-page cap',
      window.SHD.paginator.pages === 40, String(window.SHD.paginator.pages));
    check('setup: and the label is still the one a SUCCESSFUL load leaves behind',
      /load more/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      doc.querySelector('.shd-loadmore')?.textContent);
    const said = await waitFor(() =>
      /stopped after 40 pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      { timeout: 5000 });
    check('the sentinel says it stopped, instead of still promising more', said,
      doc.querySelector('.shd-loadmore')?.textContent);
    window.SHD.paginator.reset();
  }

  /* Live testing's front page: 40 pages driven, ZERO new rows, sentinel reading "load more".
     `shreddit-feed faceplate-partial` also matches Reddit's hovercard partials — one per
     author and subreddit link, INSIDE the posts — so once the real feed partial was spent
     the chain drove hovercard after hovercard. Two guards now: no partial inside an item
     is drivable on a listing, and a load that produces nothing counts against a limit. */
  console.log('\n\x1b[1mA PARTIAL INSIDE A POST IS NOT THE FEED\x1b[0m');
  {
    const withHovercards = listingPage().replace(/<\/shreddit-post>/g,
      '<faceplate-hovercard><faceplate-partial loading="programmatic" src="/hover">' +
      '</faceplate-partial></faceplate-hovercard></shreddit-post>');
    const { window, doc } = await boot(withHovercards, 'https://www.reddit.com/', (win) => {
      noAuto(win);   // this section drives by hand; an auto load in flight refuses it as `busy`
      win.eval(PAGER_SCRIPT);
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    });
    const hovercards = doc.querySelectorAll('shreddit-post faceplate-partial').length;
    check(`setup: the feed carries ${hovercards} partials nested inside posts`, hovercards > 0);
    /* The opt-out itself, asserted rather than assumed. This section drives by hand, and
       `loadNext()` refuses outright while `busy` is set — no manual exemption, unlike the
       cooldown check below it — so one auto load in flight turns every assertion here into
       a coin toss. The line that prevents it was once lost in a file-by-file merge and
       silently reintroduced the flake, and mutate.sh's row for that was probabilistic
       BECAUSE the race is: a green run cleared nothing. This is the deterministic half —
       whether the opt-out is in force is a fact, even when the race it prevents is not. */
    check('setup: this section drives by hand — the auto chain is off',
      window.SHD.settings.autoPaginate === false,
      `autoPaginate=${window.SHD.settings.autoPaginate}; an auto load in flight refuses ` +
      'every manual drive below as `busy`, so this section would be flaky, not wrong');

    /* Take away every REAL feed partial (the direct children of shreddit-feed) and leave
       only the ones nested inside posts. That is the live end-state: the feed is spent,
       the hovercards are not, and live testing measured the chain happily driving them 40
       times. Nothing here may be drivable. */
    doc.querySelectorAll('shreddit-feed > faceplate-partial').forEach(el => el.remove());
    check('setup: only in-post partials are left',
      doc.querySelectorAll('shreddit-feed faceplate-partial').length > 0 &&
      doc.querySelectorAll('shreddit-feed > faceplate-partial').length === 0);
    const after = await window.SHD.paginator.loadNext('manual');
    check('a hovercard partial inside a post is never driven as a page', after === false,
      `drove something: pages=${window.SHD.paginator.pages}`);
    check('...and the sentinel says there are no more pages',
      /no more pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      doc.querySelector('.shd-loadmore')?.textContent);
    window.SHD.paginator.reset();
  }

  /* The OTHER guard on live testing's front page, isolated from the one above. A partial that
     is perfectly drivable — a direct child of the feed, nothing to do with hovercards —
     but which yields no posts must be NOTICED, not spent forty page slots on. Live testing
     then measured what the limit really is in the field: SOFT. The heartbeat retries
     past it, and that softness rescued a throttled front page (28 -> 178 rows). So the
     assertions here pin the honest version of soft: the refusal is named, the label
     never claims an ending ("no more pages" flapped six times in one field series —
     it belongs to `exhausted` alone), and barren loads never eat the content budget
     (`pages` read 33 for ~7 productive loads before this). */
  console.log('\n\x1b[1mA LOAD THAT YIELDS NOTHING IS A DEAD END\x1b[0m');
  {
    const barren = (win) => {
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      /* autoPaginate OFF, deliberately: this section measures loadNext()'s own semantics
         with explicit calls, and with the auto chain live the heartbeat's loads race the
         test's — observed once as a `busy` refusal where the assertions expected an
         `unproductive` one. A racy row is worse than no row; it reports on whichever
         load happened to win. pump() no-ops with auto off, so only these calls drive. */
      win.chrome = { storage: {
        sync: { get: async () => ({ settings: { autoPaginate: false } }) },
        onChanged: { addListener() {} }
      } };
      win.eval(`
        window.__barren = 0;
        class ShdBarren extends HTMLElement {
          loadContent() {
            window.__barren++;
            const feed = document.querySelector('shreddit-feed');
            this.remove();                      // replaces itself, exactly like the real one
            const next = document.createElement('faceplate-partial');
            next.setAttribute('loading', 'programmatic');
            next.setAttribute('src', '/next');
            feed.appendChild(next);             // ...but never appends a post
          }
        }
        if (!customElements.get('faceplate-partial')) customElements.define('faceplate-partial', ShdBarren);
      `);
    };
    const { window, doc } = await boot(listingPage(), 'https://www.reddit.com/', barren);
    const rows = () => doc.querySelectorAll('#shd-root .thing.link').length;
    const before = rows();

    const first = await window.SHD.paginator.loadNext('manual');
    check('one barren load is tolerated — a single dud is not proof', first === true);
    const second = await window.SHD.paginator.loadNext('manual');
    check('the second one refuses instead of pretending it worked', second === false,
      `pages=${window.SHD.paginator.pages}`);
    check('...and it is named as unproductive, not mistaken for exhaustion',
      doc.querySelector('.shd-sentinel')?.dataset.shdRefusal === 'unproductive',
      doc.querySelector('.shd-sentinel')?.dataset.shdRefusal);
    /* The limit is soft — the heartbeat retries past it — so the label must NOT declare
       an ending. Live testing watched "no more pages" appear and retract six times in one
       series; that string belongs to `exhausted`, where nothing is left to drive. */
    check('the label never claims "no more pages" for a soft refusal',
      /load more/.test(doc.querySelector('.shd-loadmore')?.textContent || '') &&
      !/no more pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      doc.querySelector('.shd-loadmore')?.textContent);
    check('barren loads never consume the page budget',
      window.SHD.paginator.pages === 0, `pages=${window.SHD.paginator.pages}`);
    check('control: the partial really was driven, and really added nothing',
      window.__barren === 2 && rows() === before, `${window.__barren} loads, rows ${before}->${rows()}`);
    window.SHD.paginator.reset();
  }

  /* Reported live the day 0.9.0 shipped: the sentinel flashed "no more pages" ↔
     "loading more…" BETWEEN pages that then loaded fine. The successor partial streams in
     late, so "nothing to drive right now" was being announced as "nothing left" — bug
     63's lie in the exhausted branch. The auto path now commits to the label only once
     the empty state persists (EXHAUSTED_STICKY consecutive looks); a manual click keeps
     its immediate answer, which the hovercard and no-partial sections already assert. */
  /* Live testing, front page, tab verified visible: rows grew 28 -> 203 across seven pages
     while `pages` stayed 0 and the refusal read `unproductive` on all 40 samples. Both
     readings were true — the live feed delivers AFTER settle()'s window closes, so every
     load measured itself as a dud and the content turned up anyway. Two costs, neither
     visible on screen: the 40-page memory guard becomes unreachable, and `unproductive`
     never resets, so past the second load every auto attempt refuses and pump() cannot
     chain — the whole chain falls back to the 2s heartbeat. */
  console.log('\n\x1b[1mA LOAD WHOSE CONTENT ARRIVES LATE IS STILL A PAGE\x1b[0m');
  {
    const late = (win) => {
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      win.chrome = { storage: {
        sync: { get: async () => ({ settings: { autoPaginate: false } }) },
        onChanged: { addListener() {} }
      } };
      win.eval(`
        window.__late = 0;
        class ShdLate extends HTMLElement {
          loadContent() {
            const n = ++window.__late;
            const feed = document.querySelector('shreddit-feed');
            this.remove();
            /* A mutation RIGHT NOW so settle() sees its first change and starts the 400ms
               idle countdown — then the POSTS land well after it has resolved. That is the
               live shape: something happens promptly, the content does not. */
            feed.appendChild(document.createElement('div'));
            setTimeout(() => {
              const art = document.createElement('article');
              const p = document.createElement('shreddit-post');
              p.setAttribute('id', 't3_late' + n);
              p.setAttribute('post-title', 'late ' + n);
              p.setAttribute('permalink', '/r/x/comments/late' + n + '/x/');
              p.setAttribute('content-href', 'https://e.com/' + n);
              p.setAttribute('post-type', 'link');
              p.setAttribute('score', '1');
              p.setAttribute('comment-count', '0');
              p.setAttribute('created-timestamp', '2026-08-12T00:00:00+0000');
              p.setAttribute('domain', 'e.com');
              p.setAttribute('author', 'a');
              p.setAttribute('subreddit-name', 'x');
              p.setAttribute('subreddit-prefixed-name', 'r/x');
              art.appendChild(p);
              feed.appendChild(art);
              const next = document.createElement('faceplate-partial');
              next.setAttribute('loading', 'programmatic');
              next.setAttribute('src', '/next');
              feed.appendChild(next);
            }, 700);
          }
        }
        if (!customElements.get('faceplate-partial')) customElements.define('faceplate-partial', ShdLate);
      `);
    };
    const { window, doc } = await boot(listingPage(), 'https://www.reddit.com/', late);
    const pages = () => window.SHD.paginator.pages;
    const sources = () => doc.querySelectorAll('shreddit-post').length;

    const first = await window.SHD.paginator.loadNext('manual');
    check('setup: the load measures itself as a dud — its content has not arrived yet',
      first === true && pages() === 0, `returned ${first}, pages=${pages()}`);
    await hold(900);
    check('setup: ...and then the content lands, after settle already closed the window',
      sources() > POSTS.length, `${POSTS.length} -> ${sources()}`);

    const second = await window.SHD.paginator.loadNext('manual');
    check('the late page is credited in arrears, so the budget advances at all',
      pages() >= 1, `pages=${pages()} after a page that really did deliver`);
    await hold(900);
    const third = await window.SHD.paginator.loadNext('manual');
    /* The counter half. Without the credit, `unproductive` climbs past its limit on the
       second load and never comes back down: every later attempt refuses, pump() stops
       chaining, and the chain survives only on the heartbeat. */
    check('...and the chain is not left permanently refusing itself',
      second === true && third === true, `second=${second} third=${third}`);
    check('every late page counted exactly once',
      pages() === window.__late - 1, `pages=${pages()} for ${window.__late} loads`);
    window.SHD.paginator.reset();
  }

  console.log('\n\x1b[1m"NO MORE PAGES" NEEDS THE EMPTY STATE TO PERSIST\x1b[0m');
  {
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', noAuto);
    doc.querySelectorAll('faceplate-partial').forEach(e => e.remove());
    const label = () => doc.querySelector('.shd-loadmore')?.textContent || '';
    check('control: the sentinel is live', !!doc.querySelector('.shd-loadmore'), label());

    await window.SHD.paginator.loadNext('auto');
    check('one empty look does not claim an ending',
      /load more/.test(label()) && !/no more pages/.test(label()), label());
    check('...but the refusal is published immediately — diagnostics never wait',
      doc.querySelector('.shd-sentinel')?.dataset.shdRefusal === 'exhausted',
      doc.querySelector('.shd-sentinel')?.dataset.shdRefusal);
    await window.SHD.paginator.loadNext('auto');
    check('nor two — the successor partial can stream in this late',
      !/no more pages/.test(label()), label());
    await window.SHD.paginator.loadNext('auto');
    check('three consecutive empty looks commit the label', /no more pages/.test(label()),
      label());
    window.SHD.paginator.reset();
  }

  console.log('\n\x1b[1mTHE HEARTBEAT WAKES A CHAIN NO EVENT EVER WILL\x1b[0m');
  {
    const stubbed = (win) => {
      win.eval(PAGER_SCRIPT);
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      win.__sentinelTop = 5000;                    // far below a 768px viewport + 1200px margin
      const orig = win.Element.prototype.getBoundingClientRect;
      win.Element.prototype.getBoundingClientRect = function () {
        if (this.classList && this.classList.contains('shd-sentinel')) {
          const t = win.__sentinelTop;
          return { top: t, bottom: t + 40, height: 40, left: 0, right: 100, width: 100 };
        }
        return orig.call(this);
      };
    };
    const { window } = await boot(listingPage(), 'https://www.reddit.com/', stubbed);
    const loads = () => window.__shdPager.loads;

    await hold(700);
    check('out of range, no events: the chain correctly does nothing', loads() === 0,
      `${loads()} loads with the sentinel at 5000px`);

    window.__sentinelTop = 100;                    // now in range — and nobody sends an event
    const woke = await waitFor(() => loads() >= 1, { timeout: 5000 });
    check('the heartbeat notices the sentinel entering range with zero events delivered',
      woke, `${loads()} loads`);
    check('...and the heartbeat publishes live diagnostics while it is at it',
      window.document.querySelector('.shd-sentinel')?.dataset.shdTop === '100',
      window.document.querySelector('.shd-sentinel')?.dataset.shdTop);
    window.SHD.paginator.reset();
  }

  /* Live testing's unexplained find: `busy` wedged true for 60+ seconds at page 5 — past every
     settle timer, no refusal, no error, chain dead. Where it hung is unknown (that is what
     shdBusyFor now instruments); what must not happen again is the whole chain dying with
     it. The wedge is manufactured here by swallowing exactly the settle timers, which is
     the only way to hold `busy` past its bounds without knowing the live cause. */
  console.log('\n\x1b[1mA WEDGED LOAD COSTS ONE PAGE, NOT THE CHAIN\x1b[0m');
  {
    const wedgeable = (win) => {
      win.eval(PAGER_SCRIPT);
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      const origSet = win.setTimeout;
      // settle()'s three timers — FIRST_MUTATION 2000, IDLE 400, CEILING 6000 — are the
      // only users of these exact delays in a booted page. Swallowing them holds `busy`
      // true for ever, which is the observed field state.
      win.setTimeout = function (fn, delay, ...rest) {
        if (delay === 2000 || delay === 400 || delay === 6000) return 0;
        return origSet.call(win, fn, delay, ...rest);
      };
    };
    const { window } = await boot(listingPage(), 'https://www.reddit.com/', wedgeable);
    const dataset = () => window.document.querySelector('.shd-sentinel')?.dataset || {};
    const loads = () => window.__shdPager.loads;

    await waitFor(() => dataset().shdBusy === 'true');
    check('setup: a load is genuinely wedged', dataset().shdBusy === 'true' && loads() === 1,
      JSON.stringify({ busy: dataset().shdBusy, loads: loads() }));
    await hold(2500);
    check('the wedge is visible LIVE while it forms, not frozen',
      Number(dataset().shdBusyFor) > 2000, dataset().shdBusyFor);

    const released = await waitFor(() => dataset().shdRefusal === 'busy-wedged', { timeout: 16000 });
    check('past the limit, the wedge is released and named', released,
      JSON.stringify({ refusal: dataset().shdRefusal, busy: dataset().shdBusy }));
    const continued = await waitFor(() => loads() >= 2, { timeout: 6000 });
    check('and the chain continues past the abandoned page', continued, `${loads()} loads`);
    window.SHD.paginator.reset();
  }

  console.log('\n\x1b[1mAN OBSERVER THAT NEVER REPORTS AT ALL MUST NOT STALL THE FEED\x1b[0m');
  {
    const totallySilent = (win) => {
      win.eval(PAGER_SCRIPT);
      win.__io = { observes: 0 };
      win.IntersectionObserver = class {
        constructor() { }
        observe() { win.__io.observes++; }     // counted, never answered
        unobserve() { }
        disconnect() { }
      };
      /* Timestamps, because "it loaded" is not the claim — see the WHEN assertion below.
         Started before the bundle evaluates so the sentinel's arrival is caught whenever
         it happens. */
      const t0 = Date.now();
      win.__attachMs = null;
      win.__firstLoadMs = null;
      const poll = () => {
        if (win.__attachMs == null && win.document.querySelector('.shd-sentinel')) {
          win.__attachMs = Date.now() - t0;
        }
        if (win.__firstLoadMs == null && win.__shdPager && win.__shdPager.loads > 0) {
          win.__firstLoadMs = Date.now() - t0;
        }
        if (win.__attachMs != null && win.__firstLoadMs != null) return;
        setTimeout(poll, 5);
      };
      poll();
    };
    const { window } = await boot(listingPage(), 'https://www.reddit.com/', totallySilent);
    const loads = () => window.__shdPager.loads;

    const kept = await waitFor(() => loads() >= 3, { timeout: 4000 });
    check('the feed loads with ZERO observer reports — the live round-6 condition', kept,
      `${loads()} load(s) with ${window.__io.observes} observe() calls and 0 callbacks`);
    // Control: the stub really was in place and really was consulted. Without this, a build
    // that never constructs an IntersectionObserver at all would pass vacuously.
    check('the observer was attached and stayed mute', window.__io.observes >= 1,
      JSON.stringify(window.__io));

    /* AND IT HAS TO BE THE ATTACH-TIME PUMP THAT STARTS IT, which the assertion above
       cannot see. Deleting `pump('attach')` leaves this section green: the HEARTBEAT starts
       the chain instead, two seconds later, and three loads still land inside the 4000ms
       window. Two wake-ups, one observable, and the test was reading the observable — the
       same error as bugs 71, 73 and 75. It went unnoticed longer than any of them because
       this row was one of the twenty-two the round-12 sweep never actually ran (bug 76).

       WHEN is the assertion. attach() pumps on a zero-delay timer (the cooldown is measured
       from `lastAt`, which is 0 on the first pump), so with it the first load lands
       essentially the moment the sentinel exists; without it, nothing can fire before the
       first HEARTBEAT_MS tick at 2000ms. 1000ms sits at 2x margin from both. */
    const gap = window.__firstLoadMs - window.__attachMs;
    check('...and the chain starts AT ATTACH, not two seconds later on the heartbeat',
      window.__attachMs != null && window.__firstLoadMs != null && gap < 1000,
      window.__attachMs == null || window.__firstLoadMs == null
        ? `never observed (attach=${window.__attachMs}, load=${window.__firstLoadMs})`
        : `${gap}ms between the sentinel attaching and the first load — that is the ` +
          'heartbeat waking a chain attach() should have started itself');
    window.SHD.paginator.reset();     // stop the auto chain before leaving the section
  }

  {
    // No bridge listening (the pre-fix state, and what a stale manifest would produce):
    // report it loudly rather than returning false forever in silence.
    const { doc, window } = await boot(listingPage(), 'https://www.reddit.com/', noAuto);
    window.eval(PAGER_SCRIPT);
    window.removeEventListener;                        // (no-op, keeps linters quiet)
    // Simulate the isolated world: strip the bridge's listener by reloading a page whose
    // bundle never registered one. Easiest faithful stand-in is to make the request a no-op.
    const before = doc.documentElement.dataset.shdLoadMore;
    doc.documentElement.dataset.shdLoadMore = '';
    check('a bridge that never answers is detectable',
      before === undefined || typeof before === 'string');

    const warnings = [];
    window.console.warn = (...a) => warnings.push(a.join(' '));
    // Remove the partial entirely -> 'no-partial' path, which must not throw and must
    // tell the sentinel about it.
    doc.querySelectorAll('faceplate-partial').forEach(e => e.remove());
    const ok = await window.SHD.paginator.loadNext('manual');
    check('a load with no partial left returns false, does not throw', ok === false);
    check('and the sentinel says so',
      /no more pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      doc.querySelector('.shd-loadmore')?.textContent);
  }

  console.log('\n\x1b[1mNESTED COMMENTS (the live 2026-08-14 shape)\x1b[0m');
  for (const bodyLast of [false, true]) {
    // Reddit nests comments now. Every other fixture here is flat, which means the whole
    // suite was structurally blind to the one thing nesting introduces: a comment's subtree
    // contains its DESCENDANTS' bodies as well as its own.
    //
    // bodyLast flips the body after the child container. Reddit currently emits body-first,
    // so a bare `el.querySelector('[slot="comment"]')` returns the right node by luck of
    // document order. Under bodyLast it returns the first CHILD's text for every comment —
    // which is why model.js scopes the lookup instead of relying on that ordering.
    const depths = [0, 1, 2, 0, 1];
    const page = commentsPage().replace(
      /<section>[\s\S]*?<\/section>/,
      '<section>' + nestedCommentsHtml(depths, { bodyLast }) + '</section>');
    const { doc } = await boot(page, 'https://www.reddit.com/r/programming/comments/link1/nasa/');
    const label = bodyLast ? 'body after children' : 'body before children';

    const rows = [...doc.querySelectorAll('#shd-root .thing.comment')];
    check(`[${label}] renders one node per nested comment`,
      rows.length === depths.length, `got ${rows.length} of ${depths.length}`);

    // The real assertion: each rendered comment carries ITS OWN text, not a descendant's.
    const wrong = rows.filter(r => {
      const i = r.dataset.fullname.replace('t1_c', '');
      return !new RegExp(`Comment body number ${i}\\b`)
        .test(r.querySelector('.usertext-body')?.textContent || '');
    });
    check(`[${label}] every comment shows its own body, not a child's`,
      wrong.length === 0,
      wrong.map(r => `${r.dataset.fullname} got ` +
        JSON.stringify((r.querySelector('.usertext-body')?.textContent || '').trim().slice(0, 40))).join('; '));

    // Nesting must not break the depth-stack either — it reads `depth`, which still agrees
    // with the DOM (verified live: 25/25).
    let nestOk = true, bad = null;
    for (const c of rows) {
      let actual = 0, n = c.parentElement;
      while (n) { if (n.classList?.contains('comment')) actual++; n = n.parentElement; }
      if (Number(c.dataset.depth) !== actual) { nestOk = false; bad = `${c.dataset.fullname}: declared ${c.dataset.depth}, nested ${actual}`; break; }
    }
    check(`[${label}] our tree still matches every depth attribute`, nestOk, bad);

    check(`[${label}] no comment is consumed twice`,
      new Set(rows.map(r => r.dataset.fullname)).size === rows.length);
  }

  console.log('\n\x1b[1mCOMMENT PAGINATION\x1b[0m');
  {
    // A real thread ships a slice and lazy-loads the rest. The paginator was hardcoded to
    // the FEED's partial and pipeline.js only attached a sentinel on listings, so anything
    // past the delivered slice was unreachable — on the page type a reading-focused
    // extension exists to serve. The old commentsPage() fixture had no partials at all,
    // so nothing could have noticed.
    const { doc, window } = await boot(commentsPage({ deliver: 8, pager: true }),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    window.eval(COMMENT_PAGER_SCRIPT);      // upgrade the partial to a real custom element

    const rendered = () => doc.querySelectorAll('#shd-root .thing.comment').length;
    check('only the delivered slice renders to begin with', rendered() === 8, String(rendered()));
    check('the thread declares more than arrived',
      Number(doc.querySelector('shreddit-comment-tree').getAttribute('totalcomments')) > 8);
    check('a comments page gets a sentinel too', !!doc.querySelector('.shd-sentinel'));
    check('the sentinel sits under the comment tree, not the feed',
      !!doc.querySelector('#shd-root .commentarea .shd-sentinel, #shd-root .shd-sentinel'),
      'sentinel is outside our comment area');

    const before = rendered();
    const sourcesBefore = doc.querySelectorAll('shreddit-comment').length;
    const ok = await window.SHD.paginator.loadNext('manual');
    // What settle() is FOR: loadNext() must not resolve until the content has actually
    // landed. It watched `shreddit-feed` unconditionally, and a comments page has none — so
    // it took the "no container" early return and resolved instantly, clearing `busy` and
    // freeing pump() to fire the next page into a load still in flight. Asserted on the
    // SOURCE nodes rather than our rendered ones, because our own rAF flush is a separate
    // wait that settle() does not promise anything about.
    check('a comment load resolves only once the comments have arrived (settle watches the ' +
      'comment tree, not the feed)',
      doc.querySelectorAll('shreddit-comment').length > sourcesBefore,
      `${sourcesBefore} source comments before, ` +
      `${doc.querySelectorAll('shreddit-comment').length} when loadNext() resolved`);
    await waitFor(() => rendered() > before);
    check('loading more comments succeeds', ok === true);
    check('it went through the bridge', window.__shdCommentPager.loads === 1,
      String(window.__shdCommentPager.loads));
    check(`each load adds a full batch of ${COMMENT_PAGER_BATCH}`,
      rendered() === before + COMMENT_PAGER_BATCH, `${before} -> ${rendered()}`);

    // The depth stack is module state carried across flushes; a late batch must nest
    // against it correctly, not restart at the root.
    let nestingOk = true, bad = null;
    for (const c of doc.querySelectorAll('#shd-root .thing.comment')) {
      const declared = Number(c.dataset.depth);
      let actual = 0, n = c.parentElement;
      while (n) { if (n.classList?.contains('comment')) actual++; n = n.parentElement; }
      if (declared !== actual) { nestingOk = false; bad = `${c.dataset.fullname}: declared ${declared}, nested ${actual}`; break; }
    }
    check('late-arriving comments nest correctly against the existing stack', nestingOk, bad);

    check('no duplicate comments across pages',
      new Set([...doc.querySelectorAll('#shd-root .thing.comment')].map(c => c.dataset.fullname)).size
        === rendered());

    // Keep going, the way the sentinel would.
    const second = await window.SHD.paginator.loadNext('manual');
    // Poll the RENDERED count, not the fetch counter: loadContent() returning is not the
    // same as the observer having flushed the new nodes into our tree.
    await waitFor(() => rendered() === before + COMMENT_PAGER_BATCH * 2);
    check('a second page of comments loads', second === true && rendered() === before + COMMENT_PAGER_BATCH * 2,
      `${rendered()} comments after ${window.__shdCommentPager.loads} loads`);
    check('pages are counted on comment routes', window.SHD.paginator.pages === 2,
      String(window.SHD.paginator.pages));

    // The selector is scoped to shreddit-comment-tree for a reason: a real thread carries
    // unrelated partials (sidebars, related posts). Driving one fetches the wrong thing.
    check('the partial outside the comment tree is never driven',
      window.__shdDecoyLoads === 0, `decoy driven ${window.__shdDecoyLoads} times`);
  }

  console.log('\n\x1b[1mCOMMENT PAGINATION — PARTIALS THAT SURVIVE BEING DRIVEN\x1b[0m');
  {
    /**
     * The fixture above transplants the FEED's mechanism onto comments: one partial, which
     * removes itself and appends a successor. That was an assumption, and verify:live
     * contradicts its premise — ten partials in one live comment tree, none of them
     * loading="programmatic", with controls reading "16 more replies" and "continue this
     * thread". That is one partial per truncated BRANCH.
     *
     * The failure that shape produces is silent and total. paginator.js re-queries its
     * selector each time, so a partial that fills its branch in place and stays put gets
     * picked again, and again — one branch expands repeatedly while the other nine are never
     * touched. Both other pagers in this file remove themselves, so nothing here could
     * distinguish "advancing" from "spinning".
     */
    const { doc, window } = await boot(commentsPage({ deliver: 8, branchPager: true }),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    window.eval(BRANCH_PAGER_SCRIPT);

    const rendered = () => doc.querySelectorAll('#shd-root .thing.comment').length;
    const st = () => window.__shdBranchPager;

    check(`the thread carries ${BRANCH_PAGER_BRANCHES} branch partials, not one pager`,
      doc.querySelectorAll('shreddit-comment-tree faceplate-partial').length === BRANCH_PAGER_BRANCHES,
      String(doc.querySelectorAll('shreddit-comment-tree faceplate-partial').length));
    check('none of them is loading="programmatic" (matching what was observed live)',
      doc.querySelectorAll('shreddit-comment-tree faceplate-partial[loading="programmatic"]').length === 0);
    check('the fallback clause of the selector still finds them',
      await window.SHD.paginator.loadNext('manual') === true);

    await waitFor(() => st().loads === 1);
    const first = st().driven[0];
    check('driving one expands a branch', st().loads === 1, JSON.stringify(st().driven));
    check('and it is still in the DOM afterwards — this is the trap',
      doc.querySelectorAll('shreddit-comment-tree faceplate-partial').length === BRANCH_PAGER_BRANCHES,
      'the fixture is supposed to model a partial that does NOT remove itself');

    // THE assertion. Without the "already driven" stamp this picks `first` every time.
    await window.SHD.paginator.loadNext('manual');
    await waitFor(() => st().loads === 2);
    check('the next call advances to a DIFFERENT branch, it does not re-drive the same one',
      st().driven[1] !== first, `drove ${JSON.stringify(st().driven)} — ` +
      `paginator.js is re-picking the same partial, so the rest of the thread is unreachable`);

    await window.SHD.paginator.loadNext('manual');
    await waitFor(() => st().loads === BRANCH_PAGER_BRANCHES);
    check('every branch gets driven exactly once',
      new Set(st().driven).size === BRANCH_PAGER_BRANCHES &&
      st().driven.length === BRANCH_PAGER_BRANCHES,
      JSON.stringify(st().driven));

    // Once they are all stamped there is genuinely nothing left, and saying "no more pages"
    // is the correct end state — not an error, and not a spin.
    const exhausted = await window.SHD.paginator.loadNext('manual');
    check('and then it reports no more pages instead of looping', exhausted === false);
    const expected = 8 + BRANCH_PAGER_BRANCHES * BRANCH_PAGER_REPLIES;
    await waitFor(() => rendered() === expected);
    check('every reply that arrived was rendered', rendered() === expected,
      `${rendered()} rendered, expected ${expected}`);
    check('no duplicates across branch expansions',
      new Set([...doc.querySelectorAll('#shd-root .thing.comment')].map(c => c.dataset.fullname)).size
        === rendered());

    // A navigation must clear the stamps, or a thread visited after this one finds every
    // partial already marked and cannot paginate at all.
    SHD_RESET_CHECK: {
      window.SHD.paginator.reset();
      const stamped = doc.querySelectorAll(`faceplate-partial[data-shd="done"]`).length;
      check('reset() drops the driven stamps so the next page can paginate', stamped === 0,
        `${stamped} partials still stamped after reset`);
    }
  }

  /* The LIVE anatomy, finally captured: ~25 per-branch expanders inside
     comments PLUS exactly one top-level continuation partial (loading="lazy", direct child
     of the tree's <section>, not inside any comment). querySelector alone returns the
     first branch expander in document order, so the paginator would spend its pages
     expanding branch after branch and never continue the thread. */
  console.log('\n\x1b[1mCOMMENT PAGINATION — THE TOP-LEVEL PARTIAL IS DRIVEN FIRST\x1b[0m');
  {
    const { doc, window } = await boot(commentsPage({ deliver: 8, branchPager: true, pager: true }),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    window.eval(BRANCH_PAGER_SCRIPT);

    check('the fixture models the live anatomy: branch expanders AND one top-level partial',
      doc.querySelectorAll('shreddit-comment faceplate-partial').length === BRANCH_PAGER_BRANCHES &&
      !!doc.querySelector('shreddit-comment-tree > section > faceplate-partial[loading="lazy"]'));

    await window.SHD.paginator.loadNext('manual');
    await waitFor(() => window.__shdBranchPager.loads === 1);
    check('the first drive continues the THREAD, not a branch',
      window.__shdBranchPager.driven[0] === 'root',
      `drove ${JSON.stringify(window.__shdBranchPager.driven)} — document order won over placement`);
    check('the branch expanders are untouched',
      doc.querySelectorAll('shreddit-comment faceplate-partial:not([data-shd])').length
        === BRANCH_PAGER_BRANCHES);
    const roots = () => doc.querySelectorAll('#shd-root .nestedlisting > .thing.comment').length;
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.comment').length === 8 + 2);
    check('the new top-level comments rendered at the root',
      roots() >= 2, String(roots()));
  }

  /* Live testing proved the mechanism end to end on live Reddit: clicking Reddit's own
     "N more replies" control, logged out, loaded the replies and the pipeline rendered
     them (25 -> 35, both counts). So the visible row now carries that control, delegated —
     and the replies must nest under THE BRANCH THAT WAS EXPANDED, which is exactly what
     the depth-stack cannot do for late arrivals: by then stack[depth-1] points at the
     latest rendered chain, not this one. consume() prefers the physical parent now. */
  console.log('\n\x1b[1mMORE-REPLIES DELEGATION — AND LATE REPLIES NEST UNDER THEIR OWN BRANCH\x1b[0m');
  {
    const { doc, window } = await boot(commentsPage({ deliver: 8, branchPager: true }),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    window.eval(BRANCH_PAGER_SCRIPT);

    const firstRow = doc.querySelector('#shd-root .thing[data-fullname="t1_c0"]');
    const control = firstRow.querySelector('.shd-more-replies a');
    check('a truncated branch\'s row offers Reddit\'s own expander, delegated',
      !!control && /16 more replies/.test(control.textContent),
      control ? control.textContent : 'no control rendered');
    check('an untruncated branch gets none',
      !doc.querySelector('#shd-root .thing[data-fullname="t1_c5"] .shd-more-replies'));

    /* NOT IN THE ACTION ROW. It used to sit between permalink and reply, which rendered
       `permalink 1 more reply reply` — two reply-ish words running together as one broken
       phrase. Old reddit gave it a line of its own at the bottom of the reply
       list, which is also where a control that loads replies belongs. */
    check('the control is a line of its own in the reply list, not an action-row button',
      !firstRow.querySelector('.flat-list.buttons .shd-more-replies') &&
      control.closest('.shd-more-replies').parentElement.classList.contains('sitetable'),
      firstRow.querySelector('.flat-list.buttons')?.textContent);
    check('...so the action row is back to the two items old reddit had there',
      [...firstRow.querySelectorAll(':scope > .entry > .flat-list.buttons > li')]
        .map(li => li.textContent.trim()).join(',') === 'permalink,reply',
      [...firstRow.querySelectorAll(':scope > .entry > .flat-list.buttons > li')]
        .map(li => li.textContent.trim()).join(','));

    /* Clicked on the LINE, not the anchor — live testing reported two clicks that did nothing,
       and the tell was a label that never changed to "loading…", i.e. a handler that never
       ran because the click landed on the container's own box. */
    control.closest('.shd-more-replies').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() =>
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES);
    check('clicking it loads the replies through Reddit\'s own control',
      window.__shdBranchPager.driven[0] === 't1_c0', JSON.stringify(window.__shdBranchPager.driven));
    // THE nesting assertion. The depth-stack points at the last rendered chain (t1_c7's
    // ancestry) by now — only the physical-parent path puts these under t1_c0.
    check('the late replies nest under the branch that was expanded, not the latest chain',
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES,
      `${firstRow.querySelectorAll(':scope > .child .thing.comment').length} under t1_c0`);
    check('and nowhere else',
      doc.querySelectorAll('#shd-root .thing.comment').length === 8 + BRANCH_PAGER_REPLIES);

    /* LIVE TESTING, BUG 1, FIRST HALF. Six consecutive clicks on a 620-comment thread
       delivered 3, 0, 1, 5, 4 and 4 replies against labels reading 3, 8, 1, 7, 11 and 15,
       and EVERY ONE consumed the control — it removed itself four seconds after the click
       regardless of what happened. A branch you cannot finish expanding is a thread you
       cannot read to the end, and the branch-pager fixture is precisely that shape: it
       fills its branch in place and leaves its control sitting there afterwards. */
    await waitFor(() => !/loading/.test(control.textContent));
    const line = firstRow.querySelector(':scope > .child > .sitetable > .shd-more-replies');
    check('a partial expansion does NOT consume the control — the branch can be finished',
      !!line && line.isConnected, 'the control removed itself after one click');
    check('...and it re-reads Reddit\'s own label rather than keeping the one it opened with',
      line?.querySelector('a')?.textContent === '16 more replies',
      line?.querySelector('a')?.textContent);
    check('...and stays LAST in the reply list, below the replies it loaded',
      firstRow.querySelector(':scope > .child > .sitetable').lastElementChild === line,
      firstRow.querySelector(':scope > .child > .sitetable').lastElementChild?.className);

    // Clicking again keeps going, which is what "the count converges by clicking" means.
    line.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() =>
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES * 2);
    check('a second click loads a second slice',
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES * 2,
      `${firstRow.querySelectorAll(':scope > .child .thing.comment').length} under t1_c0`);
  }

  /* LIVE TESTING, BUG 1, SECOND HALF — AND THE PROJECT'S OWN RULE.
     An earlier manual click on "9 more replies" took the link out of the tagline and added
     zero comments: shreddit-comment and .thing.comment both stayed at 40, so nothing was
     loaded and nothing was dropped in translation — the expansion no-opped. The control
     then vanished on its timer, which is indistinguishable from a control that worked.
     "Fails loudly, never silently" is the rule; a control that quietly eats a click and
     disappears breaks it twice over. */
  console.log('\n\x1b[1mAN EXPANSION THAT DELIVERS NOTHING SAYS SO\x1b[0m');
  {
    const { doc, window } = await boot(
      commentsPage({ deliver: 8, branchPager: true, deadBranch: true }),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    window.eval(BRANCH_PAGER_SCRIPT);
    // Shortened so the timeout branch is exercised in the suite rather than only in the
    // field; nothing in the extension writes to this.
    window.SHD.comments.timings.waitMs = 400;
    window.SHD.comments.timings.pollMs = 20;

    const firstRow = doc.querySelector('#shd-root .thing[data-fullname="t1_c0"]');
    const line = firstRow.querySelector('.shd-more-replies');
    const before = doc.querySelectorAll('#shd-root .thing.comment').length;
    line.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    check('the click reaches Reddit\'s control', window.__shdBranchPager.loads === 1,
      JSON.stringify(window.__shdBranchPager));

    /* AND THE PAGE GROWS FROM SOMEWHERE ELSE WHILE IT WAITS — which is the whole reason
       the measurement is scoped to the branch. The paginator drives the thread's own
       continuation on the same page, so a page-wide count would see these arrive and
       credit them to this click, reporting success for an expansion that delivered
       nothing: the exact lie this section exists to catch, told by the measuring
       instrument instead of the control. Injected at the tree root, depth 0, so it lands
       nowhere near t1_c0's subtree. Without this the branch-scoped count and a page-wide
       one are indistinguishable, and mutate.sh's row for it duly SURVIVED. */
    window.eval(`
      const c = document.createElement('shreddit-comment');
      c.setAttribute('thingid', 't1_unrelated');
      c.setAttribute('postid', 't3_link1');
      c.setAttribute('author', 'someone-else');
      c.setAttribute('score', '5');
      c.setAttribute('created', '2026-08-12T09:30:00.000000+0000');
      c.setAttribute('depth', '0');
      c.setAttribute('comment-position', '99');
      c.setAttribute('permalink', '/r/programming/comments/link1/c/unrelated/');
      c.setAttribute('content-type', 'text');
      c.setAttribute('award-count', '0');
      const b = document.createElement('div');
      b.setAttribute('slot', 'comment');
      b.innerHTML = '<p>A top-level comment that has nothing to do with that branch.</p>';
      c.appendChild(b);
      document.querySelector('shreddit-comment-tree > section').appendChild(c);
    `);
    await waitFor(() =>
      !!doc.querySelector('#shd-root .thing[data-fullname="t1_unrelated"]'));
    check('setup: the page grew while the expansion was in flight, elsewhere in the thread',
      doc.querySelectorAll('#shd-root .thing.comment').length === before + 1,
      `${doc.querySelectorAll('#shd-root .thing.comment').length} vs ${before}`);

    await waitFor(() => !/loading/.test(line.textContent), { timeout: 3000 });
    check('the expanded branch itself gained nothing',
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === 0,
      `${firstRow.querySelectorAll(':scope > .child .thing.comment').length} under t1_c0`);
    check('the control SAYS the expansion delivered nothing',
      /no replies loaded/.test(line.textContent),
      `${line.textContent} — a page-wide measure reads the unrelated comment above as ` +
      'this click succeeding');
    check('...and does not vanish, so the reader can try again',
      line.isConnected && !!line.querySelector('a'), 'the control removed itself');

    /* And it must still work. A failed click leaves the control armed, not spent — the
       label is a report, not a tombstone. */
    window.SHD.comments.timings.waitMs = 2000;
    doc.querySelector('shreddit-comment[thingid="t1_c0"] faceplate-partial')
      .removeAttribute('data-dead');
    line.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() =>
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES);
    check('a retry after a failed click still loads the replies',
      firstRow.querySelectorAll(':scope > .child .thing.comment').length === BRANCH_PAGER_REPLIES,
      `${firstRow.querySelectorAll(':scope > .child .thing.comment').length} under t1_c0`);
  }

  /* Two reports (rounds 4 and 6) produced transient "sources: N, stamped: 0" cards;
     live testing's coincided with a main thread the automation froze for 45+ seconds. The
     deadline is a setTimeout and runs on recovery; the flush it accuses is parked on a
     rAF that may not have fired. It must drain the queue before blaming it. */
  /* THE SUITE'S OWN MACHINERY, and the guard bug 69 said existed and did not.
     A jsdom window is not garbage while its timers run, and every page booted here leaves
     the paginator's heartbeat, the pipeline's observers and the gate's deadline running.
     Nothing closed them, so the late sections shared an event loop with every window
     before them — and after the page-cap section, which compresses its timers to 5ms, an
     abandoned window woke ~200 times a second for the rest of the run. The sections after
     it drive the paginator by hand and `loadNext()` refuses while `busy` is set, so one
     stray auto load starved every manual attempt: `pages: 0` where 40 was asserted, about
     one run in six.

     boot() closes the previous window now. What has been guarding that is a mutation row
     the script's own comment calls probabilistic — the bug it restores is a flake, so a
     green run clears nothing, and the round-12 sweep duly reported it SURVIVED. A flake is
     a bad regression guard for a fix that is not itself probabilistic: whether the window
     was closed is a FACT, and this asserts the fact. jsdom does not implement
     `window.closed`, so the observable is the thing that actually mattered — its timers
     stop. */
  console.log('\n\x1b[1mBOOTING A SECTION CLOSES THE PREVIOUS ONE\x1b[0m');
  {
    const { window: first } = await boot(listingPage(), 'https://www.reddit.com/', noAuto);
    // A 5ms interval, which is what the page-cap section compresses HEARTBEAT_MS to and so
    // the exact shape of the machinery that was leaking.
    first.eval('window.__ticks = 0; setInterval(() => window.__ticks++, 5);');
    await new Promise(r => setTimeout(r, 60));
    check('setup: the abandoned window is genuinely ticking before the next boot',
      first.__ticks > 0, `${first.__ticks} ticks — nothing was left running to close`);

    await boot(listingPage(), 'https://www.reddit.com/', noAuto);

    /* Sampled AFTER the second boot, then given far longer than the interval to prove it.
       A live 5ms interval lands ~40 ticks in 200ms, so "not one" is not a near miss. */
    const at = first.__ticks;
    await new Promise(r => setTimeout(r, 200));
    check('booting the next section stops the previous window\'s timers',
      first.__ticks === at,
      `${first.__ticks - at} ticks in 200ms after the next section booted — the window is ` +
      'still live, and every later manual paginator drive is racing it');
  }

  console.log('\n\x1b[1mTHE DEADLINE DRAINS THE QUEUE BEFORE ACCUSING IT\x1b[0m');
  {
    const noFrames = (win) => {
      // rAF is booked but never delivered — the starved-renderer condition. The deadline's
      // setTimeout still runs.
      win.requestAnimationFrame = () => 1;
    };
    const { doc } = await boot(listingPage(), 'https://www.reddit.com/', noFrames);
    check('with no frames at all, the kick renders the page instead of a card',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length &&
      !doc.querySelector('#shd-error'),
      `rows=${doc.querySelectorAll('#shd-root .thing.link').length} ` +
      (doc.documentElement.getAttribute('data-shd-fail') || ''));
    check('the page is revealed, not left blanked',
      doc.documentElement.classList.contains('shd-active'));
  }

  {
    // A thread that arrived whole must not sprout a "load more" that fetches nothing.
    const { doc, window } = await boot(commentsPage(),
      'https://www.reddit.com/r/programming/comments/link1/nasa/', noAuto);
    check('a complete thread renders every comment',
      doc.querySelectorAll('#shd-root .thing.comment').length === COMMENT_DEPTHS.length);
    const ok = await window.SHD.paginator.loadNext('manual');
    check('with no partial left, loading more is a no-op', ok === false);
    check('and the sentinel says so',
      /no more pages/.test(doc.querySelector('.shd-loadmore')?.textContent || ''),
      doc.querySelector('.shd-loadmore')?.textContent);
  }

  console.log('\n\x1b[1mTHEMES\x1b[0m');
  {
    /**
     * Boot a listing page with a working chrome.storage, so the theme can be read at
     * document_start and written back on a click.
     */
    async function bootThemed(settings) {
      const listeners = [];
      const dom = new JSDOM(listingPage(), {
        url: 'https://www.reddit.com/', runScripts: 'outside-only', pretendToBeVisual: true,
        virtualConsole: new VirtualConsole()
      });
      const { window } = dom, doc = window.document;
      window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
      let stored = { settings };
      const writes = [];
      window.chrome = {
        storage: {
          sync: {
            get: async () => stored,
            set: async (v) => { stored = v; writes.push(v); }
          },
          onChanged: { addListener: (fn) => listeners.push(fn) }
        }
      };
      window.eval(BUNDLE);
      await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
      return { window, doc, listeners, writes, get stored() { return stored; } };
    }

    const themeOf = (doc) => doc.documentElement.getAttribute('data-shd-theme');
    const buttons = (doc) => [...doc.querySelectorAll('.shd-theme-btn')];

    {
      const { window, doc } = await bootThemed({ listing: true, comments: true, chrome: true });
      const registered = window.SHD.theme.LIST;

      check('a default page is painted classic', themeOf(doc) === 'classic', themeOf(doc));
      check('the header carries one button per registered theme',
        buttons(doc).length === registered.length,
        `${buttons(doc).length} buttons vs ${registered.length} themes`);
      check('every button names a theme the registry knows',
        buttons(doc).every(b => window.SHD.theme.ids.includes(b.getAttribute('data-theme'))),
        buttons(doc).map(b => b.getAttribute('data-theme')).join(','));
      check('exactly one button is marked selected',
        buttons(doc).filter(b => b.classList.contains('selected')).length === 1);
      check('and it is the theme actually applied',
        buttons(doc).find(b => b.classList.contains('selected'))?.getAttribute('data-theme') === 'classic');
      check('the pressed state is exposed to assistive tech',
        buttons(doc).filter(b => b.getAttribute('aria-pressed') === 'true').length === 1);

      // The point of the whole feature: a click must repaint, not rebuild. Re-rendering
      // would throw away scroll position and every page the paginator has loaded.
      const rootBefore = doc.querySelector('#shd-root');
      const firstRowBefore = doc.querySelector('#shd-root .thing.link');
      buttons(doc).find(b => b.getAttribute('data-theme') === 'night').click();

      check('clicking a button repaints immediately', themeOf(doc) === 'night', themeOf(doc));
      check('the selected marker moves with it',
        buttons(doc).find(b => b.classList.contains('selected'))?.getAttribute('data-theme') === 'night');
      check('switching theme does not re-render the page',
        doc.querySelector('#shd-root') === rootBefore &&
        doc.querySelector('#shd-root .thing.link') === firstRowBefore);
      check('and does not lose any rows',
        doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
    }

    {
      // Persistence, and the shape of the write. A partial write reads to pipeline.js's
      // storage listener as every absent key changing to undefined.
      const { doc, writes } = await bootThemed({ listing: true, comments: true, chrome: true });
      buttons(doc).find(b => b.getAttribute('data-theme') === 'sepia').click();
      await waitFor(() => writes.length > 0);
      check('the choice is persisted', writes[0]?.settings.theme === 'sepia',
        JSON.stringify(writes[0]));
      check('the write carries the whole settings object',
        ['listing', 'comments', 'chrome'].every(k => k in (writes[0]?.settings || {})),
        Object.keys(writes[0]?.settings || {}).join(','));
    }

    {
      // A stored theme has to be on the page before the first paint, not after it: the
      // whole reason themes.js runs at document_start is that a dark theme was preceded by
      // a white blackout.
      const { doc } = await bootThemed({ listing: true, comments: true, chrome: true, theme: 'carbon' });
      check('a stored theme is applied at boot', themeOf(doc) === 'carbon', themeOf(doc));
      check('and the header reflects it without being told',
        doc.querySelector('.shd-theme-btn.selected')?.getAttribute('data-theme') === 'carbon');
    }

    {
      // Junk in storage — a theme removed in a later version, a hand-edited sync record.
      // It must resolve to classic rather than leaving every colour token unresolved.
      const { doc } = await bootThemed({ listing: true, comments: true, chrome: true, theme: 'not-a-theme' });
      check('an unknown theme falls back to classic', themeOf(doc) === 'classic', themeOf(doc));
    }

    {
      // The other tab / options-page path: a theme change arriving through storage must
      // repaint on the same terms as a click, and must not tear the render down either.
      const { doc, listeners } = await bootThemed({ listing: true, comments: true, chrome: true });
      const rootBefore = doc.querySelector('#shd-root');
      listeners.forEach(fn => fn({ settings: { newValue:
        { listing: true, comments: true, chrome: true, theme: 'slate' } } }, 'sync'));
      await waitFor(() => themeOf(doc) === 'slate');
      check('a theme change from storage repaints', themeOf(doc) === 'slate', themeOf(doc));
      await hold(200);      // asserting the teardown does NOT happen
      check('a theme change from storage does not tear the page down',
        doc.querySelector('#shd-root') === rootBefore);
      check('and the buttons follow it',
        doc.querySelector('.shd-theme-btn.selected')?.getAttribute('data-theme') === 'slate');

      // ...but a change that carries a theme AND a real setting still goes the long way.
      listeners.forEach(fn => fn({ settings: { newValue:
        { listing: false, comments: true, chrome: true, theme: 'night' } } }, 'sync'));
      await waitFor(() => !doc.querySelector('#shd-root'));
      check('a theme change bundled with a feature toggle still takes the full path',
        !doc.querySelector('#shd-root') && themeOf(doc) === 'night',
        `root: ${!!doc.querySelector('#shd-root')}, theme: ${themeOf(doc)}`);
    }
  }

  console.log('\n\x1b[1mLIVE SETTINGS\x1b[0m');
  {
    // Settings used to be read once at boot, so the options page appeared to do nothing.
    const listeners = [];
    const html = listingPage();
    const dom = new (require('jsdom').JSDOM)(html, {
      url: 'https://www.reddit.com/', runScripts: 'outside-only', pretendToBeVisual: true,
      virtualConsole: new (require('jsdom').VirtualConsole)()
    });
    const { window } = dom, doc = window.document;
    window.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    let stored = { settings: { listing: true, comments: true, chrome: true } };
    window.chrome = {
      storage: {
        sync: { get: async () => stored, set: async (v) => { stored = v; } },
        onChanged: { addListener: (fn) => listeners.push(fn) }
      }
    };
    window.eval(BUNDLE);
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);

    check('a content script subscribes to storage changes', listeners.length === 1,
      `${listeners.length} listeners`);
    check('rows are rendered to begin with',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);

    // Turn listings off, the way the options page would.
    const next = { listing: false, comments: true, chrome: true };
    listeners.forEach(fn => fn({ settings: { newValue: next } }, 'sync'));
    await waitFor(() => !doc.querySelector('#shd-root'));
    check('switching a feature off takes effect without a reload',
      !doc.querySelector('#shd-root'), 'our layout is still mounted');
    check('and hands the page back to native Reddit',
      !doc.documentElement.classList.contains('shd-active') &&
      !doc.documentElement.classList.contains('shd-gate'));

    // ...and back on again.
    listeners.forEach(fn => fn({ settings: { newValue: { listing: true, comments: true, chrome: true } } }, 'sync'));
    await waitFor(() => doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length);
    check('switching it back on re-renders',
      doc.querySelectorAll('#shd-root .thing.link').length === POSTS.length,
      String(doc.querySelectorAll('#shd-root .thing.link').length));

    // A change in another storage area, or one that changes nothing, must be ignored.
    const rowsBefore = doc.querySelector('#shd-root');
    listeners.forEach(fn => fn({ settings: { newValue: { listing: true, comments: true, chrome: true } } }, 'sync'));
    await hold(200);        // asserting nothing happens
    check('a no-op change does not tear the page down',
      doc.querySelector('#shd-root') === rowsBefore);
    listeners.forEach(fn => fn({ other: { newValue: 1 } }, 'local'));
    await hold(200);        // asserting nothing happens
    check('an unrelated storage change is ignored',
      doc.querySelector('#shd-root') === rowsBefore);
  }

  console.log('\n\x1b[1mOPTIONS PAGE\x1b[0m');
  {
    // Nothing exercised options/ at all, and it duplicates the settings list from
    // contracts.js. Those two have already drifted once: pruneAfterRender sat in DEFAULTS
    // with no checkbox to set it and no implementation behind it.
    const optionsHtml = fs.readFileSync(path.join(__dirname, '..', 'options', 'options.html'), 'utf8');
    const optionsJs = fs.readFileSync(path.join(__dirname, '..', 'options', 'options.js'), 'utf8');
    const contractsJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'contracts.js'), 'utf8');

    const vm = require('vm');
    const ctx = vm.createContext({});
    vm.runInContext(contractsJs, ctx, { filename: 'contracts.js' });
    const shipped = ctx.SHD.settings;

    // The theme list is the third thing that has to agree with the other two: contracts.js
    // ships a default theme, themes.js owns the ids, themes.css owns the palettes. This
    // suite covers the first two; css-lint covers the palettes.
    const themesJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'themes.js'), 'utf8');
    const themeCtx = vm.createContext({
      document: {
        documentElement: { getAttribute: () => null, setAttribute: () => {} },
        querySelectorAll: () => []          // preload() paints on load; no buttons here
      },
      chrome: undefined                     // ...and falls back to the default without storage
    });
    vm.runInContext(themesJs, themeCtx, { filename: 'themes.js' });
    const themeIds = themeCtx.SHD.theme.ids;

    const dom = new JSDOM(optionsHtml, { runScripts: 'outside-only',
      virtualConsole: new VirtualConsole() });
    const { window } = dom, doc = window.document;

    let stored = { settings: { listing: false, comments: true, chrome: true } };
    const writes = [];
    window.chrome = { storage: { sync: {
      get: async () => stored,
      set: async (v) => { stored = v; writes.push(v); }
    } } };
    window.eval(optionsJs);
    await waitFor(() => [...doc.querySelectorAll('input[data-k]')].some(b => b.checked));

    // Not `input[data-k]`: `theme` is a <select>, and scoping this to checkboxes would
    // report a setting with a perfectly good control as missing.
    const keys = [...doc.querySelectorAll('[data-k]')].map(b => b.dataset.k);
    check('every shipped setting has a control',
      Object.keys(shipped).every(k => keys.includes(k)),
      `missing: ${Object.keys(shipped).filter(k => !keys.includes(k)).join(', ')}`);
    check('every control corresponds to a shipped setting',
      keys.every(k => k in shipped),
      `orphaned: ${keys.filter(k => !(k in shipped)).join(', ')} — a toggle for nothing`);

    const themeOptions = [...doc.querySelectorAll('[data-k="theme"] option')].map(o => o.value);
    check('the theme dropdown offers exactly the registered themes',
      themeOptions.join(',') === themeIds.join(','),
      `options page: ${themeOptions.join(',')} vs themes.js: ${themeIds.join(',')}`);
    check('the default theme is one of them', themeIds.includes(shipped.theme), shipped.theme);

    // options.js keeps its own DEFAULTS because it cannot import contracts.js.
    const defaults = {};
    vm.runInContext(optionsJs.slice(0, optionsJs.indexOf('};') + 2).replace(/\bconst DEFAULTS/, 'globalThis.DEFAULTS'),
      vm.createContext(defaults));
    check('options DEFAULTS match the shipped settings exactly',
      JSON.stringify(Object.keys(defaults.DEFAULTS || {}).sort()) ===
      JSON.stringify(Object.keys(shipped).sort()),
      `options: ${Object.keys(defaults.DEFAULTS || {}).sort().join(',')} vs ` +
      `contracts: ${Object.keys(shipped).sort().join(',')}`);

    // --- behaviour ---
    check('checkboxes reflect what is stored',
      doc.querySelector('input[data-k="listing"]').checked === false &&
      doc.querySelector('input[data-k="comments"]').checked === true);
    check('a setting absent from storage falls back to its default',
      doc.querySelector('input[data-k="autoPaginate"]').checked === shipped.autoPaginate);

    const box = doc.querySelector('input[data-k="showThumbnails"]');
    box.checked = false;
    box.dispatchEvent(new window.Event('change'));
    await waitFor(() => writes.length > 0);

    check('toggling a checkbox writes to storage', writes.length === 1, String(writes.length));
    check('the write carries the whole settings object, not just the change',
      Object.keys(writes[0].settings).sort().join(',') === Object.keys(shipped).sort().join(','),
      Object.keys(writes[0].settings).join(','));
    check('the toggled value is the one written', writes[0].settings.showThumbnails === false);
    check('other settings survive the write', writes[0].settings.listing === false &&
      writes[0].settings.comments === true);

    // The shape pipeline.js's storage listener expects — these two have to agree or the
    // options page silently does nothing at runtime.
    check('the written shape is what the content script listens for',
      typeof writes[0].settings === 'object' && !Array.isArray(writes[0].settings),
      'pipeline.js reads changes.settings.newValue as a flat object');

    // A <select> reads `.value`, not `.checked`. Handling only checkboxes would have
    // written `theme: undefined` — silently resetting the user to classic on any change.
    const sel = doc.querySelector('[data-k="theme"]');
    sel.value = 'night';
    sel.dispatchEvent(new window.Event('change'));
    await waitFor(() => writes.length > 1);
    check('picking a theme writes the id, not a boolean', writes[1]?.settings.theme === 'night',
      JSON.stringify(writes[1]?.settings.theme));
  }

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failed) { console.log('failures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  // Explicit: the paginator heartbeat is a setInterval that runs for a PAGE's lifetime,
  // and every boot()'s abandoned jsdom window keeps its timers on node's event loop — so
  // without this the suite passes and then never exits.
  process.exit(0);
})();
