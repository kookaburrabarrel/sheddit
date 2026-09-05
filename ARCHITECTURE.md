# Sheddit — Architecture

A Chrome MV3 extension that re-renders modern Reddit (`shreddit`) into the old.reddit.com
layout, on the fly, per page, with **no API calls and no login**.

---

## 1. What the recon found

Live inspection of `reddit.com`, `/r/programming/`, and a comments page produced five facts
that drive every decision below.

### 1.1 `shreddit-post` is a complete data record in the light DOM

Every post element carries its full model as HTML attributes:

```
permalink, content-href, post-title, post-type, score, upvote-ratio,
comment-count, created-timestamp, domain, author, author-id,
subreddit-name, subreddit-prefixed-name, subreddit-id, id (t3_…),
award-count, icon, feedindex
```

As observed 2026-08-12. `award-icon-url` and `is-link-post` were in this list and have
since been dropped from `contracts.js`: the 2026-08-14 live run found neither present on
every post, and neither was read anywhere downstream. The *required* triad `model.js` will
skip a post over is `id` / `post-title` / `permalink`; everything else is optional.

**This is the single most important finding.** Sheddit does not need to scrape rendered text,
reverse-engineer Tailwind classes, or pierce shadow roots to know what a post *is*. The
data is sitting in attributes that the content script can read directly.

### 1.2 Almost every visual sub-component is inside a shadow root

Within one post: `shreddit-post-text-body`, `shreddit-post-flair`, `shreddit-join-button`,
`shreddit-post-overflow-menu`, `faceplate-hovercard`, `shreddit-async-loader`, and others
all have `shadowRoot` attached. Page CSS cannot reach inside them.

Consequence: **restyling the existing tree is not viable.** You would need `::part`
cooperation Reddit hasn't provided, and you would still be fighting hundreds of atomic
utility classes that change on every deploy.

### 1.3 The action bar (votes, comments) is lazily hydrated

The vote/comment row lives inside a `shreddit-async-loader` and does not exist at first
paint. Any code that assumes "find the upvote button on load" will intermittently fail.

### 1.4 Comment threading is carried by `depth`, not by DOM shape

**Resolved 2026-08-14.** Reddit now nests comments in the DOM, which briefly looked like it
invalidated this whole section. Measured, it does not: the DOM ancestor-comment count equals
the `depth` attribute on **25/25** comments, and **0/25** have another `shreddit-comment` as
a *direct* parent — there is always a wrapper chain between them:

```
shreddit-comment > details > div.grid > div.col-span-2.grid > shreddit-comment
```

So `depth` was truthful when comments were flat and is truthful now that they are nested.
Reading the tree from `depth` rather than from DOM shape is what made that change a
non-event, and the depth-stack needed no rewrite.

One real consequence, though: a comment's subtree now contains its **descendants'** bodies.
Anything reading "the body" out of a comment must scope the lookup —
`closest(COMMENT) === el` — because Reddit only happens to emit the body before the child
container. Reverse that order and a bare `querySelector` returns the first child's text for
every comment. `model.js` scopes it; `nestedCommentsHtml()` in the fixtures reproduces both
orderings so the suite proves it.

As originally observed (2026-08-12), `shreddit-comment` elements were siblings under a
`<section>`/`<div>`, with threading expressed only as data:

```
depth="0" | "1" | "2" …
comment-parent-positions="[]"
comment-position="0"
thingid="t1_…"  postid="t3_…"  score  author  created  permalink
```

Old Reddit's nested `<div class="child">` structure was therefore **reconstructed** from
`depth` rather than inherited from the DOM — a decision that turned out to be the reason
Reddit's later switch to nesting cost nothing.

### 1.5 Content arrives after load, forever — and pagination is *programmatic*

`shreddit-feed` renders **3 posts**, then appends
`<faceplate-partial loading="programmatic">`. Navigation is client-side; the `navigation`
API is available.

A comments page carries a *lot* of these — 29 on the thread seen during the original recon,
41 on the one measured 2026-08-14, of which only **10 were inside `shreddit-comment-tree`**.
That distinction matters and cost a bug: the rest are unrelated page furniture (related
posts, sidebars), so `COMMENT_PARTIAL` is scoped to the comment tree. Driving an arbitrary
partial fetches the wrong thing entirely.

`loading="programmatic"` is the critical detail. That partial does **not** self-trigger on
scroll — Reddit's own feed JS decides when to fire it, based on the native feed's position
in the viewport. **Since Sheddit hides the native feed, that logic never runs and the feed
dead-ends at 3 posts.** Scrolling the page programmatically did not help.

The escape: `faceplate-partial` exposes a public `loadContent()` method. Calling it took
the live home feed from **3 posts to 28** and appended a fresh partial for the next page.
So pagination is driven directly off Sheddit's own sentinel — see `paginator.js` and §5.1.

Consequence: this is a **continuous pipeline Sheddit clocks itself**, not a one-shot transform.

---

## 2. Core strategy: rebuild, don't restyle

> Read the model from attributes → render Sheddit's own old-reddit markup → hide the original
> subtree with one CSS rule.

| Approach | Verdict |
|---|---|
| Override Reddit's CSS | ✗ Dies at shadow roots; breaks on every deploy |
| Move existing nodes into a new layout | ✗ Nodes are lazily hydrated; reparenting breaks their JS |
| **Read attributes, render fresh DOM** | ✓ Depends only on attribute names, which are a de-facto stable API |

The blast radius of a Reddit redesign is then limited to `src/config/contracts.js`. Every
selector and attribute name in the codebase lives in that one file.

### Why this survives login-less operation
All data Sheddit renders is already present in the server-delivered HTML for an anonymous user.
It never calls `oauth.reddit.com`, never reads cookies, never needs a session. Interactive
actions that genuinely require auth (voting, replying) are handled by **delegation** —
see §5.

---

## 3. Module layout

