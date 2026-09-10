# Privacy Policy — Sheddit

**Last updated:** 10 September 2026
**Applies to:** the Sheddit browser extension, all versions, Chrome and Firefox alike.
The Firefox build also declares this in its manifest, in the form Mozilla surfaces on
the listing: data collection **none**.

## The short version

Sheddit collects nothing, transmits nothing, and contacts no server of its own — because
there is no such server. It reads the Reddit page already open in your browser and
re-draws it. That is the whole program.

Two things leave your browser at all, both of them optional, neither of them about you: the
manifest of a video you are watching, and a file on GitHub stating the current version
number. The version check happens when you press the **updates** button, and — since
0.37.0, unless you switch it off right beside that button — once when your browser starts,
no more often than once every twenty hours. Both are described in full below, including
what GitHub can see and how to stop it.

One thing Sheddit *presses* for you, and it is named here rather than buried: on a
subreddit marked adult it clicks Reddit's own "over 18" button, without asking. That is
described in full below too, under **What it presses for you**.

## What Sheddit stores

One object, in `chrome.storage.sync`, holding your display preferences:

| Key | What it is |
| --- | --- |
| `theme` | which of the five colour themes you picked |
| `listing`, `comments`, `chrome`, `profiles` | which kinds of page Sheddit should re-render |
| `compactRows`, `showThumbnails`, `showNsfwThumbnails`, `autoPaginate` | layout and paging toggles |
| `inlineVideo`, `inlineImages` | whether video and pictures render inside the layout |
| `account` | whether the vote arrows, reply box and account corner work when you are already signed in |
| `redirectOldReddit` | whether an `old.reddit.com` link is sent to the same page on `www.reddit.com` |
| `autoUpdateCheck` | whether the version check may run when your browser starts |

Since 0.29.0 there is a second object, in `chrome.storage.local`, written whenever an
update check is *attempted* — by pressing **updates** in the header, and since 0.37.0 by
the startup check as well, which means it can appear without you having pressed anything
(a fresh install runs one check when it is installed):

| Key | What it is |
| --- | --- |
| `update` | the last update check: the version number GitHub stated, the link it gave, its release note, when it was asked, and whether that attempt got an answer |

The "when it was asked" is what stops the check repeating: an attempt that fails is
recorded too, so a browser that cannot reach GitHub does not retry at every startup for
ever.

That is the complete list. There is no identifier in either object, nothing derived from
your browsing, and nothing about you. `chrome.storage.local` is deliberate for the second
one: unlike your preferences it does **not** sync, because it describes the copy installed
on this one machine and has no business travelling anywhere.

`chrome.storage.sync` is the browser's own settings-sync mechanism — Firefox exposes the
same API. With browser sync turned on, these preferences travel between your own
signed-in installations of that browser, via its vendor (Google for Chrome, Mozilla for
Firefox) and under that vendor's handling of your profile data. They never reach the
authors of Sheddit. Turn browser sync off and they stay on the one machine. Uninstalling
the extension removes them.

## What Sheddit does not do

- **No data collection.** Not what you read, not what you vote on, not which subreddits
  you visit, not your username, not analytics, not crash reports, not telemetry of any
  kind. Nothing about you is sent anywhere, by any route.
- **No API calls.** Sheddit never calls Reddit's API — not to read your feed, not to fetch
  posts or comments, not for anything. It works on the page already loaded in your tab.
  Paging through a feed works by asking that page to load its own next page, exactly as
  scrolling does — the request is Reddit's, to Reddit, and would have happened anyway.
- **Playing video, and the one file it reads.** To play a video post inside the layout,
  Sheddit reads that video's manifest — a small XML file listing which versions of the
  video exist — from Reddit's media server, so it knows which files to hand the player.
  This is the same kind of file your browser would fetch to play the video on Reddit
  itself: a plain request for a static file, sent **without cookies**, carrying nothing
  about you. It happens only when you open a **video** post's comments page, and only
  while the setting below is on.

  The video and sound files themselves are then loaded by the player, the same way any
  page loads a video you press play on. Reddit ships newer videos with the sound in a
  separate file, so there are two of them rather than one.

  **Why:** Reddit is repackaging its video, and on a repackaged post the file Sheddit used
  to link to no longer works. Without reading the manifest there is nothing to play.

  **To switch it off:** untick *"Play video on the comments page"* on the options page.
  Video posts then go back to being a link and a thumbnail.
