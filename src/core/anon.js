/**
 * anon.js — the listing a logged-out reader would get, shown to a logged-in one.
 *
 * EXPERIMENTAL, on the anon-listing-toggle branch. It is the one place Sheddit asks Reddit
 * for post content itself, and that is a change to what PRIVACY.md promises ("it works on
 * the page already loaded in your tab"). It does not ship until that document, the store
 * answers and the switch's default are decided.
 *
 * WHAT IT DOES. A header switch flips a listing between `curated` — the page Reddit served
 * this reader, which for a signed-in reader is their personalised feed — and `anon`: the
 * same URL fetched again with `credentials: 'omit'`, so Reddit sees no session and answers
 * as it would for a first-time visitor. The answer is parsed with DOMParser, never
 * inserted: its <shreddit-post> elements go through the same model.post() reader as the
 * live page's and are drawn by listing.build(), into a table of their own beside
 * #siteTable. Only one of the two is visible; switching back is instant, because the
 * curated rows were never removed.
 *
 * Why not an incognito window: an extension can only open one if the reader has allowed
 * it there, and it would be a visible window to fetch one list. A request without cookies
 * is the same question asked without the furniture.
 *
 * PAGING. The fetched copy runs no scripts, so the faceplate-partial that continues a
 * live feed (paginator.js) is just an element with a `src`. That src is the next page's
 * URL; it is fetched the same way — no cookies, no referrer — and its answer carries the
 * next one. The curated paginator is paused while this view is up (paginator.pump asks
 * showing()), or it would keep loading pages into a table nobody can see.
 *
 * WHAT IT CANNOT DO. The rows are read out of a detached document, so there is no native
 * vote button behind them: the arrows are drawn inert and say so on hover. Reddit may also
 * answer a cookie-less request with a block page rather than a feed; a document with no
 * posts in it is reported as such and the reader is pointed back to curated.
 *
 * STATE. Which view is up is per tab and survives in-tab navigation (sessionStorage),
 * because a reader who asked for the anonymous front page and clicks `new` meant the
 * anonymous `new`. It is not a synced setting: this is a way of looking, not a preference
 * the options page should carry while it is an experiment.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.anon = (() => {
  const C = SHD.C;
  const { h } = SHD.dom;

  const KEY = 'shd-links';
  const TABLE_ID = 'shd-anon-table';
  const TIMEOUT_MS = 10000;
  const MAX_PAGES = 40;              // the curated paginator's ceiling, for the same reason

  let view = read();                 // 'curated' | 'anon'
  let epoch = 0;                     // bumped by reset(); a load from a previous route drops its answer
  let next = null;                   // the next page's URL, from the last answer's partial
  let pages = 0;
  let busy = false;
  let rank = 0;
  let seen = new Set();
  let io = null;

  function read() {
    try { return sessionStorage.getItem(KEY) === 'anon' ? 'anon' : 'curated'; }
    catch { return 'curated'; }
  }
  function write(v) {
    try { sessionStorage.setItem(KEY, v); } catch { /* private mode: lasts the page instead */ }
  }

  /** Does the switch belong on this page? A listing, a signed-in reader, the listing layer on. */
  function available() {
    return SHD.route.current === SHD.route.LISTING && !!SHD.settings?.listing
      && SHD.session.loggedIn();
  }

  /** Is the anonymous table the one on screen? paginator.js asks before every curated load. */
  function showing() {
    return view === 'anon' && available() && !!table();
  }

  /** The URL as the route last emitted it — not location, which can be a commit behind. */
  function sourceUrl() {
    const R = SHD.route;
    const t = R.timeQuery;
    const u = new URL(R.path, location.origin);
    if (t) u.searchParams.set('t', t);
    return u.href;
  }

  /** One GET with no cookies and no referrer. Resolves to a parsed Document, or throws. */
  async function get(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'follow'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new DOMParser().parseFromString(await r.text(), 'text/html');
    } finally {
      clearTimeout(timer);
    }
  }

  /* The next page's address, if the answer has one. Same contract as the live feed's
     continuation; in a parsed document it cannot be driven, only read. */
  function nextOf(doc) {
    const p = doc.querySelector(C.FEED_PARTIAL) || doc.querySelector(C.LAZY_LOADER + '[src*="more-posts" i]');
    const src = p && p.getAttribute('src');
    if (!src) return null;
    try { return new URL(src, location.origin).href; } catch { return null; }
  }

  /* ------------------------------------------------------------------ *
   * the table
   * ------------------------------------------------------------------ */

  /* Under #shd-root, not by id alone: on a route change gate.parkOutgoing() keeps the old
     page on screen as #shd-outgoing, with this table still inside it. */
  function table() { return document.querySelector(`#${C.ROOT_ID} #${TABLE_ID}`); }

  function mount() {
    const curated = document.querySelector(`#${C.ROOT_ID} #siteTable`);
    if (!curated) return null;
    let box = table();
    if (box) return box;
    box = h(`div#${TABLE_ID}.shd-sitetable.shd-anon-table`, null, [
      h('p.shd-anon-note', {
        text: 'anonymous view — the links Reddit serves this page to a reader who is not '
          + 'logged in. Fetched without your cookies; votes are off here.'
      }),
      h('div.shd-anon-rows'),
      h('div.shd-anon-more')
    ]);
    curated.after(box);
    return box;
  }

  function status(text, { button = false, retry = false } = {}) {
    const slot = table()?.querySelector('.shd-anon-more');
    if (!slot) return;
    slot.replaceChildren(button
      ? h('a.shd-loadmore', {
          href: '#', text,
          onclick: (e) => { e.preventDefault(); retry ? restart() : loadNext(); }
        })
      : h('span.shd-anon-status', { text }));
  }

  /** Draw the posts of one answer. Returns how many rows it added. */
  function draw(doc) {
    const rows = table()?.querySelector('.shd-anon-rows');
    if (!rows) return 0;
    let added = 0;
    for (const el of doc.querySelectorAll(C.POST)) {
      if (el.closest(C.AD_POST)) continue;
      const m = SHD.model.post(el);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      rank += 1;
      rows.appendChild(SHD.listing.build(m, rank, { inert: true }));
      added++;
    }
    return added;
  }

  async function load(url, first) {
    if (busy) return;
    busy = true;
    const mine = epoch;
    status('loading anonymous links…');
    try {
      const doc = await get(url);
      if (mine !== epoch) return;
      const added = draw(doc);
      pages++;
      next = nextOf(doc);
      if (first && !added) {
        status('Reddit sent no posts to a reader without cookies. Try again, or switch '
          + 'back to curated.', { button: true, retry: true });
        return;
      }
      if (!next) { status('no more pages'); return; }
      if (pages >= MAX_PAGES) { status(`stopped after ${MAX_PAGES} pages`); return; }
      status('load more', { button: true });
      watch();
    } catch (err) {
      if (mine !== epoch) return;
      console.warn('[sheddit] anonymous listing request failed', err);
      status('could not load the anonymous links — retry', { button: true, retry: !pages });
    } finally {
      if (mine === epoch) busy = false;
    }
  }

  function loadNext() { if (next) load(next, false); }

  function restart() {
    const rows = table()?.querySelector('.shd-anon-rows');
    rows?.replaceChildren();
    seen = new Set(); rank = 0; pages = 0; next = null;
    load(sourceUrl(), true);
  }

  /* Auto-paging, on the same setting as the curated list's. Kept simple on purpose: one
     observer on the control at the bottom, which only ever asks for the page already
     named — a load in flight or a missing next page makes it a no-op. */
  function watch() {
    io?.disconnect();
    io = null;
    if (!SHD.settings.autoPaginate) return;
    const slot = table()?.querySelector('.shd-anon-more');
    if (!slot) return;
    io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting) && showing()) loadNext();
    }, { rootMargin: '1200px 0px' });
    io.observe(slot);
  }

  /* ------------------------------------------------------------------ *
   * the view
   * ------------------------------------------------------------------ */

  /**
   * Make the page agree with `view`. Called by the pipeline once the curated listing is up
   * (both the ordinary and the empty-feed path), and by the switch.
   */
  function sync() {
    const root = document.getElementById(C.ROOT_ID);
    const curated = root?.querySelector('#siteTable');
    if (!root || !curated) return;
    const anon = view === 'anon' && available();
    root.dataset.shdLinks = anon ? 'anon' : 'curated';
    if (anon) {
      const fresh = !table();
      const box = mount();
      curated.hidden = true;
      box.hidden = false;
      if (fresh) restart();
    } else {
      curated.hidden = false;
      const box = table();
      if (box) box.hidden = true;
      /* The curated chain was paused while the other table was up; re-attaching is what
         starts it again from where the reader is. */
      if (box && SHD.settings.autoPaginate) SHD.paginator.attach(curated);
    }
    paintSwitch();
  }

  function set(v) {
    view = v === 'anon' ? 'anon' : 'curated';
    write(view);
    sync();
  }

  /**
   * The header switch: `links: curated | anon`. Null where it would do nothing — off a
   * listing, or logged out, where both answers are the same page (bug 62: a control that
   * changes nothing is worse than no control).
   */
  function control() {
    if (!available()) return null;
    const btn = (id, label, title) => h('button.shd-links-btn', {
      type: 'button',
      'data-links': id,
      'aria-pressed': view === id ? 'true' : 'false',
      class: view === id ? 'selected' : null,
      title,
      onclick: () => { if (view !== id) set(id); }
    }, label);
    return h('div.shd-linksbar', { role: 'group', 'aria-label': 'which links to show' }, [
      h('span.shd-linkslabel', { text: 'links:' }),
      btn('curated', 'curated', 'The links Reddit chose for you, from the page you were served.'),
      btn('anon', 'anon', 'The links Reddit serves a reader who is not logged in. Sheddit '
        + 'fetches this page again without your cookies to get them — one extra request to '
        + 'Reddit per page of links.')
    ]);
  }

  function paintSwitch() {
    for (const b of document.querySelectorAll('#shd-header .shd-links-btn')) {
      const on = b.dataset.links === view;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** Route change or stop. The table goes with #shd-root; this drops the work behind it. */
  function reset() {
    epoch++;
    io?.disconnect();
    io = null;
    busy = false;
    next = null; pages = 0; rank = 0;
    seen = new Set();
  }

  return { control, sync, set, showing, reset, get view() { return view; } };
})();
