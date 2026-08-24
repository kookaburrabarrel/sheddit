#!/usr/bin/env node
/**
 * live-contracts.js — re-verify src/config/contracts.js against real reddit.com.
 *
 * NOT part of `npm test`: it needs the network, and Reddit serves an anti-bot
 * interstitial to datacenter IPs, so it only works from an ordinary machine.
 *
 *   npm run verify:live              # logged out, headless
 *   npm run verify:live -- --headed  # watch it, and/or log in first
 *
 * WHY THIS EXISTS
 * Every other suite runs against synthetic fixtures. TESTING.md is explicit about the
 * consequence: "if Reddit changes its markup, the fixtures will keep passing while the
 * real site breaks". This is the script that notices. Run it after any suspected
 * redesign; whatever it reports MISSING is what to fix in contracts.js.
 *
 * IT ALSO SETTLES THE VOTE-DELEGATION QUESTION.
 * Delegation forwards our arrow's click to Reddit's own button. ARCHITECTURE §1.2 records
 * shreddit-async-loader — which is where the action bar hydrates — as having a shadow
 * root, and a CLOSED shadow root cannot be reached from a content script at all. The
 * "vote reachability" section below reports which of the three worlds we are in:
 *
 *   light DOM        → delegation works, and always did
 *   open shadow root → delegation works only because dom.deepQuery pierces it
 *   not found        → delegation CANNOT work; voting needs a different mechanism
 *
 * Run it logged in (--headed, sign in, then let it continue) to also confirm a real vote
 * registers. Logged out, Reddit shows a login prompt instead, which is still a pass for
 * "we found and clicked the right control".
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { resolveChrome, noChromeMessage, makeChecker } = require('./harness');

const HEADED = process.argv.includes('--headed');
const SUB = (process.argv.find(a => a.startsWith('--sub=')) || '--sub=programming').split('=')[1];

const EXE = resolveChrome();
if (!EXE) { console.error('\n  ' + noChromeMessage() + '\n'); process.exit(1); }

// Read the contracts the same way the extension does, without a browser.
// contracts.js writes through globalThis but reads bare `SHD`, so it needs a genuine
// global object — a plain parameter shim shadows globalThis and breaks that.
const vm = require('vm');
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'contracts.js'), 'utf8'),
  context, { filename: 'contracts.js' });
const C = context.SHD.C;

const { check, report } = makeChecker();
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sheddit.dev.js'), 'utf8');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: !HEADED,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage',
      // A single, well-known Chrome flag (not a stealth plugin) that turns off the
      // navigator.webdriver=true tell Chrome sets for ANY CDP-driven session, headless or
      // not. Automated bot-detection commonly keys on exactly that flag, independent of
      // IP reputation — so a real residential connection can still get an interstitial.
      // Legitimate here: one anonymous page load of a public listing, no login, no scale.
      '--disable-blink-features=AutomationControlled'
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

  /* ---------------- listing ---------------- */
  console.log(`\n\x1b[1mLIVE CONTRACTS — /r/${SUB}/\x1b[0m`);

  /**
   * Give up, but never on a guess. Every bail path first captures what the page actually
   * says — title, a body snippet, a screenshot — because "anti-bot interstitial" and
   * "genuinely unreachable" and "our own bug" all look identical from the outside if you
   * do not look. In --headed mode, pause instead of closing immediately so a human can
   * look at the real window (and manually clear a challenge, if there is one).
   */
  const bail = async (why) => {
    console.log(`  \x1b[33mSKIP\x1b[0m ${why}`);
    try {
      const title = await page.title();
      const snippet = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || '(empty body)');
      const shotPath = path.join(__dirname, '..', 'dist', 'live-diagnostic.png');
      await page.screenshot({ path: shotPath }).catch(() => {});
      console.log(`  \x1b[2mpage title: ${JSON.stringify(title)}\x1b[0m`);
      console.log(`  \x1b[2mbody starts: ${JSON.stringify(snippet)}\x1b[0m`);
      console.log(`  \x1b[2mscreenshot saved: ${path.relative(process.cwd(), shotPath)}\x1b[0m`);
    } catch { /* page may already be unusable — the reason string still tells us something */ }

    if (HEADED) {
      console.log('\n  \x1b[2m--headed: leaving the window open 30s — look at what is actually there\x1b[0m');
      await new Promise(r => setTimeout(r, 30000));
    }
    await browser.close();
    process.exit(0);
  };

  try {
    await page.goto(`https://www.reddit.com/r/${SUB}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  } catch (e) {
    await bail(`cannot reach reddit.com (${String(e).split('\n')[0].replace(/^Error: /, '')}). ` +
               `This script needs direct network access — it will not work behind an ` +
               `egress proxy or in a CI sandbox.`);
    return;
  }

  // Wait for the feed BEFORE diagnosing its absence. `networkidle2` does not mean the feed
  // has hydrated, so an immediate check reports "no posts" on any page that is merely slow —
  // and the bail message below literally offers "could be a slow load" as an explanation for
  // a state this code would have created itself. Give it the full budget, then diagnose only
  // if the posts genuinely never arrive.
  const havePosts = await page.waitForSelector(C.POST, { timeout: 30000 }).then(() => true, () => false);

  if (!havePosts) {
    // No posts is not automatically "blocked" — that word was doing more diagnosing than
    // the evidence supported. Narrow to signatures that actually mean a challenge page
    // (Cloudflare's title, a captcha iframe, an explicit robot check), and otherwise say
    // plainly that we do not know why, with the evidence attached instead of a label.
    const diag = await page.evaluate(() => ({
      title: document.title,
      hasCaptchaFrame: !!document.querySelector('iframe[src*="captcha" i], iframe[title*="challenge" i]'),
      cloudflareChallenge: /just a moment/i.test(document.title),
      robotCheck: /are you a robot|automated (queries|requests)/i.test(document.body?.innerText || ''),
      looksLikeReddit: /reddit/i.test(document.body?.innerText?.slice(0, 400) || '')
    }));
    if (diag.cloudflareChallenge || diag.hasCaptchaFrame || diag.robotCheck) {
      await bail(`a bot-detection challenge, not a normal page (title: ${JSON.stringify(diag.title)}). ` +
                 `Try --headed and clear it by hand, or re-run later.`);
    } else if (!diag.looksLikeReddit) {
      await bail(`the page has no shreddit-post AND does not look like Reddit at all ` +
                 `(title: ${JSON.stringify(diag.title)}) — see the diagnostics above, ` +
                 `this is not necessarily a bot check`);
    } else {
      // Slowness is already ruled out by the 30s wait above, so this is the interesting
      // one: it means either genuinely nothing to show, or our selector has gone stale.
      await bail(`the page looks like Reddit but still has no ${C.POST} after 30s — ` +
                 `(title: ${JSON.stringify(diag.title)}) either an empty/private/gated ` +
                 `subreddit, or C.POST in contracts.js is stale. Try --sub=<a busy sub> ` +
                 `to tell those apart.`);
    }
    return;
  }

  const listing = await page.evaluate((C) => {
    const posts = [...document.querySelectorAll(C.POST)];
    const missing = {};
    for (const [key, attr] of Object.entries(C.POST_ATTR)) {
      const present = posts.filter(p => p.hasAttribute(attr)).length;
      if (present < posts.length) missing[key] = `${attr} on ${present}/${posts.length}`;
    }
    return {
      count: posts.length,
      missing,
      types: [...new Set(posts.map(p => p.getAttribute(C.POST_ATTR.type)))],
      adPosts: document.querySelectorAll(C.AD_POST).length,
      adsContainingPost: [...document.querySelectorAll(C.AD_POST)]
        .filter(a => a.querySelector(C.POST)).length,
      partial: !!document.querySelector(C.FEED_PARTIAL),
      partialLoadable: (() => {
        const fp = document.querySelector(C.FEED_PARTIAL);
        return !!fp && typeof fp[C.PARTIAL_LOAD_METHOD] === 'function';
      })(),
      feed: !!document.querySelector(C.FEED),
      main: !!document.querySelector(C.MAIN),
      mainDepthBelowApp: (() => {
        const m = document.querySelector(C.MAIN); let d = 0, n = m;
        while (n && n.tagName?.toLowerCase() !== C.APP) { n = n.parentElement; d++; }
        return n ? d : -1;
      })(),
      thumbHosts: [...new Set([...document.querySelectorAll(`${C.POST} img`)]
        .map(i => (i.currentSrc || i.src || '').split('/')[2]).filter(Boolean))]
    };
  }, C);

  check(`posts found on the page (${listing.count})`, listing.count > 0);
  check('every POST_ATTR in contracts.js is present on every post',
    Object.keys(listing.missing).length === 0, JSON.stringify(listing.missing));
  check('shreddit-feed still exists', listing.feed);
  check('#main-content still exists', listing.main);
  check('the programmatic pagination partial is present', listing.partial);
  check('the partial still exposes loadContent()', listing.partialLoadable);
  check('ads still contain no shreddit-post (the free ad filter)',
    listing.adsContainingPost === 0,
    `${listing.adsContainingPost} of ${listing.adPosts} ads contained one — ` +
    `AD_POST filtering in listing.consume() is now load-bearing`);
  check('#main-content is still well below shreddit-app (never anchor our root inside it)',
    listing.mainDepthBelowApp > 1, `depth ${listing.mainDepthBelowApp}`);

  console.log(`  \x1b[2mobserved post-type values: ${listing.types.join(', ')}\x1b[0m`);
  console.log(`  \x1b[2mobserved image hosts: ${listing.thumbHosts.join(', ')}\x1b[0m`);
  // crosspost joined this list on 2026-08-14: verify:live observed it, and test/fixtures.js
  // now carries one, which is what "the fixtures cover" is asserting.
  const COVERED_TYPES = ['text', 'link', 'image', 'gallery', 'video', 'multi_media', 'crosspost'];
  const unlisted = listing.types.filter(t => !COVERED_TYPES.includes(t));
  check('no post-type values beyond those the fixtures cover',
    unlisted.length === 0, `new types: ${unlisted.join(', ')} — add them to test/fixtures.js`);

  /* ---------------- the adult flag ----------------
   *
   * Confirmed live 2026-08-18 on /r/CombatFootage/, logged out: the attribute is `nsfw`,
   * and it carries an EMPTY STRING on an adult post and is ABSENT on a safe one — the
   * boolean-binding spelling. That is the encoding `nsfwOf()` was written for and the one a
   * naive `if (el.getAttribute('nsfw'))` gets exactly backwards, because "" is falsy: every
   * adult post would read as safe and every graphic thumbnail would render full-size.
   *
   * READ THE INCONCLUSIVE CASE BEFORE BELIEVING A GREEN RUN. On a subreddit with no adult
   * posts every candidate is absent, which is ALSO what a completely wrong attribute name
   * looks like. That mistake was made by hand first: a run against the logged-out front page
   * reported all-null and proved nothing. So a sample with no flagged post is reported as
   * INCONCLUSIVE, never as a pass — rerun with --sub=<a mixed or adult subreddit>.
   */
  console.log('\n\x1b[1mLIVE CONTRACTS — THE ADULT FLAG\x1b[0m');

  const nsfw = await page.evaluate((C) => {
    const posts = [...document.querySelectorAll(C.POST)];
    const seen = {};
    for (const name of C.NSFW_ATTRS) {
      const vals = posts.map(p => p.getAttribute(name)).filter(v => v !== null);
      if (vals.length) seen[name] = { present: vals.length, values: [...new Set(vals)] };
    }
    // Any attribute name we do NOT know about that looks like it could be the flag.
    const rogue = [...new Set(posts.flatMap(p => [...p.attributes].map(a => a.name)))]
      .filter(n => /nsfw|adult|mature|over.?18|nsfl|explicit/i.test(n) && !C.NSFW_ATTRS.includes(n));
    return { count: posts.length, seen, rogue };
  }, C);

  const flagged = Object.values(nsfw.seen).reduce((n, s) => n + s.present, 0);
  for (const [name, s] of Object.entries(nsfw.seen))
    console.log(`  \x1b[2m${name}: on ${s.present}/${nsfw.count} posts, values ${JSON.stringify(s.values)}\x1b[0m`);

  check('no adult-looking attribute exists that contracts.js does not know about',
    nsfw.rogue.length === 0,
    `unknown: ${nsfw.rogue.join(', ')} — add to C.NSFW_ATTRS`);

  if (flagged === 0) {
    console.log(`  \x1b[33mINCONCLUSIVE: no post in /r/${SUB}/ carries any of ` +
      `${JSON.stringify(C.NSFW_ATTRS)}. That is what a subreddit with no adult posts looks ` +
      `like AND what a wrong attribute name looks like — this run cannot tell them apart. ` +
      `Rerun with --sub=<a subreddit that has flagged posts> before concluding anything.\x1b[0m`);
  } else {
    /* The encoding, not just the name. "" must read as adult; if Reddit ever switches to
       always emitting the attribute, "false" appears here and presence-testing would put a
       placeholder over the entire feed instead. */
    const classified = await page.evaluate((C) => {
      const nsfwOf = (el) => C.NSFW_ATTRS.some(name => {
        const v = el.getAttribute(name);
        if (v === null) return false;
        const s = v.trim().toLowerCase();
        return s !== 'false' && s !== '0';
      });
      const posts = [...document.querySelectorAll(C.POST)];
      const carries = posts.filter(p => C.NSFW_ATTRS.some(n => p.getAttribute(n) !== null));
      return { adult: posts.filter(nsfwOf).length, carries: carries.length, total: posts.length };
    }, C);
    check(`nsfwOf() classifies every flagged post as adult (${classified.adult}/${classified.carries})`,
      classified.adult === classified.carries,
      'a flagged post read as safe — the value encoding has changed, check for "false"/"0"');
    check('the flag is not present on every post (it would placeholder the whole feed)',
      classified.carries < classified.total,
      `${classified.carries}/${classified.total} carry it — if Reddit now always emits it, ` +
      `absent-means-safe is no longer the discriminator`);
  }

  /* ---------------- video posts: the packaged-media contract ---------------- */
  console.log('\n\x1b[1mLIVE CONTRACTS — VIDEO POSTS\x1b[0m');
  /* C.POST_VIDEO_JSON is the one contract shipped on a report's word rather than a
     capture (live testing named it; live testing proved the bare v.redd.it link is a closed loop for
     a logged-out session). This is what confirms or kills it. INCONCLUSIVE on a page with
     no video posts — that looks identical to a wrong attribute name, the same trap the
     adult-flag section documents. */
  const video = await page.evaluate((C) => {
    const posts = [...document.querySelectorAll(C.POST)]
      .filter(p => p.getAttribute(C.POST_ATTR.type) === 'video');
    return {
      count: posts.length,
      withAttr: posts.filter(p => p.getAttribute(C.POST_VIDEO_JSON) !== null).length,
      mp4able: posts.filter(p => {
        try {
          const urls = [];
          const walk = (v) => {
            if (typeof v === 'string') { if (/^https:\/\/\S+\.mp4(\?|$)/i.test(v)) urls.push(v); }
            else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
          };
          walk(JSON.parse(p.getAttribute(C.POST_VIDEO_JSON) || 'null'));
          return urls.length > 0;
        } catch { return false; }
      }).length
    };
  }, C);
  if (video.count === 0) {
    console.log('  \x1b[33mINCONCLUSIVE: no video posts on this page — rerun with ' +
      '--sub=<a video-heavy subreddit> (r/aww worked in live testing) before concluding ' +
      'anything about C.POST_VIDEO_JSON.\x1b[0m');
  } else {
    check(`every video post carries ${C.POST_VIDEO_JSON} (${video.withAttr}/${video.count})`,
      video.withAttr === video.count,
      'the attribute name is wrong or not universal — video titles fall back to the closed loop');
    check(`...and an mp4 URL deep-scans out of it (${video.mp4able}/${video.count})`,
      video.mp4able === video.count,
      'attribute present but no mp4 found — the JSON shape needs a look, paste one raw value');
  }

  /* ---------------- image posts: the two halves of a reported gap ---------------- */
  console.log('\n\x1b[1mLIVE CONTRACTS — IMAGE POSTS\x1b[0m');
  /* Reported, not captured: an image post's comments page showed a title and a 70px
     thumbnail and nothing else, and clicking the thumbnail left the layout for Reddit's
     own /media viewer. The fix reads the picture out of the light DOM and substitutes it
     for a content-href that points back into reddit.com — but BOTH of those are inferred
     from what clicking did, so this section is what turns them into measurements.

     What the output should settle:
       - is content-href on an image post really a reddit.com/media URL, or something else?
       - does the post carry a responsive set, and does it state widths we can rank on?
       - is the biggest candidate meaningfully bigger than the thumbnail, i.e. is there a
         full-size file here at all, or only ever the small one? */
  const images = await page.evaluate((C) => {
    const posts = [...document.querySelectorAll(C.POST)]
      .filter(p => p.getAttribute(C.POST_ATTR.type) === 'image');
    const hostOf = (u) => { try { return new URL(u, location.href).host; } catch { return ''; } };
    return {
      count: posts.length,
      hrefHosts: [...new Set(posts.map(p => hostOf(p.getAttribute(C.POST_ATTR.contentHref))))],
      viewerHrefs: posts.filter(p =>
        /(^|\.)reddit\.com$/i.test(hostOf(p.getAttribute(C.POST_ATTR.contentHref)))).length,
      withSrcset: posts.filter(p =>
        [...p.querySelectorAll('img')].some(i => (i.getAttribute('srcset') || '').trim())).length,
      // Widest `w` descriptor anywhere in the post, against the plain src, so the two can
      // be compared: if they match there is no larger file to find here.
      samples: posts.slice(0, 3).map(p => {
        const set = [...p.querySelectorAll('img')]
          .flatMap(i => (i.getAttribute('srcset') || '').split(',')
            .map(s => s.trim().split(/\s+/))
            .filter(b => b[0])
            .map(b => ({ url: b[0], w: /^(\d+)w$/.test(b[1] || '') ? parseInt(b[1], 10) : 0 })));
        const widest = set.sort((a, b) => b.w - a.w)[0] || null;
        return {
          contentHref: (p.getAttribute(C.POST_ATTR.contentHref) || '').slice(0, 110),
          candidates: set.length,
          widest: widest && { w: widest.w, url: widest.url.slice(0, 90) },
          plainSrc: ([...p.querySelectorAll('img')]
            .map(i => i.currentSrc || i.src).find(u => /redd\.it/.test(u)) || '').slice(0, 90)
        };
      })
    };
  }, C);
  if (images.count === 0) {
    console.log('  \x1b[33mINCONCLUSIVE: no image posts on this page — rerun with ' +
      '--sub=<an image-heavy subreddit> (r/aww, r/pics) before concluding anything. ' +
      'A page with no image posts reports exactly what a wrong contract reports.\x1b[0m');
  } else {
    console.log('  content-href hosts seen: ' + images.hrefHosts.join(', '));
    console.log('  samples: ' + JSON.stringify(images.samples, null, 2));
    /* Not a pass/fail — it is a fork, and either answer is actionable. Pointing at the
       viewer means the substitution is doing real work; pointing straight at the file
       means the reported bounce has some other cause and model.post's narrow rule is
       correctly leaving those posts alone. */
    console.log(`  ${images.viewerHrefs}/${images.count} point back into reddit.com ` +
      '(the /media viewer). 0 here means the substitution never fires live and the ' +
      'reported bounce needs re-diagnosing.');
    check(`image posts carry a responsive set to rank (${images.withSrcset}/${images.count})`,
      images.withSrcset > 0,
      'no srcset anywhere: the model falls back to the plain src, which is the thumbnail — ' +
      'so the comments page would show a small picture rather than none. Paste a post\'s ' +
      'img markup; the full-size URL is somewhere else.');
  }

  /* ---------------- vote reachability: the question that matters ---------------- */
  console.log('\n\x1b[1mLIVE CONTRACTS — VOTE DELEGATION\x1b[0m');
  await page.evaluate(BUNDLE);                       // gives the page SHD.dom.deepQuery
  await new Promise(r => setTimeout(r, 2500));       // let the action bar hydrate

  const vote = await page.evaluate((C) => {
    const post = document.querySelector(C.POST);
    const light = post.querySelector(C.NATIVE.upvote);
    const deep = SHD.dom.deepQuery(post, C.NATIVE.upvote);
    const loader = post.querySelector('shreddit-async-loader');
    return {
      light: !!light,
      deep: !!deep,
      openShadowRoots: SHD.dom.shadowRoots(post),
      loaderPresent: !!loader,
      loaderHasOpenShadow: !!loader?.shadowRoot,
      deepLabel: deep?.getAttribute('aria-label') || deep?.tagName || null
    };
  }, C);

  const world = vote.light ? 'light DOM' : vote.deep ? 'open shadow root' : 'NOT FOUND';
  console.log(`  \x1b[2mupvote control lives in: ${world}\x1b[0m`);
  console.log(`  \x1b[2m${JSON.stringify(vote)}\x1b[0m`);

  check('the native upvote control is reachable at all', vote.deep,
    'delegation cannot work — the control is absent or in a CLOSED shadow root. ' +
    'Voting needs a different mechanism (see ARCHITECTURE §5 tier 3).');
  if (vote.deep && !vote.light) {
    console.log('  \x1b[33mNOTE\x1b[0m reachable ONLY through a shadow root — ' +
                'dom.deepQuery is load-bearing, do not simplify it back to querySelector.');
  }

  /* ---------------- comments ---------------- */
  // The BUSIEST post on the listing, not the first one. Comment continuation is only
  // observable on a thread big enough to be truncated, and picking post[0] made that a
  // coin toss — the previous run happened to land on one and reported "arrived whole" as
  // an equally likely outcome, which tells us nothing about the mechanism.
  const permalink = await page.evaluate((C) => {
    const posts = [...document.querySelectorAll(C.POST)];
    const best = posts.reduce((a, b) =>
      Number(b.getAttribute(C.POST_ATTR.comments) || 0) >
      Number(a?.getAttribute(C.POST_ATTR.comments) || -1) ? b : a, null);
    return best?.getAttribute(C.POST_ATTR.permalink);
  }, C);
  // Grabbed NOW, while the listing is still loaded — the USER PROFILES section at the
  // bottom visits this author's profile, and by then the page is a comment thread.
  const postAuthorForProfile = await page.evaluate((C) =>
    document.querySelector(C.POST)?.getAttribute(C.POST_ATTR.author), C);
  console.log(`\n\x1b[1mLIVE CONTRACTS — ${permalink}\x1b[0m`);
  await page.goto('https://www.reddit.com' + permalink, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(C.COMMENT, { timeout: 30000 }).catch(() => {});

  const comments = await page.evaluate((C) => {
    const all = [...document.querySelectorAll(C.COMMENT)];
    // How much of the thread arrives up front, and by what mechanism does the rest come?
    // This is the question the fixtures cannot answer: commentsPage() has no partials at
    // all, so the suite is structurally blind to comment continuation. ARCHITECTURE 1.5
    // recorded "29 pending partials" on a real thread without saying what they were for.
    const partials = [...document.querySelectorAll(C.LAZY_LOADER)];
    const inTree = partials.filter(p => p.closest(C.COMMENT_TREE));
    const declared = Number(
      document.querySelector(C.COMMENT_TREE)?.getAttribute('totalcomments') ||
      document.querySelector(C.POST)?.getAttribute(C.POST_ATTR.comments) || 0);
    const missing = {};
    for (const [key, attr] of Object.entries(C.COMMENT_ATTR)) {
      const present = all.filter(c => c.hasAttribute(attr)).length;
      if (present < all.length) missing[key] = `${attr} on ${present}/${all.length}`;
    }
    return {
      count: all.length,
      missing,
      withBody: all.filter(c => c.querySelector(C.COMMENT_BODY)).length,
      // The load-bearing structural claim: comments are FLAT siblings, threading is data.
      flat: all.every(c => !c.parentElement?.closest(C.COMMENT)),
      depths: [...new Set(all.map(c => c.getAttribute(C.COMMENT_ATTR.depth)))].sort(),
      // If "flat" just failed, find out WHAT changed before anyone touches comments.js.
      // Tag/class skeletons only — no innerText — so nothing from real comment bodies
      // ends up in a log. Three questions this has to answer:
      //   1. Does the DOM ancestor-comment count now equal the `depth` attribute exactly
      //      (Reddit started nesting to match what depth already said), or does it diverge
      //      (something else is going on and depth is still the only reliable signal)?
      //   2. Is a comment's immediate parent ANOTHER shreddit-comment (true nesting), or a
      //      wrapper element between them (grouping without redefining the child/parent
      //      relationship depth-stack already assumes)?
      //   3. What does a real ancestor chain look like, concretely?
      structure: (() => {
        const rows = all.map(c => {
          const declared = Number(c.getAttribute(C.COMMENT_ATTR.depth)) || 0;
          let domDepth = 0, n = c.parentElement;
          while (n) { if (n.tagName?.toLowerCase() === C.COMMENT) domDepth++; n = n.parentElement; }
          const p = c.parentElement;
          return {
            declared, domDepth, match: declared === domDepth,
            directParentIsComment: p?.tagName?.toLowerCase() === C.COMMENT,
            parentSkeleton: p ? p.tagName.toLowerCase() +
              (p.className ? '.' + String(p.className).split(/\s+/).slice(0, 2).join('.') : '') : null
          };
        });
        const chainFor = (el) => {
          const chain = [];
          for (let n = el; n && chain.length < 14; n = n.parentElement) {
            chain.push(n.tagName.toLowerCase() +
              (n.className ? '.' + String(n.className).split(/\s+/).slice(0, 2).join('.') : ''));
            if (n.tagName?.toLowerCase() === C.COMMENT_TREE) break;
          }
          return chain.reverse();
        };
        const deepest = all.reduce((a, b) =>
          Number(b.getAttribute(C.COMMENT_ATTR.depth)) > Number(a?.getAttribute(C.COMMENT_ATTR.depth) || -1) ? b : a, null);
        return {
          total: rows.length,
          matches: rows.filter(r => r.match).length,
          domDepthAlwaysEqualsDeclared: rows.every(r => r.match),
          directParentIsCommentCount: rows.filter(r => r.directParentIsComment).length,
          parentSkeletons: [...new Set(rows.map(r => r.parentSkeleton))],
          sampleChainToDeepestComment: deepest ? chainFor(deepest) : null,
          sampleMismatch: rows.find(r => !r.match) || null
        };
      })(),
      tree: !!document.querySelector(C.COMMENT_TREE),
      declared,
      partialsOnPage: partials.length,
      partialsInTree: inTree.length,
      programmaticInTree: inTree.filter(p => p.getAttribute('loading') === 'programmatic').length,
      treePartialLoadable: inTree.some(p => typeof p[C.PARTIAL_LOAD_METHOD] === 'function'),
      // Anything else that might gate the rest of the thread.
      moreLikeButtons: [...document.querySelectorAll('button, a')]
        .map(e => (e.textContent || '').trim().toLowerCase())
        .filter(t => /more repl|more comment|continue this thread|view (more|entire)/.test(t))
        .slice(0, 6)
    };
  }, C);

  check(`comments found (${comments.count})`, comments.count > 0);
  check('every COMMENT_ATTR in contracts.js is present on every comment',
    Object.keys(comments.missing).length === 0, JSON.stringify(comments.missing));
  check('comment bodies are still at [slot="comment"]',
    comments.withBody === comments.count, `${comments.withBody}/${comments.count}`);
  // "Flat" was never the property we needed — it was just how Reddit happened to ship in
  // 2026-08-12. What comments.js actually requires is that the `depth` attribute is a
  // truthful description of the thread, which stays true whether or not the DOM nests.
  // Asserting flatness meant a red run for a change that costs us nothing.
  check('the depth attribute agrees with the DOM (what the depth-stack needs)',
    comments.structure.domDepthAlwaysEqualsDeclared,
    `depth != DOM nesting on ${comments.structure.total - comments.structure.matches}/` +
    `${comments.structure.total} — the depth-stack cannot be trusted; see the dump below`);
  if (!comments.flat) {
    console.log('  \x1b[2mFYI: the DOM nests comments (it did not in 2026-08-12). Harmless ' +
                'while depth agrees, but it means a comment\'s subtree contains its ' +
                'descendants\' bodies — model.js scopes that lookup deliberately.\x1b[0m');
  }
  check('shreddit-comment-tree still exists', comments.tree);
  console.log(`  \x1b[2mobserved depths: ${comments.depths.join(', ')}\x1b[0m`);

  if (!comments.flat || !comments.structure.domDepthAlwaysEqualsDeclared) {
    const s = comments.structure;
    console.log('\n  \x1b[1mCOMMENT STRUCTURE\x1b[0m');
    console.log(`  \x1b[2mDOM ancestor-comment count matches the depth attribute on ` +
                `${s.matches}/${s.total}${s.domDepthAlwaysEqualsDeclared ? ' (ALWAYS)' : ''}\x1b[0m`);
    console.log(`  \x1b[2m${s.directParentIsCommentCount}/${s.total} have another ` +
                `shreddit-comment as their DIRECT parent (true nesting vs. a wrapper)\x1b[0m`);
    console.log(`  \x1b[2mparent element skeletons seen: ${s.parentSkeletons.join(' | ')}\x1b[0m`);
    console.log(`  \x1b[2mancestor chain to the deepest comment:\n    ${(s.sampleChainToDeepestComment || []).join('\n    > ')}\x1b[0m`);
    if (s.sampleMismatch) {
      console.log(`  \x1b[2mexample where depth attribute and DOM nesting disagree: ${JSON.stringify(s.sampleMismatch)}\x1b[0m`);
    }
  }

  /* ---------------- how the REST of the thread arrives ---------------- */
  console.log('\n\x1b[1mLIVE CONTRACTS — COMMENT CONTINUATION\x1b[0m');
  console.log(`  \x1b[2mthread declares ~${comments.declared} comments; ` +
              `${comments.count} in the delivered HTML\x1b[0m`);
  console.log(`  \x1b[2m${comments.partialsOnPage} faceplate-partial on the page, ` +
              `${comments.partialsInTree} inside the comment tree ` +
              `(${comments.programmaticInTree} programmatic)\x1b[0m`);
  if (comments.moreLikeButtons.length) {
    console.log(`  \x1b[2mcontinuation controls seen: ` +
                `${comments.moreLikeButtons.map(t => JSON.stringify(t)).join(', ')}\x1b[0m`);
  }

  const truncated = comments.declared > comments.count + 2;
  check('either the whole thread is delivered, or there is a partial to drive',
    !truncated || comments.partialsInTree > 0,
    `only ${comments.count} of ~${comments.declared} delivered and no partial in the tree — ` +
    `comment continuation uses some other mechanism; see moreLikeButtons above`);

  if (truncated && comments.partialsInTree > 0) {
    check('the comment-tree partial exposes the same loadContent() the feed uses',
      comments.treePartialLoadable,
      'the tree partial has no loadContent() — comment pagination needs a different call');
    console.log('  \x1b[33mNOTE\x1b[0m the thread is truncated and drivable: comment ' +
                'pagination should reuse paginator.js + bridge.js.');
  }
  if (!truncated) {
    console.log('  \x1b[33mNOTE\x1b[0m this thread arrived whole. Re-run against a ' +
                'BIG thread (--sub= a busy sub) before concluding comments need no paging.');
  }

  /* ---------------- what a comment-tree partial actually MEANS ---------------- */
  /**
   * The previous run left this open, and it decides whether paginator.js is correct.
   *
   * It reported 10 partials inside the comment tree with ZERO carrying
   * loading="programmatic", while the visible controls read "16 more replies" and
   * "continue this thread". Those two readings imply completely different mechanisms:
   *
   *   next page        one partial at the bottom of the tree, replaced by the next slice —
   *                    exactly the feed's model, which is what paginator.js assumes and
   *                    what the fixture encodes.
   *   subthread expand  one partial PER truncated branch, each holding only that branch's
   *                    replies. Driving "the first one" then expands one deep branch and
   *                    tells us nothing about the other nine, and whether repeated calls
   *                    make progress depends entirely on whether a driven partial removes
   *                    itself.
   *
   * paginator.js does `document.querySelector(SEL)` and calls loadContent() on the result,
   * over and over. If a driven partial survives the call, that is an infinite loop over one
   * branch with the rest of the thread permanently unreachable — and every existing test
   * would still pass, because the fixture removes itself.
   *
   * So: inventory them, then drive the exact element the paginator would drive, and count.
   */
  console.log('\n\x1b[1mLIVE CONTRACTS — WHAT DRIVES A COMMENT TREE\x1b[0m');

  // Rebuilt here rather than imported: paginator.js is not loadable outside a browser and
  // this must be the string the shipped code uses. run.js asserts the two agree.
  const COMMENTS_SEL = C.COMMENT_PARTIAL + ', ' + C.COMMENT_TREE + ' ' + C.LAZY_LOADER;

  const inventory = await page.evaluate((C, SEL) => {
    const tree = document.querySelector(C.COMMENT_TREE);
    const inTree = [...document.querySelectorAll(C.LAZY_LOADER)].filter(p => p.closest(C.COMMENT_TREE));
    const picked = document.querySelector(SEL);
    // Control text only — never a comment body. "16 more replies" is a Reddit-authored
    // string; the surrounding user content is not ours to log.
    const controlOf = (p) => {
      const t = (p.querySelector('button, a, faceplate-tracker')?.textContent || p.textContent || '')
        .replace(/\s+/g, ' ').trim();
      return t.slice(0, 48);
    };
    return {
      selector: SEL,
      count: inTree.length,
      rows: inTree.map((p, i) => {
        const host = p.closest(C.COMMENT);
        return {
          i,
          loading: p.getAttribute('loading'),
          loadable: typeof p[C.PARTIAL_LOAD_METHOD] === 'function',
          hasSrc: p.hasAttribute('src'),
          // Inside a comment => it holds that comment's replies. Outside => bottom of the
          // tree, i.e. the "next page of top-level comments" candidate.
          hostDepth: host ? Number(host.getAttribute(C.COMMENT_ATTR.depth)) : null,
          lastInTree: tree ? !inTree.slice(i + 1).length : false,
          control: controlOf(p),
          isPicked: p === picked
        };
      }),
      pickedIndex: picked ? inTree.indexOf(picked) : -1,
      pickedInsideAComment: picked ? !!picked.closest(C.COMMENT) : null
    };
  }, C, COMMENTS_SEL);

  console.log(`  \x1b[2mpaginator selector: ${inventory.selector}\x1b[0m`);
  for (const r of inventory.rows) {
    console.log(`  \x1b[2m  [${r.i}]${r.isPicked ? ' <-- paginator picks this' : '        '} ` +
                `loading=${JSON.stringify(r.loading)} loadContent=${r.loadable} ` +
                `src=${r.hasSrc} hostDepth=${r.hostDepth} control=${JSON.stringify(r.control)}\x1b[0m`);
  }

  const anyProgrammatic = inventory.rows.some(r => r.loading === 'programmatic');
  const insideComment = inventory.rows.filter(r => r.hostDepth !== null).length;
  console.log(`  \x1b[2m${insideComment}/${inventory.count} partials sit INSIDE a comment ` +
              `(a branch's replies) vs ${inventory.count - insideComment} at tree level ` +
              `(a next page)\x1b[0m`);

  check('COMMENT_PARTIAL\'s loading="programmatic" still matches something in a real tree',
    anyProgrammatic || inventory.count === 0,
    `${inventory.count} partials in the tree and NONE are programmatic — C.COMMENT_PARTIAL ` +
    `matches nothing live, so paginator.js only works via its fallback selector. Either ` +
    `drop the programmatic clause for comments or record why it is kept.`);

  /**
   * Drive it the way the shipped code does, five times, and watch the numbers.
   *
   * Each round re-queries the selector — that is precisely what paginator.js does — so a
   * partial that survives its own loadContent() shows up as the same index being picked
   * every round with the count flat after the first.
   */
  const rounds = [];
  for (let n = 0; n < 5; n++) {
    const r = await page.evaluate(async (C, SEL) => {
      const idOf = (c) => c.getAttribute(C.COMMENT_ATTR.id);
      const before = new Set([...document.querySelectorAll(C.COMMENT)].map(idOf));
      const inTreeBefore = [...document.querySelectorAll(C.LAZY_LOADER)]
        .filter(p => p.closest(C.COMMENT_TREE));
      const fp = document.querySelector(SEL);
      if (!fp) return { picked: -1, reason: 'no partial matches any more' };

      const index = inTreeBefore.indexOf(fp);
      const host = fp.closest(C.COMMENT);
      const hostId = host ? idOf(host) : null;
      const hostDepth = host ? Number(host.getAttribute(C.COMMENT_ATTR.depth)) : null;
      if (typeof fp[C.PARTIAL_LOAD_METHOD] !== 'function') {
        return { picked: index, reason: 'no loadContent() on it', hostDepth };
      }

      fp[C.PARTIAL_LOAD_METHOD]();
      await new Promise(res => setTimeout(res, 3000));

      const after = [...document.querySelectorAll(C.COMMENT)];
      const added = after.filter(c => !before.has(idOf(c)));
      const inTreeAfter = [...document.querySelectorAll(C.LAZY_LOADER)]
        .filter(p => p.closest(C.COMMENT_TREE));
      return {
        picked: index,
        hostDepth,
        // The mechanical question. If this stays true, re-querying picks the same element
        // for ever and the rest of the thread is unreachable.
        survived: fp.isConnected && !!fp.closest(C.COMMENT_TREE),
        before: before.size,
        after: after.length,
        added: added.length,
        addedDepths: [...new Set(added.map(c => Number(c.getAttribute(C.COMMENT_ATTR.depth))))]
          .sort((a, b) => a - b),
        // Nesting (verified above) means a branch's replies land inside their host.
        addedUnderHost: host ? added.filter(c => host.contains(c)).length : null,
        addedAtDepthZero: added.filter(c => Number(c.getAttribute(C.COMMENT_ATTR.depth)) === 0).length,
        partialsBefore: inTreeBefore.length,
        partialsAfter: inTreeAfter.length
      };
    }, C, COMMENTS_SEL);
    rounds.push(r);
    console.log(`  \x1b[2mround ${n + 1}: ${JSON.stringify(r)}\x1b[0m`);
    if (r.picked === -1 || r.reason) break;
  }

  const drove = rounds.filter(r => r.added !== undefined);
  const totalAdded = drove.reduce((s, r) => s + r.added, 0);
  const productive = drove.filter(r => r.added > 0);

  check('driving a comment-tree partial actually delivers comments',
    drove.length === 0 || totalAdded > 0,
    `${drove.length} loadContent() calls added ${totalAdded} comments — the mechanism ` +
    `paginator.js relies on does nothing on a real thread`);

  check('a driven partial does not survive its own loadContent()',
    drove.every(r => r.survived !== true),
    `a partial was still in the tree after loading, so document.querySelector(SEL) returns ` +
    `the SAME element next time — paginator.js would spin on one branch and never reach ` +
    `the rest of the thread. It needs to skip partials it has already driven.`);

  check('repeated calls keep making progress (not stuck on one branch)',
    drove.length < 2 || productive.length === drove.length,
    `only ${productive.length}/${drove.length} rounds added anything — ` +
    `${JSON.stringify(drove.map(r => ({ picked: r.picked, added: r.added })))}`);

  if (drove.length) {
    const underHost = drove.filter(r => r.addedUnderHost > 0).length;
    const topLevel = drove.filter(r => r.addedAtDepthZero > 0).length;
    const semantics = underHost && !topLevel ? 'SUBTHREAD EXPANSION (replies of one branch)'
      : topLevel && !underHost ? 'NEXT PAGE (more top-level comments)'
        : underHost && topLevel ? 'BOTH — some partials expand a branch, some page the tree'
          : 'inconclusive — nothing arrived';
    console.log(`  \x1b[1mmechanism: ${semantics}\x1b[0m`);
    console.log(`  \x1b[2m${drove[drove.length - 1].after} comments now rendered of ` +
                `~${comments.declared} declared\x1b[0m`);
  }

  /* ---------------- user profiles: the uncaptured contract ---------------- */
  /**
   * C.PROFILE_COMMENT has NEVER been captured — profiles went in scope (project decision
   * 2026-08-21) on the earlier profile capture's observation that a /user/ page holds
   * shreddit-post elements plus "profile-comment elements" whose tag the probe did not
   * record. This section is what settles it. Everything downstream fails safe (a profile
   * that cannot be read hands back native Reddit quietly), so a wrong guess here costs
   * the feature, not a broken page — but only this capture can make the feature real.
   *
   * The user visited defaults to the first post's author on the listing page; override
   * with --user=<name>. INCONCLUSIVE when the profile has no comment-shaped elements at
   * all — a user with no comments looks identical to a completely wrong tag name, the
   * same trap the adult-flag section documents.
   */
  console.log('\n\x1b[1mLIVE CONTRACTS — USER PROFILES\x1b[0m');
  const PROFILE_USER = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1]
    || postAuthorForProfile;
  if (!PROFILE_USER) {
    console.log('  \x1b[33mINCONCLUSIVE: no author captured from the listing — ' +
      'pass --user=<name>.\x1b[0m');
  } else {
    await page.goto(`https://www.reddit.com/user/${PROFILE_USER}/`,
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(C.APP, { timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));       // let the profile feed hydrate

    const profile = await page.evaluate((C) => {
      const tally = {};
      for (const el of document.querySelectorAll('*')) {
        const t = el.tagName.toLowerCase();
        if (/comment/.test(t)) tally[t] = (tally[t] || 0) + 1;
      }
      const found = document.querySelectorAll(C.PROFILE_COMMENT).length;
      const el = document.querySelector(C.PROFILE_COMMENT);
      const A = C.PROFILE_COMMENT_ATTR;
      /* Which body candidate actually matches is the one part of the profile contract
         still unmeasured — live testing established [slot="comment"] is NOT it and did not
         dump the inner DOM. Report the winner by name, and the classes of the node it
         found, so a miss names its own replacement. */
      let bodySel = null, bodyClass = null;
      if (el) {
        for (const cand of C.PROFILE_COMMENT_BODY.split(',').map(s => s.trim())) {
          const n = el.querySelector(cand);
          if (n) { bodySel = cand; bodyClass = n.className || '(no class)'; break; }
        }
      }
      const readable = el ? {
        id: el.getAttribute(A.id),
        href: el.getAttribute(A.href),
        bodySel, bodyClass,
        time: !!el.querySelector('time[datetime]')
      } : null;
      /* WHERE A PROFILE COMMENT SAYS IT LIVES — the round-12 question, and the only one
         this file can settle. Live testing saw /r/<sub>/ hrefs on /user/spez/ and live testing saw
         /user/spez/ hrefs on the SAME profile a day later, which is what made the parent
         line read "comment in u/spez" thirty times out of thirty. So report BOTH: how many
         rows carry a path that names a community at all, and how many carry a RENDERED
         /r/ link outside their own body, which is the evidence model.js falls back to.
         Read across every row, not the first: a page that mixes the two shapes is exactly
         the case a single sample would misreport. */
      const rows = [...document.querySelectorAll(C.PROFILE_COMMENT)];
      const subLinkOf = (n) => [...n.querySelectorAll(C.PROFILE_COMMENT_SUB_LINK)]
        .filter(a => a.closest(C.PROFILE_COMMENT) === n && !a.closest(C.PROFILE_COMMENT_BODY))
        .map(a => (a.getAttribute('href') || '').match(/^\/r\/([^/?#]+)\/?($|\?|#|comments\/)/))
        .find(Boolean);
      const attribution = {
        rows: rows.length,
        hrefNamesSub: rows.filter(n =>
          /^\/r\//.test(n.getAttribute(A.href) || '')).length,
        hrefNamesUser: rows.filter(n =>
          /^\/user\//.test(n.getAttribute(A.href) || '')).length,
        hrefNamesThisProfile: rows.filter(n => new RegExp(
          `^/user/${location.pathname.split('/')[2]}/`, 'i').test(n.getAttribute(A.href) || '')).length,
        withRenderedSubLink: rows.filter(n => !!subLinkOf(n)).length,
        // What the recovery would actually print, for the first row that needs it.
        sample: (() => {
          const n = rows.find(x => /^\/user\//.test(x.getAttribute(A.href) || ''));
          const m = n && subLinkOf(n);
          return n ? { href: n.getAttribute(A.href), recovered: m ? `r/${m[1]}` : null } : null;
        })()
      };
      const domTag = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const domEl = domTag ? document.querySelector(domTag) : null;
      return {
        feed: !!document.querySelector(C.FEED),
        posts: document.querySelectorAll(C.POST).length,
        tally, found, readable, attribution, domTag,
        domAttrs: domEl ? [...domEl.attributes].map(a => a.name) : [],
        domInner: domEl ? [...domEl.querySelectorAll('*')].slice(0, 12)
          .map(n => n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : '')) : []
      };
    }, C);

    console.log(`  \x1b[2mu/${PROFILE_USER}: shreddit-feed=${profile.feed} ` +
      `posts=${profile.posts} comment-ish tags=${JSON.stringify(profile.tally)}\x1b[0m`);
    if (!profile.found) {
      if (profile.domTag) {
        check('the profile comment element is the one this build queries', false,
          `${C.PROFILE_COMMENT} matched nothing; the dominant comment-ish tag is ` +
          `<${profile.domTag}> carrying [${profile.domAttrs.join(', ')}] — that tag is ` +
          `the new C.PROFILE_COMMENT, and its children are [${profile.domInner.join(', ')}]`);
      } else {
        console.log('  \x1b[33mINCONCLUSIVE: no comment-shaped elements at all — this ' +
          'user may simply have no comments. Rerun with --user=<an active user> before ' +
          'concluding anything about C.PROFILE_COMMENT.\x1b[0m');
      }
    } else {
      console.log(`  \x1b[2mmatched <${C.PROFILE_COMMENT}> x${profile.found}, ` +
        `body via ${profile.readable.bodySel || 'NOTHING'} ` +
        `(class "${profile.readable.bodyClass || '-'}")\x1b[0m`);
      check('PROFILE_COMMENT_ATTR id + href are readable on a profile comment',
        !!(profile.readable.id && profile.readable.href),
        `read ${JSON.stringify(profile.readable)} — the render hands back until this matches`);
      /* The one still-unmeasured half. A miss here is why a live profile hands back, and
         the dump above names the replacement selector. */
      check('a comment body is reachable via C.PROFILE_COMMENT_BODY',
        !!profile.readable.bodySel,
        'no candidate matched — rows would be empty, so the page hands back instead. ' +
        'Dump the element\'s children and put the real container in PROFILE_COMMENT_BODY');
      check('the href is thread-shaped (the parent line and full-comments derive from it)',
        /^\/(r|user)\/[^/]+\/comments\//.test(profile.readable.href || ''),
        profile.readable.href);

      /* THE ROUND-12 QUESTION, and this is the run that answers it. Not a check that can
         fail — both href shapes are legitimate — but the measurement that says which one
         this profile is serving today, and whether the fallback has anything to work with
         when the path is user-scoped. */
      const at = profile.attribution;
      console.log(`  \x1b[2mattribution: ${at.rows} rows — ${at.hrefNamesSub} name a ` +
        `subreddit in the path, ${at.hrefNamesUser} name a user (${at.hrefNamesThisProfile} ` +
        `of them THIS profile), ${at.withRenderedSubLink} carry a rendered /r/ link` +
        (at.sample ? `; sample ${at.sample.href} -> ${at.sample.recovered || 'nothing to recover'}` : '') +
        '\x1b[0m');
      /* The one thing that IS a failure: an owner-scoped path with no rendered link to
         fall back on means the row can say nothing about where it lives. That is the
         honest floor rather than a break — the row omits the line instead of naming the
         profile — but it is a fidelity gap against old reddit, and it needs the element's
         inner DOM dumped so a real container can replace the guessed selector. */
      const stranded = at.hrefNamesThisProfile - at.withRenderedSubLink;
      check('every profile comment can name the community it is in',
        at.rows === 0 || stranded <= 0,
        `${stranded} of ${at.rows} rows have an owner-scoped permalink and no rendered ` +
        `/r/ link, so their parent line is omitted. C.PROFILE_COMMENT_SUB_LINK needs the ` +
        `real container: dump one row's children and find where the community is drawn. ` +
        `NEVER close this by printing u/${PROFILE_USER} — that is bug 72.`);
    }
  }

  if (HEADED) {
    console.log('\n  \x1b[2m--headed: browser stays open 30s so you can eyeball it\x1b[0m');
    await new Promise(r => setTimeout(r, 30000));
  }
  await browser.close();
  report();
})().catch((e) => { console.error(e); process.exit(1); });
