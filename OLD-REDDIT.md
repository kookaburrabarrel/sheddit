# old.reddit — captured measurements

**This is a recording of a site that is being retired.** old.reddit.com answered normally on
2026-08-18 after a long spell of being unreachable, which reads as a phased retirement rather
than a reprieve. Everything below was harvested that day by injecting a computed-style
probe into both pages and reading the same selector set off each. When old.reddit goes, this
file is the only thing left that says what this extension is imitating — treat it as the
spec, not as a report someone once wrote.

`npm run verify:live` checks `contracts.js` against *new* Reddit. There is no equivalent for
this file and there cannot be one again. Do not "correct" a value here against memory.

## Provenance and its limits

- **A side:** old.reddit.com at 878–911px. **B side:** www.reddit.com with Sheddit at 1264px.
- The two tabs were different widths, so raw x/width numbers are **not** comparable between
  sides. Fonts, colours, padding, margin and border values are unaffected and *are*.
- Element widths that are content-driven (old reddit floats `.rank` and `.midcol`, so both
  shrink-to-fit) describe *that page's* content, not a fixed column.
- Pages covered: front page, a comments page, a subreddit listing. Search, profiles, wiki,
  inbox and the submit form were never reached — and Sheddit does not claim those routes.

## What was acted on

Implemented, with the assertion that now protects each:

| Measurement | Change | Guarded by |
|---|---|---|
| action row is one grey, `#888` | dropped the accent override on `a.comments` | — (value only) |
| `.side` is an unboxed column | `--shd-panel` / `--shd-panel-border` transparent, no padding | — (value only) |
| header is `#cee3f8` on `#5f99cf` | `--shd-topbar-bg` repointed, border to `--shd-header-border` | — (value only) |
| every tab is a bordered white folder-tab, orangered text | `.tabmenu li a` rewritten; new `--shd-tab-text` | css-lint (theme completeness) |
| thumbnails are bare 70x70 | 70x70 border-box; the tile treatment kept for placeholders only | geometry x2 |
| `.rank` is arial 16px `#c6c6c6`; `.score` is `#c6c6c6` | `--shd-arrow` renamed `--shd-dim`, applied to all three; columns rewidened | css-lint (width vs font-size) |
| score is 13px in a 43.5px column | `.midcol` 13px / 43px, 6px gutter beside `.rank`, row padding 88px | css-lint x3, geometry |
| thread line is on `.child`, blue-tinted, 25px/level | line moved to `.child`; arrow gutter moved to `.entry` | css-lint x2, geometry |
| comment vote arrows are painted at rest | dropped the hover gate | geometry |

## What was NOT acted on, and why

**`body { font-size: 10px }` — rejected.** The report ranks this first and expects the
smaller diffs to resolve themselves. That reasoning holds for old.reddit, which sets a 10px
root and sizes everything downstream in **ems**. Sheddit sizes in **absolute px** almost
everywhere — `.tagline` 10px, `.domain` 10px, `a.title` 16px, `.usertext-body` 14px — which
the report's own table confirms already match. Changing the root would therefore fix nothing
downstream and would shrink the few things that *do* inherit (the theme buttons, the sidebar
note). Verified by reading the stylesheet, not by taste.

**`.md` at 14px `#222` — the font-size half is a false positive.** Sheddit renders no `.md`
element. It clones Reddit's own rendered body node into `div.usertext-body`, which declares
`font-size: 14px`, so the inner node inherits exactly the measured value. The probe read a
node one level in from the one that carries Sheddit's rule.

**`body { background: #fff }` — near-invisible, and not what it looks like.** `#dae0e6` is
Sheddit's own `--shd-page-bg`, not something inherited from the host page, and `#shd-root`
paints `--shd-bg` over the full viewport (`min-height: 100vh`) on top of it. It is also a
themed token: forcing it white would be right for classic and wrong for every dark palette.

**Missing features — recorded, not built.** The `.nextprev` pager, the footer, and the
sidebar's description / subscriber count / subscribe button / `.morelink` / `#sr-header-area`
all need post or subreddit data that is not currently read. Each one is a new entry in
`contracts.js`, and a contract cannot be added honestly from a container — `verify:live`
needs a real machine. The specs above are complete enough to build from the moment someone
can confirm the attribute names.

