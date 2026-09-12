<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.png">
  <img src="docs/assets/banner-light.png" alt="Sheddit — modern Reddit, rewritten into the old.reddit.com layout, live, on every page. No account, no profile, no Reddit API. Alongside, a Reddit front page rendered in the old.reddit layout." width="900">
</picture>

### Shed the manipulative endless feed. Keep the conversation.

**Read Reddit without being read back.**

No account. No profile. No feed tuned to keep you scrolling.

[![account: none](https://img.shields.io/badge/account-none-success?style=flat-square)](#why-sheddit)
[![profile: none](https://img.shields.io/badge/profile-none-success?style=flat-square)](#why-sheddit)
[![API calls: zero](https://img.shields.io/badge/API_calls-zero-success?style=flat-square)](#privacy)
[![tracking: none](https://img.shields.io/badge/tracking-none-success?style=flat-square)](#privacy)
[![telemetry: none](https://img.shields.io/badge/telemetry-none-success?style=flat-square)](#privacy)
[![feed: ranked by votes](https://img.shields.io/badge/feed-ranked_by_votes-success?style=flat-square)](#why-sheddit)

[![version 0.46.0](https://img.shields.io/badge/version-0.46.0-ff4500?style=flat-square)](CHANGELOG.md)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-5f99cf?style=flat-square&logo=googlechrome&logoColor=white)](manifest.json)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-install-5f99cf?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/sheddit/jmphfpemcclbhpkanmlglmnggcjmpamc)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-install-ff7139?style=flat-square&logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/en-US/firefox/addon/sheddit/)
[![license: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-663399?style=flat-square)](LICENSE)

### Beta 0.46.0 is out — everyone is welcome to try it

On the [Chrome Web Store](https://chromewebstore.google.com/detail/sheddit/jmphfpemcclbhpkanmlglmnggcjmpamc) and [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/sheddit/) — one click on either.
**Chrome is the better-tested of the two**, so start there if you have the choice.
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

<br>

> ## ⚠️ Logged-in browsing is a work in progress
>
> **Sheddit is built for reading Reddit logged out, and that is the only case it
> officially supports.** Everything the extension is *for* — no profile, no ranked feed,
> nothing following you between pages — is about browsing without a session.
>
> Since 0.34.0 there is an account layer for readers who are already signed in: vote
> arrows, a reply box, submit links. **It is unfinished, it is being actively worked on,
> and it should be treated as experimental.** It works by clicking Reddit's own controls
> on the page, and Reddit moves those controls without warning — so expect parts of it to
> break, expect the occasional jump out to Reddit's own interface, and do not rely on it
> for anything you would mind losing. Reports from signed-in use are welcome and are how
> it gets finished.
>
> **It is off with one checkbox** on the options page, and turning it off changes nothing
> else. Logged out, none of it runs at all.

---

## What's new

Full detail in the [changelog](CHANGELOG.md). The most recent builds:

**0.46.0 — comment voting works**
- **Fixed:** voting on a comment. 0.45.0 said this could not be done from here; that was
  wrong. Reddit builds a comment's vote buttons only when the comment has a position on
  screen, and the stylesheet that hides Reddit's own copy of the page — kept in the
  document because votes and replies go to Reddit's own controls — was also flattening it
  to a single pixel. One rule, two effects, and only the hiding was wanted. The copy is
  hidden the same four ways and keeps its dimensions now, and clicking a comment arrow
  brings the row it needs into view first. Screen readers still get one copy of the page,
  not two, and your place in a thread does not move when you vote.
- **Fixed:** replying to a comment no longer takes you to Reddit's own page to finish.
  `Reply` sits in the same part of Reddit's page and was missing for the same reason; it is
  resolved in place now, so an ordinary reply is posted from Sheddit's box. Carrying your
  draft into Reddit's composer is still the fallback if something else goes wrong.

**0.45.0 — the reply box takes typing, and a dead arrow admits it**
- **Fixed:** you could not type into Sheddit's reply box, and the keystrokes went to
  Reddit as keyboard shortcuts instead — `h` hid the post you were replying to, and one
  key navigated away and took the draft with it. Reddit's shortcut handler did not
  recognise our box as somewhere text goes, so it treated every key as a command and
  cancelled the typing. Keys inside Sheddit's own boxes no longer reach it.
- **Fixed:** voting on a *comment* was a silent no-op — the arrow did not light, the score
  did not move, and nothing said why. It still does not work, and it cannot be made to
  from here: Reddit builds a comment's vote buttons only once the comment is on screen in
  its own layout, and Sheddit's layout is what you are looking at instead. So the arrow
  now says so rather than pretending. Voting on *posts* is unaffected and works.

**0.44.0 — a second adversarial read, and a security fix**
- **Fixed:** a crafted `old.reddit.com` link could run script on your Reddit session. The
  login wall's `dest` was checked for the right host but not the right *scheme*, so a
  `javascript:` destination passed and was handed to the browser to follow. Present in
  every build since 0.33.0. If you install from a store your copy updates itself.
- **Fixed:** a live post whose own title discusses removals — "This post was removed by
  Reddit, anyone know why?" — was drawn as a removed post, stamp and all.
- **Fixed:** leaving an empty listing painted "there doesn't seem to be anything here" over
  the page you were arriving at, and disarmed the failsafe that catches a feed we cannot
  read.
- **Fixed:** changing any setting from Sheddit's header broke the next sort click on a
  thread, leaving it with no submission row and no sort strip.
- **Fixed:** a comment you posted could be reported as sent when what actually arrived was
  somebody else's, discarding your draft while Reddit still held the unposted text.
- **Fixed:** with thumbnails off, an adult picture on a comments page could never be
  revealed — the button to reveal it was clipped out of existence.
- **Fixed:** on the night and carbon themes, two buttons drew white text on a light fill at
  2.4:1 and 2.8:1. They take the page's own background now.
- ...and a dozen more, including the tab bar naming `/r/all` twice and the front page not
  at all. Full detail in the [changelog](CHANGELOG.md).

**0.43.0 — a full read of the code, and what it turned up**
- **Changed:** Sheddit only runs on the Reddit it actually rebuilds. It was loading on
  every `reddit.com` subdomain, including `business.`, `ads.`, `mod.` and `chat.` — real
  applications with their own layouts, which it briefly blanked and then left alone.
- **Fixed:** the startup version check could repeat without limit if your network blocks
  GitHub. Only a *successful* check reset the clock, so a blocked one never did.
- **Fixed:** a reply that Sheddit could not confirm had posted was offered for posting a
  second time, which could double-post a slow reply. It now says it may already have gone
  through and leaves your text where it is.
- **Fixed:** an `old.reddit.com` link to a page Sheddit does not draw — your preferences,
  your inbox, a wiki page, a moderation queue — was being sent to `www.reddit.com`, where
  those pages differ or do not exist. Those links stay on old.reddit now.
- **Documented:** on a subreddit marked adult, Sheddit clicks Reddit's own *over 18*
  button for you. It has done that since 0.30.0 and the privacy policy did not say so; it
  does now, including what it means if you are signed in. The same release made it much
  harder to fire on anything that is not the age gate — an "Open in app" prompt offering
  *Yes* / *Not now* previously matched.

---

## WHAT IS IT?

Sheddit is a browser extension that turns modern Reddit back into old Reddit, on every
page, while you stay logged out.

Reddit already sends your browser every post on the page. Sheddit takes those posts and
redraws them in the `old.reddit.com` layout: a ranked list of links you can scan, pick
from, and leave. It never logs in, never calls Reddit's API, and never sends anything
about you anywhere.

## WHY LOGGED OUT?

- **The feed is a different product.** Logged out it's ranked by votes. Logged in it's
  ranked against a model of you, tuned so the session doesn't end.
- **Durability.** Your account is what welds fifteen years of scrolling and hesitating
  into one profile that follows you across devices. Logged out it scatters.
- **Reading is broader than posting.** Most people don't want every sub they lurk in
  attached to the name they argue under.
- **The record exists.** Voted, saved, visited. A durable list that gets breached,
  subpoenaed, or changes hands in an acquisition.
- **Shared machines.** Work laptop, someone else's browser, a session you don't control.
- **Some people just want to make it harder for Reddit to monetize them.** No grand
  principle, just declining to be the product. And don't forget — u/spez was a moderator
  on r/jailbait.
- **Cambridge Analytica.** Eighty-seven million Facebook profiles, harvested through a
  quiz app, turned into political ad targeting — and the only reason anyone found out was
  a whistleblower. The profiles are richer now and the targeting is better. Anyone who
  thinks that kind of manipulation is a thing of the past is dreaming.

## WHY SHEDDIT?

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

|  | Works logged out | Needs your credentials | Survives an API policy change |
|---|:---:|:---:|:---:|
| **Redirect** to `old.reddit.com` | 🔴 not for long | 🔴 soon | 🔴 n/a — depends on Reddit continuing to host it |
| **Rebuild from the JSON API** | 🔴 no | 🔴 yes | 🔴 no |
| **Rebuild from the page** ← Sheddit | 🟢 yes | 🟢 no | 🟢 yes |

**Redirecting** works until Reddit decides it doesn't: `old.reddit.com` is being phased
out in stages, and the current stage is random, unannounced, site-wide login walls.
**Rebuilding from the API** needs your login, because Reddit blocks the anonymous API
(the [Classic Layout][cl] project documents this). **Rebuilding from the page** is what
Sheddit does. Everything it needs is already in the page Reddit just sent you, so there is
nothing to revoke, expire, or log into.

The catch is that Reddit can quietly rename the parts of its page Sheddit reads, whenever
it likes, and owes nobody notice when it does. That is why this project is free, open
source, and collaborative. When they change something, so will we.

**And when a link takes you there anyway.** Old links, old bookmarks and other people's
posts still point at `old.reddit.com`, where there is now nothing to read: every path
answers with a login wall. A Reddit link that dead-ends looks exactly like the extension
you just installed being broken, so Sheddit does not leave that unexplained — it takes the
page you asked for over to `www.reddit.com`, where it loads and Sheddit draws it, behind a
short notice saying what happened. If you still log in to old reddit and would rather it
were left alone, one checkbox on the options page turns it off.

[cl]: https://github.com/mkornreich/old_reddit

## Install

Version **0.46.0**, beta. It works and is tested on both browsers, **but Chrome is the
primary target and the steadier of the two** — three of the test suites drive a real
Chromium (the packed extension, layout geometry, media playback) against one for Firefox,
and every feature lands on Chrome first. Firefox is genuinely supported and its suite
passes; it simply has fewer miles on it, so a rough edge is likelier there. Either way
Reddit can change something tomorrow that breaks it — if that happens,
[tell me](https://github.com/kookaburrabarrel/sheddit/issues/new/choose). Both store
listings are live, so installing is one click and updates arrive on their own.

### Chrome

**[⬇ Install from the Chrome Web Store](https://chromewebstore.google.com/detail/sheddit/jmphfpemcclbhpkanmlglmnggcjmpamc)**

Then open [reddit.com](https://www.reddit.com). Chrome keeps it updated on its own.

Works in Chrome 111+ and any Chromium browser (Edge, Brave, Vivaldi, Opera).

<details>
<summary>Install by hand instead</summary>

**[⬇ Download sheddit.zip](https://github.com/kookaburrabarrel/sheddit/raw/main/dist/sheddit.zip)**

1. Unzip it. You get a `sheddit` folder with `manifest.json` inside.
2. **Move that folder somewhere permanent** — Documents is fine. Chrome reloads the
   extension from wherever you leave it, so a folder in Downloads disappears the day you
   clear Downloads.
3. Open `chrome://extensions`.
4. Turn on **Developer mode**, top right.
5. Click **Load unpacked** and pick the folder with `manifest.json` *directly* inside it —
   not the folder around that folder.
6. Open [reddit.com](https://www.reddit.com).

Chrome will warn about developer-mode extensions each time it starts. It says that about
anything installed outside the Web Store. Dismiss it.

**To update a hand-install:** download the zip again, replace the folder's contents, then
press ↻ on the Sheddit card in `chrome://extensions`. A hand-installed extension never
updates itself, so the **updates** button in Sheddit's header turns orange once your copy
is 30 days old. Under it, **auto: on/off** decides whether Sheddit asks GitHub for the
current version once when your browser starts — on by default, no more than one request
every twenty hours, and off means nothing leaves until you press the button yourself.
Details in [PRIVACY.md](PRIVACY.md#the-short-version).

</details>

### Firefox

**[⬇ Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/sheddit/)**

Same extension, **fewer miles on it — this is the less-tested of the two builds**, so bug
reports from here are especially useful. Firefox 140+; it updates itself like any other
add-on.

If reddit.com ever loads without the layout, Firefox has revoked the site permission. The
extension's options page will say so and offer a button to grant it back.

<details>
<summary>Install by hand instead</summary>

**[⬇ Download sheddit-firefox.zip](https://github.com/kookaburrabarrel/sheddit/raw/main/dist/sheddit-firefox.zip)**

Loaded this way it is a *temporary* add-on, which Firefox discards when the browser
closes — the store listing above is the one that persists.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick the zip. No need to unzip.

</details>

### From source

```bash
git clone https://github.com/kookaburrabarrel/sheddit.git
```

Then the Chrome steps above, pointing **Load unpacked** at the cloned folder. There is no
build step. See [CONTRIBUTING.md](CONTRIBUTING.md).

## What it does

|  |  |
|---|---|
| **The whole list at once** | Dense rows with rank, score, thumbnail, subreddit and tagline — around nine posts on a laptop screen |
| **Threading that reads like a conversation** | Indented comment trees with guide lines and `[–]` collapse toggles, plus old Reddit's sort menu |
| **Media without leaving the layout** | Video plays on the comments page, sound included; images and galleries render full size; listing rows get the `[+]` expando |
| **Scrolling that ends** | Uses Reddit's own pagination and stops when the feed is spent, instead of spinning to keep the session open |
| **Sorting that asks "of what span"** | `top` and `controversial` carry old Reddit's *links from* window — past hour through all time |
| **Five themes, no reload** | Switched from a button in the header; the choice follows you to every other tab |
| **Adult thumbnails, your call** | Flagged posts show old Reddit's placeholder tile by default; an *nsfw thumbnails* button in the header reveals them, and remembers |
| **Your account, if you have one** *(experimental)* | Already logged in to Reddit? The vote arrows register, `reply` opens an old-reddit reply box, and the sidebar gets *submit a new link / text post* — each a click forwarded to Reddit's own control on the page. Off with one checkbox; nothing changes for a logged-out reader |
| **Old Reddit links that still work** | `old.reddit.com` answers every page with a login wall now; Sheddit catches those links and opens the same page on `www.reddit.com`, in the same layout, behind a notice saying so |
| **Tells you when it breaks** | If Reddit ships markup Sheddit can't read, you get a screen saying so, with a button to hand the page back |
| **Nothing about you leaves your browser** | No Reddit API and no telemetry; your settings live in your browser's own storage and go nowhere else. Three requests exist — a video manifest, and a version file on GitHub asked for on a press and once at browser start — and [PRIVACY.md](PRIVACY.md) describes each |

## Themes

Five palettes, switched from Sheddit's own header. A theme changes colour, type and
spacing, never the layout, and is applied before the page first paints, so a dark theme
never opens on a white flash.

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

Every post on a modern Reddit page carries its whole record — title, score, author, link —
as plain attributes on the page, while the visible parts are sealed where stylesheets
cannot reach. Sheddit reads those attributes, draws its own old-Reddit page alongside, and
hides the original. Every Reddit-specific name it depends on lives in one file, so a
Reddit redesign should only ever break one file.

Why it is built this way: [ARCHITECTURE.md](ARCHITECTURE.md).
How it is tested, in a real Chromium and a real Firefox: [TESTING.md](TESTING.md).
Every bug found so far, and what each one looked like:
[docs/engineering-log.md](docs/engineering-log.md).

## Privacy

For most extensions this section is fine print. Here it is the point: an extension built
so you can read without being profiled had better not profile you itself, and had better
be checkable on that claim rather than taken at its word.

Sheddit makes **no Reddit API calls**, and there is no analytics, no telemetry, no remote
configuration and no server belonging to this project. Nothing about you is sent anywhere.

Three requests can leave the browser. All are optional, none carries a cookie, and none
is about you:

- **A video manifest, to play video**, read from Reddit's media server without cookies —
  the same file your browser reads to play the video on Reddit. Untick *"Play video on
  the comments page"* and it never happens.
- **A version number, when you press the button that asks.** No cookies, no referrer.
- **The same version number, once when your browser starts** — since 0.37.0, on by
  default, and switched off by **auto: off** beside that same button. A hand-installed
  copy never updates itself, and a notice that has to be pressed is one the people
  running a broken build never see; that is the reason it was made automatic, and it is
  worth being blunt about the cost. GitHub, who serve the file, see what any host sees:
  an IP address and a timestamp. No more than one request every twenty hours however
  often you restart, and a failed attempt counts, so a browser that cannot reach GitHub
  backs off rather than retrying at every start.

**One thing Sheddit presses for you:** on a subreddit marked adult it clicks Reddit's own
*over 18* button, without asking. If you are signed in, Reddit records that affirmation
against your account. It is narrowly targeted and it is described in full in
[PRIVACY.md](PRIVACY.md#what-it-presses-for-you).

It asks for two permissions: to run on `reddit.com`, and `storage` to remember your
theme. The tests count every request the extension makes, so a change that quietly
started fetching more would fail the build. Full policy in [PRIVACY.md](PRIVACY.md);
threat model in [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome — especially **live findings**. GitHub's test machines cannot
see real Reddit, which serves datacenter IPs a bot-mitigation page instead. One
`npm run verify:live` from a home connection is often worth more than a patch. If Reddit
ships a redesign and Sheddit breaks, the fix is almost always in one file. Start at
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | why it's built this way, and what was measured to get there |
| [docs/engineering-log.md](docs/engineering-log.md) | every bug found so far, and what each one looked like |
| [TESTING.md](TESTING.md) | how to test, and the traps worth knowing about |
| [OLD-REDDIT.md](OLD-REDDIT.md) | the measured spec of the site this imitates |
| [PRIVACY.md](PRIVACY.md) · [SECURITY.md](SECURITY.md) | what leaves your browser (two things), and the threat model |
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
