/**
 * contracts.js — THE SINGLE POINT OF BREAKAGE.
 *
 * Every selector, tag name and attribute name Reddit owns lives here and nowhere else.
 * When Reddit ships a redesign, this is the only file that should need editing.
 *
 * Verified live against reddit.com on 2026-08-12.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.C = {
  /* ---------- page skeleton ---------- */
  APP: 'shreddit-app',
  MAIN: '#main-content',
  RIGHT_SIDEBAR: '#right-sidebar-container',
  SUBGRID: '#subgrid-container',
  HEADER: 'reddit-header-large',
  LEFT_NAV: 'reddit-sidebar-nav, #left-sidebar-container, nav#left-sidebar',

  /* ---------- listings ---------- */
  FEED: 'shreddit-feed',
  POST: 'shreddit-post',
  POST_WRAPPER: 'article',          // shreddit-feed > article > shreddit-post
  /* Ads are <shreddit-ad-post> and do NOT contain a <shreddit-post>, so querying
     POST excludes them for free. Verified: 28 posts scraped, 0 ads captured. */
  AD_POST: 'shreddit-ad-post',
  FEED_SEPARATOR: 'shreddit-feed > hr',
  /* Reddit's own "there is nothing here" panel, which it renders INSIDE the feed in
     place of posts. Captured live 2026-08-20 (r/911truth, logged out): one wrapper div
     whose children are an `<h1 data-testid="no-content">`, a paragraph and a link.

     It is the only affirmative "the feed has loaded and the answer is zero" signal
     Reddit gives us, and that distinction is the whole reason it is a contract rather
     than a heuristic: a feed with no posts in it is either an answer or a page that has
     not arrived yet, and counting posts cannot tell those apart — it just keeps waiting
     (bug 94). The testid is what is matched, not the copy: the wording is Reddit's and
     has already been observed to be wrong for the case it is shown in (it claims the
     community has never had a post while describing a time-filtered range with none),
     so the copy is exactly the thing we replace. */
  FEED_EMPTY: '[data-testid="no-content"]',

  /* Pagination. The trailing partial carries loading="programmatic" — it does NOT
     self-trigger on scroll; Reddit's feed JS calls it. We call it ourselves via its
     public loadContent(). Verified live: 3 posts -> 28 posts in one call. */
  LAZY_LOADER: 'faceplate-partial',
  FEED_PARTIAL: 'shreddit-feed faceplate-partial[loading="programmatic"]',
  /* Comment threads lazy-load the same way. ARCHITECTURE §1.5 recorded 29 pending
     partials on a real thread; we only ever drove the feed's, so anything past the
     first delivered slice of a thread was unreachable. Scoped to the comment tree so a
     stray partial elsewhere on the page cannot be mistaken for more comments.

     IT SELECTS NOTHING THE FALLBACK DOES NOT — and what it matches has moved twice.
     verify:live 2026-08-14 found ZERO in-tree partials with loading="programmatic";
     2026-08-24 found TWO (beside ~19 per-branch loading="action" expanders), so the
     selector matches real elements again. Either way it cannot do more than the broader
     `COMMENT_TREE LAZY_LOADER` clause: it is a strict SUBSET of it, and
     `querySelector('a, b')` returns the first match in DOCUMENT order, not the first
     clause with a match — so listing it first buys no preference. FEED_PARTIAL above
     sits in the same relationship to its own fallback.

     Both are kept anyway, deliberately, for one reason: verify:live asserts on them, and
     "the feed's partial is programmatic" is the fact that explains why pagination does not
     self-trigger at all. Comment continuation itself IS settled now — the WHAT DRIVES A
     COMMENT TREE section measured it live 2026-08-24: subthread expansion, with every
     driven partial removing itself (5/5) and repeated drives making progress. */
  COMMENT_PARTIAL: 'shreddit-comment-tree faceplate-partial[loading="programmatic"]',
  /* The label on Reddit's per-branch reply expander, for the delegated control in
     comments.js. A TEXT test, exceptionally: the control is a plain button/anchor with no
     distinguishing attribute captured. Live copy observed 2026-08-20: "65 more replies",
     "70 more replies", "28 more replies" — counts vary, the phrase does not. English-only,
     like the age-gate matcher; a miss fails safe (no extra control is rendered). */
  MORE_REPLIES_TEXT: /more repl/i,
  /* The comment-sort values Reddit's page accepts in `?sort=`, with old reddit's labels
     for them. Requested twice from live use ("no comment-sort dropdown").

     VERIFIED LIVE 2026-08-24: the classic API's names are accepted. The check is
     verify:live's COMMENT SORT VALUES section — comment ids are base36-sequential over
     time, and ?sort=new delivered a strictly newer median id than ?sort=old on a
     454-comment thread, which an ignored parameter cannot produce (both loads would be
     the identical default slice). The failure stays soft by construction: a value Reddit
     stops recognising falls back to the default order — a link that mis-sorts, never a
     link that breaks — and a future break shows up in that same section as tied medians. */
  COMMENT_SORTS: [
    { id: 'confidence', label: 'best' },
    { id: 'top', label: 'top' },
    { id: 'new', label: 'new' },
    { id: 'controversial', label: 'controversial' },
    { id: 'old', label: 'old' },
    { id: 'qa', label: 'q&a' }
  ],
  /* Video posts. A bare v.redd.it link 302s a LOGGED-OUT session straight back to the
     post's comments page (measured live) — with our layout on, a closed loop: we
     render the destination, whose title links back to v.redd.it.

     CAPTURED LIVE 2026-08-20, and it corrected three guesses at once:
       - the attribute is NOT on <shreddit-post>. It sits on a nested <shreddit-player>,
         so it must be QUERIED for in the post's subtree, never read off the post.
       - it is LAZY: 1 of 4 video posts carried it at first paint, the other three had a
         player with no such attribute yet. So render-time resolution alone cannot work —
         listing.js re-resolves at CLICK time, the same lesson as the vote controls.
       - the mp4 filenames are `m2-res_<height>p.mp4`, not the `DASH_<n>` this was first
         written for. Ranking on DASH_ scored every live URL zero and would have picked
         the FIRST one, which is the LOWEST quality. model.js ranks on the largest number
         in the filename, which covers both spellings.
     The URLs carry a signature and an `e` expiry. It was recorded here as ~12h; MEASURED
     2026-09-01 on a reported post it was about FOUR hours, which is short enough to run out
     inside a long session and far short enough to be dead on any page rendered from
     yesterday's capture. An expired URL is not refused politely — the CDN answers 403 and
     the <video> reports `error.code 4` (SRC_NOT_SUPPORTED) with nothing buffered, which
     looks exactly like a codec fault. So model.mp4Of reads the deadline and drops a
     rendition that has passed it (model.expired), and the manifest below — whose CMAF files
     carry no signature at all — is what plays instead. Never cache one either way. */
  POST_VIDEO_JSON: 'packaged-media-json',
  /* A GIF in a comment or selftext body, as Reddit ships it: a <shreddit-player gif>
     whose only light-DOM <source> is the raw .gif on preview.redd.it — no `type`, no
     `poster` — wrapped in an anchor to the /media viewer. Captured live 2026-08-27
     (bug 88): 8 of 11 players on one thread, every one readyState 0, because a <video>
     cannot decode GIF; with no poster the element paints a solid black box. Our clone
     paints the same box — custom-element upgrade is document-global, so the copy in
     #shd-root comes alive as the same broken player. dom.inlineGifs swaps the clone for
     the element that can actually show what the player was starving: an <img> for a real
     GIF, which is exactly how the comment GIFs that already worked on the same page were
     delivered, and a silent looping <video> for the mp4 delivery below. */
  GIF_PLAYER: 'shreddit-player[gif]',
  /* Which of the two ways Reddit delivers that GIF this one is. Reported live 2026-08-30
     (bug 93), with the audit attached: the player's source was `<name>.gif?width=370&
     format=mp4`, and the file behind it answers 200 with `content-type: video/mp4` — an
     mp4 wearing a `.gif` filename. The extension of the URL says GIF, the QUERY says what
     is actually served, and nothing else can: reading the response header means fetching
     the file first, which this extension does not do (media.js holds its one request, and
     that one is a manifest, not a guess). So the query is the discriminator — `format=mp4`
     goes in a <video>, anything else in an <img>, and a path that already ends `.mp4` is
     covered because the one URL shape that states its format outright should not be the
     one we miss. `format=gif` — bug 88's capture, still live on the same pages — falls
     through to the <img> path unchanged. */
  GIF_MP4_SRC: /[?&]format=mp4(?:&|$)|\.mp4(?:$|[?#])/i,
  /* The asset id inside a video post's `content-href`, and the manifest that lists what
     Reddit will actually serve for it. Added 0.16.0, when the packaged renditions above
     stopped being enough: on a repackaged asset every `DASH_*`/`m2-res_*` file 403s and
     only `CMAF_<n>.mp4` serves, so the attribute above resolves nothing and there is no
     rendition to link to. The manifest names every rendition WITH its width and height,
     which is the one thing that cannot be inferred — the rungs are Reddit's encoding
     choices, not the source's size (one measured asset has 96/220/270/360/480 and no 720
     or 1080), so a constructed name repeats the `DASH_720.mp4` mistake. See media.js. */
  VIDEO_ASSET: /^https?:\/\/v\.redd\.it\/([A-Za-z0-9_-]+)/,
  VIDEO_MANIFEST: 'DASHPlaylist.mpd',
  PARTIAL_LOAD_METHOD: 'loadContent',

  /* Calling loadContent() needs src/core/bridge.js, which runs in the PAGE's main world.
     A content script cannot call it directly — see the header of bridge.js. These are our
     own names, not Reddit's; bridge.js repeats the literals because it has no access to
     this file, and test/run.js asserts the two agree. */
  BRIDGE: {
    request: 'shd:load-more',       // window event, isolated world -> main world
    selKey: 'shdPartialSel',        // <html data-shd-partial-sel>   which element to call
    methodKey: 'shdPartialMethod',  // <html data-shd-partial-method> which method to call
    resultKey: 'shdLoadMore',       // <html data-shd-load-more>      ok | no-partial | ...
    navigated: 'shd:navigated'      // window event, main world -> isolated: a page-realm
                                    // pushState/replaceState just committed — re-read location
  },

  /* Thumbnail resolution. Host allowlist + ancestor exclusion; see model.thumbnailFor.
     The allowlist exists because a loose match made every text post show a subreddit icon
     or a flair emoji (bug 1). Keep it an allowlist — never relax to *.redditmedia.com,
     which is exactly what went wrong: `styles.` is community icons and `emoji.` is flair.
     `<letter>.thumbs.redditmedia.com` IS the post-thumbnail CDN and was being rejected
     along with them; added 2026-08-14 after verify:live observed it live. */
  THUMB_HOSTS: /^((preview|i|external-preview)\.redd\.it|[a-z]\.thumbs\.redditmedia\.com)$/,
  THUMB_EXCLUDE: 'shreddit-post-flair, faceplate-hovercard, shreddit-join-button, a[href^="/user/"]',

  /* Observed post-type values: text, link, image, gallery, video, multi_media, crosspost
     (crosspost added 2026-08-14 by npm run verify:live; falls through the same non-text
     path as link/image/etc. in model.js. The fallback is covered rather than accidental:
     t3_crosspost1 in test/fixtures.js carries the live shape, and run.js asserts the row
     renders with the right thumbnail host). */
  /* NOT USED BY ANYTHING. model.js decides self-vs-link inline with
     `/^self\./.test(domain) || type === 'text'`, so editing this list changes no behaviour
     — a trap for whoever assumes otherwise. Left in place rather than deleted because it
     documents the intent; wire it into model.js or drop it, but do not trust it as live. */
  SELF_TYPES: ['text'],

  /* Attributes carried by <shreddit-post>. Confirmed present on both text and link posts.
     award-icon-url and is-link-post were dropped 2026-08-14: verify:live found neither
     present on every post any more, and neither was read anywhere downstream (isLink was
     never even copied into the model; awardIcon was copied but never rendered). A mapping
     to an attribute nothing consumes is not a contract, it is a false alarm waiting to
     happen — removed rather than chased. */
  POST_ATTR: {
    id: 'id',                              // t3_xxxxx
    title: 'post-title',
    permalink: 'permalink',                // /r/sub/comments/id/slug/
    contentHref: 'content-href',           // outbound URL for link posts
    type: 'post-type',                     // text | link | image | gallery | video | crosspost
    score: 'score',
    upvoteRatio: 'upvote-ratio',
    comments: 'comment-count',
    created: 'created-timestamp',          // ISO 8601
    domain: 'domain',                      // "self.Layoffs" or "theregister.com"
    author: 'author',
    subreddit: 'subreddit-name',
    subredditPrefixed: 'subreddit-prefixed-name',
    icon: 'icon',                          // optional live: 27/28 carried it, 2026-08-24
    /* `award-count` was here until 2026-08-24, kept as "still present live, a usable
       hook". A live listing then carried it on 0/28 posts — while comments still carry
       it — so the post mapping failed bug 24's own test twice over: unconsumed AND
       absent. Removed from POST_ATTR and the post model; COMMENT_ATTR keeps its copy,
       which the same day's thread run measured present 25/25. */
    index: 'feedindex'
  },

  /**
   * How a post says it is adult content.
   *
   * WHY IT MATTERS: modern Reddit blurs NSFW thumbnails in the feed for logged-out readers.
   * We do not restyle Reddit's DOM — we lift the image URL out of the post and render it
   * ourselves — so that blur is bypassed and the image lands full-size in our list. Found on
   * a graphic war-footage subreddit, logged out, which is the case where getting this wrong
   * actually costs someone something.
   *
   * VERIFIED LIVE 2026-08-18 on /r/CombatFootage/, logged out, 28 posts, 1 flagged:
   *
   *     adult post   nsfw=""      (attribute present, EMPTY string)
   *     safe post    (absent)     getAttribute -> null
   *
   * `is-nsfw`, `over-18` and `over18` were guesses and appear nowhere; the list is collapsed
   * to the one real name, because a list of guesses is not a contract. It stays an array so
   * a rename is a one-word edit, and `verify:live` now fails on any adult-looking attribute
   * it does not recognise — which is what actually protects against a rename. Carrying three
   * more unobserved spellings never did: it only helps if Reddit renames to one of exactly
   * those three, and it silently widens what counts as adult in the meantime.
   *
   * THE EMPTY STRING IS THE WHOLE POINT. `""` is falsy, so the obvious implementation —
   * `if (el.getAttribute('nsfw'))` — reads every adult post as safe and renders every
   * graphic thumbnail full-size. See nsfwOf() in model.js, which tests for ABSENCE and for
   * the literal "false"/"0" instead, so it survives both spellings a custom element can use
   * for a boolean.
   */
  NSFW_ATTRS: ['nsfw'],

  /**
   * The post's own rendered text, for the comments page.
   *
   * Post content is NOT an attribute — confirmed live 2026-08-20 (Superstonk report, and
   * consistent with every capture since): shreddit-post carries title/score/author/etc as
   * attributes, but the selftext arrives as slotted light DOM, `div[slot="text-body"]`
   * holding Reddit's rendered `.md` markup. Same deal as COMMENT_BODY, so it gets the same
   * treatment: clone the rendered node, never re-parse markdown, and scope the lookup to
   * the post that owns it.
   */
  POST_BODY: '[slot="text-body"]',

  /* Native controls we delegate clicks to. Resolved AT CLICK TIME — the action bar
     lives inside a shreddit-async-loader and is not present at first paint. */
  NATIVE: {
    upvote: 'button[upvote], button[aria-label*="upvote" i]',
    downvote: 'button[downvote], button[aria-label*="downvote" i]',
    overflow: 'shreddit-post-overflow-menu',
    textBody: 'shreddit-post-text-body',
    titleLink: 'a[slot="title"]',
    fullPostLink: 'a[slot="full-post-link"]'
  },

  /* ---------- comments ---------- */
  COMMENT_TREE: 'shreddit-comment-tree',
  COMMENT: 'shreddit-comment',
  COMMENT_ATTR: {
    id: 'thingid',                   // t1_xxxxx
    postId: 'postid',
    author: 'author',
    score: 'score',
    created: 'created',              // ISO 8601
    /* The one threading signal that has stayed true. Comments were flat siblings in
       2026-08-12 and are DOM-nested as of 2026-08-14, and in both shapes `depth` describes
       the thread correctly — verified 25/25 against DOM nesting. Build the tree from this,
       never from the DOM shape. See ARCHITECTURE §1.4. */
    depth: 'depth',
    position: 'comment-position',
    parentPositions: 'comment-parent-positions',
    permalink: 'permalink',
    contentType: 'content-type',
    awards: 'award-count'
  },
  COMMENT_BODY: '[slot="comment"]',
  /* CANDIDATE, unverified live — deliberately NOT in COMMENT_ATTR, whose entries
     verify:live requires on EVERY comment; this one is expected on none of most threads.
     Reported 2026-08-27 (bug 89): subreddits that hide young comments' scores ship a
     placeholder score="1" — so every comment on an active thread read "1 point" — with
     `score_hidden: true` confirmed in the thread's own JSON. Whether the ELEMENT mirrors
     the flag is unmeasured (the report audited the JSON, not the attributes);
     `score-hidden` is the kebab-case mapping every other JSON field on this element
     follows. Read as PRESENCE, and fail-safe by construction: if Reddit never renders
     the attribute, behaviour is exactly today's — the placeholder shows — and
     verify:live's COMMENT SCORE HIDING note is what settles the name. */
  COMMENT_SCORE_HIDDEN: 'score-hidden',

  /* ---------- user profiles ---------- */
  /**
   * The element a PROFILE page's comments arrive in.
   *
   * CAPTURED LIVE 2026-08-21, on three profiles — /user/spez/ (30
   * comments), /user/GallowBoob/ (4) and /user/-eDgAR-/ (4) — all agreeing. The TAG was
   * guessed right in 0.10.0; everything else about it was wrong, which is why every live
   * profile handed back with `profile-unreadable`. It shares NOTHING with
   * `<shreddit-comment>`:
   *
   *     comment-id="t1_p1wosm9"      NOT thingid
   *     href="/r/RoastMe/comments/1u8nbai/comment/os9obnq/?context=3"   NOT permalink
   *     data-feed-element-id, reload-url, item-state, telemetry-*
   *     NO author, NO score, NO created, NO depth attribute at all
   *     NO [slot="comment"] child — hasSlotComment was false on every one
   *
   * So the reject was the design working: the element was found and stamped (the capture
   * shows `data-shd=done` on it), then rejected for want of `thingid`/`permalink`.
   *
   * Note what is NOT here and has to be derived — see model.profileComment():
   *   author      the profile owner. A profile page's comments are all theirs by
   *               definition, so the route supplies it.
   *   subreddit   only inferable from the href path, which comes in TWO shapes:
   *               /r/<sub>/comments/... and /user/<name>/comments/... (a comment on a
   *               PROFILE POST). Both are real; the fixture carries both.
   *   score       nowhere. Omitted rather than invented.
   *   created     no attribute; a <time datetime> inside the element is the only hope,
   *               and it is optional.
   */
  PROFILE_COMMENT: 'shreddit-profile-comment',
  PROFILE_COMMENT_ATTR: {
    id: 'comment-id',                // t1_xxxxx
    href: 'href'                     // already ?context=3 — permalink is this minus the query
  },
  /**
   * Where a profile comment's rendered text lives. CANDIDATES, in preference order, and
   * this is the one part of the profile contract still unmeasured: live testing established
   * that `[slot="comment"]` is NOT it (hasSlotComment: false on every captured element)
   * but did not dump the element's inner DOM. `.md` is Reddit's markdown container class,
   * which every capture of every OTHER comment body has carried, so it is the strong
   * candidate rather than a shot in the dark.
   *
   * A body is REQUIRED by model.profileComment(), deliberately: a comment row without its
   * text is worse than no row, so if this selector is wrong the page hands back rather
   * than rendering empty rows. Being wrong here costs the feature, not the page.
   */
  PROFILE_COMMENT_BODY: '[slot="comment"], .md',
  /**
   * Where a profile comment says WHICH COMMUNITY it is in, and WHAT POST it replies to.
   *
   * Both are OPPORTUNISTIC and neither is a verified contract — read the note on
   * PROFILE_COMMENT above and then this, because the two captures we have disagree:
   *
   *   2026-08-21, /user/spez/   href="/r/RoastMe/comments/1u8nbai/comment/os9obnq/?context=3"
   *   2026-08-22, /user/spez/   href="/user/spez/comments/1vgbkge/comment/p1wosm9/?context=3"
   *
   * Same profile, one day apart, and the second shape is user-scoped for EVERY comment on
   * the page — which is why deriving the community from the href's first segment printed
   * "comment in u/spez" thirty times out of thirty (live testing, bug 2). A permalink that a
   * profile page rewrites to be about the profile cannot tell us where the comment lives,
   * and no amount of parsing changes that.
   *
   * So these look for the RENDERED links instead: a real anchor to /r/<sub>/ is evidence,
   * where a rewritten path is not. They are deliberately loose — a bare prefix, validated
   * by shape in model.profileComment() rather than by a longer selector — because nothing
   * about the surrounding markup has been captured and a specific selector built on a
   * guess fails silently. A miss costs the parent line and nothing else: model.js omits
   * what it cannot establish rather than falling back to the answer we know is wrong.
   */
  PROFILE_COMMENT_SUB_LINK: 'a[href^="/r/"]',
  PROFILE_COMMENT_POST_LINK: 'a[href*="/comments/"]',

  /* Reddit locks body scroll while one of its own modals is up, and the 18+ age gate is one.
     This is the ONLY usable signal for it — captured live 2026-08-14 on a real 18+ subreddit:

       body.rpl-scroll-lock   present only while the gate is showing, gone once dismissed
       body overflow          "hidden" during, "hidden scroll" otherwise
       shreddit-app           gets NEITHER aria-hidden NOR inert — no accessibility signal
       role="dialog"          useless: ten matched on the live page, all hovercards and
                              tooltips, and the real gate was not among them

     The gate itself is `div.dialog-panel` inside a shadow root within shreddit-app, with its
     buttons as light-DOM children projected through a <slot>. We deliberately do not select
     on any of that — it is Reddit's internal component structure and far more likely to churn
     than a scroll lock, which has to exist for as long as modals do.

     `rpl-` is Reddit's design-system prefix, so this covers every Reddit modal, not just the
     age gate. POLICY (project decision, 2026-08-20): every one of them is suppressed — the
     layout never yields to a popup, and gate.js strips this class wherever it appears on a
     page we are rendering so the scroll keeps working underneath. The earlier policy
     (stand aside so the user can answer) lives on only in the engineering log's history, bugs 30-38.
     The one modal that is REMOVED outright rather than merely hidden is NATIVE_UPSELL
     directly below — left in the DOM it re-raises its lock. */
  NATIVE_MODAL_CLASS: 'rpl-scroll-lock',

  /**
   * The 18+ age gate, for ANSWERING it. Policy decision 2026-08-20: when the gate can be
   * identified with confidence, the extension clicks Reddit's own affirmative button. That is strictly better than hiding
   * the gate — Reddit clears its own lock, remembers the answer, and the pagination
   * endpoint serves an attested session, which retires the suppress-only open question.
   *
   * Anatomy from the 2026-08-18 live capture: the host is a direct child of shreddit-app
   * carrying class `configured-xpromo` (NEVER anchor on its full id — the `bypassable` /
   * `desktop` suffixes are variant names), with an open shadow root whose panel wraps a
   * <slot> — so the BUTTONS ARE LIGHT-DOM and a plain querySelectorAll('button') on the
   * host reaches them from the isolated world.
   *
   * AFFIRM/DECLINE are text tests because no stable attribute was captured. THE TRAP: a
   * decline button's text can legitimately contain "18" ("No, I am under 18"), so a bare
   * /18/ match clicks the wrong button — and the wrong button NAVIGATES AWAY, which is
   * the one failure mode worse than doing nothing. gate.js therefore clicks only when
   * EXACTLY ONE button matches affirm and not decline; any other outcome falls back to
   * suppression, the pre-click behaviour.
   */
  AGE_GATE: {
    host: '.configured-xpromo',
    affirm: /\byes\b|\bover\s*18\b/i,
    decline: /\bno\b|\bunder\b|\bback\b|\bleave\b/i
  },

  /* The exception. Captured live: `desktop_auth_blocking_upsell`, a login/signup upsell that
     fires client-side roughly 30s after page load — not on scroll, not on any interaction,
     confirmed twice with scrollY===0. It sets the SAME rpl-scroll-lock class the age gate
     does, so the default "stand aside" policy above would apply to it too. That is wrong
     here specifically: unlike the age gate, this one carries no close control, and neither
     a real Escape keypress nor clicking its own dim overlay does anything — it is marked
     `blocking` and means it. Standing aside would trap a logged-out reader behind an
     unremovable "Get Started" / "I already have an account" wall with no way back except
     signing up — precisely the affordance the scope section of the README says never to add,
     and worse than doing nothing at all: without Sheddit the reader is at least looking at
     Reddit's own broken UX, not one we handed them.

     So this one specific, verified case is REMOVED rather than deferred to — see
     gate.suppressKnownUpsells(). The general "stand aside" path stays the default for
     everything else: an unknown modal might be something the user genuinely has to resolve
     (a real content warning, a CAPTCHA), and generalising "suppress every blocking modal"
     from this one example would be exactly the wrong lesson to take from it.

     Delivery mechanism, for context (not selected on — see the note on why below): the page
     ships a `<template id="deferred-desktop_auth_blocking_upsell">` inert in the initial
     HTML, plus a `<faceplate-partial name="ActivateExperience_..." loading="programmatic">`
     carrying `<input name="experienceKey" value="desktop_auth_blocking_upsell">` as a direct
     child of shreddit-app. ~30s in, that partial fetches
     `/svc/shreddit/partial/<hash>/activate-experience`, whose response clones the template
     into a plain <div>; the resulting custom element's own lifecycle calls a `showModal()`-
     style method immediately. Nothing client-side gates it — no cookie or localStorage key
     changed before/after across two tests, and it re-fired on every reload.

     `nodes` below is deliberately the STABLE ids only. The loader/partial name hashes seen
     live (`Xk9dTu`, `Zfxklh`) are build-specific and will rotate on Reddit's next deploy;
     anchoring on them would break silently. Both elements are direct children of
     shreddit-app, matching the age gate's shape, and BOTH must be selected: the host
     (`desktop-dynamic-upsell-modal`) renders nothing itself — the actual visible dialog is
     the portaled `#desktop-dynamic-upsell-dialog` sibling, and hiding the host alone was
     confirmed live to do nothing.

     KNOWN LIMITATION, unverified because it has never been observed: an 18+ age gate and
     this upsell being up AT THE SAME TIME. Removing the upsell also clears rpl-scroll-lock,
     because that is the only way to stop deferring to a wall we just deleted — but if a real
     age gate were also showing, clearing it would un-defer and re-hide the gate, which is
     bug 30 all over again. There is no second signal to tell the two apart: the age gate is
     `div.dialog-panel` inside a shadow root, `role="dialog"` matched ten unrelated hovercards
     on the live page, and shreddit-app carries neither aria-hidden nor inert. The common case
     (upsell alone) is handled correctly and the alternative — never clearing the class — is
     wrong in that far more likely case, so this is deliberate. If the pair is ever seen
     together, that is the moment to find a real discriminator, not before. */
  NATIVE_UPSELL: {
    nodes: '#desktop-dynamic-upsell-dialog, desktop-dynamic-upsell-modal'
  },

  /* ---------- our own markers ---------- */
  MARK: 'data-shd',                  // stamped "done" on consumed source elements
  ROOT_ID: 'shd-root',
  BODY_CLASS: 'shd-active'
};

/* Feature toggles; overridden from chrome.storage.sync by pipeline.js */
SHD.settings = {
  listing: true,
  comments: true,
  chrome: true,
  /* User profile pages (/user/<name>/ and its comments/submitted tabs). In scope by owner
     decision 2026-08-21; the profile COMMENT contract is unverified (see C.PROFILE_COMMENT),
     so a profile that cannot be read hands back native Reddit quietly rather than failing. */
  profiles: true,
  compactRows: true,
  showThumbnails: true,
  /* Adult-content thumbnails, off by default — which is both the safer default and the
     faithful one. Reddit blurs them in its own feed for logged-out readers and old reddit
     hid them behind a placeholder tile unless you opted in, so fidelity and not putting
     graphic imagery in front of someone who did not ask for it agree here, the same way
     they did for save/report. `true` shows the real image, as the opt-in did. */
  showNsfwThumbnails: false,
  autoPaginate: true,       // false => "load more" becomes a manual button
  /* Play video inside the comments page instead of only linking to it. This is the ONE
     setting that costs a network request — one GET of a static manifest per video post
     opened, and only then (see media.js and PRIVACY.md). On by default because without it
     a repackaged asset is simply unwatchable with the extension on, which is the bug that
     prompted it; a reader who would rather the extension keep making no requests at all
     turns it off here and gets the pre-0.16.0 behaviour exactly. Since 0.17.0 the player
     also carries the post's SOUND, which on a CMAF asset is a second file played alongside
     the picture — still one request of ours, the manifest, which names both. */
  inlineVideo: true,
  /* Show the post's own picture: open on its comments page, and behind old reddit's
     expando on a listing row. Costs no request of ours — the URL is already in the page
     and the browser fetches the file the same way it fetches a thumbnail, on the row only
     once the reader opens it.
     Adult posts are NOT covered by this: they answer to showNsfwThumbnails above, exactly
     as the thumbnail does, because rendering our own <img> is what walks past the blur
     Reddit applies for logged-out readers and a full-size copy is that same bypass. Both
     settings must say yes. */
  inlineImages: true,
  /* Send a link to old.reddit.com to www.reddit.com instead, behind an interstitial that
     says so. On by default because old.reddit.com stopped serving logged-out readers —
     every path there answers with a login wall — and a Reddit link that dead-ends is
     blamed on the extension that is installed, not on the host that retired. Turn it off
     and old.reddit.com is left exactly as it is, which is what a reader who can still log
     in there wants.

     The one setting no code in this file's world ever reads: it belongs to
     src/core/oldreddit.js, which ships ALONE on old.reddit.com and repeats the default
     rather than being handed 500 lines of selectors for a page it is leaving. test/run.js
     asserts the two agree — the arrangement bridge.js has with BRIDGE. */
  redirectOldReddit: true,
  /* Which palette to paint in. The ids live in src/config/themes.js, which also owns the
     fallback: anything not on that list resolves to 'classic'. This is the one setting
     that is not a boolean, and the only one a page can change by itself — the header's
     theme buttons write it. */
  theme: 'classic'
};

/* There is deliberately no `pruneAfterRender`. It shipped as a documented memory
   mitigation whose implementation was an empty callback, and it cannot be implemented as
   specified: vote delegation resolves Reddit's native controls out of `m.source` AT CLICK
   TIME (ARCHITECTURE §5), so detaching a rendered post's subtree is exactly what breaks
   voting on every post the user has scrolled past. Reddit's own infinite scroll retains
   the same nodes, so we are not making the page heavier than it would otherwise be. If
   memory ever needs capping, drop whole rendered ROWS off the top of #siteTable and let
   the source elements go with them — do not gut live posts. */