```
sheddit/
├── manifest.json               MV3, content scripts at document_start
├── src/
│   ├── config/
│   │   ├── contracts.js        ALL selectors + attribute names. Single point of breakage.
│   │   └── themes.js           theme registry + applier (document_start, before the gate)
│   ├── core/
│   │   ├── bridge.js           the ONLY main-world code — calls page-defined JS from isolation
│   │   ├── gate.js             FOUC suppression, failure detection, failure screen
│   │   ├── route.js            SPA route classification & change events
│   │   ├── pipeline.js         MutationObserver → rAF-batched work queue
│   │   ├── paginator.js        drives faceplate-partial.loadContent() off its own sentinel
│   │   ├── model.js            shreddit-* element → plain JS model object
│   │   ├── media.js            DASH-manifest resolution + video/audio pairing (0.16–0.30)
│   │   ├── update.js           build-age nudge + the click-only version check (0.29.0)
│   │   ├── session.js          is the page a logged-in one? presence-based, C.SESSION (0.34.0)
│   │   ├── oldreddit.js        the ONLY script on old.reddit.com — the hop to www (§5.2)
│   │   └── dom.js              tiny h() builder, escaping, number/time formatting
│   ├── modules/
│   │   ├── listing.js          feed & subreddit → old-reddit link rows
│   │   ├── comments.js         comment list → nested thread tree, via `depth` (§1.4)
│   │   ├── account.js          vote / reply / submit for a logged-in page — all delegated (§5.3)
│   │   └── chrome.js           header bar, update control, theme switcher, tab menu, sidebar
│   └── styles/
│       ├── suppress.css        hides native shreddit chrome (document_start)
│       ├── themes.css          the alternate palettes (document_start — see themes.js)
│       ├── redirect.css        the old.reddit interstitial + its blackout (§5.2)
│       └── old-reddit.css      the actual old.reddit skin
├── test/
│   ├── harness.js              Chromium discovery, fixture server, shared reporter
│   ├── fixtures.js             synthetic pages built from live-observed structure
│   ├── css-lint.js             static stylesheet assertions (no browser)
│   ├── run.js                  the bundle in jsdom
│   ├── geometry.js             the bundle in Chromium — REAL layout boxes
│   ├── extension.js            the PACKED extension in Chromium — manifest wiring
│   ├── extension-firefox.js    the Firefox build in a real Firefox — Gecko's realm rules
│   ├── media-sync.js           real media playback in Chromium — the audio pairing
│   ├── live-contracts.js       re-verify contracts.js against real reddit.com
│   └── mutate.sh               reintroduce shipped bugs, prove the suites catch them
├── CHANGELOG.md                what changed, and which bugs never worked at all
└── options/                    per-feature toggles
```

---

## 4. The pipeline

```
document_start
   └─ suppress.css injected   → native layout hidden immediately (no flash of new reddit)
   └─ bridge.js registers in the PAGE's main world (the only code that runs there)
   └─ route.js loads (pure URL classifier — no DOM, no events yet)
   └─ gate.js arms a CONTENT-AWARE deadline (§7c) — not a plain timer
        └─ also un-blanks early off `load` if the page has no feed at all
        └─ and holds the blackout at its first tick when route.classify() says the URL
           is one the pipeline will take — real Reddit streams, document_idle waits for
           DOMContentLoaded, and unblanking there flashed the native feed (log bug 83)

document_idle
   └─ pipeline.js classifies location via route.js → LISTING | COMMENTS | OTHER
   └─ pipeline.js attaches MutationObserver(document.body, {childList, subtree})
        │
        ├─ node added
        ├─ filter: is it shreddit-post / shreddit-comment, unprocessed?
        ├─ push to queue, schedule one rAF flush (coalesces bursts)
        │
        └─ flush()
             ├─ model.js  : element → {id, title, url, score, author, sub, …}
             ├─ module    : model → old-reddit DOM node
             ├─ insert rendered node, mark source [data-shd="done"]
             └─ gate.reveal() on first successful render
```

### Idempotency
Every source element is stamped `data-shd="done"` the moment it is consumed. The observer
skips stamped nodes. This is what makes infinite scroll and partial re-renders safe — the
same element can be visited many times and will only ever be rendered once.

### Route changes
`navigation.addEventListener('navigate')` is used where available (confirmed present on
reddit.com), with a `history.pushState`/`replaceState` monkey-patch + `popstate` fallback.
On route change: reset per-page state, re-classify, re-run a full sweep.

The window between the pre-commit teardown and the incoming page's first render is owned
by a themed `#shd-loading` line (gate.resetForRoute) — before it existed that window was
several seconds of suppressed-everything blank on every sort-tab click (engineering log
bug 86). It is mounted only mid-session, where `.shd-active` is guaranteed on; every gate
exit (reveal, unblank, fail, release, standDown) removes it.

The header and sidebar are torn down and rebuilt on every route change, because the header
carries the current subreddit. Rebuilding them must **not** be gated on
`!SHD.gate.revealed` — `reveal()` latches true for the lifetime of the page, so gating
there means they are destroyed once and never come back. That shipped: the sidebar
disappeared permanently after the first client-side navigation and the header kept naming
the previous subreddit.

`route.js` owns the sort list (`SORTS`) and `chrome.js` renders its tabs from it, so
`classify()` and the shipped tabs cannot disagree. They did: `controversial` was offered on
the front page but only accepted under `/r/x/`, so clicking the extension's own tab classified as
`OTHER` and dropped the user out of the extension.

### Why rAF batching
`faceplate-partial` can append a dozen posts in one microtask burst. Rendering
synchronously inside the observer callback causes layout thrash and can re-trigger the
observer. Queue + single rAF flush turns N renders into one layout pass.

---

## 5. Interaction model (the no-login constraint)

Sheddit renders old-reddit vote arrows and links, but owns no auth state. Three tiers:

1. **Pure navigation** (post title, comments link, subreddit, user, sort tabs) —
   rendered as real `<a href>`. Zero JS needed. Works logged out.
