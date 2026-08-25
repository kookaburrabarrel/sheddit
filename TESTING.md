# Testing

```bash
npm install
npm test        # everything, ~175s
```

Six ways to exercise this, cheapest first. The first five are automated; `npm test`
runs all of them. (Assertion counts move with every release — trust `npm test`'s own
summary over this table when they disagree, and update the table when they do.)

| # | Command | Needs | Assertions |
|---|---|---|---|
| 1 | `node test/css-lint.js` | nothing | 38 |
| 2 | `node test/run.js` | jsdom | 486 |
| 3 | `node test/geometry.js` | Chromium | 184 |
| 4 | `node test/extension.js` | Chromium | 130 |
| 5 | `node test/media-sync.js` | Chromium | 8 |
| 6 | `npm run verify:live` | real network | manual |

`npm run test:fast` is 1+2 only (no browser) for a tight edit loop.

---

## 1. Static CSS lint (no browser, no DOM)

Encodes the layout failure modes this project has hit as assertions over the stylesheet: every
floated selector must be registered in `FLOAT_CONTAINERS` against a container that
establishes a BFC, the score column must fit five digits, the absolute columns must not
overlap, every `display: flex` declares `flex-wrap`. **Add a float, register it** — an
unregistered float fails the lint.

It also checks the themes against each other, because nothing else can: that every id in
`themes.js` has a palette in `themes.css` and vice versa, that every non-classic theme
declares **every** colour token (a missing one silently inherits classic's light value —
blue links on a dark page), that no theme touches the sidebar arithmetic, and that
`themes.css` contains no layout declarations at all. All of it is invisible to jsdom, and
geometry only ever lays out one theme at a time.

The `flex-wrap` rule exists because geometry (suite 3, below) could not reliably catch the
bug it guards against: a flex row with no `flex-wrap` only overflows once its content is
wider than the viewport, and whether it is depends on which font is actually installed.
`old-reddit.css` asks for Verdana; this repo's CI container does not have it, so the
narrower fallback fit where the real font did not, and the failure only showed up on a
machine that had Verdana. A static rule does not care what fonts are present. Simulating a
wider font in geometry (`font-size`/`letter-spacing` scaling) was tried and abandoned —
non-monotonic, because a flex item's own text can wrap and let the item shrink instead of
the row growing; see the note in `test/geometry.js`.

## 2. Automated suite in jsdom

Runs the **real shipped bundle** against fixture pages inside jsdom and asserts on the
output:

| Group | Covers |
|---|---|
| Listing page | row count, mount point, ranks, ad exclusion, thumbnail resolution, link targets, score/tagline, pagination sentinel, vote-click safety |
| Comments page | node count, **DOM nesting matches every `depth` attribute**, top-level counts, body transfer, collapse toggle |
| Idempotency | re-running the bundle must not duplicate rows or roots |
| SPA route changes | chrome rebuilt on navigation, no duplicate roots, unhandled routes fully released |
| Failure screen | explanation shown instead of a silent revert, native Reddit stays hidden, escape hatch works, Sheddit's DOM removed, pipeline stopped, in-flight flush suppressed, native handoff unwound |
| Slow pages | a page that streams in late still renders; only *delivered-but-unrenderable* content is treated as a failure |
| Main-world bridge | the protocol literals in bridge.js match contracts.js, the manifest registers it, nothing else calls page-defined JS |
| Pagination | loads go through the bridge, cooldown backs off automatic triggers but not clicks, no duplicate rows, running out of pages is reported |
| Comment pagination | a truncated thread pages out, late batches nest against the carried-over depth stack, a complete thread does not sprout a dead "load more" |
| Nested comments | the live 2026-08-14 shape, in BOTH body orderings: every comment shows its own body rather than a descendant's, and the tree still matches every `depth` |
| Live settings | a toggle takes effect without a reload, a partial write does not tear the page down, unrelated storage changes are ignored |
| Pages with nothing to render | an age gate is not blanked and not blamed, late content still renders, an empty *feed* is not written off the same way |
| Reddit's own modals | while `body.rpl-scroll-lock` is set Sheddit stands aside — native Reddit and its dialog visible, its button actually clickable, Sheddit's own render hidden rather than left unstyled — and dismissing it hands the page back |
| Logged-out scope | nothing Sheddit renders requires a session |
| Options page | every shipped setting has a **control** and vice versa (`theme` is a `<select>`, not a checkbox), its DEFAULTS match contracts.js, its theme list matches themes.js, a change writes the whole object in the shape the content script listens for |
| Themes | one button per registered theme, a click repaints **without re-rendering** (same `#shd-root`, same row nodes), the choice persists, an unknown id falls back to classic, a theme-only storage change skips the teardown while a bundled one does not |
| Pre-commit navigation | a faked Navigation API with deferred commit — a sort change emits once, for the destination, before the commit; four clicks produce no phase error; the pre-commit window renders nothing and the swap renders only the incoming sort |
| Hidden tabs | rAF stubbed dead the way a hidden Chrome tab really is — the page still renders on the timeout path, and a flush parked across a visibility flip is re-booked |
| Slow pipeline boot | chrome.storage held open — the deadline says `not-started` instead of `render-failed`, and a profile page full of posts is never accused |
| Defer state | a defer active during a failure does not stick; a route change never re-blanks over a live modal (readyState pinned mid-load — on a complete document the same call un-blanks itself and the assertion would be vacuous); standDown forgets the defer |
| Stood-down routes | the upsell surgery does not touch routes Sheddit handed back |
| Late shreddit-app | the insertion observer follows the app element when it arrives late, instead of latching onto body |
| Route/tab consistency | **every href the chrome renders must classify as `LISTING`** |
| Vote delegation | pierces an open shadow root; returns null (not a throw) on a closed one |
| Native passthrough | the un-clipped ancestor is the body child, siblings hidden, cleanly reversible |

