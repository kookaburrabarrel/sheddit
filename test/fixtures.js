/**
 * fixtures.js — synthetic Reddit pages built from LIVE-OBSERVED structure.
 *
 * Captured from reddit.com on 2026-08-12. Our code reads only attributes and a small set
 * of descendant <img> tags, so a fixture that reproduces those faithfully exercises the
 * real contract. Every trap below was seen on the live page:
 *
 *   - styles.redditmedia.com  → subreddit icon      (must NOT become a thumbnail)
 *   - emoji.redditmedia.com   → flair emoji         (must NOT become a thumbnail)
 *   - preview.redd.it         → real content image  (SHOULD become a thumbnail)
 *   - an avatar under a[href^="/user/"]             (must NOT become a thumbnail)
 *   - <shreddit-ad-post> containing NO <shreddit-post>
 *   - <faceplate-partial loading="programmatic"> as the pagination handle
 *   - comments as FLAT siblings carrying depth=
 */

const POSTS = [
  {
    id: 't3_gallery1', type: 'gallery', title: 'Bubble Boy lived in a sterile environment',
    permalink: '/r/interesting/comments/gallery1/bubble_boy/',
    contentHref: 'https://www.reddit.com/gallery/gallery1',
    score: '12247', comments: '1270', domain: 'reddit.com',
    author: 'Wonderfulhumanss', sub: 'interesting',
    /* Two real gallery frames with responsive sets, beside the community-icon and flair
       decoys bug 1 is about. Each frame lists its LARGEST midway (640/1280/960) so a
       first-or-last resolver picks visibly wrong, and the two frames must BOTH survive —
       a gallery reduced to one picture is the failure the comments-page stack asserts
       against. */
    imgs: ['styles.redditmedia.com/t5_2qib0/styles/communityIcon_x.png',
           'emoji.redditmedia.com/abc_t5_3nqvj/snoo_sim.png',
           { src: 'preview.redd.it/bubble-boy-photo.jpg',
             srcset: 'https://preview.redd.it/bubble-1-640.jpg 640w, ' +
                     'https://preview.redd.it/bubble-1-1280.jpg 1280w, ' +
                     'https://preview.redd.it/bubble-1-960.jpg 960w' },
           { src: 'preview.redd.it/bubble-boy-photo-2.jpg',
             srcset: 'https://preview.redd.it/bubble-2-640.jpg 640w, ' +
                     'https://preview.redd.it/bubble-2-1280.jpg 1280w, ' +
                     'https://preview.redd.it/bubble-2-960.jpg 960w' }]
  },
  {
    id: 't3_text1', type: 'text', title: 'Got Laid Off, Took My 2-Year-Old Son to Return My Laptop',
    permalink: '/r/Layoffs/comments/text1/got_laid_off/',
    contentHref: 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/',
    score: '8479', comments: '1115', domain: 'self.Layoffs',
    author: 'rockpaperblr', sub: 'Layoffs',
    // Text post with ONLY decoy images — the old selector gave this a bogus thumbnail.
    imgs: ['styles.redditmedia.com/t5_xxx/styles/communityIcon_y.png',
           'emoji.redditmedia.com/def_t5_yyy/snoo_wave.png']
  },
  {
    id: 't3_link1', type: 'link', title: "NASA Forced to Confirm Earth's Gravity Will Not Be Cancelled",
    permalink: '/r/nottheonion/comments/link1/nasa/',
    contentHref: 'https://fashiontimes.co.uk/articles/nasa-gravity',
    score: '1867', comments: '182', domain: 'fashiontimes.co.uk',
    author: 'kleudorian', sub: 'nottheonion',
    imgs: ['external-preview.redd.it/nasa-thumb.jpg']
  },
  {
    /* An image post as one was REPORTED live: the comments page showed a title and a 70px
       thumbnail and nothing else, and clicking the thumbnail left the layout for Reddit's
       own /media viewer. So content-href here is that viewer URL rather than a direct
       image link — which is the shape that makes the substitution in model.post necessary,
       and the shape the old fixture could not express, because it assumed content-href was
       already the picture.

       The responsive set lists the LARGEST IN THE MIDDLE, deliberately. A resolver that
       takes the first entry, or the last, picks wrong and the fixture says so; only one
       that reads the `w` descriptors gets 1080. Same trap the video renditions carry.

       Still a GUESS in one respect, and the reason verify:live gained an IMAGE POSTS
       section: the viewer URL is inferred from what clicking did, not from a capture, and
       nobody has recorded where a live comments page keeps the full-size file. A wrong
       guess costs the picture and nothing else — every path falls back to what shipped
       before. */
    id: 't3_image1', type: 'image', title: 'A very good dog',
    permalink: '/r/aww/comments/image1/a_very_good_dog/',
    contentHref: 'https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fgooddog.jpg',
    score: '43110', comments: '902', domain: 'i.redd.it',
    author: 'dogperson', sub: 'aww',
    imgs: [{
      src: 'i.redd.it/gooddog.jpg',
      srcset: 'https://preview.redd.it/gooddog-320.jpg 320w, ' +
              'https://preview.redd.it/gooddog-1080.jpg 1080w, ' +
              'https://preview.redd.it/gooddog-640.jpg 640w'
    }]
  },
  {
    id: 't3_video1', type: 'video', title: 'Timelapse of a thunderstorm',
    /* The LIVE shape (captured live testing, extended by a report 2026-08-22): the JSON
       hangs off a nested <shreddit-player>, NOT the post element, and the filenames are
       `m2-res_<height>p.mp4`. Renditions are listed LOWEST-FIRST on purpose — an
       implementation that takes the first URL, or that ranks on `DASH_<n>` and scores
       these all zero, picks 392p and fails here.

       The 1080 PAIR is the later capture, and it is the trap: Reddit offers a vp9 and an
       h264 rendition at the same height, vp9 first, and both filenames score 1080 under a
       largest-number-in-the-filename scan. A fixture with one rendition per height cannot
       tell a chosen codec from an array-order accident. `dimensions` carries the number
       the filename scan is recovering, which is what settles the tie. */
    videoJson: { playbackMp4s: { duration: 22, permutations: [
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_392p.mp4?m=DASHPlaylist&e=1787288400&s=sig',
                  dimensions: { height: 392, width: 696 } } },
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-vp9-res_1080p.mp4?m=DASHPlaylist&e=1787288400&s=sig',
                  dimensions: { height: 1080, width: 1920 } } },
      { source: { url: 'https://packaged-media.redd.it/storm/pb/m2-res_1080p.mp4?m=DASHPlaylist&e=1787288400&s=sig',
                  dimensions: { height: 1080, width: 1920 } } }
    ] } },
    permalink: '/r/videos/comments/video1/timelapse/',
    contentHref: 'https://v.redd.it/storm',
    score: '221', comments: '17', domain: 'v.redd.it',
    author: 'skywatcher', sub: 'videos',
    imgs: ['preview.redd.it/storm-poster.jpg']
  },
  {
    // Observed live; resolves no thumbnail and must fall back to a placeholder.
    id: 't3_multi1', type: 'multi_media', title: 'Mixed media post',
    permalink: '/r/pics/comments/multi1/mixed/',
    contentHref: 'https://www.reddit.com/r/pics/comments/multi1/mixed/',
    score: '55', comments: '3', domain: 'reddit.com',
    author: 'mixer', sub: 'pics',
    imgs: []
  },
  {
    /* crosspost — observed live 2026-08-14 and previously uncovered by any fixture. Carries
       a b.thumbs.redditmedia.com thumbnail, which the host allowlist used to reject along
       with the styles./emoji. decoys, so these posts silently fell back to a placeholder. */
    id: 't3_crosspost1', type: 'crosspost', title: 'Crossposted from somewhere else',
    permalink: '/r/programming/comments/crosspost1/xpost/',
    contentHref: 'https://www.reddit.com/r/original/comments/abc/thing/',
    score: '412', comments: '33', domain: 'reddit.com',
    author: 'xposter', sub: 'programming',
    imgs: ['styles.redditmedia.com/t5_zzz/styles/communityIcon_z.png',
           'b.thumbs.redditmedia.com/some-thumbnail-hash.jpg']
  },
  {
    /* Adult content. `nsfw: true` renders the attribute with an EMPTY value, which is how a
       framework emits a boolean it has bound as present/absent — and an empty string is
       falsy, so reading truthiness off the value alone marks every adult post as safe. The
       post also carries a perfectly resolvable thumbnail, because the bug being guarded is
       that we lift that URL and render it ourselves, walking straight past the blur Reddit
       applies to its own NSFW thumbnails for logged-out readers. */
    id: 't3_nsfw1', type: 'image', title: 'Graphic footage from the front',
    permalink: '/r/UkraineWarVideoReport/comments/nsfw1/footage/',
    contentHref: 'https://i.redd.it/frontline.jpg',
    score: '1204', comments: '88', domain: 'i.redd.it',
    author: 'reporter', sub: 'UkraineWarVideoReport',
    imgs: ['i.redd.it/frontline.jpg'], nsfw: true
  },
  {
    /* The other spelling, and the more dangerous one to get wrong: a framework that binds
       the attribute as a STRING always emits it, so `nsfw="false"` is what a safe post
       looks like. Treating mere presence as adult would put a placeholder over every
       thumbnail in the feed. */
    id: 't3_safeflag1', type: 'link', title: 'Post that explicitly says it is not adult',
    permalink: '/r/test/comments/safeflag1/post/',
    contentHref: 'https://example.com/safe',
    score: '12', comments: '1', domain: 'example.com',
    author: 'someone', sub: 'test',
    imgs: ['preview.redd.it/safe-thumb.jpg'], nsfw: 'false'
  },
  {
    /* THE PATHOLOGICAL TITLE, and it is not synthetic: live testing measured the live front
       page and found rows at 77, 79, 94, 100, 113 and 117px against a suite that had only
       ever seen titles which fit — every fixture title above is one or two lines wide, so
       "rows are 72px" was proved against the easy case and asserted as an invariant. On
       /r/todayilearned, where long titles are the norm, almost no row is 72px at all.
       This title wraps to three lines at 1280px in every theme, and it carries an
       UNBREAKABLE 62-character token, which is the separate hazard: a word with no break
       opportunity cannot be wrapped by the layout at all, so it is what pushes a column
       past its own right edge if anything does. Together they are what the geometry suite
       measures the row against — see LAYOUT GEOMETRY — ROW HEIGHT. */
    id: 't3_longtitle1', type: 'link',
    title: 'TIL that in 1958 a United States Air Force B-47 bomber accidentally dropped an ' +
           'unarmed nuclear weapon on a family garden in Mars Bluff, South Carolina, ' +
           'destroying the house and injuring six people, and the family later sued for ' +
           'fifty-four thousand dollars over the incident at ' +
           'https://en.wikipedia.org/wiki/1958_Mars_Bluff_BX_nuclear_weapon_loss_incident',
    permalink: '/r/todayilearned/comments/longtitle1/til_mars_bluff/',
    contentHref: 'https://example.org/mars-bluff',
    score: '18586', comments: '742', domain: 'example.org',
    author: 'historybuff', sub: 'todayilearned',
    imgs: ['preview.redd.it/mars-bluff-thumb.jpg']
  },
  {
    // Avatar trap: a content-host image that is nonetheless inside a user link.
    id: 't3_avatar1', type: 'link', title: 'Post whose only redd.it image is an avatar',
    permalink: '/r/test/comments/avatar1/post/',
    contentHref: 'https://example.com/article',
    score: '9', comments: '0', domain: 'example.com',
    author: 'someone', sub: 'test',
    imgs: [], avatarImg: 'i.redd.it/avatar-of-someone.png'
  }
];