Two of the entries that were on that list have moved since it was written, and the list is
corrected here from the source rather than from memory, which is the only correction this
file permits:

- **The comments sort bar is built.** `comments.js` renders old reddit's `div.menuarea`
  strip above the tree — `all N comments`, then `sorted by:` — and takes the current sort
  from `route.sortQuery` rather than `location.search`, because the sort swap can read
  during the pre-commit window and bold the sort the reader just left.
- **Flair is read but not rendered.** The blocker moved: `contracts.js` and `model.js`
  carry the field, so the pill is now a rendering job in `listing.js`, not a contract that
  needs a live machine to confirm. The spec for it above still stands.

**The reply textarea, search box and user bar are out of scope** — all auth-gated, and
`README.md` "Scope" rules them out for the same reason `save` and `report` were removed.

## One thing the report found without naming it

Its Sheddit-side `.md` row reports `border-radius: 8px`. That value appears **nowhere** in
this extension's stylesheets. It comes from *Reddit's own* stylesheet: Sheddit clones Reddit's
rendered comment body (`[slot="comment"]`) into its own tree, and that tree is in the same
document, so Reddit's page CSS still matches it. Comment bodies are the one part of Sheddit's
layout Reddit can restyle from underneath it at any time. No fixture can catch this — they
ship the markup but not Reddit's stylesheet — so it is filed as an open question in
`docs/engineering-log.md` rather than fixed blind.

---

Captured 2026-08-18 by injecting a computed-style harvester into both pages
and probing the same selector set on each.

- **A side:** `old.reddit.com` (viewport 878–911px)
- **B side:** `www.reddit.com` with Sheddit active (viewport 1264px)

Pages compared: front page, comments page, subreddit listing — same thread
(`r/FirstTimeHomeBuyer` → "…looking on Zillow…") on both sides.

> **Caveat on geometry.** The two tabs were in different windows at different
> widths, so raw `box` x/width numbers are not directly comparable. Fonts,
> colors, padding, margin, and border values are unaffected and *are*
> comparable. Where a width matters below, it's called out explicitly.

Good news up front: Sheddit already reuses old.reddit's class vocabulary
(`.thing`, `.midcol`, `.entry`, `.tagline`, `.flat-list`, `#siteTable`,
`.side`), so almost everything below is a value change in existing rules
rather than new markup.

---

## 1. The one that matters most: base type scale

| | old.reddit | Sheddit |
|---|---|---|
| `body` font-family | `verdana, arial, helvetica, sans-serif` | `Verdana` ✅ |
| `body` font-size | **`10px`** | **`12px`** ❌ |
| `body` line-height | `normal` | `18px` |
| `body` background | `rgb(255,255,255)` | `rgb(218,224,230)` ❌ |

old.reddit sets a **10px** root and sizes everything else in ems against it.
Sheddit's 12px root means every inherited size downstream lands ~20% large,
and it's why several of the individual mismatches below exist. **Fix this
first** — a number of the smaller diffs will resolve themselves.

The body background is the other immediately visible one: old.reddit is plain
white; Sheddit paints a blue-grey `#dae0e6` behind the content column. (That
`#dae0e6` is the *new* reddit body color, so this is likely inherited from the
host page rather than intentional.)

---

## 2. Header / chrome

| element | old.reddit | Sheddit |
|---|---|---|
| header bg | `rgb(206,227,248)` (pale blue) | `rgb(240,240,240)` (grey) ❌ |
| header border-bottom | `1px solid rgb(95,153,207)` | `1px solid rgb(204,204,204)` ❌ |
| header height | `64px` (65 w/ border) | `33px` (42 w/ padding) ❌ |
| logo | `#header-img`, 120×40 background-image snoo | text wordmark, no image |
| `#sr-header-area` top strip | **present** — 18px tall, `bg rgb(240,240,240)`, `border-bottom 1px solid rgb(128,128,128)`, `font-size 9px`, `text-transform uppercase`, `white-space nowrap`; links are `font-style italic`, `color rgb(51,102,153)`, `border-top 1px dotted rgb(51,102,153)`, padding `2px 3px 1px` | **absent** ❌ |
| user bar `#header-bottom-right` | `position absolute`, `bg rgb(239,247,255)`, `padding 4px`, `border-radius 7px 0 0` | absent |
| search input | `300px` wide, `font-size 13px`, `1px solid rgb(128,128,128)`, padding `6px 25px 6px 9px` | absent |