Nothing is mocked except `IntersectionObserver` and `chrome.storage`, neither of which
jsdom provides.

## 3. Real layout geometry (headless Chromium)

**This is the suite that closes jsdom's structural blind spot.** jsdom does no layout, so
suite 2 can prove the DOM is perfect while the page renders wrong — that happened. Suite 1
helps, but reads one declaration at a time and cannot see what two individually-correct
rules do to each other once boxes exist.

`test/geometry.js` loads the bundle in headless Chromium and reads
`getBoundingClientRect()`: row alignment across ten viewport widths, column overlap,
score wrapping, float containment, comment indent uniformity, the `[–]`/vote-arrow
collision under a real `:hover`, and the native passthrough proven visible via
`checkVisibility()` plus a hit test.

It also lays out **every theme** at 360px and 1280px — the themes really do change the
font stack (serif, monospace), which is the closest this machine can get to the wider-font
overflow that shipped as bug 31 — and asserts that switching theme repaints without moving
a single row.

It found two shipped bugs on its first run — the 18px sidebar gutter shortfall and the
comment toggle collision — and it settled the staircase-indentation report that
ARCHITECTURE could not reproduce (identical left offsets at every width).

**Two things it now measures that it used to only look near.** Live testing found both live
with the suite green, and both are the same mistake: a check that measured a proxy.

- **Ink, not boxes.** `rank never overlaps midcol` compared the two columns' boxes, which
  abutted *exactly* and so passed — while a live front page rendered rank `2` beside score
  `18586` as `218586`. The rank is right-aligned to its box edge and a 5-digit score nearly
  fills the midcol it is centred in, so the glyphs met. The check now reads painted extents
  with a `Range` over the text nodes, and `css-lint` derives the score's width from its own
  font-size rather than trusting the column's.
- **Row height, at all.** The README claimed 72px rows "pinned by the geometry suite"; the
  suite had never read a row's height. Every fixture title fitted on one or two lines, so
  the claim was proved against the easy case. `t3_longtitle1` wraps to three lines in all
  five themes and carries an unbreakable 62-character token, and the suite now asserts the
  real invariant — 72px is a floor, a one-line title gives exactly 72px, a longer one grows
  the row rather than being cut short, and nothing overflows while it does — at three widths
  across every theme.

## 4. The packed extension, end to end (headless Chromium)

`test/extension.js` loads this directory as a **real unpacked extension**. Content scripts
only run on `*://*.reddit.com/*`, so it serves the fixtures on loopback and uses Chrome's
`--host-resolver-rules` to map the hostname onto them — a real reddit.com origin with no
network access.

This is the only suite that exercises the manifest itself: match patterns, the
`document_start`/`document_idle` split, script order, and delivery of all three
stylesheets. It is also the only place a theme can be proven to work: `themes.css` is
delivered at `document_start` and `old-reddit.css` at `document_idle`, so a palette that
merely *ties* with the base block on specificity loses — while the dev bundle, which
concatenates everything into one `<style>` with `themes.css` last, would show it working.
It also covers vote delegation into a genuine shadow root, SPA navigation, and that
unhandled routes are left completely untouched.

