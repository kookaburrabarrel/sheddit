/**
 * themes.js — the theme registry and the one function that applies a theme.
 *
 * A theme is a palette plus a few design tokens (font stack, corner radius, whether the
 * thread lines are dotted or solid). It is ONLY paint: no theme may touch the layout
 * metrics — `--shd-side-w`, `--shd-side-gap`, `--shd-gutter` — because those are load
 * bearing and asserted by test/geometry.js at ten viewport widths. test/css-lint.js
 * enforces that rule statically, so a theme cannot quietly reintroduce bug 6.
 *
 * The palettes themselves live in src/styles/themes.css, keyed by the same ids as the
 * LIST below. Both halves are checked against each other by css-lint: a theme with a
 * button and no palette is a button that appears to do nothing, and a palette with no
 * button is unreachable.
 *
 * WHY THIS RUNS AT document_start
 * The pre-render blackout (suppress.css, `html.shd-gate body { visibility: hidden }`)
 * paints the canvas before we have rendered anything. On a dark theme that was a white
 * flash — the exact "bright and jarring" problem the themes exist to fix — so the theme
 * attribute has to be on <html> as early as possible, which means reading storage at
 * document_start rather than waiting for pipeline.js at document_idle. preload() below
 * does that; pipeline.js applies it again from the settings it loads, which is a no-op
 * when they agree and the authority when they do not.
 *
 * `classic` is the base: its palette is old-reddit.css's own `html.shd-active` block, so
 * it needs no override and it is what an unknown or missing theme resolves to. That also
 * means a failure to deliver themes.css degrades to the layout we shipped before, rather
 * than to unresolved custom properties.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.theme = (() => {
  const ATTR = 'data-shd-theme';
  const DEFAULT = 'classic';

  /* Order here is the order of the buttons in the header. `note` becomes the button's
     title attribute — it is the only place a theme explains itself to the user. */
  const LIST = [
    { id: 'classic', label: 'classic',
      note: 'old.reddit.com as it was — Verdana, blue links, square corners' },
    { id: 'slate', label: 'slate',
      note: 'the same layout, softened: system font, muted greys, rounded edges' },
    { id: 'sepia', label: 'sepia',
      note: 'warm paper and serif type, for long reading' },
    { id: 'night', label: 'night',
      note: 'dark, low contrast — easy at 2am' },
    { id: 'carbon', label: 'carbon',
      note: 'near-black, monospaced, high contrast' }
  ];

  const ids = LIST.map(t => t.id);

  /** Anything we do not recognise — a stale setting, a typo, junk in storage — is classic. */
  function resolve(id) { return ids.includes(id) ? id : DEFAULT; }

  function current() {
    try { return resolve(document.documentElement.getAttribute(ATTR)); }
    catch { return DEFAULT; }
  }

  /**
   * Paint the page in `id`. Idempotent, and safe to call before the header exists.
   *
   * Deliberately does NOT re-render anything: a theme is CSS custom properties on <html>,
   * so the whole page repaints without rebuilding a single row. That matters most on a
   * feed the user has paged forty times.
   */
  function apply(id) {
    const t = resolve(id);
    const root = document.documentElement;
    if (root.getAttribute(ATTR) !== t) root.setAttribute(ATTR, t);
    reflect(t);
    return t;
  }

  /** Keep the buttons' pressed state in step without rebuilding the header. */
  function reflect(t) {
    for (const btn of document.querySelectorAll('.shd-theme-btn')) {
      const on = btn.getAttribute('data-theme') === t;
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /**
   * Apply and persist. Paint first, store second: the user gets the new colours on the
   * click, not on the storage round trip.
   *
   * The write carries the WHOLE settings object, exactly as options.js does — a partial
   * write would look to pipeline.js's storage listener like every absent key changing to
   * undefined. Storage is read back first so a change made in the options page while this
   * tab was open is not clobbered by our in-memory copy.
   */
  async function set(id) {
    const t = apply(id);
    if (SHD.settings) SHD.settings.theme = t;
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({
        settings: { ...(SHD.settings || {}), ...(settings || {}), theme: t }
      });
    } catch { /* no chrome.storage (dev harness) — the paint above still stands */ }
    return t;
  }

  /* Runs immediately, at document_start. See the header. */
  (async function preload() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      apply(settings && settings.theme);
    } catch { apply(DEFAULT); }
  })();

  return { ATTR, DEFAULT, LIST, ids, resolve, current, apply, set };
})();
