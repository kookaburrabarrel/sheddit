/**
 * comments.js — rebuilds old reddit's nested thread from Reddit's FLAT comment list.
 *
 * Recon fact: <shreddit-comment> elements are SIBLINGS. Threading exists only as a
 * `depth` attribute. So we run a depth-stack over document order:
 *
 *     stack[d] = the rendered node at depth d
 *     parent   = stack[depth - 1] ?? root
 *
 * Because comments stream in via faceplate-partial, the stack is module state that
 * survives across pipeline flushes and is only cleared on route change.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.comments = (() => {
  const { h, score, ago, plural } = SHD.dom;
  const C = SHD.C;

  let root = null;
  const stack = [];        // stack[depth] -> { node, children }

  /** Mounted as a direct child of <body> — see suppress.css. */
  function ensureRoot() {
    if (root && root.isConnected) return root;
    root = h('div#shd-root.shd-comments-root', null, [
      h('div.commentarea', null, h('div.sitetable.nestedlisting'))
    ]);
    document.body.appendChild(root);
    return root;
  }

  function reset() {
    root = null;
    stack.length = 0;
    SHD.dom.passthroughClear();   // a route change ends any native handoff in progress
  }

  /**
   * Collapse toggle — pure local state, mirrors old reddit's [–]/[+].
   *
   * Lives INLINE as the first item of the tagline, which is where old reddit puts it.
   * The first cut absolutely positioned it at the same left offset as .midcol, so the
   * hover-revealed ▲ painted straight over the [–] glyph and the author name.
   */
  function toggler(thing) {
    return h('a.expand', { href: '#', text: '[–]', onclick(e) {
      e.preventDefault();
      const collapsed = thing.classList.toggle('collapsed');
      this.textContent = collapsed ? '[+]' : '[–]';
    }});
  }

  function render(m) {
    const childListing = h('div.sitetable.listing');
    const thing = h('div.thing.comment', {
      dataset: { fullname: m.id, depth: String(m.depth) }
    });

    const body = h('div.usertext-body');
    // Move the already-rendered body across: it is light DOM and keeps links,
    // code blocks and blockquotes intact without re-parsing markdown. inlineGifs repairs
    // the one element the clone brings across BROKEN — see dom.js (bug 88).
    if (m.bodyNode) body.appendChild(SHD.dom.inlineGifs(m.bodyNode.cloneNode(true)));

    thing.append(
      h('div.midcol.unvoted', null, [
        h('div.arrow.up', { role: 'button', 'aria-label': 'upvote' }),
        h('div.arrow.down', { role: 'button', 'aria-label': 'downvote' })
      ]),
      h('div.entry', null, [
        h('p.tagline', null, [
          toggler(thing),
          ' ',
          h('a.author', { href: `/user/${m.author}`, text: m.author }),
          ' ',
          /* Two ways for a score to be unknowable, one label: the attribute missing
             outright, or present-but-placeholder under Reddit's hide-new-scores window
             (score="1" with the hidden flag set — bug 89). Old reddit's "[score hidden]"
             convention, which this label already followed for the missing case. */
          h('span.score', {
            text: m.scoreHidden || m.score == null ? 'score hidden' : plural(m.score, 'point')
          }),
          ' ',
          h('time', { title: m.created, text: ago(m.created) })
        ]),
        h('form.usertext', null, body),
        /* No "N more replies" here. It used to sit BETWEEN permalink and reply, which
           produced taglines reading `permalink 1 more reply reply` — two reply-ish words
           running together as one broken phrase. Old reddit never put it in the
           action row: it is a line of its own, in the reply list, below the replies it
           loads. It is built into childListing below, which is both the faithful placement
           and the one where the phrase cannot collide with anything. */
        h('ul.flat-list.buttons', null, [
          h('li', null, h('a.permalink', { href: m.permalink || '#', text: 'permalink' })),
          h('li', null, h('a.reply', { href: '#', text: 'reply', onclick: (e) => {
            e.preventDefault();
            // Auth-gated: hand off to Reddit's own composer rather than reimplementing it.
            // passthrough() un-clips the whole ancestor path — tagging the comment alone
            // did nothing, because the clip lives on the <body> child seven levels up.
            if (SHD.dom.passthrough(m.source)) m.source.scrollIntoView({ block: 'center' });
          }}))
        ])
      ]),
      h('div.child', null, childListing)
    );

    /* Last in the reply list, so loaded replies appear ABOVE it — consume() inserts before
       it for exactly that reason. Inside .child, so the collapse toggle takes it with the
       subtree it belongs to and the thread guide line runs beside it. */
    const more = moreRepliesControl(m);
    if (more) childListing.appendChild(more);

    return { node: thing, listing: childListing };
  }

  /* How long we watch for an expansion to deliver, and how often we look. Mutable, and
     deliberately so: the suite has to exercise the "nothing arrived" branch, and the only
     alternatives are a six-second pause in the test run or leaving the loud-failure path
     untested — which is the path this whole rewrite exists to add. Nothing in the
     extension writes to it. */
  const timings = { pollMs: 200, waitMs: 6000 };

  /**
   * Reddit's own per-branch expander ("N more replies") lives inside the hidden comment as
   * a LIGHT-DOM control — captured live: a button/anchor inside a
   * faceplate-partial[loading="action"], scoped to the branch it expands. Clicking it works
   * logged out, and the pipeline renders what arrives (measured: 25 -> 35 comments, all
   * rendered). So the visible row offers the same control, delegated — resolved fresh at
   * CLICK time, because a render-time handle goes stale the moment Reddit swaps the
   * partial (bug 23's lesson). If the native control is gone by then, ours removes itself.
   *
   * IT USED TO REMOVE ITSELF AFTER FOUR SECONDS, WIN OR LOSE. Live testing measured what that
   * costs on a 620-comment thread: six consecutive clicks delivered 3, 0, 1, 5, 4 and 4
   * replies against labels reading 3, 8, 1, 7, 11 and 15 — and every one of them consumed
   * the control. A large thread therefore could not be read to the end, because the
   * affordance that opens it burned itself out, and a click that delivered NOTHING looked
   * exactly like a click that worked. Both halves are fixed here:
   *
   *   - The outcome is MEASURED, not assumed. We count the branch before the click and
   *     poll until it grows, so "it worked" is a fact about the page rather than a timer
   *     expiring.
   *   - The control OUTLIVES a partial expansion. Reddit's label is the branch SUBTOTAL and
   *     one click delivers a slice of it, so the honest thing is to re-read Reddit's own
   *     control afterwards and keep offering it, with its refreshed count, until the branch
   *     is genuinely exhausted (no native control left) — at which point ours goes. The
   *     count is self-correcting that way: it converges by clicking rather than by us
   *     guessing what a slice will contain.
   *   - A no-op SAYS SO. "fails loudly, never silently" is the project's rule and a control
   *     that quietly ate a click broke it.
   */
  function moreRepliesControl(m) {
    const find = () => [...m.source.querySelectorAll(`${C.LAZY_LOADER} button, ${C.LAZY_LOADER} a`)]
      .find(b => b.closest(C.COMMENT) === m.source && C.MORE_REPLIES_TEXT.test(b.textContent || ''));
    const native = find();
    if (!native) return null;
    const label = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

    /* Counted on THIS BRANCH, not on the page. The paginator may be driving the thread's
       own continuation at the same moment, and a page-wide count would credit its arrivals
       to our click — reporting success for an expansion that delivered nothing, which is
       the exact failure this rewrite exists to stop telling. consume() nests late replies
       under their PHYSICAL parent, which is this comment, so the branch subtree is
       precisely what an expansion adds to. Falls back to the page-wide count only if our
       own row has gone (a re-render mid-click), where a coarse measure beats none. */
    const branchSize = () => {
      const row = document.querySelector(`#${C.ROOT_ID} .thing[data-fullname="${m.id}"]`);
      return row
        ? row.querySelectorAll(':scope > .child .thing.comment').length
        : document.querySelectorAll(`#${C.ROOT_ID} .thing.comment`).length;
    };

    const link = h('a', { href: '#', text: label(native) });
    let loading = false;
    /* The handler is on the ROW, not the anchor. Live testing reported two clicks that did
       nothing at all — and the tell was that the label never changed to "loading…", so the
       handler had not run: the click had landed on the container's own box rather than on
       the anchor inside it. Clicks on the anchor still bubble here, so this is strictly
       more forgiving, and a control that silently ignores a click is worse than no control. */
    const line = h('div.shd-more-replies', {
      onclick(e) {
        e.preventDefault();
        if (loading) return;                  // a second click mid-load is not a second page
        const btn = find();
        if (!btn) {
          // Say so rather than vanishing: a disappearing control and a dead one look
          // identical to a reader, and only one of them is our fault.
          link.textContent = 'no longer available';
          line.classList.add('shd-spent');
          return;
        }
        loading = true;
        line.classList.remove('shd-spent');
        link.textContent = 'loading…';
        const before = branchSize();
        btn.click();
        const deadline = Date.now() + timings.waitMs;
        const poll = () => {
          const still = find();
          if (branchSize() > before) {
            loading = false;
            // Reddit's control survives an in-place expansion (the branch-pager fixture is
            // that shape, and it is the shape verify:live found). Re-read its label so the
            // count tracks what is actually left instead of the number it opened with.
            if (still) link.textContent = label(still);
            else line.remove();               // branch exhausted: nothing left to offer
            return;
          }
          if (Date.now() < deadline) { setTimeout(poll, timings.pollMs); return; }
          loading = false;
          /* Nothing arrived. Reddit owns why — a spent partial, a request that never
             answered — and we cannot tell those apart from here. What we CAN do is not
             pretend, and not throw the affordance away on the reader's behalf: the label
             reports the outcome and the control stays clickable. */
          link.textContent = still ? 'no replies loaded — try again' : 'no more replies';
          line.classList.add('shd-spent');
        };
        setTimeout(poll, timings.pollMs);
      }
    }, link);
    return line;
  }

  /** Called by the pipeline for each newly-seen <shreddit-comment>. */
  function consume(el) {
    const m = SHD.model.comment(el);
    if (!m) return false;

    const built = render(m);
    /* Prefer the PHYSICAL parent over the depth-stack. Live comments are DOM-nested
       (verified 25/25), and the stack is document-order state that has moved on by the
       time a branch expander delivers late replies: stack[depth-1] then points at the
       LATEST rendered chain, not the branch that was expanded — so ten new replies to
       comment 3 would nest under comment 25. The stack remains the fallback for flat
       delivery, where there is no physical parent to read. */
    let target = null;
    const parentEl = el.parentElement?.closest(C.COMMENT);
    if (parentEl) {
      const pid = parentEl.getAttribute(C.COMMENT_ATTR.id);
      const prow = pid && document.querySelector(`#${C.ROOT_ID} .thing[data-fullname="${pid}"]`);
      target = prow?.querySelector(':scope > .child > .sitetable') || null;
    }
    if (!target) {
      const parent = m.depth > 0 ? stack[m.depth - 1] : null;
      target = parent ? parent.listing : ensureRoot().querySelector('.nestedlisting');
    }
    if (!target) return false;

    /* Before the branch's own "N more replies" line, if it has one: that control loads
       what comes AFTER these replies, so it has to stay at the bottom of the list. */
    const more = target.querySelector(':scope > .shd-more-replies');
    if (more) target.insertBefore(built.node, more);
    else target.appendChild(built.node);
    stack[m.depth] = built;
    stack.length = m.depth + 1;      // deeper entries are now stale
    return true;
  }

  /**
   * The inline player for a video post — the thing that makes a video post watchable
   * inside this layout rather than only linkable out of it.
   *
   * WHY IT IS HERE AND NOT ON A LISTING ROW. One video post opened is one manifest
   * request; a listing of twenty video posts scrolled past would be twenty, for videos
   * nobody asked to watch. The comments page is where a reader has already chosen this
   * post, so it is the one place the request is clearly worth making. The `watch` link on
   * listing rows is unchanged — and its fallback to the permalink stops being a dead end,
   * because the permalink now plays.
   *
   * TWO SOURCES, IN THIS ORDER, AND THE ORDER IS ABOUT SOUND.
   *   1. `packaged-media-json` (model.mp4Of), when Reddit still offers it: a single
   *      combined file, so it keeps its audio.
   *   2. Failing that, the DASH manifest (media.resolve): CMAF, which splits audio into a
   *      separate file and offers nothing combined — so both are taken from the manifest and
   *      played as a pair. Sound either way; the combined file is simply the cheaper route
   *      to it, needing no second element and no clock to keep.
   * The JSON hydrates late — 3 of 4 posts had none at first paint — so (1) is
   * tried again when (2) comes back, by which time it usually has. Without that recheck a
   * legacy post whose player was merely slow would be served a silent file when a
   * perfectly good combined one existed.
   *
   * A reader who hears nothing must be told why, or the honest conclusion is that this
   * extension broke their sound. Hence the note, which is rendered from what the resolver
   * states rather than from an assumption about the URL.
   */
  /**
   * The post's own picture, on its comments page, where old reddit put the open expando.
   *
   * The adult-content gate is not optional here, and it is the same one the thumbnail
   * carries. The reason that gate exists is that this extension reads the image URL off
   * the post and renders its own <img>, which walks straight past the blur Reddit applies
   * for logged-out readers (bug 41) — and a full-size inline copy is that identical bypass,
   * only larger. Anything that draws a picture must ask the same question.
   */
  function postImage(m) {
    if (!SHD.settings.inlineImages) return null;
    if (m.nsfw && !SHD.settings.showNsfwThumbnails) return null;
    /* A gallery renders every frame it is carrying, stacked — the frames are peers, and
       showing only the largest would silently drop the rest. An image post is the
       single-picture case of the same box. Both fall through to null when nothing
       resolved, so a page whose full-size files live elsewhere costs the picture and
       never the post. */
    const urls = m.type === 'image' && m.image ? [m.image]
      : m.type === 'gallery' ? m.images : [];
    if (!urls.length) return null;
    /* Bare <img>, no anchor — deliberately, since 2026-08-24. These used to link "the
       file itself", and measurement showed there is no such destination for a logged-out
       click: i.redd.it AND preview.redd.it both 307 a navigation into Reddit's /media
       viewer (model.viewerBound documents the probe). The <img> fetch itself is fine —
       the redirect discriminates on the Accept header — so the picture renders here and
       a link under it could only bounce the reader out of the layout. */
    return h('div.shd-image', null, urls.map(u =>
      h('img.shd-image-el', { src: u, alt: '', loading: 'lazy' })));
  }

  function videoPlayer(m) {
    if (m.type !== 'video' || !SHD.settings.inlineVideo) return null;

    const video = h('video.shd-video-el', {
      controls: true, preload: 'metadata', playsinline: '',
      /* The thumbnail we already have, so the box shows the post instead of black while
         the manifest is in flight. */
      poster: m.thumbnail || null
    });
    const box = h('div.shd-video', null, video);

    const mount = (url, info) => {
      video.src = url;
      /* Stated dimensions become an aspect ratio, so the box does not jump when metadata
         lands. Absent ones are simply not set — the element sizes itself once it loads. */
      if (info && info.width && info.height) {
        video.setAttribute('width', String(info.width));
        video.setAttribute('height', String(info.height));
        video.style.aspectRatio = `${info.width} / ${info.height}`;
      }
      if (!info) return;                       // a combined file: it carries its own audio
      if (info.audioUrl) return attachAudio(info.audioUrl);
      /* Genuinely no audio rendition. Say so, because a reader who hears nothing will
         otherwise conclude this extension broke their sound. */
      box.appendChild(h('p.shd-video-note', { text:
        'No sound — Reddit lists no audio track for this video.' }));
    };

    /**
     * The second half of a CMAF post: its audio, as its own element, kept in step by
     * media.pair(). The volume row is ours because a video element with no audio track of
     * its own may not be given a volume control by the browser — and a video whose sound
     * cannot be turned down is worse than one with no sound at all. It writes to the VIDEO,
     * which pair() mirrors onward, so a native control (where there is one) and this one
     * can never disagree.
     */
    function attachAudio(audioUrl) {
      const audio = h('audio.shd-video-audio', { src: audioUrl, preload: 'metadata' });
      box.appendChild(audio);
      SHD.media.pair(video, audio);

      const mute = h('button.shd-video-mute', {
        type: 'button', text: 'mute', 'aria-pressed': 'false',
        onclick: () => {
          video.muted = !video.muted;
          mute.textContent = video.muted ? 'unmute' : 'mute';
          mute.setAttribute('aria-pressed', String(video.muted));
        }
      });
      const vol = h('input.shd-video-vol', {
        type: 'range', min: '0', max: '1', step: '0.05', value: '1',
        'aria-label': 'volume',
        oninput: () => { video.volume = Number(vol.value); video.muted = false;
                         mute.textContent = 'mute'; mute.setAttribute('aria-pressed', 'false'); }
      });
      box.appendChild(h('p.shd-video-note', null, [
        mute, vol,
        h('span', { text: 'sound is a separate track — Reddit ships it that way' })
      ]));
    }

    /* The combined rendition, if it is already there. Synchronous, so a legacy post that
       hydrated before we ran never spends a request at all. */
    const early = SHD.model.mp4Of(m.source);
    if (early) { mount(early); return box; }

    SHD.media.resolve(m).then(res => {
      /* Only the ASYNC path checks this. The synchronous mount above runs before the box
         has been appended to the row — videoPlayer() returns it and consumePost() attaches
         it — so an isConnected guard inside mount() rejects the good URL every time and
         leaves a permanently empty player. That shipped for about ten minutes and the
         suite caught it: the legacy post rendered a <video> with no src at all. */
      if (!box.isConnected) return;              // the row went away mid-flight
      const late = SHD.model.mp4Of(m.source);    // see the recheck note above
      if (late) return mount(late);
      if (res) return mount(res.url, res);
      /* Nothing playable: leave the page as it was before this function existed, rather
         than a permanent empty frame. The `watch` link and the permalink still stand. */
      box.remove();
    });

    return box;
  }

  /** The submission itself, rendered above the thread. */
  function consumePost(el) {
    const m = SHD.model.post(el);
    if (!m) return false;
    const r = ensureRoot();
    if (r.querySelector('.shd-selfpost')) return false;
    const row = SHD.listing.render(m);
    /* Before the selftext, which is where old reddit's expando sat relative to the body.

       GUARDED, and the guard is not theoretical: while this was being built a single
       mistyped global inside videoPlayer() threw, and because the throw happened here the
       POST ITSELF stopped rendering — comments fine, submission gone. The player is an
       enhancement on top of a row that already works, so it must never be able to take the
       row with it. Anything it breaks costs the video and nothing else. */
    let player = null;
    try { player = videoPlayer(m); } catch { player = null; }
    if (player) row.querySelector('.entry').appendChild(player);
    /* An image post got the same treatment a text post got in bug 49 and a video post got
       in 0.16.0, and for the same underlying reason: the picture is not an attribute, so
       nothing read it. Reported as a comments page showing a title, a 70px thumbnail and
       nothing else. Guarded exactly like the player — an enhancement must never be able to
       take the row it decorates down with it. */
    let picture = null;
    try { picture = postImage(m); } catch { picture = null; }
    if (picture) row.querySelector('.entry').appendChild(picture);
    // The post's own text, expanded — old reddit shows the selftext open on the comments
    // page, and this extension shipped without it: the row builder reads attributes, the
    // text is not an attribute (it is slotted light DOM, C.POST_BODY), and no fixture
    // carried one, so "the post has no content" was invisible to every suite. Reported
    // from real use as "comments fine, post content missing". Cloned, like comment
    // bodies, so links / code / quotes survive without re-parsing markdown; inside the
    // row's .entry, which is where old reddit hangs the expando.
    if (m.bodyNode) {
      row.querySelector('.entry').appendChild(
        h('div.usertext-body.shd-selftext', null,
          SHD.dom.inlineGifs(m.bodyNode.cloneNode(true))));
    }
    r.prepend(h('div.shd-selfpost', null, row));
    ensureCommentHead(r, m);
    return true;
  }

  /**
   * Old reddit's strip above the comment list: `all N comments`, then `sorted by: best`.
   *
   * Requested twice from live use. The links are ordinary hrefs onto the post's own
   * permalink — a full navigation, exactly as old reddit sorted — so route.js needs no
   * new machinery and a deep link (?context, a single-comment permalink) gets its escape
   * hatch for free: `all N comments` IS the canonical page.
   *
   * The current sort is the EMITTED one (route.sortQuery), not a raw location.search
   * read. This used to read location at consume time, which was safe while every consume
   * happened post-commit — but the sort swap (bug 87) can consume the thread's own post
   * during the pre-commit window, when location still carries the OUTGOING sort, and the
   * strip then bolds the sort the reader just left. route.sortQuery is the query half of
   * emitPath(): it agrees with the navigation this render belongs to on both sides of
   * the commit.
   */
  function ensureCommentHead(r, m) {
    const area = r.querySelector('.commentarea');
    if (!area || area.querySelector('.shd-commentarea-head')) return;
    let current = 'confidence';
    const q = SHD.route.sortQuery;
    // An unrecognised value falls back to marking the default order, never a menu in
    // which nothing is current.
    if (q && C.COMMENT_SORTS.some(s => s.id === q)) current = q;
    const head = h('div.shd-commentarea-head', null, [
      h('div.panestack-title', null,
        h('a.title-button', {
          href: m.permalink,
          text: `all ${m.comments} comment${m.comments === 1 ? '' : 's'}`
        })),
      h('div.menuarea', null, [
        'sorted by: ',
        ...C.COMMENT_SORTS.flatMap((s, i) => {
          const el = s.id === current
            ? h('span.selected', { text: s.label })
            : h('a', { href: `${m.permalink}?sort=${s.id}`, text: s.label });
          return i ? [' | ', el] : [el];
        })
      ])
    ]);
    area.prepend(head);
  }

  return { consume, consumePost, reset, timings };
})();