**It is also the only suite that can see the isolated world.** Content scripts do not
share a JavaScript realm with the page, so a method Reddit's own code defines is invisible
to the isolated world. `faceplate-partial.loadContent()` is one, and pagination called it directly — which
means infinite scroll was broken in every installed copy of the extension while the dev
harness (main world, via DevTools) paginated perfectly. The `/r/pager/` fixture defines a
real custom element so the two worlds actually diverge under test. Anything
packaging-sensitive belongs here, not in jsdom.

### Browser suites skip cleanly

If no Chromium is found, suites 3 and 4 print `SKIP` and exit 0, so `npm test` still works
without one. A browser is located automatically — Playwright's dir, puppeteer's own
download, then `/Applications/Google Chrome.app` and the usual Linux paths — so no setup
is normally needed. `SHEDDIT_CHROME=/path/to/chrome` overrides that choice;
`SHEDDIT_REQUIRE_BROWSER=1` turns the skip into a failure (use this in CI).

---

## The suites have teeth — verified by mutation

```bash
npm run test:mutate      # ~20 min, on a throwaway copy
```

`test/mutate.sh` reintroduces bugs this codebase actually shipped and reports whether
the suite that should notice does. A `SURVIVED` row is a hole in the tests.

**Put each mutation against the suite that can see it.** `resetForRoute`'s unblank looked
redundant under jsdom and survived — jsdom fires `load` after the listener registers, so
the load listener covered it there. In a real browser `pipeline.js` boots at
`document_idle`, which can land *after* `load`, and then that line is the only thing
stopping the blackout coming back: measured 1579ms versus ~30ms with it. The mutation was
not wrong, it was pointed at the wrong runtime.

**Defence in depth needs multi-part mutations.** Three separate call sites clear the
pre-render blackout on a page with no feed (the `load` listener, `check()`, and
`resetForRoute`). Removing any one is invisible, because the others still fire — so those
rows remove *all* of them, or all the fast ones, and state that in the row name. A single
mutation that survives because a sibling covers it is not a hole; a mutation that survives
because nothing asserts the behaviour is. Tell them apart before writing the test.

It keeps earning its keep. A number of mutations have survived their first run over the
project's life, and every one
was a real gap:

- an in-flight flush after a failure was covered only by a timing-dependent test that
  passed vacuously;
- `gate`'s stop-teardown had no observable consequence under test at all;
- an assertion read `box.querySelector('pre').textContent` and *threw* when the element
  was gone — a throw is not a failure, so the row read as passing;
- an age-gate assertion allowed 2500ms when the real path takes 25-52ms, so it passed even
  with the fast path removed and the page clearing only on the 1500ms fallback. A
  threshold loose enough to admit the fallback cannot detect losing the fast path;
- releasing to native Reddit was only tested from a page that had already rendered, missing
  the ordinary case where the deadline fires before anything reaches the screen.

Note the third one: an assertion that throws looks exactly like a mutation that survived.
Keep assertions null-safe.

If you change rendering logic and the suite stays green, check that you actually rebuilt
(`npm test` does it for you).

---

## Offline visual preview (browser, no install)

```bash
npm run preview
```

Writes `dist/preview.listing.html` and `dist/preview.comments.html`. Open either directly
in a browser — they are fully self-contained (Sheddit's CSS is inlined; fixture images are
swapped for coloured placeholders). Everything else is the exact markup the extension
produces.

---

## 5. Media sync (headless Chromium)

`test/media-sync.js` exists because jsdom implements no media pipeline at all: `play()`
resolves nothing, `currentTime` never advances, `timeupdate` never fires — so the video
player's audio pairing was the one shipped feature `run.js` structurally could not see.
The suite generates its own VP8/Opus media in the page with `MediaRecorder` (no fixture
binary, no network), then asserts the paired audio starts, holds sync, recovers from a
deliberate shove, follows seeks, mirrors volume and mute, and stops with the picture.
Skips loudly without a browser, like the other Chromium suites.

## 6. Live on reddit.com

### Option A — dev harness (fastest iteration, no install)

```bash
npm run build          # writes dist/sheddit.dev.js
```

