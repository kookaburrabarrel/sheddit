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

One thing to know about the store art: the promo cards under `docs/promo/` draw
`docs/assets/store-icon.png` rather than this SVG, and that is deliberate rather than
pending. Both are the shed with its aerial, but they are two drawings of it — that one sits
on an inset tile with the mast breaking up out of the top, this one keeps the mast tucked
inside a full-bleed tile.

**The breaking-out silhouette is the preferred one** (project decision, 2026-08-30). It is
used wherever nothing constrains the tile, which means the promo artwork. It is not used
here, for three reasons that all point the same way:

- A toolbar icon wants a full-bleed tile. Insetting it far enough for the mast to clear the
  top costs about 22% of the tile, and at 16px the shed cannot spare it — the same argument
  that kept the shed at full size when the aerial arrived.
- Chrome's 128 guidance asks for 96×96 of artwork inside 16px of transparent padding.
  That padding is meant to be *empty*, so a mast poking into it is not the guidance being
  met, it is the artwork being bigger than the guidance allows.
- The four PNGs have to agree with each other. A 128 whose tile is inset and a 16 whose tile
  is full bleed are two marks, and a browser picks between them per context.

So the constraint is real and the tucked aerial is the answer to it, not a compromise
waiting to be revisited. `docs/promo/README.md` records the same decision from the artwork's
end, where the keying it costs is paid.

The cards reference an icon file rather than holding a copy of the mark either way, so
re-exporting reaches them on the next `npm run promo` and there is no second copy of the
shed to keep in step by hand.