Sheddit's grey header is the single biggest visual departure from old.reddit's
blue. Swapping `#shd-header`'s background to `#cee3f8` and its bottom border
to `#5f99cf` gets most of the way there; the missing 30px of height is the rest.

### Tab menu (hot / new / rising / …)

| | old.reddit | Sheddit |
|---|---|---|
| unselected link color | `rgb(255,69,0)` (orange) | `rgb(51,102,153)` (blue) ❌ |
| unselected bg | `rgb(255,255,255)` | `rgb(206,227,248)` ❌ |
| unselected borders | `1px solid rgb(95,153,207)` top/left/right, `1px solid #fff` bottom | all four transparent ❌ |
| selected | same as above (white, bordered, orange) | white bg + `#5f99cf` borders + `#fff` bottom ✅ |
| padding | `2px 6px 0 6px` | `3px 6px` |
| ul display | `inline-block`, `white-space nowrap`, `margin-top 5px` | `flex` |

Sheddit gets the *selected* tab exactly right but renders unselected tabs as
flat blue pills. old.reddit draws **every** tab as a bordered white "folder
tab" with orange text — only the bottom border differs between states. That's
the fix: give unselected tabs the same white bg + `#5f99cf` top/left/right
border treatment, color them `#ff4500`, and let the bottom border carry the
selected state.

---

## 3. Listing row (`.thing`)

| element | property | old.reddit | Sheddit |
|---|---|---|---|
| `.thing` | spacing | `margin-bottom 8px`, `padding-left 3px` | `margin-bottom 6px`, `padding-left 62px` |
| `.rank` | font | **`arial` 16px** | inherits Verdana, `14px` ❌ |
| | color | `rgb(198,198,198)` | `rgb(136,136,136)` ❌ |
| | layout | `float left`, `margin-top 15px`, `width 18.25px` | `position absolute`, `width 26px`, no top offset ❌ |
| `.midcol` | font-size | `13px` | `11px` ❌ |
| | width | `43.47px` | `34px` ❌ |
| | layout | `float left`, `margin 0 7px` | `position absolute` |
| `.arrow` | size | `15×14`, `margin 2px 14.23px` | `15×14` ✅, `margin 0 9.5px` |
| `.score` | color | `rgb(198,198,198)` | inherits `rgb(136,136,136)` ❌ |
| `.thumbnail` | size | **`70×70`** | **`70×52`** ❌ |
| | border | *none* | `1px solid rgb(211,213,215)` ❌ |
| | background | *none* | `rgb(239,241,243)` ❌ |
| | margin | `0 5px 2px 0` | `0 8px 5px 0` |
| `.entry` | margin-left | `3px` | `0` |
| `p.title` | font-size | `16px` | — (set on the anchor) |
| `a.title` | size/color | `16px`, `rgb(0,0,255)` | `16px`, `rgb(0,0,255)` ✅ |
| | line-height | inherits (`normal` @10px) | `19.2px` |
| `.domain` | | `10px`, `rgb(136,136,136)`, `white-space nowrap` | `10px`, `rgb(136,136,136)` ✅ |
| `.tagline` | | inherits 10px, `rgb(136,136,136)` | `10px`, `rgb(136,136,136)` ✅ |
| `.tagline .author` | | `rgb(51,102,153)`, `margin-right 5px` | `rgb(51,102,153)` ✅ |
| `.flat-list` buttons | color | **`rgb(136,136,136)`** bold | **`rgb(51,102,153)`** bold ❌ |
| | layout | `li` `inline-block`, `padding-right 4px` | `flex`, `li` `list-item`, `margin-right 8px` |
| | count | 5 — comments · share · save · hide · report | 3 — comments · share · hide |
| `.linkflairlabel` | | present: `10px`, `rgb(85,85,85)` on `rgb(245,245,245)`, `1px solid rgb(221,221,221)`, `radius 2px`, `max-width 100px` | **absent** ❌ |

