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
 * VOTING TRUSTS THE CONTROL, NOT THE DETECTOR
 * A click resolves the native button at click time (the action bar hydrates late, §1.3)
 * and forwards to it if it exists — whether or not session.js thinks the reader is logged
 * in. The button's presence IS the ground truth: Reddit renders it only for a session
 * that can use it. The detector decides only what a MISS means: logged in, warn once with
 * the evidence (the contract is stale, or the control moved into a closed root); logged
 * out, nothing to report — that is the documented state.
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
     arriveWaitMs: how long to wait for the posted comment to appear before calling the
             submit lost and revealing the native composer. */
  const timings = { syncMs: 1500, settleMs: 400, composeWaitMs: 4000, pollMs: 100, arriveWaitMs: 8000 };

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

  function vote(col, m, kind, dir) {
    const btns = nativeButtons(m.source);
    const native = dir === 1 ? btns.up : btns.down;
    if (!native) { reportMiss(dir === 1 ? 'upvote' : 'downvote', m); return; }
    learnInitial(col, m, kind, btns);
    native.click();
    // Optimistic, like old reddit: clicking the lit arrow un-votes, the other one flips.
    const before = Number(col.dataset.shdVote || 0);
    paint(col, m, kind, before === dir ? 0 : dir);
    // Then defer to the page, now and once more after it has had time to answer.
    setTimeout(() => col.isConnected && settle(col, m, kind, btns), 0);
    setTimeout(() => col.isConnected && settle(col, m, kind, btns), timings.settleMs);
  }

  /**
   * The vote column for a post row (arrows around the score) or a comment (arrows only —
   * old reddit puts a comment's score in its tagline). Clicks delegate; see the header.
   * On an active session the column also looks for the hydrated state once, after
   * render, so a post the reader already voted on comes up lit.
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
    const all = [...document.querySelectorAll(C.COMPOSER.host)];
    const mine = all.filter(el => !except.has(el) && (kind === 'comment'
      ? target.contains(el) && el.closest(C.COMMENT) === target
      : !el.closest(C.COMMENT)));
    return mine[0] || null;
  }

  const hostsNow = () => new Set(document.querySelectorAll(C.COMPOSER.host));

  /** How many comments exist under the target — the measurement that says "it posted". */
  function commentsUnder(target, kind) {
    return kind === 'comment'
      ? target.querySelectorAll(C.COMMENT).length
      : document.querySelectorAll(C.COMMENT).length;
  }

  /**
   * Put text into Reddit's editor so that Reddit's editor knows about it. A textarea is a
   * value and an input event. A contenteditable is fed through the browser's own editing
   * command first, because that is what produces the beforeinput/input sequence a
   * rich-text editor listens for; if the command is unavailable or the text did not land,
   * the node's text is set directly and an input event dispatched — the honest fallback,
   * and the one whose result is checked before anything is submitted.
   */
  function insertText(editor, text) {
    try {
      if (typeof editor.focus === 'function') editor.focus();
      const tag = editor.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return editor.value === text;
      }
      let done = false;
      try {
        done = typeof document.execCommand === 'function' &&
               document.execCommand('insertText', false, text) === true;
      } catch { done = false; }
      if (!done || !(editor.textContent || '').includes(text)) {
        editor.textContent = text;
        const ev = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
          : new Event('input', { bubbles: true });
        editor.dispatchEvent(ev);
      }
      return (editor.textContent || '').includes(text);
    } catch { return false; }
  }

  const editorEmpty = (ed) => !ed.isConnected ||
    (('value' in ed && (ed.tagName === 'TEXTAREA' || ed.tagName === 'INPUT')) ? ed.value === '' : (ed.textContent || '').trim() === '');

  /**
   * The protocol. Returns { ok, step, host }: `step` names the first thing that could
   * not be found or did not happen, `host` is the composer to reveal on the way out.
   */
  async function compose(target, text, kind) {
    let host = findHost(target, kind);
    if (!host) {
      if (kind !== 'comment') return { ok: false, step: 'composer', host: null };
      const before = hostsNow();
      const btn = SHD.dom.deepQuery(target, C.NATIVE.reply);
      if (!btn) return { ok: false, step: 'reply-control', host: null };
      btn.click();
      host = await waitFor(() => findHost(target, kind, before) || findHost(target, kind), timings.composeWaitMs);
      if (!host) return { ok: false, step: 'composer', host: null };
    }
    const editor = await waitFor(() => SHD.dom.deepQuery(host, C.COMPOSER.editor), timings.composeWaitMs);
    if (!editor) return { ok: false, step: 'editor', host };
    if (!insertText(editor, text)) return { ok: false, step: 'insert', host };
    const submit = SHD.dom.deepQuery(host, C.COMPOSER.submit);
    if (!submit) return { ok: false, step: 'submit', host };
    const count = commentsUnder(target, kind);
    submit.click();
    // Measured, not assumed: the reply is posted when a comment arrives under the target
    // (Reddit inserts its own optimistic copy), or the composer Reddit owns is gone or
    // cleared — which is what Reddit does to its editor once the request succeeds.
    const arrived = await waitFor(
      () => commentsUnder(target, kind) > count || !host.isConnected || editorEmpty(editor),
      timings.arriveWaitMs);
    return arrived ? { ok: true, step: 'done', host } : { ok: false, step: 'arrival', host };
  }

  const STEP_COPY = {
    'reply-control': 'could not find Reddit\'s reply button for this comment',
    composer: 'Reddit did not open its reply box',
    editor: 'could not find the text field in Reddit\'s reply box',
    insert: 'could not put the text into Reddit\'s reply box',
    submit: 'could not find Reddit\'s submit button',
    arrival: 'no reply appeared — it may still be posting'
  };

  /**
   * Old reddit's reply box: a textarea, `save` and `cancel`, a status line. `target` is
   * the native element the reply belongs to (the hidden <shreddit-comment>, or the post
   * for a top-level comment). On save the text goes through compose(); on success the
   * form goes away and the pipeline renders the comment Reddit inserted, nested where
   * Reddit put it. On any miss the form STAYS, draft intact, the status says which step
   * failed, and Reddit's own composer is revealed in place so the reader can finish there.
   */
  function replyForm(m, { kind = 'comment', onClose } = {}) {
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
      status.textContent = `sheddit ${STEP_COPY[r.step] || 'could not post this'} — Reddit\'s own reply box is shown instead; your text is kept here`;
      const reveal = r.host || (kind === 'comment' ? m.source : document.querySelector(C.MAIN));
      if (reveal && SHD.dom.passthrough(reveal)) reveal.scrollIntoView?.({ block: 'center' });
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

  /** The header's one word about it, so a reader can tell the layer is on without voting to find out. */
  function headerStatus() {
    if (!active()) return null;
    return h('span.shd-account-status', {
      text: 'logged in',
      title: 'Sheddit sees a logged-in Reddit session: vote arrows and reply boxes go through Reddit\'s own controls. Turn this off on the options page.'
    });
  }

  function reset() { missWarned = false; }

  return { midcol, vote, reply, replyForm, commentBox, compose, submitBox, headerStatus, reset, timings };
})();