2. **Delegated actions** (upvote, downvote, save, hide) — the arrow's click handler finds
   the corresponding *hidden* native control inside the original `shreddit-post` and
   calls `.click()` on it. Reddit's own code then handles auth, optimistic UI, and the
   network request. Because the action bar is lazily hydrated (§1.3), the handler resolves
   the native control **at click time**, not at render time, and no-ops if absent.

   The lookup is `SHD.dom.deepQuery`, which descends into **open shadow roots**. §1.2
   records `shreddit-async-loader` — where the action bar hydrates — as having a shadow
   root, so a light-DOM `querySelector` can miss the button *permanently*, not merely
   before hydration. The original code could not tell those two apart: both logged
   `console.debug('not hydrated yet')`. A miss now warns once, reporting whether the
   loader exists and how many open shadow roots were searched.

   **Verified live 2026-08-14, logged out: the button is not reachable at all** — *by the
   search as it then stood; read on, and see the 2026-09-05 note after this list.*
   `deepQuery` searched 21 open shadow roots under the post and found nothing matching
   `C.NATIVE.upvote` — not a closed-root problem, the control simply is not there for a
   logged-out session (Reddit likely renders a "log in to vote" affordance instead of a
   real vote button when there is no session). This settles the question §5's scope split
   already assumed: delegation is retained code, not a working feature, for the primary
   logged-out case. Whether a *logged-in* session exposes the control is still unchecked —
   `npm run verify:live -- --headed`, signed in, would answer that if it ever matters.

   **Since 0.34.0 it matters, and the tier is live code again** — see §5.3. A logged-in
   page is now expected to expose the control, and a miss there is reported once with the
   evidence, because there it means the contract is stale.

   **2026-09-05, the first signed-in run: NOT FOUND again, 23 open shadow roots searched —
   and the number described the wrong tree.** `deepQuery` searched the shadow roots of
   the post's descendants and never the post's *own*, for the whole life of the function.
   A custom element renders its own UI on its own root, so every "unreachable" above was
   measured through a hole. The lookup now takes the host's own root first; whether the
   buttons are there, and under which attributes, is what the next signed-in run's button
   dump answers (engineering log, question 11).

3. **Deferred to native** (reply box, mod tools) — Sheddit does not reimplement these. Clicking
   "reply" un-hides the native composer in place, via `SHD.dom.passthrough()`.

   This is subtler than it looks, and the first implementation was wrong twice over.
   suppress.css clips the **direct child of `<body>`**, and `clip-path`/`opacity` apply to
   the entire subtree — so tagging the `<shreddit-comment>` itself, seven levels down,
   could never reveal it. And even on the correct element the escape hatch lost the
   cascade: the suppression selector's `:not(#id)` clauses give it three ids' worth of
   specificity, which beats a class-only rule regardless of `!important` on both.

   `passthrough(el)` walks the path from the target up to the body child, tags that child
   `.shd-native-passthrough` — which is **excluded from** the suppression selector rather
   than trying to override it — and `display: none`s every sibling along the path. Only
   the corridor down to the target survives. `#shd-root` hides for the duration and a
   fixed "← back to sheddit" control reverses it. Route changes and bails unwind it.

### 5.3 The account layer (0.34.0) — the delegation tier, extended to the reply box

`src/core/session.js` and `src/modules/account.js`. For a reader who is *already* logged in
to Reddit, three things and no more: vote, reply, post. The architectural claim is that none
of them needs a fourth tier. Everything is still tier 2 (a click forwarded to Reddit's own
control) or tier 1 (a real link), and the extension's network surface stays at zero.

**Who it is on for.** `SHD.session.active()` is the single gate: the reader's setting
(`account`) AND a page that *affirmatively* reads as logged in. `C.SESSION.loggedIn` is a
list of presence signals (the avatar button that opens Reddit's user drawer, and the
attribute `shreddit-app` is believed to carry); `C.SESSION.loggedOut` is a veto (Reddit's
own *Log In* control, which live captures have shown). No signal either way is logged out.
This is deliberately asymmetric: an absence-based test switches the layer on for the
primary, logged-out reader the day Reddit moves a button, and a reply box that cannot post
is worse than none; a wrong contract the other way costs a logged-in reader a feature they
can still reach through Reddit's controls. **Every entry is a candidate as of 0.34.0** —
the settle is one signed-in `verify:live -- --headed` run (its LOGGED-IN SESSION section
reports which clauses match), which needs a desk, not a container.

