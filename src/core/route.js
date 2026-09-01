/**
 * route.js — classifies the current URL and fires change events.
 *
 * Reddit is a client-side-routed app and the `navigation` API is available on the page
 * in Chrome (verified). We prefer it, and fall back to the bridge's history relay where
 * it does not exist — Firefox's ESR line has no navigation API (it landed in Firefox 147,
 * later than the 140 ESR; measured absent in ESR 128, present in release 154), so the relay
 * is the only route signal there.
 *
 * THE TRAP IN THE NAVIGATION API — read before touching start().
 *
 * The `navigate` event is PRE-COMMIT: while it dispatches, `location.*` still holds the
 * OLD URL — that is why the event carries `event.destination.url` at all. And queueing a
 * microtask does not escape that window: microtasks drain when the stack empties, which is
 * still before the URL update for an intercepted navigation. Traced live on a real sort-tab
 * click: listener saw loc=/r/programming/, the microtask STILL saw /r/programming/, and only
 * the next task saw /r/programming/new/.
 *
 * The first version queued a microtask and read `location.pathname` inside it — so it
 * classified the page we were LEAVING. Worse, it wrote its change-detection latch
 * unconditionally, so the stale read was recorded as "seen" and the real navigation never
 * produced a second emit. Every sort change was either swallowed (URL updates, content
 * stays) or handled one navigation late (content updates, URL doesn't) — a permanent
 * one-navigation phase error, alternating between the two reported symptoms. See
 * docs/engineering-log.md bug 34.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.route = (() => {
  const LISTING = 'LISTING';
  const COMMENTS = 'COMMENTS';
  const PROFILE = 'PROFILE';
  const OTHER = 'OTHER';

  const listeners = new Set();
  let current = null;

  /**
   * The one sort list. chrome.js renders tabs from this, and classify() accepts exactly
   * these — otherwise we ship tabs that route to OTHER and clicking our own UI drops the
   * user out of the extension. That happened: `controversial` was accepted under /r/x/
   * but not at the root, while the tab menu offered it on the front page.
   */
  const SORTS = ['hot', 'new', 'rising', 'controversial', 'top'];
  /* Reddit's own default front-page sort. Not a tab we render, but a URL we must accept. */
  const EXTRA_SORTS = ['best'];
  const SORT_RE = [...SORTS, ...EXTRA_SORTS].join('|');

  /**
   * The time range, which is HALF of what `top` and `controversial` mean.
   *
   * Reported 2026-09-01: a reader opened /r/DIYfail/top/, saw an empty page, and concluded
   * the extension had broken — the sub is twelve years old and full of posts. It had not.
   * Reddit applies a time range to those two sorts whether or not the URL says so, and the
   * range it picks when the URL is silent is `day`. Measured on that sub the same day:
   * today 0 posts, this week 1, this month 1, this year 10+, all time 10+. The feed was
   * right; nothing on screen said WHICH twenty-four hours it was the top of.
   *
   * So the default is written down rather than left implicit. `/r/x/top/` and
   * `/r/x/top/?t=day` are the same page, and every part of this extension that names the
   * range — the "links from:" row, the empty-state line — says `past 24 hours` on both
   * instead of saying nothing on one of them. It also makes a captured page replayable:
   * a saved `top` URL with no `t=` means something different depending on when it is
   * opened, and normalising it here is what pins it.
   *
   * `phrase` is the sentence form. Old reddit's dropdown reads "links from: past 24
   * hours"; a sentence needs "from the past 24 hours", and neither is derivable from the
   * other without a rule per row, so both are written out.
   */
  const TIMES = [
    { id: 'hour',  label: 'past hour',     phrase: 'the past hour' },
    { id: 'day',   label: 'past 24 hours', phrase: 'the past 24 hours' },
    { id: 'week',  label: 'past week',     phrase: 'the past week' },
    { id: 'month', label: 'past month',    phrase: 'the past month' },
    { id: 'year',  label: 'past year',     phrase: 'the past year' },
    { id: 'all',   label: 'all time',      phrase: 'all time' }
  ];
  /* The two sorts a range applies to — old reddit offered the dropdown on exactly these,
     and Reddit still does. `hot`, `new` and `rising` carry no range at all, so a `t=` on
     one of them is inert and must not be treated as part of the route (see timeOf). The
     default above was measured on `top`; `controversial` is the same query with the
     comparison reversed and is assumed to share it. */
  const TIMED_SORTS = ['top', 'controversial'];
  const DEFAULT_TIME = 'day';

  /* The one profile tab list, owned here for the same reason SORTS is: chrome.js renders
     tabs from it, and every href those tabs carry must classify back to PROFILE — a tab
     that routes to OTHER drops the reader out of the extension (bug 10). `path` is the
     segment appended to /user/<name>/. */
  const PROFILE_TABS = [
    { id: 'overview', path: '', label: 'overview' },
    { id: 'comments', path: 'comments/', label: 'comments' },
    { id: 'submitted', path: 'submitted/', label: 'submitted' }
  ];

  function classify(path = emitPath()) {
    if (/^\/r\/[^/]+\/comments\//.test(path)) return COMMENTS;
    if (path === '/' || path === '') return LISTING;
    if (/^\/r\/[^/]+\/?$/.test(path)) return LISTING;
    if (new RegExp(`^/r/[^/]+/(${SORT_RE})/?$`).test(path)) return LISTING;
    if (new RegExp(`^/(${SORT_RE})/?$`).test(path)) return LISTING;
    /* User profiles: the overview and its comments/submitted tabs, and nothing deeper.
       `/user/x/comments/` (exact) is the profile's comments TAB; `/user/x/comments/<id>/…`
       is a thread on a PROFILE POST — a page shape nobody has captured — and the `$`
       anchors below are what keep it OTHER (untouched) rather than half-claimed. In scope
       by project decision 2026-08-21; see C.PROFILE_COMMENT for what remains unverified. */
    if (/^\/user\/[^/]+\/?$/.test(path)) return PROFILE;
    if (/^\/user\/[^/]+\/(overview|comments|submitted)\/?$/.test(path)) return PROFILE;
    return OTHER;                       // search, chat, modmail, profile threads → hands off
  }

  function usernameOf(path = emitPath()) {
    const m = path.match(/^\/user\/([^/]+)/);
    return m ? m[1] : null;
  }

  function profileTabOf(path = emitPath()) {
    const m = path.match(/^\/user\/[^/]+\/(comments|submitted)\/?$/);
    return m ? m[1] : 'overview';
  }

  /**
   * The path this module last emitted for — the page we consider ourselves to be on.
   * During the pre-commit window this is AHEAD of location.pathname, which is the point:
   * anything downstream that asks "which sort are we showing" (chrome.js's active tab,
   * the sidebar's subreddit name) must agree with the render it is decorating, not with a
   * URL that may be one navigation behind or ahead. subredditOf/sortOf below default to
   * this for exactly that reason.
   */
  const emitPath = () => emit.lastPath || location.pathname;

  function subredditOf(path = emitPath()) {
    const m = path.match(/^\/r\/([^/]+)/);
    return m ? m[1] : null;
  }

  function sortOf(path = emitPath()) {
    const m = path.match(new RegExp(`/(${SORT_RE})/?$`));
    return m ? m[1] : 'hot';
  }

  /**
   * The query half of a route's identity — the `sort` parameter, and nothing else.
   *
   * Sorting a COMMENTS page is a QUERY-ONLY navigation: the sort strip's links carry
   * `?sort=new` on the post's own permalink, Reddit's router intercepts them, and the
   * pathname never moves. A latch keyed on pathname alone concluded nothing had happened —
   * so nothing tore down, the sort strip kept the old sort bold, and the pipeline consumed
   * Reddit's replacement tree UNDER the stale render: two sorts interleaved on one page,
   * with a hard reload of the same URL rendering fine (docs/engineering-log.md bug 87 —
   * bug 34's mixed-sorts family, through the door a path key cannot see).
   *
   * ONLY `sort` takes part, deliberately: keying on the whole query string would tear the
   * page down — scroll position, loaded pages and all — for any tracking or view parameter
   * Reddit rewrites in place, which it does. A sort parameter on a LISTING is accepted
   * too (harmless: listings sort by path segment, so it simply never differs there).
   */
  const sortParamOf = (search) => {
    const m = /[?&]sort=([^&#]*)/.exec(search || '');
    return m ? m[1] : '';
  };

  const timeParamOf = (search) => {
    const m = /[?&]t=([^&#]*)/.exec(search || '');
    return m ? m[1] : '';
  };

  /**
   * The time range in force on this listing — NORMALISED, so "absent" comes back as
   * `day` rather than as nothing at all. Null when the sort takes no range.
   *
   * The normalisation is the point (see TIMES): Reddit filters `top` and `controversial`
   * by day whether or not the URL says so, so a caller that reported "no range" for
   * `/r/x/top/` would be repeating the URL rather than describing the page — which is
   * exactly the gap the reader fell into. An unrecognised value falls back the same way:
   * `?t=fortnight` is not a range Reddit serves, and claiming it on screen would put a
   * word under the reader's eyes that no part of the feed corresponds to.
   *
   * It is also half of the route KEY (see emit): `/r/x/top/?t=week` is a different page
   * from `/r/x/top/` with the same pathname, so without it a range change is a
   * query-only navigation that this module concludes never happened — bug 87's shape,
   * where Reddit swaps its feed under a render we never tore down. Non-timed sorts
   * return null, so a stale `t=` riding along on `/r/x/new/` cannot tear the page down
   * for nothing.
   *
   * `search` defaults to the SENTINEL null, meaning "the query we last emitted for",
   * under the emitPath() rule: anything decorating the render must agree with the
   * navigation that produced it, not with a location one commit behind or ahead. An
   * empty string is a real answer (a URL with no query) and is not the sentinel.
   */
  function timeOf(path = emitPath(), search = null) {
    if (classify(path) !== LISTING) return null;
    if (!TIMED_SORTS.includes(sortOf(path))) return null;
    const raw = search === null ? (emit.lastTime || '') : timeParamOf(search);
    return TIMES.some(t => t.id === raw) ? raw : DEFAULT_TIME;
  }

  /** The row for a range id — `null` for a range we do not offer. */
  const timeSpec = (id) => TIMES.find(t => t.id === id) || null;
  /** "the past 24 hours", for a sentence. */
  const timePhrase = (id = timeOf()) => timeSpec(id)?.phrase || '';

  /**
   * Fire listeners when the route changes.
   *
   * `path` is a parameter and not a read of location.pathname because the caller is not
   * always allowed to read it — see the header comment. The latch is written ONLY when we
   * emit: it used to be written on every call, including calls that concluded nothing had
   * changed, so a single pre-commit read recorded the old path as "seen", the real
   * navigation produced no second emit, and every later route change was compared against
   * a path one navigation stale. The change was not delayed; it was lost.
   *
   * `search` rides along for the sort key above, under the same pre-commit rule: the
   * navigate handler passes the DESTINATION's search, never a read of location.
   */
  function emit(path = location.pathname, search = location.search) {
    const next = classify(path);
    const sort = sortParamOf(search);
    /* NORMALISED, not raw: `/r/x/top/` and `/r/x/top/?t=day` are one page and must not
       tear each other down, while `t=` on a sort that has no range is inert. timeOf()
       owns both rules; keying on the raw parameter would get both wrong. */
    const time = timeOf(path, search);
    if (next === current && emit.lastPath === path && emit.lastSort === sort
        && emit.lastTime === time) return;
    current = next;
    emit.lastPath = path;
    emit.lastSort = sort;
    emit.lastTime = time;
    listeners.forEach(fn => { try { fn(current, path); } catch (e) { SHD.gate.reportError(e); } });
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function start() {
    /* The bridge's history relay — the only route-change signal a browser without the
     * `navigation` API gets (Firefox ESR 140, the Firefox build floor, has none — the
     * API landed in 147; current Firefox release does). Patching history OURSELVES
     * here was the old fallback, and it is the classic realm mistake: a content
     * script's `history` binding is its own world's, Reddit's router calls the page
     * realm's, and under Firefox's realm separation the patch never fires — every SPA
     * navigation went unseen and only popstate worked. bridge.js patches the realm
     * Reddit actually calls and relays each commit as a bare event; by dispatch time
     * location already holds the NEW url, and the dispatch is synchronous inside
     * Reddit's own pushState call, so teardown still precedes the feed swap. Do not
     * reintroduce a same-realm patch: it masks a dead relay in every one-world test
     * environment while shipping broken. See docs/engineering-log.md bug 82.
     *
     * Registered even when the navigation API exists — emit() is idempotent per path,
     * so on Chrome this is one more post-commit safety net, same role as
     * navigatesuccess below. */
    addEventListener(SHD.C.BRIDGE.navigated, () => emit(location.pathname));
    addEventListener('popstate', () => emit(location.pathname));
    if (typeof navigation !== 'undefined' && navigation.addEventListener) {
      navigation.addEventListener('navigate', (e) => {
        // Deliberately NOT filtered on e.destination.sameDocument. Measured on live
        // Reddit: a sort-tab click reports sameDocument === false and then survives as a
        // same-document navigation anyway, because Reddit's router calls intercept() —
        // the flag describes the destination BEFORE interception, not what happens. A
        // guard here would skip exactly the navigations this listener exists for.
        //
        // Emitting on a genuine cross-document navigation is harmless: the document is
        // about to be replaced and the fresh boot re-emits from scratch.
        let path = null;
        let search = '';
        try {
          const u = new URL(e.destination.url);
          if (u.origin === location.origin) { path = u.pathname; search = u.search; }
        } catch { /* unparseable destination — navigatesuccess below still covers us */ }
        // Emit BEFORE the commit, so our teardown runs before Reddit swaps its feed in.
        // Emitting only after the swap lets the incoming posts be consumed and stamped
        // against the outgoing page — and a stamped post is never rendered again, which is
        // where "6 posts, no more pages" came from.
        if (path) emit(path, search);
      });
      // Post-commit safety net: redirects, destinations we could not parse, and anything
      // that reached the URL without a navigate event we understood. emit() is idempotent
      // per path, so this is free when the pre-commit emit already did the work.
      navigation.addEventListener('navigatesuccess', () => emit(location.pathname));
    }
    emit(location.pathname);
  }

  return { LISTING, COMMENTS, PROFILE, OTHER, SORTS, PROFILE_TABS, TIMES, TIMED_SORTS,
           classify, subredditOf, sortOf, usernameOf, profileTabOf, onChange, start,
           timeOf, timePhrase,
           get current() { return current; },
           get path() { return emitPath(); },
           /* The `?sort=` value this module last emitted for — the emitPath() rule
              applied to the query: anything decorating the render (the comments page's
              sort strip) must agree with the navigation that produced it, not with a
              location that is one commit behind or ahead. Empty string when the emitted
              URL carried none. */
           get sortQuery() { return emit.lastSort || ''; } };
})();
