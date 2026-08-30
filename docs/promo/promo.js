/*
 * promo.js — lifts the flat field out from behind the icon, so the mark can float on the
 * card the way it did before it grew an antenna.
 *
 * WHY THIS EXISTS
 * docs/assets/store-icon.png is 128x128 and has NO alpha channel: the artwork sits on an
 * opaque pale-blue square (~#cfebfe), and the antenna pokes up out of the rounded tile into
 * that square. Dropped onto the card as-is it reads as a pale rectangle stuck to a gradient,
 * and a box-shadow would trace the rectangle rather than the shed. Cropping is not the
 * answer either: any box tight enough to lose the field also cuts the antenna off.
 *
 * So the field is keyed out at render time from the shipped file, rather than a
 * background-free copy of the icon being committed next to it. One icon on disk, no second
 * copy to keep in step — which is the same rule the rest of docs/promo/ follows.
 *
 * WHY IT CANNOT FAIL QUIETLY
 * getImageData on a canvas holding a file:// image throws unless Chrome was started with
 * --allow-file-access-from-files, which render.js passes. Opening these pages by hand in an
 * ordinary browser will therefore skip the key and show the pale square — fine for checking
 * a layout, wrong for an upload. render.js waits on window.shdPromoReady and refuses to
 * screenshot a card whose icon did not key, so that difference can never reach the store.
 */
(() => {
  /* Inside T of the field colour is field. Below FEATHER, a kept pixel is only partly
     covered and its colour still has the field blended into it. T is wide enough for the
     compression noise in the source (the outer ring alone holds ~54 shades of the same
     blue) and far short of the shed's navy outline, which is what the fill has to stop at. */
  const T = 30;
  const FEATHER = 105;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function key(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, W, H);   // throws on a tainted canvas
    const px = image.data;
    const at = (p) => [px[p * 4], px[p * 4 + 1], px[p * 4 + 2]];

    const cornerIdx = [0, W - 1, (H - 1) * W, (H - 1) * W + W - 1];
    /* An icon that already has its background removed needs nothing done to it. Checked
       rather than assumed, so replacing the source with a transparent PNG one day is not a
       silent no-op that leaves a rim of keyed-out edge pixels behind. */
    if (cornerIdx.every(p => px[p * 4 + 3] === 0)) return true;

    const BG = [0, 1, 2].map(k =>
      Math.round(cornerIdx.reduce((sum, p) => sum + at(p)[k], 0) / cornerIdx.length));

    /* Flood from the border rather than keying every matching pixel: the antenna's ring is
       pale inside too, and a global key would punch a hole through the middle of it. */
    const outside = new Uint8Array(W * H);
    const stack = [];
    const visit = (x, y) => {
      const p = y * W + x;
      if (!outside[p] && dist(at(p), BG) <= T) { outside[p] = 1; stack.push(p); }
    };
    for (let x = 0; x < W; x++) { visit(x, 0); visit(x, H - 1); }
    for (let y = 0; y < H; y++) { visit(0, y); visit(W - 1, y); }
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p - x) / W;
      if (x > 0) visit(x - 1, y);
      if (x < W - 1) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y < H - 1) visit(x, y + 1);
    }
    if (!outside.some(Boolean)) return false;     // nothing keyed: the source is not what we think

    /* The kept pixels along the edge were drawn as `a` parts shed over `1-a` parts field.
       Leaving them be keeps a pale rim around the whole mark; undoing that blend at the
       coverage their distance from the field implies is what makes the edge sit cleanly on
       a background of any colour. */
    const out = new Uint8ClampedArray(px.length);
    out.set(px);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (outside[p]) { out[p * 4 + 3] = 0; continue; }
      const edge = (x > 0 && outside[p - 1]) || (x < W - 1 && outside[p + 1]) ||
                   (y > 0 && outside[p - W]) || (y < H - 1 && outside[p + W]);
      if (!edge) continue;
      const c = at(p);
      const a = Math.min(1, Math.max(0.1, dist(c, BG) / FEATHER));
      for (let k = 0; k < 3; k++) out[p * 4 + k] = (c[k] - (1 - a) * BG[k]) / a;
      out[p * 4 + 3] = Math.round(a * 255);
    }
    px.set(out);
    ctx.putImageData(image, 0, 0);
    img.src = canvas.toDataURL('image/png');
    return new Promise(resolve => { img.onload = () => resolve(true); });
  }

  const icons = [...document.querySelectorAll('img[data-key-field]')];
  const ready = (img) => img.complete && img.naturalWidth
    ? Promise.resolve()
    : new Promise(r => img.addEventListener('load', r, { once: true }));

  /* render.js awaits shdPromoReady, then reads shdPromoKeyed. Resolving rather than
     throwing keeps a plain browser able to open the page; it is the flag, not an exception,
     that stops a bad screenshot. */
  window.shdPromoKeyed = false;
  window.shdPromoReady = Promise.all(icons.map(img => ready(img).then(() => key(img))))
    .then(results => { window.shdPromoKeyed = results.length > 0 && results.every(Boolean); })
    .catch(() => { window.shdPromoKeyed = false; });
})();