**Vote** trusts the control, not the detector. A click resolves `C.NATIVE.upvote/downvote`
from the hidden source at click time (the bar hydrates late, §1.3) and forwards if found —
logged in or not, because the button's presence is Reddit's own statement that the session
can use it. The detector only decides what a *miss* means: logged in, warn once with the
evidence; logged out, nothing (§7d's documented state). The state is mirrored back in old
reddit's classes (`likes`/`dislikes`, `upmod`/`downmod`) from Reddit's button
(`aria-pressed`, `C.NATIVE.voteState`) when it exposes one — read after the click, now and
again after `settleMs`, so the page's answer beats our optimistic guess and a refused vote
goes dark — and kept on a local toggle when it does not. The displayed score is
`delivered + (state − initial)`, `initial` being the first native state seen, because
Reddit's `score` attribute already counts the reader's standing vote. Comments get the
same column (arrows only; their score lives in the tagline), where before 0.34.0 the
arrows were inert markup.

**Reply** drives Reddit's composer instead of reimplementing it. `compose(target, text,
kind)` is the protocol, every step through `C.COMPOSER` / `C.NATIVE.reply` and each one
measured:

1. a composer already open *for this target* — scoped by `closest(COMMENT) === target`,
   because a comment's subtree holds its descendants' composers exactly as it holds their
   bodies (§1.4); for the post, any composer not inside a comment;
2. failing that, click Reddit's reply control and wait for one to mount (a snapshot taken
   before the click keeps an unrelated open composer from being mistaken for ours);
3. find the editor — a `<textarea>` (markdown mode) is a value and an `input` event; a
   contenteditable is fed through `document.execCommand('insertText')` so the page's
   rich-text editor sees a real `beforeinput`/`input`, with a direct text set as the
   fallback — and *check the text landed* before going on;
4. click Reddit's submit;
5. wait for the outcome: a new `shreddit-comment` under the target (Reddit's optimistic
   insert, which the pipeline then renders nested where Reddit put it), or Reddit's
   composer emptied or gone.

Every miss returns the step it missed and has one floor: the box stays with the draft, the
status names the step, and Reddit's own composer is revealed in place (passthrough, §5
tier 3) so the reader finishes there. The reply is never discarded on a failure.

**Post** is a link. Old reddit's *Submit a new link / text post* sidebar doors onto
`C.SUBMIT`'s route, which `route.js` classifies `OTHER` and the gate never suppresses — the
composer is a whole page with its own rules and one of the routes CONTRIBUTING says to leave
untouched. Reddit navigates to the new post when it is done, and the renderer picks that
page up.

**What the isolated world allows here.** Clicking, focusing, setting a textarea's value,
`execCommand`, dispatching an `InputEvent`: all DOM, all shared with the page (§5.0), so no
bridge extension was needed. If Reddit's editor ever needs a *method* called on it, that is
a bridge job, and the composer selector would travel as data the way the partial's does.

### 5.0 The isolated world — the constraint that outranks the rest

A content script shares the **DOM** with the page and nothing else. Same nodes, same
attributes, same open shadow roots; a completely separate JavaScript realm.

| | Reachable from a content script |
|---|---|
| DOM nodes, attributes, open shadow roots | yes |
| Events, including `.click()` | yes, both directions |
| **Methods and properties defined by page JS** | **no** |

Tier 2 above survives this by accident of design — `.click()` is a DOM method and the
event reaches Reddit's main-world listener. Tier 3 survives because it only moves classes
around. Pagination did not: `faceplate-partial` is a custom element Reddit defines, so
`loadContent()` lives on a main-world prototype and `typeof fp.loadContent` is `undefined`
from the isolated world. `loadNext()` checked for the function, did not find it, and returned false — every
time, silently.

The consequence is worth stating plainly: **infinite scroll never worked in any installed
copy of this extension.** It worked throughout development because the dev harness is
pasted into DevTools, which runs in the main world. §7a's "3 → 28 posts" verification was
done that way and could not have caught it.

`src/core/bridge.js` is a `"world": "MAIN"` content script and the only sanctioned
crossing. The isolated side writes the selector and method name onto `<html>` as data
attributes and dispatches a bare event; the bridge reads them off the shared DOM, makes
the call, and writes the result back the same way. No objects cross — `CustomEvent.detail`
is not reliably cloned between worlds, and the DOM always is. Because the selector travels
as data, `contracts.js` remains the single point of breakage.

If you need another Reddit-defined method later, extend the bridge. And do not let the dev
harness tell you whether it works — only `test/extension.js` runs in the world the users get.

The bridge carries a second protocol since 0.24.0: a **history relay**. `history` is a
page-realm object too — Reddit's router calls the page's `pushState`, and a copy patched
in the isolated realm is a copy nothing calls. That mistake shipped as route.js's
no-navigation-API fallback and passed every one-world environment (jsdom, the dev
bundle, DevTools) for the same reason pagination's did; Firefox is where it mattered,
because Firefox ESR has no `navigation` API and its realm separation is strict
(engineering log bug 82). The bridge patches `pushState`/`replaceState` in the page
realm and dispatches `BRIDGE.navigated` after each commit; route.js re-reads `location`
on the event. Primitive-only, like the load-more protocol, and asserted in step with
`contracts.js` the same way.

### 5.0b Firefox

The same source runs on Firefox 140+ (the current ESR). Two manifest keys set a floor
and the higher one wins: `world: "MAIN"` in content scripts is a Firefox 128 capability,
and `data_collection_permissions` is a Firefox 140 one — declaring a key below the
version that reads it is what AMO warns about, so the floor is the newest key's, not the
oldest requirement's. The Firefox manifest is **derived** — `firefoxManifest()` in
`package-extension.js` adds the gecko block (id, `strict_min_version: "140.0"`, a
data-collection declaration of `none`), a `gecko_android` block whose
`strict_min_version` is `"142.0"` because the same declaration landed later there (an
absent block does not mean "no Android floor"; it means the Android floor silently
inherits gecko's), and drops the Chrome-only version key; nothing else may differ, and a
test asserts the content scripts come through the transform byte-identical. Measured
while porting, in a real Firefox 154 via `test/extension-firefox.js`, on Linux and macOS
both: the Xray boundary passes the whole bridge protocol, Gecko resolves the theme tie
the same way Chromium does, promise-style `chrome.*` calls work, and — the ground having
moved under the plan — current Firefox release ships the `navigation` API (it landed in
147, after the 140 ESR), so only the ESR line rides the relay alone (the suite prefs the
API off to pin that configuration). Two Firefox-only behaviours worth remembering: MV3 host permissions are revocable there, which the options page's access
warning exists for; and reddit.com sits on the HSTS preload list, which is a testing
concern only (the suite prefs it off to reach the plain-http fixture server), never a
production one.

### 5.1 Pagination and the "no API calls" constraint

Sheddit calls `faceplate-partial.loadContent()`, which hits Reddit's **own same-origin
partial-HTML endpoint** — the identical request the page issues for itself, anonymously.
No OAuth, no token, no session, no endpoint of Sheddit's own, no third party. This is Reddit's
infinite scroll, clocked by Sheddit's sentinel instead of its hidden one.

If you want that read strictly — zero network activity after first paint — set
`settings.autoPaginate = false`. The sentinel becomes a manual "load more" button and
nothing is fetched unless the user clicks it. The extension is fully functional either way;
you just see 3 posts per page instead of an endless feed.

**Comment threads page the same way.** A thread ships a slice and leaves a partial for the
rest, exactly as the feed does — but the paginator's selector was hardcoded to
`shreddit-feed` and `pipeline.js` only attached a sentinel on listings, so threads stopped
at whatever arrived in the initial HTML. `paginator.useMode(route)` now picks
`FEED_PARTIAL` or `COMMENT_PARTIAL`, and the sentinel goes under `.nestedlisting` on
comment pages. The comment partial selector is scoped to `shreddit-comment-tree` so an
unrelated partial elsewhere on the page cannot be mistaken for more comments.

Guardrails in `paginator.js`: 800 ms cooldown between automatic calls, 40-page hard cap,
and a mutation-settle await so overlapping requests are never issued. Three details there
are load-bearing and were each wrong at some point:

- **`settle()` starts observing before the load is triggered.** A partial that appends
  synchronously produces no mutations after the fact, so an observer attached afterwards
  saw nothing and every page waited out the full ceiling — six seconds each.
- **`pump()` re-arms after every successful load.** `IntersectionObserver` reports only
  *changes*, and `attach()` re-observes after each flush, so the single callback landed
  inside the cooldown and was dropped. The feed advanced exactly one page and then stalled
  until the sentinel happened to leave and re-enter the viewport.
- **The cooldown applies to automatic triggers only.** A click is a deliberate act, and a
  button that silently does nothing is worse than one that fetches twice.
- **The manual button is withheld while the unprompted fill is still working.** The fill
  lands rows *above* the sentinel, so a clickable "load more" during that window is a
  target the chain is about to bury — measured live as a click that opened whichever post
  slid under the cursor (engineering log bug 85). `settling()` holds the control as an
  inert `loading…` until one of the fill's real stopping points; with `autoPaginate`
  off nothing unprompted moves the page and the button is live from first paint.

The extension has **zero network surface of its own**. `host_permissions` is scoped to
`*://*.reddit.com/*` purely so content scripts can run.

