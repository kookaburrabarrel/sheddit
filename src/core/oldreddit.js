/**
 * oldreddit.js — the only script Sheddit runs ON old.reddit.com.
 *
 * WHY THIS FILE EXISTS AT ALL
 * Every other content script EXCLUDES old.reddit.com, and that is still right: old reddit
 * is the thing this extension imitates, and imitating it on top of itself would be absurd.
 * But old.reddit.com no longer serves a logged-out reader anything. Measured 2026-09-03:
 * every path 302s to `/login/?reason=lor2&dest=<the page you asked for>`, and that login
 * page answers 403. So a link to old.reddit.com does not render old reddit and does not
 * render new reddit — it renders a wall.
 *
 * That wall is the problem this file solves, and the problem is NOT the wall. It is that a
 * reader with Sheddit installed sees a Reddit link fail and blames Sheddit. There is no
 * layout on that page, no header, nothing of ours — which is precisely what a broken
 * extension looks like. This is bug 52's argument (a silent hand-back reads as an
 * unrelated bug) applied to a page we were never on: we cannot be silent about a failure
 * we are going to be blamed for.
 *
 * WHY ONLY THIS ONE HOST
 * Every other legacy hostname already sorts itself out. Measured the same day:
 * `np.`, `i.`, `new.` and `sh.` reddit.com each answer `301 → www.reddit.com/<same path>`
 * on their own, so the renderer meets them on www having never seen the redirect.
 * `old.reddit.com` is the only one that answers with a wall instead, and `targetFor()`
 * rewrites that hostname and no other.
 *
 * WHAT IT DOES
 * Swaps the host for www.reddit.com — where the page loads and Sheddit renders it in the
 * old.reddit layout the link was asking for — behind an interstitial that says so. The
 * interstitial is not decoration. It is the entire point: an unexplained hop between two
 * hostnames is another thing to be blamed for.
 *
 * WHY `dest` IS UNWRAPPED RATHER THAN THE URL SWAPPED HOST-FOR-HOST
 * The 302 is server-side, so no document is ever created for the URL the reader clicked —
 * by the time this script runs, `location` says `/login/?reason=lor2&dest=…`. Swapping
 * only the host would land them on WWW's login page, which is the same wall in different
 * paint. The page they asked for is in `dest`, and it is the only thing on that URL worth
 * anything.
 *
 * WHY A CONTENT SCRIPT AND NOT declarativeNetRequest
 * DNR would intercept before the request, which is strictly more robust — it would work
 * even if old.reddit stopped answering altogether. It also costs a new permission, a
 * ruleset, and an extension-hosted page in the address bar, and it cannot show this
 * interstitial without one. The wall is a served HTML document today, so a content script
 * reaches it, and the permission Sheddit already has is enough. If old.reddit ever goes
 * fully dark (connection refused, not a 403), Chrome's own error page replaces the
 * document and nothing here runs — that is the known limit of this approach, and it is
 * recorded in ARCHITECTURE.md rather than guessed at.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.oldReddit = (() => {
  const OLD_HOST = 'old.reddit.com';
  const NEW_HOST = 'www.reddit.com';

  const CLASS = 'shd-redirecting';       // redirect.css hangs the blackout off this
  const ID = 'shd-redirect';

  /* How long the card is up before the hop. Long enough to read the first line, short
     enough that nobody experiences it as a stall. A redirect nobody sees is the silent
     hand-back this file exists to avoid; a two-second one is a tax on every link. */
  const DWELL_MS = 900;

  /* Loop guard. www.reddit.com never sends anyone back here — but another old-reddit
     redirector installed alongside Sheddit does exactly that, and two extensions each
     doing half of a round trip is an infinite one. sessionStorage is per-origin and
     per-tab, so this record is written on old.reddit.com and read by the NEXT visit to
     old.reddit.com in the same tab, which is precisely the loop's footprint. */
  const LOOP_KEY = 'shd-redirected';
  const LOOP_WINDOW_MS = 10000;

  /* The default for `redirectOldReddit`. contracts.js owns the real one and is NOT
     delivered to this page — this script ships alone, because a page we are leaving does
     not need 500 lines of selectors. So the value is repeated here and asserted against
     contracts.js by test/run.js, the same arrangement bridge.js has with the protocol
     literals: duplicated deliberately, and kept in step by a test rather than by memory. */
  const REDIRECT_BY_DEFAULT = true;

  /**
   * The www.reddit.com URL this old.reddit.com URL was asking for, or null for anything
   * we should not touch.
   *
   * Pure, and exported for that reason: every URL shape below is a case the suite pins
   * without a browser.
   *
   * @param {string} href
   * @returns {string|null}
   */
  function targetFor(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.hostname !== OLD_HOST) return null;      // only ever this one host

    if (isLogin(url)) {
      const dest = url.searchParams.get('dest');
      let d = null;
      /* `dest` arrives in a URL the reader may have been handed by anyone, so it is
         treated as hostile: only a reddit.com destination is followed, and a nested login
         wall is dropped. Following it anywhere else would make this an open redirect
         wearing Sheddit's name. */
      if (dest) { try { d = new URL(dest, url.origin); } catch { d = null; } }
      url = (d && isReddit(d) && !isLogin(d)) ? d : new URL('/', url.origin);
    }

    const out = new URL(url.href);
    /* ONLY the hostname is rewritten, so the port and the scheme ride along untouched.
       In production there is no port; in the packed-extension suite the fixture server's
       port is the only way the hop can land anywhere real. The scheme is left alone
       because reddit.com is HSTS-preloaded, which makes http the browser's business and
       not ours.

       `out.host = NEW_HOST` would do exactly the same thing, measured: the WHATWG host
       setter keeps the existing port when the value it is handed carries none. So the
       thing worth protecting is not which setter this is — it is that the port and the
       scheme survive at all, and what actually loses them is a target built by
       concatenating onto a hardcoded origin. That is what the mutation row reintroduces. */
    out.hostname = NEW_HOST;
    return out.href;
  }

  const isReddit = (u) => u.hostname === 'reddit.com' || u.hostname.endsWith('.reddit.com');
  const isLogin = (u) => /^\/login\/?$/.test(u.pathname);

  /* ------------------------------------------------------------------ *
   * the interstitial
   * ------------------------------------------------------------------ */

  function el(tag, props, children) {
    const node = document.createElement(tag);
    const { role, ...rest } = props || {};
    Object.assign(node, rest);
    // An attribute, not the property, for the reason gate.js gives: Element.role
    // reflection is current-Chrome behaviour and a silent expando if it ever stops.
    if (role) node.setAttribute('role', role);
    for (const c of [].concat(children || [])) {
      if (c == null || c === false || c === '') continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  /** Run `fn` once <body> exists. At document_start it usually does not. */
  function whenBody(fn) {
    if (document.body) { fn(); return; }
    /* `document`, not documentElement. Chromium injects document_start scripts at
       DidCreateDocumentElement so <html> is there — but observing the document costs
       nothing, cannot throw on a null node, and is the same set of mutations. */
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      obs.disconnect();
      fn();
    }).observe(document, { childList: true, subtree: true });
  }

  /**
   * @param {string} target  the www URL we are going to (or offering)
   * @param {boolean} looping  true when we stopped because we have been here before
   */
  function card(target, looping) {
    const pretty = target.replace(/^https?:\/\//, '');

    const stay = el('button', {
      type: 'button', className: 'shd-redirect-stay',
      textContent: 'Stay on old.reddit.com',
      onclick: () => standDown()
    });

    return el('div', { id: ID, role: 'status' }, [
      el('div', { className: 'shd-redirect-box' }, [
        el('h1', { textContent: looping
          ? 'Old Reddit detected, and something is sending you back'
          : 'Old Reddit detected, Sheddit redirecting…' }),
        el('p', { className: 'shd-redirect-what', textContent: looping
          ? 'Sheddit sent you to www.reddit.com a moment ago and you are back on ' +
            'old.reddit.com already, so it has stopped rather than bounce you between the ' +
            'two. Another old-reddit redirector running alongside Sheddit is the usual cause.'
          : 'old.reddit.com answers every page with a login wall now, so the link you ' +
            'followed was never going to load. That is not Sheddit failing — Sheddit ' +
            'draws the same layout on www.reddit.com, which is where this is going.' }),
        el('p', { className: 'shd-redirect-to' },
          el('a', { href: target, textContent: pretty })),
        looping ? stay : null,
        el('p', { className: 'shd-redirect-foot', textContent: looping
          ? 'Nothing happens on this page until you pick one.'
          : 'Sheddit did this on purpose. Turn it off in Sheddit\'s options if you would ' +
            'rather old.reddit.com were left alone.' })
      ])
    ]);
  }

  /** Give the page back, untouched, and leave nothing of ours on it. */
  function standDown() {
    document.getElementById(ID)?.remove();
    document.documentElement.classList.remove(CLASS);
  }

  /* ------------------------------------------------------------------ *
   * loop record
   * ------------------------------------------------------------------ */

  /** Did we already send this tab to `target` moments ago? */
  function looped(target) {
    try {
      const rec = JSON.parse(sessionStorage.getItem(LOOP_KEY) || 'null');
      return !!rec && rec.to === target && Date.now() - rec.at < LOOP_WINDOW_MS;
    } catch { return false; }        // storage blocked, or something else wrote the key
  }

  function recordHop(target) {
    try { sessionStorage.setItem(LOOP_KEY, JSON.stringify({ to: target, at: Date.now() })); }
    catch { /* storage blocked — the guard is a courtesy, not a precondition */ }
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */

  /** The user's `redirectOldReddit`, or the default when there is no storage to ask. */
  async function enabled() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      const v = settings && settings.redirectOldReddit;
      return v === undefined ? REDIRECT_BY_DEFAULT : !!v;
    } catch { return REDIRECT_BY_DEFAULT; }
  }

  async function start() {
    /* Documents only. A `.json` or `.rss` path under this host is a machine reading a
       feed, and painting an HTML card into one would corrupt what it came for. */
    if (document.contentType && document.contentType !== 'text/html') return;

    const target = targetFor(location.href);
    if (!target) return;

    /* Synchronous, before anything paints: everything below this line is async, and the
       login wall would flash in the gap. Removed again by standDown() if it turns out we
       are not going anywhere. */
    document.documentElement.classList.add(CLASS);

    if (looped(target)) { whenBody(() => mount(target, true)); return; }

    if (!await enabled()) { standDown(); return; }

    recordHop(target);
    whenBody(() => mount(target, false));
    /* Armed here rather than inside whenBody: a response that never produces a <body> is
       exactly the broken page this file exists to get the reader off. */
    setTimeout(() => location.replace(target), DWELL_MS);
  }

  function mount(target, looping) {
    document.getElementById(ID)?.remove();
    document.body.appendChild(card(target, looping));
  }

  /* Deliberately narrow. Nothing else in the extension runs on this host, so there is no
     caller to serve — `targetFor` is out here because it is pure and the suite pins every
     URL shape through it, and `start` because the line below calls it. */
  return { targetFor, start };
})();

SHD.oldReddit.start();
