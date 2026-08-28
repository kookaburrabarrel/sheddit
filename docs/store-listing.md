# Store listings — copy and answers

Everything the submission forms ask for, written out so it can be pasted rather than
improvised at 11pm in a text field with no undo. Field limits are the stores' own.
The Chrome Web Store listing is first; the addons.mozilla.org section is at the end and
leans on this one, because the copy is deliberately shared.

The upload itself comes from `npm run package`, which runs the full suite first and then
writes `dist/sheddit.zip` from a fixed list — `manifest.json`, `icons/`, `src/`,
`options/` — with nothing from `test/`, `docs/`, `.github/` or the root markdown. Because
that list is fixed rather than read out of the manifest, two things are worth knowing: a
future manifest that references a path outside those four ships a zip missing it, and
`icons/icon.svg` goes in today despite the manifest never naming it (harmless, ~1KB).

The listing images live in `docs/assets/` and are already at the required sizes; see the
asset checklist below.

---

## Item name

*(store limit: 75 characters)*

```
Sheddit — old.reddit.com layout for new Reddit
```

**Why not lead with "Reddit".** Store policy prohibits a listing that implies affiliation
with or endorsement by another company. A name beginning "Reddit …" reads as an official
Reddit product; a distinct name that *describes* what it works on does not. The
disclaimer at the foot of the description does the rest of that work.

## Summary — NOT a form field

The dashboard shows this as "Summary from package" and will not let you type into it. It
is `manifest.json`'s own `description`, read out of the uploaded zip:

```
Renders modern Reddit in the classic old.reddit.com layout, locally in your browser. No API, no login, no tracking.
```

115 characters, against a 132 limit. It leads with "locally" and closes on "no tracking"
because that is the question a reader of an extension that rewrites a site they browse
actually wants answered. Changing it means editing the manifest, bumping the version and
re-uploading — not editing the listing. Worth knowing before you go looking for the field.

## Description — the empty box under the summary

*(store limit: 16,000 characters)*

This is the one to fill in. Do not paste the summary into it: that line is already on
screen immediately above, and this field is both what a visitor reads to decide and what
the store indexes for search. Repeating ninety characters into a sixteen-thousand
character box is the whole listing's worst trade.

```
Sheddit re-renders modern Reddit into the classic old.reddit.com layout as you browse —
built for reading logged out, with nothing measuring you while you read.

A modern feed is a feedback loop: it measures what you pause on, what you expand, what
you come back to, builds a profile from those measurements, and arranges what you see
next to keep the session going. That loop works best when you are logged in and every
visit lands in one durable profile — which is why reading logged out keeps getting
harder, from login prompts that cannot be dismissed to the classic site disappearing
behind account requirements.

Sheddit is built for the other direction. It takes the page Reddit already sent your
browser and redraws it locally: no account, no login, no API calls, no server in the
middle. What you read is the list Reddit serves to a stranger — ranked by votes, not by
a profile of you — in the dense, readable layout old.reddit.com had. If Sheddit cannot
render a page, it gets out of the way and leaves Reddit exactly as it was.

WHAT YOU GET

• The classic listing: compact rows, ranks, scores, thumbnails, subreddit and author
  lines — the density that fits a screenful of posts instead of three.
• The classic comment tree: threaded, collapsible, with the indentation lines that make
  a long argument readable — and old reddit's sort menu (best, top, new, controversial,
  old, q&a) with an "all N comments" link above it.
• Video posts that play on their comments page, sound included.
• Image posts that show their image — full size on the comments page, galleries with
  every frame, and old reddit's [+] expando on listing rows.
• User profile pages in the same layout.
• Paging that ends: the next page loads as you read, driven by Reddit's own loader, and
  stops when the feed is spent instead of spinning to keep the session open.
• Five themes — classic, slate, sepia, night and carbon — switchable from the header.
  Classic is old.reddit.com as it was: Verdana, blue links, square corners.
• Adult thumbnails behind old reddit's placeholder tile, with a one-click reveal in the
  header when you want them.
• An options page for turning any of it off: listings, comments, profiles, thumbnails,
  compact rows, auto-paging, inline video and images.

PRIVACY

For an extension whose point is reading without being profiled, privacy is the product,
not the fine print. Sheddit collects nothing and transmits nothing about you. It makes
no API calls, has no analytics, and stores exactly one thing: your display preferences,
in Chrome's own settings storage. It never sees your Reddit login or session. To play a
video post it reads that video's manifest from Reddit's media server — a static file,
fetched without cookies, switchable off in the options — and the test suite counts those
requests, so a change that quietly fetched more would fail the build. The full policy is
at https://github.com/kookaburrabarrel/sheddit/blob/main/PRIVACY.md

OPEN SOURCE

GPL-3.0-or-later. The entire source, including the test suite the layout is checked
against, is at https://github.com/kookaburrabarrel/sheddit — so every claim above is
something you can verify rather than something you have to take on trust.

Not affiliated with, endorsed by, or connected to Reddit, Inc. "Reddit" is a trademark
of Reddit, Inc., used here only to describe what this extension works on.
```

