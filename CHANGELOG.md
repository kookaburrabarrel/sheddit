# Changelog

Sheddit is in **beta**: 0.26.0 is the current build, open to anyone who wants to install
it by hand while the store listings are in review. Everything below is pre-1.0 development
on `main`. The version in `manifest.json`/`package.json`/`README.md` moves on every push,
because it is the only build identity available while testing: the failure screen prints
it, so a report can always be matched to the build it came from. Dates are commit dates.

Entries lead with what changed for a *user* where there is such a thing, and note the
underlying cause where that is the more useful fact. Several entries describe bugs that
existed from the first commit and were only found once a test could see them — those are
marked **never worked**, because "fixed" would imply it once did.

---

## Unreleased — 0.27.0

### Added — an "nsfw thumbnails" toggle in the header

Adult thumbnails have always been showable — the setting existed from the day the
placeholder shipped — but it lived on the options page, which is where a setting goes to
be forgotten. It now has a button beside the theme switcher, so it can be turned on and
off while reading rather than in a separate window. It is the same single setting either
way: flip it in the header and the options page agrees, and vice versa.

Unlike a theme, this one genuinely re-renders the page — a placeholder tile and a
picture are different markup, not different paint, and rendering the picture and hiding
it with CSS would fetch the image the placeholder exists to avoid fetching. Your place
in the feed survives that, which the layout suite now checks: everything the paginator
had loaded comes back, and the scroll position holds.

### Fixed — settings controls did nothing in the preview and dev harness (**never worked**)

The development harness stubbed browser storage with something that accepted writes,
stored nothing, and had no change notification at all. Any in-page control that saves a
setting therefore appeared to do nothing there while working correctly once installed —
the harness reported no error, because as far as it was concerned the write succeeded.
It is a real in-memory implementation now, change events included, so what the harness
shows is what the extension does. Settings still don't survive a reload there, which is
honest: there is nowhere to put them.

## Unreleased — 0.26.0

### Fixed — deep comment branches are readable to the end again

Found by a QA round, measured three for three on two live threads: clicking "N more
replies" delivered one slice and then the branch dead-ended — the delivered comments
carry the expanders for the remainder, but they can land inside a comment *after* it was
rendered, and nothing ever looked again. A single watcher on the comment tree now offers
the control on the already-rendered row the moment its expander arrives, so expansion
keeps going as deep as the thread does.

### Fixed — galleries show every frame, and their titles stop leaning on a redirect

The gallery stack rendered only the frames that had loaded at the moment the post was
first seen; the lazy remainder hydrated moments later and was dropped. Late frames are
now appended as they arrive. Gallery titles also route straight to the post's comments
page (where the frames render) instead of through `reddit.com/gallery/…`, which only
landed there by Reddit's redirect grace.

### Fixed — hidden comment scores say "score hidden" instead of "1 point"

On any young thread in a subreddit that hides new comments' scores, every comment —
thousand-vote top comments included — showed exactly "1 point": Reddit ships a
placeholder score of 1 while the real one is hidden, and the placeholder was rendered
literally. Comments carrying the hidden flag now say "score hidden", old reddit's
convention. One caveat, recorded in the engineering log: the flag's attribute name on
the page element is a best-candidate mapping (the report verified the hiding in Reddit's
data, not on the element), so the fix is built to change nothing if that name is wrong,
and `npm run verify:live` on a young thread now measures which case is real.

### Fixed — comment GIFs show the picture instead of a solid black box

Reported with a DOM audit: most GIFs in comments arrive as Reddit's video player fed a
raw `.gif` file — which a `<video>` cannot decode — with no poster frame, so the player
paints solid black, and the copy cloned into Sheddit's layout upgrades into the very same
broken player. Those players are now swapped for a plain image (the same way the comment
GIFs that already worked were delivered), in comment bodies, selftext and profile
comments alike. The picture shows and animates in place.

### Fixed — sorting a comments page no longer interleaves two sorts

Found by a QA round on a live thread: clicking a sort in the comments page's own
`sorted by:` strip moved the URL but not the page — and then quietly appended the new
sort's comments under the old sort's render, two orderings on one page with nothing
marking the seam. The strip's links were built as plain navigations, but Reddit's router
intercepts them into a query-only client-side navigation, which the route-change
detection (keyed on the path alone) could not see. It now watches the `?sort=` parameter
too — and only that parameter, so Reddit rewriting tracking junk in the query can never
tear the page down. The re-sorted thread keeps its post row and sort strip, and the
strip bolds the sort that is actually on screen.

### Fixed — "load more" can no longer hijack a click into an unrelated post

Reported from live use, with the stolen click's destination named: after a sort-tab
switch the listing paints its first three posts with "load more" right beneath them, the
automatic fill completes the listing a couple of seconds later, and the new rows land
above the button — so a click aimed at "load more" opened whichever post had slid under
the cursor. The control is now held inert while the fill is still working the page: it
wears a plain "loading…" face, refuses clicks (and keyboard focus), and only becomes the
clickable "load more" at one of the fill's real stopping points — where nothing
unprompted will move it again. Manual mode (auto-load off) is unaffected: nothing
unprompted moves that page, so its button is honest from first paint.

### Fixed — switching sorts no longer blanks the page with no explanation

The same report's second symptom, and older than it looks: every in-page navigation tore
Sheddit's layout down before Reddit had delivered the next page, leaving a themed but
completely empty viewport — several seconds of apparent blackout per sort-tab click, with
clicks into it silently swallowed. That window now shows a themed "loading…" line the
moment the navigation commits, replaced by the rendered page (or cleared by every other
exit: a hand-back, a failure, the user releasing to native Reddit).

## Unreleased — 0.25.0

### Fixed — heavy pages no longer flash the native feed before the layout

Reported from live use the day the Firefox build shipped, and reproduced in-suite on
both engines. Real Reddit streams its document, the renderer cannot start until
DOMContentLoaded, and the watchdog's first look lands at 1500ms — where, finding
sources on the page and no renderer yet, it used to stop hiding the page. On a heavy
page that showed the native feed for a moment and then snatched it away when the render
arrived. The watchdog now asks whether the URL is one the renderer will take (the route
classifier moved to document_start so the answer exists that early) and holds the
curtain when it is; a page that will never be rendered still un-hides at the first
look, exactly as before. Measured first: the suspected cause — Firefox delivering the
extension's CSS after first paint — was cleared by a parse-time probe that both
browser suites now keep as a regression sentinel, and a new streamed fixture (feed up
front, closing tags held past the watchdog's tick) is what reproduced the real
mechanism and pins the fix.

### Fixed — the image expando's [-] collapses again (**never worked**)

Clicking [+] on a listing row opened the picture; clicking [-] left it exactly where it
was, in every real browser, since the expando shipped. The toggle was correct — the
stylesheet was not: `.expando` declares its own `display`, and any author display
declaration overrides the browser's built-in `[hidden] { display: none }`, so the
collapsed box kept its layout. One counterpart rule fixes it; the tests are the real
change. The layout suite now closes what it opens and asserts the picture actually
leaves the page with the row back at its measured height (it only ever asserted the
opening half, which is how this shipped), the CSS lint statically rejects any
hidden-toggled selector that declares display without a `[hidden]` counterpart, and the
Firefox suite re-verifies the click pair on the engine the report came from.

## Unreleased — 0.24.0

### Added — Firefox

Sheddit runs on Firefox 128 and newer. `dist/sheddit-firefox.zip` is the build: the same
source byte for byte, with the manifest **derived** from Chrome's at package time — the
gecko block (add-on id, the 128 floor that `world: "MAIN"` sets, a data-collection
declaration of "none") is added and the Chrome-only version key dropped, in exactly one
function, so the two stores cannot drift anywhere else. Until an addons.mozilla.org
listing lands, Firefox accepts it as a temporary install via `about:debugging` (README
has the steps). Firefox can also revoke a site permission at any time, and an extension
whose content scripts never run cannot say so on any page — so the options page now
checks and, when reddit.com access is missing, says so and offers a one-click grant.

A real-Firefox test suite ships with it: `test/extension-firefox.js` installs the
Firefox build into an actual Firefox through geckodriver and asserts the things only
Gecko can answer — the main-world bridge across Firefox's stricter realm boundary, the
theme cascade tie under its injection order, the storage round trip, and SPA routing
both with and without the `navigation` API (present in current release, absent in ESR;
the suite runs one session each way). It skips cleanly on machines without a Firefox,
like the Chromium suites.

### Fixed — client-side navigation on browsers without the `navigation` API (**never worked**)

The fallback for browsers lacking the `navigation` API patched `history.pushState` in
the content script's own realm — a copy of `history` that Reddit's router never calls,
since the router lives in the page realm. Chrome never took that branch (it has the
API), and every one-realm test environment passed it, because there the patched copy IS
the page's; on Firefox ESR, which has no `navigation` API, every sort click and SPA
navigation would have gone unseen, with only back/forward working. The bridge — already
the main-world half of pagination — now patches the page realm's
`pushState`/`replaceState` and relays each commit as a bare event that route.js listens
for; a static test refuses any same-realm history patch coming back, because it would
mask a dead relay in every one-realm environment while shipping broken. Engineering log
bug 82.

## Unreleased — 0.23.0

### Removed — the post's dead `award-count` mapping, caught by its own tripwire

A live listing carried `award-count` on 0/28 posts — while the same day's comment run
measured it present 25/25 — so the POST mapping failed the test that removed
`award-icon-url` before it, twice over: consumed by nothing, and now absent. The comment
mapping stays. The listing probe also learned the distinction this finding needed:
the required triad must be universal, a dead optional mapping (0 carriers) fails as a
retirement prompt, and partial coverage (`icon` on 27/28) is an FYI, because the model
treats everything outside the triad as optional by design.

### Fixed — one gated subreddit could crash the live-verification run

Booting the bundle inside the probe runs the real pipeline, and on an age-gated
subreddit the answered gate can navigate the page — destroying the JS context between
the bundle's injection and the read that used it. One live run lost its thread, sort and
profile sections to exactly that. The probe now detects the turnover and re-injects, and
a crash anywhere mid-run still prints the tally of the sections that finished.

## Unreleased — 0.22.0

### Fixed — clicking an image post no longer dumps you into Reddit's viewer

The reported bounce is re-diagnosed, measured, and closed from the other end. A live run
showed image posts carrying a bare `i.redd.it` content-href (16/16) — not the `/media`
viewer URL 0.19.0's fix assumed — and probing that URL found the real mechanism:
`i.redd.it` serves an image fetch normally and **307-redirects a navigation** to the
`/media` viewer, discriminated on the Accept header. **`preview.redd.it` does the same**,
so pointing links at the resolved preview file cannot escape the viewer either. There is
no URL a logged-out click can reach that shows the bare picture.

So the design follows video's precedent instead of chasing a destination that does not
exist: an image post's title (and thumbnail) now route to its own comments page, where
the full-size picture renders inline — and the inline pictures lost their link wrappers,
because a link under an already-rendered picture can only bounce the reader out of the
layout. An image post whose link goes somewhere genuinely external is untouched.

### Fixed — verify:live stopped indicting contracts its own probes were misreading

The video section read `packaged-media-json` off `shreddit-post` — the exact location the
model was corrected away from when a capture showed the attribute lives on a nested
player — so it could report 0/N against a page whose players all carried the JSON. It
queries the subtree now, and zero carriers is a note rather than a failure, since the
manifest player has been the load-bearing path since 0.16.0. The comment-sort check also
recalibrated: it compared the two sorted deliveries as sets, and on any thread bigger
than one page, newest-25 and oldest-25 are different comments — a set difference is what
a working sort looks like. It now compares id recency, which survives big threads.

## Unreleased — 0.21.0

### Added — the comments page has a sort menu, and an `all N comments` escape hatch

Requested twice from live use: old reddit's strip above the thread — `all N comments`,
then `sorted by: best | top | new | controversial | old | q&a`. The links are ordinary
hrefs onto the post's own permalink with `?sort=`, so a deep link (a `?context` view, a
single-comment permalink) gets its way back to the whole thread for free, and the current
sort is marked as old reddit marked it, a bold non-link.

