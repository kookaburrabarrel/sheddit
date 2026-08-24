# Engineering log

Every entry below is a bug this extension actually shipped, written down after it was
fixed. They are numbered, and the numbers are permanent — source comments cite them, and
so does the [changelog](../CHANGELOG.md).

**This is not a changelog.** A changelog says what changed. This says *what the wrong
behaviour looked like* — because that is the thing that makes a bug recognisable when
someone is six months from now and about to reintroduce it. "The feed dead-ended at three
posts" is a description you can match against a symptom. "Fixed pagination" is not.

Two habits produced almost every entry here, and both were learned expensively:

**Measure before you conclude.** Nearly every entry started life as a confident assumption
that a test or a live run contradicted. *Comments are flat. The dev harness proves
pagination works. An empty feed means the extension is broken.* All wrong, all cheap to check, all
shipped anyway.

**A green test proves nothing until you have watched it go red.** `npm run test:mutate`
puts these bugs back one at a time — several of the entries below need more than one row
to pin both halves of a fix — and fails if the suite stays green.
It has caught assertions that protected nothing on four separate occasions, including one
row that had been silently dead for two commits while still reporting success.

If you are reading this to evaluate the project rather than to work on it, entries
[15](#15), [30](#30), [41](#41), [42](#42) and [51](#51) are the ones worth your time:
each is a case where the code was correct, the tests were green, and the product was
broken anyway.

---

## Bugs found and fixed — do not reintroduce

Each is covered by a test, and essentially every one is covered by a *mutation* too —
`npm run test:mutate` puts the bug back and fails if the suite stays green. That is the
only evidence a test actually protects anything. See `test/mutate.sh`.

A numbered entry here is not just history. It is the list of things a future change is most
likely to undo, which is why each one says what the wrong behaviour looked like rather than
only what the fix was.

1. **Thumbnail false positives.** A loose selector matched `styles.redditmedia.com`
   (subreddit icons) and `emoji.redditmedia.com` (flair emoji), giving every text post a
   bogus thumbnail. Fixed with a host allowlist (`preview|i|external-preview.redd.it`) plus
   an ancestor exclusion for flair / hovercard / join-button / user-link.
2. **Root-hiding.** The suppression rule targeted `shreddit-app > *:not(#shd-root)`, but
   `#main-content` is four levels deeper, so it hid an ancestor of Sheddit's own root. `#shd-root`
   now mounts as a **direct child of `<body>`**, and siblings are hidden there.
3. **Comment depth-stack.** Comments are flat; nesting is rebuilt from `depth`. Verified
   24/24 placed with zero orphans.
4. **Uncontained floats.** `.thumbnail` escaped `.thing.link`, and `#shd-sidebar` escaped
   `#shd-root`. Both now `display: flow-root`. The second was found by `test/css-lint.js`
   on its first run.
5. **Score column too narrow.** `.midcol` was 22px; `12247` wrapped onto three lines. Now
   34px with `white-space: nowrap`.

Found by `test/geometry.js` and `test/extension.js` on their first runs:

6. **Sidebar gutter under-reserved by 18px.** `#shd-sidebar`'s margin box was 338px
   (300 width + 16 padding + 2 border + 20 margin) against a hard-coded
   `margin-right: 320px`. A float intrudes by its *margin* box, so every row that
   vertically overlapped the sidebar was laid out 18px narrower than the rows below it —
   a right edge that steps at the sidebar's bottom, worse the taller the sidebar gets.
   Both sides now derive from `--shd-side-w`/`--shd-gutter` and the rail is `border-box`.
   **This is the best remaining candidate for the old staircase report** (see below).
7. **Comment `[–]` under the vote arrows.** `.expand` and `.midcol` were both absolutely
   positioned at `left: 4px`, and `.midcol` inherited the listing's 34px width against a
   22px row padding — so the hover arrows painted over the toggle and the author name.
   The toggle is now inline at the head of the tagline (old reddit's own placement) and
   the comment midcol is 15px wide.
8. **Chrome never rebuilt after an SPA navigation.** `flush()` built the header and
   sidebar under `if (rendered > 0 && !SHD.gate.revealed)`, but `reveal()` latches `true`
   for the life of the page while `onRoute()` tears the chrome down on every navigation.
   Net effect: the sidebar vanished permanently after the first client-side nav and the
   header kept showing the *previous* subreddit. Ungated now; both builders no-op when
   their element already exists.
9. **`bail()` left Sheddit's own DOM on the page.** `old-reddit.css` is scoped under
   `html.shd-active`, so everything already rendered stayed behind as *unstyled* markup
   below native Reddit — and the pipeline kept appending to it. Failing now removes
   `#shd-root`/`#shd-header`, fires `onStop` listeners, and the pipeline stops collecting
   and flushing.
10. **A tab shipped that routed to `OTHER`.** `chrome.js` offered `controversial` on
    the front page while `classify()` accepted it only under `/r/x/`, so clicking the extension's
    own tab dropped the user out of the extension. `route.js` now owns the sort list and
    `chrome.js` reads it; a test asserts every href the chrome renders classifies as
    `LISTING`.
11. **The reply escape hatch never worked, for two independent reasons.**
    `comments.js` put `.shd-native-passthrough` on the `<shreddit-comment>`, but
    suppress.css clips the *body child* (`shreddit-app`, seven levels up) and
    `clip-path`/`opacity` apply to the whole subtree — un-clipping a descendant does
    nothing. And even on the right element it lost the cascade: the suppression selector's
    `:not(#id)` clauses give it three ids' worth of specificity, which beats a class-only
    rule with `!important` on both. `SHD.dom.passthrough()` now walks the path to the body
    child, hides the siblings along it, and the class is **excluded** from the suppression
    selector rather than trying to override it.
12. **The failsafe was a speed detector, not a bug detector.** A flat 1500ms deadline
    from `document_start` fired on any page whose HTML streamed slowly — measured: 1600ms
    of stall permanently disabled the extension for a page that was about to work fine.
    The deadline now asks *why* nothing rendered. Source elements present and nothing
    rendered is a Sheddit bug, so fail immediately; no source elements yet means the page has
    not arrived, so keep waiting up to `MAX_WAIT_MS`.
13. **Failing silently handed back native Reddit**, which is indistinguishable from the
    extension not being installed — it reads as an unrelated Reddit bug. A failure now
    renders `#shd-error` naming the reason, with diagnostics and a **button** to
    un-suppress native Reddit. Never do this behind the user's back.
14. **An SPA navigation onto an unrenderable page left a permanently blank screen.**
    `revealed` latched `true`, so the deadline check returned early forever, while
    `onRoute()` removes `#shd-root` on every navigation with native Reddit still
    suppressed. `resetForRoute()` clears `revealed` — that line is load-bearing.
<a id="15"></a>
15. **Pagination never worked in the packed extension.** See the isolated-world section
    above. Fixed with `src/core/bridge.js`; the regression test drives a real
    `loadContent()` through the packed extension, which is the only setup that can tell
    the two worlds apart.
16. **`settle()` watched for mutations it had already missed.** It attached its
    MutationObserver *after* calling `loadContent()`, so a partial that appends
    synchronously produced no observed mutations and every page waited out the full 6 s
    ceiling. Start the observer first.
17. **Infinite scroll stalled after exactly one page.** `IntersectionObserver` only reports
    *changes*, and `attach()` re-observes after every flush — so the one callback landed
    inside the 800 ms cooldown, was dropped, and nothing ever re-fired while the sentinel
    stayed in view. `pump()` re-arms after each successful load.
18. **A deliberate "load more" click was swallowed by the cooldown.** Automatic triggers
    back off; a click does not.
19. **Settings were read once at boot**, so the options page appeared to do nothing until a
    reload. `chrome.storage.onChanged` now re-runs `onRoute()`.
20. **Turning a feature off produced a blank page.** `standDown()` dropped `shd-gate` but
    not `shd-active`, so suppress.css kept native Reddit hidden with nothing over it. It
    had never mattered before, because that path only ran at boot.
21. **Age gates were blanked for 12 s and then blamed.** Extending the deadline to
    `MAX_WAIT_MS` to stop failing slow pages meant any page with no posts — the routine
    logged-out case — sat behind `visibility: hidden` for the full window before showing
    an error screen *over the age-gate button*. The deadline now distinguishes "no feed
    container at all" (not a page Sheddit renders: un-blank, stay out of the way, keep watching) from
    "feed present but nothing recognisable in it" (suspicious: fail). An early `load`
    listener handles it within milliseconds instead of at the first 1500 ms tick.
22. **Comment threads were truncated to whatever arrived first.** `paginator.js` hardcoded
    the feed's partial selector and `pipeline.js` attached a sentinel only on `LISTING`, so
    a thread rendered its delivered slice and the rest was unreachable — on the page type
    a reading-focused extension exists for. `commentsPage()` contained **no partials at
    all**, so no test could have noticed, even though ARCHITECTURE §1.5 had recorded "29
    pending partials" on a real thread. Same blind spot as the feed bug, one page type over.
23. **Vote delegation could not see into shadow roots.** `m.source.querySelector(...)`
    cannot reach a button inside `shreddit-async-loader`'s shadow root, and the miss was
    logged with `console.debug('not hydrated yet')` — making a permanent break look
    identical to a timing miss. Now `SHD.dom.deepQuery()` pierces open shadow roots and a
    miss warns once with the evidence needed to tell the two apart.
24. **`award-icon-url` and `is-link-post` were dead mappings.** `verify:live` found
    neither present on every post any more; neither was read anywhere downstream
    (`isLink` was never even copied into the model). Removed rather than chased —
    a mapping to an attribute nothing consumes is not a contract worth defending.
25. **The comment body lookup was one DOM reshuffle from showing the wrong text.**
    Reddit nests comments now, so a comment's subtree contains its *descendants'* bodies.
    `el.querySelector('[slot="comment"]')` returned the right node only because Reddit
    happens to emit the body before the child container — flip that order and every
    comment renders its first child's text. Now scoped with
    `closest(COMMENT) === el`. Every fixture was flat, so nothing could have caught it;
    `nestedCommentsHtml()` reproduces the live shape, in both orderings.
26. **A legitimate thumbnail host was rejected.** `b.thumbs.redditmedia.com` is Reddit's
    post-thumbnail CDN, and the allowlist excluded it along with the `styles.`/`emoji.`
    decoys that caused bug 1 — so those posts silently fell back to a placeholder. The
    allowlist is still an allowlist; do **not** relax it to `*.redditmedia.com`.
27. **The paginator could spin on one comment branch for ever.** `loadNext()` does
    `querySelector(SEL)` then `loadContent()`, repeatedly. That only advances because the
    *feed's* partial replaces itself with the next slice — verified live. Comments were
    assumed to work the same way and the fixture encoded the assumption, but the live tree
    has one partial per truncated branch and nothing says they replace themselves. If they
    don't, every iteration re-picks the same element: one branch expands over and over
    (duplicate replies on screen), the other nine are never reached, and the whole suite
    stays green because both fixtures helpfully removed themselves. Driven partials are now
    stamped `data-shd="done"` and the selector excludes them, which is correct under either
    mechanism. `commentsPage({branchPager:true})` models the surviving kind; the packed
    extension asserts it too, because the stamp is written in the isolated world and read by
    the main-world bridge.
28. **Comment loads never waited for the comments.** `settle()` watched
    `document.querySelector(C.FEED)` unconditionally and a comments page has no
    `shreddit-feed`, so it took the "no container" early return and resolved *immediately* —
    `busy` cleared before a single comment had arrived and `pump()` was free to fire the next
    page into a load still in flight. It watches the route's container now. Every fixture
    appended synchronously, so there was never anything to wait for and no test could tell a
    working wait from a skipped one; `COMMENT_PAGER_SCRIPT` now delivers on a later tick.
29. **An interstitial that ships an empty feed was blanked and then blamed.** `gate.js` split
    on "is there a feed container", which reads `<shreddit-feed></shreddit-feed>` as "Reddit
    gave Sheddit somewhere to put posts and rendered none" — the redesign signature. Measured
    against the packed extension: the page **never** un-blanked and `#shd-error` landed on
    top of the "Yes, I am over 18" button. Bug 21 by a second route. It also mishandled a
    case needing no interstitial at all — a subreddit with no posts — which the no-feed
    branch already claimed in its own comment to handle and did not. The split is now two
    steps: no container, or a container holding nothing, both mean stand aside; only a
    container **full of markup that cannot be read** still fails. Whether real Reddit's 18+ page
    carries the feed shell is **unverified** — both shapes are fixtures precisely because
    nobody has looked at a real one.
    Two traps found while testing this, both of which produced green-but-worthless
    assertions: the counterweight test must **not** use `/r/broken/`, because that fixture
    still ships `shreddit-post`, so `sourceCount()` short-circuits and the populated-feed
    branch is never reached — hence `/r/renamed/`. And the promptness threshold must sit
    under `FIRST_CHECK_MS`: at 2000ms it passed with the fast path reverted, because the
    1500ms fallback tick cleared the page at 1557ms.

<a id="30"></a>
30. **Sheddit hid an age gate and showed its content.** Reddit's 18+ interstitial is a modal
    over a *populated* feed, not a replacement for it — so `sourceCount() > 0`, the pipeline
    renders, `reveal()` runs, and none of the deadline logic above ever sees the page. Then
    suppress.css hides every body child, and the modal lives inside `shreddit-app`. Measured
    against the packed extension: the dialog reported `visible=false` and the point where
    "Yes, I'm Over 18" had been hit was Sheddit's own `<p>`. Both interstitial fixtures had encoded the
    same wrong assumption — that a gate *replaces* content — so neither could catch it.
    `gate.js` now watches `body.rpl-scroll-lock` and stands down while any Reddit modal is
    up. Note the two independent halves: dropping `.shd-active` un-hides native Reddit, and a
    separate **unscoped** rule must hide `#shd-root`, or its rows stay on the page unstyled
    (bug 9, through a new door).
    **Superseded 2026-08-20 (project decision):** hiding the gate while rendering its
    content is now the *intended* behaviour — see the popup policy note after this
    list. The entry stays because it documents the anatomy (a modal over a populated
    feed) and the scroll-lock signal, both of which the suppression policy runs on.
31. **The per-comment button row could run off a narrow screen.** `.flat-list.buttons` is
    `display: flex` with no `flex-wrap`, which defaults to `nowrap` — the row is laid out on
    one line and simply overflows once its content is wider than the viewport. Real failure,
    reported from a Mac: **11px** of horizontal overflow on the comments page at 360px. It
    passed here for weeks because this container has no Verdana — the font the stylesheet
    actually asks for — so the narrower fallback happened to fit, and the geometry suite
    never saw the case it was written to catch. All three `display: flex` rules now wrap
    (header, sort tabs, comment buttons), and `test/css-lint.js` requires it statically,
    which does not care what fonts are installed. **Do not try to reproduce this with
    `font-size`/`letter-spacing` scaling in geometry** — tried here, and it does not work:
    a flex item's default `min-width: auto` lets its *own* text wrap onto a second line and
    the item shrink to fit, instead of the row growing. Measured non-monotonic: 112% and
    150% font-size both overflowed, 115% and 130% did not, and `letter-spacing` up to 8px
    produced nothing at all. That is not a fluke to work around — it is fundamentally not a
    stand-in for a different font's glyph metrics, and shipping a check on it would pass on
    a green run with the bug still present.

32. **A reader would have been trapped behind a login wall.** Bug 30's fix — stand aside
    whenever `body.rpl-scroll-lock` is set — was right for the age gate, which the user can
    clear in one click. It is wrong for `desktop_auth_blocking_upsell`, a signup wall that
    fires ~30s after load on its own timer and sets the *same class*, but has **no close
    control** and ignores Escape and its own overlay. Deferring to it hides Sheddit's layout, shows
    native Reddit, and leaves the reader facing "Get Started" with no way out but signing up —
    worse than not being installed. That one specific, verified case is now **removed**;
    everything else still gets deferred to, because an unknown modal may be something the
    user genuinely must resolve. Two traps found while wiring it: watching only `body[class]`
    assumes Reddit inserts the elements *then* locks scroll — reverse that order and nothing
    ever notices, so insertion is observed too (scoped to `shreddit-app`'s direct children,
    not a second full-subtree observer). And **hiding the host does nothing** — the visible
    dialog is a portaled sibling, so both nodes must go.

33. **Standing aside for every Reddit modal threw the reader out of the layout.** Reported
    from real use: "I periodically get thrown back to the regular layout to view some
    interstitial popup, and after a few seconds it reverts without intervention." That is bug
    30's fix working as written — `rpl-` is Reddit's design-system prefix and the scroll lock
    is set by *every* overlay it raises, self-dismissing ones included, so each one cost a
    full round trip out of the layout and back. The note in `contracts.js` calling "covers
    every Reddit modal" *intended* was a generalisation from the single case there was
    evidence for. Standing aside is now debounced by `DEFER_DELAY_MS` (500 ms): a modal the
    user must answer is still up when it fires, a transient one is long gone. Un-deferring is
    **not** debounced — coming back is always safe and always wanted. Asserting "never
    swapped, not even briefly" cannot be done by polling, so `modal-transient` has the *page*
    record every `data-shd-deferred` transition and the test reads the count.

    **Superseded 2026-08-20 (project decision):** the debounce and the whole stand-aside
    it was debouncing are gone — the layout never leaves for any popup now, which is
    this fix's promise made absolute. The transient fixture survives, asserting zero
    swaps instead of few.
34. **Every sort-tab click was swallowed or handled one navigation late.** `route.js`
    listened to the Navigation API's `navigate` event — which is **pre-commit**, so
    `location.pathname` still held the old URL — and read location from a microtask, which
    drains before the URL updates. Worse, it wrote its change-detection latch even when it
    concluded nothing changed, so one stale read became a permanent one-navigation phase
    error: URL moves but content stays, or content moves but the URL doesn't, alternating.
    Confirmed live click-by-click by an independent review. The knock-on was the truncated
    "6 posts, no more pages" list: posts consumed and stamped during the swallowed window
    were unrenderable after the late teardown. Fixed by emitting the **destination** path
    pre-commit and latching only on emit; `navigatesuccess`/`popstate` are post-commit
    safety nets. Two traps for whoever touches this: `destination.sameDocument` is
    **false** for navigations Reddit then intercepts (it describes pre-interception
    intent), so never filter on it; and `onRoute` now runs pre-commit, so nothing
    downstream may read `location` during it — `route.sortOf()`/`subredditOf()` default to
    the emitted path for exactly that reason. **Do not add un-stamping to `onRoute`**: at
    emit time the DOM still holds the outgoing page's posts, and un-stamping re-renders
    the old sort into the new root. The stamps are what make the teardown-time sweep skip
    them; Reddit was measured to fully replace post elements on a sort change (0/4
    reused). A mutation row proves the suite catches that mistake. **That measurement
    covered sort clicks only** — history traversals REUSE the removed nodes, stamps
    intact, and dead-ended on them for exactly this rule; bug 51 is the per-element
    insertion-time answer that keeps both properties.
35. **A page loaded in a background tab always failed.** `flush()` was scheduled with
    `requestAnimationFrame`, which does not run in a hidden tab; the gate's deadline is a
    `setTimeout`, which does. Middle-click, ctrl-click, session restore — every background
    open reached the 1500 ms check with sources present and nothing rendered, drew the
    error screen, and **latched** (fail() disconnects the observer), so foregrounding the
    tab showed the error, not the page. Found live by testing's very first tab: the
    tell was `sources: 3, rendered: 0, errors: 0` with **zero `data-shd` stamps** — the
    queue never ran at all, which is never a rendering bug. `schedule()` now uses
    `setTimeout` when hidden (DOM work is not throttled, only painting), and a
    `visibilitychange` re-arm rescues a flush parked on a rAF booked just before hiding.
36. **The 1500 ms deadline accused a pipeline that had not started.** gate.js arms at
    `document_start`; pipeline.js boots at `document_idle` and then *awaits
    chrome.storage.sync* before classifying anything. In that window "sources present,
    nothing rendered" means nobody has tried — and on routes Sheddit never handles (a user
    profile carries `shreddit-post` elements), it would put an error screen on a page
    `standDown()` was moments from disowning: a flash that removes itself, the bug report
    nobody can reproduce. `onRoute()` now calls `gate.engage()` when it takes a route;
    until then the deadline un-blanks (`not-started`) and only accuses at `MAX_WAIT_MS`
    (`pipeline-stalled` — honest, because a live timer at 12 s with sources and no
    pipeline means the renderer never started).
37. **The upsell surgery ran on routes Sheddit had stood down from.** `syncNativeModal`'s only
    guard was `stopped()`, which `standDown()` does not set — so on search, profiles,
    modmail, and any listing whose toggle was off, Sheddit kept deleting Reddit's login wall
    and stripping its scroll-lock class. "Unhandled routes must be left completely
    untouched" is violated as much by deleting an element as by restyling one.
    `suppressKnownUpsells()` is now gated on `engaged`; the *defer* half still runs
    everywhere, deliberately — it is read-only and is what stops the extension from blanking
    a page over a modal that appears before rendering.
38. **Defer state survived every teardown, and one path stuck for good.** The only thing
    that normally clears `deferred` is a body-class mutation reaching `syncNativeModal` —
    which short-circuits on `stopped()`. So: defer to a modal, hit the error budget,
    modal closes (mutation discarded), navigate on (`resetForRoute` cleared `failed` but
    not `deferred`), render — and `reveal()`'s `if (!deferred)` withheld `.shd-active`
    forever. Layout built but unstyled, native Reddit visible, no error screen because
    nothing failed. Now: `fail()`/`release()`/`standDown()` clear defer state outright,
    and `resetForRoute()` **re-derives** it from the DOM (a route change during a genuine
    age gate must stay deferred). Three redundant paths heal the sticky case; the mutation
    row removes all three, because any one alone is covered by the others — the first run
    of that row proved it. Related: `resetForRoute` no longer re-blanks while deferred,
    which is only observable mid-load — on a completed document `nothingToRender()`
    un-blanks the same call, which is why that test pins `readyState`.
    **Superseded 2026-08-20 (project decision):** the defer state this entry is about no
    longer exists — popups are suppressed, never deferred to. Kept because it is this
    codebase's best worked example of redundant-path healing and how to mutation-test
    it.
39. **The insertion observer's fallback latched onto `body` and never let go.** If
    `shreddit-app` was not in the DOM when the observers attached, `|| document.body` was
    a permanent substitute — so an upsell later portalled *into* the app landed in a node
    nobody watched, with no class change to notice it by. That silently reinstates the
    exact hole the two-observer design closes. The fallback now watches body's children
    only until the app arrives, then hands over and disconnects.
40. **Infinite scroll dead-ended holding an answer it had invented.** The chain continued on
    `visible` — the IntersectionObserver's last word — but `attach()` runs after *every*
    flush and `detach()` resets `visible` to `false`. So every successful load ended by
    throwing away the one fact its own continuation depends on, then waited for the observer
    to say it again. An observer only reports **changes**, and a reader already scrolled to
    the bottom of the document produces none, so the correction never came. Measured live
    off the sentinel's own diagnostics, five pages in: sentinel 80px **above** the fold, 22
    undriven partials still in the feed, `shdVisible: false`, and `shdSinceLast` frozen at
    2004 ms across two readings ten seconds apart — the paginator had not run at all since
    its last *success*. That is the cruel part: the label read `load more`, which is what a
    load that **worked** leaves behind, so nothing on screen said anything was wrong. The
    gate is geometry now (`inRange()`, measured at decision time), and the observer is
    demoted to a wake-up that pumps on **any** report, intersecting or not. Bug 17's lesson
    one door over: never make the continuation of a chain depend on an event that may not
    fire. Two traps while testing it. jsdom's `IntersectionObserver` is a stub that never
    fires, so the auto chain had **no jsdom coverage at all** — the new section installs one
    that reports once and then goes silent, which is exactly the live symptom, and it needs
    a control asserting the stub was re-observed (`observes > 1`) or a stub that simply
    never delivered would "prove" the same thing. And the counterweight — scroll back to the
    top, stop pulling pages — passed with the geometry gate torn out entirely, because a
    *manual* click loads a page without ever pumping: there was no chain running to stop.
    It has to start the auto chain first.
<a id="41"></a>
41. **Sheddit showed graphic imagery that Reddit itself had blurred.** The one idea — read the
    attributes, render Sheddit's own markup — has a consequence nobody had followed through: the
    blur Reddit puts on NSFW thumbnails for logged-out readers is a property of *its*
    markup, and Sheddit lifts the image URL out of the post and renders its own `<img>`. So a feed
    Reddit had deliberately obscured came out fully explicit in Sheddit's layout. Found on
    `r/UkraineWarVideoReport`, logged out — a graphic war-footage sub, which is exactly where
    the difference stops being cosmetic. Adult posts now get old reddit's placeholder tile
    plus its `nsfw` stamp, with `showNsfwThumbnails` as the opt-in old reddit also had; the
    stamp shows either way, because it labels the post rather than standing in for the
    picture. **Verified live 2026-08-18** on `/r/CombatFootage/`, logged out, 28 posts with 1
    flagged: the attribute is `nsfw`, and it carries an **empty string** on an adult post and
    is **absent** on a safe one. That is the boolean-binding spelling, and it is the one the
    obvious implementation gets backwards — `""` is falsy, so `if (el.getAttribute('nsfw'))`
    reads every adult post as safe and renders every graphic thumbnail full-size. `nsfwOf()`
    tests for absence and for the literal `"false"`/`"0"` instead, so it survives both
    spellings a custom element can use for a boolean, and the fixture carries both. The
    contract was a list of four candidate spellings while it was unverified; it is collapsed
    to the one real name now, and `verify:live` gained a section that fails on any
    adult-looking attribute it does not recognise — which is what actually defends against a
    rename. **The trap in checking this**: a run against a subreddit with no adult posts
    reports every candidate absent, which is *identical* to what a completely wrong attribute
    name looks like. That mistake was made first, against the logged-out front page, and it
    proved nothing. The `verify:live` section reports that case as INCONCLUSIVE rather than
    as a pass.
<a id="42"></a>
42. **Suppression hid native Reddit from sighted users only.** The rule was `position:
    absolute` + `1px` + `clip` + `opacity: 0` — which is precisely the "visually hidden"
    recipe you reach for when you *want* screen readers to keep reading something. So the
    whole native page stayed in the accessibility tree and in find-in-page, and every post
    was announced twice, once from Sheddit's layout and once from Reddit's. Reported from a real
    session: a page-text extraction returned a native `<article>` carrying
    `u/username • 2 days ago`, metadata that appears nowhere in Sheddit's rendered list. One
    declaration fixes it — `visibility: hidden`, which removes a subtree from the a11y tree
    per spec while keeping it in the DOM, keeping attributes readable, and still dispatching
    a programmatic `.click()`, so delegation and comment-body cloning are unaffected. Note
    what the old fixture could not see: its `shreddit-post` carried **no text at all**, so
    nothing could tell a suppression that hides from everyone from one that hides from
    sighted users only. `postHtml()` now emits Reddit's own rendered copy, and the assertion
    counts `link` nodes in Chrome's real accessibility tree — not the computed style, which
    is the mechanism rather than the thing users get. Count links, not nodes: one anchor
    contributes both a `link` and a `StaticText` child, so a raw node count reads 2 for a
    single correct row and could never be 1.
43. **css-lint's "every theme defines every colour token" check only guarded a hardcoded
    list.** Found by walking into it while doing 41: after adding `--shd-nsfw` to the base
    palette and all four themes, deleting it from one theme again produced a clean 31/31
    pass. `REQUIRED_TOKENS` was hand-maintained, so *every token added after it was written*
    was unprotected — and a theme silently inheriting classic's colour on a dark palette is
    the entire failure that check exists to catch. The list is derived from the base palette
    now, minus an explicit `NOT_A_COLOUR` exemption for the design tokens a theme is allowed
    to inherit, so the default is "required" and skipping one is deliberate. A second
    assertion rejects a stale exemption naming a token classic no longer declares.

44. **The comment thread line bracketed the wrong thing, and the arrow gutter compounded the
    indent.** Two bugs in one rule, both invisible without something to compare against.
    The dotted guide line was a `border-left` on `.thing.comment` — around the comment you
    are *reading* — where old reddit puts it on `.child`, the wrapper around the *replies*.
    Both draw a line at every level, so nothing looks obviously wrong; what differs is where
    it starts and stops. And the 22px gutter that reserves space for the absolutely-positioned
    vote arrows was `padding-left` on `.thing.comment`, which every nested level inherits and
    adds again — so the per-level indent was 31px against old reddit's 25px, and the extra
    was the gutter being paid for once per level of depth. Old reddit never had this because
    its midcol is a **float**: the space is consumed inside the comment instead of in front of
    it. The gutter is on `.entry` now, spent once per comment. Note what the old assertion
    could not see — it checked the step was *uniform*, and 31px was perfectly uniform; the
    step is pinned to 25px now, and css-lint separately asserts the line is on `.child` and
    is **not** on `.thing.comment`, because putting it back without removing it gives a double
    line and a 26px step.
45. **Comment vote arrows were hidden until hover, on a claim that measurement contradicts.**
    The rule carried the comment "old reddit hides arrows until hover" — it does not; its
    comment midcol is 15px, floated, and painted at rest. A confident assertion in a code
    comment is exactly the kind of thing this repo has learned to distrust, and it survived
    because the geometry assertion that covered it hovered *first* and then checked
    visibility, so it passed whether or not the gate existed. It reads visibility at rest now,
    with the hover check kept as the counterweight.
46. **Thumbnails were a 70x52 bordered grey box where old reddit has a bare 70x70 square.**
    The height alone changed the vertical rhythm of every row in the list. The fix has a trap
    worth knowing: dropping the border and fill globally — the straight reading of the
    measurement — is wrong, because Sheddit's `self`/`link`/`nsfw` placeholders are *generated
    content*, so without a fill and an edge they are three grey letters floating in the row.
    The tile treatment stays on the placeholders only, which makes `box-sizing: border-box`
    load-bearing: without it the bordered tiles measure 72px against the images' 70px and
    every mixed row loses its baseline by 2px. Geometry measures both kinds together, because
    measuring either alone cannot see it.
47. **Old reddit's action row is one grey; ours read as a line of blue links.** A single
    override — `.flat-list.buttons a.comments { color: var(--shd-accent) }` — made the first
    item of every row accent blue, so the row competed with the title instead of receding
    under it. Measured as the most noticeable per-row departure from the real thing. Related
    palette-level departures fixed in the same pass, all from `old-reddit.md`: the header was
    grey where old reddit's is `#cee3f8` on `#5f99cf`; unselected sort tabs were flat blue
    pills, inverting the folder-tab metaphor (old reddit draws *every* tab bordered and white
    with orangered text, and only the **bottom** border distinguishes the selected one); the
    right rail was a bordered card where old reddit's `.side` is an unboxed transparent
    column; and `.rank`/`.score` used the tagline's `#888` instead of the lighter `#c6c6c6`
    that puts them below the tagline in the hierarchy rather than level with it.
    `--shd-arrow` is now `--shd-dim` and covers all three, because old reddit uses one grey
    for arrows, rank and score.
48. **Three mutation rows had gone dead, and nothing said so.** `ANCHOR MISS` is printed but
    is neither a pass nor a failure, and the script's summary counts only `FAIL` lines — so a
    row whose anchor stopped matching reads as silence. `options DEFAULTS drift` was broken by
    the `showNsfwThumbnails` addition in the commit *before* this one; `cooldown swallows the
    deliberate click` had rotted when `return false` became `refuse('cooldown')`; and
    the row for `failure leaves unstyled DOM on the page` matched **twice** (`fail()` and `release()`) and hit the
    right one only because `apply()` replaces the first occurrence. All three were dead and
    all three catch again. The lesson is the one already in the mutation section below and it
    now has teeth: run the anchor check **before** believing a green mutation sweep, and note
    that editing a source file can break a row belonging to someone else's bug.
49. **A text post's comments page rendered no post text.** The one idea — read the
    attributes — has a second consequence nobody followed through (bug 41 was the first):
    post CONTENT is not an attribute. It arrives as slotted light DOM,
    `div[slot="text-body"]` holding Reddit's rendered `.md`, confirmed live 2026-08-20 —
    so the comments page built the submission's title, tagline and buttons and silently
    dropped its body. Reported from real use as "comments fine, post content missing", and
    invisible to every suite because no fixture carried the slot. The body is cloned now,
    exactly like comment bodies (links/code/quotes survive, no markdown re-parse), scoped
    with `closest(POST) === el` (bug 25's lesson, applied before the reshuffle this time),
    into old reddit's measured selftext box. `C.POST_BODY` is the contract.
50. **The error card could not tell a stale contract from a renderer that never ran.**
    "sources: 26, rendered: 0, errors: 0" was the card's whole story, and a report
    sitting on it diagnosed a markup change and chased contract renames its own
    attribute dump disproved (r/Superstonk — the report's cascade theory is
    also architecturally impossible, and is now pinned by a test plus a mutation row that
    reintroduces the claimed short-circuit). Two very different failures share that
    signature: every element processed and rejected (stale contracts.js — fix the
    attribute), or the render queue never draining at all (bug 35's family — nothing was
    even attempted, and blaming markup sends the reader to the wrong file). The fork is
    the stamp count, because pipeline.js stamps every element it processes, succeed or
    fail. The card now prints `stamped:` (0 = queue never ran), a `rejected:` tally —
    model.js records which required attribute each null was missing instead of discarding
    the evidence — and an explanation that branches on the two cases. `rendered 0 /
    errors 0` with no explanation is no longer a reachable state.


<a id="51"></a>
51. **Every back/forward landed on the error card — stale stamps on restored nodes.**
    Live testing, on a verified build, 9/9: `sources: 3, stamped: 3, rendered: 0`. The
    self-diagnosing card earned its keep — stamped-but-nothing-rendered names the cause
    outright. Sort clicks REPLACE Reddit's post elements (measured live: 0/4 reused), and
    bug 34's "do not un-stamp in onRoute" rule was built on that measurement; a history
    TRAVERSAL, though, re-inserts the very nodes Reddit removed, `data-shd` stamps and
    all, so the sweep skipped every one as already-rendered and the deadline correctly
    reported that nothing had been built. Fixed per-element on the OBSERVER path only: a
    stamped element being INSERTED whose rendered row is absent carries a stale stamp —
    the stamp promises the row exists — so it is un-stamped and queued. The restriction
    to insertions is load-bearing: onRoute's sweep still skips stamped nodes
    unconditionally, because at pre-commit the outgoing page's stamped posts are still in
    the DOM and reviving them there is bug 34's mixed-sorts regression through a new
    door. The counterweight is its own mutation row: without the row-exists check, a
    merely REPARENTED element renders twice. The `/r/spa/` fixture now caches and
    restores the same nodes on traversals, which is the live behaviour.

52. **An empty subreddit was blamed for being empty.** `feedIsPopulated()` asked "does the
    feed container hold more than a handful of elements", which reads Reddit's own *"this
    community doesn't have any posts yet"* panel — a heading, a paragraph, a button, some
    wrappers — as a feed full of content that failed to parse. So a page working exactly as
    Reddit intended got the `no-content` failure screen. Observed live 2026-08-20 on a
    quarantined sub, logged out, where Reddit serves ZERO posts: `sources: 0`, card at
    ~12s. That is this module's cardinal sin (bugs 21 and 29, twice before) and the
    decision tree's own comment already claimed to handle "a subreddit with nothing in
    it". The question is now "is there LIST-SHAPED structure here" — three siblings
    sharing a tag name, with one level of unwrapping for the comment tree's `<section>` —
    because a list of posts has repeated structure and a message block does not. The
    deliberate trade, recorded because it weakens a case: if Reddit renamed BOTH the post
    element and its `article` wrapper, this stands aside quietly where the old count
    failed loudly. Never observed, untested either way, and standing aside over a page that
    cannot be read beats an error card over a page that is fine. `/r/empty/` is the fixture;
    `/r/renamed/` is the counterweight that must still fail.

53. **Comment pagination never worked live, and the trigger layer was why.** Live testing
    finally read the sentinel's own diagnostics: `shdIoTicks: 0` across two serials — the
    IntersectionObserver never delivered even its initial report, and it was the ONLY
    thing that could start the pump. Bug 40 demoted the observer to a wake-up but left it
    the sole wake-up. attach() now pumps once itself (geometry-gated by `inRange()`) and a
    passive throttled scroll listener pumps too; an observer that never speaks costs
    nothing any more. Two more layers under that, both from the same capture: the live
    tree holds ~25 per-branch expanders (`loading="action"`, inside their comments) and
    exactly ONE top-level continuation partial (`loading="lazy"`, direct child of the
    tree's `<section>`) — document order puts the branches first, so `partial()` now
    prefers a candidate NOT inside a comment. And that preference broke the bridge
    protocol silently: the pick is policy the main world does not share, so the isolated
    world stamped one partial while `querySelector(SEL)` in the main world drove another —
    caught by the fixture, twice. The CHOSEN element now crosses the bridge (marked
    `data-shd-driving`, selector only it matches). Finally, live testing proved Reddit's own
    "N more replies" control works logged out and the pipeline renders what it loads
    (25 → 35, both counts) — so comment rows now carry that control, delegated and
    resolved at click time (bug 23's lesson), and `consume()` prefers the PHYSICAL parent
    when nesting: late replies arrive when the depth-stack already points at the newest
    chain, so stack placement would nest them under the wrong branch.
54. **The deadline accused a queue it never tried to drain.** Two field cards (rounds 4
    and 6) read `sources: N, stamped: 0, rendered: 0` — transient, cleared by a reload,
    and live testing's coincided with a main thread the automation had frozen for 45+ seconds.
    The gate's deadline is a `setTimeout` and runs on recovery; the flush it blames is
    parked on a rAF that may not have fired yet (bug 35's family). `gate.check()` now
    calls `SHD.pipeline.kick()` — a synchronous drain of any queued work — before failing,
    and only accuses if the queue really had nothing to give.
55. **Cloned bodies wore Reddit's theme colour — faint text on every light palette.**
    Open question 7 stopped being cosmetic: Reddit's page stylesheet still matches the
    `.md` classes on Sheddit's cloned selftext and comment bodies, and its text colour rides the
    HOST page's theme. The host pages run `theme-dark`, so clones arrived with near-white
    text that landed on Sheddit's light palettes as barely legible grey. Reported from real use
    the day selftext shipped, invisible to every suite because no fixture served Reddit's
    stylesheet — they do now (`REDDIT_PAGE_CSS`, the known-leaking rules), the comment
    fixture bodies carry the live clone classes, and geometry computes the winner with a
    control proving the hostile sheet is live. The fix forces `--shd-text` down the clone
    with `!important` (links and blockquotes re-asserted after it, cascade order breaking
    the tie), touching nothing structural — list markers, tables and code stay Reddit's.

56. **Both event wake-ups were dead in the field, and the chain still needed one.** Live testing,
    same environment three rounds running: `shdIoTicks` 0 for the whole round AND a real
    scroll to the bottom that changed nothing — sentinel at top 650 in an ~840px window,
    dataset byte-identical — while every timer in the extension ran fine (the chain itself,
    once started by an expander click, ran five pages on plain `setTimeout`s). Bug 40's
    lesson, third iteration: attach-pump and the scroll listener are ACCELERATORS; a slow
    `setInterval` heartbeat (2s, geometry-gated like every pump) is the wake-up that cannot
    be taken away. It also publishes `diag()` per tick, so the next report reads live
    state instead of a frozen attach-time snapshot — which live testing mistook for a stale
    build. Suite note: the heartbeat runs for a PAGE's lifetime, so run.js now exits
    explicitly — abandoned jsdom windows otherwise keep node alive on their intervals,
    which presented as a suite that passes and never returns.
57. **A load wedged `busy` for 60+ seconds and took the chain with it.** Live testing, page 5
    of a 5,285-comment thread: `shdBusy: "true"`, `shdSinceLast` frozen, no refusal, no
    error — past every settle timer, which are the only things loadNext awaits, so WHERE it
    hung is genuinely unknown. Instrumented and guarded rather than guessed at: `shdBusyFor`
    counts the wedge up live, and past `BUSY_LIMIT_MS` (12s, twice the settle ceiling) the
    heartbeat releases it, publishes `busy-wedged` as the refusal, and the chain continues —
    one page lost instead of the session. The jsdom wedge is manufactured by swallowing
    exactly the settle-timer delays, the only honest reproduction available until
    `shdBusyFor` catches a live one forming.
58. **Video posts were a closed loop.** `content-href` on a video post is a bare v.redd.it
    URL, and Reddit 302s a logged-out session from there straight back to the post's
    comments page — which Sheddit renders, whose title links back to v.redd.it (measured, round
    7: two posts, both looped, no player anywhere). The title now points at the best mp4
    out of `packaged-media-json`: parsed defensively and DEEP-SCANNED for mp4 URLs (the
    attribute name is the contract, its internal shape is not), `DASH_<n>` picking the
    highest rendition, and any miss — attribute absent, JSON unparseable, no mp4 inside —
    falls back to the old link untouched. The attribute name was named by a report
    before it was ever captured; `verify:live` gains the section that confirms it, and
    the fixture lists renditions low-quality-last-first so a first-URL implementation
    cannot pass by luck. **verified live 2026-08-21, r/aww**: 7 video rows, 6
    carried the JSON on the nested player, all 6 titles resolved to mp4 and all 6 picked
    the maximum rendition; the picked URL plays in a plain tab (readyState 4, frames
    advancing). The one v.redd.it holdout had a player with `src` that never gained the
    JSON attribute at all — so the click-time upgrade path (bug 61b) has still never
    fired live, for want of a candidate: no row that had the JSON was ever wrong.

59. **The feed burned all 40 page slots on hovercards.** Live testing, front page: `pages: 40`,
    rows frozen at 28, sentinel still reading "load more". `shreddit-feed
    faceplate-partial` — the fallback clause — also matches Reddit's HOVERCARD partials,
    one per author and per subreddit link, INSIDE the posts (live testing counted 82 partials
    on one page, most of them hovercards). Once the real feed partial was spent the chain
    drove hovercard after hovercard, each stamped, each yielding nothing. Two independent
    guards, and they need SEPARATE mutation rows because either alone hides the other:
    a partial inside an item is never drivable on a LISTING (`ITEMS`/`ITEM_FALLBACK` — on
    COMMENTS it stays a preference, because a per-branch expander IS legitimate), and a
    load that adds no new source elements counts toward `UNPRODUCTIVE_LIMIT` and ends the
    chain honestly. The second guard's own trap, caught by the pre-existing cooldown test:
    the before-count must be taken BEFORE `requestLoad()`, which dispatches synchronously
    and lets a warm partial append before it returns — bug 16's lesson in a new place.
60. **The page cap was reached silently.** `pump()` guarded on `pages >= MAX_PAGES` and
    returned BEFORE `loadNext()` could set a label, so a chain at the ceiling sat reading
    "load more" — the label of a load that SUCCEEDED. Measured live testing on a 2,040-comment
    thread and the front page both. pump reports it now. The test drives to the cap
    MANUALLY and then stops, because loadNext has its own cap branch and letting it fire
    would test the wrong one.
61. **The video contract was wrong in three ways at once, and the fixture agreed with all
    three.** Live testing captured `packaged-media-json` live and it is: (a) on a nested
    `<shreddit-player>`, NOT on `shreddit-post` — so it must be QUERIED for in the post's
    subtree, scoped with `closest(POST) === el`; (b) LAZY — 1 of 4 video posts carried it
    at first paint, so render-time resolution alone leaves most titles pointing back into
    the v.redd.it loop, and listing.js re-resolves at CLICK time (mutating `href` inside
    the handler without preventing default, so the link stays a real link); (c) named
    `m2-res_<height>p.mp4`, not `DASH_<n>` — ranking on DASH_ scored every live URL zero,
    so the stable sort returned the FIRST url, which is the LOWEST quality Reddit offers.
    The fixture had encoded an assumption rather than a capture and passed all three ways.
    Its own note about renditions-listed-lowest-first was right and protected nothing,
    because the rank function it was guarding never matched the names it used.
62. **A control that ignores a click is worse than no control.** Live testing: two clicks on
    the delegated "N more replies" control did nothing at all, and the tell was that the
    label never changed to "loading…" — the handler had not run, because the click landed
    on the `<li>`'s own box rather than the anchor inside it. The handler is on the list
    item now (anchor clicks still bubble to it), and a native control that has vanished by
    click time says "no longer available" instead of silently removing itself.
63. **The unproductive limit lied about ending a chain it never ended.** Live testing's front
    page, sampled live: the label declared "no more pages" and retracted it SIX times in
    one series while rows grew 28 → 178, and `pages` read 33 for roughly 7 productive
    loads. Live testing's "two duds means done" never actually ended anything — the heartbeat
    retries two seconds later, resets nothing, and drives the partial again — and that
    *accidental* softness is what rescued a throttled tab whose content landed after
    settle's window (the "unproductive" loads turned productive in arrears). So the soft
    semantics are the KEEPERS, and what was fixed is the dishonesty around them:
    `pages++` moved inside the productive branch, because the 40-page budget is a memory
    guard on *content* and a throttled tab was starving its own budget on loads that
    added nothing; and the at-limit refusal is quiet now (`unproductive` in the
    diagnostics, label back to "load more") because "no more pages" belongs to
    `exhausted` alone — the state where nothing is left to drive, which a genuinely dead
    feed still reaches because stamps deplete the pool. Two mutation rows, one per half,
    because either alone leaves the other looking covered.
64. **"no more pages" flashed between pages that then loaded fine.** Reported live the day
    0.9.0 shipped: the sentinel defaulted to "no more pages" and flapped against
    "loading more…" for a second or two before more posts arrived on their own. Bug 63's
    lie, one branch over: the `exhausted` refusal set the label the INSTANT `partial()`
    found nothing to drive, but a driven partial's successor streams in late — on a slow
    or throttled feed the inter-page gap is long enough for the auto chain to look, find
    nothing, and announce an ending the next pump retracts. The auto path now commits to
    the label only once the empty state persists (`EXHAUSTED_STICKY` consecutive empty
    looks, ~4–6s at the heartbeat's cadence); a deliberate manual click still gets its
    answer immediately (a click that silently does nothing is bug 62's sin), and the
    `exhausted` refusal is still published to the diagnostics on the FIRST look — only
    the user-facing label waits. A genuinely dead feed still reaches the label a few
    heartbeats later, which the silent-observer counterweight now waits for.
65. **Every live profile handed back, because the tag was right and everything else was
    wrong.** 0.10.0 shipped profiles with `shreddit-profile-comment` as a GUESS and read
    it with `shreddit-comment`'s attribute names. Live testing captured the real element on
    three profiles: the tag was right, and it shares NOTHING else with a thread comment —
    `comment-id` not `thingid`, `href` (already `?context=3`) not `permalink`, and no
    author, score, created or depth attribute at all, with no `[slot="comment"]` child.
    So every profile rejected and handed back, which is the fail-safe working exactly as
    designed — the capture even shows `data-shd=done` on the elements, i.e. the pipeline
    found and stamped them and then could not read them. Two lessons worth keeping. The
    reporter diagnosed it correctly from that stamp alone ("the failure may not be that
    the element was never found"), which is what the stamp count exists for (bug 50). And the model
    now DERIVES what the element does not carry: author from the route (a profile's
    comments are its owner's by definition), the subreddit from the href — which comes in
    two live shapes, `/r/<sub>/comments/…` and `/user/<name>/comments/…` for a comment on
    a profile POST — and omits the score entirely rather than inventing one. The body is
    the one piece still uncaptured; it is REQUIRED, so a wrong guess there hands back
    instead of rendering empty rows.
66. **A page whose content arrived late was never counted, and the budget became
    unreachable.** Live testing, front page, tab verified visible: rows grew 28 → 203 across
    seven pages while `pages` stayed at **0** and the refusal read `unproductive` on all
    40 samples. Both readings were true. A load measures itself the instant `settle()`
    resolves, and the live feed delivers after that window closes — live testing had already
    recorded the phenomenon ("unproductive loads turning productive in arrears") without
    following it through to what it costs: the 40-page memory guard never advances so it
    can never fire, and `unproductive` never resets so every load past the second refuses
    and `pump()` cannot chain, leaving the whole chain on the 2s heartbeat. Content still
    arrived, which is exactly why two rounds went by without anyone noticing. A load whose
    content shows up late is now credited at the NEXT attempt, when the evidence is
    finally there — which deliberately does not require knowing WHY the window misses,
    since that is still unmeasured. `shdSources` joins the diagnostics, because live testing's
    finding could only be reached by inferring it from row growth.
67. **The profile body cloned Reddit's layout wrapper, not the markdown node.** Live testing
    settled `C.PROFILE_COMMENT_BODY` — `.md` is right, profiles render live (24/24 and
    33/33 on two users) — and measured the trap in the same breath: there are **two nested
    `.md` nodes per comment**, 48 across 24 elements. The outer is a layout wrapper whose
    LAST class is also `md` (`ms-[22px] mt-2xs ps-[10px] md`); the inner is the real
    markdown container. `querySelectorAll` returns document order, so the obvious lookup
    takes the WRAPPER — and its other classes are Reddit's own indent utilities, which
    Reddit's stylesheet still applies to anything Sheddit clones (open question 7). Both nodes
    carry identical text, so the rendered words are correct either way and only the BOX
    gives it away: 22px of inline-start margin and 10px of padding that belong to Reddit's
    layout, not ours. The lookup now prefers the innermost candidate. The fixture carries
    the nested shape, because a single-`.md` fixture cannot tell the two apart — the
    mutation row proved exactly that by surviving until the fixture was fixed.
68. **One unreadable comment handed back a profile that was rendering fine.** Not a field
    report — a risk the report exposed. 0.10.0 handed back on the FIRST reject,
    which was right while the contract was a guess: one unreadable element was evidence
    the guess was wrong. Live testing verified the contract, which flips the odds — a lone
    reject is now far likelier to be an outlier than a broken contract — and live testing also
    watched a history traversal re-consume restored elements MID-HYDRATION (a timestamp
    vanished that way, see the open questions). Under the strict rule, one element that
    had not finished hydrating would tear down a profile that was perfect a second
    earlier. The verdict is now total failure — Reddit sent comments and none of them
    rendered — which still catches every way the contract can be wrong, because those
    reject all of them. Deliberately NOT gated on `revealed`: a profile whose posts arrive
    first and whose comments all reject later must still hand back, or it is the
    silent-omission failure by a slower route.
69. **The suite leaked a live window per section, and the paginator tests went flaky.**
    Not a product bug — a bug in the tests, which is worse in one specific way: the
    symptom is a suite that passes *usually*, and "usually" is indistinguishable from
    "flaky infrastructure" right up until someone starts ignoring red builds. Four
    assertions in the manual-drive paginator sections failed about **1 run in 6**,
    reporting `pages: 0` where 40 was asserted and a refusal of `busy` where the test
    expected a real load. They never once reproduced when those sections were run on
    their own — 120 consecutive clean runs of the page-cap section in isolation.
    The cause was two facts meeting. A jsdom window is not garbage while its timers run,
    and every page this suite boots leaves the paginator's `HEARTBEAT_MS` interval, the
    pipeline's MutationObservers and the gate's deadline running; **nothing ever closed
    them**, so all 63 booted windows were still ticking by the end of a run, and the last
    sections shared an event loop with every section before them. Measured directly: an
    abandoned window fires 3 heartbeat callbacks in the 6 s after it is abandoned, and 0
    once closed. The page-cap section makes it acute — it compresses `setTimeout` delays
    of 400/2000/6000 to 5 ms so 40 loads cost 0.2 s instead of 16 s, and 2000 **is**
    `HEARTBEAT_MS`, so it then abandons a window waking ~200 times a second for the rest
    of the suite. The sections immediately after it are the ones that drive the paginator
    by hand. And `loadNext()` opens with `if (busy) return refuse('busy')` — no manual
    exemption, unlike the cooldown check three lines below it, which bug 18 deliberately
    gave one. So a single stray auto load starves every manual attempt for up to
    `SETTLE_CEILING_MS`, while a 60-attempt guard burns off in milliseconds.
    `boot()` now closes the previous section's window. The two manual-drive sections that
    do not need a heartbeat also opt out of the auto chain with `noAuto`, which is what
    the other six already did and what this file's own convention says they should — the
    page-cap section keeps its heartbeat, because the heartbeat is the thing it is
    testing. **The trap in fixing this**: the obvious repair is to widen the 60-attempt
    guard until the flake goes away, and that would have "worked" — every run green, the
    starvation still there, and the next timing change bringing it back with no record of
    why the number was 60. Note also what could not be asserted: there is no test for
    "this is not flaky", so the regression guard is a direct one — booting the next
    section must close the previous window — plus its own mutation row, because a fix
    that rots back to *passes usually* has nothing else that would say so.

70. **The `N more replies` control under-delivered, and could deliver nothing at all —
    silently.** Live testing's highest-severity finding, reproduced on a 620-comment
    `/r/AmItheAsshole` thread. Six consecutive clicks, counting `.thing.comment` before and
    after each: labels reading 3, 8, 1, 7, 11 and 15 delivered 3, **0**, 1, 5, 4 and 4. Two
    defects wearing one coat. The label is Reddit's own and counts the whole branch subtree,
    while a click delivers a slice of it — but ours then **removed itself four seconds after
    the click, win or lose**, so the number never got a chance to converge and a large
    thread could not be read to the end: the affordance that opens it burned itself out. And
    an earlier click on `9 more replies` added nothing at all — `shreddit-comment` and
    `.thing.comment` both stayed at 40, so nothing was loaded AND nothing was lost in
    translation; the expansion itself no-opped — while our control vanished on its timer
    exactly as though it had worked. That is the project's own rule broken twice: *fails
    loudly, never silently*. The outcome is measured now (branch subtree counted before the
    click, polled after — page-wide would credit the paginator's arrivals to our click), a
    partial expansion keeps the control and re-reads Reddit's label so the count converges
    by clicking, an exhausted branch removes it, and a no-op says `no replies loaded — try
    again` and stays armed. The mechanism was never the problem — `65 more replies` correctly
    took a page 40 → 50 — which is why the fix is entirely in the per-link outcome path.
    **Why no test caught it**: the branch-pager fixture already modelled the surviving
    partial, and the assertion stopped at "the replies arrive". Nothing asserted what
    happened to the control afterwards, and no fixture could deliver nothing until this one
    grew a `deadBranch` partial.

71. **The rank column and a 4+ digit score rendered as one number.** `218586`, `515735`,
    `811693`, `412919` — rank `2` beside score `18586`, and four of them on the first screen
    of `/r/AmItheAsshole` hot. **Both existing guards were checking the wrong thing**:
    css-lint asserted `rank.left + rank.width <= midcol.left` and the geometry suite asserted
    the two boxes do not overlap, and the columns abutted *exactly* — 0..36 and 36..79 — so
    both passed. What collides is the INK, not the boxes: the rank is right-aligned to its
    box edge and a 5-digit score at 13px bold very nearly fills the midcol it is centred in,
    so the glyphs met with half a pixel between them. The rank's box grew by a 6px
    `padding-right` (`box-sizing: content-box`, so the 36px a four-digit rank needs is
    untouched), the midcol moved to 42 and the row padding to 88. Both guards were rewritten
    to measure ink: css-lint derives the score's painted extent from the same font-size the
    width rule uses, and geometry reads the real extents with a `Range` over the text nodes.
    Verified by reverting the CSS: both fail, naming the colliding pairs.

72. **Every comment on a profile said `comment in u/<the profile owner>`.** Thirty out of
    thirty on `/user/spez/`. The parse was right and the input was not: that page served
    every permalink user-scoped
    (`/user/spez/comments/1vgbkge/comment/p1wosm9/?context=3`), so the href's first path
    segment is the profile being viewed rather than the community the comment is in — and no
    reading of it can ever be right there. Live testing had captured the SAME profile serving
    `/r/<sub>/` hrefs one day earlier, so both shapes are real and the user-scoped one is
    ambiguous rather than wrong: a comment on someone's profile POST is legitimately
    `u/<name>`. What separates them is whose profile we are standing on. `/user/<somebody
    else>/` can only be a profile post; `/user/<the owner>/` is the ambiguous case, and there
    the row's own RENDERED community link is the only real evidence on offer — a link Reddit
    drew beats a path Reddit rewrote. With neither, the row prints no parent line at all,
    which is the same rule that keeps it from inventing a score. The parent post's title, the
    other thing live testing found missing against old reddit, is derived the same opportunistic
    way: an anchor pointing at the thread we already know this comment belongs to, excluding
    the comment's own permalink and anything inside the comment body. The fixture now carries
    all four cases, one per comment, and asserts explicitly that `u/tester` never appears on
    `/user/tester/`.

73. **The 72px row invariant was asserted against titles that fit.** The README said rows are
    72 pixels tall in every theme and that "the geometry suite pins them there"; the suite
    measured left offsets, widths, overlaps and overflow, and never once read a row's height.
    Live testing measured the live front page: 26×72 + 1×77 + 1×117 in classic, 22×72 + 4×74 +
    1×75 + 1×113 in carbon — whose monospace face is wider, so titles that fit elsewhere wrap
    there. On `/r/todayilearned` almost no row was 72px. Every title in `POSTS` fits on one or
    two lines, which is exactly why it looked fine. The invariant is now stated as what it
    really is and tested as such: 72px is a FLOOR (the thumbnail's margin box) that holds in
    every theme, a one-line title gives exactly 72px in every theme, and a title too long
    GROWS the row rather than being cut short — a deliberate choice over truncation, on the
    same grounds as everything else here: a title is the whole content of a listing row and
    this extension does not hide what it cannot fit. `t3_longtitle1` wraps to three lines in
    all five themes (classic 102px, slate 97, sepia 107, night 97, carbon 115) and carries an
    unbreakable 62-character token, which is the separate hazard a wrapping algorithm cannot
    help with; the suite checks the floor, the one-line case, no horizontal overflow, no text
    escaping its box and the thumbnail float staying contained, at three widths × five themes.
    The README's density claim was corrected rather than defended.

74. **The pagination sentinel flapped `loading more…` → `load more` → `loading more…`.**
    Live testing watched it on `/r/aww`, and content loaded correctly each time — which is why it
    read as a repaint rather than a fault. It was: `attach()` runs after every pipeline flush
    so the sentinel stays at the bottom of a list that is still growing, and it builds a NEW
    node whose label starts at the idle `load more`. A load in flight is precisely when new
    content arrives, so every flush during a load repainted the idle label over the live one.
    The status belongs to the load, not to the node displaying it, so it is module state that
    survives a re-attach and is cleared on route change. Same family as bugs 62 and 63: the
    sentinel telling the truth about what it is doing.

75. **A test proved the visibility re-arm by watching something else rescue the page.**
    Not a shipped bug — a hole in the suite, found by `test/mutate.sh` while verifying the
    round-12 rows, and surviving quietly since bug 36's escape hatch was added. Deleting
    `pipeline.js`'s `visibilitychange` listener outright left every assertion in its own
    test green. Two mechanisms can render that page and the test was reading the one
    observable both produce: the listener re-books a flush parked on a rAF that a hidden
    tab will never run, and — 1200ms later — the gate's first check finds nothing stamped
    and calls `SHD.pipeline.kick()` to drain the queue synchronously before it will accuse
    anyone (bug 36). `boot()` waits 4000ms, so it never noticed which one had acted. WHEN
    is therefore the whole assertion: the flip is at 250ms and the re-arm's flush is
    immediate, so a row inside 1000ms can only be the re-arm, and a row that waited for the
    deadline cannot beat 1500ms. Sampled from a poller started before the bundle evaluates,
    because by the time `boot()` returns the two paths are indistinguishable. Verified both
    ways: mutated, it now reports `first row at 1554ms`; unmutated, three consecutive runs
    under load. **The general shape, and it is the same one as bugs 71 and 73**: when two
    mechanisms produce one observable, asserting the observable proves nothing about
    either. A defence with a fallback behind it needs a test that can tell them apart.

76. **Four more rows the mutation sweep found nothing behind — same shape as 75.** The
    round-12 sweep ran 144 rows and five survived. Bug 75 above was one; these are the rest,
    and every one had a plausible-looking assertion sitting next to it.
    **(a)** `sections leak live windows again` and **(b)** `the hovercard section's manual
    drive races the auto chain` were guarded only by the flake they restore — both restore
    intermittent bugs, so a green run clears nothing and a SURVIVED row means nothing
    either. Bug 69's entry claimed "the regression guard is a direct one — booting the next
    section must close the previous window"; no such assertion existed. Both are facts, not
    flakes, and are asserted as facts now: the abandoned window's timers must stop (jsdom
    implements no `window.closed`, so the timers ARE the observable — 36 ticks in 200ms
    when mutated, zero when not), and the hovercard section must have `autoPaginate ===
    false` in force before it drives anything by hand.
    **(c)** `the expansion measures the whole page instead of its own branch` (bug 70's
    scoping) survived because nothing else on the fixture page ever grew, so a branch-scoped
    count and a page-wide one could not be told apart. The dead-branch section now injects
    an unrelated top-level comment while the expansion is in flight — the paginator does
    exactly this on a live thread — and a page-wide measure then reports the click as having
    succeeded when the branch gained nothing. The lie told by the measuring instrument
    instead of the control.
    **(d)** `the sentinel forgets an in-flight load on every re-attach` (bug 74) had no test
    at all for the label surviving a rebuild. There is now one that drives a load, lets a
    post arrive mid-flight, and checks the label on the node the flush rebuilt — asserting
    node IDENTITY changed first, so a fix that simply stopped re-attaching cannot pass it.
    **(e)** `the chain starts only if the observer speaks first` — found by the RE-RUN,
    because it is one of the twenty-two rows the first sweep never executed (see below), so
    this was its first real evaluation. `pump('attach')` exists so pagination starts the
    moment the sentinel is hung, rather than waiting for a wake-up that live testing measured
    never arriving. Delete it and AN OBSERVER THAT NEVER REPORTS AT ALL stays green: the
    HEARTBEAT starts the chain instead, two seconds later, and three loads still land inside
    the section's 4000ms window. Two wake-ups, one observable. WHEN is the assertion now —
    attach() pumps on a zero-delay timer (the cooldown is measured from `lastAt`, still 0 on
    the first pump), so the first load lands as the sentinel appears; without it nothing can
    fire before the first 2000ms tick. Mutated, the gap measures 2007ms, which is
    HEARTBEAT_MS to the millisecond.
    **The pattern across all six, and it is worth more than any of them individually**: a
    test that watches an outcome two mechanisms can produce is not testing either one, and a
    mutation row that restores an intermittent bug is not a regression guard. Both look like
    coverage. Neither is.

    **And the sweep that found them was itself incomplete, which nothing reported.** It
    printed 122 results for 144 rows and exited 0: twenty-two consecutive rows never ran.
    The cause was editing `test/mutate.sh` while it was running — the sweep takes hours and
    its comments were updated partway through — and bash reads a script incrementally by
    byte offset, so the rewrite resumed it mid-token and the mangled token swallowed the
    rows that followed. (`$SRC/test/*.js` are copied to `$WORK` at the start and are safe to
    edit mid-run; this one file is not.) A note would not have been enough, because the
    failure PRESENTS AS A CLEAN RUN — the only signal was one garbled error line in the
    middle of two hundred lines of green, citing a line number that did not match the text
    quoted beside it. The script counts its rows now and exits non-zero if it cannot account
    for every one, whatever stopped it. The re-run with the guard in place: **144 declared,
    144 run, 143 caught, 1 survived** — that one being (e) above, on rows nothing had ever
    executed.
77. **The rendition rank tied, and the tie handed the codec choice to Reddit.** Reported
    from the field 2026-08-22, found while chasing an unrelated 403. `mp4Of()` ranked a
    video post's renditions by the largest number in the FILENAME — the fix for an earlier
    bug, where ranking on `DASH_<n>` scored every live URL zero and picked the lowest
    quality. But Reddit offers the top rendition twice, as vp9 and as h264, and
    `m2-vp9-res_462p.mp4` and `m2-res_462p.mp4` score identically under that scan. With a
    stable sort the winner is whichever Reddit listed first, which is always vp9: measured
    live as four of six video posts on one subreddit resolving to a vp9 file that nobody
    chose. Nothing looked wrong — both files play, and the link worked — which is why it
    survived two rounds of video testing that were watching whether the URL resolved at
    all. The JSON states the height the filename scan is recovering
    (`dimensions: { height: 462, width: 854 }`) and the deep scan discarded it; it is read
    now, with the filename kept as the fallback for renditions that state nothing, and the
    remaining tie breaks toward the h264 name because the link is a top-level navigation
    into the browser's own media viewer. **The fixture is half the fix**: one rendition per
    height cannot distinguish a decision from an array-order accident, so it now carries
    the captured pair at equal height, vp9 first, as Reddit sends it. Two mutation rows —
    ignoring the stated height, and dropping the codec tie-break — because either alone
    hides the other, and two older rows needed their anchors repaired for the rewrite.

78. **The chain filled pages nobody had asked for, and the tab froze while it did.**
    Reported twice, independently, on the same build: opening a comments page locked the
    tab for 30+ seconds before recovering, and clicking a `[-]` collapse on a thread did
    the same, two times out of two. A history traversal did it once. Both reports reached
    for the same explanation — an expensive re-render on every state change — and it is
    worth recording that the explanation is wrong, because the evidence against it is what
    located the real cause. The collapse handler is three operations
    (`preventDefault`, a class toggle, a `textContent` write); the pipeline's
    MutationObserver watches `childList` and acts only on ELEMENT nodes, so the text write
    cannot reach the render queue at all; and the `.collapsed` rule is three scoped
    `display:none` declarations. Nothing re-renders. What the collapse changes is the
    **height of the page**, and height is what the paginator triggers on.
    Three facts combined into a burst. `attach()` re-arms after every flush, so each
    intermediate render re-pumps; `TRIGGER_PX` is 1200, so "in range" stays true until
    roughly two viewports of content sit below the fold; and a load whose content arrives
    after `settle()` closes is credited in arrears rather than counted, so `MAX_PAGES`
    never bounds the churn. On a freshly opened thread the sentinel is in range at first
    paint — before the reader has done anything — and the chain runs until it exhausts or
    caps. A collapse restarts it by shrinking the document; a traversal does the same,
    because `onRoute()` rebuilds into a briefly-empty page. That the second report saw the
    freeze **with no click at all** is what ruled the collapse out as the cause rather than
    a trigger.
    The freeze itself is a second-order cost, and it is why this presented as a frozen tab
    with torn, tiled repaints rather than as something merely slow: `inRange()` forced a
    synchronous layout, `diag()` forced two more, both ran on every pump and every 2s tick,
    and all of it interleaved with renders that invalidate layout again. The work was not
    the loading, it was measuring between every step of it. `measure()` now does one read
    per frame, shared.
    The fill is not the mistake and could not simply be gated on scrolling: a listing ships
    THREE posts, which is the dead end the paginator exists to fix, and three rows do not
    make a scrollable page — there is no gesture to wait for. What was missing was a
    stopping point. `FILL_VIEWPORTS` is that point, with `UNPROMPTED_MAX` bounding it by
    attempts as well as height, because loads that deliver nothing never grow the page and
    would otherwise spin against the height test for ever. Past either limit the sentinel
    reads `load more` and waits — clickable, honest, and not `exhausted`'s label, which
    belongs to a feed with nothing left. Scrolling or clicking releases both, per page.
    **The two halves need separate mutation rows and separate suites**: jsdom does no
    layout and reports `scrollHeight` 0, so the height bound is invisible there and only
    `geometry` can see it, while the attempt bound is the only half `run` can exercise. The
    measurement cache gets no row at all, deliberately — it is a cost change with no
    behavioural consequence, so a row for it would survive and read as a hole.

79. **An image post never showed its image.** Reported twice in one round: an image post's
    comments page rendered a title, a 70px thumbnail and nothing else, and clicking that
    thumbnail left the layout entirely for Reddit's own `/media` viewer — a page this
    extension does not render. One gap with two faces, and it is the third instance of the
    same root cause: **post CONTENT is not an attribute.** Bug 49 found it for a text
    post's body, 0.16.0 found it for a video's rendition, and images were the member of
    that set that had no handling at all — `consumePost()` built the row, then a player,
    then the selftext, and there was simply no branch for a picture.
    The picture is resolved the way the body is: out of the light DOM, scoped with
    `closest(POST) === el` so a crosspost cannot lend us its parent's image (bug 25's
    lesson, applied before a reshuffle rather than after one), through the same host
    allowlist the thumbnail uses, because a loose match turns every community icon and
    flair emoji into a picture (bug 1). Where an `<img>` offers a responsive set, the `w`
    descriptors are ranked and the widest wins — the fixture lists 320, **1080**, 640 in
    that order precisely so that taking the first or the last is a visible failure rather
    than a coin flip that happens to land right, which is the trap the video rendition rank
    fell into twice.
    The link is substituted **narrowly**: only when the post is an image, a picture
    resolved, AND `content-href` points back into reddit.com. A content-href that is
    already a direct file is left exactly as it was, and every miss falls back to what
    shipped before — so a wrong guess costs the picture and never the post.
    On listing rows the answer is old reddit's expando, and it is lazy on purpose: a
    listing is dozens of rows, and building every `<img>` at render time fetches every
    full-size picture on the page for rows nobody opened. **Two properties, two rows**, and
    the second only exists because a mutation survived: nothing counted the images, so
    appending on every toggle instead of on first open left a stack of identical pictures
    that showed up only as a row growing each time it was reopened.
    **The adult-content gate is duplicated deliberately.** Both new surfaces draw a picture
    and both ask `showNsfwThumbnails`, because rendering our own `<img>` is exactly what
    walks past the blur Reddit applies for logged-out readers (bug 41) and a full-size
    inline copy is that same bypass, enlarged. The two call sites get **separate** mutation
    rows: they cover different pages, so removing one would leave the other looking covered.
    Two things this could not settle from a fixture, and why `verify:live` gained an IMAGE
    POSTS section: the `/media` content-href is inferred from what clicking did rather than
    from a capture, and nobody has recorded where a live comments page keeps the full-size
    file. Both are reported by that section rather than asserted here.
    A testing note worth keeping: the geometry suite aborts subresources to stay offline,
    which leaves an `<img>` with no intrinsic size — so every "does the picture fit inside
    the row" assertion would have passed on a 0×0 box. That is a vacuous green reading as
    coverage of exactly the overflow the section exists to catch. It generates a real PNG
    in-process instead, still offline, and the row-growth assertion is what proves the
    image is actually there.

## The popup policy — supersedes bugs 30, 33 and 38

*Project decision, 2026-08-20.*

**The extension never leaves its layout for a Reddit popup.** Age gates, NSFW
interstitials, cookie/privacy prompts, login upsells: all stay hidden under the extension's render
(suppress.css already hides the body children they live in), and the `rpl-scroll-lock`
they set is stripped — plus an `overflow: visible !important` backstop in old-reddit.css
for the inline-style form of the lock. The defer machinery those three bugs built and
patched is deleted.

Why it is safe: the 18+ gate does not replace the feed, it covers it — the posts are in
the DOM the whole time (verified live 2026-08-18). Unknown modal DOM is hidden rather
than deleted (only the enumerated login upsell is removed, because left in place it
re-raises its lock), and everything is gated on `engaged`, so unhandled routes keep their
modals and their locks untouched (bug 37 holds).

**The 18+ gate — alone among modals — is ANSWERED** (a deliberate project decision, the
maintainer having attested their age in so many words): `answerAgeGate()` clicks Reddit's own affirmative
button, invisibly, under a layout that never moves. Clicking beats hiding — Reddit clears
its own lock, remembers the answer, and pagination serves an attested session. The wrong
button NAVIGATES AWAY, so the click fires only when exactly one button matches
affirm-and-not-decline (`C.AGE_GATE` — the trap is a decline whose text contains "18");
any ambiguity falls back to plain suppression, and only *that* residual path still
carries the unanswered-pagination question below.


---

## Settled questions

### The staircase report does not reproduce

Measured directly: 7 rows × 10 viewport widths from 360–1920px, every
`#siteTable > .thing.link` reports an **identical** `left`, with zero horizontal overflow;
comment indentation is a uniform 25px per depth (31px until it was measured against
old.reddit — see old-reddit.md). This is now a standing assertion
("every row shares one left offset, at every width"), so a regression fails the build
rather than becoming folklore again.

If a stepped edge is reported again, suspect the **right** edge, not the left: bug 6
above squeezed rows beside the sidebar by 18px, which is exactly the kind of ragged wrap
that reads as stepping. That is fixed and asserted ("every row shares one width").


---

## Open questions

Recorded so that nobody spends an afternoon rediscovering that they are still open.
Several were closed by a live run and are struck through; the reasoning is kept because
the way a question got settled is usually more useful than the answer.

1. ~~**Whether the top-level `loading="lazy"` partial answers `loadContent()` logged
   out.**~~ **Answered 2026-08-20, live: YES.** Five pages drove 25 → 115
   top-level comments with no bridge refusal, correct multi-level nesting, on a
   logged-out session. Two things came out of the same run and are open below: the
   busy-wedge at page 5 (bug 57 instruments it — live testing read `shdBusyFor` live: wedges
   of 8.6s and 9.2s that SELF-CLEARED under the 12s limit, so the backstop is correctly
   calibrated — do not lower it), and the fact that NO event wake-up fires in the test
   environment (bug 56; the heartbeat is the answer, and `packaged-media-json` (bug 58)
   was confirmed live in live testing — see that entry).

2. ~~**Whether Reddit's real 18+ interstitial carries a `shreddit-feed`.**~~ **Answered
   2026-08-14, live:** it carries one *and* the posts. The gate is a modal on top, so neither
   `gated` nor `gatedFeed` described it and bug 29 was never live on an 18+ sub — but bug 30
   was. See the `gateModal` fixture. What is still unseen is whether **quarantined** and
   **rate-limited** pages use the same modal pattern or genuinely replace the feed.
3. **Whether a logged-in session exposes the vote control.** Logged out it is confirmed
   unreachable (21 open shadow roots searched, nothing). Out of scope, but `deepQuery` is
   kept for it.
4. **`gate.js`'s deadline against a genuinely slow real page** — only synthetic stalls have
   been tested.
5. **Real quarantine / rate-limit pages** have never been seen by the suite. `gated` and
   `gatedFeed` are hand-written stand-ins; `npm run capture:live -- --path=…` exists to
   replace guesses with recorded shapes.
6. **Whether pagination works behind an UNANSWERABLE 18+ gate.** The gate is normally
   answered outright (`answerAgeGate()`), which makes the session attested and moots the
   question — but the click deliberately refuses ambiguous button sets (a localized gate,
   an A/B copy change), and on that fail-safe path the sub renders its delivered slice
   with the gate merely suppressed. Whether the partial endpoint serves more pages to an
   unattested session has never been observed; the load-more button is the graceful
   floor. Also unverified live: that the real gate's button text matches `C.AGE_GATE`'s
   affirm/decline split at all — the fixture encodes the captured English copy, and a
   real-machine run on a real NSFW sub is what confirms the click actually lands.
   **Live testing (2026-08-20) observed but could not settle it**: on r/CombatFootage in a
   profile of unknown freshness, no gate was ever in the DOM, the sub served exactly 3
   posts — none carrying `nsfw`, with benign thumbnails — and pagination returned
   nothing (six scrolls plus a real loadContent() click; native count froze at 3 while
   the front page and r/pics grew 3→28 in the same session). That reads as Reddit
   serving a TEASER variant of the gated sub rather than the gated feed itself, which
   would mean the content-behind-the-modal fact does not extend to every delivery path.
   A fresh profile, watched by a human, is still the experiment.
7. **How much of Reddit's own stylesheet lands on Sheddit's comment bodies.** Sheddit clones
   Reddit's rendered body node (`[slot="comment"]`) into `div.usertext-body` rather than re-parsing
   markdown — which keeps links, code blocks and blockquotes intact, and is the right call —
   but the clone stays in the same document, carrying Reddit's classes, so **Reddit's page
   CSS still matches it**. Evidence, not theory: a computed-style probe read
   `border-radius: 8px` on a comment body, and that value appears nowhere in
   `src/styles/`. **Narrowed 2026-08-18**: the cloned node carries
   `class="md text-14-scalable rounded-2 pb-2xs overflow-hidden"` — Reddit's *utility*
   classes. `rounded-2` is that 8px radius and `pb-2xs` is the 4px padding-bottom the same
   probe measured. So this is not unbounded cascade leakage; it is five named classes, four
   of which are self-describing presentation utilities that are not wanted, plus `md`, the
   semantic markdown class that may carry the list/table/code styling Sheddit deliberately relies on
   Reddit to provide. What `md` actually does is still unknown, because Reddit serves its CSS
   from `redditstatic.com` and the sheet is **cross-origin — `sheet.cssRules` throws, so no
   in-page probe can enumerate it**; fetching the stylesheet URL directly is the way in.
   Cosmetic today. The point is the exposure — comment bodies are the one
   part of Sheddit's layout Reddit can restyle from underneath it without touching its DOM
   contract, so a Reddit change could alter comment typography with every test still green.
   **No fixture can catch this**, and that is the whole difficulty: the
   fixtures ship the markup but not Reddit's stylesheet, so this is invisible to the suite
   by construction. Deliberately **not** fixed blind — stripping classes off the clone or
   resetting properties on it are both one-liners, and both could remove styling that Sheddit
   relies on Reddit to provide (list markers, tables, spoilers). Needs a real machine: on a live
   comments page, diff `getComputedStyle` of a body node inside `#shd-root` against the same
   node's expected values with Reddit's sheets disabled, and record which properties Reddit
   is actually setting. Then fix the ones that matter, in `old-reddit.css`, with Sheddit's own
   specificity.

8. ~~**What element a profile page's comments arrive in, and where it keeps its text.**~~
   **Both answered live: the element in live testing** (`shreddit-profile-comment`, read with
   `comment-id` and `href`; bug 65) **and the body in live testing** — `.md` is right and
   profiles render on real users, 24/24 and 33/33. See bug 67 for the trap that came with
   it. THREE smaller profile unknowns replace it, all observed once and none diagnosed:
   **(a)** a timestamp vanished from a row after a history traversal — restored elements
   are re-consumed mid-hydration and `created` is read once, at consume time, from a
   `<time>` that may not be there yet. Cosmetic (the field is optional), but it is the
   visible edge of a general question: what ELSE is not ready on a restored element. Bug
   68 removed the sharp end of that. **(b)** the rendered row count ran AHEAD of the published
   source count on a paginating profile (108 rows against 100 sources, gap widening per
   page). Three candidate causes and only one is ours — duplicate rows, which the suite
   now asserts against; Reddit removing consumed elements; or `shdSources` simply being a
   heartbeat stale against a live row count. Undecided, and the discriminator is whether
   the rendered ids are unique on a live page. **(c)** `?context=3` renders the whole
   delivered thread rather than old reddit's target-plus-ancestors slice. The link lands
   correctly and the target renders first, so this is a fidelity gap, not a break, and no
   filtering is attempted. Historical, kept because it is why the contract was wrong for
   a day: an earlier
   capture counted 31 "profile-comment elements" on a real profile without recording
   the tag. The pipeline queries both `shreddit-comment` (the verified thread element)
   and `shreddit-profile-comment` (the candidate — a guess), reads whichever matches with `COMMENT_ATTR` names (also unverified for the candidate tag). A wrong guess costs the
   FEATURE, never a broken page, and that holds through both doors it can come in:
   attributes that cannot be read (a reject) and a tag that was never queried (a comment-shaped
   custom element in the feed that Sheddit neither reads nor contains). Both hand back.
   Residual, and it is real: a profile comment element whose tag does not contain
   "comment" is invisible to the second check and would still render posts-only. `verify:live`'s USER PROFILES section is the settle: it visits a profile,
   reports which tag matched, and when neither does it names the dominant comment-ish
   custom element and dumps its attribute list — that output IS the new contract. An
   equivalent DevTools probe does the same from a browser. Also unobserved: whether the profile feed is a `shreddit-feed` (the paginator
   assumes so; if not, profile pagination reports "no more pages" — the honest floor,
   not a hang), and everything about profile-POST threads, which stay OTHER.

9. **Whether the mp4 link can stay the video strategy at all.** Three reports on
   2026-08-22 point the same way. One asset's packaged renditions **all 403** — eight of
   eight, 4.5 hours of signature validity left — while three other assets fetched minutes
   apart returned 200, so this is asset-level and nothing in `packaged-media-json`
   distinguishes a live rendition from a dead one. A second post carried no
   `packaged-media-json` at all: its player had `src=…/HLSPlaylist.m3u8` and
   `preview=CMAF_96.mp4`, its legacy `DASH_<res>.mp4` files 403 while `CMAF_*` and the
   playlist returned 206. Read together: Reddit is moving to CMAF/HLS and the packaged
   mp4s are going away one asset at a time. That also re-reads the "holdout" recorded in
   rounds 9 and 10 — a player with a `src` and no JSON was never an anomaly, it was the
   new shape arriving early.
   Three things are already known, so nobody re-derives them: `content-href`
   (`v.redd.it/<id>`) still 302s a logged-out session back to the comments page, which is
   the loop the mp4 exists to escape; HLS is not a link target, because Chrome desktop
   cannot play an `.m3u8` as a top-level navigation (`canPlayType` says `maybe` and
   `readyState` stays 0); and **verifying a URL before handing it over is not available to
   us** — a `HEAD` or ranged fetch is a network call of our own, and there are none.
   A fourth thing was believed and is **wrong**, corrected 2026-08-22 by report 4 and left
   here rather than deleted, because it was load-bearing in ruling (c) in: the `CMAF_*`
   files are NOT segments that fail to play standalone. The MPD is `isoff-on-demand` with
   `SegmentBase`/`indexRange`, so each rendition is one self-contained fragmented mp4 with
   `moov` at the front, and Chrome plays it as a top-level navigation. What it lacks is
   audio, which lives in a separate `CMAF_AUDIO_*.mp4` — so that path is a SILENT video,
   a product decision rather than a technical impossibility. It still does not yield a
   fix, for a different reason: the rendition heights vary per asset (the measured one
   tops out at 480 and has no 720 or 1080), so a constructed `CMAF_720.mp4` repeats the
   `DASH_720.mp4` mistake, and learning the real names means reading the MPD or the HLS
   manifest — a network call of our own.
   So the question is what a video post's title should do, and it was an project decision
   with three candidates. **(b) shipped in 0.14.0; (c) is what remains open.** **(a)** Leave it: the title upgrades to an mp4 when there is a
   live one and falls back to the loop when there is not. **(b)** Point the title at the
   comments permalink and expose the mp4 as a separate affordance beside it, the way old
   reddit separated the outbound link from `comments` — a dead rendition then costs one
   optional click instead of the whole post, and the redirect loop dissolves. **(c)**
   Render the video in the layout: the native `<shreddit-player>` is live and merely
   hidden, and `dom.passthrough()` already reveals a native node in place for the reply
   composer, so an expando could hand the reader Reddit's own player with no network call
   and no clone. (c) is the only one that makes the mp4 workaround optional rather than
   load-bearing, and it is the only one that has never been observed working — the player
   node's behaviour under passthrough has never been captured, and one of the three
   reports saw no player element on the page at all. **Report 4 (2026-08-22) settles the
   second half only**: it observed `<shreddit-player>` present and populated with a live
   `src` on the page with the extension installed, so presence is no longer in doubt.
   Aliveness still is, and that is the half the fix rests on.
   **RESOLVED 2026-08-22 by (d), shipped in 0.16.0 — an option nobody had listed, because
   the constraint that hid it was ours.** Every candidate above was drawn up under "the
   extension makes no network requests", so the whole search space was shapes that spend no
   request: link somewhere better (a, b), or reveal Reddit's own player (c). The owner
   relaxed that to **no API calls** — which is what the promise was always protecting, since
   reading a static media manifest from a CDN is not an API call by any reading — and the
   answer fell out immediately. `DASHPlaylist.mpd` is ~3 KB, states every rendition WITH its
   width and height, answers for legacy and CMAF assets alike, and needs no host permission
   (`access-control-allow-origin: *`). The comments page now renders a real `<video>`; see
   media.js, and PRIVACY.md for the one request and the setting that disables it.
   Two things worth keeping from how long this took. **The self-imposed constraint was
   never re-examined**, so repeated triage optimised inside a box that could simply
   have been opened — worth asking, of any "we cannot do X", whether the rule forbidding it
   is a real requirement or a habit. And **a false fact sat in this entry doing damage**:
   "the `CMAF_*` files are fragmented segments that do not play standalone" was believed,
   was wrong (they are self-contained on-demand fMP4s), and was load-bearing in ruling (c)
   in — corrected above the same day.
   (c) is NOT closed by this and stays open on its own merits — but **not** as the route to
   audio, which was how it was framed for a day. 0.17.0 delivers sound without it: the
   manifest names the separate audio track too, and an `<audio>` paired to the `<video>`
   plays them together (media.pair, proven in test/media-sync.js). MediaSource would be the
   textbook way and was rejected on evidence rather than taste — this project's Chromium is
   the open-source build with no H.264 and no AAC, and Chrome's WebM byte stream takes only
   one SourceBuffer, so nothing here can exercise two-buffer MSE and it would have shipped
   untested. What (c) would still buy is Reddit's own player, with its own adaptive
   switching and its own seek behaviour; that is a real thing to want and no longer urgent.
   **Taken 2026-08-22: (b), shipped in 0.14.0.** The title is the permalink, `watch` carries the
   rendition and re-resolves at click time, and with nothing to resolve it degrades to the
   comments page rather than the bounce — on listing rows only, never on the comments page
   itself. What stays open is (c), and it needs exactly one capture, which live testing's P3
   now asks for: on a video post's comments page, is the native player element defined,
   does it hold a `<video>` or a shadow root, and does it survive being revealed in place?
   If it does, that page gets Reddit's own player behind an expando and the mp4 stops
   being load-bearing anywhere. If it does not, (b) is the end state and the `watch` link
   is the whole answer.

Two settled things, so nobody reopens them: the **staircase indentation report does not
reproduce** (measured at 10 widths), and **comments being DOM-nested was a non-event**
(`depth` agreed 25/25) — though it did expose the body-lookup bug, number 25 above.