**Highest-impact row fixes, in order:**

1. **Button links** — `#888` not `#336699`. This is the most noticeable
   per-row difference; old.reddit's action row recedes into grey, Sheddit's
   reads as a row of blue links competing with the title.
2. **Thumbnails** — 70×70 with no border and no background fill. Sheddit's
   52px-tall bordered grey box changes the rhythm of the whole list.
3. **Rank** — Arial 16px `#c6c6c6` with `margin-top: 15px`. Sheddit's is
   Verdana, smaller, darker, and top-aligned.
4. **Score color** — `#c6c6c6`, distinctly lighter than the `#888` tagline.
   Sheddit uses one grey for both, flattening the hierarchy.
5. **Flair pills** — not implemented at all; spec above is complete enough to
   add directly.

---

## 4. Comments page

| element | property | old.reddit | Sheddit |
|---|---|---|---|
| `.comment` | indent | `margin-left 10px`, no padding, **no border** | `padding-left 22px`, **`border-left 1px dotted rgb(221,221,221)`** |
| `.comment .child` | indent | `margin-top 10px`, `margin-left 15px`, **`border-left 1px dotted rgb(221,221,255)`** | `margin-left 8px`, **no border** |
| `.midcol` (vote arrows) | | `15px`, `float left`, `margin-right 7px`, **visible** | `15px`, `position absolute`, **renders 0×0 — arrows not shown** ❌ |
| `.tagline` | | inherits 10px, `rgb(136,136,136)` | `10px`, `rgb(136,136,136)` ✅ |
| `.author` | | `bold`; `rgb(34,136,34)` green for moderators | `bold rgb(51,102,153)`; no distinguish colors ❌ |
| `.expand` (`[-]`) | | `rgb(51,102,153)`, `padding 1px` | no color override ❌ |
| `.md` body | font-size | **`14px`** | inherits ❌ |
| | color | **`rgb(34,34,34)`** | inherits `#000` ❌ |
| | box | `margin 5px 0`, `max-width 840px` | `padding-bottom 4px`, **`border-radius 8px`** (not an old.reddit trait) |
| `.md p` | | `line-height 20px`, `margin-bottom 5px` | `margin-bottom 8px` |
| button links | | **bold** `rgb(136,136,136)`, `padding 0 1px` | `rgb(136,136,136)`, not bold ❌ |
| | count | permalink · save · parent · report · reply (+more) | permalink · reply |
| sort bar `.menuarea` | | `12px`, `rgb(128,128,128)`, `margin 0 310px 10px 10px`; dropdown is bold with a caret background-image | **absent** ❌ |
| reply textarea | | present | absent |

**The nesting border is on the wrong element.** old.reddit puts a dotted
`rgb(221,221,255)` — note the *blue* tint — on `.child`, the wrapper around
replies. Sheddit puts a dotted neutral `#ddd` on `.comment` itself. The result
looks close but the guide line starts and stops at different points in the
tree, and it's grey instead of blue. Moving the border to `.child` and using
`#ddddff` matches exactly.

Per-level indent also differs: old.reddit totals **25px** (`.child` 15 +
`.comment` 10); Sheddit totals **30px** (`.child` 8 + `.comment` padding 22).

### Self-post body

old.reddit wraps selftext in a distinctive box that Sheddit doesn't reproduce
at all:

    background: rgb(250,250,250);
    border: 1px solid rgb(51,102,153);
    border-radius: 7px;
    padding: 5px 10px;
    margin: 5px 0;
    font-size: 14px;
    color: rgb(34,34,34);
    max-width: 840px;

---

## 5. Sidebar

