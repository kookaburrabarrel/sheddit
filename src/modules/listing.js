/**
 * listing.js — renders a post model as an old-reddit `div.thing` row.
 *
 *   [rank] [▲ score ▼] [thumb] Title (domain)
 *                              submitted <ago> by <author> to <r/sub>
 *                              <n> comments  share  save  hide  report
 */
globalThis.SHD = globalThis.SHD || {};

SHD.listing = (() => {
  const { h, score, ago, domain, plural } = SHD.dom;
  const C = SHD.C;

  let container = null;
  let rank = 0;

  /**
   * Creates (once) the <div id="siteTable"> that all rows go into.
   * Mounted as a DIRECT CHILD OF <body> — see the comment in suppress.css. Anchoring
   * anywhere inside shreddit-app means an ancestor can be caught by the hide rule.
   */
  function ensureContainer() {
    if (container && container.isConnected) return container;
    container = h('div#siteTable.shd-sitetable');
    const root = h('div#shd-root.shd-listing-root', null, [
      SHD.chrome ? SHD.chrome.tabMenu() : null,
      container
    ]);
    document.body.appendChild(root);
    return container;
  }

  function reset() { container = null; rank = 0; }

  /* ------------------------------------------------------------------ *
   * the empty listing
   * ------------------------------------------------------------------ */

  const EMPTY_CLASS = 'shd-empty';

  /**
   * What a listing with no posts in it says.
   *
   * Reddit's own line for this is "This community doesn't have any posts yet" and it is
   * shown for every reason a feed can come back empty — including the one that prompted
   * bug 94, where a twelve-year-old subreddit had nothing in the window `top` was ranked
   * over. That sentence describes a brand new community, so a reader looking at a
   * time-filtered listing reads it as the renderer having failed. The fix is not to soften
   * it, it is to say which question was actually asked.
   *
   * So the second line NAMES THE WINDOW, and takes its two forms from what the URL
   * actually tells us:
   *
   *   ?t=week    a period we can name, so it is named.
   *   no ?t=     Reddit is applying its own window and does not say which. We say THAT,
   *              and no more. route.js's `timeQuery` deliberately reports '' here and the
   *              "links from:" strip deliberately marks nothing, because Reddit's default
   *              is unverified (see chrome.timeMenu); a line here reading "no posts from
   *              the past 24 hours" would be exactly the guess that decision refuses,
   *              printed in a full sentence. Naming the MECHANISM still answers the
   *              reader's question — the feed is empty because of a window, not because
   *              the community is — which is the whole of what went wrong.
   *
   * The first line is old reddit's own wording for an empty listing, kept verbatim: it
   * says "here", which is the honest scope, and it is what this extension exists to put
   * back. Nothing anywhere in the box claims the community is empty, new, or banned — we
   * cannot see any of that from a feed of zero, and Reddit's copy asserting it is the bug.
   */
  function emptyNotice() {
    const R = SHD.route;
    const sub = R.subredditOf();
    const user = R.usernameOf();
    const onProfile = R.current === R.PROFILE;
    const where = sub ? `r/${sub}` : user ? `u/${user}` : 'the front page';
    /* Whether a window applies at all is route.TIMED_SORTS's answer, never this
       function's — the same list the strip above the box is built from, so the line and
       the control cannot disagree about whether this listing is filtered. */
    const timed = !onProfile && R.current === R.LISTING
      && R.TIMED_SORTS.includes(R.sortOf());
    const period = timed ? R.TIMES.find(t => t.id === R.timeQuery) : null;

    const why = onProfile ? `${where} has nothing on this tab.`
      : period ? `${where} has no posts from ${period.phrase}.`
        : timed ? `${where} has no posts in the time window this sort ranks over.`
          : `${where} has no posts.`;
    /* A hint only where there is a control to point at — the "links from:" strip is
       rendered by the same tab menu that sits directly above this box. A hint with
       nothing behind it would be the "control that ignores a click" failure (bug 62) in
       prose. */
    const hint = !timed ? null
      : period ? 'Widen the window above to look further back.'
        : 'Reddit applies one whether or not the URL says so, and does not say which. '
          + 'Pick a window above to make it explicit.';

    return h('div.' + EMPTY_CLASS, null, [
      h('p.shd-empty-line', { text: "there doesn't seem to be anything here" }),
      h('p.shd-empty-why', { text: why }),
      hint ? h('p.shd-empty-hint', { text: hint }) : null
    ]);
  }

  /**
   * Mount the listing itself for an empty feed: #shd-root, the tab bar (with its "links
   * from:" row) and an empty #siteTable carrying the notice. The header and sidebar are
   * the pipeline's, exactly as they are for a page with rows in it.
   *
   * Idempotent — the gate may ask more than once while the page settles.
   */
  function renderEmpty() {
    const box = ensureContainer();
    if (box.querySelector('.' + EMPTY_CLASS)) return;
    box.appendChild(emptyNotice());
  }

  /**
   * Add a row, retiring the empty notice if one is standing.
   *
   * A feed can be empty when we ask and carry posts a second later — a slow stream, a
   * partial we drove, a history traversal restoring cached elements. The row wins: leaving
   * "there doesn't seem to be anything here" above a list of posts would be a worse lie
   * than the copy this replaced.
   */
  function place(node) {
    const box = ensureContainer();
    box.querySelector('.' + EMPTY_CLASS)?.remove();
    box.appendChild(node);
  }

  /* A miss is either "not hydrated yet" (retry works) or "contracts.js is stale"
     (retry never works). The first cut logged console.debug for both, which made a
     permanent break indistinguishable from a timing miss. Warn once, with the evidence
     needed to tell them apart. */
  let missWarned = false;
  function reportMiss(kind, source) {
    if (missWarned) return;
    missWarned = true;
    const loader = source.querySelector('shreddit-async-loader');
    console.warn(
      `[sheddit] no ${kind} control found on ${source.getAttribute(C.POST_ATTR.id)}. ` +
      `async-loader present: ${!!loader}; open shadow roots searched: ${SHD.dom.shadowRoots(source)}. ` +
      `If the action bar is visibly hydrated on the page, C.NATIVE.${kind} in contracts.js ` +
      `is stale, or the control sits in a CLOSED shadow root and cannot be delegated to.`);
  }

  /**
   * Vote arrows. We own no auth state, so a click resolves the NATIVE control inside the
   * hidden source element at click time and forwards to it. Reddit then handles auth,
   * optimistic UI and the request. If the action bar hasn't hydrated yet, this no-ops.
   *
   * The lookup pierces open shadow roots: the action bar hydrates inside a
   * shreddit-async-loader, which ARCHITECTURE §1.2 records as having a shadow root, so a
   * light-DOM-only querySelector can miss the button permanently rather than transiently.
   */
  function midcol(m) {
    const delegate = (sel, kind) => (ev) => {
      ev.preventDefault();
      const native = SHD.dom.deepQuery(m.source, sel);
      if (native) native.click();
      else reportMiss(kind, m.source);
    };
    return h('div.midcol.unvoted', null, [
      h('div.arrow.up', { role: 'button', 'aria-label': 'upvote', onclick: delegate(C.NATIVE.upvote, 'upvote') }),
      h('div.score.unvoted', { text: score(m.score), title: m.upvoteRatio != null ? `${Math.round(m.upvoteRatio * 100)}% upvoted` : null }),
      h('div.arrow.down', { role: 'button', 'aria-label': 'downvote', onclick: delegate(C.NATIVE.downvote, 'downvote') })
    ]);
  }

  function thumb(m) {
    if (!SHD.settings.showThumbnails) return null;
    /* Adult content gets old reddit's placeholder tile instead of the picture. This is not
       decoration: we read the image URL off the post and render our own <img>, which walks
       straight past the blur Reddit puts on NSFW thumbnails for logged-out readers — so
       without this, a feed that Reddit itself would have obscured comes out fully explicit
       in our layout. Found on a graphic war-footage subreddit, logged out, where the
       difference is not theoretical. The image is one setting away, exactly as old reddit's
       "show thumbnails for adult content" opt-in worked. */
    if (m.nsfw && !SHD.settings.showNsfwThumbnails) {
      return h('a.thumbnail.nsfw', { href: m.href, rel: 'noopener', 'aria-label': 'adult content' });
    }
    if (m.thumbnail) {
      return h('a.thumbnail', { href: m.href, rel: 'noopener' },
        h('img', { src: m.thumbnail, alt: '', loading: 'lazy' }));
    }
    // Placeholder classes mirror old reddit: self / default / nsfw
    const cls = m.isSelf ? 'self' : 'default';
    return h('a.thumbnail.' + cls, { href: m.href, rel: 'noopener' });
  }

  /**
   * The container old reddit opens under a row, holding the post's own picture.
   *
   * Returns null unless there is genuinely something to show, which is what keeps the
   * button and the box in step — see render().
   *
   * The adult-content gate is the thumbnail's, and it is not optional. This extension
   * reads the image URL and renders its own <img>, walking past the blur Reddit applies
   * for logged-out readers (bug 41); an expando is that same bypass behind one click, so
   * it asks the same question the tile does.
   */
  function expandoBox(m) {
    if (m.type !== 'image' || !m.image) return null;
    if (!SHD.settings.inlineImages) return null;
    if (m.nsfw && !SHD.settings.showNsfwThumbnails) return null;
    // The URL rides on the box rather than being closed over, so the button can stay a
    // pure function of the box and the two cannot disagree about which picture this is.
    return h('div.expando', { hidden: true, dataset: { shdSrc: m.image } });
  }

  /**
   * The [+]/[-] control in front of the row.
   *
   * The picture is attached on FIRST OPEN, never at render time. A listing is dozens of
   * rows and the whole point of a thumbnail is that the full image has not been fetched —
   * building the <img> up front would pull every full-size picture on the page for rows
   * nobody opened, which is the cost old reddit's expando exists to avoid.
   */
  function expandoButton(box) {
    if (!box) return null;
    const btn = h('div.expando-button.collapsed', {
      role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': 'expand image'
    });
    const toggle = () => {
      const opening = box.hasAttribute('hidden');
      if (opening && !box.firstChild) {
        box.appendChild(h('img.shd-expando-img', {
          src: box.dataset.shdSrc, alt: '', loading: 'lazy'
        }));
      }
      if (opening) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
      btn.classList.toggle('collapsed', !opening);
      btn.classList.toggle('expanded', opening);
      btn.setAttribute('aria-expanded', String(opening));
      btn.setAttribute('aria-label', opening ? 'collapse image' : 'expand image');
    };
    btn.addEventListener('click', toggle);
    // Keyboard parity: this is a div playing the part of a button, so it has to answer to
    // the keys a real one would.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    return btn;
  }

  function tagline(m) {
    return h('p.tagline', null, [
      'submitted ',
      h('time', { title: m.created, text: ago(m.created) }),
      ' by ',
      h('a.author', { href: `/user/${m.author}`, text: m.author }),
      ' to ',
      h('a.subreddit', { href: `/r/${m.subreddit}/`, text: m.subredditPrefixed || `r/${m.subreddit}` })
    ]);
  }

  function buttons(m) {
    return h('ul.flat-list.buttons', null, [
      h('li.first', null, h('a.comments', {
        href: m.permalink,
        text: m.comments ? plural(m.comments, 'comment') : 'comment'
      })),
      /* The video affordance, and the one link on the row that re-resolves at CLICK
         time. The mp4 set lives on a nested <shreddit-player> that hydrates late — 3 of 4
         live posts had no player attribute at first paint — so a render-time
         href is usually stale. Mutating href inside the handler and NOT preventing
         default lets the browser navigate to the updated URL, so this stays a real link
         (middle-click, copy-link, open-in-tab all keep working) and simply gets better
         the moment Reddit hydrates.

         When nothing resolves — an asset Reddit serves as CMAF/HLS only, which is the
         direction of travel — it degrades to the comments page rather than to the
         v.redd.it bounce: still the place the video is watchable, just Reddit's player
         rather than a file. NOT rendered on the comments page itself, where that would be
         a link to the page you are on; giving that page a real player is open question
         9(c). */
      m.type === 'video' && SHD.route.current !== SHD.route.COMMENTS
        ? h('li', null, h('a.watch', {
            href: m.mp4 || m.permalink, rel: 'noopener', text: 'watch',
            onclick: function () {
              const late = SHD.model.mp4Of(m.source);
              if (late) this.href = late;
            }
          }))
        : null,
      h('li', null, h('a.share', { href: m.permalink, text: 'share' })),
      /* No save/report. Both need a session, and both shipped as `href: permalink`, so
         they looked like actions and silently navigated to the comments page instead.
         This extension targets logged-out reading (README "Scope"), and old reddit did
         not offer them to logged-out users either — so the faithful thing and the honest
         thing agree. Restore them behind a session check if login support ever lands. */
      h('li', null, h('a.hide', {
        href: '#', text: 'hide',
        onclick: (e) => { e.preventDefault(); row(m.id)?.classList.add('shd-hidden'); }
      }))
    ]);
  }

  const row = (id) => document.querySelector(`#shd-root .thing[data-fullname="${id}"]`);

  /** model -> DOM node. Pure; no side effects on the page. */
  function render(m) {
    rank += 1;
    /* Old reddit numbers listings but not profiles, and on a profile the counter would be
       wrong anyway: comment rows sit between the posts, so the visible sequence would
       skip. */
    const onProfile = SHD.route.current === SHD.route.PROFILE;
    /* Old reddit's expando: the picture opens under the row instead of navigating away.
       Both halves are null together for a row with nothing to open, so a row never grows a
       control that does nothing — a control that ignores a click is worse than no control
       (bug 62), and that is as true before a report as after one. */
    const box = expandoBox(m);
    return h('div.thing.link', {
      dataset: { fullname: m.id, type: m.type, subreddit: m.subreddit },
      class: (m.isSelf ? 'self' : 'linkpost') + (SHD.settings.compactRows ? ' compact' : '')
    }, [
      onProfile ? null : h('span.rank', { text: String(rank) }),
      midcol(m),
      thumb(m),
      expandoButton(box),
      h('div.entry', null, [
        h('p.title', null, [
          /* A video post's title is its comments page (model.js says why); the mp4 is a
             link of its own, built in buttons() below. */
          h('a.title', {
            href: m.href, rel: m.isSelf ? null : 'noopener nofollow', text: m.title
          }),
          /* Old reddit's stamp, and the only warning left once the thumbnail is a
             placeholder — the tile alone cannot say whether a post is adult or merely
             has no image. Shown regardless of the thumbnail setting, because it labels
             the post rather than standing in for the picture. */
          m.nsfw ? h('span.nsfw-stamp', { text: 'nsfw' }) : null,
          m.domain ? h('span.domain', null, ['(', h('a', { href: m.isSelf ? `/r/${m.subreddit}/` : `//${domain(m.domain)}`, text: domain(m.domain) }), ')']) : null
        ]),
        tagline(m),
        buttons(m),
        box
      ])
    ]);
  }

  /** Called by the pipeline for each newly-seen <shreddit-post>. */
  function consume(el) {
    if (el.closest(C.AD_POST)) return false;         // never render ads
    const m = SHD.model.post(el);
    if (!m) return false;
    place(render(m));
    return true;
  }

  /**
   * A profile page's comment row — old reddit's shape: a parent line naming where the
   * comment lives, then the tagline, the cloned body, and permalink/context/full-comments
   * buttons. FLAT, in #siteTable, interleaved with the post rows in document order; no
   * depth-stack, no midcol (voting is unsupported logged out, and old reddit's profile
   * arrows are the one fidelity dropped rather than shipping decorative floats).
   */
  function renderProfileComment(m) {
    const body = h('div.usertext-body');
    // required by the model, never null here; inlineGifs repairs the player the clone
    // brings across broken (bug 88)
    body.appendChild(SHD.dom.inlineGifs(m.bodyNode.cloneNode(true)));
    return h('div.thing.comment.shd-profile-comment', {
      dataset: { fullname: m.id }
    }, [
      h('div.entry', null, [
        /* Old reddit's parent line: `comment in <sub> on "<post title>"`. Each half is
           omitted independently when we cannot establish it — a line reading "comment in"
           with nothing after it is worse than no line, and naming the WRONG community is
           worse than both (live testing printed the profile owner's name thirty times; see
           model.profileComment). A row with neither half prints no line at all. */
        m.contextLabel || m.postTitle
          ? h('p.parent', null, [
            m.contextLabel ? 'comment in ' : 'comment on ',
            m.contextLabel
              ? h('a.subreddit', { href: m.contextHome, text: m.contextLabel })
              : null,
            m.contextLabel && m.postTitle ? ' on ' : null,
            m.postTitle
              ? h('a.shd-parent-title', { href: m.threadHref || m.permalink, text: m.postTitle })
              : null
          ])
          : null,
        h('p.tagline', null, [
          h('a.author', { href: `/user/${m.author}`, text: m.author }),
          /* No score: this element does not carry one (contracts.js). Old reddit always
             showed points, but inventing a number or printing "score hidden" would both
             claim knowledge we do not have. Same reasoning that removed save/report. */
          m.created ? ' ' : null,
          m.created ? h('time', { title: m.created, text: ago(m.created) }) : null
        ]),
        h('form.usertext', null, body),
        h('ul.flat-list.buttons', null, [
          h('li.first', null, h('a.permalink', { href: m.permalink, text: 'permalink' })),
          // Reddit's own href already carries ?context=3 — used as-is rather than rebuilt,
          // so this cannot drift from whatever context depth Reddit decides to link at.
          h('li', null, h('a.context', { href: m.contextHref, text: 'context' })),
          m.threadHref
            ? h('li', null, h('a.comments', { href: m.threadHref, text: 'full comments' }))
            : null
        ])
      ])
    ]);
  }

  /* How long to keep watching a source element for a timestamp that has not arrived.
     Long enough for any real hydration, short enough that a row which genuinely has no
     <time> does not hold an observer for the life of the page. */
  const LATE_TIME_MS = 15000;

  /**
   * Patch the timestamp in late, when the source hydrates after consume time.
   *
   * Observed live, twice: a history traversal re-inserts Reddit's cached profile elements
   * and the pipeline re-consumes them MID-HYDRATION — `created` is read once, from a
   * rendered `<time>` that may not exist yet, so the row lost its timestamp permanently
   * even though the element grew one moments later. The field is optional (the row is
   * usable without it), which is exactly why nothing ever failed loudly.
   *
   * Scoped like the model's own read (closest === source), and armed only when the time
   * was missing — the ordinary fully-hydrated row costs nothing. The observer disconnects
   * on first success or at LATE_TIME_MS, whichever comes first, so it cannot accumulate.
   */
  function armLateTime(thing, m) {
    if (m.created || !m.source) return;
    const tagline = thing.querySelector('.tagline');
    if (!tagline) return;
    const read = () => {
      const t = [...m.source.querySelectorAll('time[datetime]')]
        .find(n => n.closest(C.PROFILE_COMMENT) === m.source);
      return t ? t.getAttribute('datetime') : null;
    };
    const obs = new MutationObserver(() => {
      const created = read();
      if (!created) return;
      obs.disconnect();
      clearTimeout(stop);
      // The row may have been torn down by a route change while we waited; the source
      // element outliving OUR render is normal on Reddit's side.
      if (!thing.isConnected) return;
      tagline.appendChild(document.createTextNode(' '));
      tagline.appendChild(h('time', { title: created, text: ago(created) }));
    });
    obs.observe(m.source, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['datetime']
    });
    const stop = setTimeout(() => obs.disconnect(), LATE_TIME_MS);
  }

  /** Called by the pipeline for each newly-seen profile comment (either candidate tag). */
  function consumeProfileComment(el) {
    const m = SHD.model.profileComment(el);
    if (!m) return false;
    const thing = renderProfileComment(m);
    place(thing);
    armLateTime(thing, m);
    return true;
  }

  return { consume, consumeProfileComment, render, renderEmpty, reset };
})();
