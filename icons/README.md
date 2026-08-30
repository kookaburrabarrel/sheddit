# Icons

`icon.svg` is the vector original: a 128×128 rounded tile in `#5f99cf`, old reddit's
header blue, which is the one colour the layout is remembered by, carrying a white shed
with an aerial over its ridge. The four PNGs beside it are what ships — `manifest.json`'s
`icons` block names every one of them, and both stores read that block rather than the SVG.

They are **generated**, not drawn:

```bash
npm run icons          # rewrite all four from icon.svg
npm run icons:check     # rebuild in memory and diff; non-zero if any is stale
```

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
so a stale 16 is invisible everywhere except the one strip that uses it. That is what
`export-icons.js` exists to make impossible — four exports done by hand is four chances to
skip one, and `npm run icons:check` answers "are these current?" without re-exporting
anything. It asserts the alpha channel too, because a corner baked against white is a white
notch on every dark toolbar and is invisible on the machine that exported it.

Still check the 16 by eye. It is the size where a detail that reads fine at 128 turns to
mush, and it is what decided the aerial's proportions: the shed is exactly the drawing it
was before the aerial arrived, because shrinking it to open more headroom cost more at 16px
than a taller mast was worth. The aerial lives in the 24 units above the ridge, which is all
a full-bleed tile has — unlike `docs/assets/store-icon.png`, where the tile is inset and the
mast can break out of the top of it.

Changing any of this stales `dist/*.zip`, which carry `icons/` verbatim. `npm run package`
rebuilds them and `npm run package:check` will tell you first.

The store artwork is not here. Screenshots, the marquee and the promo tile live in
`docs/assets/`, and `docs/store-listing.md` says which asset each store field takes.

One thing to know about the store art, though: the promo cards under `docs/promo/` draw
`docs/assets/store-icon.png` rather than this SVG. Both are now the shed with an aerial, so
they no longer disagree about what the mark IS, but they are two drawings of it — that one
is a raster with a navy outline, this one is flat vector. Pointing the cards at `icon.svg`
instead is a one-line change in `docs/promo/promo.css` and would make the store art the same
file a browser installs; `docs/promo/README.md` says what that would remove.

Either way the cards reference an icon file rather than holding a copy of the mark, so
re-exporting reaches them on the next `npm run promo` and there is no second copy of the
shed to keep in step by hand.
