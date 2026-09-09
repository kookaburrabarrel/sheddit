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
  const timings = { syncMs: 1500, settleMs: 400, composeWaitMs: 4000, pollMs: 100, arriveWaitMs: 8000,
                    drawerWaitMs: 4000, logoutWaitMs: 6000 };

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
      const btn = replyControl(target);
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
   * Why re-running the chain works when the first attempt did not, and this is the whole
   * mechanism: suppress.css collapses the native body child to a 1x1 absolutely-positioned
   * box with `overflow: hidden` and `clip: rect(0 0 0 0)`, so every comment inside it has
   * no usable geometry and Reddit never hydrates the lazy <shreddit-comment-action-row>
   * that holds `Reply`. THE READER SCROLLS OUR ROWS, NEVER REDDIT'S — so "resolved at
   * click time, when the reader has necessarily scrolled it into view" was never true
   * inside this layout. passthrough() restores position/width/height/clip on that same
   * body child; the row hydrates against real geometry, and the control that was
   * unreachable a moment ago is reachable now. Same shape as the paginator's programmatic
   * partial, which also never fires while the native tree is hidden.
   *
   * Never the submit: this hands the reader Reddit's box with their words in it and stops.
   * Posting stays a deliberate press of Reddit's own button.
   */
  async function handoff(target, kind, text, r) {
    const reveal = r.host || (kind === 'comment' ? target : document.querySelector(C.MAIN));
    if (!reveal || !SHD.dom.passthrough(reveal)) return false;
    reveal.scrollIntoView?.({ block: 'center' });
    let host = r.host;
    if (!host && kind === 'comment') {
      const btn = await waitFor(() => replyControl(target), timings.composeWaitMs);
      if (!btn) return false;
      btn.click();
    }
    host = host || await waitFor(() => findHost(target, kind), timings.composeWaitMs);
    if (!host) return false;
    const editor = await waitFor(() => SHD.dom.deepQuery(host, C.COMPOSER.editor), timings.composeWaitMs);
    return !!editor && insertText(editor, text);
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
      /* Say what happened BEFORE the handoff, so the sentence is on screen if the reveal
         takes the layout with it, and correct it after with what actually happened to the
         draft. `carried` is the fact the reader needs: their words are either in Reddit's
         box or still in ours, and those need different next steps. */
      status.textContent = `sheddit ${STEP_COPY[r.step] || 'could not post this'} — opening Reddit's own reply box`;
      let carried = false;
      try { carried = await handoff(m.source, kind, text, r); }
      catch { carried = false; }
      if (!form.isConnected) return;
      form.dataset.shdCarried = carried ? 'yes' : 'no';
      status.textContent = carried
        ? `sheddit ${STEP_COPY[r.step] || 'could not post this'} — your text is in Reddit's reply box; press its own reply button to post it`
        : `sheddit ${STEP_COPY[r.step] || 'could not post this'} — your text is still here, behind “← back to sheddit”`;
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
  function findLogoutControl() {
    for (const root of drawerRoots()) {
      const byAttr = SHD.dom.deepQuery(root, C.NATIVE.logout);
      if (byAttr) return byAttr;
    }
    const exact = [];
    const scan = (root, depth) => {
      if (!root || depth > 8 || typeof root.querySelectorAll !== 'function') return;
      for (const el of root.querySelectorAll('a, button, [role="menuitem"]')) {
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
        const panel = document.querySelector(C.USER_DRAWER.host) || document.querySelector(C.HEADER);
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
      const panel = document.querySelector(C.USER_DRAWER.host) || document.querySelector(C.HEADER);
      if (panel && SHD.dom.passthrough(panel)) panel.scrollIntoView?.({ block: 'center' });
      return false;
    } catch (err) {
      if (button) button.disabled = false;
      say('log out failed');
      return false;
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

    const onDocClick = (e) => { if (!corner.contains(e.target)) closeMenu(); };
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
