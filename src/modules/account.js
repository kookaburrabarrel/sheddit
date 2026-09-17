/**
 * account.js — the account layer: what changes for a reader who is ALREADY logged in.
 *
 * Three things, and only these three, by request: VOTE, REPLY, POST. Nothing here holds a
 * session, calls an endpoint or builds a request. Every action is a click forwarded to
 * the control Reddit rendered for the same purpose, or text handed to Reddit's own editor
 * followed by a click on Reddit's own submit button — ARCHITECTURE §5's delegation tier,
 * extended from "the arrow" to "the reply box", with Reddit's page code still owning the
 * auth, the network request, the error handling and the optimistic insert. The extension
 * keeps its zero network surface with this file in it.
 *
 * WHO THIS IS FOR, AND WHO IT MUST NOT TOUCH
 * SHD.session decides whether the layer is on (setting AND a logged-in page). For the
 * primary, logged-out reader every path in here collapses to 0.33.0's behaviour: arrows
 * that no-op silently (Reddit renders no vote control for a logged-out session — measured,
 * ARCHITECTURE §7d), a `reply` that hands off to Reddit's own comment via passthrough, and
 * no submit buttons. That is asserted, not assumed: test/run.js boots the same fixtures
 * logged out and checks nothing new appears.
 *
 * VOTING TRUSTS WHAT IT CAN VERIFY
 * A click resolves the native button at click time (the action bar hydrates late, §1.3).
 * It used to forward to whatever it found, on the rule that the button's presence IS
 * ground truth because Reddit renders it only for a session that can use one. That rule
 * is false now — Reddit ships vote buttons to logged-out readers too — and it produced a
 * fake vote: a score that moved, an arrow that lit, and no request behind either.
 *
 * The rule is now EITHER of two signals, because either one makes the vote answerable
 * for. A button exposing its own state (`aria-pressed`) lets settle() read the page's
 * verdict back and overrule our optimistic paint; a session the detector recognises means
 * the click has somewhere to land even if the state is not exposed yet. Neither, and the
 * click casts nothing and the row says why. The detector is still not trusted ALONE, which
 * is what keeps a logged-in reader with an unfamiliar header able to vote.
 *
 * "At click time" is not enough on its own for a comment, and this is the one place the
 * extension reaches into the page's own layout rather than only its DOM. Reddit mounts a
 * comment's action row — both `Reply` and its vote buttons — when the comment is near a
 * viewport, and nothing in this layout ever scrolls Reddit's copy of the thread. So a miss
 * scrolls the native row inside the box suppress.css leaves it and asks again (nudge(),
 * resolveLate()), and only a miss that survives that is reported as one.
 *
 * WHAT IS UNVERIFIED
 * The composer protocol (C.COMPOSER) and the per-comment reply control (C.NATIVE.reply)
 * are candidates: shaped from ordinary use of the site, driven end to end only against
 * fixtures that model them, never yet against a signed-in reddit.com — the measurement
 * needs a desk, not a container (CONTRIBUTING). So every step measures its outcome and
 * every miss has the same floor: reveal Reddit's own composer in place with whatever text
 * did land, and let the reader finish in Reddit's UI. The reply the reader typed is never
 * discarded — the form stays, draft intact, until the reply is seen to arrive.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.account = (() => {
  const { h, score, plural } = SHD.dom;
  const C = SHD.C;

  /* Mutable for the suite, like comments.timings — nothing in the extension writes it.
     syncMs: how long after render to look for a hydrated vote state (the bar is not there
             at first paint; 1.5s is the verify:live wait that found it hydrated).
     settleMs: how long after a forwarded click to re-read the native state, for a page
             that updates its button on the response rather than optimistically.
     composeWaitMs / pollMs: how long to wait for Reddit to mount its editor after the
             reply control is clicked.
     hydrateWaitMs: how long to wait for Reddit to mount a comment's action row after the
             row has been scrolled inside the suppressed tree's box (nudge()).
     reconcileMs: how long inserted text has to survive before it counts as landed. A rich
             editor reconciles its DOM against its own model a microtask or a frame after
             the write, and text that does not outlive that was never accepted (landed()).
     arriveWaitMs: how long to wait for the posted comment to appear before calling the
             submit lost and revealing the native composer. */
  const timings = { syncMs: 1500, settleMs: 400, composeWaitMs: 4000, pollMs: 100, arriveWaitMs: 8000,
                    drawerWaitMs: 4000, logoutWaitMs: 6000, hydrateWaitMs: 3000,
                    reconcileMs: 120 };

  const active = () => SHD.session.active();

  /* ------------------------------------------------------------------ *
   * Vote
   * ------------------------------------------------------------------ */

  /* A miss is either "not hydrated yet" (retry works) or "contracts.js is stale" (retry
     never works). Warn ONCE, with the evidence needed to tell them apart — and only on a
     session where the control is expected. Logged out it is known not to exist. */
  let missWarned = false;
  function reportMiss(kind, m) {
    if (missWarned || !active()) return;
    missWarned = true;
    const loader = m.source.querySelector(C.ASYNC_LOADER);
    console.warn(
      `[sheddit] no ${kind} control found on ${m.id} (logged-in session). ` +
      `async-loader present: ${!!loader}; open shadow roots searched: ${SHD.dom.shadowRoots(m.source)}. ` +
      `If the action bar is visibly hydrated on the page, C.NATIVE.${kind} in contracts.js ` +
      `is stale, or the control sits in a CLOSED shadow root and cannot be delegated to.`);
  }

  /**
   * Say so on the row when the control still cannot be reached — the FLOOR, after the
   * click has already given Reddit the chance it was waiting for (see nudge()).
   *
   * Reported from a signed-in session: every comment vote was a silent no-op — arrow
   * dead, score still, nothing said — while post votes on the same page worked. That is
   * log 62's sin exactly ("a control that ignores a click is worse than no control"),
   * and reportMiss() only ever reached the console, once per page.
   *
   * WHY A COMMENT MISSES AND A POST DOES NOT. A post's vote buttons live in the POST'S OWN
   * open shadow root and need no hydration, so they are there whenever we look. A
   * comment's live one level down, inside the open shadow root of its lazily-hydrated
   * <shreddit-comment-action-row>, which Reddit mounts on viewport position — and THE
   * READER SCROLLS OUR ROWS, NEVER REDDIT'S, so that row is never near a viewport of its
   * own accord. That is the part the click now handles. What is left for this function is
   * everything else: hydration that did not finish inside the deadline, a stale contract,
   * or a control that moved into a closed root.
   *
   * TWO REASONS, because they are not the same news and the earlier copy gave the wrong
   * one to the reader most likely to see it. `unavailable` says the control has not
   * arrived \u2014 true on a signed-in page, and it invites another try. Said to a LOGGED-OUT
   * reader it is a straight falsehood: nothing is loading, and no amount of waiting will
   * produce a vote. That reader is this extension's primary audience, so they get
   * `logged-out` and a sentence that is actually about them.
   *
   * The mark is not permanent. clearUnavailable() takes it off the moment a control does
   * resolve, because a row that said "not yet" and then hydrates has to stop saying it.
   */
  const MISS_COPY = {
    'logged-out': 'You are not logged in to Reddit, so this arrow cannot cast a vote',
    comment: 'Reddit has not loaded this comment\u2019s vote control, so this arrow cannot do anything yet',
    post: 'Reddit has not loaded this post\u2019s vote control, so this arrow cannot do anything yet'
  };

  function markMiss(col, kind, reason = 'unavailable') {
    col.dataset.shdVoteMiss = reason;
    const why = reason === 'logged-out' ? MISS_COPY['logged-out'] : MISS_COPY[kind];
    for (const a of col.querySelectorAll('.arrow')) {
      a.setAttribute('title', why);
      a.setAttribute('aria-disabled', 'true');
    }
  }

  /** Undo markMiss(): the control turned up after all. */
  function clearUnavailable(col) {
    if (col.dataset.shdVoteMiss == null) return;
    delete col.dataset.shdVoteMiss;
    for (const a of col.querySelectorAll('.arrow')) {
      a.removeAttribute('title');
      a.removeAttribute('aria-disabled');
    }
  }

  /**
   * Bring a native node inside the suppressed tree's box, so Reddit's own observer can
   * see it and mount whatever it defers on viewport position.
   *
   * suppress.css gives each native body child the viewport's dimensions with its own
   * overflow clipped — which is what lets anything on the native tree hydrate at all —
   * but a row past that box's first screen is still clipped out of it, and nothing in this
   * layout ever scrolls Reddit's copy. This does, on the click that needs it, and only
   * then: walking the native tree into view once per rendered row would be a page's worth
   * of layout for a reader who may never vote.
   *
   * A vote that moved the reader's place in a thread would be worse than a vote that
   * misses, and the thing that prevents it is the suppression rule rather than anything
   * here: the box is `position: fixed`, so the document is not in the containing-block
   * chain scrollIntoView walks and cannot be scrolled by this call. That was written first
   * as a save-and-restore of window.scrollX/scrollY — measured against the packed
   * extension in Chromium, the restore never fired once, because there was never anything
   * to restore. It is gone, and the guarantee is asserted where it actually lives:
   * test/extension.js checks the reader's scroll position across a comment vote, and the
   * mutation row that puts the native tree back in flow fails that assertion.
   */
  function nudge(source) {
    try { source.scrollIntoView?.({ block: 'center' }); }
    catch { /* geometry is the bonus here, never the requirement */ }
  }

  /**
   * A control that was not there when we first looked: give Reddit the one thing it is
   * waiting for, and keep looking until the deadline. Resolves to the control or null.
   */
  function resolveLate(source, find) {
    nudge(source);
    return waitFor(find, timings.hydrateWaitMs);
  }

  const nativeButtons = (source) => ({
    up: SHD.dom.deepQuery(source, C.NATIVE.upvote),
    down: SHD.dom.deepQuery(source, C.NATIVE.downvote)
  });

  /**
   * What Reddit's buttons say the reader's vote is: 1, -1, 0 — or null when neither
   * button carries the state attribute at all, in which case the arrows keep their own
   * local toggle and the page's buttons are never contradicted, only not mirrored.
   */
  function nativeState({ up, down }) {
    const u = up?.getAttribute(C.NATIVE.voteState);
    const d = down?.getAttribute(C.NATIVE.voteState);
    if (u == null && d == null) return null;
    if (u === 'true') return 1;
    if (d === 'true') return -1;
    return 0;
  }

  /** The element showing this row's score: the midcol's own on a post, the tagline's on a comment. */
  function scoreNode(col, kind) {
    if (kind === 'post') return col.querySelector('.score');
    return col.parentElement?.querySelector(':scope > .entry > .tagline > .score') || null;
  }

  /**
   * Paint a vote state onto our arrows — old reddit's classes (`likes`/`dislikes` on the
   * column, `upmod`/`downmod` on the arrow) — and move the score with it. The score Reddit
   * sent already INCLUDES the reader's standing vote, so the displayed number is
   * `score + (state − initial)`, where `initial` is the first state the native buttons
   * were seen in. Never adjusted for a hidden score: "score hidden" stays hidden.
   */
  function paint(col, m, kind, state) {
    const initial = Number(col.dataset.shdVoteInitial || 0);
    col.dataset.shdVote = String(state);
    col.classList.toggle('likes', state === 1);
    col.classList.toggle('dislikes', state === -1);
    col.classList.toggle('unvoted', state === 0);
    col.querySelector('.arrow.up')?.classList.toggle('upmod', state === 1);
    col.querySelector('.arrow.down')?.classList.toggle('downmod', state === -1);
    const node = scoreNode(col, kind);
    if (node && m.score != null && !m.scoreHidden) {
      const n = m.score + (state - initial);
      node.textContent = kind === 'post' ? score(n) : plural(n, 'point');
    }
  }

  /** Record the first native state seen as the one the delivered score already counts. */
  function learnInitial(col, m, kind, btns) {
    if (col.dataset.shdVoteInitial != null) return;
    const s = nativeState(btns);
    if (s === null) return;
    col.dataset.shdVoteInitial = String(s);
    paint(col, m, kind, s);
  }

  /** Re-read the native state after a click, so the page's answer wins over our guess. */
  function settle(col, m, kind, btns) {
    const s = nativeState(btns);
    if (s !== null) paint(col, m, kind, s);
  }

  /** Forward the click to the button we resolved, and mirror it on our own arrows. */
  function cast(col, m, kind, dir, btns) {
    clearUnavailable(col);
    learnInitial(col, m, kind, btns);
    (dir === 1 ? btns.up : btns.down).click();
    // Optimistic, like old reddit: clicking the lit arrow un-votes, the other one flips.
    const before = Number(col.dataset.shdVote || 0);
    paint(col, m, kind, before === dir ? 0 : dir);
    // Then defer to the page, now and once more after it has had time to answer.
    setTimeout(() => col.isConnected && settle(col, m, kind, btns), 0);
    setTimeout(() => col.isConnected && settle(col, m, kind, btns), timings.settleMs);
  }

  /**
   * Can a click on this column become a real vote?
   *
   * THE BUTTON'S PRESENCE USED TO BE THE ANSWER AND NO LONGER IS. This file's header
   * argued that Reddit renders a vote control only for a session that can use one, so the
   * control was ground truth and the session detector was only consulted about what a MISS
   * meant (ARCHITECTURE §7d: "logged out, nothing"). Reported from a logged-out session on
   * a live listing, and it is the worst kind of bug this code can have: clicking a post's
   * up arrow moved the score 5411 -> 5412 and lit `.upmod`, with no request made and no
   * login prompt. Reddit now ships those buttons to everyone.
   *
   * The optimistic paint could not be corrected either, which is what made it stick. It is
   * settle() that normally lets the page overrule our guess — but it reads `aria-pressed`,
   * and buttons served to a logged-out reader carry no state at all, so nativeState()
   * returns null, settle() returns without repainting, and the invented number stays on
   * screen until the page is reloaded. A vote the reader never cast, shown as cast, and
   * guaranteed to disagree with the real score.
   *
   * So the test is now EITHER signal, not the button alone: a readable native state (which
   * is the page telling us where the vote stands, and the thing settle() needs to be able
   * to correct us) or a session the detector recognises. Keeping the second clause is what
   * stops this from becoming the opposite bug — a logged-in reader whose header shape we
   * fail to recognise can still vote, which was the whole reason for distrusting the
   * detector in the first place.
   */
  const votable = (btns) => nativeState(btns) !== null || active();

  function vote(col, m, kind, dir) {
    const btns = nativeButtons(m.source);
    if (dir === 1 ? btns.up : btns.down) {
      if (votable(btns)) return cast(col, m, kind, dir, btns);
      /* Reddit's button is right there and pressing it achieves nothing: logged out it
         opens a login prompt, which is a body child and therefore suppressed, so the
         reader would see precisely nothing happen. Say so instead of forwarding into
         silence — and never paint, because there is no vote to paint. */
      return markMiss(col, kind, 'logged-out');
    }
    /* No button at all. Logged out that is the end of it — the answer is known and no
       amount of hydration changes it, so do not spend a deadline finding out. */
    if (!active()) return markMiss(col, kind, 'logged-out');
    /* Signed in, this is the expected FIRST answer on a comment rather than the final
       one: Reddit has not mounted the action row that holds the button. Bring the native
       row into view, wait for it, and only then call it unavailable. The wait is kept to
       one at a time — a reader clicking a dead arrow twice should not start a second
       deadline, and the first one is already doing the work. */
    if (col.dataset.shdVoteWait) return;
    col.dataset.shdVoteWait = '1';
    resolveLate(m.source, () => {
      const late = nativeButtons(m.source);
      return (dir === 1 ? late.up : late.down) ? late : null;
    }).then((late) => {
      delete col.dataset.shdVoteWait;
      if (!col.isConnected) return;
      if (late) return cast(col, m, kind, dir, late);
      reportMiss(dir === 1 ? 'upvote' : 'downvote', m);
      markMiss(col, kind);
    });
  }

  /**
   * The vote column for a post row (arrows around the score) or a comment (arrows only —
   * old reddit puts a comment's score in its tagline). Clicks delegate; see the header.
   * On an active session the column also looks for the hydrated state once, after
   * render, so a post the reader already voted on comes up lit.
   *
   * A COMMENT the reader already voted on does not, and that is deliberate rather than
   * missed. Its state lives on the same action row the buttons do, so reading it would
   * mean scrolling the native tree once per rendered comment — a page's worth of layout
   * to light some arrows. The state is learned on the click instead (cast() calls
   * learnInitial() before forwarding), which is the moment it is needed: un-voting a
   * standing vote still moves the score the right way.
   */
  function midcol(m, kind = 'post') {
    const arrow = (dir, label) => {
      const el = h(`div.arrow.${dir === 1 ? 'up' : 'down'}`, {
        role: 'button', tabindex: '0', 'aria-label': label,
        onclick: (e) => { e.preventDefault(); vote(col, m, kind, dir); }
      });
      // A div playing a button answers to the keys a real one would.
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vote(col, m, kind, dir); }
      });
      return el;
    };
    const col = h('div.midcol.unvoted', { dataset: { shdVote: '0' } }, [
      arrow(1, 'upvote'),
      kind === 'post'
        ? h('div.score.unvoted', {
            text: score(m.score),
            title: m.upvoteRatio != null ? `${Math.round(m.upvoteRatio * 100)}% upvoted` : null
          })
        : null,
      arrow(-1, 'downvote')
    ]);
    if (active()) {
      setTimeout(() => {
        if (col.isConnected) learnInitial(col, m, kind, nativeButtons(m.source));
      }, timings.syncMs);
    }
    return col;
  }

  /* ------------------------------------------------------------------ *
   * Reply — drive Reddit's composer
   * ------------------------------------------------------------------ */

  function waitFor(cond, ms) {
    const deadline = Date.now() + ms;
    return new Promise((resolve) => {
      const tick = () => {
        let v = null;
        try { v = cond(); } catch { v = null; }
        if (v) return resolve(v);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, timings.pollMs);
      };
      tick();
    });
  }

  /**
   * Reddit's composer for THIS target. A comment's composer is looked for inside the
   * comment and scoped to it (a comment's subtree holds its descendants — §1.4's body
   * lesson applies to composers too); the post's is any composer that is not inside a
   * comment. `except` is a snapshot from before the reply control was clicked, so a
   * composer that was already open elsewhere is never mistaken for the one we asked for.
   */
  function findHost(target, kind, except = new Set()) {
    /* The post's composer is looked for inside the page's main column, not the whole
       document: the host list has a broad fallback clause, and a form elsewhere on the page
       whose action happens to mention comments must not become where the reader's comment
       goes (security review, 2026-09-05). */
    const scope = kind === 'comment' ? target : (document.querySelector(C.MAIN) || document);
    const all = [...scope.querySelectorAll(C.COMPOSER.host)];
    const mine = all.filter(el => !except.has(el) && (kind === 'comment'
      ? el.closest(C.COMMENT) === target
      : !el.closest(C.COMMENT)));
    return mine[0] || null;
  }

  const hostsNow = () => new Set(document.querySelectorAll(C.COMPOSER.host));

  /**
   * Reddit's reply control for THIS comment. The attribute clauses first (C.NATIVE.reply),
   * then the shape measured live 2026-09-05: a bare light-DOM <button> whose only handle
   * is its text, "Reply" (C.NATIVE.replyText). Every button reachable through the comment
   * — light DOM and open shadow roots — is a candidate, and only one the comment itself
   * owns counts: a comment's subtree holds its descendants' reply buttons as surely as it
   * holds their bodies (§1.4), and clicking a child's control would open a composer under
   * the wrong comment.
   */
  /**
   * The comment a node belongs to, THROUGH shadow roots. `closest()` stops at a shadow
   * boundary and answers null for a button inside an action row's root — which is where
   * the vote buttons live and where a named reply control would — so an ownership test
   * built on closest() alone disowns exactly the controls it exists to find (it did:
   * twelve assertions red at once). Climb out of each root to its host and ask again.
   */
  function ownerComment(node) {
    for (let n = node; n;) {
      const c = typeof n.closest === 'function' ? n.closest(C.COMMENT) : null;
      if (c) return c;
      const root = typeof n.getRootNode === 'function' ? n.getRootNode() : null;
      n = root && root.host ? root.host : null;
    }
    return null;
  }

  function replyControl(target) {
    const byAttr = SHD.dom.deepQuery(target, C.NATIVE.reply);
    if (byAttr && ownerComment(byAttr) === target) return byAttr;
    const owned = (b) => ownerComment(b) === target && C.NATIVE.replyText.test((b.textContent || '').trim());
    const scan = (root, depth) => {
      if (!root || depth > 8 || typeof root.querySelectorAll !== 'function') return null;
      for (const b of root.querySelectorAll('button')) if (owned(b)) return b;
      if (root.shadowRoot) { const hit = scan(root.shadowRoot, depth + 1); if (hit) return hit; }
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && ownerComment(el) === target) {
          const hit = scan(el.shadowRoot, depth + 1); if (hit) return hit;
        }
      }
      return null;
    };
    return scan(target, 0);
  }

  /**
   * How many comments exist under the target — the measurement that says "it posted".
   *
   * COUNTED NARROWLY, because a wider count is not a measurement of OUR action. A reply is
   * scoped to its own branch already; a top-level comment has no branch, so the post path
   * counted the whole document — and on a comments page the paginator is auto-loading
   * further batches of `shreddit-comment` on a 2s heartbeat, inside the same 8s window.
   * Any batch landing there read as "your comment arrived", and the form closed on it,
   * taking the reader's draft with it while Reddit still held unposted text.
   *
   * This is the rule log 773 already wrote for the `N more replies` control — "page-wide
   * would credit the paginator's arrivals to our click" — reaching the one path that had
   * not been narrowed. Where the session knows who the reader is, the count is theirs
   * alone; where it does not, the old page-wide count stands rather than a guess.
   */
  function commentsUnder(target, kind) {
    /* The reader's OWN comments, on both paths now, where the session knows who they are.
       The comment path counted everything under the target, which let a paginator batch or
       another reader's reply stand in for ours; the post path was already narrowed for
       exactly that reason (log 773's rule) and the two had drifted. Where the name is not
       known the wider count stands, as before, rather than a guess. */
    const me = SHD.session.username && SHD.session.username();
    const mine = (n) => !me || (n.getAttribute(C.COMMENT_ATTR.author) || '') === me;
    const pool = kind === 'comment'
      ? [...target.querySelectorAll(C.COMMENT)]
      : [...document.querySelectorAll(C.COMMENT)];
    return pool.filter(mine).length;
  }

  /**
   * Put text into Reddit's editor so that Reddit's editor knows about it. A textarea is a
   * value and an input event. A contenteditable is fed through the browser's own editing
   * command first, because that is what produces the beforeinput/input sequence a
   * rich-text editor listens for; if the command is unavailable or the text did not land,
   * the node's text is set directly and an input event dispatched — the honest fallback,
   * and the one whose result is checked before anything is submitted.
   */
  /**
   * DID IT LAND, AND DID IT STAY? The second half is not pedantry.
   *
   * A rich-text editor owns its DOM and reconciles it against its own model. Writing
   * `textContent` into one puts the words on screen for a moment and then the editor
   * removes them again — measured on a live thread, where two <p> nodes appeared in
   * Reddit's editor and were gone by the next frame. The old check read `textContent`
   * SYNCHRONOUSLY, one line after writing it, which is inside that moment: it returned
   * true for text that no longer existed by the time anything used the answer.
   *
   * What that bought was the worst outcome available here. compose() takes a true from
   * insertText() as permission to press Reddit's submit — so a false positive posts an
   * EMPTY comment under the reader's name, and the draft they typed goes nowhere. Every
   * other failure in this file leaves the reader's words in our form and says so; this one
   * would have spent their comment on nothing.
   *
   * So the answer is given a turn of the event loop to be wrong in. The editor's own
   * reconciliation is a microtask or a frame away; anything that survives this is text the
   * editor has accepted rather than text that is briefly in its DOM.
   */
  /**
   * WHITESPACE IS NOT PART OF THE COMPARISON, and the reason is structural, not cosmetic.
   * A rich editor renders a paragraph break as a second <p>, not as a newline character —
   * so an editor holding a two-paragraph draft perfectly has a textContent with no "\n" in
   * it at all, and a substring test against the raw draft can never match. Measured live:
   * every multi-line draft was reported as not landing, however well it had landed, which
   * sent the chain into the handoff and wrote the text a SECOND time.
   *
   * ALL whitespace goes, not just runs of it, and that is the part collapsing gets wrong:
   * two adjacent <p> nodes concatenate in textContent with NO separator between them —
   * `<p>reply.</p><p>Second</p>` reads "reply.Second" — so the draft's space at the
   * paragraph break has no counterpart on the editor's side to normalise to. What is left
   * once whitespace is gone is the characters the reader typed, in the order they typed
   * them, which is the only thing "the words are there" ever meant.
   */
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  const holds = (editor, text) => norm(editor.textContent).includes(norm(text));

  async function landed(editor, text) {
    if (!holds(editor, text)) return false;
    await new Promise(r => setTimeout(r, timings.reconcileMs));
    return holds(editor, text);
  }

  /**
   * Is this element something the reader could see? Null-safe, and returns the element so
   * it can sit directly inside a waitFor().
   *
   * Layout is the honest answer — a display:none ancestor anywhere, through any shadow
   * root, zeroes the client rects — and it is not defeated by our own suppression, which
   * hides the native tree with visibility and opacity rather than by removing its boxes.
   * jsdom does no layout at all, so every element reads as unseen there; on a page with no
   * layout engine the `hidden` attribute is the fallback, which is exactly what the
   * fixtures model and nothing a live page relies on.
   */
  const layoutless = () => !document.body || document.body.getClientRects().length === 0;
  function shown(el) {
    if (!el || !el.isConnected) return null;
    if (layoutless()) return el.closest?.('[hidden]') ? null : el;
    return el.getClientRects().length > 0 ? el : null;
  }

  /**
   * Open a collapsed composer the way the live page accepts: focus, not a click.
   * Measured on the top-level "Join the conversation" box — the trigger's own click does
   * nothing and a full synthetic pointer sequence did nothing (log 111), but focusing the
   * textarea inside the trigger's shadow root expands it in ~300ms, and the host exposes a
   * focus() of its own. Both are tried; neither is trusted, which is why the caller then
   * WAITS for a visible submit control rather than assuming. A composer that is already
   * open has no visible trigger and this is a no-op.
   */
  function openComposer(host) {
    const trigger = shown(SHD.dom.deepQuery(host, C.COMPOSER.trigger));
    if (!trigger) return false;
    try { trigger.shadowRoot?.querySelector('textarea')?.focus(); } catch { /* best effort */ }
    try { if (typeof host.focus === 'function') host.focus(); } catch { /* best effort */ }
    return true;
  }

  /** The focused element THROUGH shadow roots — activeElement stops at each host. */
  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  async function insertText(editor, text) {
    try {
      if (typeof editor.focus === 'function') editor.focus();
      const tag = editor.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        /* No reconciliation to outlive: a form control's value is the model, so what we
           wrote is what is there. Checked immediately and synchronously, as before. */
        editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return editor.value === text;
      }
      /* NEVER BLIND. execCommand('insertText') writes wherever the caret is, and the
         focus() call above is a request rather than a guarantee — Reddit's editor did not
         take it. Measured live, twice: the reader's OWN draft box went from 478 to 956
         characters, then 375 to 750, exactly doubled, because the caret was still in
         .shd-reply-text when the command fired. That is not a failed insert; it is the
         extension corrupting the one copy of the text the reader was relying on. So the
         command runs only when the editor is verifiably the focused element, through any
         shadow root it sits in, and otherwise the write goes straight to the fallback,
         which addresses the editor by reference and cannot land anywhere else. */
      let done = false;
      if (deepActive() === editor && typeof document.execCommand === 'function') {
        /* ONE PARAGRAPH AT A TIME. execCommand('insertText') hands the editor a run of
           characters, and a newline inside that run is not a paragraph to a rich editor —
           measured live, a two-paragraph draft went in as one. 'insertParagraph' through
           execCommand is swallowed too; what the editor honours is the `beforeinput` a real
           Enter produces. So the draft is split where the reader left a blank line, each
           piece is typed, and between pieces the editor is told a paragraph ended the way
           the keyboard would tell it. */
        try {
          done = true;
          text.split(/\n\s*\n/).forEach((para, i) => {
            if (i && typeof InputEvent === 'function') {
              editor.dispatchEvent(new InputEvent('beforeinput',
                { inputType: 'insertParagraph', bubbles: true, cancelable: true }));
            }
            if (para && document.execCommand('insertText', false, para) !== true) done = false;
          });
        } catch { done = false; }
      }
      /* The honest fallback, kept for a PLAIN contenteditable, where setting text is the
         whole of what an editor is. Against a rich editor it is a no-op that looks like a
         success for a moment — which is exactly what landed() is now there to catch, and
         why the fallback no longer needs to know which kind it is talking to. */
      if (!done || !holds(editor, text)) {
        editor.textContent = text;
        const ev = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
          : new Event('input', { bubbles: true });
        editor.dispatchEvent(ev);
      }
      return await landed(editor, text);
    } catch { return false; }
  }

  /**
   * The protocol. Returns { ok, step, host }: `step` names the first thing that could
   * not be found or did not happen, `host` is the composer to reveal on the way out.
   */
  async function compose(target, text, kind) {
    let host = findHost(target, kind);
    if (!host) {
      if (kind !== 'comment') return { ok: false, step: 'composer', host: null };
      /* `Reply` shares the lazily-hydrated action row with the vote buttons, so it misses
         for the same reason and takes the same answer: bring the native comment into the
         suppressed tree's box and look again. This is the step that used to fail on a real
         thread and send the reader to Reddit's own page with an empty box. */
      const btn = replyControl(target) || await resolveLate(target, () => replyControl(target));
      if (!btn) return { ok: false, step: 'reply-control', host: null };
      // Snapshotted after the wait, so a host that appeared during hydration is not
      // mistaken for one that was already open before we asked for anything.
      const before = hostsNow();
      btn.click();
      host = await waitFor(() => findHost(target, kind, before) || findHost(target, kind), timings.composeWaitMs);
      if (!host) return { ok: false, step: 'composer', host: null };
    }
    /* A COMPOSER THAT HAS NOT OPENED IS NOT A COMPOSER, and from a selector's side of the
       glass it looks exactly like one.
       Reddit ships the top-level composer COLLAPSED — a "Join the conversation" box whose
       rich editor has not been mounted. The dormant `[contenteditable]` inside it still
       matches C.COMPOSER.editor, so the editor lookup below used to succeed, and every
       failure was then attributed to `insert`: the one step that had in fact done nothing
       wrong got the blame, while the step that had actually failed reported success.
       Measured on a live thread; the reader saw "could not put the text into Reddit's
       reply box" for a box that was never open.
       The submit control is the discriminator, and a measured one: a collapsed composer
       has none, and one opened by a real click has both. Asked here, BEFORE the editor, so
       `composer` is what a collapsed box reports — which is also the step whose fallback is
       the right one, since there is nothing to type into. */
    /* AND OPEN MEANS VISIBLE, NOT PRESENT. The paragraph above was written on a
       measurement in which a collapsed box had no submit control at all. Measured again a
       week later, it has one — hidden, enabled, inside a hidden faceplate-form beside a
       hidden editor — so the presence test passed on a closed box and the insert went into
       an editor with no model (log 113). What a collapsed box shows instead is its
       trigger, and what opens it is focus on the textarea in the trigger's shadow root.
       So: if the trigger is the visible thing, open it; then wait for a submit control the
       reader could see, which is the one discriminator the markup has not moved under. */
    openComposer(host);
    const opened = await waitFor(
      () => shown(SHD.dom.deepQuery(host, C.COMPOSER.submit)), timings.composeWaitMs);
    if (!opened) return { ok: false, step: 'composer', host };
    const editor = await waitFor(
      () => shown(SHD.dom.deepQuery(host, C.COMPOSER.editor)), timings.composeWaitMs);
    if (!editor) return { ok: false, step: 'editor', host };
    if (!await insertText(editor, text)) return { ok: false, step: 'insert', host };
    // Re-resolved rather than reusing `opened`: an editor that has just taken its first
    // text is exactly when a composer swaps a disabled button for a live one.
    const submit = SHD.dom.deepQuery(host, C.COMPOSER.submit) || opened;
    const count = commentsUnder(target, kind);
    submit.click();
    /* ONLY A COMMENT THAT APPEARED COUNTS AS POSTED. Nothing weaker.
       This used to accept two other signals as well — the composer disappearing, or the
       editor reading empty — on the reasoning that both are what Reddit does once a post
       succeeds. They are. They are also exactly what an editor looks like when the insert
       never took: measured live, a single-line draft passed landed(), submit was pressed
       on an editor Reddit had no model for, Reddit posted nothing, and the editor then
       read empty BECAUSE nothing had ever been accepted into it. That emptiness was taken
       as arrival. The form closed on it and the draft went with it — the one failure this
       file promises never to produce, reached by way of the check meant to prevent it.
       An editor that was never filled is indistinguishable from one Reddit cleared after
       a successful post, so neither can carry the arrival signal. The count of the
       reader's own comments under the target can, and a slow post that misses this window
       goes the safe way: `arrival`, reveal-only, draft kept, and a sentence saying to check
       the thread before sending it again. */
    const arrived = await waitFor(() => commentsUnder(target, kind) > count, timings.arriveWaitMs);
    return arrived ? { ok: true, step: 'done', host } : { ok: false, step: 'arrival', host };
  }

  /**
   * The handoff, after compose() has missed. Reveals Reddit's own UI and CARRIES THE
   * DRAFT INTO IT, which is the difference between a fallback and a dead end.
   *
   * Reported from a signed-in session: `save` on a real thread failed at `reply-control`,
   * the layout swapped to Reddit's comment, and its composer opened EMPTY — the reader
   * retyped their reply there. Our form kept the draft and said so, but passthrough hides
   * #shd-root, so both the text and the sentence promising it were on the side of the page
   * the reader had just been taken off. A message nobody can read is not a fallback.
   *
   * Why re-running the chain can work when the first attempt did not. The control this
   * misses on is usually `Reply`, inside the lazily-hydrated
   * <shreddit-comment-action-row>; compose() already scrolls the native comment into the
   * suppressed tree's box and waits for that row, so by the time anything reaches here the
   * cheap answer has been tried. passthrough() is the expensive one: it takes the body
   * child out of suppression altogether — full size, in flow, visible, hit-testable — which
   * is a different set of conditions from a clipped fixed box, and a row Reddit declined
   * to mount in the second can still mount in the first. It is also the only version of
   * this that puts the reader in front of Reddit's own UI, which is the actual promise:
   * finish the reply somewhere, with your words already in the box.
   *
   * Never the submit: this hands the reader Reddit's box with their words in it and stops.
   * Posting stays a deliberate press of Reddit's own button.
   */
  async function handoff(target, kind, text, r) {
    const reveal = r.host || (kind === 'comment' ? target : document.querySelector(C.MAIN));
    if (!reveal || !SHD.dom.passthrough(reveal)) return false;
    reveal.scrollIntoView?.({ block: 'center' });
    /* A null `text` means REVEAL ONLY: show the reader Reddit's own page and open
       nothing. That is the `arrival` caller, where the submit has already fired and a
       pre-filled composer would be an invitation to post the same comment a second time.
       Returning false is accurate — nothing was carried — and the caller says so in the
       words that case needs rather than the generic ones. */
    if (text == null) return false;
    let host = r.host;
    if (!host && kind === 'comment') {
      const btn = await waitFor(() => replyControl(target), timings.composeWaitMs);
      if (!btn) return false;
      btn.click();
    }
    host = host || await waitFor(() => findHost(target, kind), timings.composeWaitMs);
    if (!host) return false;
    /* The same gate compose() applies, because the same closed box reaches here: a reader
       handed an unopened composer with their draft "in" it has been handed nothing. Try to
       open it the one way that works, and carry the text only into an editor they can see —
       otherwise the exit-bar sentence about clicking it once is the accurate one. */
    openComposer(host);
    const editor = await waitFor(
      () => shown(SHD.dom.deepQuery(host, C.COMPOSER.editor)), timings.composeWaitMs);
    if (!editor) return false;
    /* ALREADY THERE IS ALREADY CARRIED. compose() may have put the words into this very
       editor and then misjudged its own work — the multi-line case did exactly that, and
       this call wrote the draft a second time into a box that already held it, run
       together with no break between. Whatever insertText() concluded, the editor's
       contents are the fact; if the words are in it, the handoff's job is done. */
    if (holds(editor, text)) return true;
    return await insertText(editor, text);
  }

  const STEP_COPY = {
    'reply-control': 'could not find Reddit\'s reply button for this comment',
    composer: 'could not get Reddit to open its reply box',
    editor: 'could not find the text field in Reddit\'s reply box',
    insert: 'could not put the text into Reddit\'s reply box',
    submit: 'could not find Reddit\'s submit button',
    arrival: 'no reply appeared — it may still be posting'
  };

  /**
   * WHAT TO DO ABOUT IT, for a reader now looking at Reddit's own page.
   *
   * Separate from STEP_COPY because on this side of a handoff the diagnosis is the less
   * useful half of the sentence. The reader does not need to know which selector missed;
   * they need the next action, and for the commonest failure there is a good one.
   *
   * THE SECOND ATTEMPT WORKS, and that is a measurement rather than a hope. Reddit mounts
   * its rich editor only on a real user gesture — tested from a live thread, where
   * host.click() and a full synthetic pointer sequence both produced nothing at all, and a
   * genuine click produced a working editor immediately. Our own click cannot be trusted
   * and never will be. But the reader's can: once THEY have opened the box, the composer
   * stays open, so coming back and pressing save again finds a live editor and the whole
   * chain completes. So the instruction is two clicks, not "retype it".
   */
  const HANDOFF_COPY = {
    composer: 'Reddit only opens its reply box when you click it yourself — click it once, ' +
              'then press “← back to sheddit” and save again',
    editor: 'Reddit only opens its reply box when you click it yourself — click it once, ' +
            'then press “← back to sheddit” and save again'
  };

  /**
   * Old reddit's reply box: a textarea, `save` and `cancel`, a status line. `target` is
   * the native element the reply belongs to (the hidden <shreddit-comment>, or the post
   * for a top-level comment). On save the text goes through compose(); on success the
   * form goes away and the pipeline renders the comment Reddit inserted, nested where
   * Reddit put it. On any miss the form STAYS, draft intact, the status says which step
   * failed, and Reddit's own composer is revealed in place so the reader can finish there.
   */
  /**
   * Our own text surfaces. Not a Reddit contract — these are our classes, which is why
   * they are here and not in contracts.js.
   */
  const OWN_TEXT = '.shd-reply-text, #shd-root textarea, #shd-root input';

  /**
   * Keep Reddit's keyboard shortcuts out of our own text boxes.
   *
   * Reported from a signed-in session, and it did real damage: typing into the reply box
   * inserted nothing, while every keystroke reached Reddit as a HOTKEY instead. `h` hid
   * the post being replied to, and one keystroke navigated to the submit page and took
   * the draft with it. Reddit's own composer on the same page typed fine, so this is
   * ours: Reddit's handler decides whether a key came from something editable, our box
   * is not something it recognises, and it treats the key as a shortcut.
   *
   * The characters never landed because that handler calls preventDefault(), and text
   * insertion is keydown's DEFAULT ACTION. So the fix is to stop the event reaching it —
   * and emphatically NOT to preventDefault ourselves, which would suppress the very
   * typing this restores.
   *
   * ON WINDOW, IN CAPTURE, which is the only placement that works whichever way Reddit
   * listens. Capture runs outermost node first, so a window-capture listener precedes a
   * document-level listener in both phases no matter which script registered first —
   * and registration order is not ours to win, because Reddit's bundle runs long before
   * a document_idle content script. Propagation belongs to the DOM node rather than to
   * the JavaScript realm, so stopping it here stops the page's own listeners too.
   *
   * Scoped to our surfaces. Everything outside them is Reddit's business, hotkeys
   * included — a guard that swallowed keys page-wide would be a worse bug than this one.
   */
  let keysGuarded = false;
  function guardOwnKeys() {
    if (keysGuarded) return;
    keysGuarded = true;
    const stop = (e) => {
      try { if (e.target?.closest?.(OWN_TEXT)) e.stopPropagation(); }
      catch { /* a guard must never be the thing that breaks typing */ }
    };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(type, stop, true);
    }
  }

  function replyForm(m, { kind = 'comment', onClose } = {}) {
    guardOwnKeys();
    const ta = h('textarea.shd-reply-text', { rows: '6', 'aria-label': kind === 'post' ? 'comment' : 'reply' });
    const status = h('span.shd-reply-status', { role: 'status', 'aria-live': 'polite' });
    const save = h('button.shd-reply-save', { type: 'submit', text: 'save' });
    const cancel = h('button.shd-reply-cancel', { type: 'button', text: 'cancel', onclick: () => close() });
    const form = h('form.usertext.shd-reply-form', { dataset: { shdKind: kind } }, [
      h('div.usertext-edit', null, [
        ta,
        h('div.bottom-area', null, [
          status,
          h('div.usertext-buttons', null, [save, cancel])
        ])
      ])
    ]);
    const close = () => { form.remove(); if (onClose) onClose(); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) { status.textContent = 'nothing to save'; return; }
      save.disabled = true;
      status.textContent = 'submitting…';
      form.dataset.shdState = 'submitting';
      let r;
      try { r = await compose(m.source, text, kind); }
      catch (err) { r = { ok: false, step: 'insert', host: null, err }; }
      if (!form.isConnected) return;               // a route change took the page with it
      if (r.ok) { form.dataset.shdState = 'done'; close(); return; }
      save.disabled = false;
      form.dataset.shdState = 'failed';
      form.dataset.shdStep = r.step;
      /* ARRIVAL IS THE ONE STEP ON THE FAR SIDE OF THE SUBMIT, AND IT GETS ITS OWN EXIT.
         Every other miss here happens BEFORE `submit.click()` — no request was made, so
         carrying the draft into Reddit's box and inviting a press is exactly right.
         `arrival` means the button WAS pressed and the reply did not show up inside
         arriveWaitMs, which is as consistent with a slow post as with a failed one. Doing
         the ordinary handoff there pre-fills Reddit's composer with the same text and
         tells the reader to press reply — so a comment that posted slowly gets posted
         twice, by our own instruction.

         So: reveal Reddit's own page, because checking the thread is the next thing the
         reader needs to do, and carry NOTHING into it. The draft stays in our form, where
         re-sending it is a deliberate act rather than the path of least resistance. */
      const posted = r.step === 'arrival';
      status.textContent = posted
        ? 'sheddit did not see your reply appear — opening Reddit\'s own page so you can check'
        : `sheddit ${STEP_COPY[r.step] || 'could not post this'} — opening Reddit's own reply box`;
      let carried = false;
      try { carried = await handoff(m.source, kind, posted ? null : text, r); }
      catch { carried = false; }
      if (!form.isConnected) return;
      form.dataset.shdCarried = carried ? 'yes' : 'no';
      const said = posted
        ? 'sheddit did not see your reply appear, and it may already have posted — check the thread before sending it again. Your text is still here, behind “← back to sheddit”.'
        : carried
          ? `sheddit ${STEP_COPY[r.step] || 'could not post this'} — your text is in Reddit's reply box; press its own reply button to post it`
          : `sheddit ${STEP_COPY[r.step] || 'could not post this'} — ${
              HANDOFF_COPY[r.step] || 'your text is still here, behind “← back to sheddit”'}`;
      status.textContent = said;
      /* AND ON THE SIDE OF THE PAGE THE READER IS NOW LOOKING AT. The line above is inside
         #shd-root, which the handoff has just hidden — so on its own it is an explanation
         delivered to nobody, including the one that says "your text is still here". The
         exit bar is the only surface of ours that survives a passthrough. */
      SHD.dom.passthroughNote(said);
    });
    return form;
  }

  /**
   * The `reply` link's behaviour. Logged out (or with the layer off) it is 0.33.0's
   * handoff: passthrough to Reddit's own comment. Logged in it opens our form under the
   * comment's entry, once — a second click focuses the one that is open.
   */
  function reply(m, thing) {
    if (!active()) {
      if (SHD.dom.passthrough(m.source)) m.source.scrollIntoView?.({ block: 'center' });
      return;
    }
    const entry = thing.querySelector(':scope > .entry') || thing;
    const open = entry.querySelector(':scope > .shd-reply-form');
    if (open) { open.querySelector('textarea')?.focus(); return; }
    const form = replyForm(m, { kind: 'comment' });
    entry.appendChild(form);
    form.querySelector('textarea')?.focus();
  }

  /** The top-level comment box on a comments page — old reddit had one above the list. */
  function commentBox(m) {
    if (!active()) return null;
    return h('div.shd-commentbox', null, replyForm(m, { kind: 'post' }));
  }

  /* ------------------------------------------------------------------ *
   * Post — the two doors to Reddit's composer
   * ------------------------------------------------------------------ */

  /**
   * Old reddit's sidebar buttons: "Submit a new link" / "Submit a new text post". Real
   * links onto Reddit's own composer route, which Sheddit never renders (route.js → OTHER)
   * and which therefore works exactly as Reddit built it. Posting is the one of the three
   * that is NOT delegated in place: the composer is a whole page with its own rules
   * (flair, media, crossposts, community rules), and reimplementing it is precisely the
   * work CONTRIBUTING says not to do.
   */
  function submitBox(sub) {
    if (!active()) return null;
    const base = sub ? `/r/${sub}/${C.SUBMIT.path}/` : `/${C.SUBMIT.path}/`;
    return h('div.sidebox.submit.shd-submit', null, [
      h('a.morelink.shd-submit-link', { href: `${base}?type=${C.SUBMIT.types.link}`, text: 'Submit a new link' }),
      h('a.morelink.shd-submit-text', { href: `${base}?type=${C.SUBMIT.types.text}`, text: 'Submit a new text post' })
    ]);
  }

  /* ------------------------------------------------------------------ *
   * The account corner
   * ------------------------------------------------------------------ */

  /* The one navigation this module performs, behind an indirection so the suite can watch
     it happen. jsdom implements no navigation, so a real `location.reload()` in a test is
     reported as an unimplemented feature rather than as the outcome it is — and "did the
     reader actually get logged out" is exactly the assertion worth having. Nothing in the
     extension replaces this. */
  const nav = { reload: () => location.reload() };

  /* The open menu, so a route change can close it — chrome.reset() removes the header, but
     the document-level listeners below would outlive it. */
  let openMenu = null;
  /* Raised while logOut() is pressing Reddit's own controls, so the corner does not read
     our own programmatic click as the reader clicking away from it. */
  let driving = false;

  function closeMenu() {
    if (!openMenu) return;
    const { menu, toggle, onDocClick, onKey } = openMenu;
    openMenu = null;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  const item = (child) => h('li.shd-account-item', { role: 'none' }, child);
  const menuLink = (href, text, title) =>
    item(h('a', { href, text, title, role: 'menuitem' }));

  /**
   * The menu's contents, built ON OPEN rather than at render time.
   *
   * Deliberate: the reader's name may not have resolved when the header was drawn — the
   * header hydrates late, and the drawer that carries the profile link later still — and
   * the two items that need a name are worth having whenever it turns up. Everything that
   * does not need one is always here, which is what makes `log out` reachable on a session
   * whose username Sheddit never managed to read.
   *
   * The links are ordinary hrefs onto Reddit's own pages: the profile is one Sheddit
   * renders itself, the rest are routes it hands back untouched. Nothing here is delegated
   * except the last item.
   */
  function fillMenu(menu, status) {
    const name = SHD.session.username();
    const kids = [];
    if (name) {
      kids.push(menuLink(`/user/${name}/`, 'my profile'));
      kids.push(menuLink(`/user/${name}/${C.ACCOUNT.savedTab}/`, 'saved'));
    }
    kids.push(menuLink(C.ACCOUNT.inbox, 'messages'));
    kids.push(menuLink(C.ACCOUNT.settings, 'preferences'));
    kids.push(item(h('button.shd-account-logout', {
      type: 'button', role: 'menuitem',
      text: 'log out',
      title: 'Ends your Reddit session by pressing Reddit\'s own log-out control.',
      onclick: (e) => { e.preventDefault(); logOut(e.currentTarget, status); }
    })));
    kids.push(item(status));
    menu.replaceChildren(...kids);
  }

  /* ---------------- log out ---------------- */

  /* Where Reddit's drawer content can be: inside the header, or portaled beside it. Both
     are searched, because a panel that is a SIBLING of the header is what the upsell
     taught us to expect (C.NATIVE_UPSELL). */
  function drawerRoots() {
    const roots = [];
    const header = document.querySelector(C.HEADER);
    if (header) roots.push(header);
    document.querySelectorAll(C.USER_DRAWER.host).forEach(el => roots.push(el));
    return roots;
  }

  /**
   * Reddit's own log-out control, or null.
   *
   * The attribute clauses first. The text fallback then follows the AGE GATE's rule rather
   * than the reply control's: it clicks only when EXACTLY ONE control in the drawer says
   * exactly "log out". A reply button matched loosely costs a mis-click; a log-out button
   * matched loosely ends the reader's session on something that merely mentions the words,
   * and there is no undo for that short of signing back in.
   */
  /**
   * Reddit's drawer PANEL — the thing that holds the log-out control — and never the
   * avatar button that opens it.
   *
   * `C.USER_DRAWER.host` leads with `[id*="user-drawer" i]`, and the toggle's own id is
   * `#expand-user-drawer-button`, which contains that string. querySelector returns the
   * first match in DOCUMENT ORDER and the button is in the header, above where the panel
   * mounts — so the "reveal Reddit's drawer" fallback was handing passthrough() the
   * BUTTON. passthrough() then walks the corridor to it and display:none's every sibling
   * on the way, which is where the panel it had just opened sits: a blanked page showing
   * one avatar button, with the log-out control hidden by our own class. The opposite of
   * what the fallback promises.
   */
  /**
   * The drawer's panel, for the reveal fallback — never the toggle, and never anything
   * INSIDE the toggle either.
   *
   * The second exclusion is the fix for a measured miss. `host` leads with a loose
   * `[id*="user-drawer"]`, which matches faceplate-partial#user-drawer-avatar-logged-in —
   * the avatar, sitting inside the toggle button and earlier in document order than the
   * panel. Revealing it corridored passthrough() down to the avatar and display:none'd
   * every sibling on the way, #user-drawer-content included: a dark page, the avatar alone
   * at top-left, and Reddit's drawer nowhere. The named panel is asked for first so the
   * loose clause only ever decides when the named one is absent.
   */
  function drawerPanel() {
    const toggle = document.querySelector(C.USER_DRAWER.toggle);
    const usable = (el) => !!el && el !== toggle &&
      !(toggle && (el.contains(toggle) || toggle.contains(el)));
    /* Two lookups, not one selector list. querySelectorAll('#named, [loose]') returns
       DOCUMENT order whatever order the clauses are written in, so a combined query would
       hand back the avatar partial first regardless — the named panel is only "first" if
       it is asked for on its own. The exclusion above is what carries the case where the
       named panel is absent altogether. */
    const named = document.querySelector(C.USER_DRAWER.content);
    if (usable(named)) return named;
    return [...document.querySelectorAll(C.USER_DRAWER.host)].find(usable) || null;
  }

  function findLogoutControl() {
    for (const root of drawerRoots()) {
      const byAttr = SHD.dom.deepQuery(root, C.NATIVE.logout);
      if (byAttr) return byAttr;
    }
    const exact = [];
    const scan = (root, depth) => {
      if (!root || depth > 8 || typeof root.querySelectorAll !== 'function') return;
      for (const el of root.querySelectorAll(C.NATIVE.logoutScan)) {
        if (C.NATIVE.logoutText.test((el.textContent || '').trim())) exact.push(el);
      }
      if (root.shadowRoot) scan(root.shadowRoot, depth + 1);
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) scan(el.shadowRoot, depth + 1);
    };
    drawerRoots().forEach(r => scan(r, 0));
    // Deduplicate: an element inside a drawer that is itself inside the header is reached twice.
    const unique = [...new Set(exact)];
    return unique.length === 1 ? unique[0] : null;
  }

  /**
   * End the session by pressing Reddit's own control — the delegation tier, applied to the
   * one action a reader most wants back (reported 2026-09-09).
   *
   * Sheddit does not build a logout request. It cannot: that is a POST carrying Reddit's
   * own CSRF token, and forging one would be the first request this extension ever made.
   * So it does what the reader would do — open Reddit's user drawer and click the item in
   * it — and lets Reddit's code end the session.
   *
   * On success the page is RELOADED rather than re-rendered in place. Reddit usually
   * navigates itself, in which case this never runs; when it does not, every part of the
   * layer downstream (arrows, reply boxes, this corner) decided what to draw from a session
   * that no longer exists, and a reload is the one cheap way to make the whole page agree.
   * The reader has just ended their session, so a lost scroll position is the least of it.
   *
   * Every miss lands in the same place as the reply box's: reveal Reddit's own drawer in
   * place, so the control is one visible click away rather than a dead end.
   */
  async function logOut(button, status) {
    const say = (text) => { if (status) status.textContent = text; };
    if (button) button.disabled = true;
    say('logging out…');
    /* OUR OWN MENU MUST SURVIVE THIS, and nothing else here can keep it open. The corner
       closes on any click outside it, captured on document — and the first thing this
       function does is click Reddit's avatar button, which bubbles there and reads as
       exactly such a click. The menu was therefore hidden before the reader's press even
       returned, so `logging out…` and every miss message below were written into a hidden
       subtree: invisible, and unannounced too, because `role="status" aria-live="polite"`
       does not fire from a hidden container. "A message nobody can read is not a fallback"
       is this file's own rule, written for replies (line 354) and broken here.

       It also re-armed the press it was meant to guard: re-opening the corner rebuilds the
       menu with a fresh ENABLED `log out`, so a second run could start while the first was
       still waiting — clicking Reddit's toggle again and closing the very panel the first
       one was watching for. */
    driving = true;
    try {
      let ctl = findLogoutControl();
      if (!ctl) {
        const toggle = document.querySelector(C.USER_DRAWER.toggle);
        if (toggle) {
          toggle.click();                       // Reddit opens its own drawer
          ctl = await waitFor(() => findLogoutControl(), timings.drawerWaitMs);
        }
      }
      if (!ctl) {
        if (button) button.disabled = false;
        say('could not find Reddit\'s log-out control — its own menu is shown instead');
        const panel = drawerPanel() || document.querySelector(C.HEADER);
        if (panel && SHD.dom.passthrough(panel)) panel.scrollIntoView?.({ block: 'center' });
        return false;
      }
      ctl.click();
      /* Measured, not assumed — the lesson every delegated action here carries. The session
         is gone when the page stops carrying a logged-in signal; reset() first, or the
         cached YES from a moment ago answers for it. */
      const gone = await waitFor(() => { SHD.session.reset(); return !SHD.session.loggedIn(); },
                                 timings.logoutWaitMs);
      if (gone) { nav.reload(); return true; }
      if (button) button.disabled = false;
      say('Reddit did not end the session — its own menu is shown instead');
      const panel = drawerPanel() || document.querySelector(C.HEADER);
      if (panel && SHD.dom.passthrough(panel)) panel.scrollIntoView?.({ block: 'center' });
      return false;
    } catch (err) {
      if (button) button.disabled = false;
      say('log out failed');
      return false;
    } finally {
      driving = false;
    }
  }

  /* ---------------- the corner itself ---------------- */

  /**
   * Old reddit's `#header-bottom-right`, at the far right of the header, and the answer to
   * "does this thing know I am logged in?".
   *
   * SIGNED IN it is a button — the avatar and the name are the control, not decoration,
   * which is the correction reported on 2026-09-09: only `preferences` had been clickable,
   * so the part of the corner that names you did nothing. It opens a menu of Reddit's own
   * account destinations, ending in `log out`.
   *
   * SIGNED OUT it is one grey word, `logged out`, linking to Reddit's login page. That is
   * an owner decision of the same date and a reversal of the old blanket rule against
   * login affordances; the rule was written against Reddit's unremovable interstitial, and
   * a reader who keeps an account being told where the door is, once, in the corner where
   * a door has always been, is not that. It answers the same question in the negative,
   * which is the whole reason the corner exists.
   *
   * Absent entirely when the reader turns the account layer off — the one setting that
   * says "behave as though I had no account at all".
   */
  function headerAccount() {
    if (!SHD.settings?.account) return null;
    return SHD.session.loggedIn() ? signedInCorner() : signedOutCorner();
  }

  function signedOutCorner() {
    return h('span.shd-account.shd-account-signedout', null,
      h('a.shd-account-login', {
        href: C.ACCOUNT.login,
        text: 'logged out',
        title: 'Sheddit sees no Reddit session on this page. Opens Reddit\'s own login page.'
      }));
  }

  function signedInCorner() {
    const name = SHD.session.username();
    const avatar = SHD.session.avatar();
    const status = h('span.shd-account-status', { role: 'status', 'aria-live': 'polite' });
    const menu = h('ul.shd-account-menu', { role: 'menu', hidden: true });
    const toggle = h('button.shd-account-toggle', {
      type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false',
      title: name ? `Signed in as u/${name} — account menu`
                  : 'Sheddit can see a Reddit session but could not read your username. ' +
                    'Voting and replying are unaffected.'
    }, [
      avatar ? h('img.shd-account-avatar', { src: avatar, alt: '', loading: 'lazy' }) : null,
      h('span.shd-account-name' + (name ? '' : '.shd-account-unnamed'),
        { text: name ? `u/${name}` : 'logged in' }),
      h('span.shd-account-caret', { 'aria-hidden': 'true', text: '\u25be' })
    ]);

    const corner = h('span.shd-account', null, [toggle, menu]);

    /* ...except while logOut() is driving Reddit's own UI: the click it makes on the avatar
       button is an outside click by every test available here, and closing on it hides the
       status line the flow is still writing to. */
    const onDocClick = (e) => { if (!driving && !corner.contains(e.target)) closeMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); toggle.focus(); } };

    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      if (openMenu && openMenu.menu === menu) { closeMenu(); return; }
      closeMenu();
      status.textContent = '';
      fillMenu(menu, status);
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      openMenu = { menu, toggle, onDocClick, onKey };
      // Capture phase, so a click Reddit's own page handles still closes our menu first.
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKey, true);
    });

    return corner;
  }

  function reset() { missWarned = false; closeMenu(); }

  return { midcol, vote, reply, replyForm, commentBox, compose, submitBox, headerAccount,
           logOut, findLogoutControl, nav, reset, timings };
})();
