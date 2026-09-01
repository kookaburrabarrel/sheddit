<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.png">
  <img src="docs/assets/banner-light.png" alt="Sheddit — modern Reddit, rewritten into the old.reddit.com layout, live, on every page. No account, no redirect, no API calls. Alongside, a Reddit front page rendered in the old.reddit layout." width="900">
</picture>

### Shed the manipulative endless feed. Keep the conversation.

**Read Reddit without being read back.**

No account. No profile. No feed tuned to keep you scrolling.

[![account: none](https://img.shields.io/badge/account-none-success?style=flat-square)](#why)
[![profile: none](https://img.shields.io/badge/profile-none-success?style=flat-square)](#why)
[![API calls: zero](https://img.shields.io/badge/API_calls-zero-success?style=flat-square)](#privacy)
[![tracking: none](https://img.shields.io/badge/tracking-none-success?style=flat-square)](#privacy)
[![telemetry: none](https://img.shields.io/badge/telemetry-none-success?style=flat-square)](#privacy)
[![feed: ranked by votes](https://img.shields.io/badge/feed-ranked_by_votes-success?style=flat-square)](#why)

[![version 0.32.0](https://img.shields.io/badge/version-0.32.0-ff4500?style=flat-square)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-5f99cf?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![Chrome 111+](https://img.shields.io/badge/chrome-111+-5f99cf?style=flat-square&logo=googlechrome&logoColor=white)](#install)
[![Firefox 140+](https://img.shields.io/badge/firefox-140+-ff7139?style=flat-square&logo=firefoxbrowser&logoColor=white)](#firefox)
[![license: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-663399?style=flat-square)](LICENSE)

### Beta 0.32.0 is out — everyone is welcome to try it

Works in Chrome and Firefox, [installed by hand](#install) in about a minute.
If Sheddit makes Reddit better for you, tell a friend — or post about it on Reddit itself,
if you still have an account ;)

**[Bug reports](https://github.com/kookaburrabarrel/sheddit/issues/new/choose) are
genuinely wanted.** Reddit changes its code without notice, and a report from a page that
broke is the fastest way it gets fixed. [What changed](CHANGELOG.md).

<br>

**Five ways to read it, all of them content to let you leave — and none of them watching you read.**

<img src="docs/assets/themes.gif" alt="Sheddit cycling through its five themes: classic, slate, sepia, night and carbon" width="630">

<br><br>

**NSFW Support**<br>
<img src="docs/assets/post-types.jpg" alt="Sheddit rendering r/CombatFootage in the classic theme: video posts with thumbnails and watch links, NSFW-tagged posts, and comment counts" width="630">

</div>

---

## What it is

Sheddit is a browser extension that turns modern Reddit back into old Reddit, on every
page, while you stay logged out.

Reddit already sends your browser every post on the page. Sheddit takes those posts and
redraws them in the `old.reddit.com` layout: a ranked list of links you can scan, pick
from, and leave. It never logs in, never calls Reddit's API, and never sends anything
about you anywhere.

## Why

Old Reddit was a page of links, ranked by votes. You scanned it, picked something, and
left. What replaced it is a slot machine: an endless feed, tuned to you, built to keep you
on the page — with a data harvesting apparatus built on top.

Here is how the machine works. Every pause, every tap, every return visit and comment is
recorded into a profile of you. That profile is what Reddit sells to advertisers. Then
your feed is ranked against the profile to keep the session going — one more scroll, one
more belief reinforced, one more outrage, one more product placement. It is a cynical
lesson learned from Facebook and TikTok: a session that ends is a session that stops
producing.

Almost all of that needs you logged in. Your account is what ties every scroll and
hesitation to one durable profile that follows you across devices and years. Logged out,
the data scatters and the profile thins. Which may be why reading logged out keeps getting
harder:

- A login wall that rises half a minute into reading, with no close button and no way to
  dismiss it.
- `old.reddit.com` vanishing behind an account requirement for days at a stretch, with no
  announcement.
- The anonymous JSON API gated off entirely.

Whatever the intent, the effect is the same: reading without an account keeps getting
narrower.

**Sheddit is the opt-out.** It takes the page Reddit already sent your browser and
re-renders it locally into old Reddit's layout — no account, no credentials, and zero API
calls of its own. What you read is the list Reddit serves to a stranger: ranked by votes,
not by your profile, because there is no profile. The login wall is removed outright
rather than negotiated with. Nothing is recommended *to you*, nothing is harvested *from
you*, and the session ends when you decide it does.

What's left is a ranked list of links that stops when you do. Everything below is about
keeping that working on a site that has no reason to help.

### Why not just redirect to old.reddit.com?

There are three ways to get old Reddit back:

|  | Works logged out | Needs your credentials | Survives an API policy change |
|---|:---:|:---:|:---:|
| **Redirect** to `old.reddit.com` | 🔴 not for long | 🔴 soon | 🔴 n/a — depends on Reddit continuing to host it |
| **Rebuild from the JSON API** | 🔴 no | 🔴 yes | 🔴 no |
| **Rebuild from the page** ← Sheddit | 🟢 yes | 🟢 no | 🟢 yes |

- **Redirecting** works until Reddit decides it doesn't. `old.reddit.com` is being phased
  out in stages, and the current stage is random, site-wide login walls: no pattern, no
  announcement, logged-out access just stops for a while and comes back later. A redirect
  extension inherits whatever `old.reddit.com` decides on a given day, and the direction
  of travel is an account requirement for any access at all.
- **Rebuilding from Reddit's API** needs your login. Reddit blocks the anonymous API, so
  a logged-out reader gets an error and a blank page. The [Classic Layout][cl] project
  documents exactly this.
- **Rebuilding from the page** is what Sheddit does. Everything it needs is already in the
  page Reddit just sent you. There is nothing to revoke, expire, or log into.

The catch is that Reddit can quietly rename the parts of its page Sheddit reads, whenever
it likes, and owes nobody notice when it does. That is why this project is free, open
source, and collaborative. When they change something, so will we.

[cl]: https://github.com/mkornreich/old_reddit

## Install

> ### Current version: **0.32.0** — beta, open to everyone
> It works, and it is tested on both browsers — Chrome the more thoroughly of the two.
> Reddit can still change something tomorrow that breaks it. If that happens,
> [tell me](https://github.com/kookaburrabarrel/sheddit/issues/new/choose).
>
> After installing, the extension's own failure screen prints the version it is running,
> which is how to tell whether an update actually took. [What changed](CHANGELOG.md).

Chrome and Firefox run the same source. **The Chrome build is the further along of the
two**: it is what most of the development and live testing has run against, and its Web
Store listing is in review. Firefox support arrived in 0.24.0 and works in normal use, but
has far less mileage on real pages, so that is where a rough edge is likeliest. Until the
store listings land, the zips below are the easiest way in. Nothing to build.

### Chrome

**[⬇ Download sheddit.zip](https://github.com/kookaburrabarrel/sheddit/raw/main/dist/sheddit.zip)**

1. Unzip it. You get a `sheddit` folder with `manifest.json` inside.
2. **Move that folder somewhere permanent** — Documents is fine. Chrome re-reads the
   extension from wherever you leave it, so a folder still sitting in Downloads will take
   Sheddit with it the day you clear Downloads.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**, top right.
5. Click **Load unpacked** and pick the folder with `manifest.json` *directly* inside it —
   not the folder around that folder. That is the one mistake worth watching for.
6. Open [reddit.com](https://www.reddit.com).

Chrome will warn about developer-mode extensions each time it starts. It says that about
anything installed outside the Web Store. Dismiss it and Sheddit keeps running.

**To update:** download the zip again, replace the folder's contents, then press ↻ on the
Sheddit card in `chrome://extensions`. Without the ↻ you are still on the old build.

**Knowing when to update.** A hand-installed extension never updates itself, and a stale
copy is the likeliest reason for a bug nobody else can reproduce. So the header has an
**updates** button, at the left end of the theme bar, with two halves:

- Once this copy is more than 30 days old, the button turns orangered by itself. That is
  arithmetic on a build date stamped into the extension — no request, works offline.
- Pressing it asks GitHub for one static file holding the current version number. It
  asks **only** when pressed: never on load, never on a timer, never in the background.
  No cookies and no referrer go with it, so the request cannot say which page you were
  on. See [PRIVACY.md](PRIVACY.md#the-short-version).

### Firefox

**[⬇ Download sheddit-firefox.zip](https://github.com/kookaburrabarrel/sheddit/raw/main/dist/sheddit-firefox.zip)**

Same extension, same source; only the manifest differs. It is the **younger** of the two
builds, so bug reports from here are especially useful. Until the addons.mozilla.org
listing lands, Firefox only accepts an unsigned extension as a *temporary* install, which
lasts until the browser closes:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick the downloaded zip. No need to unzip.

Two Firefox notes. It needs Firefox 140 or newer. And Firefox can revoke a site
permission at any time — if reddit.com ever loads without the layout, open the
extension's options page, which will say so and offer a button to grant access back.

### From source

For contributors, or anyone who would rather read the source first:

```bash
git clone https://github.com/kookaburrabarrel/sheddit.git
```

Then the Chrome steps above: `chrome://extensions` → **Developer mode** → **Load unpacked**
→ the cloned folder. There is no build step.

> **Try it without installing anything.** `npm install && npm run preview` writes
> `dist/preview.listing.html` and `dist/preview.comments.html` — the actual renderer's
> output, openable in any browser.

Requires Chrome 111+ or any Chromium browser (Edge, Brave, Vivaldi, Opera), or
Firefox 140+.

## What it does

|  |  |
|---|---|
| **The whole list at once** | Dense rows with rank, score, thumbnail, subreddit and tagline — around nine posts on a laptop screen |
| **Threading that reads like a conversation** | Indented comment trees with guide lines and `[–]` collapse toggles, plus old Reddit's sort menu and `all N comments` link |
| **Media without leaving the layout** | Video plays on the comments page, sound included; images and galleries render full size there too, and listing rows get old Reddit's `[+]` expando |
| **Scrolling that ends** | Uses Reddit's own pagination and stops when the feed is spent, instead of spinning to keep the session open |
| **Sorting that asks "of what span"** | `top` and `controversial` carry old Reddit's *links from* window — past hour through all time |
| **Five themes, no reload** | Switched from a button in the header; the choice follows you to every other tab |
| **Adult thumbnails, your call** | Flagged posts show old Reddit's placeholder tile by default; an *nsfw thumbnails* button in the header reveals them, and remembers |
| **Tells you when it breaks** | If Reddit ships markup Sheddit can't read, you get a screen saying so, with a button to hand the page back |
| **Nothing leaves your browser** | No API calls and no telemetry; your settings live in your browser's own storage and go nowhere else |

## Themes

Five palettes, switched from buttons in Sheddit's own header. A theme changes colour, type
and spacing, never the layout. The theme is applied before the page first paints, so a
dark theme never opens on a white flash.

<div align="center">

| classic | slate |
|:---:|:---:|
| <img src="docs/assets/listing-classic.jpg" alt="classic theme" width="400"> | <img src="docs/assets/listing-slate.jpg" alt="slate theme" width="400"> |
| old.reddit.com as it was — Verdana, blue links, square corners | the same layout softened — system font, muted greys, roomier rows |

| sepia | night |
|:---:|:---:|
| <img src="docs/assets/listing-sepia.jpg" alt="sepia theme" width="400"> | <img src="docs/assets/listing-night.jpg" alt="night theme" width="400"> |
| warm paper and serif type, for a long thread | dark, and deliberately softer than white-on-black |

| carbon |
|:---:|
| <img src="docs/assets/listing-carbon.jpg" alt="carbon theme" width="400"> |
| near-black, monospaced, Reddit orange, dense |

</div>

## How it works

Every post on a modern Reddit page carries its whole record — title, score, author,
comment count, link — as plain attributes on a `<shreddit-post>` element. The visible parts
of the post, though, are sealed inside shadow roots that page stylesheets cannot reach.
That is why every attempt to restyle modern Reddit with a stylesheet stalls out.

So Sheddit leaves Reddit's page alone. It reads those attributes, draws its own
old-Reddit markup alongside, and hides the original. As Reddit streams in more posts,
Sheddit keeps doing the same thing.

```
<shreddit-post post-title="…" score="12247" comment-count="1270" …>
        │
        ▼   read the attributes
   ┌─────────────┐
   │  model.js   │  →  a plain object
   └─────────────┘
        │
        ▼   render Sheddit's own markup
   ┌─────────────┐
   │ listing.js  │  →  <div class="thing link">…</div>
   └─────────────┘
        │
        ▼   hide the original
   suppress.css
```

Every Reddit selector and attribute name lives in one file, `src/config/contracts.js`,
so a Reddit redesign should only ever break one file. The full reasoning is in
**[ARCHITECTURE.md](ARCHITECTURE.md)**.

## How it's tested

It runs on every Reddit page you open, and for now you install it by hand rather than from
a store, so here is what stands behind it.

- **Six test suites**, from a static check of the stylesheets up to the packed extension
  running in a real Chromium and a real Firefox, measuring real layout in every theme at
  two screen widths. The cheap suites cannot see what the expensive ones catch: the
  jsdom suite once passed 39/39 while the page rendered visibly wrong, and infinite
  scroll was once broken in every installed copy while the dev harness paginated
  happily. Each of those lessons became its own suite.
- **Mutation testing.** A passing test proves nothing until you have watched it fail.
  `npm run test:mutate` reintroduces every bug this project has ever shipped, one at a
  time, and fails if the suite stays green. It has caught tests that protected nothing.
- **A written record of every bug.** [docs/engineering-log.md](docs/engineering-log.md)
  gives each one a numbered entry describing what the wrong behaviour *looked like*, so
  it is recognisable when someone is about to reintroduce it.

Details in [TESTING.md](TESTING.md).

## Scope

**Built for logged-out reading.** That is the case everything is tested against, and it
has consequences:

- **Voting isn't supported.** The arrows are drawn because old Reddit drew them, but
  Reddit's upvote button is unreachable for a logged-out session. Treat them as decoration.
- **Anything needing an account is left out.** `save` and `report` are gone; they can
  never work logged out, and old Reddit didn't offer them logged out either.
- **Adult thumbnails show old Reddit's `nsfw` placeholder**, with the same opt-in old
  Reddit had, from the header's *nsfw thumbnails* button or the options page. On a
  comments page — a post you opened on purpose — the picture or player is blurred under a
  single *click to view* / *click to play* button, and nothing beyond the small thumbnail
  loads until you press it.
- **Pages with no feed are handed straight back.** Age gates, private communities and
  rate-limit pages are recognised and left alone, so nothing covers the button you need.
- **An empty listing is still your layout.** `top` and `controversial` rank over a time
  window, so a busy subreddit can come back empty for a quiet week. Since 0.32.0 the
  page keeps the whole shell and says the window is empty, rather than handing you
  Reddit's "this community doesn't have any posts yet".

**In:** the home feed, `/r/*` listings, comment pages, user profiles, header, sort tabs, the
`top`/`controversial` time window, sidebar.
**Out (for now):** search, modmail, chat, the post composer, and anything behind a login.

## Future roadmap

Neither of these is started, and both would extend the scope above rather than replace
it. Logged-out reading stays the case everything is tested against.

- **Support logged-in browsing.** The layout works the same either way; what is missing is
  everything a session unlocks — voting that actually votes, saving, subscribed feeds.
- **Bridge logged-in features with logged-out browsing** — an automation script, or
  something like one, so the things that need an account can be reached without giving up
  an unprofiled read.

## Privacy

For most extensions this section is fine print. Here it is the point: an extension built
so you can read without being profiled had better not profile you itself, and had better
be checkable on that claim rather than taken at its word. Everything below is verifiable
from the source in this repository, and the two features that fetch anything are tested
by **counting their requests**, so a change that quietly started fetching more would fail
the build.

Sheddit makes **no API calls** — not to Reddit's, not to anyone else's. There is no
analytics, no telemetry, no remote configuration. Nothing about you is sent anywhere.

Exactly two requests ever leave the browser, both optional, neither about you:

- **A video manifest, to play video.** Opening a video post's comments page reads that
  video's manifest from Reddit's media server, so the player knows which files to load.
  It is a plain request for a static file, sent without cookies, and the same file your
  browser would read to play the video on Reddit itself. At most one per video post
  opened, none anywhere else, and none at all if you untick *"Play video on the comments
  page"* in the options.
- **A version number, if you press the button that asks.** The **updates** control reads
  one static file from this repository. It fires only on that press, with no cookies and
  no referrer. A check that ran by itself would make every install emit a periodic
  request carrying an IP and a timestamp — which is telemetry, whatever it is called. The
  press is the consent.

It requests exactly two permissions:

- `*://*.reddit.com/*` — to run on Reddit pages, the only place it runs
- `storage` — to remember your theme and settings

Loading the next page of posts uses the same anonymous request Reddit's own page already
makes for itself. Nothing is authenticated, and nothing goes anywhere else. See
[PRIVACY.md](PRIVACY.md) and, for the full threat model, [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome — especially **live findings**. The automated tests run on
GitHub's machines, and those cannot see real Reddit: datacenter IPs get served a
bot-mitigation shim instead of the page. One `npm run verify:live` from an ordinary home
connection is often more useful than a patch.

If Reddit ships a redesign and Sheddit breaks, the fix is almost always in
`src/config/contracts.js` and nowhere else. Start at [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm test           # all six suites
npm run test:fast  # css-lint + jsdom only, no browser
npm run preview    # writes openable dist/preview.*.html
npm run build      # dist/sheddit.dev.js — paste into DevTools on any Reddit page
npm run package    # rebuilds both download zips this README links
```

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | why it's built this way, and what was measured to get there |
| [docs/engineering-log.md](docs/engineering-log.md) | every bug found so far, and what each one looked like |
| [TESTING.md](TESTING.md) | how to test, and the traps worth knowing about |
| [OLD-REDDIT.md](OLD-REDDIT.md) | the measured spec of the site this imitates |
| [CHANGELOG.md](CHANGELOG.md) | what changed, and what never worked |

## License

[GPL-3.0-or-later](LICENSE). You may use, study, share and modify Sheddit freely; if you
distribute a modified version, it has to stay free software too.

---

<div align="center">
<sub>Not affiliated with, endorsed by, or connected to Reddit, Inc.<br>
"Reddit" and the Reddit logo are trademarks of Reddit, Inc.</sub>
</div>

<div align="center">

<img src="docs/assets/slava-ukraini.svg" alt="Slava Ukraini" width="300">

</div>
