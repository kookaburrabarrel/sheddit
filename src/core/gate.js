/**
 * gate.js — FOUC suppression, failure detection, and the failure screen.
 *
 * Runs at document_start alongside suppress.css. The contract:
 *   - Native Reddit is hidden from the first paint.
 *   - The moment we successfully render anything, we reveal our own layout.
 *   - If we cannot render, we say so ON SCREEN and offer a way out.
 *
 * WHY NOT JUST HAND BACK NATIVE REDDIT
 * The first version silently removed our suppression on failure, so a broken extension
 * looked exactly like an uninstalled one — the user got modern Reddit with no explanation
 * and no reason to suspect Sheddit at all. That reads as "some other bug". A failure now
 * renders a screen naming the reason, and un-suppressing native Reddit is a BUTTON the
 * user presses, not something that happens behind their back.
 *
 * WHY THE FAILSAFE IS CONTENT-AWARE
 * A flat "nothing rendered in 1500ms" deadline is not a bug detector, it is a speed
 * detector. Measured: with Reddit's HTML stalled 1600ms before the posts arrive, the old
 * timer fired and permanently disabled the extension for a page that was about to work.
 * Reddit streams its markup, so any slow connection tripped it.
 *
 * So the deadline asks *why* nothing has rendered:
 *   - source elements present, nothing rendered  -> that is our bug. Fail now.
 *   - no source elements yet                     -> the page has not arrived. Wait more,
 *                                                   up to MAX_WAIT_MS, then report that
 *                                                   Reddit sent us nothing.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.gate = (() => {
  const FIRST_CHECK_MS = 1500;   // first look; also the re-check interval
  const MAX_WAIT_MS = 12000;     // total patience when Reddit has sent nothing at all
  const ERROR_BUDGET = 8;

  const ERROR_ID = 'shd-error';

  let revealed = false;
  let failed = false;
  let released = false;          // user chose native Reddit; latches for the document
  /**
   * Has the pipeline actually taken responsibility for the current route?
   *
   * gate.js arms at document_start; pipeline.js does not boot until document_idle and then
   * awaits chrome.storage.sync before it classifies anything. Until it calls engage(),
   * "sources present, nothing rendered" says nothing about whether we are broken — nobody
   * has tried. It also never becomes true on a route we hand back: a user profile carries
   * shreddit-post elements, so without this the deadline could put an error screen on a
   * page standDown() is a few hundred milliseconds away from disowning — a flash of an
   * error screen that then removes itself, which is a bug report nobody can reproduce.
   */
  let engaged = false;
  /**
   * Soft engagement: failures HAND BACK instead of raising the error card.
   *
   * Set for routes whose Reddit contract is UNVERIFIED — today that is user profiles,
   * where the comment element has never been captured (C.PROFILE_COMMENT). On such a
   * route "we could not read this page" is an expected outcome, not an anomaly worth an
   * error screen: the card's whole justification is that silence looks like an unrelated
   * Reddit bug, but on a page we only might be able to render, showing native Reddit IS
   * the correct fallback — it is exactly what the reader had before the route was in
   * scope. The failure still reaches the console and stamps <html>, so a report can see
   * it; it never covers the page. This is bug 52's trade ("standing aside over a page we
   * cannot read beats an error card over a page that is fine") promoted to a per-route
   * policy.
   */
  let soft = false;

  /** pipeline.js calls this from onRoute() once it has decided this route is ours. */
  function engage(softMode = false) { engaged = true; soft = !!softMode; }
  let errors = 0;
  let firstError = null;
  let timer = null;
  let waited = 0;

  const stopListeners = new Set();

  /** Teardown to run when we stop rendering, for any reason. pipeline.js registers here. */
  function onStop(fn) { stopListeners.add(fn); return () => stopListeners.delete(fn); }

  const stopped = () => failed || released;

  const sourceCount = () => {
    try {
      return document.querySelectorAll(
        `${SHD.C.POST}, ${SHD.C.COMMENT}, ${SHD.C.PROFILE_COMMENT}`).length;
    } catch { return 0; }
  };
  const renderedCount = () => {
    try {
      return document.querySelectorAll(`#${SHD.C.ROOT_ID} .thing`).length;
    } catch { return 0; }
  };
  /* How many of the sources the renderer has actually LOOKED AT. pipeline.js stamps every
     element it consumes, succeed or fail — so this is the number that splits "rendered: 0"
     into its two very different causes. 0 stamped means the flush never ran (a scheduling
     or environment failure — bug 35's whole family); all stamped means every element was
     processed and rejected, i.e. contracts.js is stale, and the model's reject tally says
     which attribute moved. A report sat exactly on this fork and could not tell.
     Guessing wrong sends whoever reads the card to the wrong file. */
  const stampedCount = () => {
    try {
      return document.querySelectorAll(
        `${SHD.C.POST}[${SHD.C.MARK}], ${SHD.C.COMMENT}[${SHD.C.MARK}], ` +
        `${SHD.C.PROFILE_COMMENT}[${SHD.C.MARK}]`).length;
    } catch { return 0; }
  };

  /* ------------------------------------------------------------------ *
   * lifecycle
   * ------------------------------------------------------------------ */

  function arm() {
    document.documentElement.classList.add('shd-gate');
    scheduleCheck();
    watchNativeModal();
    // The first scheduled check is 1500ms out, but an interstitial is usually `complete`
    // within a few hundred. Decide the one case that is safe to decide early: no posts
    // AND nowhere for posts to go means this is not our kind of page, so stop blanking it.
    // Anything involving whether we RENDERED has to wait for the pipeline, which does not
    // run until document_idle — deciding that here would fail every page prematurely.
    addEventListener('load', () => {
      if (revealed || stopped()) return;
      const why = nothingToRender();
      if (why) unblank(why);
    }, { once: true });
  }

  function scheduleCheck() {
    clearTimeout(timer);
    timer = setTimeout(check, FIRST_CHECK_MS);
  }

  /** Does this page even have somewhere posts could arrive? */
  const hasFeedContainer = () => {
    try { return !!document.querySelector(`${SHD.C.FEED}, ${SHD.C.COMMENT_TREE}`); }
    catch { return false; }
  };

  /**
   * Is there anything IN that container, or is it an empty shell?
   *
   * The distinction decides whether an unrenderable page is our fault. "Feed present, zero
   * posts" was treated as one situation and it is two:
   *
   *   empty shell        an age gate that ships the feed scaffolding, a brand-new subreddit,
   *                      a community where everything is filtered out. Nothing is wrong —
   *                      there is simply nothing to draw.
   *   full of markup     posts are there in some form we no longer recognise. That is the
   *                      signature of a redesign renaming shreddit-post, and failing loudly
   *                      is the whole point of the deadline.
   *
   * Measured on a real interstitial carrying `<shreddit-feed></shreddit-feed>`: the page
   * never un-blanked and #shd-error landed on top of the "Yes, I am over 18" button. That is
   * bug 21 arriving by a second route, and the branch below already claimed in its own
   * comment to handle "an empty subreddit" — which it did not, because an empty subreddit
   * has a feed element with nothing inside it.
   *
   * POST_WRAPPER is checked first because it is a recorded contract (`shreddit-feed >
   * article > shreddit-post`): a wrapper with no post inside it is exactly the renamed-element
   * case and must stay a failure. The element count behind it is a blunt "is there real
   * markup here", deliberately low — an empty `shreddit-feed` has 0 and an empty
   * `shreddit-comment-tree` has its `<section>` and little else.
   */
  const SHELL_ELEMENTS = 3;
  const feedIsPopulated = () => {
    try {
      const c = document.querySelector(`${SHD.C.FEED}, ${SHD.C.COMMENT_TREE}`);
      if (!c) return false;
      if (c.querySelector(SHD.C.POST_WRAPPER)) return true;
      /* A LIST has repeated sibling structure; a message has one shape.
         This counted DESCENDANTS, and Reddit's own "this community doesn't have any posts
         yet" panel is real markup — comfortably more than a handful of elements — so an
         empty subreddit read as "a feed full of content we cannot parse" and got the
         failure screen. Observed live 2026-08-20 on a quarantined sub, logged out, where
         Reddit serves zero posts: `sources: 0`, and a `no-content` card over a page that
         was not broken. That is the cardinal sin in this module (see bugs 21 and 29) and
         the decision tree already claimed to handle "a subreddit with nothing in it".

         Three siblings sharing a tag name is what a feed of posts looks like and what a
         message block does not. One level of unwrapping, because a comment tree nests its
         list inside a single <section>. Deliberate trade: if Reddit ever renamed BOTH the
         post element and its wrapper, this stands aside quietly where the old count failed
         loudly — untested and never observed either way, whereas the empty subreddit just
         happened. Standing aside over a page we cannot read beats an error card over a page
         that is fine. */
      let scope = c;
      if (scope.children.length === 1) scope = scope.children[0];
      const byTag = new Map();
      for (const kid of scope.children) byTag.set(kid.tagName, (byTag.get(kid.tagName) || 0) + 1);
      return [...byTag.values()].some(n => n >= SHELL_ELEMENTS);
    } catch { return false; }
  };

  /**
   * Why there is nothing for us to draw here — or null if content might still be coming.
   *
   * Three places need this question answered and they used to ask it in their own words,
   * which is how the early `load` path and the deadline came to disagree about what counts
   * as "not our page". One definition, three callers.
   *
   * @returns {'no-feed-container'|'empty-feed'|null}
   */
  function nothingToRender() {
    if (sourceCount() > 0) return null;     // sources exist: rendering them is our job
    if (!hasFeedContainer()) return 'no-feed-container';
    if (!feedIsPopulated()) return 'empty-feed';
    return null;
  }

  /**
   * Is nothing on screen because we are broken, because Reddit is slow, or because this
   * simply is not a page we render?
   */
  function check() {
    if (revealed || stopped()) return;
    waited += FIRST_CHECK_MS;

    const sources = sourceCount();
    if (sources > 0) {
      // Reddit delivered posts. Whether that is OUR bug depends entirely on whether
      // anything of ours has looked at them yet — see `engaged`. Stop blanking the page,
      // but do not accuse ourselves of a rendering failure nobody has attempted: the
      // pipeline boots at document_idle and then awaits chrome.storage.sync, so at the
      // first 1500ms tick it may simply not have started.
      //
      // Reaching MAX_WAIT_MS here does mean a real failure: on a route we do not handle,
      // standDown() clears this timer, so a live timer at 12s with sources on the page and
      // no pipeline means the content script that renders never started at all. That is
      // worth an honest error screen rather than silence — silence is the "looks exactly
      // like an uninstalled extension" failure this module was written to end.
      if (!engaged) {
        unblank('not-started');
        if (waited < MAX_WAIT_MS) return scheduleCheck();
        return fail('pipeline-stalled', { sources, waited });
      }

      // Sources are here, we took the route, and we rendered none of them. Before calling
      // that our bug: if the renderer has never processed a single element, its flush may
      // simply be parked on a rAF a busy main thread has starved (bugs 35's family; seen
      // twice in the field as transient "stamped: 0" cards that a reload cleared). Drain
      // the queue synchronously and re-look — a deadline must not accuse work it has not
      // tried to run.
      if (stampedCount() === 0) {
        SHD.pipeline?.kick?.();
        if (renderedCount() > 0) return;    // reveal() ran inside the flush; we are done
      }
      return fail('render-failed', { sources, stamped: stampedCount(),
                                    rejected: SHD.model?.rejectSummary?.() || '' });
    }

    // No feed and no comment tree: an age gate, a private community, a rate-limit page.
    // Or a container that is present but empty: the same age gate shipping its feed
    // scaffolding, or a subreddit with nothing in it. Neither is broken, so an error screen
    // would be a lie — and an error screen over an age gate actively stops the user clicking
    // through. Show them the page. Keep the pipeline running in case content turns up.
    const why = nothingToRender();
    if (why) {
      unblank(why);
      if (waited < MAX_WAIT_MS) scheduleCheck();
      return;
    }

    // A feed exists and holds markup, but nothing we recognise. That IS suspicious — it is
    // what a renamed post element looks like — so it stays a failure.
    if (waited < MAX_WAIT_MS) return scheduleCheck();
    fail('no-content', { sources: 0, waited });
  }

  /**
   * Stop hiding the page without giving up on it.
   *
   * Distinct from both reveal() (our layout is up) and standDown() (this route is not
   * ours at all). Used while we are still willing to render but have nothing to render
   * yet — the alternative was leaving the pre-render blackout up, which showed a blank
   * white page for the full MAX_WAIT_MS on every interstitial.
   */
  function unblank(why) {
    if (revealed || stopped()) return;
    document.documentElement.classList.remove('shd-gate');
    document.documentElement.setAttribute('data-shd-waiting', why);
  }

  /**
   * A route change is a fresh attempt: clear the previous page's failure and re-arm.
   *
   * `revealed` must be cleared too, and that is load-bearing. pipeline.js removes
   * #shd-root on every navigation, so between routes there is nothing of ours on screen
   * while native Reddit is still suppressed. If the deadline stayed disarmed — which it
   * did, because check() returns early once revealed latches — an SPA navigation onto a
   * page we cannot render left a permanently blank screen with no failsafe. That is the
   * precise failure this whole module exists to prevent.
   */
  function resetForRoute() {
    if (released) return;                 // the user asked for native Reddit; respect it
    const wasRevealed = revealed;
    failed = false;
    revealed = false;
    engaged = false;                      // the incoming route has not been taken yet
    soft = false;
    waited = 0;
    errors = 0;
    SHD.model?.clearRejects?.();     // fresh page, fresh evidence — a stale tally would
                                     // blame the previous route's markup for this one
    firstError = null;
    document.documentElement.classList.remove('shd-failed');
    document.documentElement.removeAttribute('data-shd-fail');
    document.documentElement.removeAttribute('data-shd-soft-fail');
    document.documentElement.removeAttribute('data-shd-waiting');
    document.getElementById(ERROR_ID)?.remove();


    // Only black the page out on a route we have never rendered. Mid-session .shd-active
    // is already on and our stylesheet should stay live for the incoming rows.
    if (!wasRevealed) {
      document.documentElement.classList.add('shd-gate');
      // ...but do not re-blank a page we have already established has nothing to render.
      // pipeline.js boots at document_idle, which can land either side of `load`, so
      // without this the early unblank gets undone and the user stares at white until the
      // next 1500ms tick.
      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);
    }
    scheduleCheck();
  }

  /** First successful render — swap suppression for our active state. */
  function reveal() {
    if (revealed || stopped()) return;
    revealed = true;
    clearTimeout(timer);
    document.documentElement.classList.remove('shd-gate');
    document.documentElement.removeAttribute('data-shd-waiting');
    document.documentElement.classList.add(SHD.C.BODY_CLASS);
  }

  /* ------------------------------------------------------------------ *
   * suppressing Reddit's own modals
   * ------------------------------------------------------------------ */

  /**
   * POLICY (project decision, 2026-08-20): the extension NEVER leaves its layout for a Reddit
   * popup. Age gates, NSFW interstitials, cookie/privacy dialogs, login upsells — all stay
   * hidden under our render, and the scroll lock they set is stripped so the page keeps
   * scrolling. The reader installed an old-reddit renderer; a round trip out of it to look
   * at an overlay is the product failing, not working.
   *
   * This supersedes the defer machinery (docs/engineering-log.md bugs 30/33/38 are its history). Deferring
   * existed because hiding the 18+ gate while showing its content was read as a bug (30). It
   * is now the intended behaviour, and it is safe for the same reason bug 30 was possible at
   * all: the gate does not replace the feed, it covers it — the posts are in the DOM the
   * whole time (verified live 2026-08-18 on a real NSFW sub, logged out). We render what
   * Reddit already sent; suppress.css hides the body children the modal lives in; the only
   * extra work is the lock, and an `overflow: visible` override in old-reddit.css backstops
   * a lock applied as an inline style rather than the class.
   *
   * What this deliberately does NOT do:
   *   - Delete unknown modal DOM. Only the enumerated login upsell is removed (see
   *     C.NATIVE_UPSELL). Everything else is merely hidden; deleting nodes we cannot name
   *     risks breaking a flow we have never captured (quarantine pages, for one).
   *   - Touch pages we are not rendering. Everything is gated on `engaged` — an unhandled
   *     route keeps its modals, its lock, and its native behaviour (bug 37).
   *   - Click blind. The ONE modal we answer is the 18+ gate (policy decision):
   *     answerAgeGate() below clicks Reddit's own affirmative, which beats hiding it — Reddit clears its own lock, remembers the
   *     answer, and pagination serves an attested session. But only on a single confident
   *     match; anything ambiguous falls back to suppression, because the wrong button
   *     navigates away. Un-matched gates leave pagination unverified (docs/engineering-log.md open
   *     questions) — the manual load-more button is the graceful floor there.
   */
  const nativeModalUp = () => {
    try { return !!document.body?.classList.contains(SHD.C.NATIVE_MODAL_CLASS); }
    catch { return false; }
  };

  /**
   * Click the 18+ gate's own affirmative button. See C.AGE_GATE for the captured anatomy
   * and the trap; the policy comment above for why answering beats hiding.
   *
   * FAIL SAFE BY SHAPE: exactly one button matching affirm-and-not-decline, or we touch
   * nothing — the gate stays suppressed like any other modal, which is what shipped before
   * this existed. The host is stamped before the click so a button that no-ops (or a gate
   * Reddit re-renders identically) is never hammered on every mutation tick.
   */
  function answerAgeGate() {
    if (!engaged || stopped()) return;
    try {
      for (const host of document.querySelectorAll(SHD.C.AGE_GATE.host)) {
        if (host.hasAttribute('data-shd-answered')) continue;
        const yes = [...host.querySelectorAll('button')].filter(b => {
          const t = (b.textContent || '').trim();
          return SHD.C.AGE_GATE.affirm.test(t) && !SHD.C.AGE_GATE.decline.test(t);
        });
        if (yes.length !== 1) continue;   // ambiguity means hands off — see C.AGE_GATE
        host.setAttribute('data-shd-answered', 'clicked');
        yes[0].click();
      }
    } catch { /* answering is best-effort; suppression below is the floor */ }
  }

  function suppressKnownUpsells() {
    // Only ever on a page we are actually rendering. This module arms at document_start
    // and its observers are never disconnected, so without this check it deleted Reddit's
    // login wall and cleared its scroll lock on every route we hand back — search,
    // profiles, modmail, and any listing whose toggle the user turned off. standDown()
    // promises those pages are untouched; deleting an element is as much a violation of
    // that as restyling one.
    if (!engaged || stopped()) return false;
    let found = false;
    try {
      document.querySelectorAll(SHD.C.NATIVE_UPSELL.nodes).forEach(el => { el.remove(); found = true; });
      if (found) document.body?.classList.remove(SHD.C.NATIVE_MODAL_CLASS);
    } catch { /* a selector failure here should not take the rest of the page down with it */ }
    return found;
  }

  /**
   * Strip the scroll lock that any Reddit overlay sets, so our layout keeps scrolling under
   * a modal nobody can see. Reddit may set it again; the observers below re-run this on
   * every class mutation, and removal is idempotent, so the exchange converges. Gated on
   * `engaged` for the same reason suppressKnownUpsells is — an unhandled route keeps its
   * native behaviour, lock included (bug 37).
   */
  function stripScrollLock() {
    if (!engaged || stopped()) return;
    if (nativeModalUp()) document.body.classList.remove(SHD.C.NATIVE_MODAL_CLASS);
  }

  function syncNativeModal() {
    if (stopped()) return;
    answerAgeGate();
    suppressKnownUpsells();
    stripScrollLock();
  }

  /**
   * Body does not exist yet at document_start, and Reddit adds the class later still.
   *
   * TWO observers, because the class alone is not a safe trigger. Watching only
   * `body[class]` assumes Reddit inserts the upsell's elements and THEN sets the scroll
   * lock. That is the order the live recon implies (the element is appended, and its own
   * lifecycle then calls a showModal()-style method), but nothing guarantees it. Reverse it
   * and the failure is the exact trap this code exists to prevent: the class lands, we
   * defer, the elements arrive with no further class mutation, the observer never fires
   * again, and the reader is left staring at an unremovable wall with our layout hidden
   * behind it. So insertion is watched too.
   *
   * Scoped to shreddit-app's DIRECT children rather than a subtree observer on body:
   * both upsell nodes are direct children of it (verified), pipeline.js already runs one
   * full-subtree observer on this page, and a second one firing on every streamed post to
   * re-check two selectors is a real cost for no extra coverage.
   */
  function watchNativeModal() {
    let hostObserver = null;
    let hostEl = null;

    /** Attach the insertion observer to shreddit-app. True once it is attached. */
    const watchHost = () => {
      const host = document.querySelector(SHD.C.APP);
      if (!host) return false;
      if (host === hostEl) return true;
      try {
        hostObserver?.disconnect();
        hostObserver = new MutationObserver(syncNativeModal);
        hostObserver.observe(host, { childList: true });
        hostEl = host;
        return true;
      } catch { return false; }
    };

    const begin = () => {
      if (!document.body) return;
      syncNativeModal();
      try {
        new MutationObserver(syncNativeModal)
          .observe(document.body, { attributes: true, attributeFilter: ['class'] });
      } catch { /* nothing we can do; the initial sync above still ran */ }

      // The app container is where the upsell is portalled. If it is not in the DOM yet,
      // the fallback to body's children is TEMPORARY and not a substitute: latching onto
      // body because shreddit-app happened to be late means the upsell would be inserted
      // into a node nobody is watching — the same hole this second observer exists to
      // close, arrived at from the other side. So watch body's children only until the
      // app element turns up, then move onto it and stop.
      if (!watchHost()) {
        try {
          // shreddit-app is a direct child of body, so a childList observer here sees it
          // arrive. Hand over and disconnect the moment it does.
          const pending = new MutationObserver(() => {
            syncNativeModal();
            if (watchHost()) pending.disconnect();
          });
          pending.observe(document.body, { childList: true });
        } catch { /* same */ }
      }
    };
    if (document.body) begin();
    else addEventListener('DOMContentLoaded', begin, { once: true });
  }

  /**
   * We cannot render this page. Stop the pipeline, remove our half-built DOM, and put an
   * explanation on screen. Native Reddit STAYS suppressed — release() is the way out, and
   * the user drives it.
   */
  function fail(reason, detail = {}) {
    if (stopped()) return;
    failed = true;
    clearTimeout(timer);

    for (const fn of stopListeners) {
      try { fn(reason); } catch (e) { console.warn('[sheddit] stop listener threw', e); }
    }

    // old-reddit.css is scoped under .shd-active, so anything already rendered would
    // otherwise sit there unstyled behind the error screen.
    document.documentElement.classList.remove('shd-gate', SHD.C.BODY_CLASS);
    document.getElementById(SHD.C.ROOT_ID)?.remove();
    document.getElementById('shd-header')?.remove();

    /* Soft engagement (see its declaration): the pipeline is stopped and our DOM is gone —
       everything above — but the page goes back to native Reddit with no card over it.
       `failed` still latches, so nothing of ours re-renders until the next route, and the
       reason lands on <html> plus the console so a report is one attribute read away. */
    if (soft) {
      document.documentElement.setAttribute('data-shd-soft-fail', reason);
      console.warn(`[sheddit] handing this page back to native Reddit: ${reason}`, detail);
      return;
    }

    document.documentElement.classList.add('shd-failed');
    document.documentElement.setAttribute('data-shd-fail', reason);
    showErrorScreen(reason, detail);

    console.warn(`[sheddit] could not render this page: ${reason}`, detail);
  }

  /**
   * Hand the page back to native Reddit completely — the old bail() behaviour, but now
   * only ever user-initiated. Latches: we do not re-suppress on later SPA navigations.
   */
  function release(why = 'user-request') {
    released = true;
    clearTimeout(timer);
    for (const fn of stopListeners) {
      try { fn(why); } catch (e) { console.warn('[sheddit] stop listener threw', e); }
    }
    document.documentElement.classList.remove('shd-gate', 'shd-failed', SHD.C.BODY_CLASS);
    document.documentElement.setAttribute('data-shd-released', why);
    document.getElementById(ERROR_ID)?.remove();
    document.getElementById(SHD.C.ROOT_ID)?.remove();
    document.getElementById('shd-header')?.remove();
  }

  /** Called by render sites on caught exceptions. Fails the page past a budget. */
  function reportError(err) {
    errors++;
    if (!firstError) firstError = err;
    console.warn('[sheddit] render error', errors, err);
    if (errors >= ERROR_BUDGET) {
      fail('render-errors', { errors, first: String(firstError && firstError.message || firstError) });
    }
  }

  /**
   * Routes we do not handle must never be suppressed, and must never show an error.
   *
   * This has to drop .shd-active too, not just the pre-render gate. It used to run only at
   * boot, before anything was revealed, so leaving .shd-active alone was harmless. Live
   * settings changed that: switching "Restyle listings" off mid-session reaches here with
   * .shd-active already applied, and suppress.css hides native Reddit under it — turning a
   * feature off produced a blank page instead of the site.
   */
  function standDown() {
    clearTimeout(timer);
    revealed = false;
    // This page is not ours any more: the deadline must not diagnose it, and neither
    // suppressKnownUpsells() nor stripScrollLock() may touch it.
    engaged = false;
    soft = false;
    document.documentElement.classList.remove('shd-gate', 'shd-failed', SHD.C.BODY_CLASS);
    document.documentElement.removeAttribute('data-shd-fail');
    document.documentElement.removeAttribute('data-shd-soft-fail');
    document.documentElement.removeAttribute('data-shd-waiting');
    document.getElementById(ERROR_ID)?.remove();
  }

  /* ------------------------------------------------------------------ *
   * the failure screen
   * ------------------------------------------------------------------ */

  /* Written with raw DOM calls, not SHD.dom.h — gate.js runs at document_start and dom.js
     does not exist yet. Styles live in suppress.css for the same reason. */
  const EXPLANATIONS = {
    'render-failed': (d) => ({
      what: `Reddit sent ${d.sources} post${d.sources === 1 ? '' : 's'} for this page, but ` +
            `Sheddit could not build the old-reddit layout from ${d.sources === 1 ? 'it' : 'them'}.`,
      // Two very different failures share this reason, and the stamp count is what tells
      // them apart — blaming "Reddit changed its markup" when the renderer never processed
      // a single element sent a real bug report chasing the wrong cause.
      why: d.stamped === 0
        ? 'None of them were ever processed: the render queue did not run at all. That is ' +
          'a scheduling or environment failure inside Sheddit (or a tab whose frames never ' +
          'fire), not a Reddit markup change — a reload usually clears it.'
        : 'This almost always means Reddit changed its markup. The attribute names ' +
          'Sheddit reads all live in src/config/contracts.js — run `npm run verify:live` ' +
          'to see which ones moved.' +
          (d.rejected ? ` The renderer recorded why each item was rejected: ${d.rejected}.` : '')
    }),
    'no-content': (d) => ({
      what: `Sheddit waited ${Math.round((d.waited || 0) / 1000)} seconds and Reddit sent no ` +
            `posts or comments it could read.`,
      why: 'This is usually a very slow connection or a Reddit outage. It can also happen ' +
           'on an empty or private subreddit, where there is genuinely nothing to show.'
    }),
    'pipeline-stalled': (d) => ({
      what: `Reddit sent ${d.sources} post${d.sources === 1 ? '' : 's'}, but Sheddit's ` +
            `renderer never started, so nothing was even attempted.`,
      why: 'This is a Sheddit startup failure rather than a Reddit markup change — the ' +
           'content script that builds the layout did not run. A reload usually clears it; ' +
           'if it does not, disabling and re-enabling the extension will.'
    }),
    'render-errors': (d) => ({
      what: `Rendering threw ${d.errors} times, so Sheddit stopped before it made a mess ` +
            `of the page.`,
      why: `First error: ${d.first || 'unknown'}`
    })
  };

  function el(tag, props, children) {
    const node = document.createElement(tag);
    const { role, ...rest } = props || {};
    Object.assign(node, rest);
    // Set as an attribute, not a property: Element.role reflection is current-Chrome
    // behaviour, and if it ever stops reflecting the property becomes a silent expando —
    // the error screen would lose its live-region semantics with no visible symptom.
    if (role) node.setAttribute('role', role);
    for (const c of [].concat(children || [])) {
      // null/undefined/false/'' are "no child" (conditional children); everything else —
      // including a numeric 0, which the old `if (c)` silently dropped — is content.
      if (c == null || c === false || c === '') continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function showErrorScreen(reason, detail) {
    if (!document.body) return;                       // nothing to attach to yet
    document.getElementById(ERROR_ID)?.remove();

    const explain = (EXPLANATIONS[reason] || (() => ({
      what: 'Sheddit could not render this page.', why: `Reason: ${reason}`
    })))(detail);

    let version = 'unknown';
    try { version = chrome.runtime.getManifest().version; } catch { /* dev harness */ }

    const diagnostics = [
      `reason:     ${reason}`,
      `url:        ${location.href}`,
      `route:      ${SHD.route ? SHD.route.current : '(not classified)'}`,
      `sources:    ${sourceCount()} shreddit-post/comment elements on the page`,
      `rendered:   ${renderedCount()} rows`,
      `stamped:    ${stampedCount()} processed by the renderer (0 here means the render queue never ran)`,
      `rejected:   ${(SHD.model && SHD.model.rejectSummary()) || 'none recorded'}`,
      `errors:     ${errors}${firstError ? ' — ' + (firstError.message || firstError) : ''}`,
      `version:    ${version}`,
      `user agent: ${navigator.userAgent}`
    ].join('\n');

    const actions = el('div', { className: 'shd-error-actions' }, [
      el('button', {
        type: 'button', className: 'shd-error-primary', textContent: "Show Reddit's own layout",
        onclick: () => release('user-request')
      }),
      el('button', {
        type: 'button', textContent: 'Reload the page',
        onclick: () => location.reload()
      })
    ]);

    const details = el('details', null, [
      el('summary', { textContent: 'Details for a bug report' }),
      el('pre', { textContent: diagnostics })
    ]);

    document.body.appendChild(
      el('div', { id: ERROR_ID, role: 'alert' }, [
        el('div', { className: 'shd-error-box' }, [
          el('h1', { textContent: "Sheddit couldn't render this page" }),
          el('p', { className: 'shd-error-what', textContent: explain.what }),
          el('p', { className: 'shd-error-why', textContent: explain.why }),
          actions,
          details,
          el('p', { className: 'shd-error-foot', textContent:
            'Native Reddit is still here, just hidden — nothing has been lost.' })
        ])
      ])
    );
  }

  return {
    arm, reveal, fail, release, reportError, standDown, onStop, resetForRoute, unblank,
    syncNativeModal, engage,
    get revealed() { return revealed; },
    get failed() { return failed; },
    get released() { return released; },
    get stopped() { return stopped(); }
  };
})();

SHD.gate.arm();