Open reddit.com, open DevTools console, paste the file's contents, hit enter. Re-running
is safe — it tears down the previous run first. This is the loop to use while tuning CSS.

> Chrome requires you to type `allow pasting` in the console once before it will accept
> pasted code.

### Option B — load unpacked (the real thing)

1. `chrome://extensions` → toggle **Developer mode** on
2. **Load unpacked** → select this folder
3. Visit `reddit.com`

After editing source, hit the reload icon on the extension card, then reload the tab.

### Option C — re-verify the contracts automatically

```bash
npm run verify:live              # logged out, headless
npm run verify:live -- --headed  # watch it; sign in first to test a real vote
```

`test/live-contracts.js` opens real reddit.com and checks every selector and attribute
name in `src/config/contracts.js` against the live markup: all `POST_ATTR` and
`COMMENT_ATTR` present on every element, `faceplate-partial` still exposing
`loadContent()`, comments still flat siblings, ads still containing no `shreddit-post`,
and it reports any `post-type` value the fixtures do not cover.

**It also settles the vote-delegation question**, reporting which of three worlds the
native upvote button is in — the light DOM, an open shadow root (delegation works
only because `dom.deepQuery` pierces it), or unreachable (a closed shadow root, meaning
delegation cannot work at all and voting needs a different mechanism).

Not part of `npm test`: it needs the network, and Reddit serves an anti-bot interstitial
to datacenter IPs, so it must be run from an ordinary machine. It skips cleanly with an
explanation rather than failing when it cannot get through.

---

## What to check by hand on the live site

The automated suite covers structure; these need eyes:

- [ ] Home feed renders as dense link rows, no flash of new Reddit on load
- [ ] Scrolling to the bottom loads more posts (the sentinel → `loadContent()`)
- [ ] With `autoPaginate` off, a "load more" button appears instead and fetches nothing until clicked
- [ ] Clicking a post title goes to the article (link posts) or the thread (self posts)
- [ ] Comment threads indent correctly and `[–]` collapses
- [ ] Navigating between subreddits client-side re-renders cleanly with no duplicate rows
- [ ] Search / user pages are left as **native Reddit**, untouched
- [ ] Voting while logged in actually registers (delegation to the hydrated native button)
- [ ] Clicking `reply` reveals the native composer, and "← back to sheddit" returns

Voting is the only behaviour that needs a logged-in session; everything else is verified
logged out. Run `npm run verify:live` first — it tells you whether the vote control is
even reachable before you go looking for it by hand.

---

## Continuous integration

`.github/workflows/test.yml` runs the full suite with `SHEDDIT_REQUIRE_BROWSER=1`, so a
missing Chromium fails the build instead of silently skipping half the assertions.
`.github/workflows/mutate.yml` runs the sweep — `test/mutate.sh` reports per row and
always exits 0, so the workflow greps for `SURVIVED` and turns that into the failure
itself.

Both are dispatched by hand from the Actions tab rather than firing on a push or a
schedule. Running the sweep on some cadence is the point rather than a nicety: the failure
it guards against is a suite that has quietly stopped protecting something, which looks
exactly like a passing build until you go and check.

## Closed gaps

- ~~Not yet run as a packed extension end-to-end.~~ `test/extension.js` loads this
  directory as a real unpacked extension and drives it, covering manifest match patterns,
  `run_at` timing, script order and CSS delivery.
- ~~Layout is untested.~~ `test/geometry.js` reads real `getBoundingClientRect()` values
  out of headless Chromium.
- ~~Staircase indentation on the listing preview, unreproduced.~~ Measured at ten widths:
  identical left offsets, zero horizontal overflow. Now a standing assertion.

## Verified live, 2026-08-14

`npm run verify:live` ran for the first time against real reddit.com (the sandbox this
project was largely built in gets an anti-bot interstitial from Reddit; a residential
connection does not). Findings, roughly most to least important:

- **🔴 Comments may no longer be flat siblings.** The load-bearing assumption behind the
  entire depth-stack in `comments.js` — "`<shreddit-comment>` elements are FLAT, threading
  is only the `depth` attribute" — failed live. `verify:live` now dumps enough structural
  evidence (DOM-ancestor-comment-count vs. the `depth` attribute, whether a comment's
  direct parent is another comment, a tag-skeleton ancestor chain to the deepest comment —
  no comment text, nothing user-written) to design a fix from evidence rather than a
  guess. **Do not rewrite `comments.js` before reading that output.** It is entirely
  possible the fix is small (Reddit may have started nesting to exactly match what
  `depth` already encoded, which would make the depth-stack redundant but not wrong) or
  large (a genuinely different threading model). Re-run `npm run verify:live` and read
  the `COMMENT STRUCTURE` block before touching anything.
