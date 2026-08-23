/**
 * route.js — classifies the current URL and fires change events.
 *
 * Reddit is a client-side-routed app and the `navigation` API is available on the page
 * (verified). We prefer it, and fall back to patching history for older Chrome.
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
   * Fire listeners when the route changes.
   *
   * `path` is a parameter and not a read of location.pathname because the caller is not
   * always allowed to read it — see the header comment. The latch is written ONLY when we
   * emit: it used to be written on every call, including calls that concluded nothing had
   * changed, so a single pre-commit read recorded the old path as "seen", the real
   * navigation produced no second emit, and every later route change was compared against
   * a path one navigation stale. The change was not delayed; it was lost.
   */
  function emit(path = location.pathname) {
    const next = classify(path);
    if (next === current && emit.lastPath === path) return;
    current = next;
    emit.lastPath = path;
    listeners.forEach(fn => { try { fn(current, path); } catch (e) { SHD.gate.reportError(e); } });
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function start() {
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
        try {
          const u = new URL(e.destination.url);
          if (u.origin === location.origin) path = u.pathname;
        } catch { /* unparseable destination — navigatesuccess below still covers us */ }
        // Emit BEFORE the commit, so our teardown runs before Reddit swaps its feed in.
        // Emitting only after the swap lets the incoming posts be consumed and stamped
        // against the outgoing page — and a stamped post is never rendered again, which is
        // where "6 posts, no more pages" came from.
        if (path) emit(path);
      });
      // Post-commit safety net: redirects, destinations we could not parse, and anything
      // that reached the URL without a navigate event we understood. emit() is idempotent
      // per path, so this is free when the pre-commit emit already did the work.
      navigation.addEventListener('navigatesuccess', () => emit(location.pathname));
      addEventListener('popstate', () => emit(location.pathname));
    } else {
      // This branch was always correct: orig.apply() updates the URL synchronously, so
      // location.pathname is right by the time we read it. The microtask hop it used to
      // have is gone — it was only ever load-bearing as a (failed) commit-wait in the
      // branch above, and here there is nothing to wait for.
      for (const m of ['pushState', 'replaceState']) {
        const orig = history[m];
        history[m] = function (...args) {
          const r = orig.apply(this, args);
          emit(location.pathname);
          return r;
        };
      }
      addEventListener('popstate', () => emit(location.pathname));
    }
    emit(location.pathname);
  }

  return { LISTING, COMMENTS, PROFILE, OTHER, SORTS, PROFILE_TABS,
           classify, subredditOf, sortOf, usernameOf, profileTabOf, onChange, start,
           get current() { return current; },
           get path() { return emitPath(); } };
})();