## Category and language

- **Category:** Social & Communication
- **Language:** English (UK) — the source and copy use British spelling.

---

# Privacy practices tab

## Single purpose

```
Sheddit re-renders pages on reddit.com into the old.reddit.com layout. It reads the post
and comment data already present in the loaded page and draws an alternative layout from
it. That is its only function.
```

## Permission justifications

Each of these is a separate required field; the form will not submit until all three are
answered.

**`storage`**

```
Stores the user's display preferences: which colour theme they chose, which page types
Sheddit should re-render (listings, comments, profiles), and layout toggles such as
compact rows, thumbnails, auto-paging and inline media. Eleven boolean-or-string values
in one object. No identifiers, no browsing data, nothing derived from what the user
reads.
```

**Host permission `*://*.reddit.com/*`**

```
The extension's entire function is re-rendering Reddit's own pages, which requires
running on those pages. Access is limited to reddit.com and used only to read the
already-loaded document and draw a replacement layout into it. old.reddit.com and
reddit.com/media are explicitly excluded in the manifest, because neither needs it. No
other host is requested, and no data leaves the page.
```

This is the one a reviewer actually reads, and the reason a submission with a broad host
permission takes days rather than hours. It is written to be checkable rather than
reassuring: the exclusions it cites are real lines in `manifest.json`.

**Remote code**

Not a text box. The requirement is satisfied by selecting **"No, I am not using remote
code"** — the error appears because neither radio is chosen, not because prose is
missing. Verified against the tree: `eval`, `new Function`, dynamic `import()`, `.src =`
and `innerHTML` return zero hits across `src/` and `options/`.

If a justification is demanded anyway:

```
The extension executes no remote code. All JavaScript and CSS is contained in the
uploaded package. There is no eval, no new Function, no dynamic import, and no remotely
hosted script. The extension makes no API calls. Its only request is a GET of a static
video manifest from Reddit's own media CDN, used to select which video file to play; it
carries no credentials and returns data, never code.
```

## Data usage disclosures

Tick **nothing** in the data-collection list. Sheddit collects none of the categories —
not personally identifiable information, health, financial, authentication, personal
communications, location, browsing history, user activity, or website content.

The video manifest request does **not** change this, and the reasoning is worth having
to hand if a reviewer asks: the categories are about data *collected from the user*, and
that request sends none — no cookies (`credentials: 'omit'`), no identifiers, no page or
account data. It is an outbound GET for a static file that Reddit's own player
reads to play the same video. Nothing is transmitted about the person using it, which is
the test each category applies.

Then certify all three:

- Not being sold to third parties, outside of approved use cases — **yes**
- Not being used or transferred for purposes unrelated to the item's single purpose — **yes**
- Not being used or transferred to determine creditworthiness or for lending — **yes**

**Privacy policy URL:**

```
https://github.com/kookaburrabarrel/sheddit/blob/main/PRIVACY.md
```

This resolves only while the repository stays public. If it ever goes private the URL
404s for the reviewer and the description's "verify it yourself" claim stops being true,
so treat visibility as load-bearing for the listing rather than a preference.

---

# Assets checklist

| Asset | Requirement | File |
| --- | --- | --- |
| Store icon | 128×128 PNG, artwork 96×96 with 16px transparent padding | `icons/icon128.png` |
| Screenshot | 1–5 allowed, exactly 1280×800 or 640×400, full bleed, square corners | `docs/assets/store-screenshot.png` (1280×800) |
| Small promo tile | 440×280 PNG or JPEG | `docs/assets/store-tile-440x280.png` (440×280) |
| Marquee promo tile | 1400×560, optional, only used if the item is featured | `docs/assets/store-marquee.png` (1400×560) |