/** depth sequence taken from the live /r/programming thread (24 comments). */
const COMMENT_DEPTHS = [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 0, 1, 2, 3, 0, 1, 0, 0, 1, 2, 2, 0, 1];


/**
 * A faceplate-partial with a REAL loadContent(), defined as a page custom element.
 *
 * Nothing in the suite used to do this, and that is precisely how pagination shipped
 * broken: the fake partial in the plain fixture is an unknown element with no methods, so
 * `typeof fp.loadContent !== 'function'` was true for the right reason in the harness and
 * the wrong reason in the packed extension. With a real custom element the two diverge —
 * the page defines the method in the MAIN world, and an isolated content script cannot
 * see it without src/core/bridge.js.
 *
 * Appends `PAGE_SIZE` posts and a fresh partial per call, the way Reddit's does.
 */
const PAGER_SCRIPT = `
(() => {
  const PAGE_SIZE = 3;
  window.__shdPager = { loads: 0, times: [] };
  class ShdFakePartial extends HTMLElement {
    loadContent() {
      const st = window.__shdPager;
      st.loads++; st.times.push(Date.now());
      const feed = document.querySelector('shreddit-feed');
      if (!feed) return;
      const page = st.loads;
      for (let i = 0; i < PAGE_SIZE; i++) {
        const art = document.createElement('article');
        const post = document.createElement('shreddit-post');
        post.setAttribute('id', 't3_p' + page + '_' + i);
        post.setAttribute('post-title', 'Page ' + page + ' post ' + i);
        post.setAttribute('permalink', '/r/x/comments/p' + page + i + '/p/');
        post.setAttribute('content-href', 'https://example.com/a' + page + i);
        post.setAttribute('post-type', 'link');
        post.setAttribute('score', '5');
        post.setAttribute('comment-count', '1');
        post.setAttribute('created-timestamp', '2026-08-12T00:00:00+0000');
        post.setAttribute('domain', 'example.com');
        post.setAttribute('author', 'pager');
        post.setAttribute('subreddit-name', 'x');
        post.setAttribute('subreddit-prefixed-name', 'r/x');
        art.appendChild(post);
        feed.appendChild(art);
      }
      this.remove();
      const next = document.createElement('faceplate-partial');
      next.setAttribute('loading', 'programmatic');
      next.setAttribute('src', '/feed/next');
      feed.appendChild(next);
    }
  }
  if (!customElements.get('faceplate-partial')) {
    customElements.define('faceplate-partial', ShdFakePartial);
  }
})();
`;
const PAGER_PAGE_SIZE = 3;

