# Privacy Policy — Sheddit

**Last updated:** 22 August 2026
**Applies to:** the Sheddit browser extension, all versions.

## The short version

Sheddit collects nothing, transmits nothing, and contacts no server of its own — because
there is no such server. It reads the Reddit page already open in your browser and
re-draws it. That is the whole program.

## What Sheddit stores

One object, in `chrome.storage.sync`, holding your display preferences:

| Key | What it is |
| --- | --- |
| `theme` | which of the five colour themes you picked |
| `listing`, `comments`, `chrome`, `profiles` | which kinds of page Sheddit should re-render |
| `compactRows`, `showThumbnails`, `showNsfwThumbnails`, `autoPaginate` | layout and paging toggles |

That is the complete list. There is no identifier in it, nothing derived from your
browsing, and nothing about you.

`chrome.storage.sync` is Chrome's own settings-sync mechanism: if you have Chrome sync
turned on, these preferences travel between your own signed-in Chrome installations via
Google, under Google's handling of your profile data. They never reach the authors of
Sheddit. Turn Chrome sync off and they stay on the one machine. Uninstalling the
extension removes them.

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
- **No remote code.** Everything that runs ships inside the extension. Nothing is
  downloaded, evaluated, or updated out of band. (Manifest V3 forbids it; Sheddit would
  not do it regardless.)
- **No account, no login, no API key.** Sheddit never sees your Reddit credentials or
  session, and never acts on your behalf.
- **No selling, sharing, or transfer.** There is nothing to sell, share, or transfer.

## Permissions, and why each one exists

**`storage`** — to remember the preferences listed above. Nothing else is written.

**Host access to `*://*.reddit.com/*`** — Sheddit's entire function is rewriting Reddit's
own pages into the old.reddit.com layout, which cannot be done without running on those
pages. The access is limited to reddit.com and is used only to read and re-draw the
document already loaded in your tab. `old.reddit.com` itself and `reddit.com/media` are
explicitly excluded.

**No host access to `v.redd.it`, despite the request above.** Reddit's media server
answers with `access-control-allow-origin: *`, so the manifest can be read without any
additional permission — which is why enabling video did not widen what Sheddit is allowed
to reach. The request is sent with `credentials: 'omit'`, so your cookies never go with it.

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
`grep -rn "fetch(\|XMLHttpRequest\|sendBeacon\|WebSocket" src/` returns **exactly one
hit**: the video manifest read in `src/core/media.js`, which that file's header documents
in full. Any other hit would be a bug, and this is the check that would show it.

## Changes to this policy

If Sheddit ever handles data differently, this file changes in the same commit as the code
that changed it, and the version that introduced it is noted here. There have been no such
changes to date.

## Contact

Questions or concerns: <https://github.com/kookaburrabarrel/sheddit/issues>