- **Pictures are ordinary page images.** Thumbnails, full-size images on a comments page,
  and pictures opened with the `[+]` expando are fetched by your browser from Reddit's
  image servers the same way any page loads its images — Sheddit only writes the `<img>`
  tag, and listing pictures are not fetched at all until you open them. Untick *"Show
  images inline"* to turn the full-size ones off.
- **The update check, and how to switch it off.** A copy installed by hand never updates
  itself, so since 0.29.0 the header carries an **updates** control. Pressing it
  makes one request: a GET of
  [`dist/latest.json`](https://github.com/kookaburrabarrel/sheddit/blob/main/dist/latest.json)
  from GitHub, a static file holding a version number. It is sent **without cookies** and
  **without a referrer** — the referrer is the one that would have mattered, because left
  at its default it would have told GitHub which Reddit page you were reading when you
  pressed it. Nothing is sent about you, your browser beyond what any HTTP request carries,
  or what you were looking at.

  **Since 0.37.0 it also runs once when your browser starts, and you can turn that off.**
  Earlier versions fired only on a press, and the reason was that a request leaving on its
  own is a request you did not ask for. What changed is the judgement, not the analysis: a
  hand-installed copy never updates itself, so the reader most likely to be running a build
  that no longer works is the one who set this up months ago and has not thought about it
  since — and a notice that has to be pressed is a notice they never see.

  So it is a switch rather than a fact of life. **auto: on / off** sits directly under the
  updates control in Sheddit's own header, and the same setting is on the options page.
  Turn it off and nothing leaves at startup at all; the button still answers when pressed,
  exactly as before. It is on by default.

  What it does when on: one request, and no more often than once every twenty hours, no
  matter how often you restart. (Twenty rather than twenty-four so that starting your
  browser at the same time each morning is not pushed to every other day by a boundary
  you cannot see — which does mean two requests can fall inside one calendar day.) An
  attempt that fails is recorded as an attempt, so a browser that cannot reach GitHub
  backs off for an hour rather than asking again at every startup.
  The same request the button makes — the same static file, no cookies, no referrer,
  nothing about you. **What is honest to say about it:** Sheddit still collects nothing and
  still has no server of its own, so there is nothing here that could gather anything even
  if it wanted to. GitHub, who serve the file, see what any host sees when your browser
  asks it for something — an IP address and a timestamp. That is the whole exposure, it is
  the same exposure the button always had, and the difference is only that it can now
  happen without you pressing anything. If you would rather it did not, the switch is two
  clicks away and it is remembered.

  Beside all of it, and costing nothing at all, is the part that needs no network: the
  build date is stamped into the extension, so it can tell you this copy is two months old
  without asking anyone. That is arithmetic, not a request.

- **No remote code.** Everything that runs ships inside the extension. Nothing is
  downloaded, evaluated, or updated out of band — the update check reads a version
  *number*, and cannot deliver anything that runs. (Manifest V3 forbids it; Sheddit would
  not do it regardless.)
- **No account, no login, no API key.** Sheddit never sees your Reddit credentials or
  session, never reads a cookie, and never builds a request of its own to Reddit. What it
  presses on your behalf is one button, and it has its own section below.
- **No selling, sharing, or transfer.** There is nothing to sell, share, or transfer.
- **If you are logged in to Reddit yourself, that stays between you and Reddit.** Since
  0.34.0 Sheddit notices a logged-in page (the avatar button in Reddit's own header) and
  makes old reddit's arrows, reply box and submit buttons work for you. It does that by
  clicking the vote button, reply control and submit button Reddit already rendered for
  the same item, and by typing your reply into Reddit's own editor — Reddit's page code
  then sends the request it would have sent had you used Reddit's button, with the
  session it already holds. Sheddit never sees that session, never reads a cookie, never
  builds a request, and never acts without a click from you. The layer is on by default,
  does nothing at all when you are logged out, and has its own checkbox on the options
  page.

## What it presses for you

One button, in one situation, and it is the only place in the extension where something
is pressed that you did not press.

**Reddit's 18+ prompt.** On a subreddit marked adult, Reddit covers the page with a
dialog asking whether you are over 18. Sheddit clicks its affirmative button, once,
without asking you first. Two consequences, stated plainly:

- Reddit then remembers the answer exactly as it would if you had clicked it yourself. If
  you are signed in, that means the affirmation is recorded against your account.
- It happens silently. The dialog is hidden under Sheddit's layout, so there is nothing
  on screen to show that anything was pressed.

Why it works this way rather than simply hiding the dialog: a hidden dialog leaves the
page half-working underneath it. Reddit keeps its own scroll lock in place and continues
to treat the session as unattested, so the rest of the page behaves as though the
question is still outstanding. Clicking is what makes the page work normally.

It is deliberately difficult to fire on anything else. Sheddit presses only when the
dialog is Reddit's blocking age-gate variant **and** exactly one button on it both
mentions 18 and is not a decline. Any other shape — two candidates, a translation Sheddit
cannot read, an "open in app" promotion — and it presses nothing and falls back to hiding
the dialog. Since it runs only on pages Sheddit is rendering, unticking that page type on
the options page stops it too.

If you would rather Sheddit never pressed anything: this is the one thing to know about,
and turning off the page types you browse turns it off with them.

## What the page can see

Sheddit draws its layout into the same document Reddit's own scripts are running in, so
those scripts can see that it is there. They always could — the layout is in the page —
but two specifics are worth naming rather than leaving to be found. The `<html>` element
carries `data-shd-version` (which build you are running) and `data-shd-theme` (which of
the five palettes you chose), and while a page is loading more posts the scroll marker
carries a set of `data-shd-*` values describing that.

None of it leaves your browser and none of it is about you — it is the extension's own
state, written where a bug report can read it back. But a site can read it too, which
means Reddit could distinguish one Sheddit build or theme from another. The theme
attribute cannot be removed; it is what the stylesheet selects on. The version stamp
stays because a bug report that cannot name the build it came from is worth very little.
Both are recorded here so the trade is visible rather than implied.

## Permissions, and why each one exists

**`storage`** — to remember the preferences listed above, and the last update-check answer
if you have asked for one. Nothing else is written.

**Host access to `*://*.reddit.com/*`** — Sheddit's entire function is rewriting Reddit's
own pages into the old.reddit.com layout, which cannot be done without running on those
pages. The access is limited to reddit.com and is used only to read and re-draw the
document already loaded in your tab. `reddit.com/media` is excluded outright, and
`old.reddit.com` is excluded from everything that reads or redraws a page.

**On `old.reddit.com`, two small scripts and nothing else.** That host now answers every
page with a login wall, so a link to it dead-ends — and a Reddit link that dead-ends is
blamed on whichever extension is installed. Sheddit therefore ships `src/core/oldreddit.js`
there, whose only job is to say so on screen and send you to the same page on
`www.reddit.com`, and `src/core/route.js`, which is a set of regular expressions over the
path and nothing else: it is what decides that a page Sheddit does not render — your
preferences, your inbox, a wiki page, a moderation queue — is left on `old.reddit.com`
where it works. Together they read the URL in your address bar, read your
`redirectOldReddit` preference, write one entry to that tab's `sessionStorage` so two
redirectors cannot bounce you between hosts for ever, and navigate. It reads no page
content, sends no request, and is off entirely if you untick the option. The destination
in a login wall's `dest` parameter is followed only when it points back at reddit.com, so
the redirect cannot be pointed at anyone else's site.

**No host access to `v.redd.it` or `raw.githubusercontent.com`, despite the two requests
above.** Both servers answer with `access-control-allow-origin: *`, so those files can be
read without any additional permission — which is why neither the video player nor the
update check widened what Sheddit is allowed to reach. Both requests are sent with
`credentials: 'omit'`, so your cookies never go with them, and the update check adds
`referrerPolicy: 'no-referrer'`.

Sheddit requests no other permissions. Since 0.37.0 it has a background worker, and it
exists for exactly one thing: asking GitHub for a version number when your browser starts,
if you have left that switch on. It does not read pages, watch tabs, or run while you
browse — it wakes at startup, asks or doesn't, and stops. Sheddit has no tabs access, no
cookie access, and no host access to any other site.

## Your data rights

There is no data of yours in anyone's hands to request, correct, or delete. Your
preferences are yours, on your machine: change them on the extension's options page, or
remove them by uninstalling.

## Verifying all of this

Sheddit is free software under the GPL-3.0-or-later, and the entire source is public at
<https://github.com/kookaburrabarrel/sheddit>. The claims above are checkable rather than
promised — the published package contains only the files listed by `npm run package`, and
`grep -rn "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket" src/` returns **exactly three
hits**:

1. `src/core/media.js` — the video manifest, read when you open a video post's comments page.
2. `src/core/update.js` — the version file, read when you press **updates**.
3. `src/core/background.js` — the same version file, read once when your browser starts,
   unless you have turned that off.

Each file's header documents its request in full. A fourth hit would be a bug, and this is
the check that would show it. It was one hit until 0.29.0 and two until 0.37.0; each
increase, and the reason for it, is recorded below rather than quietly absorbed.

The harder claim — that the second request happens only on a press — is not something grep
can settle, so it is asserted instead: `test/run.js` boots the extension with `fetch`
stubbed and fails the suite if rendering a page issues any request at all.

## Changes to this policy

If Sheddit ever handles data differently, this file changes in the same commit as the code
that changed it, and the version that introduced it is noted here.

**0.29.0 — the update check.** One new request, to GitHub, for a static file holding a
version number, sent only when the reader presses **updates** in the header; and one new
stored object, `update` in `chrome.storage.local`, holding that answer. Nothing about the
reader is sent or stored by either. This is the first change to this policy.

**0.34.0 — the account layer.** For readers already signed in to Reddit, the vote arrows,
reply box and submit links began working by clicking the controls Reddit had already put
on the page. No new request, no new stored data, no session or cookie read by Sheddit —
but Reddit's page code now sends requests it would not otherwise have sent, because a
control was pressed. Off with one checkbox; inert when logged out.

**0.37.0 — the startup version check.** The 0.29.0 request may now also be sent once when
the browser starts, on a floor of twenty hours, unless the **auto** switch beside the
updates button is off. Same request, same file, same absence of anything about the
reader; what changed is that it can happen without a press. A new setting,
`autoUpdateCheck`, and the `update` record can now be written without one.

**0.38.0 — the old.reddit redirect.** A link to `old.reddit.com` is sent to the same page
on `www.reddit.com`, behind a notice that says so. One `sessionStorage` entry per tab
stops two redirectors bouncing a reader between hosts. A new setting,
`redirectOldReddit`. From 0.43.0 this applies only to the paths Sheddit renders;
everything else is left on `old.reddit.com`.

**0.41.0 / 0.42.0 — the account corner.** The header shows the signed-in reader's own
username and avatar, read from Reddit's own header on the page, and offers a menu of
Reddit's account pages plus a log out that presses Reddit's own control. Nothing is
stored and nothing is sent; the name and picture are read from the page and drawn, and
neither survives a reload.

**0.43.0 — the 18+ prompt, written down.** No behaviour changed: Sheddit has clicked
Reddit's own "over 18" button since 0.30.0, and this policy did not say so. It says so
now, under **What it presses for you**, along with what it means for a signed-in reader.
The same release narrowed what can be clicked — a promotion offering *Yes* / *Not now*
matched the old rule — and added the **What the page can see** section, which names the
extension state a site can read out of the page it is drawn into.

## Contact

Questions or concerns: <https://github.com/kookaburrabarrel/sheddit/issues>