### 5.2 old.reddit.com — the one host we leave rather than render

Every renderer script `exclude_matches` `old.reddit.com`, and that is still right: old
reddit is the thing this extension imitates. But that host no longer serves a logged-out
reader anything at all. Measured 2026-09-03: every path answers a 302 onto
`/login/?reason=lor2&dest=<the page you asked for>`, and that login page answers **403**
with an HTML body.

It is the only legacy hostname that needs anything. Measured the same day, `np.`, `i.`,
`new.` and `sh.` reddit.com each answer `301 → www.reddit.com/<same path>` on their own, so
the renderer meets those on www having never seen the redirect. `old.reddit.com` is the one
that answers with a wall instead.

The problem this creates is not the wall — it is **attribution**. A reader with Sheddit
installed follows a Reddit link, gets a dead end with no layout, no header and nothing of
ours anywhere on it, and concludes the extension is broken. That is bug 52's argument
(*a silent hand-back is indistinguishable from an unrelated bug*) arriving through a host
we were never on. Silence is not available to us here.

`src/core/oldreddit.js` is therefore the only script that runs there, delivered at
`document_start` with `redirect.css` and nothing else — no contracts, no themes, no route.
It swaps the host for `www.reddit.com`, where the page loads and the renderer draws it in
the layout the link was asking for, behind an interstitial that says so.

Four details are load-bearing:

- **The `dest` parameter is unwrapped, not the host swapped.** The 302 is server-side, so
  no document is ever created for the URL the reader clicked — by the time the script
  runs, `location` reads `/login/?reason=lor2&dest=…`. Swapping only the host there lands
  them on **www's** login page: the same wall in different paint.
- **`dest` is treated as hostile.** It is followed only when it resolves back to
  reddit.com, and never when it is itself another login wall. Anything else falls back to
  the front page. A redirector that follows an arbitrary parameter is an open redirect
  wearing the extension's name.
- **The blackout is a class the script sets synchronously**, exactly as `.shd-gate` is,
  and `redirect.css` hangs every rule off it. An unconditional stylesheet would blank
  old.reddit for the reader who turned the redirect off — the one group whose page must be
  untouched — and a class set one tick later is a login wall they watch flash.
- **A loop guard, in that tab's `sessionStorage`.** `www.reddit.com` never sends anyone
  back here, but *another* old-reddit redirector installed alongside Sheddit does exactly
  that, and two extensions each doing half a round trip is an infinite one — a hang, with
  nothing on screen to explain it. A second hop to the same destination inside ten seconds
  stops and says why, offering both hosts as links.

**The known limit.** A content script needs a document. Today the wall is a served 403
page, so there is one; if old.reddit ever stops answering altogether, Chrome's own network
error page replaces the document and nothing here runs. `declarativeNetRequest` would
cover that case by intercepting before the request — at the cost of a new permission, a
ruleset, and an extension-hosted page in the address bar, and with no way to show this
interstitial. Recorded as the trade that was made, not as an oversight.

---

## 6. Rendering contracts

### Listing row (old-reddit `div.thing`)
```
[rank] [▲ score ▼] [thumbnail] title (domain)
                    submitted <time> by <author> to <r/sub>
                    <comment-count> comments  share  save  hide  report
```
Source fields: `score`, `post-title`, `content-href`, `domain`, `created-timestamp`,
`author`, `subreddit-prefixed-name`, `comment-count`, `permalink`.

Thumbnail: `post-type` drives the placeholder class (`self` / `link` / `image` /
`gallery` / `video`); a real thumb URL is lifted from the first `<img>` in the source
subtree when one exists.

### Comment tree
Flat list → tree via a depth stack (see the §1.4 warning — the "flat" premise is disputed
as of 2026-08-14, though `depth` itself is still reliable, which is what this actually
reads):
```
stack[d] = node at depth d
for each comment in document order:
    parent = stack[depth-1] ?? root
    append rendered comment to parent's .child container
    stack[depth] = rendered comment
```
The stack is module state that survives pipeline flushes, because a thread streams in
batches — a late batch has to nest against comments rendered several flushes earlier, not
restart at the root. Cleared only on route change.

Collapse toggles (`[–]`) are pure local state. `sessionStorage` is mentioned as an option
here but **nothing persists collapse state today**; toggles reset on reload.

---

## 7. Failure modes and mitigations

