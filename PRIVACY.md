# Privacy Policy — Sheddit

**Last updated:** 30 August 2026
**Applies to:** the Sheddit browser extension, all versions, Chrome and Firefox alike.
The Firefox build also declares this in its manifest, in the form Mozilla surfaces on
the listing: data collection **none**.

## The short version

Sheddit collects nothing, transmits nothing, and contacts no server of its own — because
there is no such server. It reads the Reddit page already open in your browser and
re-draws it. That is the whole program.

Two things leave your browser at all, both of them optional, neither of them about you: the
manifest of a video you are watching, and — only if you press the button that asks — a file
on GitHub stating the current version number. Both are described in full below.

## What Sheddit stores

One object, in `chrome.storage.sync`, holding your display preferences:

| Key | What it is |
| --- | --- |
| `theme` | which of the five colour themes you picked |
| `listing`, `comments`, `chrome`, `profiles` | which kinds of page Sheddit should re-render |
| `compactRows`, `showThumbnails`, `showNsfwThumbnails`, `autoPaginate` | layout and paging toggles |
| `inlineVideo`, `inlineImages` | whether video and pictures render inside the layout |

Since 0.29.0 there is a second object, in `chrome.storage.local`, and only once you have
pressed **updates** in the header:

| Key | What it is |
| --- | --- |
| `update` | the answer to the last update check: the version number GitHub stated, the link it gave, its release note, and when you asked |

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
- **The update check, and why it waits for you.** Sheddit is installed by hand and never
  updates itself, so since 0.29.0 the header carries an **updates** control. Pressing it
  makes one request: a GET of
  [`dist/latest.json`](https://github.com/kookaburrabarrel/sheddit/blob/main/dist/latest.json)
  from GitHub, a static file holding a version number. It is sent **without cookies** and
  **without a referrer** — the referrer is the one that would have mattered, because left
  at its default it would have told GitHub which Reddit page you were reading when you
  pressed it. Nothing is sent about you, your browser beyond what any HTTP request carries,
  or what you were looking at.

  **It never fires on its own.** Not on page load, not on a timer, not in the background,
  not once a day. That is the entire design and not an accident of the first version: a
  check that ran by itself would make every install emit a periodic request carrying an IP
  and a timestamp, which is telemetry whatever it is called and whatever it asks for. The
  press is the consent, and the answer is remembered so one press lasts.

  Beside it, and costing nothing at all, is the part that needs no network: the build date
  is stamped into the extension, so it can tell you this copy is two months old without
  asking anyone. That is arithmetic, not a request.
- **No remote code.** Everything that runs ships inside the extension. Nothing is
  downloaded, evaluated, or updated out of band — the update check reads a version
  *number*, and cannot deliver anything that runs. (Manifest V3 forbids it; Sheddit would
  not do it regardless.)
- **No account, no login, no API key.** Sheddit never sees your Reddit credentials or
  session, and never acts on your behalf.
- **No selling, sharing, or transfer.** There is nothing to sell, share, or transfer.

## Permissions, and why each one exists

**`storage`** — to remember the preferences listed above, and the last update-check answer
if you have asked for one. Nothing else is written.

**Host access to `*://*.reddit.com/*`** — Sheddit's entire function is rewriting Reddit's
own pages into the old.reddit.com layout, which cannot be done without running on those
pages. The access is limited to reddit.com and is used only to read and re-draw the
document already loaded in your tab. `reddit.com/media` is excluded outright, and
`old.reddit.com` is excluded from everything that reads or redraws a page.

**On `old.reddit.com`, one script and nothing else.** That host now answers every page
with a login wall, so a link to it dead-ends — and a Reddit link that dead-ends is blamed
on whichever extension is installed. Sheddit therefore ships a single small script there
(`src/core/oldreddit.js`) whose only job is to say so on screen and send you to the same
page on `www.reddit.com`. It reads the URL in your address bar, reads your
`redirectOldReddit` preference, writes one entry to that tab's `sessionStorage` so two
redirectors cannot bounce you between hosts for ever, and navigates. It reads no page
content, sends no request, and is off entirely if you untick the option. The destination
in a login wall's `dest` parameter is followed only when it points back at reddit.com, so
the redirect cannot be pointed at anyone else's site.

**No host access to `v.redd.it` or `raw.githubusercontent.com`, despite the two requests
above.** Both servers answer with `access-control-allow-origin: *`, so those files can be
read without any additional permission — which is why neither the video player nor the
update check widened what Sheddit is allowed to reach. Both requests are sent with
`credentials: 'omit'`, so your cookies never go with them, and the update check adds
`referrerPolicy: 'no-referrer'`.

Sheddit requests no other permissions. It has no background service worker, no tabs
access, no cookie access, and no host access to any other site.

## Your data rights

There is no data of yours in anyone's hands to request, correct, or delete. Your
preferences are yours, on your machine: change them on the extension's options page, or
remove them by uninstalling.

## Verifying all of this

Sheddit is free software under the GPL-3.0-or-later, and the entire source is public at
<https://github.com/kookaburrabarrel/sheddit>. The claims above are checkable rather than
promised — the published package contains only the files listed by `npm run package`, and
`grep -rn "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket" src/` returns **exactly two
hits**:

1. `src/core/media.js` — the video manifest, read when you open a video post's comments page.
2. `src/core/update.js` — the version file, read when you press **updates**.

Each file's header documents its request in full. A third hit would be a bug, and this is
the check that would show it. It was one hit until 0.29.0; that it is now two, and the
reason, is recorded below rather than quietly absorbed.

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

## Contact

Questions or concerns: <https://github.com/kookaburrabarrel/sheddit/issues>
