/**
 * model.js — turns a <shreddit-post> / <shreddit-comment> element into a plain object.
 *
 * This is the layer that isolates us from Reddit's markup. Nothing downstream of here
 * touches a shreddit element. If a REQUIRED field is missing we return null and the
 * caller skips the item — a missing post is far better than a broken page.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.model = (() => {
  const C = SHD.C;

  const attr = (el, name) => el.getAttribute(name);
  const num = (el, name) => {
    const v = el.getAttribute(name);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  /**
   * Rejects are EVIDENCE, and they used to be discarded.
   *
   * The file header's policy — a missing post is far better than a broken page — is right,
   * but returning a bare null made "rendered: 0 / errors: 0" a state the error card could
   * not explain: nothing threw, nothing rendered, and nothing said WHY. A report
   * hit exactly that and had to guess, and guessed wrong.
   * Now every null records which required attribute was missing, gate.js prints the tally
   * on the failure screen, and the next such report names the stale contract by itself.
   *
   * Capped: a page of renamed posts rejects every element, and the tally is per-field
   * anyway, so entries past the cap add nothing.
   */
  const rejects = [];
  function reject(kind, missing) {
    if (rejects.length < 200) rejects.push({ kind, missing });
    return null;
  }
  function clearRejects() { rejects.length = 0; }
  function rejectSummary() {
    if (!rejects.length) return '';
    const tally = new Map();
    for (const r of rejects) {
      const key = `${r.kind} missing "${r.missing.join('", "')}"`;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    return [...tally].map(([k, n]) => k.replace(' missing', ` x${n} missing`)).join('; ');
  }

  /**
   * The highest-quality mp4 out of a video post's packaged-media JSON.
   *
   * DEEP-SCANNED, not shape-parsed: every string value anywhere in the JSON that looks
   * like an https mp4 URL is collected, and the tallest rendition wins. The attribute
   * name is the contract; its internal nesting is not — Reddit can restack the JSON
   * without breaking this, and an unparseable value simply returns null, which leaves
   * the post's href exactly what it was before this existed.
   *
   * Height comes from the JSON where the JSON states it, and from the filename where it
   * does not: a rendition object carrying `dimensions.height` is stating the number the
   * filename scan is trying to recover, so reading it settles the ties the scan cannot
   * see — see the comments on the sort below.
   */
  function mp4Of(el) {
    try {
      /* QUERIED, not read: the attribute lives on a nested <shreddit-player>, not on the
         post (captured live). Scoped to this post so a crosspost cannot lend us
         the wrong video — bug 25's lesson, applied before the reshuffle. */
      const host = [...el.querySelectorAll(`[${C.POST_VIDEO_JSON}]`)]
        .find(n => n.closest(C.POST) === el);
      const raw = host && host.getAttribute(C.POST_VIDEO_JSON);
      if (!raw) return null;
      /* Each mp4 string is kept with the height its ENCLOSING object states, when it
         states one. Live shape: `{ source: { url: '…m2-res_462p.mp4?…',
         dimensions: { height: 462, width: 854 } } }`. */
      const found = new Map();                        // url -> stated height, or null
      const statedHeight = (holder) => {
        const h = holder && holder.dimensions && holder.dimensions.height;
        return typeof h === 'number' && isFinite(h) && h > 0 ? h : null;
      };
      const walk = (v, holder) => {
        if (typeof v === 'string') {
          if (/^https:\/\/\S+\.mp4(\?|$)/i.test(v) && !found.has(v)) {
            found.set(v, statedHeight(holder));
          }
        } else if (v && typeof v === 'object') {
          for (const k of Object.keys(v)) walk(v[k], v);
        }
      };
      walk(JSON.parse(raw), null);
      if (!found.size) return null;
      /* The fallback, for renditions that state no dimensions: the largest number in the
         FILENAME, whichever spelling Reddit uses — `m2-res_1920p.mp4` (live) and
         `DASH_720.mp4` (the shape this was first written for) both fall out correctly,
         and an unrecognised name simply ranks 0 and keeps its document order. Ranking on
         DASH_ alone scored every live URL zero and returned the first, which is the
         LOWEST quality Reddit offers. */
      const fileRank = (u) => {
        const file = u.split('?')[0].split('/').pop() || '';
        return Math.max(0, ...(file.match(/\d+/g) || ['0']).map(Number));
      };
      /* Reddit lists a vp9 rendition and an h264 rendition at the SAME height, vp9 first,
         and `m2-vp9-res_462p.mp4` and `m2-res_462p.mp4` score identically under fileRank
         — so with a stable sort the codec was chosen by Reddit's array order, every time,
         by nobody. Measured 2026-08-22: four of six video posts on one sub resolved to a
         vp9 file for exactly that reason. The link is a top-level navigation into the
         browser's own media viewer, so the tie breaks toward the h264 name — a decision
         now, not an accident. */
      const isVp9 = (u) => /vp9/i.test(u.split('?')[0].split('/').pop() || '');
      return [...found]
        .map(([url, stated], i) =>
          ({ url, i, height: stated == null ? fileRank(url) : stated, vp9: isVp9(url) }))
        .sort((a, b) => (b.height - a.height) || (Number(a.vp9) - Number(b.vp9)) || (a.i - b.i))
        [0].url;
    } catch { return null; }
  }

  /** @returns {object|null} */
  function post(el) {
    const A = C.POST_ATTR;
    const id = attr(el, A.id);
    const title = attr(el, A.title);
    const permalink = attr(el, A.permalink);
    if (!id || !title || !permalink) {                 // required triad
      return reject('post',
        [!id && A.id, !title && A.title, !permalink && A.permalink].filter(Boolean));
    }

    const type = attr(el, A.type) || 'text';
    const domain = attr(el, A.domain) || '';
    const isSelf = /^self\./.test(domain) || type === 'text';
    const contentHref = attr(el, A.contentHref);

    // The post's own text, when it has any. NOT an attribute: confirmed live 2026-08-20
    // (Superstonk report) — post text never appears as an attribute on shreddit-post; it is
    // slotted light DOM. Scoped like the comment body below, defensively: a crosspost could
    // plausibly nest another post's markup, and bug 25 is what an unscoped body lookup
    // costs the day the ordering changes.
    const bodyNode = [...el.querySelectorAll(C.POST_BODY)]
      .find(n => n.closest(C.POST) === el) || null;

    /* A video post's outbound link must be WATCHABLE. content-href is a bare v.redd.it
       URL, and Reddit 302s a logged-out session from there straight back to the comments
       page — which we render, whose title links back to v.redd.it: a closed loop with the
       extension on (measured live). The mp4 plays natively in a browser tab.

       PROJECT DECISION 2026-08-22, after three reports: the mp4 is no longer the
       TITLE. Reddit is migrating video to CMAF/HLS and the packaged renditions are dying
       asset by asset — one report measured eight of eight 403 on an asset that still
       advertised them — so a title that resolves to an mp4 is a title that intermittently
       lands on Chrome's `source fetch error`. The title now goes where the redirect loop
       was going to land anyway, the post's own comments page, minus the bounce; the mp4
       gets its own link on the row, where a dead rendition costs one optional click
       instead of the whole post. See open question 9. */
    const videoUrl = type === 'video' ? mp4Of(el) : null;

    /* The post's own picture, at the best resolution the page is offering.
       Reported: an image post's comments page rendered a title and a 70px thumbnail and
       nothing else, and clicking the thumbnail left the layout for Reddit's own /media
       viewer. Two consequences of the same gap — the picture is not an attribute, so
       nothing read it. It is in the light DOM, exactly like a text post's body, and it is
       resolved the same way (bug 49). */
    const imageUrl = type === 'image' ? imageOf(el) : null;

    return {
      kind: 'post',
      id,
      title,
      permalink,
      /* Self posts point at the comments page; link posts point outward — and a video
         post counts as neither, because its outbound URL is a redirect back here.
         An image post is the same case since 2026-08-24, measured: its content-href is a
         bare i.redd.it URL, and BOTH of Reddit's image hosts 307 a logged-out navigation
         into the reddit.com/media viewer (see viewerBound) — so every "link to the
         picture" is a link to the viewer wearing the picture's name. 0.19.0 shipped a
         substitution to the resolved preview URL on exactly that theory, and the
         measurement killed it: preview.redd.it bounces the same way. The comments page,
         which renders the picture inline, is where the reader actually gets to see it —
         video's precedent exactly. Narrow as before: only a viewer-bound link with a
         RESOLVED picture is rerouted, so an image post linking somewhere genuinely
         external (imgur, a blog) is untouched, and a miss falls back untouched. */
      href: (isSelf || type === 'video') ? permalink
        : (type === 'image' && imageUrl && viewerBound(contentHref)) ? permalink
          : (contentHref || permalink),
      /* The watchable rendition, when Reddit has one and has hydrated it. Null is
         ordinary — the player carries the JSON late, or (increasingly) not at all — and
         listing.js re-resolves at click time for exactly that reason. */
      mp4: videoUrl,
      /* The full-size picture, when the page is carrying one. Null is ordinary: a
         thumbnail-only row on a listing has nothing bigger to find, and every consumer
         treats null as "no picture" rather than as an error. */
      image: imageUrl,
      /* A gallery's frames, each at its own best size — peers, not candidates for one
         winner. Empty is ordinary for the same reason `image` is null: a listing row
         carries only the thumbnail, and the consumer renders nothing rather than erring. */
      images: type === 'gallery' ? imagesOf(el) : [],
      /* The bare `v.redd.it/<id>` URL, kept because it is the asset IDENTIFIER even though
         it is useless as a link (it 302s a logged-out reader back to the comments page).
         media.js turns it into a manifest URL; nothing else should make it an href. */
      contentHref,
      isSelf,
      type,
      domain,
      score: num(el, A.score),
      upvoteRatio: num(el, A.upvoteRatio),
      comments: num(el, A.comments) ?? 0,
      created: attr(el, A.created),
      author: attr(el, A.author) || '[deleted]',
      subreddit: attr(el, A.subreddit) || '',
      subredditPrefixed: attr(el, A.subredditPrefixed) || '',
      awards: num(el, A.awards) ?? 0,
      index: num(el, A.index),
      nsfw: nsfwOf(el),
      thumbnail: thumbnailFor(el, type),
      bodyNode,
      // Kept so delegated clicks can find the native controls later.
      source: el
    };
  }

  /**
   * No `thumbnail` attribute exists on modern posts — recon confirmed. We lift the first
   * CONTENT image out of the source subtree instead.
   *
   * Verified 2026-08-12 over 28 live posts: 22/22 non-text posts resolved, 0 false
   * positives. An earlier, looser rule matched `styles.redditmedia.com` (subreddit icons)
   * and `emoji.redditmedia.com` (flair emoji) and gave every text post a bogus thumbnail —
   * hence the host allowlist plus the ancestor exclusion below.
   */
  /**
   * Is this post flagged adult?
   *
   * Written to survive both spellings a custom element can use for a boolean. A framework
   * that binds `?nsfw=${flag}` emits the attribute with an EMPTY value when true and omits
   * it when false; one that binds `nsfw=${flag}` emits the literal strings "true"/"false"
   * and never omits it. Reading truthiness off the value alone gets the first case wrong
   * (empty string is falsy, so every NSFW post reads as safe); reading presence alone gets
   * the second wrong (`nsfw="false"` reads as adult, so EVERY post gets a placeholder).
   * So: absent is safe, "false"/"0" is safe, present-with-anything-else is adult.
   *
   * See C.NSFW_ATTRS for why this consults several names and what confirms it.
   */
  function nsfwOf(el) {
    return C.NSFW_ATTRS.some(name => {
      const v = el.getAttribute(name);
      if (v === null) return false;
      const s = v.trim().toLowerCase();
      return s !== 'false' && s !== '0';
    });
  }

  function thumbnailFor(el, type) {
    if (!SHD.settings.showThumbnails) return null;
    if (type === 'text') return null;
    for (const img of el.querySelectorAll('img')) {
      const host = (img.currentSrc || img.src || '').split('/')[2] || '';
      if (!C.THUMB_HOSTS.test(host)) continue;
      if (img.closest(C.THUMB_EXCLUDE)) continue;
      return img.currentSrc || img.src;
    }
    return null;
  }

  /**
   * Every URL an <img> offers, with the width it claims.
   *
   * srcset is where a full-size version lives when there is one: Reddit serves a
   * responsive set and `src` is usually the small member of it. A `w` descriptor states
   * the width outright; anything else — a bare URL, an `x` descriptor — scores zero, so a
   * set whose sizes cannot be read never outranks one whose sizes can.
   */
  function imageCandidates(img) {
    const out = [];
    for (const part of (img.getAttribute('srcset') || '').split(',')) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) continue;
      const w = /^(\d+)w$/.exec(bits[1] || '');
      out.push({ url: bits[0], w: w ? parseInt(w[1], 10) : 0 });
    }
    const plain = img.currentSrc || img.src;
    if (plain) out.push({ url: plain, w: 0 });
    return out;
  }

  /**
   * The largest picture this post is carrying, or null.
   *
   * The same host allowlist and ancestor exclusion as the thumbnail, for the same reason:
   * a loose match turned every community icon and flair emoji into a picture (bug 1). And
   * scoped to THIS post with closest(), because a post's subtree can contain another
   * post's markup — the lesson from the comment-body lookup (bug 25), applied before a
   * reshuffle rather than after one.
   *
   * Null is the ordinary answer on a listing row, where the only image IS the thumbnail.
   */
  function imageOf(el) {
    let best = null, bestW = -1;
    for (const img of el.querySelectorAll('img')) {
      if (img.closest(C.POST) !== el) continue;
      if (img.closest(C.THUMB_EXCLUDE)) continue;
      for (const c of imageCandidates(img)) {
        const host = (c.url || '').split('/')[2] || '';
        if (!C.THUMB_HOSTS.test(host)) continue;
        if (c.w > bestW) { bestW = c.w; best = c.url; }
      }
    }
    return best;
  }

  /**
   * Every picture a GALLERY post is carrying, one per <img>, each at its own best size.
   *
   * imageOf() above answers "the single largest picture in this post", which is right for
   * an image post and wrong for a gallery — there the frames are peers, and reducing them
   * to the biggest one silently drops the rest. Same scoping, same allowlist, same
   * exclusions; the only difference is the unit of ranking (per element, not per post).
   */
  function imagesOf(el) {
    const out = [];
    for (const img of el.querySelectorAll('img')) {
      if (img.closest(C.POST) !== el) continue;
      if (img.closest(C.THUMB_EXCLUDE)) continue;
      let best = null, bestW = -1;
      for (const c of imageCandidates(img)) {
        const host = (c.url || '').split('/')[2] || '';
        if (!C.THUMB_HOSTS.test(host)) continue;
        if (c.w > bestW) { bestW = c.w; best = c.url; }
      }
      if (best && !out.includes(best)) out.push(best);
    }
    return out;
  }

  /**
   * Does navigating to this URL land the reader in Reddit's /media viewer?
   *
   * MEASURED 2026-08-24, and it reversed this function's original premise. The premise
   * was that i.redd.it/preview.redd.it are "the files themselves" and only reddit.com
   * URLs lead back into Reddit. Live: BOTH image hosts serve an <img> fetch
   * (Accept: image/*) normally and 307-redirect a top-level NAVIGATION
   * (Accept: text/html) to reddit.com/media?url=… — the viewer. Two hosts, four URLs
   * probed, all four; the Accept header is the discriminator. Same pattern as
   * v.redd.it's 302 to the comments page (bug 58), applied to images: there is no URL a
   * logged-out click can reach that shows the bare picture.
   *
   * So the consumer's question is not "which URL escapes the viewer" — none does — but
   * "is this link viewer-bound", in which case the comments page, with the picture
   * rendered inline ON it, is the better destination. Video posts set that precedent.
   * A relative path counts as viewer-bound (same-origin by definition).
   */
  function viewerBound(url) {
    if (!url) return false;
    const host = /^https?:\/\//i.test(url) ? (url.split('/')[2] || '') : '';
    return !host || /(^|\.)reddit\.com$/i.test(host) ||
      /^(i|preview|external-preview)\.redd\.it$/i.test(host);
  }

  /** @returns {object|null} */
  function comment(el) {
    const A = C.COMMENT_ATTR;
    const id = attr(el, A.id);
    if (!id) return reject('comment', [A.id]);

    // Scoped to THIS comment, not just the first match in the subtree.
    //
    // Comments used to be flat siblings, so a bare querySelector could only ever find the
    // element's own body. As of 2026-08-14 they are nested (see ARCHITECTURE §1.4), which
    // means the subtree now contains descendant comments and their bodies too. Reddit
    // currently emits the body BEFORE the child container, so the bare lookup happens to
    // return the right node — by luck of document order, not by construction. Reverse that
    // ordering and every comment renders its first child's text instead of its own.
    const bodyNode = [...el.querySelectorAll(C.COMMENT_BODY)]
      .find(n => n.closest(C.COMMENT) === el) || null;

    return {
      kind: 'comment',
      id,
      postId: attr(el, A.postId),
      author: attr(el, A.author) || '[deleted]',
      score: num(el, A.score),
      created: attr(el, A.created),
      // Comments are FLAT siblings; depth is the only threading signal.
      depth: num(el, A.depth) ?? 0,
      position: num(el, A.position),
      permalink: attr(el, A.permalink),
      awards: num(el, A.awards) ?? 0,
      // We move the rendered body wholesale rather than re-parsing markdown:
      // it is plain light-DOM HTML and carries links, code blocks, quotes intact.
      bodyNode,
      source: el
    };
  }

  /**
   * The community a profile comment's own markup LINKS to, if it links to one.
   *
   * Scoped to the element, shape-validated rather than selector-validated (see
   * C.PROFILE_COMMENT_SUB_LINK): we accept /r/<sub>/ and /r/<sub>/comments/... and reject
   * everything else, so a wiki link, a flair target or a link inside the comment's own
   * body cannot be mistaken for the row's community. The comment BODY is excluded
   * outright — a user quoting "go read /r/somewhere" must not retitle their own row.
   */
  function subredditLinkIn(el) {
    for (const a of el.querySelectorAll(C.PROFILE_COMMENT_SUB_LINK)) {
      if (a.closest(C.PROFILE_COMMENT) !== el) continue;
      if (a.closest(C.PROFILE_COMMENT_BODY)) continue;
      const m = (a.getAttribute('href') || '').match(/^\/r\/([^/?#]+)\/?($|\?|#|comments\/)/);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * The title of the post a profile comment is replying to — old reddit's parent line
   * carried it and ours did not.
   *
   * DERIVED FROM THE THREAD LINK, not from a guessed attribute: an anchor whose href is
   * the thread we already know this comment belongs to, and which is not the comment's own
   * permalink, is by construction the link to the post. Its text is the title. Requires
   * `threadHref` so there is something to match against, skips anchors inside the comment
   * body, and returns null on anything it cannot establish — the row omits the title
   * rather than inventing one, exactly as it does the community.
   */
  function postTitleIn(el, threadHref) {
    if (!threadHref) return null;
    for (const a of el.querySelectorAll(C.PROFILE_COMMENT_POST_LINK)) {
      if (a.closest(C.PROFILE_COMMENT) !== el) continue;
      if (a.closest(C.PROFILE_COMMENT_BODY)) continue;
      const path = (a.getAttribute('href') || '').split('?')[0];
      if (!path.startsWith(threadHref) || /\/comment\//.test(path)) continue;
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return null;
  }

  /**
   * A comment as it appears on a USER PROFILE page — flat, standalone, each one linking
   * back to the thread it lives in.
   *
   * Everything here is defensive because the profile comment CONTRACT IS UNVERIFIED (see
   * C.PROFILE_COMMENT). The attribute names are shreddit-comment's — the only comment
   * attribute set ever captured — and the required pair is id + permalink: a profile
   * comment row is navigation to a thread as much as it is text, and a page of comments
   * we cannot link is not worth rendering over the native one. A reject here is not
   * tolerated the way a listing tolerates one: pipeline.js hands the whole page back to
   * native Reddit on the first profile reject, because on an unverified route a single
   * unreadable element is evidence the contract does not hold, not an outlier.
   *
   * The subreddit and the thread URL are DERIVED from the permalink
   * (/r/<sub>/comments/<post>/<slug>/<comment>/) rather than trusted to exist as
   * attributes — the permalink shape is a contract every capture has agreed on, and it
   * spares this model two more guessed attribute names.
   */
  function profileComment(el) {
    const A = C.PROFILE_COMMENT_ATTR;
    const id = attr(el, A.id);
    const href = attr(el, A.href);

    /* Scoped like every body lookup (bug 25), and REQUIRED unlike a thread comment's: a
       profile row is one comment standing alone, and one without its text is worse than
       no row at all.
       INNERMOST of the candidates, which matters: live testing measured TWO nested `.md`
       nodes per profile comment — 48 across 24 elements — because Reddit wraps the real
       markdown container in an outer div whose LAST class is also `md`
       (`ms-[22px] mt-2xs ps-[10px] md`). Document order returns the WRAPPER, and the
       wrapper's other classes are layout utilities Reddit's own stylesheet still applies
       to our clone (open question 7): a 22px inline-start margin and 10px of padding that
       belong to Reddit's indent, not to ours. Both nodes carry identical text, so this is
       invisible until you look for the box. */
    const bodies = [...el.querySelectorAll(C.PROFILE_COMMENT_BODY)]
      .filter(n => n.closest(C.PROFILE_COMMENT) === el);
    const bodyNode = bodies.find(n => !bodies.some(o => o !== n && n.contains(o)))
      || bodies[0] || null;

    if (!id || !href || !bodyNode) {
      return reject('profile-comment',
        [!id && A.id, !href && A.href, !bodyNode && 'a comment body'].filter(Boolean));
    }

    /* The href carries everything the element does not. Two live shapes, both captured:
       /r/<sub>/comments/<post>/comment/<id>/?context=3   a comment in a subreddit
       /user/<name>/comments/<post>/comment/<id>/?context=3   ...on a PROFILE POST
       Matching both, and capturing which, is what lets the row say where it lives. Note
       the thread base has no slug in this shape — /r/x/comments/<post>/ is the thread. */
    const thread = href.match(/^\/(r|user)\/([^/]+)\/comments\/[^/]+\//);
    const kindOf = thread && thread[1];
    const name = thread && thread[2];
    const owner = (SHD.route && SHD.route.usernameOf()) || null;

    /* WHERE THIS COMMENT LIVES — and why it is not simply `name` above.
       Live testing read "comment in u/spez" on all thirty of /user/spez/'s comments. The
       parse was right and the input was not: that page served EVERY permalink
       user-scoped, so the first path segment is the profile we are standing on, not the
       community the comment is in, and no reading of it can ever be right. Live testing had
       captured the same profile serving /r/<sub>/ hrefs, so both shapes are real and the
       user-scoped one is ambiguous rather than wrong — a comment on someone's PROFILE
       POST is legitimately "u/<name>".
       What separates the two: whose profile we are on. `/user/<someone-else>/` can only
       be a profile post. `/user/<the-profile-owner>/` is the ambiguous case, and there
       the RENDERED subreddit link is the only real evidence on offer — a link Reddit drew
       beats a path Reddit rewrote. If there is none, we say nothing: printing the profile
       owner's own name as the community is the bug, and "comment in" with the wrong thing
       after it is worse than no line. */
    const linkedSub = subredditLinkIn(el);
    let contextLabel = null;
    let contextHome = null;
    if (kindOf === 'r') {
      contextLabel = `r/${name}`;
      contextHome = `/r/${name}/`;
    } else if (linkedSub) {
      contextLabel = `r/${linkedSub}`;
      contextHome = `/r/${linkedSub}/`;
    } else if (kindOf === 'user' && name && name !== owner) {
      contextLabel = `u/${name}`;
      contextHome = `/user/${name}/`;
    }

    // No created attribute exists on this element. A rendered <time> is the only source,
    // and it is optional — a row without a timestamp is still a usable row.
    const timeEl = [...el.querySelectorAll('time[datetime]')]
      .find(n => n.closest(C.PROFILE_COMMENT) === el) || null;

    return {
      kind: 'profileComment',
      id,
      // ?context=3 is Reddit's own default on these links; the bare permalink is it minus
      // the query, so the row can offer both without inventing either.
      permalink: href.split('?')[0],
      contextHref: href,
      threadHref: thread ? thread[0] : null,
      // Where this comment lives, for the row's parent line. `null` when we cannot
      // establish it, and the row simply omits the line rather than guessing.
      contextLabel,
      contextHome,
      // The post being replied to. Old reddit showed it and this did not.
      // Opportunistic like the community link above and null when Reddit's row does not
      // carry one; the row prints what it gets.
      postTitle: postTitleIn(el, thread ? thread[0] : null),
      // A profile page's comments are the profile owner's, by definition — the element
      // carries no author attribute and does not need to.
      author: owner || '[deleted]',
      // Deliberately absent: this element carries no score. Rendering "score hidden" or a
      // zero would both be inventions; the row omits it.
      created: timeEl ? timeEl.getAttribute('datetime') : null,
      bodyNode,
      source: el
    };
  }

  return { post, comment, profileComment, mp4Of, rejects, rejectSummary, clearRejects };
})();
