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
backported — Sheddit is a browser extension with a single distribution channel, so the
practical advice is always "update to the latest".

## What this extension does and doesn't do

Useful context for judging whether something is a real issue, and for scoping a report:

- **No network requests of its own.** No API, no telemetry, no analytics, no remote
  configuration, no third-party endpoints. Pagination calls `loadContent()` on Reddit's own
  `faceplate-partial` element, which fires the same anonymous same-origin request the page
  already makes for itself.
- **No credentials, ever.** Sheddit never reads cookies, never touches auth tokens, and is
  built for logged-out reading. It cannot act on your account.
- **Two permissions only.** `*://*.reddit.com/*` to run on Reddit pages, and `storage` for
  your theme and settings via `chrome.storage.sync`.
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
