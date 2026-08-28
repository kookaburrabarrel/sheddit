/**
 * pipeline.js — the engine. MutationObserver -> rAF-batched work queue.
 *
 * Why not a one-shot transform on load:
 *   - shreddit-feed ships ~3 posts then streams the rest via faceplate-partial
 *   - the comments page had 29 pending partial loaders
 *   - navigation is client-side, so there is no second "load" event
 *
 * Idempotency is enforced by stamping every consumed source element with data-shd="done".
 * The same element may be visited any number of times; it renders exactly once.
 */
globalThis.SHD = globalThis.SHD || {};

(() => {
  const C = SHD.C;
  const R = SHD.route;

  const queue = new Set();
  let scheduled = false;
  let observer = null;
  let mode = null;

  const isDone = (el) => el.getAttribute(C.MARK) === 'done';
  const markDone = (el) => el.setAttribute(C.MARK, 'done');

  /** Which source elements matter for the current route, honouring feature toggles. */
  function selectorsFor(m) {
    if (m === R.LISTING) return SHD.settings.listing ? [C.POST] : [];
    if (m === R.COMMENTS) return SHD.settings.comments ? [C.POST, C.COMMENT] : [];
    // Profiles interleave the user's posts with their comments. ONE comment tag, not two:
    // 0.10.0 queried C.COMMENT alongside the candidate because neither was captured, and
    // live testing settled it — profiles use shreddit-profile-comment, with an attribute set
    // that shares nothing with a thread comment's. Carrying the disproven guess would mean
    // reading a thread comment with profile attribute names, which rejects and hands the
    // whole page back; a list of guesses is not a contract (bug 41's lesson).
    if (m === R.PROFILE) return SHD.settings.profiles ? [C.POST, C.PROFILE_COMMENT] : [];
    return [];
  }

  /** A route we're configured to leave alone behaves exactly like an unhandled route. */
  function enabledFor(m) {
    if (m === R.LISTING) return !!SHD.settings.listing;
    if (m === R.COMMENTS) return !!SHD.settings.comments;
    if (m === R.PROFILE) return !!SHD.settings.profiles;
    return false;
  }

  function collect(root) {
    if (SHD.gate.stopped) return;
    const sels = selectorsFor(mode);
    if (!sels.length) return;
    for (const sel of sels) {
      if (root.matches?.(sel) && !isDone(root)) queue.add(root);
      root.querySelectorAll?.(sel).forEach(el => { if (!isDone(el)) queue.add(el); });
    }
    if (queue.size) schedule();
  }

  /* A STAMPED element being INSERTED is Reddit restoring cached DOM on a history
     traversal. Sort clicks REPLACE post elements (measured live: 0 of 4 reused), but
     back/forward REUSES the very nodes it removed, stamps and all — measured live in
     testing: every back/forward step failed with sources 3, stamped 3, rendered 0, nine
     out of nine, because the sweep skipped every "already rendered" element whose render
     had just been torn down. A stamp is a promise that the element's row exists; if the
     row is gone, the stamp is stale by definition, so clear it and queue the element.

     ONLY on the observer path, and that restriction is load-bearing: onRoute()'s full
     sweep runs PRE-COMMIT, while the DOM still holds the OUTGOING page's stamped posts
     with their render already torn down — exactly the state this test reads as stale — so
     applying it there would re-render the old sort into the new root, which is bug 34's
     mixed-sorts regression through a new door. Outgoing elements are never re-INSERTED,
     they sit in place until Reddit removes them, so the addedNodes path never sees them. */
  const rowFor = (el) => {
    const tag = el.tagName.toLowerCase();
    const idAttr = tag === C.COMMENT ? C.COMMENT_ATTR.id
      : tag === C.PROFILE_COMMENT ? C.PROFILE_COMMENT_ATTR.id
        : C.POST_ATTR.id;
    const id = el.getAttribute(idAttr);
    return id ? document.querySelector(`#${C.ROOT_ID} .thing[data-fullname="${id}"]`) : null;
  };
  const revive = (el) => {
    if (isDone(el) && !rowFor(el)) el.removeAttribute(C.MARK);
  };
  /**
   * A comment-shaped element on a profile that we never even queried for — see the call
   * site for why silence there is the failure this catches.
   *
   * Deliberately conservative, because a false positive here hands back a page that works:
   *   - custom elements only (a tag with a dash); Reddit's own components, not markup.
   *   - never something inside a post or inside a comment we DID read: an action row or a
   *     hovercard named "...comment..." is furniture belonging to an element we handled.
   *   - never a wrapper that CONTAINS comments we read (a tree/section element around a
   *     list we rendered is not a miss).
   */
  function unreadProfileComment() {
    const known = `${C.COMMENT}, ${C.PROFILE_COMMENT}`;
    const scope = document.querySelector(C.FEED) || document.body;
    for (const el of scope.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (!tag.includes('-') || !tag.includes('comment')) continue;
      if (tag === C.COMMENT || tag === C.PROFILE_COMMENT) continue;
      if (el.closest(`${known}, ${C.POST}`)) continue;
      if (el.querySelector(known)) continue;
      return tag;
    }
    return null;
  }

  function collectAdded(root) {
    if (SHD.gate.stopped) return;
    for (const sel of selectorsFor(mode)) {
      if (root.matches?.(sel)) revive(root);
      root.querySelectorAll?.(sel).forEach(revive);
    }
    collect(root);
  }

  /**
   * rAF is the right scheduler when the tab is painting: one layout pass per burst,
   * naturally coalesced with the browser's own frame.
   *
   * It is the wrong one when the tab is hidden, because it does not fire at all — and
   * gate.js's deadline is a setTimeout, which does. A page opened in a background tab
   * (middle-click, ctrl-click, session restore, a window that is not frontmost) therefore
   * reached the 1500ms check with sources on the page and nothing rendered, and the gate
   * correctly concluded from its own point of view that we were broken. Measured live:
   * hidden tab, 3 posts, 0 rows, 0 data-shd stamps, data-shd-fail=render-failed; the same
   * URL in a visible tab rendered 4 of 4. The failure then LATCHED, because fail()
   * disconnects the observer via the stop listeners — so the user's first sight of the tab
   * was the error screen, and switching to it did not recover. See docs/engineering-log.md bug 35.
   *
   * DOM work is not throttled in a hidden tab, only painting is, so flushing on a timeout
   * builds exactly the same layout — it just gets composited when the user looks at it.
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (document.visibilityState === 'hidden') setTimeout(flush, 0);
    else requestAnimationFrame(flush);
  }

  /**
   * One layout pass per burst. Document order matters for the comment depth-stack, so
   * we sort by DOM position before consuming.
   */
  function flush() {
    scheduled = false;
    if (SHD.gate.stopped) { queue.clear(); return; }
    if (!queue.size) return;

    const items = [...queue].sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    queue.clear();

    let rendered = 0;
    for (const el of items) {
      if (isDone(el) || !el.isConnected) continue;
      try {
        const tag = el.tagName.toLowerCase();
        let ok = false;
        if (mode === R.LISTING && tag === C.POST) {
          ok = SHD.listing.consume(el);
        } else if (mode === R.COMMENTS) {
          ok = tag === C.COMMENT ? SHD.comments.consume(el) : SHD.comments.consumePost(el);
        } else if (mode === R.PROFILE) {
          ok = tag === C.POST
            ? SHD.listing.consume(el)
            : SHD.listing.consumeProfileComment(el);
        }
        markDone(el);                 // stamp regardless: a skipped item must not be retried
        if (ok) rendered++;
      } catch (err) {
        markDone(el);
        SHD.gate.reportError(err);
      }
    }

    /* On a PROFILE, the verdict is "could we read ANY of them", not "did every one
       parse".
       0.10.0 handed back on the FIRST reject, and that was right while the contract was a
       guess: one unreadable element was evidence the guess was wrong, and rendering the
       readable remainder would show a profile with most of its content silently missing.
       Live testing verified the contract live — 24/24 and 33/33 rendered on two profiles — so
       a lone reject is now far more likely to be an outlier than a broken contract, and
       the strict rule has a cost the loose one does not: a history traversal re-consumes
       restored elements mid-hydration (live testing watched a timestamp vanish that way), and
       one element that is not ready yet would hand back a profile that was rendering
       perfectly a second earlier.
       So the test is total failure: Reddit sent comments and we rendered NONE of them.
       That still catches every way the contract can be wrong — foreign attributes, a body
       selector that misses — because those reject ALL of them, which is what the fixtures
       assert. Deliberately NOT gated on `revealed`: a profile whose posts arrive first and
       whose comments all reject in a later flush must still hand back, or it is the
       silent-omission failure by a slower route. fail() is soft-engaged here (gate.js), so
       this is always a quiet handback, never the error card. */
    if (mode === R.PROFILE) {
      const sent = document.querySelectorAll(C.PROFILE_COMMENT).length;
      const drawn = document.querySelectorAll(`#${C.ROOT_ID} .shd-profile-comment`).length;
      if (sent > 0 && drawn === 0) {
        SHD.gate.fail('profile-unreadable',
          { sent, rejected: SHD.model.rejectSummary() });
        return;
      }
    }

    /* ...and the OTHER half of the same verdict, which the reject check alone does not
       cover. A reject means an element we QUERIED FOR had attributes we could not read.
       If the profile comment tag is simply not one of the two we query, nothing matches,
       nothing rejects, the user's POSTS render happily and their comments are silently
       absent — a profile that looks fine and is missing most of its content, which is
       precisely the outcome the reject check exists to prevent, reached by the door the
       reject check does not watch. So: a comment-shaped custom element in the feed that
       we neither read nor contain means we do not understand this page. Hand it back.

       Only before the first reveal — the first flush decides the verdict, and the shape
       does not change between pages — because this walks the feed subtree and later
       pages can be large. The tag reported may be a WRAPPER rather than the comment
       itself; it is a breadcrumb for the bug report, not the contract. The residual, and
       it is real: a profile comment element whose tag does not contain "comment" is
       invisible to this and still renders posts-only. verify:live's USER PROFILES
       section is what actually settles the tag. */
    if (mode === R.PROFILE && !SHD.gate.revealed) {
      const unknown = unreadProfileComment();
      if (unknown) {
        SHD.gate.fail('profile-unknown-comment', { tag: unknown });
        return;
      }
    }

    // NOT gated on !gate.revealed. reveal() latches true for the lifetime of the page and
    // is never reset, but onRoute() tears the header and sidebar down on every SPA
    // navigation — so gating here meant they were removed once and never rebuilt. Both
    // builders are no-ops when their element is already present, so this is cheap.
    if (rendered > 0) {
      if (SHD.settings.chrome) { SHD.chrome.header(); SHD.chrome.sidebar(); }
      SHD.gate.reveal();
    }

    // Our own sentinel drives pagination; Reddit's viewport math can't, because we've
    // hidden the native feed. Re-attached after each flush so it stays at the bottom.
    //
    // Comment pages get one too. They were excluded, and comment threads lazy-load the
    // same way feeds do — so a thread showed whatever arrived in the initial HTML and the
    // rest was simply unreachable. For a reading-focused extension that is the main
    // content, not an edge case.
    if (rendered > 0) {
      const anchor = mode === R.COMMENTS
        ? document.querySelector(`#${C.ROOT_ID} .commentarea .nestedlisting`)
        : document.querySelector('#siteTable');    // LISTING and PROFILE both build it
      if (anchor) {
        SHD.paginator.useMode(mode);
        SHD.paginator.attach(anchor);
      }
    }
  }

  function observe() {
    observer?.disconnect();
    observer = new MutationObserver(records => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType === Node.ELEMENT_NODE) collectAdded(n);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Route change: tear down our render, reset module state, sweep again. */
  function onRoute(next, path) {
    /* A COMMENTS -> COMMENTS emit on an unchanged pathname is a SORT SWAP: the emit came
       from the sort key (route.js bug 87), Reddit moves only `?sort=` and replaces the
       tree — but it may keep the thread's own post element exactly where it is. A stamp
       is only ever cleared on re-INSERTION, so an element that never moves keeps it, and
       its row just went down with the teardown below: the re-sorted page would render
       comments with no post and no sort strip. Detected here, acted on below. */
    const sortSwap = mode === R.COMMENTS && next === R.COMMENTS && onRoute.lastPath === path;
    onRoute.lastPath = path;
    mode = next;
    // A new page is a fresh attempt: clear the previous one's failure screen and re-arm
    // the deadline. No-ops if the user has released the page to native Reddit.
    SHD.gate.resetForRoute();
    document.querySelector('#' + C.ROOT_ID)?.remove();
    SHD.listing.reset();
    SHD.comments.reset();
    /* Media resolutions are memoised per asset and the URLs behind them expire (~12h with
       a signature), so they must not outlive the layout that asked for them. */
    SHD.media.reset();
    SHD.chrome.reset();
    SHD.paginator.reset();
    queue.clear();

    if (mode === R.OTHER || !enabledFor(mode)) {
      // Hands off entirely — native Reddit must remain usable on unhandled routes.
      SHD.gate.standDown();
      observer?.disconnect();
      return;
    }
    if (SHD.gate.stopped) { observer?.disconnect(); return; }   // user chose native Reddit

    // Tell the gate we have taken this route. Until this call its deadline must not
    // conclude anything from "sources present, nothing rendered", because until this call
    // nothing of ours has looked at the page — and on a route we hand back above, this
    // call never happens at all. PROFILE engages SOFT: its Reddit contract is unverified,
    // so any failure hands back native Reddit quietly instead of raising the error card.
    SHD.gate.engage(mode === R.PROFILE);
    // Re-run the modal sync now that we have: resetForRoute() ran it a moment ago while
    // `engaged` was still false, so suppressKnownUpsells() deliberately declined to touch
    // the DOM. If an upsell is already up on this route, this is what removes it — waiting
    // for the next stray mutation would leave the wall standing for an unbounded time.
    SHD.gate.syncNativeModal();

    // DELIBERATELY NOT un-stamping data-shd="done" here, unlike watchSettings() below —
    // and the difference is load-bearing, not an oversight. onRoute now runs PRE-COMMIT
    // (route.js emits from the navigate event, before Reddit swaps its feed), so at this
    // moment the DOM still holds the OUTGOING page's posts. Un-stamping them would make
    // collect() below re-queue them and the next flush re-render the old sort into the new
    // root, racing Reddit's swap — the mixed-sorts bug reintroduced by the fix for it.
    // The stamps on outgoing elements are exactly what makes this sweep skip them, and
    // Reddit was measured (live, sort change) to fully replace its post elements — 0 of 4
    // stayed connected, 0 identities reused — so the incoming posts always arrive
    // stamp-free. watchSettings() is different: no navigation is in flight there, so the
    // stamped elements ARE the current page and re-rendering them is the point.
    //
    // The sort swap (see the top of this function) is the ONE exception, POSTS ONLY: on a
    // same-thread `?sort=` change the outgoing post IS the incoming post — same element,
    // same attributes — so re-rendering it pre-commit cannot mix pages, and if Reddit
    // swaps it anyway the fresh copy arrives with its row already standing and is skipped
    // by revive(). The COMMENTS stay stamped even here: at this pre-commit moment they
    // are the OUTGOING sort's tree, and un-stamping them re-renders the old sort under
    // the new URL — bug 34 by another door. The incoming tree arrives by insertion.
    if (sortSwap) {
      document.querySelectorAll(`${C.POST}[${C.MARK}]`)
        .forEach(p => p.removeAttribute(C.MARK));
    }
    observe();
    collect(document.body);
    // Nothing on the page yet is normal (streamed content); the observer will catch up.
    schedule();
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.sync.get('settings');
      if (stored?.settings) Object.assign(SHD.settings, stored.settings);
    } catch { /* storage unavailable — defaults are fine */ }
  }

  /**
   * Apply option changes immediately.
   *
   * Settings used to be read once at boot, so toggling anything in the options page did
   * nothing until the user happened to reload — which reads as a broken options page.
   * Re-running onRoute() is the whole update path: it tears our render down, re-reads the
   * toggles, and either rebuilds or stands down. Cheap, and it cannot drift from the
   * normal navigation path because it IS the normal navigation path.
   */
  function watchSettings() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.settings) return;
        const next = changes.settings.newValue || {};
        // Compare only the keys the update actually carries. Diffing against every known
        // setting treats an absent key as a change to undefined, so a partial write would
        // report spurious changes and tear the page down for nothing.
        const changed = Object.keys(next).filter(k => SHD.settings[k] !== next[k]);
        if (!changed.length) return;
        Object.assign(SHD.settings, next);
        SHD.theme.apply(SHD.settings.theme);
        // A theme is paint, not structure: the palette is custom properties on <html>, so
        // the whole page has already repainted by the line above. Tearing the render down
        // for it would throw away scroll position and every page the paginator has loaded —
        // on a forty-page feed, switching to the dark theme would send the user back to the
        // top. Anything else in the change still goes through the full path below.
        if (changed.length === 1 && changed[0] === 'theme') return;
        // Un-stamp so previously-consumed sources are eligible again; a toggle is a
        // deliberate request to re-render, not an incremental update. Every source Reddit
        // delivered is still in the page, including everything the paginator pulled, so
        // they all come back.
        //
        // No scroll restoration here, and that is measured rather than assumed: the
        // browser's own scroll anchoring already holds the reader's place across the
        // teardown, so an explicit save/restore was code no test could fail. geometry
        // asserts the PROPERTY (a settings change does not dump you at the top) rather
        // than any mechanism for it, which is what would catch a future change that
        // defeats anchoring.
        document.querySelectorAll(`[${C.MARK}]`).forEach(el => el.removeAttribute(C.MARK));
        onRoute(R.classify());
      });
    } catch { /* no chrome.storage (dev harness) — nothing to watch */ }
  }

  /* Stopping — whether we failed or the user asked for native Reddit — means our layout is
     gone. Stop producing markup for it. */
  SHD.gate.onStop(() => {
    observer?.disconnect();
    observer = null;
    queue.clear();
    SHD.paginator.reset();
    SHD.dom.passthroughClear();
  });

  /* If visibility flips while a flush is pending, the scheduler chosen at schedule() time
     may be the one that never fires (a rAF booked just before the tab was hidden waits
     until the tab is shown again, while the gate's deadline keeps ticking). Re-book on the
     transition; flush() is idempotent, so the worst case is one empty extra pass. */
  addEventListener('visibilitychange', () => {
    if (queue.size) { scheduled = false; schedule(); }
  });

  /* The deadline's escape hatch. Two reports (rounds 4 and 6) hit "sources present,
     stamped: 0" cards whose common thread was a starved rendering pipeline — live testing's
     coincided with a main thread the automation had frozen for 45+ seconds. The gate's
     deadline is a setTimeout and runs on recovery; the flush it is about to blame is
     parked on a rAF that may not have fired yet. A deadline must not accuse a queue it
     has not tried to drain, so gate.js calls this first: flush() is idempotent and
     synchronous, and if there is queued work this renders it instead of failing. */
  /**
   * Write one setting, from our own UI.
   *
   * The options page owns the same keys through chrome.storage directly; this is the
   * in-page equivalent for the header controls, and it deliberately routes through
   * storage rather than mutating SHD.settings — the storage listener above is what
   * re-renders, so a direct mutation would change behaviour for elements rendered later
   * while leaving everything already on screen stale.
   */
  async function setSetting(key, value) {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({
        settings: { ...C.settings, ...SHD.settings, ...(settings || {}), [key]: value }
      });
    } catch (err) {
      /* One path only, deliberately: the write is what re-renders, via the listener
         above. A fallback that applied the change in memory instead would be a second
         implementation of the same behaviour, reachable only when storage is broken and
         therefore never exercised. Say so instead — a control that silently does nothing
         is worse than one that fails loudly (bug 62). */
      console.warn(`[sheddit] could not save ${key}`, err);
    }
  }

  SHD.pipeline = { kick() { if (queue.size) flush(); }, setSetting };

  (async function boot() {
    await loadSettings();
    // themes.js already applied whatever storage held, at document_start, to keep the
    // pre-render blackout from flashing white. This is the authoritative pass: it runs
    // against the settings object the rest of the pipeline reads, and it repairs the case
    // where that early read lost a race or storage was unavailable to it.
    SHD.theme.apply(SHD.settings.theme);
    watchSettings();
    R.onChange(onRoute);
    R.start();
  })();
})();