| Risk | Mitigation |
|---|---|
| Reddit renames an attribute | All names in `contracts.js`; `model.js` returns `null` on missing required fields and the row is **skipped, not broken** |
| Renderer throws mid-page | Each render wrapped in try/catch; failures increment a counter, and past a threshold `gate.fail()` stops the pipeline and shows the failure screen (§7c) |
| Failing leaves debris | `old-reddit.css` is scoped under `html.shd-active`, so anything already rendered would remain as *unstyled* markup, and the pipeline would keep appending to it. `fail()` removes `#shd-root`/`#shd-header` and fires `onStop`; the pipeline disconnects its observer, clears the queue, and both `collect()` and `flush()` refuse to run |
| A slow page mistaken for a broken one | The deadline is content-aware — see §7c. A flat timer fired on any page whose HTML streamed past 1.5 s |
| A failure that looks like someone else's bug | Native Reddit is never silently restored. §7c |
| Flash of new Reddit | `suppress.css` at `document_start` + reveal on first render |
| Blank page if extension breaks | Content-aware deadline (§7c). Posts delivered but nothing rendered = a Sheddit bug, fail with a visible screen; no feed container at all = not a page Sheddit renders, un-blank and stay out of the way; still streaming = keep waiting. Never a plain timer — that fired on any slow page |
| A feed that is legitimately EMPTY | Rendered, not waited on. "Zero posts" is either an answer or a page that has not arrived, and a post COUNT cannot tell them apart — so the split is a contract: Reddit's own no-content panel inside the feed (`C.FEED_EMPTY`) settles it immediately, and failing that the inference (document complete, no pending partial, markup in the feed, no modal, full patience window) settles it at the deadline. The page then gets the whole shell and our own empty-state line naming the filter in force. Before this it sat at `data-shd-waiting="empty-feed"` for ever, showing Reddit's layout and Reddit's copy — bug 94 |
| Ads (`shreddit-ad-post`) | Recognised as a distinct tag and simply not rendered |
| Memory growth on infinite scroll | Source elements stay in the DOM but hidden, and are **not** pruned. A `pruneAfterRender` setting once claimed to detach them; its implementation was an empty callback, and it could not have worked — delegation resolves native controls out of the source subtree at click time, so gutting rendered posts breaks voting on everything scrolled past. Reddit's own infinite scroll retains the same nodes. If this ever needs capping, drop whole rendered rows off the top of `#siteTable` and let their sources go with them |

---

## 7a. Verification results (live, 2026-08-12)

The extraction and render logic was executed in-page against real Reddit before any of it
was committed to the skin.

**Comments** — `/r/programming` comment page, 24 comments:

| Check | Result |
|---|---|
| Models extracted | 24 / 24 |
| Bodies located (`[slot="comment"]`) | 24 / 24 |
| Scores parsed | 24 / 24 |
| Depth-stack tree placement | 24 placed, **0 orphans** |

**Listings** — home feed paginated to 28 posts via `loadContent()`:

| Check | Result |
|---|---|
| Models extracted | 28 / 28, 0 skipped |
| Rows rendered end-to-end | 28 / 28, **0 exceptions** |
| Non-empty titles | 28 / 28 |
| Valid hrefs | 28 / 28 |
| Thumbnails resolved | 22 / 22 non-text posts |
| Thumbnail false positives | **0** |
| Ads captured | **0** |

### Two bugs this caught before they shipped

1. **Thumbnail false positives.** The first selector matched
   `img[src*="styles.redditmedia"]`, which is the *subreddit icon*, and picked up
   `emoji.redditmedia.com` flair emoji too — every text post got a bogus thumbnail. Fixed
   with a host allowlist (`preview|i|external-preview.redd.it`) plus an ancestor exclusion
   for flair/hovercard/join-button/user-link. Now exact.

2. **Dead-end feed.** See §1.5 — hiding the native feed silently kills Reddit's
   scroll-triggered pagination. Found only because the post count refused to move off 3.
   Fixed by owning pagination in `paginator.js`.

### Incidental findings
- `shreddit-ad-post` does **not** contain a `shreddit-post`, so querying `POST` excludes
  ads for free — no filtering needed.
- Observed `post-type` values: `text`, `link`, `image`, `gallery`, `video`, `multi_media`,
  `crosspost` (added 2026-08-14). `multi_media` resolves no thumbnail and falls back to
  the placeholder.
- `/r/all/` redirects to `/` for logged-out users; `route.js` classifies both as LISTING.

---

## 7b. Layout verification (headless Chromium, 2026-08-13)

§7a verified *extraction*. It could not verify *layout*: jsdom does no layout, and
`css-lint.js` reads one declaration at a time. `test/geometry.js` now measures real boxes.

**The staircase report is closed.** Rows measured at ten viewport widths, 360–1920px:

| Check | Result |
|---|---|
| Distinct `left` offsets among `#siteTable > .thing.link` | **1**, at every width |
| Horizontal document overflow | **0px**, at every width |
| Comment indent step per depth level | **31px**, uniform at every level |

It did not reproduce, and it is now a standing assertion rather than folklore.

**Two bugs it found on its first run**, both invisible to the other two suites:

1. **Sidebar gutter shortfall.** `#shd-sidebar`'s margin box was 338px (300 width + 16
   padding + 2 border + 20 margin) against a hard-coded `margin-right: 320px`. A float
   intrudes by its *margin* box, so rows overlapping the sidebar were laid out 18px
   narrower than rows below it — measured at 1101/1200/1280/1440/1920, width-independent,
   on both the listing (936 vs 954) and the comments page (922 vs 940). With the synthetic
   74px sidebar only one row is affected; a real subreddit sidebar is hundreds of pixels
   tall, so the wrap width changes for many rows and the right edge steps at its bottom.
   Both sides now derive from `--shd-gutter`.

2. **Comment `[–]` under the vote arrows.** The toggle (x 15–26.1) and the hover-revealed
   up arrow (24.5–39.5) overlapped, as did the arrows and the tagline text. `.midcol`
   inherited the listing's 34px width against a 22px row padding. The toggle now sits
   inline at the head of the tagline, which is where old reddit puts it.

**The packed extension has now been driven end to end.** `test/extension.js` loads this
directory via `--load-extension` against a loopback server mapped onto `www.reddit.com`,
confirming what only the manifest can provide: match patterns fire, the
`document_start`/`document_idle` split holds, script order is right, and both stylesheets
arrive (title renders at 16px `#0000ff`, body at `#dae0e6`, `shreddit-app` clipped to
`inset(50%)`).

