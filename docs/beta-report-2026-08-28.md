# Beta report — 0.25.0, 2026-08-28

A full beta round of the packed Chrome extension (`manifest.json` version 0.25.0), run in
a clean Chromium 139 (Playwright build) on Linux. Reddit pages were served from the
project's own fixture server on a real `www.reddit.com` origin via
`--host-resolver-rules`, exactly as `test/extension.js` does — this container is a
datacenter IP, and live reddit.com serves it the documented bot-mitigation shim
(confirmed again this run: an 8,393-byte spinner page in place of the feed), so live
contract verification still needs a residential connection.

## Result in one line

**No functional regressions found.** The automated baseline is green, every item on
TESTING.md's manual checklist that can be exercised without live Reddit passes in the
real packed extension, and both 0.25.0 headline fixes hold up under hand-driving.

## Automated baseline

`npm test` — all suites pass, exit 0:

| Suite | Result |
|---|---|
| css-lint | pass |
| run (jsdom) | pass |
| geometry (Chromium) | pass |
| extension (packed, Chromium) | 135 passed, 0 failed |
| extension-firefox | SKIP — no Firefox in this environment |
| media-sync | 8 passed, 0 failed |

## Hands-on round (packed extension, fixture-served reddit.com origin)

Driven with puppeteer against the real unpacked extension — isolated world, manifest
`run_at` split, real CSS delivery order — with screenshots at each step. ~45 checks, all
passing after two driver-side mistakes were corrected (noted at the end for honesty):

- **Listing**: 11/11 rows render, ranks sequential, rows unique by `data-fullname`,
  header/tabs/sidebar/sentinel present, native `shreddit-app` suppressed. `self`,
  `link` and `nsfw` placeholder tiles all correct; a long-titled row grows past 72px
  without overflow.
- **Themes**: all five buttons present; each click repaints without re-rendering (the
  marked row node stays connected, row x-offsets identical across all five palettes);
  the choice follows to a new tab via `chrome.storage.sync`; changing the theme from
  the options page repaints an already-open tab live.
- **Comments**: 24 comments, depth-indented with guide lines, sort menu and
  `all N comments` link present; `[–]` collapses and re-expands.
- **Expando (0.25.0 fix)**: `[+]` opens the picture under the row, and `[-]` genuinely
  removes it — box `hidden` and `display:none`, row height restored. Verified in the
  packed extension, where the bug originally lived.
- **Streamed heavy page (0.25.0 fix)**: on the `/r/slowstream/` fixture (closing tags
  held 2.6s past the watchdog tick), the page-world class recorder shows the blackout
  held from t=0 to t=2588ms and the layout live at t=2609ms — **no frame where native
  Reddit could flash**. The `/r/paintprobe/` sentinel confirms the blackout is computed
  before the body's first byte.
- **Pagination**: infinite scroll drives `loadContent()` across the world boundary
  (14 → 32 rows, no duplicates); a truncated comment thread pages out (13 → 28); with
  *Auto-load more on scroll* off, scrolling fetches nothing, the sentinel reads
  `load more`, and one click fetches exactly one page.
- **SPA navigation**: a sort-tab click on the Navigation-API fixture re-renders
  client-side (one `#shd-root`, swapped titles, no duplicates); the back button
  restores the previous sort against Reddit's cached-DOM model.
- **Failure screen**: a renamed post element produces the error card, printing
  `version: 0.25.0` (the build-identity promise from the README), with working
  *Show Reddit's own layout* (native restored, Sheddit's DOM fully removed) and
  *Reload* actions.
- **Gates and modals**: the real-shape 18+ modal is auto-answered affirmatively with
  the feed rendered behind it; the login upsell is suppressed with the layout intact;
  a transient scroll-lock causes zero layout swaps (page-world recorder); an empty
  subreddit shows Reddit's own "no posts yet" panel — no failure screen, no blank; a
  pure age-gate page is handed back with its button visible and clickable.
- **Scope**: an unhandled `/search/` route is left completely native — nothing
  mounted, nothing suppressed, even under streamed delivery.
- **Options page**: loads standalone, all ten `data-k` controls present and populated
  with DEFAULTS (`autoPaginate` on, `showNsfwThumbnails` off); every toggle tried
  (`showThumbnails`, `compactRows`, `autoPaginate`, theme select) applies to an open
  tab live, without a reload; host-permission warning correctly hidden on Chrome.
- **Narrow viewport**: listing and comments at 360px show no horizontal overflow.
- **Stability**: zero page JS errors across the whole run; ~4 DOM mutations over a 3s
  idle window (late timestamp hydration), no render churn.

## Observations (none blocking)

1. **A full element rename gets the "slow connection" explanation.** `/r/renamed/` —
   a populated feed whose post element Sheddit no longer recognises, i.e. the redesign
   scenario the project treats as its primary threat — has `sourceCount() == 0`, so it
   lands in the `no-content` explanation: *"usually a very slow connection or a Reddit
   outage… or an empty or private subreddit."* The one failure mode the project most
   expects is the one the visible wording doesn't name (the markup-change hypothesis
   only appears in `render-failed`, which needs countable sources). The Details pane
   does carry the full diagnostics, and the reason-comment in `gate.js` shows the
   wording was deliberated — but a third sentence like *"If this page clearly has
   posts, Reddit may have renamed its markup — please file a bug"* would route redesign
   reports better. Low severity, wording only.
2. **Fixture artifact, not a bug**: after the SPA sort swap the sentinel reads
   `could not load more` — the `/r/spa/` fixture's leftover `faceplate-partial` is
   inert (no `loadContent()` on that route), so the bridge call correctly reports a
   failed drive. On live Reddit the partial is functional.
3. Broken-image icons in screenshots are the test sandbox blocking external image
   hosts; thumbnail *resolution* logic (which URL is chosen, decoys skipped) is covered
   by the suites, and the placeholder tiles render correctly.

## Live reddit.com

- `curl https://www.reddit.com/` from this container: HTTP 200, 8,393 bytes — the
  bot-mitigation shim TESTING.md documents, not the feed.
- `npm run verify:live` skips cleanly with a correct, actionable explanation and a
  diagnostic screenshot rather than failing — itself a behavior worth having.
- Consequence: the 2026-08-14/24 live findings in TESTING.md remain the most recent
  live evidence; nothing in this round could refresh them. A `verify:live` from a
  residential connection is still the highest-value single test anyone can run.

## Driver errata (for honesty)

Two checks initially reported FAIL and were driver bugs, re-verified green: a
duplicate-row check that compared empty strings instead of `data-fullname`, and an
options-page probe that looked for `id=` attributes where the controls are keyed by
`data-k`. A third apparent anomaly (a hung screenshot after toggling thumbnails) was a
CDP hiccup in the driver; re-run isolated, the page answers `evaluate` in 2ms and
screenshots in 93ms after the toggle.
