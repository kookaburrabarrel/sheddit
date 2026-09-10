/**
 * session.js — is the reader logged in to Reddit?
 *
 * Sheddit owns no auth state and never will: it does not log in, read a cookie or hold a
 * token (PRIVACY.md). What it CAN see is the page Reddit rendered, and Reddit renders a
 * different header for a reader with a session — an avatar button and a user drawer in
 * place of the "Log In" button. That difference is the whole of what this module reads,
 * and it reads it through C.SESSION so the shapes stay in the single point of breakage.
 *
 * THE DECISION IS PRESENCE-BASED, AND THAT IS THE LOAD-BEARING PART.
 *
 *     logged in  =  a `loggedIn` signal is present  AND  no `loggedOut` signal is
 *
 * "No login button, therefore logged in" would switch the account layer on for the
 * primary, logged-out reader the day Reddit moves its login button — reply boxes that
 * cannot post, arrows that reach for controls that are not there. Requiring an
 * affirmative signal means a wrong contract costs the FEATURE for a logged-in reader
 * (who gets 0.33.0's behaviour, with Reddit's own controls one passthrough away) and
 * costs a logged-out reader nothing at all. That asymmetry is deliberate; keep it.
 *
 * Every C.SESSION entry is unverified live as of 0.34.0 — see the note there and the
 * LOGGED-IN SESSION section of test/live-contracts.js, which is what settles them.
 *
 * Caching: a positive answer is cached for the page (a session does not end mid-page),
 * a negative one only briefly. The header is server-rendered so it is normally present
 * by document_idle, but a late shreddit-app (log bug 66's family) could have the first
 * question asked before there is anything to read, and a negative latched then would
 * turn the layer off for a reader who is logged in.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.session = (() => {
  const NEGATIVE_TTL_MS = 1000;
  let cached = null;      // { loggedIn, matched, vetoed, at }
  let identity = null;    // { name, avatar } — read once per page, on demand

  /** Which clauses of a selector list match the document right now. Diagnostics-grade. */
  function matching(list) {
    return String(list || '').split(',').map(s => s.trim()).filter(Boolean).filter(sel => {
      try { return !!document.querySelector(sel); } catch { return false; }
    });
  }

  /** Read the page. Never throws; an unreadable page is a logged-out page. */
  function signals() {
    const S = SHD.C?.SESSION;
    if (!S || typeof document === 'undefined') {
      return { loggedIn: false, matched: [], vetoed: [], at: Date.now() };
    }
    const matched = matching(S.loggedIn);
    const vetoed = matching(S.loggedOut);
    return { loggedIn: matched.length > 0 && vetoed.length === 0, matched, vetoed, at: Date.now() };
  }

  function loggedIn() {
    if (cached && (cached.loggedIn || Date.now() - cached.at < NEGATIVE_TTL_MS)) return cached.loggedIn;
    cached = signals();
    return cached.loggedIn;
  }

  /**
   * Is the account layer ON for this page? Both halves have to say yes: the reader's
   * setting (SHD.settings.account — the switch on the options page) and the page itself.
   * Everything in account.js that changes behaviour for a logged-in reader asks this and
   * nothing else, so there is exactly one place the answer can be wrong.
   */
  function active() { return !!SHD.settings?.account && loggedIn(); }

  /* ------------------------------------------------------------------ *
   * Who the reader is — for the header's account corner (0.35.0)
   * ------------------------------------------------------------------ */

  /**
   * First match for a contract selector, light DOM first and open shadow roots after.
   *
   * The order is a cost decision, not a correctness one. A light-DOM `querySelector` over
   * the document is one cheap pass; `deepQuery` from the document root walks every open
   * shadow root on the page, and a Reddit page has dozens. So we ask the cheap way first
   * and only descend within the HEADER — the only element these selectors are scoped to
   * anyway — when the light DOM has nothing.
   */
  const clauses = (list) => String(list || '').split(',').map(x => x.trim()).filter(Boolean);

  function findInHeader(list) {
    for (const sel of clauses(list)) {
      try {
        const light = document.querySelector(sel);
        if (light) return light;
      } catch { /* a malformed clause must not take the rest with it */ }
    }
    const header = document.querySelector(SHD.C.HEADER);
    if (!header || !SHD.dom?.deepQuery) return null;
    for (const sel of clauses(list)) {
      try {
        const deep = SHD.dom.deepQuery(header, sel);
        if (deep) return deep;
      } catch { /* same */ }
    }
    return null;
  }

  /** Every light-DOM match for a contract list, in document order, deduplicated. */
  function allInHeader(list) {
    const out = new Set();
    for (const sel of clauses(list)) {
      try { document.querySelectorAll(sel).forEach(el => out.add(el)); }
      catch { /* a malformed clause must not take the rest with it */ }
    }
    return [...out];
  }

  /* A profile link and NOTHING ELSE. `/user/spez/` yes; `/user/spez/comments/…`, a
     submitted tab, or Reddit's own `/user/me/` alias, no — the first would name the reader
     after a page rather than a person, and the last is not a name at all. */
  const PROFILE_PATH = /^\/user\/([^/?#]+)\/?$/;
  const NOT_A_NAME = /^(me|profile)$/i;

  /** Read the identity once per page: the reader's name, and the avatar Reddit drew. */
  function readIdentity() {
    const out = { name: null, avatar: null };
    const S = SHD.C?.SESSION;
    if (!S || !loggedIn()) return out;

    /* EVERY candidate, not merely the first. Reddit's header can carry more than one
       `/user/` link — its own `/user/me/` alias beside the real profile, a profile tab —
       and a first-match-then-validate read would find one of those, fail the path test and
       report no name at all while the real link sat two nodes away. Each href is resolved
       against the page (so `https://www.reddit.com/user/x/` and `/user/x/` are one name)
       and matched on the PATH; the first that parses as a bare profile wins. */
    for (const link of allInHeader(S.username)) {
      const href = link.getAttribute('href') || '';
      if (!href) continue;
      let path = href;
      try { path = new URL(href, location.href).pathname; } catch { /* keep the raw value */ }
      const m = PROFILE_PATH.exec(path);
      if (m && !NOT_A_NAME.test(m[1])) {
        /* A stray `%` in the href throws URIError, and this runs inside readIdentity()
           under flush() — so one malformed link would spend an error-budget slot on a
           page that is otherwise fine. Every other parse in this file is guarded; this
           was the one that was not. The raw segment is a usable name either way. */
        try { out.name = decodeURIComponent(m[1]); } catch { out.name = m[1]; }
        break;
      }
    }

    const img = findInHeader(S.avatar);
    const src = img && (img.getAttribute('src') || '');
    // http(s) only: a data: or blob: avatar is not worth the surprise, and a relative one
    // is not an avatar.
    if (/^https?:\/\//i.test(src)) out.avatar = src;
    return out;
  }

  /* A null NAME is not an answer, it is "not yet". Reddit's header hydrates late and the
     drawer that carries the profile link may not exist when the corner is first drawn, so
     only a COMPLETE reading is cached — the menu asks again when it opens, and picks up a
     name that arrived in between. Reported 2026-09-09: a signed-in reader saw "logged in"
     where their name should be. */
  function ident() {
    if (identity && identity.name) return identity;
    identity = readIdentity();
    return identity;
  }

  /** The reader's own name, or null when the page does not say (see C.SESSION.username). */
  function username() { return ident().name; }

  /** The avatar URL Reddit's own header uses, or null. */
  function avatar() { return ident().avatar; }

  /** Route change: re-read next time. Cheap, and a stale answer is worse than a re-query. */
  function reset() { cached = null; identity = null; }

  /** The last reading, with the clauses that produced it — for verify:live and bug reports. */
  function report() { return { ...(cached || signals()), ...ident() }; }

  return { loggedIn, active, username, avatar, reset, report, signals };
})();