The sort **values** are a contract and they are stated as unverified in `contracts.js`:
they are the classic API's names (`confidence` is what old reddit called "best"), chosen
because a container cannot reach real Reddit to confirm what the current site accepts.
The failure is soft by construction — a value Reddit does not recognise falls back to the
default order and the page still loads — and `verify:live` is what settles them.

### Added — galleries show every frame

The image work in 0.19.0 covered single-image posts; a gallery's comments page still
showed a title and a thumbnail. Galleries now render every frame the page is carrying,
stacked, each at its own best resolution — the frames are peers, and the single-winner
ranking that is right for an image post silently drops all but the largest frame of a
gallery. Same host allowlist, same post scoping, same adult-content gate, same fallback:
a gallery whose full-size files are not in the page costs the pictures and never the post.

### Fixed — a paginator test starved the timer it was waiting on

A suite bug, and the recognisable kind: the page-cap test failed roughly one run in
forty with pages frozen low, which reads as flaky infrastructure right up until someone
starts ignoring red builds. Its manual-drive loop awaited a function that refuses
synchronously while a load is in flight — and an await of a synchronously-resolved
promise continues on a microtask, so the loop never yielded to the timer queue where
that load's completion lived. It burned all sixty attempts against a state that could
not change *because the loop itself was blocking it*. A refused attempt now yields one
macrotask before retrying; the attempt budget is unchanged. See the engineering log for
the general rule this leaves behind.

### Fixed — a profile timestamp that arrived late was lost for good

Observed live twice: after a back-navigation, a profile row rendered without its
timestamp. Reddit restores cached elements on history traversals and the pipeline
re-consumes them mid-hydration, so the `<time>` could be read once — before it existed —
and the row stayed bare even though the element grew its timestamp moments later. The
field is optional, which is why nothing ever failed loudly. A row that rendered without a
timestamp now watches its source element and patches the time in when it lands, with the
watch dropped on first success or after fifteen seconds, whichever comes first.

## Unreleased — 0.20.0

### Changed — the store summary says "no tracking"

The manifest description — which the Chrome Web Store displays as the listing's summary,
read out of the uploaded zip — now reads: *"Renders modern Reddit in the classic
old.reddit.com layout, locally in your browser. No API, no login, no tracking."* The
previous line spent its characters on mechanics; this one closes on the question a reader
of an extension that rewrites a site they browse actually wants answered. The store
listing copy and the README landing were rewritten to match: both now lead with reading
logged out and unprofiled, with the layout as the visible half of that decision rather
than the headline. No code changed; the version moves because the manifest did, and two
builds must never share a version number.

## Unreleased — 0.19.0

### Added — image posts show their image

**An image post's comments page now has the picture on it, and the thumbnail no longer
throws you out of the layout.** Reported twice in one round: the page rendered a title, a
70px thumbnail and nothing else, and clicking that thumbnail landed in Reddit's own
`/media` viewer — a page this extension does not render.

One gap with two faces, and the third instance of the same root cause: **post content is
not an attribute.** A text post's body had it, a video's rendition had it, and images were
the member of that set with no handling at all. The picture is read out of the page the
same way the body is, scoped to the post it belongs to, through the same host allowlist
the thumbnail uses. Where Reddit offers a responsive set, the widest entry wins.

The link substitution is deliberately narrow: only when the post is an image, a picture was
found, *and* the link points back into reddit.com. A link that already goes straight to a
file is left alone, and any miss falls back to exactly what shipped before — so getting
this wrong costs the picture and never the post.

**Listing rows get old reddit's expando**, which opens the picture in place rather than
navigating away. It loads on first open, not at render: a listing is dozens of rows, and
building them all up front would fetch every full-size image on the page for rows nobody
opened.

**Adult posts are not quietly enlarged.** Both new surfaces answer to the same
"show adult-content thumbnails" setting the tile does, because rendering our own `<img>` is
what bypasses the blur Reddit applies for logged-out readers, and a full-size inline copy is
that same bypass made larger.

Two things a fixture cannot settle, so `verify:live` gained a section that reports them: the
`/media` link shape is inferred from what clicking did rather than from a capture, and where
a live comments page keeps the full-size file is still unrecorded. Expect the picture to
resolve to the largest size the page offers, which on some posts may be the thumbnail.

There is a new **Show images inline** setting, on by default, that turns both off.

## Unreleased — 0.18.0

### Fixed — opening a comments page no longer locks the tab

**A page you have not touched now fills itself and then waits, instead of loading until it
runs out.** Reported twice, independently: opening a comments page froze the tab for 30+
seconds before recovering, and clicking a `[-]` collapse on a thread did the same. A
history traversal did it once.

Both reports read it as an expensive re-render on every state change, and it is worth
saying why that turned out to be wrong, because the evidence against it is what found the
real cause. The collapse handler is three operations, the render queue only ever sees
element insertions so a text change cannot reach it, and the collapsed rule is three
`display:none` declarations. Nothing re-renders. What a collapse changes is the **height
of the page** — and page height is what pagination triggers on. That the second report saw
the freeze *with no click at all* is what settled it.

Three things combined into a burst: the sentinel is re-armed after every render, "near the
bottom" is generous enough to stay true until two screens of content sit below the fold,
and a page whose content arrives late is credited afterwards rather than counted, so the
40-page ceiling never bounds it. On a freshly opened thread that starts at first paint,
before the reader has done anything. Collapsing restarts it by shrinking the page; a
traversal does the same, because the layout is rebuilt into a briefly empty one.

The freeze itself was the measuring, not the loading: two separate geometry reads ran on
every attempt and every two-second tick, interleaved with renders that invalidate layout
again. That is what made it present as a frozen tab with torn, tiled repaints rather than
as something merely slow. Geometry is now read once per frame and shared.

The fill is not the mistake, and it could not simply wait for a scroll: a listing arrives
with three posts, which is the dead end pagination exists to fix, and three rows do not
make a scrollable page — there would be no gesture to wait for. What was missing was a
stopping point. It now fills until the page is worth scrolling and then stops, bounded by
attempts as well as height so that loads which deliver nothing cannot spin. The sentinel
reads `load more` and waits, and scrolling or clicking it resumes normal infinite scroll.

## Unreleased — 0.17.0

### Fixed — the inline player has sound

0.16.0 shipped a player that worked and was silent, because CMAF puts the picture and the
sound in separate files and offers nothing combined. The player now takes both from the
same manifest and plays them together, so a repackaged video post is watchable *and*
audible inside the layout. Nothing extra is fetched by the extension to do it — the
manifest already named the audio track; 0.16.0 resolved it and then had nothing to do
with it.

**Two elements, not MediaSource — and the reason is that MSE could not be verified here.**
Feeding both tracks to one element through two SourceBuffers is the textbook answer and is
what Reddit's own player does. It is not what shipped, because shipping it would have meant
shipping it untested: the Chromium these tests run against is the open-source build with no
H.264 and no AAC (`MediaSource.isTypeSupported` returns false for both, measured), and
Chrome's WebM byte stream accepts only **one** SourceBuffer, so no combination available in
this project exercises two-buffer MSE. An `<audio>` alongside the `<video>` can be tested
end to end in a real browser, and now is.

**What made that viable is a measurement, not a hope.** Two media elements were expected to
drift apart. They do not: eight samples over three seconds held a *constant* −75ms, and a
seek left it at −67ms. The elements advance in lockstep and the gap is a fixed startup
offset — one cannot start two elements in the same instant — so what is needed is one
correction rather than a drift-chasing loop. `pair()` makes the video the clock, corrects
only the audio, and re-aligns on play, seek, stall and a standing `timeupdate` check.

**The volume control is ours, deliberately.** A video element with no audio track of its
own may not be given a volume control by the browser, and a video whose sound cannot be
turned down is worse than one with no sound. The row under the player owns mute and volume;
it writes to the *video*, which `pair()` mirrors to the audio, so a native control — where
there is one — and ours can never disagree.

**A new browser suite, `test/media-sync.js`.** jsdom implements no media pipeline at all:
`play()` resolves nothing, `currentTime` never advances, `timeupdate` never fires. So the
one part of this feature that could actually fail was the one part run.js structurally
cannot see. The new suite generates its own VP8/Opus media in the page with `MediaRecorder`
— no fixture to commit, no network, and nobody's video in the repository — then asserts
that the audio starts itself, holds within 120ms, recovers from a deliberate 1.5s shove,
follows a seek, mirrors volume and mute, and stops with the picture. It skips loudly
without a browser, like the other two.

An asset whose manifest lists no audio track at all is still genuinely silent, and still
says so on screen.

## Unreleased — 0.16.0

### Fixed — video posts play again, inside the layout

**A video post's comments page now has a player in it.** Before this, a post whose asset
Reddit had repackaged could not be watched anywhere with the extension on: the packaged
renditions 403, so `watch` resolved nothing, the title went to the comments page, and the
comments page rendered a title and a thumbnail and no video. Reported from the field
against `v.redd.it/nzafnbgwcxkh1`, and reproducible — every `DASH_*` file on that asset
403s, every `CMAF_*` returns 200, and there is no combined rendition at all.

**The player reads Reddit's manifest instead of guessing a filename**, which is the part
that took a while to get right. The obvious fix — build a `CMAF_720.mp4` the way the old
code built `DASH_720.mp4` — is the same bug wearing a new prefix: the rungs of the ladder
are Reddit's encoding choices, not the source's dimensions. The measured asset has
96/220/270/360/480 and no 720 or 1080, because it is a portrait phone video.
`DASHPlaylist.mpd` is ~3 KB and states every rendition *with its width and height*, so
there is nothing left to infer. Nor can the video file answer for itself: reading its
header means already having fetched it, which means already knowing its name.

**It picks by width, not height, and that is not a detail.** The box is 640px
(`--shd-video-max`). A height ceiling looks equivalent and fails on exactly the asset that
prompted the work — every rung of a 480x854 portrait video is *taller* than a 720 ceiling
while all of them are narrower than the box, so a height rule discards the whole ladder and
falls back to the smallest, serving 220x392 when a good 480 exists. The captured manifest
is in the fixtures precisely so that stays caught.