| element | old.reddit | Sheddit |
|---|---|---|
| `.side` | `300px`, `float right`, `margin 0 5px`, **no border, no background, no padding** | `300px`, `float right`, `margin 10px`, `padding 8px`, `bg rgb(247,247,247)`, `1px solid rgb(212,212,212)`, `font-size 11px` ❌ |
| `.morelink` CTA | `15px bold`, `letter-spacing -1px`, `line-height 29px`, `1px solid rgb(196,219,241)`, gradient bg image, label `rgb(51,102,153)` | **absent** ❌ |
| `.titlebox h1` | **`arial` 19px bold**, `margin-bottom 5px` | no font override ❌ |
| `.titlebox .md` | `12px`, `rgb(34,34,34)`, `max-width 720px` | **absent** — no sidebar description ❌ |
| subscriber count | present | absent |
| subscribe button | `10px bold`, white on gradient, `1px solid rgb(68,68,68)` | absent |
| `.sidecontentbox .title h1` | `13px`, **`text-transform uppercase`**, `rgb(128,128,128)` | absent |
| moderators box | present | absent |

old.reddit's sidebar is an **unboxed column** — the individual widgets inside
it carry their own borders, but `.side` itself is transparent with no chrome.
Sheddit draws one grey bordered card around the whole column, which reads as a
distinctly different design language. Dropping the background/border/padding
on `.side` is a one-line change with a large payoff.

Sheddit's sidebar currently holds only the subreddit name and a note. The
subreddit description (`.titlebox .md`), subscriber count, subscribe button,
and the uppercase-heading content boxes are the bulk of what old.reddit puts
there.

---

## 6. Footer

| | old.reddit | Sheddit |
|---|---|---|
| `.footer` | `max-width 600px`, auto-centered, `display flex`, `1px solid rgb(240,240,240)`, `border-radius 7px`, `padding 5px`, `margin 15px auto`, `color rgb(128,128,128)`; 4 columns at `150px` | **absent** ❌ |
| `.nextprev` pager | present | **absent** (replaced by `.shd-loadmore`) |

Sheddit's `.shd-loadmore` button (`bold rgb(51,102,153)` on `rgb(206,227,248)`,
`1px solid rgb(95,153,207)`, `padding 4px 10px`) has no old.reddit equivalent —
old.reddit paginates with `‹ prev` / `next ›` links instead. Worth keeping as a
deliberate improvement, but if strict fidelity is the goal, the `.nextprev`
pattern is what to mirror.

---

## 7. Sheddit-only elements

These have no old.reddit counterpart. Not defects — just noting them as
deliberate additions:

- `.shd-themebar` — the classic / slate / sepia / night / carbon switcher
- `.shd-note` — the "Rendered locally from page data. No API calls." box
- `.shd-loadmore` / `.shd-sentinel` — pagination replacement
- `front / all / popular` pills in the header (old.reddit puts subreddit
  links in `#sr-header-area` instead)

One incidental finding: `<html>` still carries `theme-beta theme-dark`
alongside `shd-active`. Harmless today since Sheddit's own rules win, but it's
a latent specificity trap if new reddit's dark-mode variables are ever read by
a rule you add later.

---

## 8. Suggested fix order

Ranked by visual payoff per unit of effort:

1. `body` → `font-size: 10px`, `background: #fff`
2. `.side` → drop the background, border, and padding
3. `.flat-list` button links → `#888`
4. Header → `#cee3f8` bg, `#5f99cf` bottom border, taller
5. Unselected tab menu items → white bg, `#5f99cf` borders, `#ff4500` text
6. Thumbnails → `70×70`, no border, no background
7. Comment nesting border → move to `.child`, color `#ddddff`, indent 25px
8. `.rank` → Arial 16px `#c6c6c6`, `margin-top: 15px`; `.score` → `#c6c6c6`
9. Selftext box → `#fafafa` on `1px solid #336699`, radius 7px
10. Add `.linkflairlabel`, comment vote arrows, sort bar, footer

Items 1–3 alone close most of the perceived gap.

---

## Not yet covered

Search results, user profiles, wiki pages, the inbox, and the submit form
weren't reached before the session was interrupted. Sheddit's front page,
comments, and subreddit listing are confirmed working; whether it styles those
other five page types at all is still an open question and worth checking
before writing rules for them.
