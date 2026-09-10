# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/kookaburrabarrel/sheddit/security/advisories/new)
on this repository. That opens a draft advisory only the maintainers can see.

You can expect an acknowledgement within **7 days**, and an assessment with a fix or a
decision within **30 days**. If a report is valid and you would like credit, say so and
you will be named in the advisory and the changelog.

## Supported versions

Only the latest release is supported. Fixes ship on the current version rather than being
backported, so the practical advice is always "update to the latest". The Chrome and
Firefox builds are one source at one version — the Firefox manifest is derived from
Chrome's at package time, and nothing else differs — so a fix reaches both in the same
release rather than one browser lagging the other.

## What this extension does and doesn't do

Useful context for judging whether something is a real issue, and for scoping a report:

- **No Reddit API, no telemetry, no analytics, no remote configuration.** Pagination
  calls `loadContent()` on Reddit's own `faceplate-partial` element, which fires the same
  anonymous same-origin request the page already makes for itself. Three requests of its
  own exist and PRIVACY.md describes each in full: a video manifest from Reddit's media
  CDN when you open a video post, and a static version file on GitHub, read when the
  **updates** button is pressed and once at browser start unless that is switched off.
  All three are sent with `credentials: 'omit'`. There is no server belonging to this
  project for anything to be sent to.
- **No credentials, ever.** Sheddit never reads cookies, never touches auth tokens, and
  never builds an authenticated request. It is built for logged-out reading.
- **It does press two kinds of control that Reddit put on the page**, which is a
  different claim from the one above and is worth scoping a report against. For a reader
  who is already signed in, the vote arrows, reply box and log out forward to Reddit's
  own controls, always behind a click of yours. And on an adult subreddit Sheddit clicks
  Reddit's "over 18" button *without* a click of yours — see **What it presses for you**
  in PRIVACY.md, which covers what that means for a signed-in account and how narrowly it
  is targeted.
- **Two permissions only.** `*://*.reddit.com/*` to run on Reddit pages, and `storage` for
  your theme and settings via `chrome.storage.sync`. The content scripts themselves are
  matched more narrowly than the permission: `reddit.com`, `www.reddit.com` and
  `sh.reddit.com` are the hosts Sheddit renders, plus `old.reddit.com` for the redirect
  notice alone. Reddit's other subdomains — `business.`, `ads.`, `mod.`, `chat.` — are
  separate applications and nothing of Sheddit's runs on them.
- **On Firefox, the host permission is revocable.** Firefox treats MV3 host permissions as
  something the user can withdraw after install. Withdrawn, the content scripts never run
  at all — and an extension whose scripts never run cannot report that from the page, so
  the options page checks separately and offers a one-click grant. Worth ruling out before
  concluding Sheddit failed silently on a page.
- **One privileged crossing, deliberately narrow.** `src/core/bridge.js` is the only code
  that runs in the page's own JavaScript realm (`"world": "MAIN"`). It exists solely to call
  a method Reddit defines and a content script cannot reach. It takes its selector and
  method name from `<html>` data attributes rather than accepting arbitrary input, and a
  test asserts both halves of that protocol agree.
- **It renders content from Reddit into its own DOM.** Post titles and metadata are set as
  text, never as HTML. Comment and post bodies are the exception: Sheddit *clones* Reddit's
  already-rendered node rather than re-parsing markdown, which keeps links and code blocks
  intact and avoids introducing a second parser. Those nodes are Reddit's own output, moved
  and not reinterpreted.

## Things that are known, and not vulnerabilities

- **Reddit's stylesheet still matches cloned comment bodies.** Because the clone stays in
  the same document carrying Reddit's utility classes, Reddit's CSS can restyle those nodes.
  This is a cosmetic exposure that is documented and tracked in
  [the engineering log](docs/engineering-log.md#open-questions), not a security boundary.
- **Vote arrows delegate to Reddit's own controls.** They do not construct requests. Logged
  out, the native control is unreachable and the arrows do nothing.
- **The failure screen prints diagnostics.** These are page-shape details (element counts,
  attribute names), never user data.

## Scope

In scope: anything that lets a page escalate beyond the two permissions above, that causes
Sheddit to execute page-supplied script in a privileged context, that leaks data off the
machine, or that misrepresents content in a way with real consequences — the
graphic-imagery case in [entry 41](docs/engineering-log.md#41) is a good example of the
last kind.

Out of scope: Reddit's own behaviour, layout and styling bugs, and the fact that an
extension you installed yourself can read the Reddit pages you open.