/**
 * The comments-page equivalent: a faceplate-partial inside the comment tree that appends
 * the next slice of the thread.
 *
 * commentsPage() had NO partials at all, which is why comment truncation went unnoticed —
 * ARCHITECTURE §1.5 recorded "29 pending partials" on a real thread and the fixture
 * encoded none of them. Depths repeat the live sequence so nesting is exercised too.
 */
const COMMENT_PAGER_SCRIPT = `
(() => {
  const BATCH = [0, 1, 1, 2, 0];
  window.__shdCommentPager = { loads: 0 };
  window.__shdDecoyLoads = 0;
  class ShdFakeCommentPartial extends HTMLElement {
    loadContent() {
      // One custom element serves every faceplate-partial on the page, including the ones
      // that have nothing to do with comments. A real thread carries a pile of them
      // (ARCHITECTURE §1.5 counted 29). Driving the wrong one fetches the wrong thing, so
      // record it separately and let the test assert it never happens.
      if (!this.closest('shreddit-comment-tree')) {
        window.__shdDecoyLoads = (window.__shdDecoyLoads || 0) + 1;
        return;
      }
      const st = window.__shdCommentPager;
      st.loads++;
      const tree = document.querySelector('shreddit-comment-tree section')
                || document.querySelector('shreddit-comment-tree');
      if (!tree) return;
      const page = st.loads;
      // Delivered on a later tick, because a real partial does a network fetch. It used to
      // append synchronously, which quietly hid a bug: settle() watched shreddit-feed
      // unconditionally, and a comments page has none, so it resolved instantly and the
      // paginator reported a page loaded before one comment had arrived. With nothing to
      // wait for, no fixture could tell a working wait from a skipped one.
      setTimeout(() => appendBatch(this, page, tree), 50);
    }
  }
  function appendBatch(self, page, tree) {
      BATCH.forEach((depth, i) => {
        const c = document.createElement('shreddit-comment');
        c.setAttribute('thingid', 't1_p' + page + '_' + i);
        c.setAttribute('postid', 't3_link1');
        c.setAttribute('author', 'later' + page + i);
        c.setAttribute('score', '7');
        c.setAttribute('created', '2026-08-12T09:00:00.000000+0000');
        c.setAttribute('depth', String(depth));
        c.setAttribute('comment-position', String(i));
        c.setAttribute('permalink', '/r/programming/comments/link1/c/p' + page + i + '/');
        c.setAttribute('content-type', 'text');
        c.setAttribute('award-count', '0');
        const body = document.createElement('div');
        body.setAttribute('slot', 'comment');
        body.innerHTML = '<p>Late comment ' + page + '.' + i + ' at depth ' + depth + '.</p>';
        c.appendChild(body);
        tree.appendChild(c);
      });
      self.remove();
      const next = document.createElement('faceplate-partial');
      next.setAttribute('loading', 'programmatic');
      next.setAttribute('src', '/more-comments');
      tree.appendChild(next);
  }
  if (!customElements.get('faceplate-partial')) {
    customElements.define('faceplate-partial', ShdFakeCommentPartial);
  }
})();
`;
const COMMENT_PAGER_BATCH = 5;

