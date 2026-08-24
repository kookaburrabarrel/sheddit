#!/usr/bin/env node
/**
 * css-lint.js — catches layout bugs that jsdom structurally cannot.
 *
 * jsdom does no layout, so `test/run.js` can prove the DOM is correct while the page
 * still renders wrong. This file encodes the specific CSS failure modes we've hit, as
 * static assertions over the stylesheet.
 *
 * Run via `npm test`.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'styles', 'old-reddit.css'), 'utf8');
const THEME_CSS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'styles', 'themes.css'), 'utf8');
const THEME_JS = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'config', 'themes.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { failed++; failures.push(name); console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
}

/** Crude but adequate rule splitter: returns [{selector, body}]. */
function rules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

const R = rules(CSS);
const declFor = (sel) => R.filter(r => r.selector.split(',').map(s => s.trim()).includes(sel))
                          .map(r => r.body).join(';');
const has = (sel, prop) => new RegExp(`(^|;|\\s)${prop}\\s*:`).test(declFor(sel));
const valueOf = (sel, prop) => {
  const m = declFor(sel).match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

/**
 * FLOAT CONTAINMENT.
 *
 * Every floated element must have a declared container that establishes a block
 * formatting context. Otherwise the float escapes its row and interferes with the NEXT
 * row's layout — the class of bug that produces staircase indentation.
 *
 * This map must be updated whenever a new float is introduced; the "no unmapped floats"
 * check below fails loudly if you forget.
 */
const FLOAT_CONTAINERS = {
  '.thumbnail': '.thing.link',       // post thumbnail floats left inside a link row
  '.expando-button': '.thing.link',  // the [+] control sits beside it, same row
  '#shd-sidebar': '#shd-root'        // right rail floats right inside the page root
};
const BFC = /(display\s*:\s*flow-root)|(overflow\s*:\s*(hidden|auto|scroll))|(display\s*:\s*(flex|grid|inline-block|table))|(position\s*:\s*absolute)|(float\s*:\s*(left|right))/;

console.log('\n\x1b[1mCSS LAYOUT LINT\x1b[0m');

const floated = R.filter(r => /(^|;|\s)float\s*:\s*(left|right)/.test(r.body))
                 .flatMap(r => r.selector.split(',').map(s => s.trim()));

check('no unmapped floats (add new floats to FLOAT_CONTAINERS)',
  floated.every(f => FLOAT_CONTAINERS[f]),
  floated.filter(f => !FLOAT_CONTAINERS[f]).join(', '));

for (const [child, container] of Object.entries(FLOAT_CONTAINERS)) {
  const body = declFor(container);
  check(`${container} contains its float (${child})`,
    BFC.test(body),
    `${container} declares "${body.trim().replace(/\s+/g, ' ') || '(nothing)'}" — needs display:flow-root or overflow`);
}

/**
 * SCORE COLUMN WIDTH.
 * Reddit scores routinely reach 5 digits ("12247"). A column too narrow for them wraps the
 * score onto multiple lines, which is what shipped in the first cut at 22px.
 *
 * DERIVED from the declared font-size rather than compared against a constant. The constant
 * was 34px, chosen when the score was 11px; matching old reddit moved it to 13px, and 34px
 * would still have passed while wrapping again — the same shape as the hand-maintained
 * token list in bug 43. Verdana bold digits run ~0.64em, so five of them need 3.2em.
 */
const midcolW = parseInt(valueOf('.midcol', 'width') || '0', 10);
const midcolPx = parseInt(valueOf('.midcol', 'font-size') || '0', 10);
const scoreNeeds = Math.ceil(5 * midcolPx * 0.64);
check('.midcol is wide enough for a 5-digit score at its own font-size',
  midcolPx > 0 && midcolW >= scoreNeeds,
  `width ${midcolW}px at font-size ${midcolPx}px needs >= ${scoreNeeds}px`);
check('.midcol .score does not wrap', /white-space\s*:\s*nowrap/.test(declFor('.midcol .score')));

/**
 * ABSOLUTE POSITIONING NEEDS A POSITIONED ANCESTOR.
 * .rank and .midcol are absolutely positioned; if .thing.link ever loses
 * position:relative they would escape to the viewport.
 */
check('.thing.link is a positioned ancestor for .rank/.midcol',
  /position\s*:\s*relative/.test(declFor('.thing.link')));

/**
 * .rank and .midcol must not overlap each other — AND THEIR TEXT MUST NOT MEET.
 *
 * The box test below passed for the whole of 0.12 while the live front page rendered rank
 * 2 beside score 18586 as `218586` (live testing, four of them on one screen of
 * /r/AmItheAsshole). The boxes abutted exactly, which is what it was asked to check, and
 * exactly-abutting boxes are the collision: the rank is right-aligned to its box edge and
 * a 5-digit score all but fills the midcol it is centred in, so the glyphs meet.
 *
 * So the real rule is about INK, and it is derived from the same numbers as the width rule
 * above rather than from a constant: a 5-digit score needs `scoreNeeds` px, centred in
 * `midcolW`, so its leftmost pixel is at midLeft + (midcolW - scoreNeeds) / 2. The rank's
 * rightmost pixel is the right edge of its CONTENT box. The gap between those two is what
 * a reader sees, and it has to be wide enough to read as a gap.
 */
const rankLeft = parseInt(valueOf('.thing .rank', 'left') || '0', 10);
const rankW = parseInt(valueOf('.thing .rank', 'width') || '0', 10);
const rankPadRight = parseInt(valueOf('.thing .rank', 'padding-right') || '0', 10);
const midLeft = parseInt(valueOf('.midcol', 'left') || '0', 10);
check('.rank and .midcol do not overlap',
  rankLeft + rankW + rankPadRight <= midLeft,
  `rank ends at ${rankLeft + rankW + rankPadRight}, midcol starts at ${midLeft}`);

/* content-box is load-bearing: with the default border-box the padding would eat the
   rank's own text area instead of adding a gutter beside it, and a four-digit rank at
   16px Arial has no 6px to spare. */
check('.thing .rank sizes its declared width as CONTENT, so the gutter is extra',
  /box-sizing\s*:\s*content-box/.test(declFor('.thing .rank')),
  declFor('.thing .rank'));

const RANK_INK_GAP = 4;
const rankInkRight = rankLeft + rankW;
const scoreInkLeft = midLeft + (midcolW - scoreNeeds) / 2;
check(`a 4-digit rank and a 5-digit score keep >= ${RANK_INK_GAP}px of clear air between them`,
  scoreInkLeft - rankInkRight >= RANK_INK_GAP,
  `rank ink ends at ${rankInkRight}px, a 5-digit score starts at ${scoreInkLeft}px ` +
  `(gap ${scoreInkLeft - rankInkRight}px)`);

/** Row padding must clear both absolute columns, or text sits on top of them. */
const padLeft = parseInt((valueOf('.thing.link', 'padding') || '0 0 0 0').split(/\s+/)[3], 10);
check('.thing.link left padding clears the rank + midcol columns',
  padLeft >= midLeft + parseInt(valueOf('.midcol', 'width') || '0', 10),
  `padding-left ${padLeft}px vs columns ending at ${midLeft + parseInt(valueOf('.midcol', 'width') || '0', 10)}px`);

/**
 * THE THREAD LINE HANGS OFF .child, NOT .thing.comment.
 *
 * Both produce something that reads as a guide line, which is why this drifted in the first
 * place, and neither jsdom nor geometry can tell them apart: the line is paint, so it has no
 * box of its own to measure, and a border on .comment is uniform per level exactly like a
 * border on .child. What differs is WHERE it starts and stops — around the comment you are
 * reading, or beside the replies to it. Only old.reddit says which, and it says .child.
 *
 * The second half matters as much as the first: a border on .thing.comment also sat inside
 * the indent arithmetic, so moving it without removing it leaves a double line and a 26px
 * step.
 */
check('the comment thread line is on .child', /border-left\s*:/.test(declFor('.child')),
  `.child declares "${declFor('.child').trim().replace(/\s+/g, ' ') || '(nothing)'}"`);
check('.thing.comment does not draw a thread line of its own',
  !/border-left\s*:/.test(declFor('.thing.comment')),
  'a border-left here brackets the comment instead of its replies, and double-counts the indent');

/**
 * EVERY FLEX ROW MUST WRAP.
 *
 * `display: flex` defaults to `flex-wrap: nowrap`, so a row of items is laid out on one
 * line and simply runs off the side of a viewport too narrow to hold it. All three flex
 * containers in this stylesheet are horizontal rows of variable-width text — the header,
 * the sort tabs, the per-comment buttons — and every one of them had this bug.
 *
 * It is a lint rule rather than only a geometry assertion because geometry could not see
 * it reliably: this stylesheet asks for Verdana, a container image usually has no Verdana,
 * and the narrower fallback made the rows fit. The suite passed here and failed on a Mac
 * with the real font installed. A static rule does not care which fonts are installed.
 */
const flexBlocks = [...CSS.matchAll(/([^{}]+)\{([^}]*display\s*:\s*flex[^}]*)\}/g)];
const noWrap = flexBlocks
  .filter(([, , decls]) => !/flex-wrap\s*:/.test(decls))
  .map(([, sel]) => sel.trim().split('\n').pop().trim());