**Where it does and does not spend a request.** One per video post opened, on the comments
page, where the reader has already chosen that post. None on listing rows — twenty video
posts scrolled past would otherwise be twenty requests for videos nobody asked to watch —
and none at all when the post still carries a packaged rendition, which is preferred when
present because a combined file keeps its audio. The `watch` link on listing rows is
unchanged, and its fallback to the permalink stops being a dead end now that the permalink
plays. The test suite asserts the call count, not just the rendered player: a regression
that quietly fetched per row would still look right on screen.

### Changed — the privacy claim is now "no API calls", and one request is documented

Until now the extension made **no** requests of any kind, and PRIVACY.md said so with a
grep you could run yourself. It now makes one: a GET of a static video manifest from
Reddit's media CDN, sent with `credentials: 'omit'`, carrying no cookies and nothing about
the reader. PRIVACY.md, README.md and the store listing say this plainly rather than
quietly relaxing the old wording, the verification grep is restated as "returns exactly one
hit, in `src/core/media.js`" instead of "returns nothing", and the store's data-collection
disclosures are unchanged and still accurate — nothing about the user is transmitted.

**`inlineVideo` turns it off** (options → "Play video on the comments page"). Off, the
extension makes no requests at all, exactly as before, and video posts go back to being a
link and a thumbnail. On by default, because without it a repackaged asset is simply
unwatchable — which was the bug.

No new host permission was needed: `v.redd.it` answers with `access-control-allow-origin:
*`, so nothing about what Sheddit is *allowed* to reach has widened.

### Known limitation — the inline player is silent

CMAF splits video and audio into separate files and offers nothing combined, so a
repackaged asset plays without sound and the player says so on screen rather than letting a
reader conclude Sheddit broke their audio. Posts that still carry a packaged rendition keep
their audio, because that path is preferred when it exists. Sound for the CMAF case needs
`MediaSource` feeding both files to one element; `media.js` already resolves and returns the
audio URL so that step does not have to re-derive it.

### Fixed — a mistyped global could take the whole submission down with it

Found while building the above, and the reason the guard exists: `videoPlayer()` threw on a
wrong global name, the throw propagated out of `consumePost()`, and the *post itself*
stopped rendering — comments fine, submission gone. The player is an enhancement on a row
that already works and must never be able to remove it, so it is wrapped. A second one the
suite caught: the `isConnected` check inside `mount()` also ran on the synchronous path,
where the box is not attached yet, so the good URL was rejected every time and left a
`<video>` with no `src`.

## Unreleased — 0.15.0

The two 2026-08-22 lines of work meeting: the live testing below (0.12.2) and the three
video reports (0.13.0 and 0.14.0), which were handled on a branch cut before that
round landed. No behaviour of its own — the version moves because the build does, and two
different builds must never share a version number: that is what cost two live testing when
`0.1.0` sat still.

### Documented — a fourth video report, reproduced, and one belief corrected

No behaviour change; the entry exists because a *wrong* fact was removed from the
engineering log, and a wrong fact recorded as settled is the expensive kind. A field
report named a single asset (`v.redd.it/nzafnbgwcxkh1`) that renders as a link and
thumbnail while other video posts play. It reproduces exactly: the asset carries
`CMAF_220/270/360/480.mp4` and separate audio, no legacy progressive rendition at all, so
`mp4Of()` resolves null and `watch` degrades to the permalink. That is the CMAF migration
already recorded under 0.13.0, landing on a specific post.

The correction: open question 9 listed "the `CMAF_*` files are fragmented segments that do
not play standalone" among the things already known, and it is false. The manifest is
`isoff-on-demand` with `SegmentBase`/`indexRange` — one self-contained fragmented mp4 per
rendition, `moov` at the front, playable as a plain navigation. It is *silent*, because
the audio is a separate file, which makes that path a product decision rather than the
impossibility it was filed as. It still yields no fix: rendition heights vary per asset
(the measured one has no 720 or 1080), so constructing a name repeats the `DASH_720.mp4`
mistake, and reading the real names from the manifest is a network call of our own.

Two of the report's recommendations are ruled out and recorded so they are not re-derived:
hls.js/dash.js are `fetch`-based media engines and would break `PRIVACY.md`'s published,
grep-checkable "the extension makes none"; and the signed query string is not the
discriminator here — every probe was made unsigned, and the CMAF files and both manifests
still returned 200 while the DASH files 403'd. The report's one genuinely new observation
is that `<shreddit-player>` was present *and* populated with a live `src` on the page with
the extension installed, which retires half of what open question 9(c) was waiting on.
Only half: whether that node is alive enough to be revealed in place is still uncaptured,
and it is the half the fix rests on, so 9(c) stays open and live testing's P3 still decides it.

## Unreleased — 0.14.0

### Changed — a video post's title is its comments page; the mp4 is its own link

The design half of the same day's reports, and an project decision rather than a fix: with
Reddit migrating video to CMAF/HLS, a title that resolves to a packaged mp4 is a title
that intermittently lands the reader on Chrome's `source fetch error`. So the title now
points at the post's own comments page — which is where the `v.redd.it` bounce was going
to deposit a logged-out reader anyway, minus the round trip — and the rendition gets its
own `watch` link on the row, the way old reddit kept the outbound link and `comments`
separate. A dead rendition now costs one optional click instead of the whole post, and the
redirect loop that the mp4 workaround was invented to escape dissolves on its own.

`watch` is the one link on a row that re-resolves at click time, because the player
hydrates late (3 of 4 live posts had no JSON at first paint); it mutates its own
href without preventing default, so middle-click, copy-link and open-in-tab keep working
and the destination simply improves the moment Reddit hydrates. When nothing resolves at
all — a CMAF-only asset, which is the direction of travel — it degrades to the comments
page rather than to the bounce: still where the video is watchable, just Reddit's player
rather than a file. It is deliberately absent on the comments page itself, where it would
link to the page you are already on. Giving *that* page a real player is the other half of
open question 9, and it waits on one capture from the field: whether the native
`<shreddit-player>` is alive enough to be revealed in place by the passthrough machinery
that already does this for the reply composer.

Four mutation rows cover the change (the title carrying the mp4 again, the watch link
appearing on the comments page, the click-time re-resolution, and the closed loop), and
the round-13 brief's P3 is now the capture that decides the rest.

## Unreleased — 0.13.0

### Fixed — the codec of a video link was picked by Reddit's array order, not by anyone

Three reports arrived the same day, all about video. One of them, chasing a 403,
measured something nobody had looked at: Reddit offers the top rendition **twice**, once
as vp9 and once as h264, and `mp4Of()` ranked renditions by the largest number in the
filename — where `m2-vp9-res_462p.mp4` and `m2-res_462p.mp4` both score 462. `Array.sort`
is stable, so the winner was whichever Reddit listed first, which is always the vp9
variant. Measured on one subreddit: four of six video posts resolved to a vp9 file for
that reason and no other.

The JSON was already carrying the answer. A rendition object states
`dimensions: { height: 462, width: 854 }` — the number the filename scan exists to
recover — and the deep scan was throwing it away. Height now comes from the JSON where
the JSON states it and from the filename where it does not, and the remaining tie breaks
toward the h264 name, deliberately: the link is a top-level navigation into the browser's
own media viewer. The fixture gained the captured pair at equal height, listed vp9-first
as Reddit lists it, because a fixture with one rendition per height cannot tell a chosen
codec from an accident. Two mutation rows, one per half of the fix, plus a repair to two
older rows whose anchors this rewrite retired.

### Not fixed — the mp4 link is decaying upstream, and that is a design question

The same three reports, read together, say something larger than the tie-break. One
asset's packaged renditions **all 403** — eight of eight, with 4.5 hours of signature
validity left, while three other assets fetched minutes apart returned 200. Another post
had no `packaged-media-json` at all: its player carried `src=…/HLSPlaylist.m3u8` and
`preview=CMAF_96.mp4`, and its legacy `DASH_<res>.mp4` files 403 while `CMAF_*` and the
HLS playlist returned 206. So Reddit is moving video delivery to CMAF/HLS, and the
packaged mp4s the title link depends on are going away asset by asset. Nothing in the
attribute distinguishes a live rendition from a dead one, and confirming one would mean a
`HEAD` or ranged fetch — a network call of our own, which the zero-network-calls promise
rules out.

The cost is real and it is not the error page: Sheddit renders no player on a comments
page, so when the mp4 dies the video is unwatchable with the extension on. The fix is a
product decision rather than a patch — point video titles at the comments permalink and
expose the mp4 beside it, or render Reddit's own `<shreddit-player>` inside the layout
(the node is live and merely hidden, and `dom.passthrough()` already reveals native nodes
in place for the reply composer). Recorded as open question 9 with what each costs; not
chosen blind.

### Refuted — the extension does not re-inject Reddit's scripts

One report attributed a dead page to Sheddit re-inserting Reddit's inline modules through
`data:text/javascript` URLs to dodge the CSP nonce, breaking every relative import in the
bundle. The mechanism does not exist here: `src/` and `options/` contain no
`createElement('script')`, no `innerHTML`, no `document.write`, no `data:` URL and no
nonce handling. `bridge.js` reaches the page's main world through the manifest's
`"world": "MAIN"`, which is why `minimum_chrome_version` is 111 — the feature exists
precisely so an extension never has to inject a script tag. The same page's second
symptom points at the reporting harness rather than at the page.

## Unreleased — 0.12.2

Everything here comes from live testing on 2026-08-22, which found the
extension working — high rendering fidelity, clean suppression, correct passthrough, zero
Sheddit-originated console errors — and five defects on top of that baseline. Three of the
five had a test guarding the exact area and passing, which is the fact worth carrying
forward: each one was measuring a proxy for the thing that broke.

### Fixed — a large thread could not be read to the end

Clicking `N more replies` delivered fewer replies than the label promised, and sometimes
none at all — and either way the control removed itself four seconds later, so the branch
could never be finished. Measured on a 620-comment thread: labels of 3, 8, 1, 7, 11 and 15
delivered 3, **0**, 1, 5, 4 and 4. Reddit's label counts the whole branch subtree while one
click delivers a slice of it, so the control now survives a partial expansion and re-reads
Reddit's own label, which lets the count converge by clicking; it disappears only when the
branch is genuinely exhausted. An expansion that delivers nothing now says so and stays
clickable, instead of quietly consuming the click — *fails loudly, never silently* is meant
to apply to Sheddit's own controls too.

The control also moved out of the action row onto its own line at the bottom of the reply
list, where old reddit put it. In the action row it produced taglines reading
`permalink 1 more reply reply`.

### Fixed — a 4-digit score ran into the rank beside it

`218586` was rank `2` and score `18586`; four such rows were on the first screen of
`/r/AmItheAsshole`. The rank column has a 6px gutter now. Both guards that should have
caught this were comparing BOXES, which abutted exactly and so passed; they compare painted
text now — css-lint derives the score's extent from its own font-size, and the geometry
suite reads real extents with a `Range`.