/* Reddit's page stylesheet, reduced to the rules KNOWN to leak into our cloned bodies
   (open question 7: the clone stays in the same document, so page CSS matches it). The
   color is the one that shipped a real bug — Reddit's theme-dark text landing on our light
   palettes as faint grey — and the radius/padding are the two utilities measured earlier.
   Served on every fixture page because every live page serves the real thing. */
const REDDIT_PAGE_CSS = `<style id="reddit-page-css">
  .md, .md * { color: rgb(226, 226, 232); }
  .rounded-2 { border-radius: 8px; }
  .pb-2xs { padding-bottom: 4px; }
</style>`;

/**
 * Reddit's screen-reader announcement outlet, captured in live testing as the cause of a
 * horizontal scrollbar at narrow widths — 860px wide, inside `shreddit-app`, still
 * widening the document while our suppression was active.
 *
 * The chain is captured (span > faceplate-screen-reader-content > screen-reader-alert-outlet
 * > shreddit-async-loader > shreddit-app > body) and so is the symptom. The MECHANISM is
 * inferred: suppress.css already gives the body child `position: absolute; width: 1px;
 * overflow: hidden`, which clips any normal-flow descendant, and a fixed-position
 * descendant is the one thing that escapes an ancestor's overflow clip — its containing
 * block is the viewport, not the clipper. So that is what is modelled here. If a real page
 * turns out to widen the document some other way, this fixture will not represent it.
 */