- **Voting is confirmed unreachable for a logged-out session**, not merely unverified.
  `deepQuery` searched 21 open shadow roots under a live post and found nothing matching
  the upvote selector. This matches the scope decision (logged-out reading is the target)
  rather than contradicting it — delegation code stays for a possible logged-in session,
  which is still genuinely unchecked (`--headed`, signed in, would answer that).
- **A new `post-type`: `crosspost`.** Falls through the same non-text path as
  `link`/`image`/etc. in `model.js` — no crash, no dedicated handling, and no fixture
  coverage either. Works by accident of the fallback, not by design. Add a
  `test/fixtures.js` post before trusting it further, ideally once real `domain`/
  `content-href` values for a crosspost are captured (this run reported the type but not
  those specific attribute values).
- **Two dead attribute mappings, removed.** `award-icon-url` and `is-link-post` were no
  longer present on every post, and neither was consumed anywhere downstream (`isLink`
  was never even copied into the model). A mapping to an attribute nothing reads is not a
  contract worth defending — deleted from `contracts.js` rather than chased.
- **Confirmed still true:** every `POST_ATTR` besides the two dropped above, every
  `COMMENT_ATTR`, `shreddit-feed`, `#main-content`'s depth below `shreddit-app`, the ad
  filter (`shreddit-ad-post` containing no `shreddit-post`), and the feed partial with its
  `loadContent()`.
- **Comment continuation exists, but not in the shape assumed.** A real thread (88
  declared, 25 delivered) did carry `faceplate-partial` inside `shreddit-comment-tree`
  exposing the same `loadContent()` — which is the half that was built on an untested
  assumption and is now evidence. The other half is *wrong*: there were **ten** of them and
  **none** carried `loading="programmatic"`, beside controls reading `"16 more replies"` and
  `"continue this thread"`. So `C.COMMENT_PARTIAL` matched nothing live, only the paginator's
  broader fallback clause did any work, and "one partial = the next page" — the feed's model,
  which `COMMENT_PAGER_SCRIPT` encodes — is probably not what a comment tree does.

  The consequence was a real bug, not a documentation nit: `loadNext()` re-queries its
  selector every time, so if a partial fills its branch in place rather than replacing
  itself, the same element is picked for ever. `commentsPage({branchPager:true})` now models
  that shape, and the fix (stamp what has been driven) is correct under both mechanisms — see
  bug 27 in `docs/engineering-log.md`.

  MEASURED 2026-08-24, live: the mechanism is **subthread expansion**. The **WHAT DRIVES A
  COMMENT TREE** section of `test/live-contracts.js` drove the exact element the paginator
  would drive, five times, on two different threads — every driven partial removed itself
  (5/5 both runs), every drive delivered comments under its own branch, and progress never
  stalled. The stamp-and-exclude design is correct under the mechanism it actually runs
  under, not just under both candidates.

Re-run this after any suspected Reddit redesign. See the caveats below for what is still
unchecked.

## Known gaps

- **Real logged-out page states are approximated, not captured.** The `/r/gated/` fixture
  is a hand-written stand-in for an age gate; actual NSFW interstitials, quarantine
  notices, private-community pages and rate-limit pages have never been seen by this test
  suite. They should all land in the "no feed container" branch, but that is reasoning,
  not evidence — check with `npm run verify:live` against one of those routes specifically.
- **`gate.js`'s 1500ms failsafe is untuned against a slow real page.** It is armed at
  `document_start`, and the render pipeline does not begin until `document_idle`; on a
  slow connection that budget could plausibly expire before the first post renders,
  bailing a page that would have worked. Not observed, not measured — worth timing on a
  throttled connection.
- **What a comment-tree partial *means* is still unmeasured.** Ten of them, none
  programmatic, labelled "16 more replies" — see the live-run notes above. The code no longer
  depends on the answer, and `verify:live` will produce it, but it has to run from an ordinary
  machine: `verify:live` needs a real network and Reddit serves a bot-mitigation shim to
  datacenter IPs (confirmed — an 8.4 KB spinner page with `retry-after: 0` in place of the
  feed), so a container or CI runner cannot answer this no matter how the browser is
  configured.
