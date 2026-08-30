# Store promo cards

The two promotional images the Chrome Web Store asks for, and the source they are built
from. Both are generated:

```bash
node docs/promo/render.js                    # writes both into docs/assets/
node docs/promo/render.js tile               # just the small one
node docs/promo/render.js --out /tmp/look    # somewhere else, to check before committing
node docs/promo/render.js --scale 2          # 2x, for reading the type up close
```

| Card | Size | Written to | Store field |
| --- | --- | --- | --- |
| `tile.html` | 440×280 | `docs/assets/store-tile-440x280.png` | Small promo tile — **required** |
| `marquee.html` | 1400×560 | `docs/assets/store-marquee.png` | Marquee promo tile — optional, used if the item is featured |

`--scale` magnifies by raising the device scale factor, so the type is rasterised at the
higher resolution rather than upscaled. It is for looking, not for uploading — the store
wants the exact sizes above and nothing else.

`npm run promo` is the same command. `promo.css` holds everything the two cards share and
`promo.js` prepares the icon for both; each card's own file holds only the numbers that
differ. The browser driving lives in the repository root's `headless.js`, shared with
`export-icons.js`. Nothing here ships: `package-extension.js` builds the zip from a fixed
list — `manifest.json`, `icons/`, `src/`, `options/` — so `docs/` never reaches a user.

## Why they are generated rather than drawn

`listing.html` is the product shot, and it is not a mockup of the layout. It links
`src/styles/old-reddit.css` and `src/styles/themes.css` directly and uses the class names
`src/modules/listing.js` and `src/modules/chrome.js` really emit, so the artwork is a
screenshot of the extension's own output. Change a colour in the classic palette, re-run
`render.js`, and the store art follows. Artwork that cannot drift away from the product is
the entire reason this is a script and not a layered file in a design tool.

It renders inside an `<iframe>`, and that is load bearing: `old-reddit.css` styles
`html.shd-active body` with `!important`, so dropped into the card's own document it would
repaint the card.

Two numbers in there are worth knowing before editing:

- **The iframe's width picks whether the sidebar appears.** `old-reddit.css` drops
  `#shd-sidebar` below 1100px. The marquee renders at 1080 and the tile at 700, so neither
  shows it — at those scales its 10px note would be a few pixels tall, and on the marquee
  half of it would fall off the card anyway.
- **The row count is a crop dependency.** Both cards crop `listing.html` to a fixed height.
  Ten posts overfill the taller crop; trim the list and the bottom of the product shot
  becomes an empty white rectangle.

## What the store requires, and what enforces it

`render.js` reads the PNG header it just wrote and fails loudly on either hard requirement:

- **Exact pixel size.** 440×280 and 1400×560, no tolerance.
- **24-bit, no alpha.** Every layer on both cards is opaque, so Chrome writes truecolour
  RGB. If the check reports an alpha channel, something on the card is letting the page
  background through — fix the card, don't strip the channel.

Three things the store's policies rule out, so that a later edit does not put them back:

- **No Chrome or Google branding, and no "Add to Chrome".** A promo image may not carry the
  store's own furniture.
- **No Reddit marks.** No alien, no wordmark, no screenshot of Reddit's own interface. The
  product shot is *our* layout, which is the thing being sold, and the only Reddit-owned
  string on either card is the descriptive "old.reddit.com" — the same basis on which the
  listing name uses it (see `docs/store-listing.md`).
- **Nothing implying affiliation or endorsement.**

## The icon

Both cards reference `docs/assets/store-icon.png` rather than holding a copy, so
re-exporting the icon reaches the store art on the next run and there is no second copy to
forget.

That file is 128×128 with **no alpha**: the artwork sits on an opaque pale-blue field
(~`#cfebfe`), and the antenna deliberately breaks up out of the rounded tile into it. Drop
it on a card as-is and it reads as a pale rectangle stuck to a gradient, with any box-shadow
tracing the rectangle instead of the shed — and cropping is no answer either, because a box
tight enough to lose the field also cuts the antenna off.

So `promo.js` keys the field out at render time: flood-fill inward from the border (not a
global colour key, or it would punch a hole through the antenna's pale-centred ring), then
recover the true colour of the part-covered edge pixels so no pale rim survives. It reads
the pixels back off a canvas, which is why `render.js` passes
`--allow-file-access-from-files` — without it the canvas is tainted and `getImageData`
throws. **Opening these pages by hand in an ordinary browser will therefore show the pale
square**, which is fine for checking a layout and wrong for an upload; `render.js` waits on
`window.shdPromoReady` and refuses to screenshot a card whose icon did not key, so that
difference cannot reach the store.

Two numbers in `promo.css` come off that file and would need re-measuring if it is
re-exported at different padding: the artwork sits inside 13px of empty margin each side and
9/7 top and bottom within its 128px box, and the card takes those back as negative margins
so that the layout box is the *ink* box — otherwise the mark hangs 13/128ths of its own
width off the card's left margin.

### Why the cards do not use icons/icon.svg

They easily could: it is one line in `promo.css` plus dropping `data-key-field` from the two
`<img>` tags, and it would delete `promo.js`, the `--allow-file-access-from-files` flag, the
readiness assertion in `render.js` and the two padding constants — every one of which exists
only because the raster brings a background with it.

**The mast is why.** `store-icon.png` sits on an inset tile and its aerial breaks up out of
the top of it; `icons/icon.svg` has to keep its aerial tucked inside, because a packaged
icon's tile is full bleed and there is nowhere else for the mast to go. That silhouette is
the preferred one (project decision, 2026-08-30), so the artwork — where nothing constrains
the tile — uses it, and the packaged icons use the tucked drawing because at toolbar sizes
they have no choice. `icons/README.md` has the constraint from the other end.

So the keying is not incidental complexity to be tidied away later. It is the price of the
silhouette, and it is paid here rather than in `icons/` because this is the half that can
afford it.

## Rendering

`render.js` drives Chrome over the DevTools protocol using node's own `WebSocket`, with no
npm dependency of its own — `package.json`'s three belong to the test suite. It finds a
browser at `CHROME_PATH`, then Playwright's copy, then the usual system paths.

It does **not** use `chrome --screenshot --window-size=440,280`, and that is deliberate:
Old Headless was removed from the Chrome binary in 132, and under new Headless
`--window-size` sizes the OS *window*. The viewport comes out roughly 80px shorter and the
screenshot is padded to the requested height with the page's background colour — so the
bottom of the card is missing, at exactly the size the store accepts without complaint.
`Emulation.setDeviceMetricsOverride` sets the viewport itself and `Page.captureScreenshot`'s
clip crops to the pixel. That reasoning, and the browser handling around it, is in
`headless.js` rather than here, because `export-icons.js` needs all of it too.

The card is screenshotted only after `document.fonts.ready` and two animation frames. A
card shot mid-font-swap renders in the fallback face, which looks like a design decision
rather than like a bug.

## Fonts

`fonts/inter-latin.woff2` is Inter's latin subset as a variable font — one file for every
weight the cards use. It is committed rather than fetched so that a regenerate is
reproducible offline and byte-identical on a machine that has never seen the font. Inter is
licensed under the SIL Open Font License 1.1; `fonts/OFL.txt` is its licence text, and it
stays beside the font.

The product shot deliberately does not use it. That half is the classic theme, whose font
stack is old reddit's own `Verdana, Arial, Helvetica, sans-serif` — resolved by the machine
doing the rendering, exactly as it is on a reader's screen.
