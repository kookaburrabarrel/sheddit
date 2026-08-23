/**
 * paginator.js — we own infinite scroll.
 *
 * THE PROBLEM
 * Reddit's feed ships ~3 posts, then a <faceplate-partial loading="programmatic">.
 * "programmatic" means it does NOT self-trigger on scroll — Reddit's own feed JS decides
 * when to call it, driven by the native feed's position in the viewport.
 *
 * Since we hide the native feed, that viewport math never fires and the feed would dead-end
 * at 3 posts. Restoring native intersection while keeping the native UI hidden is a losing
 * battle (you'd have to keep a full-size, laid-out, invisible copy in the scroll flow).
 *
 * THE FIX
 * faceplate-partial exposes a public loadContent(). We call it ourselves against OUR
 * scroll position. Verified live: one call took the home feed 3 -> 28 posts and appended
 * a fresh partial for the next page.
 *
 * NOTE ON "NO API CALLS": loadContent() hits Reddit's own same-origin partial-HTML
 * endpoint — the exact request the page makes for itself, anonymously, no OAuth, no token,
 * no session. We add no endpoint of our own. If you want strictly zero network activity
 * beyond first paint, set settings.autoPaginate = false and the "next page" button below
 * becomes manual.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.paginator = (() => {
  const C = SHD.C;

  const COOLDOWN_MS = 800;      // never hammer the endpoint
  const DRIVING = 'data-shd-driving';   // marks the ONE partial a load is driving — see requestLoad()
  /* The third wake-up, and the one that cannot be taken away: time. Live testing measured BOTH
     event wake-ups dead in the same environment — shdIoTicks 0 for the whole round AND a
     real scroll to the bottom that changed nothing (sentinel at top 650 in an ~840px
     window, dataset byte-identical) — while every timer in the extension ran fine. So a
     slow interval pumps too, geometry-gated like every other pump: an off-screen sentinel
     costs one rect read every two seconds and nothing else. Bug 40's lesson, third
     iteration: events may ACCELERATE the chain; nothing may REQUIRE one. The same tick
     publishes diag(), which is what turns the next report's frozen-looking dataset
     into a live one, and runs the busy watchdog below. */
  const HEARTBEAT_MS = 2000;
  /* Another find: `busy` wedged true for 60+ seconds at page 5 — past every settle
     timer, with no refusal recorded and no error. Where it hung is genuinely unknown (all
     of loadNext's awaits are timer-bounded), so this is a guard AND an instrument: past
     the limit the wedge is logged, published as a refusal, and released, so a hang costs
     one page instead of the whole chain — and shdBusyFor in diag() shows a wedge forming
     live instead of a frozen snapshot. */
  const BUSY_LIMIT_MS = 12000;         // 2x the settle ceiling
  let busySince = 0;
  const MAX_PAGES = 40;         // hard stop; prevents runaway memory on idle tabs
  const TRIGGER_PX = 1200;      // distance from bottom that starts the next fetch
  /* What the chain may do BEFORE the reader has touched the page.

     Reported twice, independently: opening a comments page locked the tab for 30+ seconds
     before recovering, and a [-] collapse on a thread did the same. Neither is a render
     bug — the collapse handler is three operations and cannot reach the render queue — and
     both are this chain running at rest. attach() re-arms after EVERY flush, so each
     intermediate render re-pumps; TRIGGER_PX is 1200, so "in range" stays true until
     roughly two viewports of content sit below the fold; and a load whose content arrives
     after settle() closes is not credited (see unproductive), so MAX_PAGES does not bound
     the churn. Together that is a burst of loads nobody asked for, with the main thread
     saturated while it runs. A collapse restarts it by shrinking the document; a history
     traversal does the same, because onRoute() rebuilds into a briefly-empty page.

     The fill itself is not the mistake. A listing ships THREE posts and is unusable
     without it, and it cannot be gated on scrolling because three rows do not make a
     scrollable page — there is no gesture to wait for. What was missing is a stopping
     point: fill enough to read and to scroll, then let the reader ask for the rest.
     FILL_VIEWPORTS is that point, and UNPROMPTED_MAX bounds it by attempts as well as by
     height, because a run of loads that deliver nothing never grows the page and would
     otherwise spin against the height test for ever. Past either limit the sentinel simply
     reads `load more` and waits, which is a clickable, honest floor rather than a freeze. */
  const FILL_VIEWPORTS = 2;     // stop the unprompted fill once the page is this tall
  const UNPROMPTED_MAX = 4;     // ...and never spend more attempts than this getting there
  const FIRST_MUTATION_MS = 2000;  // give up waiting if the feed never changes at all
  const SETTLE_IDLE_MS = 400;      // ...and once it has, wait for it to go quiet
  const SETTLE_CEILING_MS = 6000;  // absolute cap on one page load

  let pages = 0;
  let busy = false;
  let lastAt = 0;
  let sentinel = null;
  let io = null;
  let visible = false;      // the last thing IntersectionObserver told us — a hint, not the truth
  let ioTicks = 0;          // how many times it has said anything about the CURRENT sentinel
  let serial = 0;           // which sentinel we are on; published so a stale read is detectable
  let pumpTimer = null;
  let interacted = false;   // the reader has scrolled, or asked for more, on THIS page
  let unprompted = 0;       // auto attempts spent before that happened

  /* Which partial we drive depends on the page. Both are faceplate-partial with the same
     loadContent(); only their container differs. The feed variant was hardcoded, so
     comment threads never paginated at all.

     The first clause of each pair is a strict subset of the second and so changes nothing
     about what gets matched — `querySelector` picks the first match in DOCUMENT order, not
     from the first clause that has one. See the note on COMMENT_PARTIAL in contracts.js for
     why the narrow forms are kept regardless.

     Each clause excludes partials we have already driven — see FRESH below. */
  const SELECTORS = {
    LISTING: [C.FEED_PARTIAL, C.FEED + ' ' + C.LAZY_LOADER],
    COMMENTS: [C.COMMENT_PARTIAL, C.COMMENT_TREE + ' ' + C.LAZY_LOADER],
    /* UNVERIFIED, like everything about profiles (C.PROFILE_COMMENT): assumes the profile
       feed is a shreddit-feed like a listing's. If it is not, partial() finds nothing and
       the manual button answers "no more pages" — the honest floor, not a hang. */
    PROFILE: [C.FEED_PARTIAL, C.FEED + ' ' + C.LAZY_LOADER]
  };

  /* Where the newly loaded content lands, per route — what settle() has to watch. Keyed the
     same way as SELECTORS so the two cannot drift apart. */
  const CONTAINERS = { LISTING: C.FEED, COMMENTS: C.COMMENT_TREE, PROFILE: C.FEED };

  /* An INDIVIDUAL item on this route. A pagination partial continues the LIST; a partial
     nested inside one item belongs to that item.
     On COMMENTS that distinction is a preference: a per-branch expander is a legitimate
     thing to drive once the top-level partial is spent (bug 53).
     On LISTING it is absolute, and live measurement is why. `shreddit-feed faceplate-partial`
     also matches Reddit's HOVERCARD partials — one per author and per subreddit link,
     inside the posts (testing counted 82 partials on one page, most of them hovercards).
     Once the real feed partial was spent, the paginator drove hovercard after hovercard:
     40 pages burned, ZERO new rows, sentinel still reading "load more". No partial inside
     a post ever continues a feed, so on a listing there is no fallback at all. */
  const ITEMS = {
    LISTING: `${C.POST_WRAPPER}, ${C.POST}`,
    COMMENTS: C.COMMENT,
    /* Hovercard partials live inside posts on profiles exactly as they do on listings
       (they hang off author/subreddit links, which profile rows carry too), so the
       no-fallback rule is the same: nothing inside an item ever continues a profile. */
    PROFILE: `${C.POST_WRAPPER}, ${C.POST}, ${C.COMMENT}, ${C.PROFILE_COMMENT}`
  };
  const ITEM_FALLBACK = { LISTING: false, COMMENTS: true, PROFILE: false };
  /* What a productive load produces, per route — see the unproductive guard in loadNext. */
  const SOURCES = {
    LISTING: C.POST,
    COMMENTS: C.COMMENT,
    PROFILE: `${C.POST}, ${C.COMMENT}, ${C.PROFILE_COMMENT}`
  };

  /**
   * "...that we have not already driven."
   *
   * The feed's partial REPLACES ITSELF with the next slice and appends a fresh one, so
   * re-querying naturally advances — verified live, 3 posts to 28. We assumed a comment
   * tree behaves the same way, and the fixture encodes that assumption, but the live run
   * contradicts its premise: ten partials inside one comment tree and NOT ONE carrying
   * loading="programmatic", alongside controls reading "16 more replies" and "continue this
   * thread". That reads as one partial per truncated branch, not one per page.
   *
   * Which matters because of how this file drives them: query the selector, call
   * loadContent() on the result, repeat. If a partial does NOT remove itself, every
   * iteration re-picks the SAME element — the paginator spins on one branch and the rest of
   * the thread stays unreachable, while every existing test passes, because the fixture
   * removes itself like the feed does.
   *
   * Stamping the ones we have driven makes the query advance regardless of which mechanism
   * is real, and it is strictly better under both:
   *   replaces itself  the stamp goes away with the element; no change in behaviour
   *   survives         we move to the next partial instead of looping on this one
   * The failure it cannot avoid is a partial that survives AND must be called repeatedly to
   * yield successive pages — then we skip its later pages. That still beats reaching none of
   * the other partials at all, which is the current behaviour.
   *
   * test/live-contracts.js measures which world we are in ("a driven partial does not
   * survive its own loadContent()"); until that runs against a real thread, this file must
   * not depend on the answer.
   */
  const FRESH = `:not([${C.MARK}="done"])`;
  const selectorFor = (mode) =>
    (SELECTORS[mode] || SELECTORS.LISTING).map(s => s + FRESH).join(', ');

  let SEL = selectorFor('LISTING');
  let CONTAINER = CONTAINERS.LISTING;
  let ITEM = ITEMS.LISTING;
  let MODE = 'LISTING';
  let SOURCE = SOURCES.LISTING;
  /* Consecutive loads that produced no new source elements. A partial we can drive but
     that yields nothing is indistinguishable from an exhausted feed as far as the reader
     is concerned, and live testing measured the cost of not noticing: 40 loads, 0 rows. */
  let unproductive = 0;
  const UNPRODUCTIVE_LIMIT = 2;      // one dud is tolerated; two in a row means done
  /* Consecutive AUTO looks that found nothing to drive. The "no more pages" label commits
     only past this streak — see the exhausted branch in loadNext for the report. At
     the heartbeat's 2s cadence this is ~4-6s of genuinely nothing, long past any observed
     inter-page gap. */
  let exhausted = 0;
  const EXHAUSTED_STICKY = 3;
  /* The source count as it stood when the LAST load finished measuring itself. A load's
     content can land after its own settle window closes, and on the live front page it
     always does — see the arrears credit in loadNext. */
  let lastAfter = null;
  /* Prefer a partial that is NOT inside a comment. Captured live: a big
     thread carries ~25 per-branch expanders (loading="action", inside the comment whose
     replies they hold) and exactly ONE top-level continuation partial (loading="lazy",
     a direct child of the tree's <section>). querySelector alone returns the first branch
     expander in document order, so the paginator would spend its pages expanding branch
     after branch and never continue the thread. Branch expanders are still the fallback —
     bug 27's stamping keeps them advancing rather than spinning. */
  const partial = () => {
    const all = document.querySelectorAll(SEL);
    for (const p of all) if (!p.closest(ITEM)) return p;
    return ITEM_FALLBACK[MODE] ? (all[0] || null) : null;
  };

  /** Point the paginator at a route's partials. Called by pipeline.js before attach(). */
  function useMode(mode) {
    SEL = selectorFor(mode);
    MODE = SELECTORS[mode] ? mode : 'LISTING';
    ITEM = ITEMS[MODE];
    SOURCE = SOURCES[MODE];
    // settle() used to watch shreddit-feed unconditionally, which does not exist on a
    // comments page — so it resolved instantly there and never waited for the comments to
    // arrive at all. See settle().
    CONTAINER = CONTAINERS[mode] || CONTAINERS.LISTING;
  }

  /**
   * Ask the main world to call loadContent() for us.
   *
   * We cannot call it ourselves: faceplate-partial is a custom element defined by Reddit's
   * JavaScript, and a content script's isolated world does not see page-defined prototype
   * methods. This is THE reason pagination never worked in the packed extension while
   * working fine in the dev harness (DevTools runs in the main world). See bridge.js.
   *
   * @returns {string} 'ok' | 'no-partial' | 'no-method' | 'threw' | 'no-bridge'
   */
  function requestLoad(target) {
    const root = document.documentElement;
    /* The PICK crosses the bridge, not the query. When both worlds ran querySelector on
       the same string this did not matter — but partial() chooses by POLICY now (top-level
       before branch expanders), and a policy the main world does not share re-resolves to
       a different element: measured in the fixture as one partial stamped while another
       was driven, twice. So the chosen element is marked, the bridge is sent a selector
       only it can match, and the mark comes off in loadNext's finally. */
    target.setAttribute(DRIVING, '');
    root.dataset[C.BRIDGE.selKey] = `${C.LAZY_LOADER}[${DRIVING}]`;
    root.dataset[C.BRIDGE.methodKey] = C.PARTIAL_LOAD_METHOD;
    delete root.dataset[C.BRIDGE.resultKey];
    dispatchEvent(new CustomEvent(C.BRIDGE.request));   // synchronous
    return root.dataset[C.BRIDGE.resultKey] || 'no-bridge';
  }

  let warned = false;
  function warnOnce(result) {
    if (warned) return;
    warned = true;
    const hint = result === 'no-bridge'
      ? 'src/core/bridge.js did not answer — check the "world": "MAIN" content script is ' +
        'registered in manifest.json and that Chrome is 111+.'
      : result === 'no-method'
        ? 'the partial exists but has no loadContent() — C.PARTIAL_LOAD_METHOD is stale.'
        : `bridge reported "${result}".`;
    console.warn(`[sheddit] pagination is not working: ${hint}`);
  }

  /** Why the last loadNext() declined, published via diag() — see its comment. */
  let lastRefusal = 'none';
  const refuse = (why) => { lastRefusal = why; diag(); return false; };

  async function loadNext(reason = 'auto') {
    if (busy) return refuse('busy');
    if (pages >= MAX_PAGES) { setStatus(`stopped after ${MAX_PAGES} pages`); return refuse('max-pages'); }
    // A deliberate click is not a runaway loop, and a button that silently does nothing is
    // worse than one that fetches twice. Only the automatic paths wait out the cooldown.
    if (reason !== 'manual' && Date.now() - lastAt < COOLDOWN_MS) return refuse('cooldown');
    // Resolved here as well as in the bridge, so we can stamp the element afterwards. Both
    // sides use the same selector string against the same document, so both pick the same
    // node; run.js asserts the two halves of that protocol agree.
    const target = partial();
    if (!target) {
      /* "Nothing to drive RIGHT NOW" is not "nothing left". The successor partial can
         arrive LATE — a driven partial's replacement streams in, and on a slow or
         throttled feed the gap between pages is long enough for the auto chain to look,
         find nothing, and announce an ending the very next pump retracts. Reported live
         on 0.9.0's release day: the sentinel flashed "no more pages" ↔ "loading more…"
         between pages that then loaded fine — bug 63's lie, one branch over. So the auto
         path commits to the label only once the empty state PERSISTS; a deliberate manual
         click still gets its answer immediately, because a click that silently does
         nothing is bug 62's sin. The refusal is always published either way — diagnostics
         never wait. */
      if (reason === 'manual' || ++exhausted >= EXHAUSTED_STICKY) setStatus('no more pages');
      return refuse('exhausted');
    }
    exhausted = 0;

    busy = true;
    busySince = Date.now();
    lastAt = busySince;
    setStatus('loading more…');
    try {
      /* Counted BEFORE the load is driven. requestLoad() dispatches a SYNCHRONOUS event
         and a warm partial can append its content before that call even returns — so a
         count taken afterwards already includes the new posts, every load reads as
         unproductive, and the chain stops itself after two. Caught by the cooldown test,
         which is bug 16's lesson in a new place: measure before you trigger. */
      const sourcesBefore = document.querySelectorAll(SOURCE).length;
      /* CREDIT THE PREVIOUS LOAD, IN ARREARS.
         Live testing, front page, tab verified visible: rows grew 28 -> 203 over seven pages
         while `pages` stayed at 0 and the refusal read `unproductive` on all 40 samples.
         Both readings were true. A load is measured the moment settle() resolves, and the
         live feed delivers after that window closes — earlier testing had already recorded the
         phenomenon ("unproductive loads turning productive in arrears") without following
         it through to what it costs: `pages` never advances, so the 40-page memory guard
         is unreachable; and `unproductive` never resets, so every load past the second
         refuses and pump() cannot chain, leaving the whole chain on the 2s heartbeat.
         Content still arrived, which is exactly why nobody saw it for two rounds.
         So: a load whose content shows up late is credited at the next attempt, when the
         evidence is finally there. This does not need to know WHY the window misses —
         which is fortunate, because that is still unmeasured. */
      if (lastAfter !== null && sourcesBefore > lastAfter) {
        pages++;
        unproductive = 0;
        lastRefusal = 'none';
      }
      // Start watching BEFORE triggering the load. loadContent() can append synchronously
      // (a warm cache, or any non-network partial), and an observer attached afterwards
      // sees nothing at all — so every page waited out the full ceiling instead of the
      // 400ms idle. Measured at six seconds per page before this was reordered.
      const settled = settle();
      const result = requestLoad(target);
      if (result !== 'ok') {
        warnOnce(result);
        setStatus('could not load more');
        return refuse('bridge-' + result);
      }
      // Stamp it so the next query moves past it. A partial that replaced itself is already
      // detached and this is a no-op on a dead node; one that survived is now excluded.
      target.setAttribute(C.MARK, 'done');
      // The MutationObserver in pipeline.js picks up whatever arrived — posts or comments.
      // We just need to know when to allow another.
      await settled;
      /* Did that actually produce anything? A driven partial that yields no new sources is
         a dead end — a hovercard, a spent loader, content that never came (live testing's front
         page burned all 40 page slots that way). Later testing then measured what the limit
         really does in the field: it does NOT end the chain — the heartbeat retries two
         seconds later, and that softness is what SAVED a throttled front page (28 -> 178
         rows, with content landing after settle's window and the "unproductive" loads
         turning productive in arrears). So the semantics are honest about being soft now:

           - only PRODUCTIVE loads consume the page budget. `pages` is a memory guard on
             content, and live testing read `pages` 33 for ~7 productive loads — a throttled tab
             would starve its own budget on loads that added nothing.
           - the limit refuses quietly ('unproductive' in the diagnostics) and leaves the
             label alone. It used to declare "no more pages" and then visibly resume —
             the label flapped six times in one field series. "no more pages" belongs to
             `exhausted`, the state where nothing is left to drive; stamps deplete the
             pool, so a genuinely dead feed still gets there. */
      const sourcesAfter = document.querySelectorAll(SOURCE).length;
      lastAfter = sourcesAfter;          // the baseline the NEXT load credits against
      if (sourcesAfter > sourcesBefore) {
        pages++;
        unproductive = 0;
        lastRefusal = 'none';
        setStatus(null);
        return true;
      }
      if (++unproductive >= UNPRODUCTIVE_LIMIT) {
        setStatus(null);
        return refuse('unproductive');
      }
      lastRefusal = 'none';
      setStatus(null);
      return true;
    } catch (err) {
      SHD.gate.reportError(err);
      setStatus('could not load more');
      return refuse('threw');
    } finally {
      target.removeAttribute(DRIVING);
      busy = false;
    }
  }

  /**
   * Resolve once the feed has stopped changing.
   *
   * Three timeouts, because "nothing has happened yet" and "it finished" are different
   * states: FIRST_MUTATION_MS covers a load that produces no mutations at all, then each
   * mutation re-arms a short SETTLE_IDLE_MS quiet period, with a hard ceiling over both.
   * Call this BEFORE triggering the load — see loadNext().
   *
   * The container is per-route. This watched `shreddit-feed` unconditionally, and a comments
   * page has none — so `settle()` hit the early return and resolved IMMEDIATELY on every
   * comment load, meaning `busy` cleared before a single comment had arrived and the pump was
   * free to fire the next page into a load still in flight. Invisible to the suite because
   * the fixture appends synchronously, so there was never anything to wait for.
   */
  function settle() {
    return new Promise(resolve => {
      const root = document.querySelector(CONTAINER);
      if (!root) return resolve();
      let t = setTimeout(done, FIRST_MUTATION_MS);
      const ceiling = setTimeout(done, SETTLE_CEILING_MS);
      const mo = new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(done, SETTLE_IDLE_MS);
      });
      mo.observe(root, { childList: true, subtree: true });
      function done() { clearTimeout(t); clearTimeout(ceiling); mo.disconnect(); resolve(); }
    });
  }

  /**
   * Our own sentinel, at the bottom of OUR rendered list. This is the piece that replaces
   * Reddit's viewport math.
   */
  function attach(container) {
    detach();
    serial++;
    ioTicks = 0;
    sentinel = SHD.dom.h('div.shd-sentinel', { dataset: { status: status || '' } },
      SHD.dom.h('a.shd-loadmore', {
        // Whatever the current load is saying, not the idle label — see setStatus().
        href: '#', text: status || 'load more',
        // Asking for more IS reader intent: releases the unprompted-fill limits so the
        // chain behaves normally from here, exactly as a scroll would.
        onclick: (e) => { e.preventDefault(); interacted = true; loadNext('manual'); }
      })
    );
    container.after(sentinel);
    // The list just changed shape and the sentinel is a brand new node; anything measured
    // against the old one describes a page that no longer exists.
    forget();

    if (!SHD.settings.autoPaginate) return;
    io = new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
      ioTicks++;
      diag();
      // Pump on ANY report, not only an intersecting one. Measured live: the observer
      // reported false for a sentinel that was on screen and then said nothing more, so its
      // verdict is treated as a prompt to go and look rather than as the answer. pump()
      // decides from geometry — see inRange().
      pump('sentinel');
    }, { rootMargin: `${TRIGGER_PX}px 0px` });
    io.observe(sentinel);
    diag();
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (busy && busySince && Date.now() - busySince > BUSY_LIMIT_MS) {
        console.warn(`[sheddit] a page load wedged for ${Date.now() - busySince}ms — releasing. ` +
          'The chain continues; whatever that load was doing is abandoned.');
        busy = false;
        lastRefusal = 'busy-wedged';
      }
      diag();
      pump('tick');
    }, HEARTBEAT_MS);
    // Start the chain OURSELVES. Bug 40 demoted the observer to a wake-up but left it the
    // only wake-up, and live testing measured the failure that allows: shdIoTicks stuck at
    // 0 across serials — an observer that never delivered even its initial report — with
    // the sentinel visibly in range and the chain never starting. pump() is geometry-gated
    // by inRange(), so on a page where the sentinel is far away this is a no-op.
    pump('attach');
  }

  /**
   * Keep loading while the sentinel stays in view.
   *
   * IntersectionObserver only reports CHANGES. Once the sentinel is continuously
   * intersecting it never fires again — and its one callback was routinely swallowed by
   * the cooldown, because attach() runs after every flush and immediately re-observes.
   * Net effect: exactly one extra page ever loaded, then the feed stalled until the user
   * happened to scroll the sentinel out of view and back in.
   *
   * So after each successful load we re-arm ourselves, waiting out whatever remains of the
   * cooldown. A failed load does NOT re-arm — that is what stops this being a spin loop
   * when the pages run out or the cap is hit.
   */
  function pump(reason) {
    clearTimeout(pumpTimer);
    pumpTimer = null;
    if (!SHD.settings.autoPaginate) return;
    /* Report the cap instead of returning silently. pump() guarded on it and returned
       BEFORE loadNext could set the label, so a chain that hit the ceiling sat there
       reading "load more" — the label of a load that SUCCEEDED. Measured live
       on both a 2,040-comment thread and the front page: pages 40, label "load more".
       Bug 40's complaint exactly: nothing on screen said anything had stopped. */
    if (pages >= MAX_PAGES) { setStatus(`stopped after ${MAX_PAGES} pages`); return; }
    if (!inRange() || busy) return;
    /* The unprompted-fill limits. AFTER the geometry and busy checks, so a page that is
       already tall never spends a slot; BEFORE the timer is armed, so waiting out a
       cooldown cannot smuggle one past. Neither limit touches a manual click: loadNext
       ('manual') is called straight from the sentinel's own handler and never comes
       through here, which is what keeps a deliberate press immediate. */
    if (!interacted) {
      const enough = filled();
      if (enough || unprompted >= UNPROMPTED_MAX) {
        lastRefusal = enough ? 'filled' : 'unprompted-limit';
        diag();
        return;
      }
    }
    const wait = Math.max(0, COOLDOWN_MS - (Date.now() - lastAt));
    pumpTimer = setTimeout(async () => {
      pumpTimer = null;
      diag();
      if (!inRange()) return;
      /* Counted per ATTEMPT, not per successful page. pages++ only credits a load that
         delivered (so that the 40-page memory guard measures content), which means a run
         of loads arriving after settle() closes would never advance it — exactly the churn
         this limit exists to bound. */
      if (!interacted) unprompted++;
      if (await loadNext(reason)) pump('follow-up');
      else diag();   // record WHY we stopped, for the reader of the next stall report
    }, wait);
  }

  /**
   * Is the bottom of OUR list near enough to the viewport to want another page — measured
   * from the DOM right now, rather than remembered from the last observer callback?
   *
   * This gate used to read `visible`, and that remembered answer was wrong on a real page
   * and was never corrected. Live capture, five pages in: the sentinel sat 80px ABOVE the
   * fold with 22 undriven partials left in the feed, and the paginator's own state read
   * `visible: false` — with no further observer callback for at least ten seconds, because
   * the reader was already at the bottom of the document and nothing moved.
   *
   * The mechanism is that attach() runs on every flush and detach() resets `visible` to
   * false. So every successful load ends by throwing away the one fact its own continuation
   * depends on, then waits for the observer to say it again — and IntersectionObserver only
   * reports CHANGES. When the correction does not come, the feed dead-ends with work still
   * available and a sentinel reading "load more", which is the label of a load that
   * SUCCEEDED. Nothing on screen says anything is wrong.
   *
   * Geometry cannot go stale like that: it is whatever the page is at the moment we ask.
   * The observer stays, but demoted to a wake-up — see attach(). This is bug 17's lesson
   * one door over: never make the continuation of a chain depend on an event that may
   * not fire.
   */
  /* ONE layout read per frame, shared by every caller that needs geometry.

     getBoundingClientRect() and scrollHeight both force synchronous layout. inRange() ran
     one, diag() ran inRange() plus a second rect read of its own, and both are called from
     every pump and every heartbeat tick — interleaved with renders that invalidate layout
     again. That is layout thrashing, and it is why a burst of loads presented as a frozen
     tab with torn, tiled repaints rather than as something merely slow: the work was not
     the loading, it was measuring between every step of it.

     A frame's worth of staleness cannot change an answer here. The cooldown that pump()
     waits out before re-measuring is 800ms, two orders of magnitude longer, and attach()
     drops the cache outright whenever the list has actually grown. */
  const MEASURE_TTL_MS = 16;
  let measured = null;
  let measuredAt = 0;

  function forget() { measured = null; }

  function measure() {
    if (!sentinel || !sentinel.isConnected) return null;
    const now = Date.now();
    if (measured && now - measuredAt < MEASURE_TTL_MS) return measured;
    const r = sentinel.getBoundingClientRect();
    const doc = document.documentElement;
    measured = {
      top: r.top,
      bottom: r.bottom,
      empty: !r.top && !r.bottom && !r.height,
      viewport: innerHeight || doc.clientHeight || 0,
      pageHeight: doc.scrollHeight || 0
    };
    measuredAt = now;
    return measured;
  }

  function inRange() {
    const m = measure();
    if (!m) return false;
    // A node inserted this tick may not have been laid out yet, and an empty rect means
    // "not measured", not "far away". Treating unknown as far away is the stall above.
    if (m.empty) return true;
    return m.top <= m.viewport + TRIGGER_PX && m.bottom >= -TRIGGER_PX;
  }

  /**
   * Is there enough on the page for the reader to start reading and scrolling?
   *
   * The stopping point for the unprompted fill — see FILL_VIEWPORTS. Height rather than a
   * row count, because rows are wildly uneven: three link posts and three image-heavy
   * nested comment trees are the same count and nothing like the same page.
   */
  function filled() {
    const m = measure();
    if (!m || !m.viewport) return false;
    return m.pageHeight >= m.viewport * FILL_VIEWPORTS;
  }

  /* The label SURVIVES a re-attach, which is why it is module state rather than just DOM.
     attach() runs after every pipeline flush so the sentinel stays at the bottom of a list
     that is still growing — and it builds a NEW node, whose label starts at the idle
     "load more". A load in flight is exactly when new content arrives, so a page loading
     normally repainted `loading more…` -> `load more` -> `loading more…` on every flush:
     live testing watched it flicker on /r/aww before the content landed. The status belongs to
     the LOAD, not to the node that happens to be displaying it. */
  let status = null;

  function setStatus(text) {
    status = text || null;
    if (!sentinel) return;
    sentinel.dataset.status = text || '';
    const a = sentinel.querySelector('.shd-loadmore');
    if (a) a.textContent = text || 'load more';
    diag();
  }

  /**
   * Publish the paginator's internal state onto the sentinel as data attributes.
   *
   * This exists because of a live stall nobody could diagnose. The sentinel read "load
   * more" (the label left by a SUCCESSFUL load) with 22 undriven partials still in the
   * feed and the sentinel itself 99px below the fold — inside the 1200px trigger margin.
   * So the chain was dead with work available, and every candidate explanation
   * (`visible` stuck false, the cooldown, `busy`, autoPaginate off) predicts exactly that
   * same DOM. Reading cannot separate them.
   *
   * `SHD` lives in the isolated world, so a tester's console — and any page-world
   * automation — cannot reach `SHD.paginator` to ask. Our own DOM is the only channel
   * across that boundary, the same one the bridge protocol already uses. These are cheap
   * attribute writes on one element we own, so they are always on rather than behind a
   * flag: a diagnostic that has to be enabled before it can be used is not there when the
   * bug is.
   */
  function diag() {
    if (!sentinel) return;
    const d = sentinel.dataset;
    // Both answers to "is the bottom of the list near the viewport", side by side, because
    // the live stall was the two disagreeing: shdVisible false with the sentinel on screen.
    // Only shdInRange gates anything now; shdVisible is kept purely so that disagreement
    // stays visible in the next stall report instead of having to be inferred again.
    // One measurement, read three ways. This used to run inRange()'s rect read and then a
    // second of its own, on every pump and every tick — see measure().
    const m = measure();
    d.shdVisible = String(visible);
    d.shdInRange = String(inRange());
    d.shdTop = m ? String(Math.round(m.top)) : 'detached';
    /* Why the chain is idle on a page that has more to give. Without these, the
       unprompted-fill limits look identical to a stall: sentinel reading `load more`,
       nothing loading, no refusal that explains it. */
    d.shdInteracted = String(interacted);
    d.shdUnprompted = String(unprompted);
    d.shdFilled = String(filled());
    // How many times the observer has reported on THIS sentinel, and which sentinel it is.
    // Together these separate "the observer went silent" from "the element being read is
    // not the one we are writing to" — two causes that produce identically frozen output.
    d.shdIoTicks = String(ioTicks);
    d.shdSerial = String(serial);
    d.shdBusy = String(busy);
    d.shdBusyFor = busy && busySince ? String(Date.now() - busySince) : '0';
    d.shdPages = String(pages);
    d.shdAuto = String(!!SHD.settings.autoPaginate);
    d.shdObserving = String(!!io);
    d.shdSinceLast = lastAt ? String(Date.now() - lastAt) : 'never';
    d.shdPumpArmed = String(pumpTimer !== null);
    // Whether there is anything left to drive, by the SAME selector loadNext() uses —
    // so a mismatch between this and a hand-written probe is itself informative.
    try { d.shdFresh = String(!!document.querySelector(SEL)); } catch { d.shdFresh = 'error'; }
    // Why the last attempt declined. This is the field that separates the explanations a
    // stalled sentinel cannot: 'exhausted' and 'cooldown' and 'busy' all leave the same DOM.
    d.shdRefusal = lastRefusal;
    d.shdUnproductive = String(unproductive);
    d.shdExhausted = String(exhausted);
    /* What the productivity guard is actually counting. Live testing reported `pages: 0` with
       rows growing, and the two could only be reconciled by inference; this is the number
       that settles it directly in the next report. */
    try { d.shdSources = String(document.querySelectorAll(SOURCE).length); } catch { /* */ }
  }

  /* The other wake-up that cannot fail to exist: the reader's own scrolling. Passive and
     self-throttled; pump() re-checks geometry and the cooldown, so this is cheap even on a
     fast wheel. One listener for the module's lifetime — attach()/detach() churn on every
     flush, so a per-sentinel listener would leak or vanish. */
  let lastScrollPump = 0;
  addEventListener('scroll', () => {
    /* Reader intent, recorded before every early return below. This is the signal that
       releases the unprompted-fill limits, so it must not depend on a sentinel existing
       yet, nor be swallowed by the pump throttle. */
    interacted = true;
    if (!sentinel) return;
    const now = Date.now();
    if (now - lastScrollPump < 250) return;
    lastScrollPump = now;
    pump('scroll');
  }, { passive: true });

  let heartbeat = null;

  function detach() {
    clearInterval(heartbeat); heartbeat = null;
    clearTimeout(pumpTimer); pumpTimer = null;
    io?.disconnect(); io = null;
    sentinel?.remove(); sentinel = null;
    visible = false;
  }

  function reset() {
    detach(); pages = 0; busy = false; lastAt = 0; unproductive = 0; exhausted = 0;
    lastAfter = null;
    /* A new route is a new page to fill, and the reader has not touched THIS one — the
       whole point of the limits is that they apply per page. Leaving these set would let
       one scroll on a listing licence an unbounded burst on every thread opened after it. */
    interacted = false; unprompted = 0; forget();
    // A new route's sentinel starts idle. Carrying the old page's label across is the same
    // lie the flicker was, one navigation later.
    status = null;
    // Drop our "already driven" stamps. A client-side navigation is a different thread or
    // listing, and any partial still carrying a stamp from the previous page would be
    // skipped for the lifetime of the tab.
    document.querySelectorAll(`${C.LAZY_LOADER}[${C.MARK}="done"]`)
      .forEach(p => p.removeAttribute(C.MARK));
  }

  return { attach, detach, reset, loadNext, useMode, get pages() { return pages; } };
})();
