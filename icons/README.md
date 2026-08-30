# Icons

`icon.svg` is the vector original: a 128×128 rounded tile in `#5f99cf`, old reddit's
header blue, which is the one colour the layout is remembered by. The four PNGs beside it
are what ships — `manifest.json`'s `icons` block names every one of them, and both stores
read that block rather than the SVG.

| File | Size | Where a browser reaches for it |
|---|---|---|
| `icon16.png` | 16×16 | the tab and toolbar strip |
| `icon32.png` | 32×32 | Windows, and toolbars at higher device pixel ratios |
| `icon48.png` | 48×48 | the extensions page, and AMO's listing |
| `icon128.png` | 128×128 | the install dialog and the Chrome Web Store tile |

All four are 8-bit RGBA with real transparency outside the tile's rounded corners — the
corners must stay transparent, because both browsers composite the icon onto a background
that is light in one theme and dark in the other.

Editing one PNG and not the others is the failure mode here: a browser picks per context,
so a stale 16 is invisible everywhere except the one strip that uses it. Change the SVG,
re-export all four at the sizes above, and check the 16 by eye — it is the size where a
detail that reads fine at 128 turns to mush.

The store artwork is not here. Screenshots, the marquee and the promo tile live in
`docs/assets/`, and `docs/store-listing.md` says which asset each store field takes.

**The mark in this directory and the mark on the store art are not the same drawing.** The
promo cards under `docs/promo/` are built from `docs/assets/store-icon.png`, which is the
shed with an antenna over the roof; `icon.svg` and the four PNGs here are the shed without
one, and they are what a browser installs. Nothing enforces the difference away, so it is
worth knowing which one you are looking at. If the antenna is meant to be the mark, this
directory is what has to change: redraw `icon.svg`, re-export all four PNGs, and the
extension and the store art agree again.

Whichever it is, the promo cards reference their icon file rather than holding a copy of
it, so re-exporting reaches them on the next `node docs/promo/render.js` and there is no
second copy of the shed to keep in step by hand.