const SR_OUTLET = `
    <shreddit-async-loader>
      <screen-reader-alert-outlet>
        <faceplate-screen-reader-content style="position: fixed; top: 0; left: 0; white-space: nowrap;">
          <span>My brother's 16yo pittie, and the tiny kitten my dad found in his back yard
          (and a great deal more announcement text besides, all on one line)</span>
        </faceplate-screen-reader-content>
      </screen-reader-alert-outlet>
    </shreddit-async-loader>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function postHtml(p) {
  /* A plain string is a bare <img>; an object carries a responsive set, which is where a
     full-size version lives when Reddit offers one. Both shapes are real and the model has
     to read either. */
  const imgs = p.imgs.map(u => typeof u === 'string'
    ? `<img src="https://${u}" alt="">`
    : `<img src="https://${u.src}" srcset="${esc(u.srcset)}" alt="">`).join('');
  const avatar = p.avatarImg
    ? `<a href="/user/${p.author}"><img src="https://${p.avatarImg}" alt=""></a>` : '';
  const flair = `<shreddit-post-flair><img src="https://emoji.redditmedia.com/flair_${p.id}.png" alt=""></shreddit-post-flair>`;
  return `
  <article>
    <shreddit-post
      id="${p.id}"
      post-title="${esc(p.title)}"
      permalink="${p.permalink}"
      content-href="${esc(p.contentHref)}"
      post-type="${p.type}"
      score="${p.score}"
      upvote-ratio="0.95"
      comment-count="${p.comments}"
      created-timestamp="2026-08-11T22:52:55.944000+0000"
      domain="${p.domain}"
      author="${p.author}"
      subreddit-name="${p.sub}"
      subreddit-prefixed-name="r/${p.sub}"
      ${p.nsfw === true ? 'nsfw=""' : p.nsfw === 'false' ? 'nsfw="false"' : ''}

      award-count="0">
      ${avatar}${flair}${imgs}
      ${p.videoJson ? `<shreddit-player id="${p.id}-aspect-ratio" packaged-media-json="${esc(JSON.stringify(p.videoJson))}"></shreddit-player>` : ''}
      <!-- Reddit's own rendered copy, in the light DOM. Present because suppression has to
           keep it out of the ACCESSIBILITY TREE, not merely out of sight: the visually-hidden
           recipe this used to be (absolute + 1px + clip + opacity) is the one people reach for
           when they want screen readers to still read something. Without real text here,
           nothing could tell a suppression that hides from everyone apart from one that hides
           from sighted users only — measured live, a native <article> carrying exactly this
           shape was still extractable while our layout was up. -->
      ${p.selftext ? `<div slot="text-body"><div class="md">${p.selftext}</div></div>` : ''}
      <a slot="full-post-link" href="${p.permalink}">${esc(p.title)}</a>
      <span>u/${p.author} &bull; 2 days ago</span>
      <shreddit-async-loader><!-- vote bar hydrates here, absent at first paint --></shreddit-async-loader>
    </shreddit-post>
  </article><hr>`;
}

/** @param {{pager?: boolean}} opts  pager: give faceplate-partial a working loadContent() */
function listingPage(opts = {}) {
  const pager = opts.pager ? `<script>${PAGER_SCRIPT}</script>` : '';
  return `<!DOCTYPE html><html><head><title>reddit</title>${REDDIT_PAGE_CSS}</head><body>${pager}
  <shreddit-app>
    <reddit-header-large></reddit-header-large>
    ${SR_OUTLET}
    <div><div id="subgrid-container"><div><main id="main-content">
      <shreddit-feed>
        ${POSTS.map(postHtml).join('')}
        <shreddit-ad-post><div>sponsored, contains no shreddit-post</div></shreddit-ad-post><hr>
        <faceplate-partial loading="programmatic" src="/feed/next"></faceplate-partial>
      </shreddit-feed>
    </main></div></div></div>
    <div id="right-sidebar-container"></div>
  </shreddit-app></body></html>`;
}

/* ------------------------------------------------------------------ user profiles --- */

/**
 * A comment as it appears on a /user/ page — CAPTURED LIVE 2026-08-21 on
 * three profiles. It shares nothing with a thread comment: `comment-id` not `thingid`,
 * `href` not `permalink`, no author/score/created/depth at all, and NO `[slot="comment"]`
 * child. The furniture is real too — five comment-ish custom element names live inside
 * every one of them, which is what the unknown-element check has to not trip over.
 *
 * FOUR HREF SHAPES, one per comment, because the parent line has four distinct answers
 * and live testing found the old fixture covering only two of them (bug 3: thirty comments on
 * /user/spez/ all rendered "comment in u/spez"). Indexed, not alternating:
 *
 *   0  /r/<sub>/comments/...              a comment in a subreddit. Unambiguous.
 *   1  /user/<someone-else>/comments/...  a comment on ANOTHER user's profile post.
 *                                         Unambiguous: it is not this profile.
 *   2  /user/<the-owner>/comments/...     the round-12 shape — a permalink the profile
 *                                         page rewrote about itself, so the path says
 *                                         nothing. This one carries the RENDERED community
 *                                         and post links, which is what the renderer
 *                                         recovers the real subreddit and title from.
 *   3  /user/<the-owner>/comments/...     the same shape with no such links. Nothing can
 *                                         establish where it lives, so nothing is claimed.
 *
 * Rows 2 and 3 are the two halves of the ambiguous case and they are what the fix turns
 * on: `u/<the-owner>` is the one answer that is never worth printing, because it is what
 * the page is rather than what the comment is about.
 *
 * NOTE ON WHAT IS AND IS NOT CAPTURED: the two path shapes are captured (live testing and
 * live testing, on the same profile, one day apart). The rendered community/post links in row
 * 2 are NOT — see C.PROFILE_COMMENT_SUB_LINK. Row 2 asserts what WE do when Reddit's row
 * carries them, and row 3 asserts what we do when it does not; between them the renderer
 * is pinned either way, which is the most a fixture can honestly do with an uncaptured
 * contract.
 *
 * Degrees of freedom, each modelling one way the contract can be wrong:
 *   tag         a tag we never query — the comments vanish silently unless the coverage
 *               check catches it.
 *   unreadable  our tag, foreign attributes — a reject.
 *   noBody      our tag and attributes, but the body selector misses. The body is
 *               REQUIRED, so this must hand back rather than render empty rows — and
 *               C.PROFILE_COMMENT_BODY is the one part of the contract still uncaptured,
 *               so this is the case most likely to be real.
 */
const PROFILE_COMMENT_COUNT = 4;
const PROFILE_HREFS = [
  '/r/sub0/comments/thread0/comment/pc0/?context=3',
  '/user/otheruser/comments/pthread1/comment/pc1/?context=3',
  '/user/tester/comments/pthread2/comment/pc2/?context=3',
  '/user/tester/comments/pthread3/comment/pc3/?context=3'
];
/* Only row 2 carries them — see the note above on what is captured and what is not. */
const PROFILE_LINKED_SUB = 'recovered';
const PROFILE_LINKED_TITLE = 'The post this comment is replying to';
function profileCommentHtml(i, { tag = 'shreddit-profile-comment', unreadable = false,
                                 noBody = false, lateTime = false } = {}) {
  const href = PROFILE_HREFS[i % PROFILE_HREFS.length];
  const attrs = unreadable
    ? `data-ks-item="" data-foreign-id="pc${i}" item-state="UNMODERATED"`
    : `comment-id="t1_pc${i}"
       href="${href}"
       data-ks-item=""
       telemetry-noun="comment"
       data-feed-element-id="t1_pc${i}"
       reload-url="/svc/shreddit/comment/t1_pc${i}?isProfile=true"
       user-id=""
       mod-tools-host="false"
       item-state="UNMODERATED"
       class="w-full nd:visible rounded-4 my-2xs"`;
  /* TWO NESTED `.md` NODES, which is the live shape (live testing: 48 of them across 24
     comments). The OUTER is a layout wrapper whose LAST class happens to be `md` and
     which carries Reddit's own indent utilities; the INNER is the real markdown
     container. Both hold identical text, so a renderer that clones the wrapper looks
     perfectly correct and quietly drags a 22px margin and 10px padding — styled by
     Reddit's stylesheet, not ours — into every comment row. */
  /* The body deliberately contains an /r/ link and a /comments/ link of its own. A
     reader quoting "go and read /r/elsewhere" must not retitle their own row, and the
     scoped lookups in model.js exclude the body for exactly that reason — this is what
     proves they do. */
  const body = noBody
    ? '<div class="not-a-body"><p>unreachable text</p></div>'
    : `<div class="ms-[22px] mt-2xs ps-[10px] md">
         <div class="md pt-xs pb-2xs [--emote-size:20px]">
           <p>Profile comment number ${i}. See
              <a href="/r/elsewhere/">r/elsewhere</a> and
              <a href="/r/elsewhere/comments/other1/">that other thread</a>.</p></div></div>`;
  /* Row 2's rendered community and post links — the round-12 recovery path. The post link
     points at the THREAD (no /comment/ segment), which is what tells it apart from the
     row's own permalink. */
  const rendered = i % PROFILE_HREFS.length === 2
    ? `<a href="/r/${PROFILE_LINKED_SUB}/">r/${PROFILE_LINKED_SUB}</a>
       <a href="/user/tester/comments/pthread2/">${PROFILE_LINKED_TITLE}</a>`
    : '';
  /* lateTime models the restored-element shape a history traversal produces: the element
     is re-consumed MID-HYDRATION, so its <time> is absent at consume time and arrives on
     a later tick. Observed live twice as a row whose timestamp had vanished. The fixture
     ships NO time element; the TEST inserts it after the render, because this suite runs
     jsdom with runScripts: 'outside-only' and an inline fixture script would silently
     never execute — a page that looks like it models late delivery while modelling none. */
  const timeEl = lateTime
    ? ''
    : '<time datetime="2026-08-12T08:17:36.499000+0000">2 days ago</time>';
  return `
  <${tag} ${attrs}>
    <shreddit-comment-author-modifier-icon></shreddit-comment-author-modifier-icon>
    <shreddit-comment-badges></shreddit-comment-badges>
    ${timeEl}
    ${rendered}
    ${body}
    <shreddit-comment-action-row>
      <shreddit-comment-share-button></shreddit-comment-share-button>
    </shreddit-comment-action-row>
  </${tag}>`;
}

/** A /user/ page: the user's posts interleaved with their comments, in one feed.
 *  `badIndex` makes exactly ONE comment unreadable — a mid-hydration outlier on an
 *  otherwise fine profile, which must NOT cost the whole page. */
function profilePage(opts = {}) {
  const c = (i) => profileCommentHtml(i,
    opts.badIndex === i ? { ...opts, unreadable: true }
      : opts.lateIndex === i ? { ...opts, lateTime: true } : opts);
  return `<!DOCTYPE html><html><head><title>u/tester</title>${REDDIT_PAGE_CSS}</head><body>
  <shreddit-app>
    <reddit-header-large></reddit-header-large>
    <div><div id="subgrid-container"><div><main id="main-content">
      <shreddit-feed>
        ${postHtml(POSTS[0])}
        ${c(0)}${c(1)}
        ${postHtml(POSTS[1])}
        ${c(2)}${c(3)}
        <faceplate-partial loading="programmatic" src="/profile/next"></faceplate-partial>
      </shreddit-feed>
    </main></div></div></div>
    <div id="right-sidebar-container"></div>
  </shreddit-app></body></html>`;
}

/**
 * A TEXT submission with a slotted body, for the comments page. Kept out of POSTS so no
 * listing count moves. The body is deliberately more than a paragraph: a link, a code
 * block and a quote are the three things "clone the rendered node" preserves and
 * "re-parse the text" destroys, so they are what the assertion has to look for.
 * The slot shape is the live one — div[slot="text-body"] > div.md — reported from a real
 * thread 2026-08-20; post text is NOT an attribute, which is why no attribute-reading
 * fixture could ever exercise this path.
 */
const SELF_POST = {
  id: 't3_self1', title: 'What are you working on this week?',
  permalink: '/r/programming/comments/self1/wip/', contentHref: '',
  type: 'text', score: 321, comments: 57, domain: 'self.programming',
  author: 'asker', sub: 'programming', imgs: [],
  selftext: '<p>Tell us below — <a href="/r/programming/wiki/faq">the faq</a> has ' +
            'ground rules.</p><pre><code>npm test</code></pre>' +
            '<blockquote><p>last week\u2019s thread</p></blockquote>'
};

/* CAPTURED LIVE 2026-08-22 from https://v.redd.it/nzafnbgwcxkh1/DASHPlaylist.mpd — the
   asset in the report that renders as a link and a thumbnail with nothing to play.
   Verbatim, because the point of it is the shape nobody would have guessed:

     - the renditions are CMAF_220/270/360/480, and there is no DASH_<n>.mp4 anywhere.
       Every DASH_* file on this asset 403s; every CMAF_* returns 200.
     - audio is a SEPARATE AdaptationSet (CMAF_AUDIO_64/128). Nothing here is combined,
       which is why the inline player is silent and why it says so on screen.
     - it is a PORTRAIT phone video: the rungs are 220x392 up to 480x854, so every one of
       them is taller than a 720 "height ceiling" would allow while all of them are
       narrower than the 640px box. A fixture with a landscape ladder cannot catch a
       resolution rule that reads the wrong axis — this one does, and it did.
     - profiles="…isoff-on-demand…" with SegmentBase/indexRange, which is what makes each
       file self-contained and playable in a bare <video> rather than a segment stub. */
const VIDEO_MPD = String.raw`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" mediaPresentationDuration="PT3M4S" minBufferTime="PT4S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd">
  <Period duration="PT3M4S" id="0">
    <AdaptationSet contentType="video" id="1" maxFrameRate="15360/512" maxHeight="854" maxWidth="480" par="9:16" sar="1:1" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:TransferCharacteristics" value="1" />
      <Representation bandwidth="275358" codecs="avc1.4d401e" frameRate="15360/512" height="392" id="4" mimeType="video/mp4" width="220">
        <BaseURL>CMAF_220.mp4</BaseURL>
        <SegmentBase indexRange="915-1498" timescale="15360">
          <Initialization range="0-914" />
        </SegmentBase>
      </Representation>
      <Representation bandwidth="482234" codecs="avc1.4d401e" frameRate="15360/512" height="480" id="5" mimeType="video/mp4" width="270">
        <BaseURL>CMAF_270.mp4</BaseURL>
        <SegmentBase indexRange="894-1477" timescale="15360">
          <Initialization range="0-893" />
        </SegmentBase>
      </Representation>
      <Representation bandwidth="867508" codecs="avc1.4d401e" frameRate="15360/512" height="640" id="6" mimeType="video/mp4" width="360">
        <BaseURL>CMAF_360.mp4</BaseURL>
        <SegmentBase indexRange="895-1478" timescale="15360">
          <Initialization range="0-894" />
        </SegmentBase>
      </Representation>
      <Representation bandwidth="1283504" codecs="avc1.4d401f" frameRate="15360/512" height="854" id="7" mimeType="video/mp4" width="480">
        <BaseURL>CMAF_480.mp4</BaseURL>
        <SegmentBase indexRange="915-1498" timescale="15360">
          <Initialization range="0-914" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" id="2" segmentAlignment="true" startWithSAP="1" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation audioSamplingRate="48000" bandwidth="67929" codecs="mp4a.40.2" id="8" mimeType="audio/mp4">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2" />
        <BaseURL>CMAF_AUDIO_64.mp4</BaseURL>
        <SegmentBase indexRange="833-1416" timescale="48000">
          <Initialization range="0-832" />
        </SegmentBase>
      </Representation>
      <Representation audioSamplingRate="48000" bandwidth="134460" codecs="mp4a.40.2" id="9" mimeType="audio/mp4">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2" />
        <BaseURL>CMAF_AUDIO_128.mp4</BaseURL>
        <SegmentBase indexRange="833-1416" timescale="48000">
          <Initialization range="0-832" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    </Period>
