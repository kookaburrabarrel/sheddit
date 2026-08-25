/**
 * bridge.js — the ONLY code we run in the page's own JavaScript world.
 *
 * THE PROBLEM IT EXISTS FOR
 * Content scripts run in an isolated world. They share the DOM with the page but not the
 * JavaScript realm — so a custom element the page defined is, from our side, an ordinary
 * unknown element. Its prototype methods are simply not there.
 *
 * `faceplate-partial` is one of those. Reddit's pagination lives on `loadContent()`, and
 * `typeof fp.loadContent` is "function" in the page and "undefined" to us. paginator.js
 * checked for the function, found nothing, and returned false — silently, every time. The
 * feed dead-ended at 3 posts in the shipped extension while working perfectly in the dev
 * harness, because pasting the bundle into DevTools runs it in the MAIN world. That is
 * exactly why ARCHITECTURE §7a's "3 -> 28 posts" verification did not catch it.
 *
 * WHAT CROSSES THE BOUNDARY AND WHAT DOES NOT
 *   DOM nodes, attributes, open shadow roots  — shared. Fine from a content script.
 *   Events (including .click())               — cross both ways. Fine.
 *   Page-defined JS: methods, properties      — NOT shared. Needs this bridge.
 *
 * So the rule is: if you are calling a method Reddit's own JavaScript defined, it goes
 * through here. Everything else should not.
 *
 * WHY IT TAKES THE SELECTOR AS DATA
 * This file cannot import contracts.js — different world, no shared globals. Rather than
 * duplicate Reddit's selectors here and let them rot, the isolated side writes what to
 * call onto <html> as data attributes and we read them back off the shared DOM.
 * contracts.js stays the single point of breakage.
 *
 * Communication is deliberately primitive-only: a bare event plus data attributes. Passing
 * objects through CustomEvent.detail across worlds is not reliably structured-cloned, and
 * the shared DOM always is.
 */
(() => {
  /* Must match SHD.C.BRIDGE in src/config/contracts.js — asserted by test/run.js. */
  const REQUEST = 'shd:load-more';
  const SEL_KEY = 'shdPartialSel';
  const METHOD_KEY = 'shdPartialMethod';
  const RESULT_KEY = 'shdLoadMore';
  const NAVIGATED = 'shd:navigated';

  addEventListener(REQUEST, () => {
    const root = document.documentElement;
    let result = 'no-partial';
    try {
      const sel = root.dataset[SEL_KEY];
      const method = root.dataset[METHOD_KEY];
      const fp = sel ? document.querySelector(sel) : null;
      if (!fp) result = 'no-partial';
      else if (typeof fp[method] !== 'function') result = 'no-method';
      else { fp[method](); result = 'ok'; }
    } catch (err) {
      result = 'threw';
      console.warn('[sheddit] bridge could not load the next page', err);
    }
    // Dispatch is synchronous, so the caller reads this the moment dispatchEvent returns.
    root.dataset[RESULT_KEY] = result;
  });

  /* SPA navigation relay — the second thing that only works from this world.
   *
   * Reddit's router calls THIS realm's history.pushState. A content script that patches
   * its own `history` wraps a copy the page never calls — each world holds its own
   * binding, and under Firefox's realm separation the two are strictly distinct — so a
   * history patch is only worth installing here. Browsers without the `navigation` API
   * (Firefox) have no other way to see a client-side route change; route.js listens for
   * this event and re-reads location, which orig.apply() has already updated by the time
   * the event dispatches. The dispatch is synchronous, inside Reddit's own pushState
   * call, so the isolated side's teardown still runs before the router swaps the feed.
   *
   * Registered after the load-more listener on purpose: if patching history ever throws,
   * pagination must survive it.
   */
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...args) {
      const r = orig.apply(this, args);
      dispatchEvent(new Event(NAVIGATED));
      return r;
    };
  }
})();