### Fixed — every comment on a profile named the profile instead of the community

`/user/spez/` served every permalink user-scoped, so deriving the community from the first
path segment produced `comment in u/spez` thirty times out of thirty. Where the path cannot
say (an owner-scoped permalink on that owner's own profile), the row reads the community off
the link Reddit actually rendered, and prints no parent line at all when there is nothing to
go on. Profile rows also name the post being replied to now, which old reddit showed and
this did not.

### Fixed — the pagination sentinel flickered mid-load

`loading more…` → `load more` → `loading more…` on `/r/aww`. The sentinel is rebuilt after
every flush so it stays at the bottom of a growing list, and each rebuild painted the idle
label over the live one. The status now belongs to the load rather than to the node showing
it.

### Fixed — the self-post body box looked unpadded at the bottom

Symmetrical padding, and the trailing paragraph's margin no longer decides the gutter —
whether that margin survives depends on which stylesheet wins on the cloned node, which is
open question 7 and not ours to settle.

### Changed — the 72px row is a floor, not a fixed height

The README claimed rows are 72 pixels tall in every theme and that the geometry suite pinned
them there. The suite had never measured a row's height, and the live front page has rows at
77, 94, 100, 113 and 117px — carbon drifts on six rows rather than one, its monospace face
being wider. Titles too long for a row now officially grow it rather than being cut short:
truncating a title hides the whole content of a listing row, which is not a trade this
extension makes anywhere else. The suite gained a pathological-title fixture (three lines in
all five themes, plus an unbreakable 62-character token) and real row-height assertions —
the 72px floor, the one-line case, no overflow, nothing escaping its box, the thumbnail float
contained — at three widths across every theme. The README says what actually holds.

### Fixed — five holes the mutation sweep found in the tests themselves

Not shipped bugs. `npm run test:mutate` ran 144 rows against this release and five
survived, each with a plausible-looking assertion beside it:

- Deleting `pipeline.js`'s `visibilitychange` re-arm left its own test green, because the
  gate's 1500ms check drains the queue itself and the test was reading the observable both
  mechanisms produce. It asserts *when* the rows arrive now — mutated, the first row lands
  at 1554ms, which is the deadline to the millisecond.
- The window-leak fix and the hovercard section's auto-chain opt-out were guarded only by
  the flakes they prevent, so a green run cleared nothing. Both are facts rather than
  flakes and are asserted as facts now.
- Two of this release's own fixes — the branch-scoped expansion measure and the sentinel's
  label surviving a re-attach — had no test that could tell the fix from its absence.
- A sixth turned up on the re-run, on one of the rows the first sweep had skipped: deleting
  the pagination chain's attach-time start left its section green, because the two-second
  heartbeat starts the chain instead. It asserts when the chain starts now — mutated, the
  gap measures 2007ms, which is the heartbeat interval to the millisecond.

That is the same shape as two of the defects above, which is why it is worth naming: a
test that watches an outcome two mechanisms can produce is not testing either one, and a
mutation row that restores an intermittent bug is not a regression guard. Both look like
coverage.

The sweep that found them was itself incomplete and said nothing: 122 results for 144
rows, exit 0. Twenty-two consecutive rows never ran, because the script was edited while
it was running — bash reads a script by byte offset, so the rewrite resumed it mid-token.
It counts its rows now and exits non-zero if it cannot account for every one, which
matters because the failure presents as a clean run. The re-run with the guard in place:
144 declared, 144 run, 143 caught, 1 survived — that one being the sixth hole above, on
rows nothing had ever executed.

### Not fixed, and named rather than left implied

Live testing also asked for a comment sort control, an `all N comments` header link, and a time
filter on the `top`/`controversial` tabs. All three are missing FEATURES rather than defects,
and each needs a Reddit control to delegate to that no capture has established; they are not
in this release. The reported thumbnail bleed past the row rule did not reproduce — the
geometry suite now checks float containment in every theme, at three widths, including a row
grown by a long title, and finds none.


## Unreleased — 0.12.1

### Added — the public face of the repository

Merged from the branch that was carrying it: `LICENSE` (GPL-3.0-or-later),
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue and pull-request
templates, extension icons at all four sizes (now referenced from `manifest.json`, which
previously declared none), theme screenshots and banners under `docs/assets/`, and
`docs/engineering-log.md` — the numbered bug list as a standalone public document.
Package metadata gained the licence, repository, homepage and keywords fields.

Only the additive half of that branch was taken. It was a full-repo snapshot at 0.10.2
with no shared history, so its copies of `src/`, `test/` and the working docs were two
releases stale; taking those would have reverted the round-10 and round-11 profile work.

### Fixed — the test suite leaked a live window per section

Ported from the same branch, which had diagnosed it properly. A jsdom window is not
garbage while its timers run, and every booted page left the paginator heartbeat, the
pipeline's observers and the gate's deadline running with nothing closing them — so the
later sections shared an event loop with every window before them, and the manual-drive
pagination tests failed roughly one run in six with `pages: 0` where 40 was asserted.
`boot()` now closes the previous section's window. This session had hit the same flake
and applied only the secondary measure (opting one section out of the auto chain), which
treated the symptom.

## Unreleased — 0.12.0

### Fixed — profile comment bodies dragged Reddit's indent along with them

Live testing confirmed profiles render on real users (24 of 24 and 33 of 33 comments on
two accounts) and settled the last piece of the contract: `.md` is the right body
selector. It also measured the trap that came with it — there are **two nested `.md`
nodes per comment**, 48 across 24 elements. The outer is a layout wrapper whose last
class happens to be `md`; the inner is the real markdown container. Document order
returns the wrapper, and the wrapper's other classes are Reddit's own indent utilities,
which Reddit's stylesheet still applies to anything Sheddit clones. Both nodes hold the
same text, so the words were always right and only the box was wrong: 22px of margin and
10px of padding belonging to Reddit's layout. The lookup now takes the innermost
candidate.

### Fixed — one unreadable comment could hand back a whole working profile

Not a report, but a risk the report exposed. Sheddit handed a profile back on
the FIRST comment it could not read, which was correct while the contract was a guess.
Live testing verified the contract, and separately watched a timestamp vanish from a row
after a back-navigation — restored elements are re-consumed while still hydrating. Under
the old rule, one element that was not ready yet would tear down a profile that had been
rendering perfectly a second earlier. The verdict is now total failure — Reddit sent
comments and none of them could be read — which still catches every way the contract can
be wrong, since those fail on all of them.

## Unreleased — 0.11.0

### Fixed — every live profile handed back, because only the tag was right

0.10.0 shipped profiles with `shreddit-profile-comment` as a guess and read it with
`shreddit-comment`'s attribute names. Live testing captured the real element on three
profiles: the tag was right, and it shares nothing else with a thread comment —
`comment-id` not `thingid`, `href` (already carrying `?context=3`) not `permalink`, and
no author, score, created or depth attribute at all, with no `[slot="comment"]` child.
Every profile therefore rejected and handed back, which was the fail-safe doing its job.
The model now reads the captured names and DERIVES what the element does not carry: the
author from the route (a profile's comments are its owner's by definition), the subreddit
from the href — which has two live shapes, one for a comment in a subreddit and one for a
comment on a profile POST — and no score at all, rather than inventing one. Still
uncaptured, and the reason a profile may yet hand back: where the element keeps its
rendered text. It is required, so a wrong guess there shows native Reddit rather than
rows with no words in them.

### Fixed — a page that arrived late was never counted, and the page cap became unreachable

Live testing, front page, tab verified visible: rows grew 28 → 203 across seven pages while
`pages` stayed at 0 and every one of 40 samples read `unproductive`. Both were true — a
load measures itself the moment its settle window closes, and the live feed delivers after
that. Live testing had recorded the phenomenon without following it to what it costs: the
40-page memory guard can never fire, and the unproductive counter never resets, so past
the second load every attempt refuses and the chain falls back to the 2-second heartbeat.
Content still arrived, which is why two rounds passed without anyone noticing. A load
whose content shows up late is now credited at the next attempt, when the evidence is
there.

### Not reproduced — horizontal scrolling at 500px

Live testing reported a horizontal scrollbar at 500px and named a hidden native
screen-reader node as the cause. That node is now in the fixture, faithfully: 747px wide,
in the captured ancestor chain, right edge well past the viewport — and the document does
not scroll horizontally at any width from 360 to 1920. The report's own numbers point the
same way (its `scrollWidth` was 746 while the node it blamed was 860). The untested band
it was found in — between 480 and 640 — is now measured at 500. No change made to the
suppression rule: it is load-bearing for accessibility, and changing it on an attribution
that does not reproduce is how the last accessibility bug shipped.

## Unreleased — 0.10.1

### Added — user profiles are in scope (project decision 2026-08-21)

`/user/<name>/` and its comments/submitted tabs render in the old-reddit layout: the
user's posts as ordinary listing rows (same element, same contract — verified by the
earlier profile capture), their comments as old reddit's flat profile rows — a "comment in
r/x" parent line, the cloned body, permalink / context / full-comments buttons, the last
two DERIVED from the permalink. Overview/comments/submitted tabs render in Sheddit's tab bar,
each classifying back to PROFILE (bug 10's rule). A `Restyle user profiles` toggle joins
the options page. Threads on profile posts (`/user/x/comments/<id>/…`) stay out —
that page shape has never been captured.

The honest caveat, stated as loudly as the feature: **the profile comment element has
never been captured live.** The pipeline queries both `shreddit-comment` and the
`shreddit-profile-comment` candidate, and the whole route runs under a new soft-failure
policy — any page it cannot fully read is handed back to native Reddit quietly (reason
stamped on `<html>` as `data-shd-soft-fail`, no error card, no partial page), because on
an unverified route the native page IS the correct fallback. One reject is the whole
verdict there: rendering the readable remainder would show a profile with most of its
content silently missing. `verify:live` gains a USER PROFILES section that captures the
real tag and its attributes; until it runs on a real machine, a live profile handing
back is the design working.

### Fixed — a profile comment element the pipeline does not query for went unnoticed

Same-day follow-up to the feature above, found while writing the round-10 brief. The
soft-failure policy had two doors and only watched one: a reject means an element the
pipeline QUERIED FOR had attributes it could not read, but if the real profile comment
tag is neither of the two the pipeline queries, nothing matches, nothing rejects, the
user's POSTS render happily and their comments are silently absent — a profile that
looks fine and is missing most of its content, which is exactly what the reject check
exists to prevent. A comment-shaped custom element in the feed that Sheddit neither
read nor contains now hands the page back like any other miss. Deliberately
conservative, because a false positive here hands back a page that works: custom
elements only, never furniture inside a post or a comment that was read, never a
wrapper around comments that were rendered — all three
exclusions pinned by their own counterweight test and mutation row. Residual, stated
plainly: a profile comment element whose tag does not contain "comment" is invisible to
this and would still render posts-only.

### Fixed — "no more pages" flashed between pages that then loaded fine

Reported live the day 0.9.0 shipped. The `exhausted` refusal set the label the instant
no drivable partial was found, but a driven partial's successor streams in LATE — on a
slow feed the inter-page gap is long enough for the auto chain to look, find nothing,
and announce an ending the next pump retracts. The auto path now commits to the label
only once the empty state persists (three consecutive empty looks, ~4–6s at the
heartbeat's cadence); a deliberate manual click still gets its answer immediately, and
the refusal is still published to the sentinel diagnostics on the first look — only the
user-facing label waits.

## 0.9.0

### Fixed — the unproductive limit lied about ending a chain it never ended

Live testing's front page, sampled live: the sentinel declared "no more pages" and retracted
it SIX times in one series while rows grew 28 → 178, and `pages` read 33 for roughly 7
productive loads. 0.8.0's "two duds means done" never actually ended anything — the
heartbeat retries two seconds later — and that accidental softness is what rescued a
throttled tab whose content landed after settle's window: loads counted "unproductive"
turned productive in arrears. The soft semantics are kept, and the dishonesty around them
is what changed: only productive loads consume the 40-page budget now (a throttled tab
was starving its own budget on loads that added nothing), and the at-limit refusal is
quiet — named `unproductive` in the diagnostics, label back at "load more". "no more
pages" is reserved for `exhausted`, where nothing is left to drive; a genuinely dead feed
still reaches it, because stamps deplete the pool.

### Verified in live testing, no code change

Video links: 6 of 6 JSON-carrying posts on r/aww resolved to mp4, every one picked the
maximum rendition, and the picked URL plays in a plain tab — live testing's `readyState: 0`
question is settled. The 40-page cap label reads "stopped after 40 pages" in the field.
The "N more replies" control works at every depth, and a 13,297-comment thread paginated
27 → 1,175 comments to the cap with zero guard misfires. The busy-wedge instrumentation
read two live wedges (8.6s, 9.2s) that self-cleared under the 12s limit — the backstop is
calibrated right; do not lower it. Also recorded: a HIDDEN tab throttles the whole chain
(~1.6 pages/min vs ~40 visible) and delegated clicks land only once the tab is
foregrounded — a testing hazard, not a product bug, but it manufactured live testing's early
"nested expanders are dead" read.

## 0.8.0

### Fixed — the feed spent all 40 page slots on hovercards

Live testing, front page: `pages: 40`, rows frozen at 28, sentinel still reading "load more".
The fallback selector `shreddit-feed faceplate-partial` also matches Reddit's HOVERCARD
partials — one per author and per subreddit link, nested inside the posts — so once the
real feed partial was spent, the chain drove hovercards until it hit the cap. Two guards,
because either alone hides the other: a partial nested inside an item is never drivable
on a listing (on a comments page it stays a preference, since a per-branch expander IS a
legitimate thing to drive), and a load that adds no new posts or comments counts toward a
limit and ends the chain honestly instead of burning the budget.

### Fixed — the page cap said nothing

At the 40-page ceiling the sentinel still read "load more", which is the label a
SUCCESSFUL load leaves behind: the pump checked the cap and returned before anything could
say so. Measured on a 2,040-comment thread and the front page both.

### Fixed — video links, properly this time

0.7.0 shipped `packaged-media-json` from a report rather than a capture, and live testing
captured it: the attribute is on a nested `<shreddit-player>`, not the post; it hydrates
LATE (1 of 4 posts had it at first paint); and the files are named `m2-res_<height>p.mp4`,
not `DASH_<n>` — so the old ranking scored every real URL zero and would have picked the
lowest quality available. The fixture had encoded the same three guesses, so it passed all
of them. Video titles now query the subtree, rank on the rendition height whatever the
naming, and re-resolve at click time so a player that hydrates late still upgrades the
link — while remaining an ordinary link for middle-click and copy-link.

### Fixed — the "N more replies" control ignored clicks

Two clicks in the field did nothing, and the label never changed to "loading…" — the
handler had not run, because the click landed on the list item rather than the anchor
inside it. The handler is on the list item now, and a native control that has gone by
click time says so instead of silently vanishing.

## 0.7.0

### Fixed — the chain runs on time, not on events (and closes the oldest open question)

Live testing closed open question 1: the top-level comment loader ANSWERS a logged-out session
— five pages, 25 → 115 top-level comments, correct nesting — but only after a click
started the chain, because in the field BOTH event wake-ups were dead: the
IntersectionObserver never fired once across three rounds, and a real scroll to the
bottom changed nothing. Timers, meanwhile, ran everything that did work. So the paginator
now carries a slow heartbeat — two seconds, geometry-gated like every other pump — as the
wake-up that cannot be taken away, with events kept as accelerators. The same tick
publishes live diagnostics — a frozen attach-time snapshot is indistinguishable from a
stalled chain without them — and runs the new busy watchdog: testing caught `busy` wedged
true for 60+ seconds at
page 5 with no refusal recorded, cause unknown — `shdBusyFor` now counts a wedge up live,
and past 12 seconds it is released and named (`busy-wedged`), one page lost instead of
the chain.

### Fixed — video posts were a closed loop

A video title linked to bare v.redd.it, which 302s a logged-out session straight back to
the post's comments page — which the extension renders, whose title links back to
v.redd.it. Measured on two posts; the video was unwatchable with the layout on. Titles
now point at the best mp4 from `packaged-media-json` (deep-scanned, highest DASH
rendition, every failure falling back to the old link). The attribute name is the one
contract taken from a report rather than a capture; `verify:live` gained the
section that confirms it on a video-heavy subreddit.

## 0.6.0

### Fixed — comment pagination, from "never worked live" to working machinery

Live testing's capture explained the round-5 measurement. Three layers, each with its own
fixture and mutation row:

- **The chain could not start.** The IntersectionObserver never delivered a single report
  in the field (`shdIoTicks: 0`) and it was the only wake-up the pump had. attach() now
  pumps once itself, geometry-gated, and a passive scroll listener pumps too. A new jsdom
  section runs the auto chain against an observer that never says anything at all — the
  measured live condition.
- **Document order beat placement.** The live tree: ~25 per-branch expanders first, ONE
  top-level continuation partial (`loading="lazy"`) last. The paginator now prefers the
  partial that is not inside any comment, and — because that preference is policy the main
  world cannot see — the chosen element itself now crosses the bridge, marked, instead of
  both worlds re-running the same selector and picking different nodes (which the fixture
  caught happening: one partial stamped, a different one driven).
- **Branch replies, delegated.** Live testing proved Reddit's own "N more replies" control
  works logged out and the pipeline renders what it loads. Comment rows now offer that
  control in Sheddit's layout, resolved at click time; and late replies nest under the branch
  that was expanded — consume() prefers the element's physical parent, because by then the
  depth-stack points at the newest chain, not the expanded branch.

Whether the top-level lazy partial answers loadContent() on a logged-out session is the
one remaining unknown, stated as such in docs/engineering-log.md's open questions.

### Fixed — faint body text on light themes (reported from real use)

Cloned selftext and comment bodies wear Reddit's own `.md` classes, Reddit's stylesheet
still matches them, and its text colour follows the HOST page's theme — `theme-dark`, so
near-white text landed on Sheddit's light palettes as barely legible grey. The palette's text
colour is now forced down the clone (links and quotes re-asserted after it), structural
`.md` styling untouched. The fixtures finally serve the known-leaking Reddit rules, so
this whole class of bug is testable: geometry computes the winning colour with a control
proving the hostile sheet was live.

### Fixed — the deadline drains the queue before accusing it

Two field cards read `stamped: 0` — a flush parked on a rAF a busy main thread never
delivered, blamed by a deadline that runs on recovery. gate.check() now kicks the pipeline
(a synchronous drain) and only fails if the queue truly had nothing.

## 0.5.0

### Fixed — an empty subreddit was told it was broken

Reddit serves some pages zero posts and renders its own "this community doesn't have any
posts yet" panel. That panel is real markup, and the check for "is this feed populated"
counted elements — so an empty community read as a feed full of content the extension had
failed to parse, and got the full-page failure screen. Observed live on a quarantined
subreddit, logged out, where Reddit serves a logged-out session no posts at all: an error
card at ~12 seconds over a page working exactly as intended. Putting the failure screen
over a page that is not broken is the specific mistake this module has made twice before.

The question is now whether the container holds LIST-shaped structure — three siblings
sharing a tag name — because a list of posts repeats and a message block does not. A feed
genuinely full of unrecognisable post markup still fails loudly, which `/r/renamed/`
pins; `/r/empty/` is the new fixture for the other side, built chunky on purpose so a
thin one could not pass the old check by accident.

### Noted — comment pagination has never worked on a large thread

Live testing, first live test: a thread claiming 4,987 comments served 25 top-level
comments and neither the extension's rows nor Reddit's own comment count moved across
eight real bottom-scrolls. A loader was present in the tree and never fired. Not fixed —
what drives the next page of top-level comments on modern Reddit is still unidentified,
and guessing at it is how the feed-pagination bug earned its second life. The capture that
would settle it is specified in docs/engineering-log.md's open questions; the manual load-more button is
the honest floor until then.

Live testing's traversal fix is confirmed: 0 error cards in 14 checks where the bug had been
9-for-9.

## 0.4.0

### Fixed — every browser back/forward dead-ended on the error card (live testing, 9/9)

The first field failure diagnosed entirely by its own error card: `sources: 3, stamped: 3,
rendered: 0` — every element processed, nothing built. Reddit REPLACES post elements on a
sort click (the measurement bug 34's no-unstamping rule was built on) but REUSES the very
nodes it removed on a history traversal, `data-shd` stamps and all — so after back or
forward, the sweep skipped every restored element as already-rendered while its render had
just been torn down. A stamp is a promise that the element's row exists; an element being
INSERTED with a stamp and no row is now un-stamped and queued, on the observer path only —
the onRoute sweep still skips stamped nodes unconditionally, because reviving the outgoing
page's posts at pre-commit is bug 34's mixed-sorts regression through a new door, and a
second mutation row pins the other guard: without the row-exists check, a merely
reparented element renders twice. The `/r/spa/` fixture now stashes and restores the same
nodes on traversals, and the packed extension drives the full back/back/forward loop.

Also from live testing: the in-page build fingerprint caught a *third* stale-build incident —
with the chrome://extensions card reading 0.3.0 while the running code was 0.1.0 — so the
behavioural probe, not the version card, is the accepted build check now. Selftext
rendering and the popups-never-take-the-layout policy got their first live confirmations.
The gated-sub observation (3 benign posts, no `nsfw` attributes, dead pagination) is
recorded under docs/engineering-log.md open question 6 rather than acted on.

## 0.3.0

### Changed — the 18+ gate is answered, not merely hidden

A deliberate policy choice: the extension now clicks Reddit's own "Yes, I'm Over 18"
button — invisibly, under a layout that never moves.
Answering beats hiding: Reddit clears its own scroll lock, remembers the preference, and
pagination serves an attested session, which retires most of the open question 0.2.0
filed. The wrong button navigates away, so the click is fail-safe by shape: it fires only
when exactly one button matches affirm-and-not-decline (`C.AGE_GATE`; the recorded trap
is a decline whose text contains "18", as in "No, I am under 18"), the host is stamped so
a no-op click never repeats, and anything ambiguous — a localized gate, A/B button copy —
falls back to 0.2.0's suppression, which is also the path that keeps the CSS overflow
backstop under test. jsdom drives the adversarial button sets; the packed extension
drives a real click and asserts the fixture recorded the affirmative, not the decline.

Still unverified live: that the real gate's current button copy matches the affirm split
at all. The fixture encodes the 2026-08-18 captured English text; one visit to a real
NSFW sub on 0.3.0 confirms the click lands (the gate simply never appears again for that
profile afterwards — Reddit remembers).


### Changed — popups never take the layout (policy reversal, project decision)

The extension now **suppresses every Reddit popup** instead of standing aside for it: age
gates, NSFW interstitials, cookie/privacy prompts, login upsells. The layout stays up, the
overlay stays hidden underneath it (suppress.css already hides the body children modals
live in), and the `rpl-scroll-lock` they set is stripped — with an `overflow: visible`
backstop for the inline-style form — so the page keeps scrolling. The defer machinery
(stand aside so the user can answer, debounce so transient overlays cost nothing, three
redundant paths to un-stick the flag — the fixes for bugs 30, 33 and 38) is deleted, and
four mutation rows protecting it retire with it, replaced by four protecting the new
policy.

What makes this safe rather than reckless: the 18+ gate is a modal over a **populated**
feed (verified live) — the content is already in the browser, and rendering it is the one
thing this extension exists to do. The gate is never answered on the user's behalf, no
preference is written anywhere, and unknown modal DOM is hidden rather than deleted.
Unhandled routes still keep their modals and locks untouched. The open edge — whether
pagination works on a sub whose gate was never answered — is recorded as an open question
rather than assumed.

### Noted — the 2026-08-20 live testing tested a 2026-08-14 build

Every finding in the round-3 report reproduces a bug fixed between 08-16 and 08-20: the
missing NSFW tile (shipped 08-18), the missing selftext and error-card lines (shipped
08-20), the one-navigation-apart sort tabs (bug 34, fixed 08-16), the intermittent
render-failed under automation (bug 35, fixed 08-16), and the stuck modern layout (bug 38,
fixed 08-16). The build dated itself: the console cited `gate.js:416` (matches the
2026-08-14 tree, not any later one), the rank column measured 26px (widened to 36px on
08-18), and the tester's dump of a failing load shows a post element with no `data-shd`
marker: a reload re-reads the same directory, and the directory had not been updated.
Hence the version-per-push rule above.

### Fixed — from the 2026-08-20 live testing (Superstonk comments page)

- **A text post's comments page never rendered the post's own text** — never worked. The
  row builder reads attributes, and post content is not an attribute: it is slotted light
  DOM (`div[slot="text-body"]` holding Reddit's rendered `.md`), so the submission came out
  as title, tagline and buttons with no body. Reported as "comments fine, post content
  missing". The body is cloned now, the same way comment bodies are — links, code blocks
  and quotes intact, no markdown re-parsing — into old reddit's measured selftext box
  (`#fafafa`, accent border, radius 7, from `OLD-REDDIT.md`).
- **The failure card can now tell a stale contract from a renderer that never ran.** The
  report's card read `sources: 26, rendered: 0, errors: 0`, which was consistent with two
  opposite causes — every element processed-and-rejected (edit contracts.js) or the render
  queue never draining (reload; bug 35's family) — and its one explanation blamed markup
  regardless, sending the report chasing renames its own attribute dump disproved. The
  card now prints `stamped:` (how many sources the renderer actually processed; 0 means
  the queue never ran), a `rejected:` tally naming the missing attribute per kind (the
  model records why each null happened instead of discarding it), and an explanation that
  branches on the fork.
- **The report's central diagnosis — one unbuildable post zeroes out the whole thread —
  is architecturally impossible, and is now pinned by a test** plus a mutation row that
  reintroduces exactly the claimed short-circuit. Rebuilt from the report's own attribute
  dump: `model.post()` succeeds on that element, gallery type and all, so the live failure
  was not the post builder.

### Changed — measured against old.reddit while it was still up

old.reddit.com answered again on 2026-08-18 after a long unreachable spell, which reads as a
phased retirement rather than a reprieve. The window was used to harvest computed styles from
both layouts and diff them; the measurements are recorded verbatim in **`OLD-REDDIT.md`**,
which is now the spec for what this extension imitates and cannot be captured again.

Nine departures closed, all in `classic` (the other four palettes are deliberate designs, not
fidelity targets, and keep their own values):

- **The per-comment action row is one grey again.** A single override painted the `comments`
  link accent blue, so every row read as a line of links competing with its own title instead
  of receding under it. Measured as the most noticeable per-row difference from the real thing.
- **The comment thread line moved to `.child`.** It was a border on `.thing.comment` —
  bracketing the comment you are reading rather than running beside the replies to it — and
  it was blue-tinted on old reddit, not neutral grey.
- **Comment indent is 25px per level, down from 31px.** The 22px gutter reserving space for
  the absolutely-positioned vote arrows was padding on `.thing.comment`, which every nested
  level inherited and added again, so the arrow column was paid for once per level of depth.
  Old reddit avoids this by floating its midcol; ours now spends the gutter on `.entry`.
- **Comment vote arrows are visible at rest.** They were hidden until `:hover`, justified in
  a code comment as old reddit's behaviour. It is not: old reddit paints them at rest.
- **Thumbnails are bare 70x70 squares**, not 70x52 bordered grey boxes — the height alone had
  changed the vertical rhythm of the whole list. The tile treatment is kept for the `self` /
  `link` / `nsfw` placeholders, which are generated content and have nothing behind them.
- **The header is old reddit's pale blue** (`#cee3f8` on `#5f99cf`) rather than grey. The grey
  it had been using is the colour of a *different* old reddit element, the `#sr-header-area`
  strip, which this extension does not render.
- **Sort tabs are bordered white folder-tabs with orangered text.** They were flat blue pills,
  which inverts the metaphor: old reddit draws every tab the same and lets only the **bottom**
  border mark the selected one.
- **The right rail is an unboxed column.** `.side` on old reddit is transparent with no border
  or padding; the widgets inside it carry their own edges.
- **Rank and score use old reddit's lighter `#c6c6c6`**, which is what puts them below the
  tagline in the hierarchy instead of level with it, and the rank is set in 16px Arial. The
  column arithmetic was rewidened to fit the larger type (`--shd-arrow` is now `--shd-dim`,
  since it colours all three).

Rejected, and recorded in `OLD-REDDIT.md` so it is not re-proposed: setting `body` to old
reddit's 10px root, ranked first in the source report on the theory that downstream sizes
would follow. They would not — old reddit sizes in **ems** off that root, this stylesheet
sizes in absolute px almost everywhere, and the report's own table shows those values already
match. Changing it would have fixed nothing downstream and shrunk the few things that inherit.

### Fixed — tests that were not testing anything

- **Three mutation rows had gone dead.** `ANCHOR MISS` is printed but counts as neither a pass
  nor a failure, so a row whose anchor stopped matching is indistinguishable from a quiet one.
  One was broken by the `showNsfwThumbnails` field added in the previous commit — **the row
  you break is rarely the row for the code you edited** — one had rotted when a `return false`
  became `refuse('cooldown')`, and one matched twice (`fail()` and `release()`) and was
  testing the right call site only because `apply()` replaces the first occurrence. All three
  catch again, and the local notes now carry the dry-run recipe.
- **The comment-arrow visibility assertion hovered before checking**, so it passed whether or
  not the hover gate existed. It reads visibility at rest now, with the hover case kept as a
  counterweight.
- **The indent assertion checked only that the step was uniform** — and 31px was perfectly
  uniform. It is pinned to old reddit's 25px, with static checks that the thread line is on
  `.child` and is *not* on `.thing.comment`.
- **The score-column width check was a bare `>= 34`**, chosen when the score was 11px. Moving
  it to old reddit's 13px would have kept the check green while the score wrapped again. It is
  derived from the declared font-size now — the same failure shape as the hand-maintained
  token list fixed in the previous release.

### Fixed — things that never worked in a shipped copy

- **Infinite scroll on the feed.** `faceplate-partial` is a custom element defined by
  Reddit's own JavaScript, so its `loadContent()` does not exist in a content script's
  isolated world. `paginator.js` checked for the method, did not find it, and returned
  false silently — the feed dead-ended at 3 posts in every installed copy. It worked
  throughout development only because the dev harness is pasted into DevTools, which runs
  in the page's main world. Fixed with `src/core/bridge.js`, a `"world": "MAIN"` content
  script that is now the only sanctioned crossing.
- **Comment threads past the first delivered slice.** The paginator's selector was
  hardcoded to `shreddit-feed` and `pipeline.js` attached a sentinel only on listings, so a
  thread rendered whatever arrived in the initial HTML and the rest was unreachable — on
  the page type a reading-focused extension exists to serve. `paginator.useMode(route)` now
  picks the feed or comment-tree partial.
- **The reply escape hatch**, for two independent reasons. It tagged the
  `<shreddit-comment>` while the suppression clip lives on the `<body>` child seven levels
  up, *and* a class-only rule cannot outrank a selector carrying three `:not(#id)` clauses.
  `SHD.dom.passthrough()` now walks to the body child, hides siblings along the path, and
  is excluded from the suppression selector rather than fighting it.
- **Options page changes.** Settings were read once at boot, so toggling anything appeared
  to do nothing until a page reload. `chrome.storage.onChanged` now re-runs the route.

### Fixed — the 2026-08-16 live stall

- **Infinite scroll dead-ended after a handful of pages, showing a success message.** The
  chain continued on `visible`, the IntersectionObserver's last word — but `attach()` runs
  after every flush and `detach()` resets `visible` to `false`, so each successful load
  ended by discarding the fact its own continuation depends on and waiting to be told
  again. An observer only reports *changes*; a reader already at the bottom of the document
  produces none, so the correction never came. Measured live off the sentinel's own
  diagnostics: five pages in, sentinel 80 px **above** the fold, 22 undriven partials left,
  `shdVisible: false`, and `shdSinceLast` frozen at 2004 ms across two readings ten seconds
  apart — the paginator had not run since its last *success*. The sentinel read `load more`,
  the label a successful load leaves behind, so nothing on screen indicated a problem. The
  gate is geometry now, measured at decision time, and the observer is demoted to a wake-up
  that pumps on any report rather than only an intersecting one.
- **The auto-pagination chain had no jsdom coverage at all** — jsdom's `IntersectionObserver`
  is a stub that never fires, so every jsdom pagination test drove `loadNext('manual')`
  directly and the self-sustaining path was exercised only in Chromium, where it happened to
  work. A stub that reports once and then goes silent — the live symptom exactly — now
  covers it, with a control asserting the stub really was re-observed, since one that never
  delivered at all would produce the same green.

### Fixed — live testing 2026-08-18 (r/UkraineWarVideoReport, logged out)

- **Graphic imagery that Reddit itself had blurred was shown unblurred.** Reddit blurs NSFW
  thumbnails in its own feed for logged-out readers, but that blur belongs to *its* markup —
  Sheddit lifts the image URL off the post and renders its own `<img>`, so it was simply bypassed.
  On a graphic war-footage subreddit that is not a cosmetic difference. Adult posts now get
  old reddit's placeholder tile and its `nsfw` stamp, with `showNsfwThumbnails` as the same
  opt-in old reddit offered; the stamp shows either way, because it labels the post rather
  than substituting for the picture. The attribute that carries the flag is **not yet
  confirmed against live Reddit** — `C.NSFW_ATTRS` names the plausible spellings and treats
  any of them as authoritative, which fails safe if none is real (adult posts render as they
  did before) and loudly if one were universal (every thumbnail becomes a placeholder).
- **Screen readers read every page twice.** The suppression rule was the textbook
  "visually hidden" recipe — absolute, 1px, clipped, transparent — which is what you write
  when you *want* assistive technology to keep reading something. The whole native page
  therefore stayed in the accessibility tree and in find-in-page. Reported concretely: a
  page-text extraction returned a native `<article>` with `u/username • 2 days ago` that
  appears nowhere in the rendered list. `visibility: hidden` removes the subtree from the
  accessibility tree per spec while keeping it in the DOM and still dispatching a
  programmatic `.click()`, so vote delegation and comment-body cloning are unaffected.
- **No fixture could have caught that**, because the fixture's `shreddit-post` carried no
  text at all — nothing distinguished a suppression that hides from everyone from one that
  hides from sighted users only. It now emits Reddit's own rendered copy, and the assertion
  reads Chrome's real accessibility tree rather than the computed style.
- **A theme could silently omit a colour token.** css-lint's required-token list was
  hand-maintained, so only tokens someone had remembered to add were guarded — every token
  introduced later was unprotected, and a theme inheriting classic's colour on a dark
  palette is the exact failure that check exists to prevent. Found by walking into it while
  adding `--shd-nsfw`. The list is derived from the base palette now, with an explicit
  exemption for the design tokens a theme may inherit.

### Fixed — behaviour

- **Slow pages were disabled permanently.** A flat 1500 ms deadline from `document_start`
  measured connection speed, not correctness; Reddit streams its HTML. With the posts
  stalled 1600 ms the extension gave up on a page that rendered fine 400 ms later. The
  deadline is now content-aware: posts present and nothing rendered is a Sheddit bug, no posts
  yet means the page has not arrived.
- **Failure is now visible.** A failure used to remove the suppression CSS and hand back
  modern Reddit, which is indistinguishable from the extension not being installed and
  reads as an unrelated Reddit bug. A failure now renders `#shd-error` naming the reason,
  the file to edit if it is a redesign, and diagnostics for a bug report. Native Reddit
  stays hidden until the user presses **Show Reddit's own layout**.
- **Age gates and private communities are no longer blanked for 12 s and then blamed.** A
  page with no feed container at all is not a page Sheddit renders: the blackout clears off
  `load` (measured 25–52 ms) and native Reddit is left alone, rather than an error screen
  appearing over the button the user has to press.
- **An SPA navigation onto an unrenderable page left a permanently blank screen.**
  `revealed` latched true, so the deadline check returned early forever while `onRoute()`
  removed Sheddit's root with native Reddit still suppressed.
- **The sidebar vanished after the first client-side navigation, and the header kept naming
  the previous subreddit.** The chrome was rebuilt only under `!gate.revealed`, which
  latches for the life of the page.
- **Turning a feature off produced a blank page.** `standDown()` dropped `shd-gate` but not
  `shd-active`, so suppression stayed with nothing over it. Only reachable once settings
  applied live.
- **Every page load wasted 6 s.** `settle()` attached its MutationObserver *after*
  triggering the load, so a partial that appends synchronously produced nothing to observe
  and each page waited out the full ceiling.
- **Infinite scroll stalled after exactly one page.** `IntersectionObserver` reports only
  changes, and re-observing after every flush meant the single callback landed inside the
  800 ms cooldown and was dropped. `pump()` re-arms after each successful load.
- **A deliberate "load more" click was swallowed by the cooldown.** Automatic triggers back
  off; a click does not.
- **A sort tab shipped that routed out of the extension.** `controversial` was offered on
  the front page while `classify()` accepted it only under `/r/x/`. `route.js` now owns the
  sort list and `chrome.js` reads it.
- **Vote delegation could not see into shadow roots**, and logged a permanent break
  identically to a pre-hydration miss. `SHD.dom.deepQuery()` pierces open shadow roots; a
  miss warns once with the evidence to tell the two apart.

### Fixed — the 2026-08-14 live run

- **A comment could have rendered its child's text.** Reddit nests comments now, so a
  comment's subtree contains its descendants' bodies;
  `el.querySelector('[slot="comment"]')` returned the right one only because Reddit emits
  the body before the child container. Reverse that ordering and every comment shows its
  first child's text. Now scoped to the comment itself. Every fixture was flat, so nothing
  could have caught this — `nestedCommentsHtml()` reproduces the live shape in both
  orderings.
- **An age gate that ships an empty feed was blanked and then blamed.** `gate.js` asked only
  whether a feed container existed, so `<shreddit-feed></shreddit-feed>` read as "Reddit gave
  Sheddit somewhere to put posts and rendered none" — the signature of a redesign. Measured
  against the packed extension: the page never un-blanked and the error screen landed on top
  of the "Yes, I am over 18" button, which is the one thing it must never do. The question is
  now asked in two steps — no container, or a container holding nothing, both mean stand
  aside; only a container full of markup that cannot be read still fails. The same fix covers a
  page needing no interstitial at all: a subreddit with no posts in it, which the old branch
  claimed in its own comment to handle and did not. Whether Reddit's real 18+ page has the
  feed shell is still unverified, so both shapes are fixtures.
- **Crossposts lost their thumbnail.** `b.thumbs.redditmedia.com` is Reddit's
  post-thumbnail CDN and the host allowlist rejected it along with the `styles.`/`emoji.`
  decoys responsible for the original false-positive bug. Added — the allowlist is still an
  allowlist, deliberately not relaxed to `*.redditmedia.com`.
- **`crosspost` is a real `post-type`** and now has a fixture.
- **A thread could have expanded one branch for ever and reached none of the others.** The
  paginator asks its selector for a partial and calls `loadContent()`, over and over — which
  advances only because the *feed's* partial replaces itself with the next slice. Comments
  were assumed to behave the same way. The live tree has ten partials, none of them
  `loading="programmatic"`, labelled "16 more replies" and "continue this thread": that is one
  per truncated branch, and nothing says driving one removes it. If it does not, every
  iteration re-picks the same element — the same replies render again and again while the rest
  of the thread stays unreachable. Driven partials are now stamped and excluded from the
  selector, which is right under either mechanism. Both existing pagers removed themselves, so
  no fixture could tell advancing from spinning; `commentsPage({branchPager:true})` models one
  that survives.
- **A comment load reported success before any comment had arrived.** `settle()` watched
  `shreddit-feed` unconditionally and a comments page has none, so it hit the "no container"
  early return and resolved immediately — clearing `busy` and freeing the pump to fire the
  next page into a load still in flight. It watches the route's container now. Every fixture
  appended synchronously, so there had never been anything to wait for; the comment pager
  delivers on a later tick to match a real partial's network round trip.

### Fixed — the 2026-08-15 independent review

An independent code review, given only the source of `gate.js`/`route.js`/`pipeline.js`,
live-tested its findings on real Reddit in Chrome 151 before reporting. Two were confirmed
by direct reproduction; the rest were traced through every path. All six are fixed, each
with tests and mutation rows.

- **Sort tabs desynced the page from the URL — and it was one bug, not two.** The
  Navigation API's `navigate` event fires *before* the URL commits, and `route.js` read
  `location` from a microtask queued inside it — still the old URL — then latched that
  stale path as "seen", so the real navigation never produced a second emit. Every sort
  click was either swallowed (URL moves, content stays, new rows appended under stale
  ones) or handled one navigation late (content moves, URL doesn't), alternating — exactly
  the two flavours testing on Windows reported. The truncated "6 posts, no more pages"
  list was a knock-on: posts consumed during the swallowed window were stamped, then the
  late teardown discarded their rows and the stamps made them unrenderable. Reproduced
  live click-by-click, then fixed: emit the **destination** path pre-commit, latch only on
  emit, with `navigatesuccess`/`popstate` as post-commit safety nets.
- **A page opened in a background tab always showed the error screen.** Rendering was
  scheduled with `requestAnimationFrame`, which does not fire in a hidden tab — while the
  failure deadline is a `setTimeout`, which does. Middle-click a link, restore a session,
  or open a tab from another app, and the extension declared itself broken before you ever
  looked, then latched that way. Found by testing's first live tab; the giveaway was
  zero `data-shd` stamps beside three delivered posts — the render queue never ran at all.
  Hidden tabs now flush on a timeout (DOM work is not throttled, only painting), and a
  `visibilitychange` re-arm rescues a flush parked on a dead rAF.
- **The failure deadline could accuse a renderer that had not started.** The gate arms at
  `document_start`; the pipeline boots at `document_idle` and then awaits
  `chrome.storage.sync`. Lose that race and "sources present, nothing rendered" was called
  `render-failed` — including on user profiles, which carry `shreddit-post` elements but
  are routes Sheddit hands back, producing a flash of an error screen that then removed itself.
  The pipeline now tells the gate when it takes a route; before that, the deadline
  un-blanks and waits, and only a full 12 s with no pipeline is called what it is:
  `pipeline-stalled`.
- **The login-wall removal ran on pages Sheddit promised not to touch.** Standing down from a
  route (search, profiles, a toggled-off listing) left the modal machinery's observers
  live, deleting Reddit's upsell and its scroll lock on pages where the extension claims
  to be absent. The destructive half is now gated on the same "did this route get taken"
  flag; the read-only defer half still runs everywhere, deliberately.
- **Defer state could stick forever and quietly unstyle the page.** A modal that closed
  while the extension was in its failed state was never observed (the sync short-circuits
  on `stopped()`), so `deferred` survived into the next route, where `reveal()` silently
  withheld `.shd-active` — layout built but unstyled, native Reddit showing through, no
  error screen because nothing had failed. Teardown paths now clear defer state, and a
  route change re-derives it from the DOM instead of carrying the old page's flag.
- **A late `shreddit-app` orphaned the upsell watcher.** If the app element was not in the
  DOM when the observers attached, the fallback latched onto `body` permanently, and an
  upsell later portalled into the app arrived in a node nobody watched. The fallback now
  hands over to the app the moment it appears.

Two review recommendations were deliberately **not** taken, with the reasoning recorded:
un-stamping consumed posts on route change (harmful now that teardown runs pre-commit —
it would re-render the outgoing sort; a mutation row proves the suite catches anyone
adding it), and replacing the modal debounce with identity-based deferral (right shape,
but it needs a measurement of real scroll-lock durations that nobody has).

### Fixed — the 18+ gate

- **Sheddit hid Reddit's age gate and showed the content underneath it.** Captured live from
  a real NSFW subreddit, logged out: the 18+ interstitial does not replace the feed, it covers
  it. The feed, its 239 descendants and 3 posts are present the whole time, so the extension
  renders them and reveals — and `suppress.css` then hides every body child, including the
  `shreddit-app` the modal lives inside. Measured against the packed extension: the dialog
  reported `visible=false` and the point where "Yes, I'm Over 18" had been hit was Sheddit's own markup.
  Both existing interstitial fixtures encoded the same wrong assumption — that a gate replaces
  content — so neither could have caught it.

  Sheddit now stands aside while any Reddit modal is up, keyed on `body.rpl-scroll-lock`, and
  takes the page back when it clears. You answer Reddit's own age check exactly as you would
  with the extension uninstalled. Nothing else was usable as a signal: `shreddit-app` gets
  neither `aria-hidden` nor `inert`, and `role="dialog"` matched ten hovercards and tooltips
  on the live page without matching the gate.

### Fixed — Reddit's login wall

- **Sheddit would have trapped you behind a signup wall it could not close.** Reddit shows a
  login upsell (`desktop_auth_blocking_upsell`) roughly 30 seconds after page load, on a
  timer, with no scrolling or interaction needed to trigger it. It sets the same
  `body.rpl-scroll-lock` the 18+ age gate does — and the age-gate fix above says to stand
  aside whenever that class appears, hiding Sheddit's layout so you can answer Reddit's own dialog.

  That is exactly wrong here. Unlike the age gate, this one has **no close button**, ignores
  Escape, and ignores clicks on its own dim overlay. Standing aside would have left a
  logged-out reader looking at native Reddit with an unremovable "Get Started" wall over it
  and no way back — strictly worse than not having the extension installed. This one specific,
  verified case is now removed outright. Every other Reddit modal is still deferred to, since
  an unknown one may be something you genuinely have to deal with.

  Two details that make it work: the visible dialog is a *portaled sibling* of the component
  that owns it, so hiding the host alone does nothing — both nodes have to go. And because it
  arrives asynchronously, insertion is watched as well as the class, so the order Reddit
  happens to do those two things in cannot strand the extension.

### Fixed — being thrown out of the layout

- **Sheddit periodically dumped you back into modern Reddit to look at a popup, then handed
  the layout back a few seconds later on its own.** Reported from real use, and it was the
  age-gate fix overreaching. Reddit sets `body.rpl-scroll-lock` for *every* overlay its design
  system raises, not just modals you have to answer — and Sheddit stood aside the instant that
  class appeared. Self-dismissing popups therefore cost a full round trip out of the layout
  you installed the extension for, with no input from you at either end.

  Standing aside now waits half a second and only proceeds if the overlay is *still* there. An
  age gate is up until you click it, so it behaves exactly as before. A popup that dismisses
  itself is gone before the timer fires, and you never see a swap at all. Coming back is not
  delayed — that is always safe and always wanted.

### Fixed — layout

Both found by `test/geometry.js` on its first run; neither was visible to jsdom or to the
static CSS lint.

- **Rows beside the sidebar were 18 px narrower than rows below it.** A float intrudes by
  its *margin* box (338 px) and the content column reserved 320 px. Both sides now derive
  from `--shd-gutter`.
- **The comment `[–]` toggle sat under the hover-revealed vote arrows**, which also covered
  the author name. The toggle moved inline to the head of the tagline, which is where old
  reddit puts it.
- **The per-comment button row could overflow a narrow screen.** Reported live: 11px of
  horizontal overflow on the comments page at 360px. `.flat-list.buttons` (and, it turned
  out, the header and sort tabs) is `display: flex` with no `flex-wrap`, which defaults to
  `nowrap` — the row is laid out on one line regardless of how much content it holds. It had
  passed every CI run because this stylesheet asks for Verdana and the container running the
  suite has no Verdana installed, so the narrower fallback font happened to fit where the
  real one did not. All three flex rows now wrap, and `test/css-lint.js` checks it
  statically, so it no longer depends on which fonts happen to be present.

### Changed

- **Scoped to logged-out reading.** `save` and `report` were removed: both need a session,
  and both shipped as links to the permalink, so they looked like actions and silently
  navigated instead. Old reddit did not show them logged out either.
- **`pruneAfterRender` removed.** It was documented as the mitigation for memory growth on
  infinite scroll and its implementation was an empty callback. It also cannot work as
  specified — delegation resolves native controls out of the source subtree at click time,
  so detaching rendered posts breaks voting on everything scrolled past. The workable
  alternative (drop whole rendered rows) is documented in `contracts.js`.
- **`award-icon-url` and `is-link-post` mappings removed.** Neither was present on every
  post any more and neither was read anywhere downstream.

### Developer experience

- **A browser is now found automatically.** `resolveChrome()` checked Playwright's install
  dir and puppeteer's own download but not `/Applications/Google Chrome.app` — so
  `npm run verify:live` failed on an ordinary Mac with Chrome installed, twice, until
  `SHEDDIT_CHROME` was typed by hand. Ordinary macOS and Linux install paths are now in the
  search, after the provisioned builds so CI stays deterministic. When nothing is found the
  message lists every path it tried and the two ways to fix it, instead of just "not found".

### Added

- **Themes — five of them, switched from buttons in Sheddit's own header.** The old-reddit
  palette is faithful but bright, and there was no dark option at all: `classic` (as it
  was), `slate` (softened greys, system font, roomier rows), `sepia` (warm paper, serif),
  `night` (dark, low contrast) and `carbon` (near-black, monospaced, dense). Stored as
  `settings.theme`, so it follows you across tabs and reloads, with a dropdown in the
  options page for when the header is turned off.

  Three things this deliberately is *not*. It is **not a re-render**: a theme is custom
  properties on `<html>`, so switching one repaints in place rather than rebuilding
  `#shd-root` — on a feed the paginator has loaded forty pages into, a rebuild would send
  the reader back to the top. It is **not layout**: `themes.css` declares values only, and
  css-lint rejects any theme that names the sidebar arithmetic, so the geometry that took
  two bugs to get right holds for all five (asserted at 360px and 1280px, per theme). And
  it is **not applied late**: `themes.js` runs at `document_start` and colours the
  pre-render blackout, because a dark theme that arrives at `document_idle` opens on a
  white flash — the exact brightness the theme was chosen to avoid.

  Two traps worth recording. The palette selector has to carry `.shd-active` *and* the
  attribute: old-reddit.css declares the same token names under `html.shd-active`, the
  packed extension loads `themes.css` first and `old-reddit.css` second, and on a
  specificity tie the base would win — while the dev bundle, one `<style>` with themes
  last, would show it working. That is the pagination bug's shape exactly, so its mutation
  row runs against the packed extension. And the `self`/`link` thumbnail placeholders were
  data-URI SVGs with `#888` baked into the markup: unthemeable by construction, invisible
  on a dark background. They are generated content now.
- **`test/geometry.js`** — real `getBoundingClientRect()` in headless Chromium. jsdom does
  no layout, so the suite could prove the DOM correct while the page rendered wrong.
- **`test/extension.js`** — loads the repo as a real unpacked extension and drives it, so
  the manifest itself is exercised: match patterns, the `document_start`/`document_idle`
  split, script order, stylesheet delivery. This is the only suite that can see the
  isolated world, and it is what caught the pagination bug above.
- **`test/mutate.sh`** — reintroduces 121 bugs this codebase actually shipped and reports
  whether the suite that should notice does. Runs on a throwaway copy; the working tree is
  never touched.
- **`test/live-contracts.js`** (`npm run verify:live`) — re-verifies `contracts.js` against
  real reddit.com and reports how a thread's remaining comments arrive. Not part of
  `npm test`; needs a real network.
- **CI** — full suite on every push with `SHEDDIT_REQUIRE_BROWSER=1` so a missing Chromium
  fails rather than silently skipping half the assertions, plus a nightly mutation sweep.
- **Options page coverage**, including the invariant that its `DEFAULTS` match
  `contracts.js` — those had already drifted once.

### Resolved

- **Comments being DOM-nested turned out to be a non-event.** It looked like it invalidated
  the premise of `comments.js` entirely. Measured: DOM ancestor-comment count equals the
  `depth` attribute on 25/25, and no comment directly parents another. Reading the tree from
  `depth` rather than DOM shape — the original design decision — is what made the change
  free. It did surface the body-lookup bug above.

### Verified

- **The staircase-indentation report does not reproduce.** Measured directly: 7 rows × 10
  viewport widths from 360–1920 px give an identical left offset with zero horizontal
  overflow; comment indentation is a uniform 31 px per depth. Now a standing assertion
  rather than folklore.
- **The packed extension works end to end** — previously listed as a known gap.
- **Comment continuation uses the same mechanism as the feed.** Built from an untested
  assumption, then confirmed on the first live thread `verify:live` saw: 88 declared
  comments, 25 delivered, a `faceplate-partial` inside `shreddit-comment-tree` exposing the
  same `loadContent()`. What that run *also* showed — ten of them, none programmatic — is
  under Fixed above and Known problems below.

### Known problems

- **Voting does not work logged out**, and this is now confirmed rather than assumed: 21
  open shadow roots searched under a live post, no upvote control present. Consistent with
  the logged-out scope; the arrows are decorative for the primary case. Whether a
  logged-in session exposes the control is still unchecked.
- **What a comment-tree partial means is still unmeasured** — "expand this branch" or "load
  the next page". Ten in one live tree, none `loading="programmatic"`, labelled per-branch.
  The code no longer depends on the answer (see Fixed above) and `verify:live` is instrumented
  to produce it, but that has to run from an ordinary machine: Reddit answers a datacenter IP
  with a bot-mitigation shim in place of the feed, so no container or CI runner can settle it.
  A knock-on: `C.COMMENT_PARTIAL`'s `loading="programmatic"` clause matches nothing live, and
  comment pagination has only ever worked through the broader fallback selector.
- **`gate.js`'s deadline is untuned against a slow real page** beyond the synthetic
  stall tests.
- Real NSFW interstitials, quarantine notices and rate-limit pages have never been seen by
  the suite — only a hand-written stand-in.

---

## 0.1.0 — 2026-08-12

Initial implementation. Reads the post record from `<shreddit-post>`'s light-DOM
attributes, renders old-reddit markup, and hides the native tree — rather than trying to
restyle a DOM whose components sit behind shadow roots. Feed, subreddit listings, comment
pages, header, tab bar, right sidebar. `contracts.js` as the single point of breakage for a
Reddit redesign.

Shipped with five bugs already found and fixed during development (thumbnail false
positives from a loose image-host match, a suppression rule that hid Sheddit's own root,
comment depth-stack placement, uncontained floats, and a score column too narrow for five
digits) — and with the pagination, comment-continuation and reply-handoff bugs listed
above, none of which any test could see yet.
