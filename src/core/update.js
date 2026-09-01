/**
 * update.js — the one question a hand-installed extension cannot answer for itself:
 * is this copy still the current one?
 *
 * Sheddit is installed by hand on both browsers — load-unpacked on Chrome, a temporary
 * add-on on Firefox — and neither path ever updates itself. `runtime.requestUpdateCheck()`
 * answers only for a store install, and a manifest `update_url` is ignored for an unpacked
 * one, so a stale copy stays stale in silence. That is not a cosmetic problem here: Reddit
 * changes its markup and this extension chases it, so "Sheddit stopped rendering comments"
 * and "you are three builds back" are frequently the same report.
 *
 * TWO MECHANISMS, DELIBERATELY SEPARATE, BECAUSE THEY COST DIFFERENT THINGS.
 *
 *   THE NUDGE is arithmetic. BUILT is stamped into this file at release; if the copy in
 *   front of the reader is older than STALE_DAYS the header's control says so. It contacts
 *   nothing, works offline, and cannot be wrong about the network. What it cannot know is
 *   whether a newer build actually exists — only that this one has been sitting a while.
 *
 *   THE CHECK is one GET of a static JSON file, and it happens ONLY when the reader clicks
 *   the control. Never on load, never on a timer, never in the background. That restraint
 *   is the whole design and not an oversight to be optimised away later: PRIVACY.md promises
 *   Sheddit contacts no server of its own, and a check that fired by itself would turn every
 *   install into a periodic ping carrying an IP and a timestamp — telemetry in everything but
 *   name, and indistinguishable from it at the receiving end. The click is the consent.
 *
 * A STORE INSTALL NEEDS NONE OF THIS, AND IS NOT HARMED BY IT. Once the listings land, a
 * store-installed copy updates itself — which means its BUILT is always recent, so the nudge
 * never fires for those readers without needing to detect them (and `chrome.management` is a
 * permission this extension is not going to request in order to ask). The button still
 * answers honestly if pressed; it just has nothing to report.
 *
 * WHAT THE REQUEST DOES NOT CARRY. No cookies (`credentials: 'omit'`) and no referrer. The
 * referrer is the one that actually mattered: left at its default, a check run from a
 * comments page hands GitHub the URL of the thread being read — which subreddit, which post.
 * That is precisely the data this extension exists in order not to move, and it would have
 * leaked by default, from a feature whose entire payload is the four characters of a version
 * number.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.update = (() => {
  /* Stamped at release by refresh-zip.sh, in the same edit as the version in manifest.json,
     package.json and dist/latest.json. run.js asserts that the script still rewrites all
     four, because a BUILT that quietly stops moving does not fail — it turns the nudge into
     a permanent false alarm on a perfectly current copy, which is worse than no nudge. */
  const BUILT = '2026-09-01';

  /* Served out of the repository, not from a server of ours — there still is no such
     server. raw.githubusercontent.com answers with `access-control-allow-origin: *`, so
     this needs no host permission and does not widen what the extension is allowed to
     reach: the same reasoning PRIVACY.md already records for the video manifest. */
  const LATEST_URL =
    'https://raw.githubusercontent.com/kookaburrabarrel/sheddit/main/dist/latest.json';

  /* Where a reader goes to actually update. latest.json may name its own `url`, which is how
     this points at a store listing the day one lands without shipping a new build to say so. */
  const HOME = 'https://github.com/kookaburrabarrel/sheddit#install';

  /* Thirty days. Chosen against how this project actually breaks: Reddit ships a markup
     change, a fix follows within days, and a month-old copy is genuinely the likeliest
     explanation for a reader seeing something nobody else can reproduce. */
  const STALE_DAYS = 30;
  const TIMEOUT_MS = 6000;
  const KEY = 'update';
  const DAY = 86400000;

  /* idle -> checking -> done | failed. `done` says the answer arrived, NOT that the copy is
     current: whether there is something to install is `ahead` below, derived by comparing
     the answer with the running version rather than stored as a separate flag that could
     disagree with it. */
  let phase = 'idle';
  let record = null;          // { at, version, url, notes } — the last answer we got
  let loading = null;         // the storage read, once
  let inflight = null;        // the check in progress, so a second click cannot double it
  const watchers = new Set();
  const notify = () => { for (const fn of watchers) { try { fn(); } catch { /* a broken
    watcher is not worth losing the others over */ } } };

  /** The running build. Null in the dev harness, where there is no extension around us. */
  function installed() {
    try { return chrome.runtime.getManifest().version; } catch { return null; }
  }

  /**
   * Compare the x.y.z that a manifest version is allowed to be.
   *
   * Every part that is not a number reads as 0, which is the direction that matters: a
   * malformed or hostile answer can fail to register as newer, but it can never claim to be.
   */
  function cmp(a, b) {
    const pa = String(a).split('.'), pb = String(b).split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  /** The last moment we have any evidence about, as ms. */
  function since() {
    return Math.max(record ? record.at : 0, Date.parse(BUILT) || 0);
  }

  /**
   * What the header should paint. Derived on every call rather than cached: the two inputs
   * are the clock and one record, and a cached view of those is a staleness bug inside the
   * staleness check.
   */
  function state() {
    const running = installed();
    const latest = record ? record.version : null;
    const ahead = !!(latest && running && cmp(latest, running) > 0);
    const at = since();
    const days = at ? Math.floor((Date.now() - at) / DAY) : null;
    return {
      phase,
      installed: running,
      latest,
      url: (record && record.url) || HOME,
      notes: (record && record.notes) || null,
      ahead,
      /* Measured from the last thing we KNOW, not from the build date alone. A reader who
         checked yesterday and was told they are current should not be told tomorrow that
         their old build is suspect — it is, and the answer to it is already in hand. */
      stale: !ahead && days != null && days >= STALE_DAYS,
      days
    };
  }

  /**
   * Read the last answer back at boot, so "0.29.0 is out" survives the next page load
   * instead of having to be re-fetched — which is what would make an automatic re-check
   * feel necessary, and it is not.
   *
   * Best effort by design: no storage at all (the dev harness, or a browser that declined
   * it) simply means the nudge falls back to the build date, which is the offline answer.
   */
  function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const got = await chrome.storage.local.get(KEY);
        const r = got && got[KEY];
        if (r && typeof r.version === 'string' && typeof r.at === 'number') {
          record = r;
          notify();
        }
      } catch { /* nothing stored, nothing lost */ }
    })();
    return loading;
  }

  /** Only https, and only what we asked about — see cmp() on hostile answers. */
  function safeUrl(u) {
    return typeof u === 'string' && /^https:\/\//.test(u) ? u : HOME;
  }

  async function remember(r) {
    try { await chrome.storage.local.set({ [KEY]: r }); } catch { /* not fatal */ }
  }

  /**
   * Ask, once, because the reader asked. Returns a promise for the tests; the header reads
   * state() from the watcher rather than from this.
   */
  function check() {
    if (inflight) return inflight;
    phase = 'checking';
    notify();

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    /* Through a resolved promise rather than called outright: where there is no fetch at
       all (the dev harness) the reference throws SYNCHRONOUSLY, which would escape the
       .catch below and leave the control stuck on "checking…" forever. Every other failure
       is already a rejection; this makes that one behave like the rest. */
    inflight = Promise.resolve().then(() => fetch(LATEST_URL, {
      signal: ctl.signal,
      credentials: 'omit',              // no cookies to GitHub, ever
      referrerPolicy: 'no-referrer',    // and never the URL of the page being read
      /* The one request whose cached answer is worse than no answer: a version file served
         from cache says "you are current" with the authority of a fresh check. */
      cache: 'no-store',
      redirect: 'follow'
    }))
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j || typeof j.version !== 'string') throw new Error('unusable answer');
        record = {
          at: Date.now(),
          version: j.version,
          url: safeUrl(j.url),
          notes: typeof j.notes === 'string' ? j.notes : null
        };
        phase = 'done';
        return remember(record);
      })
      /* Abort, offline, CORS, a page CSP that refuses the connection, malformed JSON — all
         the same to the reader, who gets a link to the download page instead of a dead end. */
      .catch(() => { phase = 'failed'; })
      .finally(() => { clearTimeout(timer); inflight = null; notify(); });
    return inflight;
  }

  function onChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }

  return { BUILT, STALE_DAYS, HOME, LATEST_URL, cmp, installed, state, load, check, onChange };
})();
