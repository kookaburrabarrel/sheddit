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
    expanderWatch?.disconnect();
    expanderWatch = null;
    SHD.dom.passthroughClear();   // a route change ends any native handoff in progress
  }

  /**
   * Offer a "N more replies" control for an expander that arrives AFTER its comment —
   * bug 90, and the reason deep branches were unreachable.
   *
   * QA round 2026-08-27, measured with a MutationObserver on the native branch: one
   * click on "20 more replies" delivered a slice whose comments arrived ALREADY CARRYING
   * the affordances for the remainder — four of them, nested inside the just-delivered
   * subtree — while the driven partial removed itself. Our side rendered zero controls
   * for those four, because moreRepliesControl() is consulted once, at render time, and
   * these expanders land in a comment's light DOM after that comment was consumed (the
   * profile timestamp's late-arrival family, log 68). Net effect: every branch was one
   * click deep, and the page-wide control count could only ever go down.
   *
   * ONE observer for the whole tree, not one per comment: "no expander at render time"
   * is the COMMON case, and a thousand 15-second per-comment observers on a megathread
   * is a cost with no ceiling. Insertions are the only way an expander can appear, so
   * childList on the tree sees every candidate; each added node is checked for
   * more-replies controls, resolved to its owning comment, and the rendered row —
   * when it exists and lacks one — gets the same delegated control render() would have
   * built. A comment not yet consumed is skipped here because render() will see the
   * expander itself; a comment consumed long ago is exactly the case this exists for.
   */
  let expanderWatch = null;

  function patchLateExpanders(node) {
    const sel = `${C.LAZY_LOADER} button, ${C.LAZY_LOADER} a`;
    const cands = node.matches?.(sel) ? [node] : [];
    node.querySelectorAll?.(sel).forEach(b => cands.push(b));
    for (const b of cands) {
      if (!C.MORE_REPLIES_TEXT.test(b.textContent || '')) continue;
      const src = b.closest(C.COMMENT);
      if (!src) continue;
      const id = src.getAttribute(C.COMMENT_ATTR.id);
      const row = id && document.querySelector(`#${C.ROOT_ID} .thing[data-fullname="${id}"]`);
      if (!row) continue;                       // not consumed yet — render() will offer it
      const listing = row.querySelector(':scope > .child > .sitetable');
      if (!listing || listing.querySelector(':scope > .shd-more-replies')) continue;
      const line = moreRepliesControl({ id, source: src });
      if (line) listing.appendChild(line);
    }
  }

  function watchLateExpanders() {
    if (expanderWatch) return;
    const tree = document.querySelector(C.COMMENT_TREE);
    if (!tree) return;
    expanderWatch = new MutationObserver(records => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          try { patchLateExpanders(n); } catch { /* a patch must never cost the render */ }
        }
      }
    });
    expanderWatch.observe(tree, { childList: true, subtree: true });
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
      /* Arrows only — old reddit keeps a comment's score in the tagline. Delegated since
         0.34.0 (account.js), where before they were inert markup: a logged-out session has
         no native control to forward to, so for that reader nothing changes. */
      SHD.account.midcol(m, 'comment'),
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
            /* Auth-gated, and account.js owns which of two things happens. Logged out:
               hand off to Reddit's own composer via passthrough rather than reimplementing
               it — passthrough() un-clips the whole ancestor path, because the clip lives
               on the <body> child seven levels up and tagging the comment alone did
               nothing. Logged in (0.34.0): an old-reddit reply box under this entry, whose
               save drives Reddit's composer and falls back to that same handoff. */
            SHD.account.reply(m, thing);
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
    // Idempotent; armed from here because the tree provably exists once a comment does.
    watchLateExpanders();

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

  /** Is this post's picture behind the adult opt-in? One question, asked in three places. */
  const adultGate = (m) => !!m.nsfw && !SHD.settings.showNsfwThumbnails;

  /* Bare <img>, no anchor — deliberately, since 2026-08-24. These used to link "the file
     itself", and measurement showed there is no such destination for a logged-out click:
     i.redd.it AND preview.redd.it both 307 a navigation into Reddit's /media viewer
     (model.viewerBound documents the probe). The <img> fetch itself is fine — the redirect
     discriminates on the Accept header — so the picture renders here and a link under it
     could only bounce the reader out of the layout. */
  const imageFrames = (urls) => urls.map(u =>
    h('img.shd-image-el', { src: u, alt: '', loading: 'lazy' }));

  /**
   * Put an adult post's picture behind a blur and one control, exactly as videoPlayer does
   * for a player — 0.30.0, and the reasoning is the same in both places.
   *
   * WHY NOT NOTHING, WHICH IS WHAT THIS USED TO BE. The gate exists because this extension
   * reads the image URL off the post and renders its OWN <img>, which walks past the blur
   * Reddit applies to a logged-out reader (bug 41) — and a full-size inline copy is that
   * bypass, larger. But "draw nothing" is not what Reddit does and not what old reddit's
   * opt-in was for on a page you navigated to on purpose: it left the reader with a titled
   * post and no way to see what it was about, on a page whose whole job is showing it. So
   * the answer is Reddit's own — BLUR IT — and this draws the blur rather than walking past
   * it. The listing row keeps its placeholder tile, which is old reddit's answer for a
   * picture nobody asked for yet.
   *
   * WHAT LOADS WHILE THE BLUR STANDS: the THUMBNAIL, and only that. A blurred full-size
   * <img> would be CSS over a completed download of exactly the picture the reader has not
   * asked for — the bug wearing a disguise. `m.thumbnail` is the <img>'s own `src`, which on
   * Reddit's responsive sets is the SMALL member, while `m.image` is the largest in the
   * srcset — so the blur costs the file the listing row already carried and the click
   * fetches the rest. Where a post offers only one size the two are the same file, and the
   * blur is then over a picture the row had anyway: no worse than the row, never worse than
   * revealing it.
   *
   * @param {() => string[]} resolve  the frames to draw, called AT REVEAL TIME. A gallery's
   *   carousel hydrates late (bug 91), so asking at the click is what makes a post revealed
   *   ten seconds in show everything it has rather than what it had at first paint.
   */
  function gateImages(box, m, resolve) {
    box.classList.add('shd-image-gated');
    if (m.thumbnail) box.appendChild(h('img.shd-image-still', { src: m.thumbnail, alt: '' }));
    const show = h('button.shd-image-reveal', {
      type: 'button',
      text: 'adult content — click to view',
      onclick: () => {
        box.classList.remove('shd-image-gated');
        const urls = resolve();
        /* Nothing left to show — a gallery whose frames went away mid-blur. Leave the page
           as it was rather than an empty box with a control that did nothing (bug 62). */
        if (!urls.length) return box.remove();
        box.replaceChildren(...imageFrames(urls));
      }
    });
    box.appendChild(show);
    return box;
  }

  /**
   * The post's own picture, on its comments page, where old reddit put the open expando.
   * Adult posts get the blur above; everyone else gets the frames straight.
   */
  function postImage(m) {
    if (!SHD.settings.inlineImages) return null;
    /* A gallery renders every frame it is carrying, stacked — the frames are peers, and
       showing only the largest would silently drop the rest. An image post is the
       single-picture case of the same box. Both fall through to null when nothing
       resolved, so a page whose full-size files live elsewhere costs the picture and
       never the post. */
    const urls = m.type === 'image' && m.image ? [m.image]
      : m.type === 'gallery' ? m.images : [];
    if (!urls.length) return null;
    const box = h('div.shd-image');
    if (adultGate(m)) return gateImages(box, m, () => liveFrames(m, urls));
    box.append(...imageFrames(urls));
    return box;
  }

  /** The frames this post can show right now, preferring a re-read over the consume-time snapshot. */
  function liveFrames(m, fallback) {
    if (m.type !== 'gallery' || !m.source) return fallback;
    const now = SHD.model.imagesOf(m.source);
    return now.length ? now : fallback;
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
   * THE SOURCES ARE A LIST, TRIED IN ORDER, AND THE ORDER IS ABOUT SOUND — see `sources`
   * below for what is in it and why falling through it is the whole point.
   *
   * A reader who hears nothing must be told why, or the honest conclusion is that this
   * extension broke their sound. Same for a reader who SEES nothing: the note dead() writes
   * is the visible half of that principle, and it is rendered from what was actually tried
   * rather than from an assumption about why it failed.
   */
  function videoPlayer(m) {
    if (m.type !== 'video' || !SHD.settings.inlineVideo) return null;

    /* The post's own thumbnail: the poster while a source is in flight, and the whole frame
       once nothing will play. */
    const still = m.thumbnail || null;

    /* ADULT CONTENT, AND WHY THIS IS A BLUR RATHER THAN A PLACEHOLDER (project decision,
       2026-09-01, asked and answered directly).
       Everywhere else the adult opt-in is binary, because old reddit's was: a flagged
       picture is a placeholder tile until the reader says otherwise. A player is not a tile.
       Replacing it with one would hide a video the reader chose to open, on a page they
       navigated to on purpose, and the toggle's own name — SHOW adult THUMBNAILS — is about
       what is drawn, not about what may be watched. So the frame is blurred and the video is
       one click away, which is also what Reddit itself does to a logged-out reader: bug 41
       is the record that Reddit BLURS rather than withholds, and that drawing our own
       picture is what walks past it. This draws the blur instead.
       NOTHING BUT THE POSTER LOADS while it stands: `preload: none` and no source is mounted
       until the click, so a scrolled-past adult post costs one thumbnail — the same picture
       the listing row would have shown — and not a video. */
    const gated = !!m.nsfw && !SHD.settings.showNsfwThumbnails;

    const video = h('video.shd-video-el', {
      controls: true, preload: gated ? 'none' : 'metadata', playsinline: '',
      poster: still
    });
    const box = h('div.shd-video', { class: gated ? 'shd-video-gated' : null }, video);

    /* What the current attempt put on the page, so the next one starts from a clean
       element. Two soundtracks over one picture is what happens without this. */
    let attached = null;                 // { audio, stop } from media.pair()
    /* The manifest's answer, once we have asked for it: the difference between "Reddit
       still lists this video and its files are gone" and "Reddit told us nothing", which is
       the difference between two failures a reader can act on differently. */
    let manifestSeen = null;
    let manifestAsked = false;
    const tried = [];                    // every URL actually mounted, in order

    const mount = (url, info) => {
      tried.push(url);
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
      attached = { audio, stop: SHD.media.pair(video, audio).stop };

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
      const row = h('p.shd-video-note', null, [
        mute, vol,
        h('span', { text: 'sound is a separate track — Reddit ships it that way' })
      ]);
      box.appendChild(row);

      /* The half of the CMAF pair that can die on its own. A picture that plays with no
         sound and a row underneath it still offering a volume slider is the same silence
         the "no audio track" note exists to prevent, one layer down — so the row says what
         happened instead of standing there being useless. The video is left alone: it is
         playing, and a reader watching it should not lose the picture over the sound. */
      audio.addEventListener('error', () => {
        if (!audio.isConnected) return;          // torn down by a fallback; not a failure
        row.replaceChildren(h('span', { text:
          'No sound — Reddit\'s media server refused this video\'s audio track.' }));
      });
    }

    /** Undo the last attempt: its audio half, its listeners, and anything it said on screen. */
    function clear() {
      if (attached) { attached.stop(); attached.audio.remove(); attached = null; }
      for (const n of [...box.querySelectorAll('.shd-video-note')]) n.remove();
    }

    /* The manifest, asked for at most once per asset (media.js memoises by asset, so the
       second caller here costs no second request) and remembered for the failure note. */
    const manifest = () => SHD.media.resolve(m).then(res => {
      manifestAsked = true;
      if (res) manifestSeen = res;
      return res;
    });
    const fromManifest = (res) => (res ? { url: res.url, info: res } : null);
    /* Re-read each time it is asked for, never cached: the JSON hydrates late — 3 of 4
       posts had none at first paint — so a null here is "not yet", not "never". */
    const packaged = () => {
      const u = SHD.model.mp4Of(m.source);
      return u ? { url: u, info: null } : null;
    };

    /**
     * THE SOURCES, IN ORDER, AND WHY THERE IS MORE THAN ONE OF THEM NOW.
     *
     *   1. `packaged-media-json` (model.mp4Of), when Reddit still offers a live one: a
     *      single combined file, so it keeps its audio and costs no request of ours.
     *   2. The DASH manifest (media.resolve): CMAF, which splits audio into a separate file
     *      and offers nothing combined — so both are taken from the manifest and played as a
     *      pair. The packaged JSON is re-read first, because it hydrates late and a combined
     *      file is the cheaper route to the same sound.
     *   3. The manifest again, for the case where (2) chose a late-hydrated packaged file
     *      and THAT failed to load. Already-mounted URLs are skipped, so this is a real
     *      third source or it is nothing.
     *
     * WHAT IS NEW IN 0.30.0 IS THE FALLING THROUGH. Until now source 1 was mounted and that
     * was the end of it: a URL that resolved was assumed to play. Reported 2026-09-01 with a
     * full diagnosis attached — a packaged rendition answering 403, `error.code 4`
     * (SRC_NOT_SUPPORTED), `networkState 3`, zero bytes buffered, and a player that sat
     * there spinning with nothing on screen to say why. Resolving a URL and playing it are
     * different claims, and only the element that loads it knows which one held. So the
     * element's own `error` is what advances this list, and running out of list is a
     * sentence on screen rather than a silence.
     */
    const sources = [
      packaged,
      () => manifest().then(res => packaged() || fromManifest(res)),
      () => manifest().then(fromManifest)
    ];
    let next = 0;

    /**
     * Take what a source handed back and either mount it or move on.
     *
     * @param {{url:string,info:object|null}|null} c
     * @param {boolean} sync  true when the source answered without a promise, and therefore
     *   BEFORE consumePost has put this box in the page. The liveness guard must not run on
     *   that path: it rejects the good URL every time and leaves a permanently empty player.
     *   That shipped for about ten minutes in 0.16.0 and the suite caught it — a legacy post
     *   rendering a <video> with no src at all.
     */
    function land(c, sync) {
      if (!sync && !box.isConnected) return;   // the row went away mid-flight
      /* A source that hands back something already tried is not a source. Without this, 2
         and 3 mount the same manifest rendition twice and the reader watches it fail twice
         as slowly. */
      if (!c || tried.includes(c.url)) return advance();
      mount(c.url, c.info);
    }

    function advance() {
      clear();
      if (next >= sources.length) return dead();
      let got;
      try { got = sources[next++](); } catch { got = null; }
      /* Answered synchronously — a legacy post whose player had already hydrated — so it is
         mounted synchronously too, before videoPlayer() returns. Deferring even to a
         microtask here would be a behaviour change for the one case that costs no request. */
      if (got && typeof got.then === 'function') got.then(c => land(c, false), () => advance());
      else land(got, true);
    }

    /**
     * Every source is spent. Replace the player with what we do have — the post's own
     * still — and say, in as much detail as we can honestly claim, what happened.
     *
     * WHY THIS IS NOT `box.remove()` ANY MORE. It was, and the removal WAS the second half
     * of the report: `error.code 4`, `networkState 3`, zero bytes, and a UI that spun
     * forever while a reader worked out on their own that Reddit's CDN had dropped the
     * objects behind a manifest it still serves. Everything needed to say so was already in
     * hand — which URLs were tried, whether the manifest answered, how old the post is.
     */
    function dead() {
      clear();
      video.remove();
      const names = tried.map(u => u.split('?')[0].split('/').pop());
      /* "11 hours ago" -> "11 hours". The age is the load-bearing detail in the common
         case: Reddit's manifests are cached for two weeks and outlive the media they name,
         so a post whose files are already gone is one whose objects went at the source. */
      const age = m.created ? ` The post was ${ago(m.created).replace(/\s*ago$/, '')} old when this failed.` : '';
      /* "Reddit offered nothing" and "what Reddit offered had already died" are different
         facts, and the second one is the reported bug. Asking mp4Of to ignore the expiry is
         how the two are told apart without walking the JSON a second time here. */
      const stale = !!SHD.model.mp4Of(m.source, { stale: true });
      const say =
        tried.length && manifestSeen
          ? (names.length === 1
              ? `Reddit's media server refused the one file this post offers, ${names[0]}. `
                + 'Its manifest still lists it, '
              : `Reddit's media server refused every file this post offers — tried ${names.join(', ')}. `
                + 'Its manifest still lists them, ')
            + 'so what is missing is the video itself: Reddit removed or revoked it at the '
            + `source.${age} `
            + 'That is not your browser, your codecs or an expired link, and no player can get past it.'
        : tried.length
          ? `Reddit's media server refused ${names.join(', ')}, and its manifest `
            + `(${SHD.C.VIDEO_MANIFEST}) did not answer, so there was no other rendition to try.${age} `
            + 'Reloading the page retries the manifest.'
        : manifestAsked
          ? `Reddit offered nothing playable for this post: its manifest (${SHD.C.VIDEO_MANIFEST}) `
            + 'either failed to load or listed no rendition'
            + (stale
                ? ', and the packaged rendition on the page had already passed its expiry.'
                : ', and the page carries no packaged rendition either.')
            + ' Reloading the page retries it.'
          : 'No playable video was found for this post.';
      /* The forensics, one hover away rather than in the paragraph: the exact URLs and the
         element's own verdict on the last of them. This is what a report needs and what a
         reader does not. */
      const detail = [
        tried.length ? `tried:\n${tried.join('\n')}` : 'nothing was mounted',
        video.error ? `MediaError code ${video.error.code}` +
          (video.error.message ? ` — ${video.error.message}` : '') : null,
        manifestSeen ? `manifest resolved: ${manifestSeen.url}` : 'manifest: no usable answer'
      ].filter(Boolean).join('\n');

      if (still) box.appendChild(h('img.shd-video-still', { src: still, alt: '' }));
      box.appendChild(h('p.shd-video-note.shd-video-fail', { title: detail }, [
        h('strong', { text: 'Video unavailable ' }),
        h('span', { text: say })
      ]));
    }

    /* The element is the only thing that knows whether a URL actually played. A failure
       arrives here as an `error` event on the <video>; anything still in `sources` gets its
       turn, and when nothing is, dead() says so. */
    video.addEventListener('error', () => {
      /* An error before anything was mounted is not this list's to answer for — nothing has
         been asked to load yet, so advancing would silently spend a source. */
      if (tried.length && box.isConnected) advance();
    });

    /**
     * The one control the blur needs: a real <button> over the frame, so it is reachable by
     * keyboard and announced as the action it is. Pressing it is what starts the source
     * list — before that no video, no manifest and no request of any kind has happened.
     */
    if (gated) {
      const show = h('button.shd-video-reveal', {
        type: 'button',
        text: 'adult content — click to play',
        onclick: () => {
          box.classList.remove('shd-video-gated');
          show.remove();
          video.preload = 'metadata';
          advance();
        }
      });
      box.appendChild(show);
    } else {
      advance();
    }

    return box;
  }

  /* How long the two late-hydration watchers below keep looking, and why 15s: long
     enough for any real hydration, short enough that a page which genuinely has no more
     to give does not hold observers for its lifetime. Same reasoning as listing.js's
     LATE_TIME_MS for the profile timestamp — these are the same late-arrival family. */
  const LATE_HYDRATE_MS = 15000;

  /**
   * Append gallery frames that hydrate AFTER the post was consumed — bug 91.
   *
   * QA round 2026-08-27, F3, two live galleries: the native carousel carried 2 loaded
   * frames, the lazy remainder srcless, and exactly ONE frame was rendered both times.
   * Nothing was wrong with imagesOf — it faithfully read every frame that HAD a src at
   * consume time; the carousel simply had not hydrated the rest yet, and nothing ever
   * looked again. The profile timestamp shipped this identical bug (log 68), and this is
   * its fix transplanted: watch the source post for src/srcset arrivals, re-read the
   * frames, append the ones the box does not have. The box is found (or created) at
   * PATCH time, so a gallery with zero resolved frames at consume still gets its
   * pictures when they turn up. Gated exactly as postImage is — the NSFW question must
   * have the same answer however late the picture arrives.
   */
  function armLateGalleryFrames(row, m) {
    if (m.type !== 'gallery' || !m.source) return;
    if (!SHD.settings.inlineImages) return;
    /* An adult gallery is NOT skipped any more (0.30.0): it is blurred like every other one,
       and it can arrive after consume exactly as a clean one can. What the gate costs it is
       the appending below, not the box. */
    const obs = new MutationObserver(() => {
      if (!row.isConnected) { obs.disconnect(); clearTimeout(stop); return; }
      const urls = SHD.model.imagesOf(m.source);
      if (!urls.length) return;
      let box = row.querySelector('.shd-image');
      if (!box) {
        box = h('div.shd-image');
        // Where postImage's box goes: in the entry, before the selftext when there is one.
        const text = row.querySelector('.shd-selftext');
        if (text) text.before(box); else row.querySelector('.entry')?.appendChild(box);
        /* A gallery whose frames all arrived late, on an adult post: the box opens blurred,
           exactly as postImage would have built it had the frames been there at consume
           time. Appending the frames straight in here is the bypass the gate is for. */
        if (adultGate(m)) { gateImages(box, m, () => SHD.model.imagesOf(m.source)); return; }
      }
      /* Still blurred: the reader has not asked, and the reveal re-reads the frames, so
         nothing that hydrates while the blur stands is lost by waiting. */
      if (box.classList.contains('shd-image-gated')) return;
      const have = new Set([...box.querySelectorAll('img')].map(i => i.getAttribute('src')));
      for (const u of urls) {
        if (!have.has(u)) box.appendChild(h('img.shd-image-el', { src: u, alt: '', loading: 'lazy' }));
      }
    });
    obs.observe(m.source, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset']
    });
    const stop = setTimeout(() => obs.disconnect(), LATE_HYDRATE_MS);
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
    // Guarded like the enhancements it patches: a watcher must never take the row down.
    try { armLateGalleryFrames(row, m); } catch { /* the frames already rendered stand */ }
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
      /* The top-level comment box, old reddit's placement: above the sort strip, under
         the post. account.js returns null for anyone the layer is off for. */
      SHD.account.commentBox(m),
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