---

## 7c. Failing visibly

The first cut treated failure as "remove Sheddit's suppression and get out of the way". That is
wrong in two directions, and both were measured.

**It fired on pages that were fine.** The trigger was a flat 1500 ms timer armed at
`document_start`. Reddit streams its HTML, so the timer was measuring connection speed,
not correctness. With the posts stalled 1600 ms — an ordinary mobile connection — the
extension permanently disabled itself on a page that rendered perfectly 400 ms later:

| HTML stall before posts arrive | Before | After |
|---|---|---|
| 1000 ms | renders | renders |
| 1600 ms | **disabled, permanently** | renders |
| 10000 ms | **disabled, permanently** | renders |

The deadline now asks *why* nothing is on screen. Source elements present and nothing
rendered is a Sheddit bug — fail at once, waiting cannot help. No source elements yet means the
page has not arrived — keep waiting, up to `MAX_WAIT_MS`.

**And the failure itself was invisible.** Silently restoring modern Reddit is
indistinguishable from the extension not being installed, so the user has no reason to
suspect Sheddit at all — it reads as an unrelated Reddit bug. That is the worst possible
diagnostic signal.

So a failure renders `#shd-error`: what happened, why it probably happened, the file to
edit when it is a redesign, a diagnostics block for a bug report, and two buttons. Native
Reddit stays suppressed behind it. `release()` — the old behaviour — now runs only when
the user presses **Show Reddit's own layout**, and it latches for the document.

Three consequences worth keeping in mind:

- The screen is built with raw DOM calls in `gate.js` and styled from `suppress.css`,
  because `gate.js` runs at `document_start` (no `SHD.dom` yet) and `old-reddit.css` is
  scoped under `.shd-active` — the very class a failure removes.
- A failure is per-page. `resetForRoute()` clears it on navigation so one bad page does
  not condemn the session, and clearing `revealed` there is load-bearing: `onRoute()`
  removes `#shd-root` on every navigation while native Reddit stays suppressed, so a
  latched `revealed` left the deadline disarmed and an unrenderable second page showed
  *nothing at all*, forever.
- A user's `release()` is not per-page. If they asked for native Reddit, they keep it.

---

## 7d. Live re-verification (real reddit.com, 2026-08-14)

§7a's recon and §7b's layout work were both done against fixtures or a sandbox that Reddit
serves an anti-bot interstitial to. `npm run verify:live` finally ran from an ordinary
connection. This is the section to update after every future run.

**Still correct:** every `POST_ATTR` except the two dropped below, every `COMMENT_ATTR`,
`shreddit-feed`, `#main-content`'s depth beneath `shreddit-app`, the ad filter
(`shreddit-ad-post` containing no `shreddit-post`), the feed partial and its
`loadContent()`, and comment bodies at `[slot="comment"]`.

**Newly wrong:**

| Finding | Response |
|---|---|
| Comments are **not** flat siblings (§1.4's premise) | **Resolved, no rewrite.** `depth` matches DOM nesting 25/25 and no comment directly parents another. §1.4 rewritten. It did surface one real bug: the body lookup had to be scoped, since a comment's subtree now holds its descendants' bodies |
| `award-icon-url` and `is-link-post` no longer on every post | Removed from `contracts.js` — neither was read downstream anyway |
| New `post-type`: `crosspost` | Fixture added. Carries a `b.thumbs.redditmedia.com` thumbnail, which the allowlist was rejecting along with the `styles.`/`emoji.` decoys — so crossposts silently lost their thumbnail. Host added; the allowlist stays an allowlist |
| Upvote control **not reachable at all** logged out — 21 open shadow roots searched, nothing found | Not a bug to fix. Confirms §8's scope: the arrows are decorative for the logged-out case. Whether a logged-in session exposes it is still unchecked |

**Half vindicated, half wrong — comment continuation.** It was built here from an *untested
assumption* that threads lazy-load like feeds, so the live evidence cut both ways.

Confirmed: a real thread declared 88 comments, delivered 25, and carried `faceplate-partial`
inside `shreddit-comment-tree` exposing the same `loadContent()`. The mechanism is the feed's
mechanism and `paginator.useMode('COMMENTS')` reaches it.

Wrong: there were **ten** of those partials and **not one** carried
`loading="programmatic"`, alongside controls reading `"16 more replies"` and `"continue this
thread"`. Two consequences:

- `C.COMMENT_PARTIAL` — the programmatic clause — **matched nothing live**, and it cannot
  match anything its fallback does not: it is a strict subset of
  `COMMENT_TREE LAZY_LOADER`, and `querySelector('a, b')` returns the first match in
  *document* order, not the first clause that has one, so listing it first buys no
  preference. Comment pagination has only ever worked through the broad clause. Both narrow
  constants are kept because `verify:live` asserts on them and "the feed's partial is
  programmatic" is what explains why pagination does not self-trigger — documentation with a
  test attached, not selectors doing work.
- Ten at once, labelled per-branch, is not "one partial = the next page". It reads as one
  partial per truncated *branch*, and nothing establishes that driving one replaces it. That
  matters because `loadNext()` re-queries its selector each time: a partial that fills its
  branch in place gets picked again for ever, so one branch expands repeatedly while the
  rest of the thread stays unreachable. Driven partials are now stamped `data-shd="done"`
  and excluded from the selector, which is correct whichever mechanism is real
  (`docs/engineering-log.md` bug 27).

Which mechanism it *is* remains unmeasured. `verify:live`'s **WHAT DRIVES A COMMENT TREE**
section is built to settle it — inventory every partial, drive the exact element the
paginator would drive five times over, and report per round whether the call advanced,
whether the partial survived, and whether what arrived was a branch's replies or new
top-level comments. It cannot run from a container: Reddit answers a datacenter IP with a
bot-mitigation shim (measured — an 8.4 KB spinner page, `retry-after: 0`, no
`shreddit-post` anywhere) regardless of how the browser is configured.

**Method note.** The first attempt reported "anti-bot interstitial — run from a
non-datacenter network", which was a guess with no evidence behind it. The real obstacle was
Puppeteer's own automation fingerprint (`navigator.webdriver`), independent of IP
reputation. `verify:live` now captures page title, a body snippet and a screenshot before
giving up, and distinguishes a genuine challenge from "does not look like Reddit" from "is
Reddit but empty after 30 s". A diagnostic that names a cause it did not observe is worse
than one that says it does not know.

## 7e. Live re-verification (real reddit.com, 2026-08-24)

Run against `/r/programming/` and a 523-comment thread, logged out. Every listing,
comment and profile contract passed — `POST_ATTR` on 27/27 posts, `COMMENT_ATTR` on
25/25 comments, `depth` agreeing with the DOM 25/25, and `shreddit-profile-comment`
readable 29/29 with the body at `.md` and every row able to name its community.

**Settled: what driving a comment-tree partial actually does.** Five consecutive drives
of the element the paginator would pick, measured individually: every driven partial
**removed itself** (5/5), every drive delivered comments (10, 2, 1, 1, 2 — all nested
under the host branch, none at depth zero), and repeated calls kept making progress
rather than re-expanding one branch. The mechanism is **subthread expansion**, not
next-page — one partial per truncated branch, consumed on use. `paginator.js`'s
stamp-and-exclude approach was designed to be correct under either mechanism; it is now
known to be running under this one.

**Moved since 2026-08-14:** a live tree now carries partials with
`loading="programmatic"` again (2 of 22 in-tree, beside 19 per-branch
`loading="action"` expanders and 1 `lazy`), so `COMMENT_PARTIAL` matches real elements
after a stretch of matching nothing. No behaviour change needed — the broader fallback
clause was already driving the right elements — but the "matches nothing live" note in
`contracts.js` dates from the earlier shape.

**Measured the same day, from the run's own findings (curl, both image hosts, four
URLs):** `i.redd.it` and `preview.redd.it` each serve an `<img>` fetch
(`Accept: image/*`) normally and **307-redirect a top-level navigation**
(`Accept: text/html`) to `reddit.com/media?url=…` — the viewer. There is no URL a
logged-out click can reach that shows the bare picture, which re-diagnoses the reported
"thumbnail dumps you into the /media viewer" bounce: the content-href was a bare
`i.redd.it` URL all along (16/16 on this run), and the CDN itself does the bouncing.
Image titles route to the comments page as a result; see the engineering log.