check('every display:flex declares flex-wrap', noWrap.length === 0,
  `missing on: ${noWrap.join(' | ')} — a flex row defaults to nowrap and overflows a narrow viewport`);

/**
 * THEMES.
 *
 * A theme is three rules in themes.css keyed by one id in themes.js, and every way those
 * can drift is silent at runtime:
 *
 *   button with no palette      the click appears to do nothing
 *   palette with no button      unreachable, and nobody notices for a release
 *   a colour token left out     falls back to the CLASSIC value, so a dark theme quietly
 *                               keeps #0000ff links on #181b21 — the single most likely
 *                               mistake when adding a theme, and the least visible in a diff
 *   a layout metric overridden  bug 6 all over again, but only on one theme, at one width
 *
 * jsdom cannot see any of it (no layout, no cascade) and geometry only ever runs the
 * default theme, so this is where it has to be caught.
 */
const themeIds = [...THEME_JS.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map(m => m[1]);
const BASE_THEME = (THEME_JS.match(/const DEFAULT = '([a-z0-9-]+)'/) || [])[1];

/* Colour tokens: every non-base theme must set all of them. Design tokens (fonts, radius,
   shadow, thread style) are deliberately NOT required — inheriting classic's square
   corners is a choice a theme is allowed to make; inheriting classic's link blue is not.

   DERIVED from the base palette rather than listed, because a hand-maintained list only
   guards the tokens someone remembered to add to it. This was a real hole, found by
   walking into it: adding --shd-nsfw to old-reddit.css and to all four palettes, then
   deleting it from one palette again to check the guard had teeth, produced a clean pass.
   A theme missing a colour silently inherits classic's — which on a dark palette is the
   single failure this check exists to prevent, and it was unprotected for every token
   added after the list was written.

   Now the default is "required", and skipping one is a deliberate entry in EXEMPT below. */
const NOT_A_COLOUR = [
  '--shd-font', '--shd-title-font', '--shd-title-size', '--shd-title-weight',
  '--shd-radius', '--shd-shadow', '--shd-thread-style',
  '--shd-row-gap', '--shd-body-line', '--shd-selftext-radius'
];
/* Owned by old-reddit.css and asserted by geometry at ten widths. Off limits to paint —
   so they are excluded from the required-colour set AND checked below for theme overrides.
   Declared once, because when this list was written twice the copies were free to drift and
   a new layout token would have had to be remembered in both. */
const LAYOUT_TOKENS = ['--shd-side-w', '--shd-side-gap', '--shd-gutter', '--shd-video-max'];
const BASE_PALETTE = (CSS.match(/html\.shd-active\s*\{([\s\S]*?)\}/) || [, ''])[1];
const REQUIRED_TOKENS = [...new Set([...BASE_PALETTE.matchAll(/(--shd-[a-z0-9-]+)\s*:/g)].map(m => m[1]))]
  .filter(t => !NOT_A_COLOUR.includes(t) && !LAYOUT_TOKENS.includes(t));

check('the required-colour list is derived from the base palette, and is not empty',
  REQUIRED_TOKENS.length >= 20, `derived ${REQUIRED_TOKENS.length}: ${REQUIRED_TOKENS.join(', ')}`);
check('every exemption still corresponds to a token classic actually declares',
  NOT_A_COLOUR.every(t => BASE_PALETTE.includes(t + ':') || BASE_PALETTE.includes(t + ' :')),
  `stale exemption: ${NOT_A_COLOUR.filter(t => !BASE_PALETTE.includes(t)).join(', ')}`);

/* Comments in this file talk ABOUT selectors — `html[data-shd-theme="x"]` in the header
   is documentation, not a rule — so every pattern below runs on the stripped source. */
const THEME_CODE = THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const themeRules = rules(THEME_CSS);
const blockFor = (sel) => themeRules.filter(r => r.selector === sel).map(r => r.body).join(';');
const paletteOf = (id) => blockFor(`html.shd-active[data-shd-theme="${id}"]`);

check('every theme in themes.js is spelled the same way in themes.css',
  themeIds.length > 1 && themeIds.every(id => THEME_CODE.includes(`[data-shd-theme="${id}"]`)),
  `registry: ${themeIds.join(',')}`);

const cssIds = [...new Set([...THEME_CODE.matchAll(/\[data-shd-theme="([a-z0-9-]+)"\]/g)].map(m => m[1]))];
check('no palette in themes.css is missing its button in themes.js',
  cssIds.every(id => themeIds.includes(id)),
  `unreachable: ${cssIds.filter(id => !themeIds.includes(id)).join(', ')}`);

check('the base theme is the one old-reddit.css declares (no palette block of its own)',
  !!BASE_THEME && themeIds.includes(BASE_THEME) && paletteOf(BASE_THEME) === '',
  `base: ${BASE_THEME}`);

for (const id of themeIds) {
  /* --shd-blank has to sit OUTSIDE .shd-active: it colours the pre-render blackout, and
     .shd-active is not added until we have already rendered. */
  check(`${id} colours the pre-render blackout`,
    /--shd-blank\s*:/.test(blockFor(`html[data-shd-theme="${id}"]`)),
    'needs --shd-blank in an html[data-shd-theme] rule, not under .shd-active');
  check(`${id} has a swatch on its button`,
    new RegExp(`\\.shd-theme-btn\\[data-theme="${id}"\\][^{]*\\.shd-swatch`).test(THEME_CODE));

  if (id === BASE_THEME) continue;
  const palette = paletteOf(id);
  const missing = REQUIRED_TOKENS.filter(t => !new RegExp(`(^|;|\\s)${t}\\s*:`).test(palette));
  check(`${id} defines every colour token (no silent fallback to classic)`,
    missing.length === 0, `missing: ${missing.join(', ')}`);
  const trespass = LAYOUT_TOKENS.filter(t => new RegExp(`(^|;|\\s)${t}\\s*:`).test(palette));
  check(`${id} leaves the layout metrics alone`,
    trespass.length === 0, `a theme must not set: ${trespass.join(', ')}`);
}

/* Palettes only. A structural rule hiding in themes.css would sit outside every check
   above — no float containment, no flex-wrap requirement, no column arithmetic. */
const structural = themeRules
  .filter(r => /(^|;|\s)(display|position|float|width|height|margin|padding|flex)\s*:/.test(r.body))
  .map(r => r.selector);
check('themes.css contains no layout rules', structural.length === 0,
  `structural rules found: ${structural.join(' | ')}`);

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failed) { console.log('failures:\n  - ' + failures.join('\n  - ')); process.exit(1); }