</MPD>`;

/* The same post shape, with NO packaged-media-json — a player that never carries the
   attribute at all, which is the migrated-asset case. `t3_video1` above is the legacy
   shape and keeps its renditions; this one has only the manifest to go on. */
const CMAF_POST = {
  id: 't3_cmaf1', type: 'video', title: 'Overconfident, then humbled',
  permalink: '/r/funny/comments/cmaf1/humbled/',
  contentHref: 'https://v.redd.it/nzafnbgwcxkh1',
  score: 4102, comments: 233, domain: 'v.redd.it',
  author: 'poster', sub: 'funny', imgs: []
};

const commentAttrs = (depth, i) => `
    thingid="t1_c${i}"
    postid="t3_link1"
    author="user${i}"
    score="${100 - i * 3}"
    created="2026-08-12T08:17:36.499000+0000"
    depth="${depth}"
    comment-position="${i}"
    permalink="/r/programming/comments/link1/comment/c${i}/"
    content-type="text"
    award-count="0"`;

/* The classes are the LIVE clone's (captured 2026-08-18): md plus presentation utilities.
   They matter because REDDIT_PAGE_CSS below still matches them after we clone the node —
   which is how the faint-text bug shipped invisibly. */
const commentBody = (depth, i) =>
  `<div slot="comment"><div class="md text-14-scalable rounded-2 pb-2xs overflow-hidden">` +
  `<p>Comment body number ${i} at depth ${depth}.</p></div></div>`;

/** Flat siblings — the shape Reddit shipped up to 2026-08-12. */
function commentHtml(depth, i) {
  return `
  <shreddit-comment${commentAttrs(depth, i)}>
    ${commentBody(depth, i)}
  </shreddit-comment>`;
}

/**
 * NESTED comments — the shape observed live 2026-08-14.
 *
 * The wrapper chain is copied from what `verify:live` actually reported:
 *   shreddit-comment > details > div.grid > div.col-span-2.grid > shreddit-comment
 * so no comment is ever the *direct* parent of another, and the DOM ancestor-comment count
 * equals the `depth` attribute exactly.
 *
 * This shape matters beyond cosmetics: a comment's subtree now contains its descendants'
 * bodies, so anything reading "the body" out of a comment has to scope the lookup to that
 * comment. Every other fixture here is flat and structurally cannot catch that.
 *
 * @param {number[]} depths     depth per comment, in document order
 * @param {{bodyLast?: boolean}} opts  bodyLast puts the body AFTER the child container,
 *   which is the ordering that turns a bare querySelector into the wrong comment's text.
 *   Reddit currently emits body-first; this proves we do not depend on that.
 */
function nestedCommentsHtml(depths, opts = {}) {
  let out = '', open = [];   // stack of { depth, body } for currently-unclosed comments
  const close = (toDepth) => {
    while (open.length && open[open.length - 1].depth >= toDepth) {
      const frame = open.pop();
      out += `</div>` + (frame.body || '') + `</div></details></shreddit-comment>`;
    }
  };
  depths.forEach((depth, i) => {
    close(depth);
    const body = commentBody(depth, i);
    out += `<shreddit-comment${commentAttrs(depth, i)}>` +
           `<details><div class="grid grid-cols-[24px_1fr]">` +
           (opts.bodyLast ? '' : body) +
           `<div class="col-span-2 grid">`;
    if (opts.bodyLast) {
      // body emitted after the child container closes — see the closer below
      open.push({ depth, body });
    } else {
      open.push({ depth, body: null });
    }
  });
  // unwind, restoring bodies for the bodyLast case
  while (open.length) {
    const frame = open.pop();
    out += `</div>` + (frame.body || '') + `</div></details></shreddit-comment>`;
  }
  return out;
}

/**
 * The OTHER shape a truncated thread can have — and the one the live evidence points at.
 *
 * COMMENT_PAGER_SCRIPT models the feed: one partial, loading="programmatic", which removes
 * itself and appends a successor. That was an assumption transplanted from listings, and
 * verify:live contradicts its premise — ten partials in one comment tree, none programmatic,
 * with controls reading "16 more replies". That is one partial per truncated BRANCH.
 *
 * Two differences from the feed model, both of which break a paginator that re-queries:
 *   - several partials exist at once, one inside each branch that has hidden replies
 *   - a driven partial STAYS PUT (it fills its branch in place) instead of replacing itself
 * so `document.querySelector(SEL)` returns the same element for ever and the other branches
 * are never reached. Nothing else in the suite can produce that, because both existing
 * pagers helpfully remove themselves.
 *
 * Deliberately NOT loading="programmatic" — matching what was observed — so this also covers
 * the fallback clause of the paginator's selector.
 */
const BRANCH_PAGER_SCRIPT = `
(() => {
  window.__shdBranchPager = { loads: 0, driven: [] };
  class ShdBranchPartial extends HTMLElement {
    connectedCallback() {
      // Reddit's action-partials fire from their own light-DOM button. The delegated
      // "more replies" control in comments.js clicks exactly this.
      this.querySelector('button')?.addEventListener('click', () => this.loadContent());
    }
    loadContent() {
      const st = window.__shdBranchPager;
      const host = this.closest('shreddit-comment');
      const branch = host ? host.getAttribute('thingid') : 'root';
      st.loads++;
      st.driven.push(branch);
      /* THE NO-OP EXPANSION, and it is not hypothetical: live testing clicked "9 more
         replies" on a live thread, watched Reddit take the control away, and counted
         zero new comments — shreddit-comment and .thing.comment both unchanged at 40, so
         nothing was loaded AND nothing was lost in translation. The expansion itself did
         nothing. A control that consumes a click and says nothing is the failure mode
         this models. */
      if (this.hasAttribute('data-dead')) return;
      // No host: this is the TOP-LEVEL continuation partial (live shape: loading="lazy",
      // a direct child of the tree's <section>). It appends the next page of depth-0
      // comments and stays put, like its in-branch siblings.
      const depth = host ? Number(host.getAttribute('depth')) + 1 : 0;
      const mount = host ? (host.querySelector('.col-span-2.grid') || host) : this.parentElement;
      for (let i = 0; i < 2; i++) {
        const c = document.createElement('shreddit-comment');
        c.setAttribute('thingid', 't1_' + branch + '_r' + i);
        c.setAttribute('postid', 't3_link1');
        c.setAttribute('author', 'reply' + i);
        c.setAttribute('score', '3');
        c.setAttribute('created', '2026-08-12T09:00:00.000000+0000');
        c.setAttribute('depth', String(depth));
        c.setAttribute('comment-position', String(i));
        c.setAttribute('permalink', '/r/programming/comments/link1/c/' + branch + i + '/');
        c.setAttribute('content-type', 'text');
        c.setAttribute('award-count', '0');
        const body = document.createElement('div');
        body.setAttribute('slot', 'comment');
        body.innerHTML = '<p>Reply ' + i + ' in ' + branch + ' at depth ' + depth + '.</p>';
        c.appendChild(body);
        mount.appendChild(c);
      }
      // THE POINT OF THIS FIXTURE: no this.remove(), no successor appended. The branch is
      // expanded in place and the partial is still sitting there afterwards.
    }
  }
  if (!customElements.get('faceplate-partial')) {
    customElements.define('faceplate-partial', ShdBranchPartial);
  }
})();
`;
const BRANCH_PAGER_BRANCHES = 3;     // how many branches carry a partial
const BRANCH_PAGER_REPLIES = 2;      // comments each one delivers

/**
 * @param {{deliver?: number, pager?: boolean, branchPager?: boolean}} opts
 *   deliver: how many of the thread's comments arrive in the initial HTML (default: all).
 *            A real thread ships a slice and lazy-loads the rest.
 *   pager:   append a faceplate-partial with a working loadContent() holding the rest.
 *   branchPager: instead, put a surviving partial inside each of the first few comments —
 *            see BRANCH_PAGER_SCRIPT.
 *   deadBranch: make the FIRST of those partials one whose loadContent() delivers nothing.
 *            Reddit's own control still disappears; the reader gets no replies. Live testing
 *            measured exactly this, and the old control removed itself four seconds later
 *            as though it had worked.
 */
function commentsPage(opts = {}) {
  const post = opts.selfPost ? SELF_POST
    : opts.cmafPost ? CMAF_POST
    : opts.videoPost ? POSTS.find(p => p.id === 't3_video1')
    : opts.imagePost ? POSTS.find(p => p.id === 't3_image1')
    : opts.galleryPost ? POSTS.find(p => p.id === 't3_gallery1')
    : opts.nsfwPost ? POSTS.find(p => p.id === 't3_nsfw1')
    : POSTS[2];
  const deliver = opts.deliver ?? COMMENT_DEPTHS.length;
  let delivered = COMMENT_DEPTHS.slice(0, deliver).map(commentHtml).join('');
  let partial = (deliver < COMMENT_DEPTHS.length || opts.pager) && !opts.branchPager
    ? '<faceplate-partial loading="programmatic" src="/more-comments"></faceplate-partial>'
    : '';
  /* Both at once is the LIVE anatomy: ~25 per-branch expanders inside
     comments, plus exactly one top-level continuation partial — loading="lazy", a direct
     child of the tree's <section>, not inside any comment. The paginator must drive the
     top-level one, not spend its pages expanding branch after branch. */
  if (opts.branchPager && opts.pager) {
    partial = '<faceplate-partial loading="lazy" src="/svc/more-comments"></faceplate-partial>';
  }
  if (opts.branchPager) {
    // One partial per branch, inside the comment it belongs to, carrying the kind of label
    // Reddit actually renders. Injected before each of the first N comments' closing tag.
    let seen = 0;
    delivered = delivered.replace(/<\/shreddit-comment>/g, (m) =>
      ++seen <= BRANCH_PAGER_BRANCHES
        ? `<faceplate-partial src="/more-replies"${
            opts.deadBranch && seen === 1 ? ' data-dead=""' : ''}>` +
          '<button>16 more replies</button></faceplate-partial>' + m
        : m);
  }
  const pagerScript = opts.branchPager ? `<script>${BRANCH_PAGER_SCRIPT}</script>`
    : opts.pager ? `<script>${COMMENT_PAGER_SCRIPT}</script>` : '';
  return `<!DOCTYPE html><html><head><title>thread</title>${REDDIT_PAGE_CSS}</head><body>${pagerScript}
  <shreddit-app>
    <reddit-header-large></reddit-header-large>
    <div><div id="subgrid-container"><div><main id="main-content">
      ${postHtml(post)}
      <shreddit-comment-tree post-id="t3_link1" totalcomments="${COMMENT_DEPTHS.length}">
        <section>
          ${delivered}${partial}
        </section>
      </shreddit-comment-tree>
      <!-- Unrelated lazy-loaded furniture, outside the comment tree. Real threads are
           full of these; the comment partial selector is scoped so we never drive one. -->
      <aside class="related"><faceplate-partial loading="programmatic" src="/related"></faceplate-partial></aside>
    </main></div></div></div>
  </shreddit-app></body></html>`;
}

module.exports = { POSTS, SELF_POST, CMAF_POST, VIDEO_MPD, COMMENT_DEPTHS, listingPage, commentsPage, nestedCommentsHtml,
                   profilePage, PROFILE_COMMENT_COUNT, PROFILE_LINKED_SUB, PROFILE_LINKED_TITLE,
                   PAGER_SCRIPT, PAGER_PAGE_SIZE,
                   COMMENT_PAGER_SCRIPT, COMMENT_PAGER_BATCH,
                   BRANCH_PAGER_SCRIPT, BRANCH_PAGER_BRANCHES, BRANCH_PAGER_REPLIES };