**Settled by a follow-up run the same day, with the corrected probes:** the comment-sort
values are **accepted** — `?sort=new` delivered a strictly newer median comment id than
`?sort=old` (ids are base36-sequential over time), which an ignored parameter cannot
produce — and `packaged-media-json` is alive on the nested player (1/1 in the subtree,
0 on the post element), confirming the earlier 0/4 as probe error rather than the CMAF
migration completing.

**A third run the same day (an age-gated subreddit, 28 posts) found real drift:**
`award-count` on 0/28 posts — dead on posts while comments still carry it 25/25 — so the
post mapping is retired by the same test that removed `award-icon-url`. `icon` was on
27/28, which is what an optional attribute looks like, not a break; the probe now
distinguishes required (universal), dead (0 carriers), and partial (FYI). The same run
measured `packaged-media-json` on 16/28 video posts' players, consistent with late
hydration, and the gate answered itself en route — which navigated the page and exposed
a probe crash, fixed alongside.

**Unchanged:** the upvote control is still unreachable logged out (20 open shadow roots
searched, nothing), which is the documented scope state rather than a failure — the
verify script now reports it as a note instead of failing an otherwise-clean run over a
settled decision.

---

## 8. Deliberate v1 scope

**Logged-out reading is the target.** Everything auth-gated is out *for a logged-out page*,
and that is a narrowing of §5's three tiers rather than a contradiction of them: tier 1
(navigation) is the product, tier 2 (delegation) is retained for the logged-in page (§5.3,
since 0.34.0: vote and reply; before that retained but unsupported), tier 3 (native handoff)
exists so the reply path is not a dead end and is the floor every delegated action falls to.

Concretely, nothing that requires a session is rendered. `save` and `report` were removed —
they shipped as `href: permalink`, so they looked like actions and navigated instead, and
old reddit did not show them to logged-out users either.

**In:** home feed, `/r/*` listings, comment pages, header + tab bar, right sidebar; and on
a logged-in page, voting, replying and the doors to the composer (§5.3).
**Out:** search results, modmail, chat, the post composer itself, everything else
auth-gated (save, report, moderation). User profiles moved in on 2026-08-21.
Out-of-scope routes fall through to native Reddit untouched — `route.js` returns `OTHER`
and `gate.js` never suppresses.

### 8.1 Pages with nothing to render

Logged-out browsing runs into these constantly, and their URLs classify as `LISTING`:
age gates, private communities, quarantine notices, rate-limit pages, empty subreddits.

They are not failures, and treating them as one is worse than useless — an error screen
over an age gate covers the button the user has to press. The signal is whether Reddit
gave Sheddit anywhere for posts to live:

| State | Meaning | Action |
|---|---|---|
| Posts present, none rendered | Sheddit bug | fail, show the screen |
| No posts, document still loading | still streaming | keep waiting |
| No posts, **no feed container** | not a page Sheddit renders | un-blank, stay out of the way, keep watching |
| No posts, feed container present | suspicious — a renamed element looks like this | fail after `MAX_WAIT_MS` |

`unblank()` is a third state alongside `reveal()` and `standDown()`: stop hiding the page,
but stay willing to render if content turns up. It fires off the `load` event rather than
the 1500 ms tick, because an interstitial is usually `complete` within a few hundred
milliseconds and the alternative was a white screen for the full patience window.

---

## 9. Build order

1. `contracts.js` + `model.js` — verify extraction in the console before writing any CSS.
2. `gate.js` + `pipeline.js` — prove idempotency against infinite scroll.
3. `listing.js` + skin CSS — the visible payoff.
4. `comments.js` — the depth-stack tree.
5. `chrome.js` — header/sidebar polish.
6. Options page toggles.
