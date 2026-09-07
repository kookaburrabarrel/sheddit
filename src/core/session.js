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

  /** Route change: re-read next time. Cheap, and a stale answer is worse than a re-query. */
  function reset() { cached = null; }

  /** The last reading, with the clauses that produced it — for verify:live and bug reports. */
  function report() { return cached || signals(); }

  return { loggedIn, active, reset, report, signals };
})();