All three listing images are already at their exact required sizes. The `-source` files
alongside them are the full-resolution originals, kept so the assets can be recut without
starting over; they are not uploaded.

Only one screenshot exists and the store accepts up to five. One is enough to submit —
but the slots are free, and a listing that shows the comment tree and a dark theme as
well as the front page answers more of what a visitor is deciding about.

---

# Submission checklist

1. Bump `version` in `manifest.json`, `package.json` **and the README** (badge, header
   line, install block), by hand — the store refuses an upload whose version is not
   higher than the published one, and a README that still names the previous version
   tells every reader their current copy is the new one. `npm test` asserts the four
   agree, so run it before uploading rather than trusting the edit.
2. `npm run package` — runs the full suite first and stops on a red test, then writes
   `dist/sheddit.zip`.
3. Load that zip unpacked and click through a listing, a comment page and the options
   page. The zip is what reviewers get; test the zip, not the repo.
4. Upload it, fill the tabs above, submit.
5. Tag the release in git with the version you submitted, so the published build can be
   matched to a commit later.

## Notes for a first submission

- The developer account costs a one-time US$5 and its email address cannot be changed
  afterwards.
- New publishers are limited to two extensions initially.
- A broad host permission draws a manual review. Expect days, not hours.
- Publishing can be deferred up to 30 days after approval.
- Repository visibility changes process asynchronously on GitHub's side. A second request
  while one is still settling is rejected with "a previous visibility change is still in
  progress" — that is the lock, not a failure, and the first change has usually already
  taken effect.

---

# addons.mozilla.org (Firefox)

The upload is `dist/sheddit-firefox.zip` from `npm run package` — same files as Chrome's
zip, with the manifest derived by `firefoxManifest()` in `package-extension.js`. That
transform already answers the AMO-specific manifest questions, so they are decisions
made once in code rather than in a form:

- **Add-on id**: `sheddit@kookaburrabarrel.github.io`, an identifier in AMO's email-like
  format, not a mailbox. It is permanent — changing it after the first submission
  orphans every installed copy.
- **Minimum version**: Firefox 140.0, and Firefox for Android 142.0 in a `gecko_android`
  block. The floor is the newest key in the manifest, not the oldest requirement: the
  `world: "MAIN"` content script (the bridge) needs 128, but the data-collection
  declaration below is only read from 140 (142 on Android), and AMO warns about a key
  declared beneath the version that reads it. 140 is the current ESR, so the floor costs
  no supported user. The `gecko_android` block is also what lists the add-on as
  Android-compatible — the layout is desktop old-reddit and untested on a phone.
- **Data collection**: declared in the manifest itself
  (`data_collection_permissions: { required: ["none"] }`), which AMO requires of new
  submissions and surfaces on the listing. "None" is the truthful answer and doubles as
  a selling point: the manifest, not the marketing, is what attests it.

## Copy

The name, description and single-purpose text transplant from the Chrome sections above
unchanged — AMO's description field takes the same text, and its **Summary** field
(editable, unlike Chrome's) takes the manifest description line verbatim. Category:
choose the closest to social/news reading AMO offers at submission time. The privacy
policy URL is the same `PRIVACY.md` link.

## Review notes

Worth stating in the "notes to reviewer" box, because it makes the review short: the zip
contains plain unminified source — no build step, no bundler, no generated code — so the
uploaded files ARE the source and no source-code package accompanies the submission. The
extension makes no API calls; its one request class is a GET of Reddit's static video
manifest, discussed in PRIVACY.md.

Pre-flight, before uploading:

```bash
npm run package
mkdir -p /tmp/shd-ff && unzip -o dist/sheddit-firefox.zip -d /tmp/shd-ff
npx web-ext lint -s /tmp/shd-ff       # AMO's own linter; warnings are worth reading
```

## What signing changes

Until the listing exists, Firefox only accepts the zip as a *temporary* install
(about:debugging, gone on restart) — the README says so. AMO review produces a signed
build, which installs permanently; at that point the README's Firefox section should
point at the AMO page and keep the zip link for people who prefer to sideload the
reviewed source.
