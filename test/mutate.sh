#!/bin/bash
#
# mutate.sh — prove the suites have teeth.
#
# A green suite means nothing until you have watched it go red. Every row below
# reintroduces a bug this codebase actually shipped, runs the suite that is supposed to
# notice, and reports whether it did. A SURVIVED row is a hole in the tests, not a
# passing grade.
#
# Two mutations survived on the first run of this script and both were real gaps:
# an in-flight flush after a bail was only covered by a timing-dependent (vacuous) test,
# and gate.onBail's teardown had no observable consequence under test at all.
#
# A third survived on the round-12 run, and it is the most instructive of them: deleting
# pipeline.js's visibilitychange re-arm changed nothing, because the gate's deadline
# rescues the same page 1200ms later (bug 36) and the test was asserting the observable
# both mechanisms produce. See bug 75 — when two mechanisms produce one observable,
# asserting the observable proves nothing about either.
#
#   npm run test:mutate      (~18 min)
#
# RUNS ON A THROWAWAY COPY, NEVER YOUR WORKING TREE.
#
# It used to mutate the real files and restore them between rows. That was a bad idea in
# three separate ways, all of which actually happened: it wiped uncommitted work whose
# edits landed after the snapshot was taken; a container restart mid-run risked leaving
# injected bugs behind; and every `git status` during a run showed deliberate corruption,
# so the honest answer to "are there uncommitted changes?" became "yes, but ignore them".
#
# So the whole repo is copied to a temp directory first (node_modules symlinked, so the
# copy is fast and puppeteer still resolves) and every mutation, build and test run
# happens in there. Your checkout is never touched, and you can keep working while it runs.
set -u
cd "$(dirname "$0")/.."
SRC=$(pwd)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar -c --exclude=node_modules --exclude=.git --exclude=dist . | tar -x -C "$WORK"
ln -s "$SRC/node_modules" "$WORK/node_modules"
cd "$WORK"

BK=$(mktemp -d)
cp -r src test options package.json manifest.json "$BK/"
restore() {
  rm -rf src test options package.json manifest.json
  cp -r "$BK/src" "$BK/test" "$BK/options" "$BK/package.json" "$BK/manifest.json" .
}

apply() {
  python3 - "$@" <<'PY'
import sys
args = sys.argv[1:]
for i in range(0, len(args), 3):
    path, old, new = args[i], args[i+1], args[i+2]
    s = open(path).read()
    assert old in s, f"anchor not found in {path}: {old[:60]!r}"
    open(path, 'w').write(s.replace(old, new, 1))
PY
}

# EVERY ROW MUST REPORT, AND THE SCRIPT HAS TO PROVE IT DID.
#
# The round-12 sweep printed 122 results for 144 rows and exited 0. Twenty-two CONSECUTIVE
# rows never ran — the block from "post selftext body vanishes" to "the mp4 pick stops
# preferring the best rendition" — and nothing said so: the run looked like a clean sweep
# with five survivors, and a sixth of the file had simply not been executed.
#
# THE CAUSE WAS EDITING THIS FILE WHILE IT WAS RUNNING. The sweep takes hours, and its
# comments were edited a couple of rows into the second hour. Bash reads a script
# incrementally by byte offset, so a rewrite underneath it resumes mid-token: the output
# carries one garbled error naming a line number that does not match the text quoted beside
# it, and the rows the mangled token swallowed are silently skipped. Note the same hazard
# applies to `$SRC/test/*.js` — those are copied to $WORK at the start, so editing them
# mid-run is harmless — but NOT to this file, which bash reads from $SRC for the whole run.
# Do not edit it while a sweep is in flight.
#
# The reason this is worth a guard rather than a note: it presents as a clean run. Work
# that did not happen, reported as work that passed, is the exact failure this whole file
# exists to catch, turned on itself. So the rows are COUNTED and checked against what the
# file declares — a sweep that cannot account for every row is not a sweep, and exits
# non-zero. Whatever stops bash next time (an edit mid-run, a quoting slip in a new row),
# the sweep will say so instead of looking green.
ROWS_RUN=0
ROWS_CAUGHT=0
ROWS_SURVIVED=0
ROWS_MISSED=0

mutate() { # mutate <name> <suite> <file old new>...
  local name="$1" suite="$2"; shift 2
  ROWS_RUN=$((ROWS_RUN + 1))
  if ! apply "$@"; then
    ROWS_MISSED=$((ROWS_MISSED + 1))
    printf '  %-56s ANCHOR MISS\n' "$name"; restore; return
  fi
  node build.js >/dev/null 2>&1
  local n
  n=$(node "test/$suite.js" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c '^  FAIL')
  if [ "$n" -eq 0 ]; then
    ROWS_SURVIVED=$((ROWS_SURVIVED + 1))
    printf '  \033[31m%-56s %-10s SURVIVED\033[0m\n' "$name" "$suite"
  else
    ROWS_CAUGHT=$((ROWS_CAUGHT + 1))
    printf '  \033[32m%-56s %-10s caught (%s)\033[0m\n' "$name" "$suite" "$n"
  fi
  restore
  node build.js >/dev/null 2>&1
}

echo "MUTATION TESTING — each row reintroduces a bug this branch fixed"
echo

mutate "sidebar padding+border escape the reserved gutter" geometry \
  src/styles/old-reddit.css '  box-sizing: border-box;          /* keeps the margin box exactly --shd-gutter */
' ''

mutate "reserved gutter narrower than the rail" geometry \
  src/styles/old-reddit.css '  --shd-gutter: calc(var(--shd-side-w) + var(--shd-side-gap) * 2);' \
                            '  --shd-gutter: 300px;'

mutate "comment [-] back on top of the vote arrows" geometry \
  src/styles/old-reddit.css '  left: 2px;
  top: 0;
  width: 15px;' '  left: 4px;
  top: 2px;
  width: 34px;'

mutate "passthrough loses the cascade again" geometry \
  src/styles/suppress.css ':not(#shd-passthrough-exit):not(.shd-native-passthrough),' \
                          ':not(#shd-passthrough-exit),'

mutate "passthrough tags the target, not the body child" geometry \
  src/core/dom.js 'n.classList.add(n === top ? PASS_ROOT : PASS);' \
                  'n.classList.add(n === el ? PASS_ROOT : PASS);'

# The SPA-chrome bug had one root cause reachable two ways, and the code now defends both.
# Mutating either alone is survivable, so this restores the original pair.
mutate "chrome never rebuilt after an SPA navigation (original pair)" run \
  src/core/pipeline.js '    if (rendered > 0) {
      if (SHD.settings.chrome)' '    if (rendered > 0 && !SHD.gate.revealed) {
      if (SHD.settings.chrome)' \
  src/core/gate.js '    revealed = false;
    engaged = false;                      // the incoming route has not been taken yet' \
                   '    engaged = false;                      // the incoming route has not been taken yet'

mutate "reset() leaves the stale header behind" run \
  src/modules/chrome.js "    document.querySelector('#shd-header')?.remove();" ''

mutate "failure leaves our unstyled DOM on the page" run \
  src/core/gate.js "    document.documentElement.classList.remove('shd-gate', SHD.C.BODY_CLASS);
    document.getElementById(SHD.C.ROOT_ID)?.remove();" "    document.documentElement.classList.remove('shd-gate', SHD.C.BODY_CLASS);"

mutate "nothing guards an in-flight flush (guard + queue clear)" run \
  src/core/pipeline.js '    if (SHD.gate.stopped) { queue.clear(); return; }
' '' \
  src/core/pipeline.js '    queue.clear();
    SHD.paginator.reset();' '    SHD.paginator.reset();'

mutate "stopping no longer unwinds a native handoff" run \
  src/core/pipeline.js '    SHD.dom.passthroughClear();' ''

# --- the failure screen, and the deadline that decides when to show it ---
mutate "failure shows nothing at all (silent blank page)" run \
  src/core/gate.js "    showErrorScreen(reason, detail);" ''

mutate "failure silently hands back native Reddit (the old behaviour)" run \
  src/core/gate.js "    document.documentElement.classList.add('shd-failed');" \
                   "    release('silent'); return;"

mutate "deadline blames itself instead of checking for content" run \
  src/core/gate.js '    const sources = sourceCount();
    if (sources > 0) {' '    const sources = sourceCount();
    if (true) {'

mutate "deadline stays disarmed after a route change" run \
  src/core/gate.js '    revealed = false;
    engaged = false;                      // the incoming route has not been taken yet' \
                   '    engaged = false;                      // the incoming route has not been taken yet'

mutate "failure screen drops its diagnostics block" run \
  src/core/gate.js "      el('pre', { textContent: diagnostics })" "null"

mutate "a released page re-suppresses itself on the next navigation" run \
  src/core/gate.js '    if (released) return;                 // the user asked for native Reddit; respect it' ''

mutate "vote delegation stops piercing shadow roots" run \
  src/modules/listing.js 'const native = SHD.dom.deepQuery(m.source, sel);' \
                         'const native = m.source.querySelector(sel);'

mutate "controversial accepted for subs but not the front page" run \
  src/core/route.js "  const SORT_RE = [...SORTS, ...EXTRA_SORTS].join('|');" \
                    "  const SORT_RE = ['hot','new','rising','top','best'].join('|');"

# --- the isolated/main world boundary, and pagination ---
mutate "paginator calls loadContent() directly again" run \
  src/core/paginator.js '      const result = requestLoad(target);' \
                        '      const result = (target && typeof target[C.PARTIAL_LOAD_METHOD] === "function") ? (target[C.PARTIAL_LOAD_METHOD](), "ok") : "no-method";'

mutate "bridge protocol drifts from contracts.js" run \
  src/core/bridge.js "  const REQUEST = 'shd:load-more';" \
                     "  const REQUEST = 'shd:load-more-v2';"

mutate "MAIN-world bridge dropped from the manifest" run \
  manifest.json '"world": "MAIN",' ''

mutate "settle() starts watching after the load (6s per page)" run \
  src/core/paginator.js '      const settled = settle();
      const result = requestLoad(target);' '      const result = requestLoad(target);
      const settled = settle();'

mutate "cooldown swallows the deliberate click again" run \
  src/core/paginator.js "    if (reason !== 'manual' && Date.now() - lastAt < COOLDOWN_MS) return refuse('cooldown');" \
                        "    if (Date.now() - lastAt < COOLDOWN_MS) return refuse('cooldown');"

# --- live settings ---
mutate "settings are read once at boot again" run \
  src/core/pipeline.js '    watchSettings();' ''

mutate "a partial settings write tears the page down" run \
  src/core/pipeline.js '        const changed = Object.keys(next).filter(k => SHD.settings[k] !== next[k]);' \
                       '        const changed = Object.keys(SHD.settings).filter(k => SHD.settings[k] !== next[k]);'

mutate "standing down leaves native Reddit suppressed (blank page)" run \
  src/core/gate.js "    document.documentElement.classList.remove('shd-gate', 'shd-failed', SHD.C.BODY_CLASS);
    document.documentElement.removeAttribute('data-shd-fail');" \
                   "    document.documentElement.classList.remove('shd-gate', 'shd-failed');
    document.documentElement.removeAttribute('data-shd-fail');"

# --- pages with nothing to render (the common logged-out case) ---
# Three call sites unblank a no-feed page (load listener, check(), resetForRoute). That is
# deliberate defence in depth, so removing any ONE survives — the original state is all three.
mutate "an age gate is blanked and then blamed (all paths)" run \
  src/core/gate.js "      const why = nothingToRender();
      if (why) unblank(why);" '' \
  src/core/gate.js "    const why = nothingToRender();
    if (why) {
      unblank(why);
      if (waited < MAX_WAIT_MS) scheduleCheck();
      return;
    }" "    if (waited < MAX_WAIT_MS) return scheduleCheck();
    return fail('no-content', { sources: 0, waited });" \
  src/core/gate.js "      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);" ''

# The load listener and resetForRoute's unblank are two fast paths to the same outcome;
# whichever runs first wins, so removing one alone is invisible. Removing BOTH leaves only
# the 1500ms fallback tick, which the promptness assertions are calibrated to catch.
mutate "only the fallback deadline clears the blackout" run \
  src/core/gate.js "      const why = nothingToRender();
      if (why) unblank(why);" '' \
  src/core/gate.js "      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);" ''

# Deliberately an `extension` row, not `run`. jsdom fires `load` after our listener is
# registered, so the load listener covers this there and the mutation looks harmless. In a
# real browser pipeline.js boots at document_idle, which can land AFTER load — and then
# resetForRoute re-adds the blackout with nothing left to clear it until the 1500ms tick.
# Measured with this removed: the age gate takes 1579ms instead of ~30ms.
mutate "resetForRoute re-blanks a page it already cleared" extension \
  src/core/gate.js "      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);" ''

mutate "an empty feed is written off as not-our-page" run \
  src/core/gate.js "    if (!hasFeedContainer()) return 'no-feed-container';" \
                   "    if (true) return 'no-feed-container';"

mutate "login-only buttons come back" run \
  src/modules/listing.js "      h('li', null, h('a.share', { href: m.permalink, text: 'share' }))," \
    "      h('li', null, h('a.share', { href: m.permalink, text: 'share' })),
      h('li', null, h('a.save', { href: m.permalink, text: 'save' })),
      h('li', null, h('a.report', { href: m.permalink, text: 'report' }))," 

# --- comment pagination ---
mutate "comment pages get no sentinel (thread truncated)" run \
  src/core/pipeline.js '    if (rendered > 0) {
      const anchor = mode === R.COMMENTS' '    if (rendered > 0 && mode === R.LISTING) {
      const anchor = mode === R.COMMENTS'

mutate "paginator still hardcoded to the feed partial" run \
  src/core/paginator.js "    SEL = selectorFor(mode);" \
                        "    SEL = selectorFor('LISTING');"

# Both halves of the COMMENTS selector are tree-scoped, so blanking only one leaves the
# other doing the same job. Unscope both — that is what "loses the tree scope" means.
mutate "comment partial selector loses its tree scope" run \
  src/config/contracts.js "  COMMENT_PARTIAL: 'shreddit-comment-tree faceplate-partial[loading=\"programmatic\"]'," \
                          "  COMMENT_PARTIAL: 'faceplate-partial[loading=\"programmatic\"]'," \
  src/core/paginator.js "    COMMENTS: [C.COMMENT_PARTIAL, C.COMMENT_TREE + ' ' + C.LAZY_LOADER]" \
                        "    COMMENTS: [C.COMMENT_PARTIAL, C.LAZY_LOADER]"

# --- the options page ---
mutate "options DEFAULTS drift from contracts.js" run \
  options/options.js "  compactRows: true, showThumbnails: true, showNsfwThumbnails: false, autoPaginate: true," \
                     "  compactRows: true, showThumbnails: true, showNsfwThumbnails: false, autoPaginate: true, pruneAfterRender: false,"

mutate "a shipped setting has no checkbox to set it" run \
  options/options.html '<label><input type="checkbox" data-k="autoPaginate"> Auto-load more on scroll</label>' ''

mutate "a toggle writes only the changed key" run \
  options/options.js "  next[c.dataset.k] = read(c);
  await chrome.storage.sync.set({ settings: next });" \
                     "  await chrome.storage.sync.set({ settings: { [c.dataset.k]: read(c) } });"

# --- nested comments (the live 2026-08-14 shape) ---
mutate "comment body lookup is not scoped to its own comment" run \
  src/core/model.js "    const bodyNode = [...el.querySelectorAll(C.COMMENT_BODY)]
      .find(n => n.closest(C.COMMENT) === el) || null;" \
                    "    const bodyNode = el.querySelector(C.COMMENT_BODY);"

echo
echo "packed-extension suite (slower; representative mutations)"
mutate "vote delegation stops piercing shadow roots" extension \
  src/modules/listing.js 'const native = SHD.dom.deepQuery(m.source, sel);' \
                         'const native = m.source.querySelector(sel);'
mutate "suppress.css dropped from the manifest" extension \
  manifest.json '"src/styles/suppress.css"' '"src/styles/does-not-exist.css"'
mutate "native Reddit shows through the failure screen" extension \
  src/styles/suppress.css 'html.shd-failed body > *:not(#shd-error) {' \
                          'html.shd-unused body > *:not(#shd-error) {'
mutate "failure screen never appears (blank page instead)" extension \
  src/core/gate.js "    showErrorScreen(reason, detail);" ''
mutate "pagination cannot cross into the main world" extension \
  manifest.json '"world": "MAIN",' ''
mutate "an age gate is blanked and then blamed (all paths)" extension \
  src/core/gate.js "      const why = nothingToRender();
      if (why) unblank(why);" '' \
  src/core/gate.js "    const why = nothingToRender();
    if (why) {
      unblank(why);
      if (waited < MAX_WAIT_MS) scheduleCheck();
      return;
    }" "    if (waited < MAX_WAIT_MS) return scheduleCheck();
    return fail('no-content', { sources: 0, waited });" \
  src/core/gate.js "      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);" ''
mutate "comment pages get no sentinel (thread truncated)" extension \
  src/core/pipeline.js '    if (rendered > 0) {
      const anchor = mode === R.COMMENTS' '    if (rendered > 0 && mode === R.LISTING) {
      const anchor = mode === R.COMMENTS'
mutate "paginator still hardcoded to the feed partial" extension \
  src/core/paginator.js "    SEL = selectorFor(mode);" \
                        "    SEL = selectorFor('LISTING');"
mutate "the feed stalls after one page (no pump)" extension \
  src/core/paginator.js "      if (await loadNext(reason)) pump('follow-up');" \
                        "      await loadNext(reason);"
# A partial that fills its branch in place instead of replacing itself. Without the stamp,
# re-querying picks the same element for ever: one branch expands over and over, the other
# nine are never reached, and the reader sees the same replies repeated. jsdom proves the
# logic, the packed extension proves the isolated-world stamp is visible to the main-world
# bridge — which is the half that has silently broken twice before.
mutate "paginator re-drives the same comment partial for ever" run \
  src/core/paginator.js 'const FRESH = `:not([${C.MARK}="done"])`;' "const FRESH = '';"
mutate "...and the same, across the world boundary" extension \
  src/core/paginator.js 'const FRESH = `:not([${C.MARK}="done"])`;' "const FRESH = '';"
mutate "a driven stamp outlives its page and blocks the next thread" run \
  src/core/paginator.js "    document.querySelectorAll(\`\${C.LAZY_LOADER}[\${C.MARK}=\"done\"]\`)
      .forEach(p => p.removeAttribute(C.MARK));" ''
# settle() watched shreddit-feed unconditionally and a comments page has none, so it took the
# "no container" early return: every comment load reported success before a single comment had
# arrived. Invisible while the fixture appended synchronously.
mutate "settle() ignores the comment tree (comment loads never wait)" run \
  src/core/paginator.js "      const root = document.querySelector(CONTAINER);" \
                        "      const root = document.querySelector(C.FEED);"
# We lift the thumbnail URL off the post and render our own <img>, so the blur Reddit puts
# on NSFW thumbnails for logged-out readers is simply bypassed — a feed Reddit had obscured
# came out fully explicit in our layout, on a graphic war-footage sub. The two rows below are
# the two ways to misread the flag, and the second is the worse one: `nsfw="false"` is what a
# SAFE post looks like when the attribute is bound as a string, so treating presence as adult
# puts a placeholder over every thumbnail in the feed.
mutate "adult thumbnails render as pictures again" run \
  src/modules/listing.js "    if (m.nsfw && !SHD.settings.showNsfwThumbnails) {" \
                         "    if (false) {"
mutate "an empty nsfw=\"\" attribute reads as safe" run \
  src/core/model.js "      if (v === null) return false;
      const s = v.trim().toLowerCase();
      return s !== 'false' && s !== '0';" "      return !!v;"
mutate "nsfw=\"false\" reads as adult (placeholder over the whole feed)" run \
  src/core/model.js "      if (v === null) return false;
      const s = v.trim().toLowerCase();
      return s !== 'false' && s !== '0';" "      return v !== null;"
# The suppression rule was the standard "visually hidden" recipe — the one you write when you
# WANT screen readers to keep reading something. So the entire native page stayed in the
# accessibility tree and in find-in-page, and every post was announced twice.
mutate "native Reddit stays in the accessibility tree" extension \
  src/styles/suppress.css "  opacity: 0 !important;
  visibility: hidden !important;" "  opacity: 0 !important;"
# css-lint's required-colour list used to be hand-maintained, so it only guarded the tokens
# someone remembered to add to it — every token introduced afterwards was unprotected, and a
# theme omitting one silently inherits classic's, which on a dark palette is the entire
# failure the check exists to catch. Found by walking into it: adding --shd-nsfw and then
# deleting it from one palette again produced a clean pass. The list is derived now, so this
# row drops the token from a single theme, which is what the mistake actually looks like.
mutate "a theme silently omits a colour token" css-lint \
  src/styles/themes.css "  --shd-nsfw: #c2410c;
" ""

# The chain continued on `visible` — the IntersectionObserver's last word — while attach()
# resets it to false after every flush. Measured live: five pages in, sentinel 80px ABOVE the
# fold, 22 undriven partials left, `visible` false and no further callback in ten seconds,
# because a reader already at the bottom of the document produces no intersection CHANGE. The
# feed dead-ended showing "load more", which is the label of a load that succeeded. Both
# gates go together: leaving either one reading `visible` reinstates the stall.
mutate "the feed stalls on a stale observer verdict" run \
  src/core/paginator.js "    if (!inRange() || busy) return;" \
                        "    if (!visible || busy) return;" \
  src/core/paginator.js "      if (!inRange()) return;" "      if (!visible) return;"
# ...and the counterweight. Deciding from geometry must not mean deciding to load for ever:
# a reader who scrolls back to the top of a long feed has to stop pulling pages. Runs on the
# packed extension because only real layout can tell in-range from out-of-range at all.
mutate "geometry stops gating, so the feed pulls pages for ever" extension \
  src/core/paginator.js "  function inRange() {
    if (!sentinel || !sentinel.isConnected) return false;" \
                        "  function inRange() {
    if (true) return true;
    if (!sentinel || !sentinel.isConnected) return false;"

# An interstitial that ships <shreddit-feed></shreddit-feed>. Treating "feed container
# present" as proof that Reddit gave us renderable content blanked the page for the full
# patience window and then put #shd-error over the "Yes, I am over 18" button — bug 21 by a
# second route, and it also mishandles a subreddit that simply has no posts in it.
mutate "an empty feed is mistaken for a broken page" extension \
  src/core/gate.js "    if (!feedIsPopulated()) return 'empty-feed';" ''
# ...and the counterweight: being lenient about an EMPTY feed must not make us lenient about
# a feed full of markup we cannot read, which is what a renamed shreddit-post looks like.
mutate "a populated but unreadable feed stops failing" extension \
  src/core/gate.js "      if (c.querySelector(SHD.C.POST_WRAPPER)) return true;" "      return false;"
# The three callers used to ask this question in their own words and drifted apart. Both
# FAST paths have to be reverted together: they reach the same outcome and whichever runs
# first wins, so reverting one alone is invisible — the same reason the "only the fallback
# deadline" row above pairs them. Reverted together, an empty feed waits for the 1500ms tick
# instead of clearing in ~128ms, which the promptness threshold is calibrated to catch.
mutate "both fast paths forget the empty-feed case" extension \
  src/core/gate.js "      const why = nothingToRender();
      if (why) unblank(why);" "      if (sourceCount() === 0 && !hasFeedContainer()) unblank('no-feed-container');" \
  src/core/gate.js "      const why = document.readyState === 'complete' ? nothingToRender() : null;
      if (why) unblank(why);" "      if (document.readyState === 'complete' && sourceCount() === 0 && !hasFeedContainer()) unblank('no-feed-container');"

# Load order is encoded twice (manifest.json for the extension, build.js for the dev
# bundle). pipeline.js boots on load and calls everything else, so anything loading after it
# is undefined when it runs — and a reordering breaks the packed extension while the dev
# harness keeps working, the same asymmetry that hid the pagination bug.
mutate "pipeline.js no longer loads last" run \
  manifest.json '        "src/modules/chrome.js",
        "src/core/pipeline.js"' '        "src/core/pipeline.js",
        "src/modules/chrome.js"'

# The observers that drive modal suppression (upsell removal + lock stripping). Unarmed,
# an age gate's scroll lock is never stripped, so the page freezes under our layout.
mutate "the modal machinery never arms" extension \
  src/core/gate.js "    watchNativeModal();" ''

# Every display:flex here needs flex-wrap, or a row is laid out on one line and simply runs
# off the side of a narrow viewport. Real failure: 11px of overflow on the comments page at
# 360px on a machine with Verdana installed — invisible in a container without it, because
# the fallback font is narrower and the row happened to fit. A geometry assertion cannot
# reliably reproduce this without the real font (font-size/letter-spacing scaling let a flex
# item shrink and wrap its OWN text instead of forcing the row wider — tried, not kept, see
# geometry.js). The static rule is what actually catches it, everywhere, regardless of fonts.
mutate "a flex row drops its wrap and can overflow a narrow viewport" css-lint \
  src/styles/old-reddit.css "  /* A flex row defaults to nowrap, so these buttons were laid out on one line and simply
     ran off the side of a narrow viewport — measured 11px of horizontal overflow on a
     360px comments page. It passed CI for weeks because the fallback font on a Linux
     container is narrower than the Verdana this stylesheet actually asks for, so the row
     fitted there and only overflowed on a machine with the real font installed. Every
     display:flex here wraps, and test/css-lint.js requires it. */
  flex-wrap: wrap;
" ""

# ---------------------------------------------------------------------------- themes ----
#
# A theme is a palette in themes.css keyed by an id in themes.js, applied as an attribute on
# <html>. Every way that can break is silent: the click still lands, the attribute still
# changes, and the page simply does not change colour.

# The palette has to out-specify old-reddit.css's base block, because the packed extension
# delivers themes.css at document_start and old-reddit.css at document_idle — source order
# is against us and specificity is the only thing holding the theme up. Levelling the
# selector is invisible in the dev bundle (one <style>, themes.css last), which is exactly
# why this row runs against the packed extension.
mutate "theme palettes tie with the base instead of beating it" extension \
  src/styles/themes.css 'html.shd-active[data-shd-theme="night"] {' 'html[data-shd-theme="night"] {'

# A theme that leaves a colour out inherits CLASSIC's — so a dark theme keeps blue-on-black
# links and nothing anywhere goes red. Only a static check over the palette can see it.
mutate "a dark theme silently inherits the light link colour" css-lint \
  src/styles/themes.css '  --shd-link: #7fb0ff;
' ''

# Paint must not leak into layout. --shd-gutter is the sidebar arithmetic from bug 6; a theme
# that sets it re-creates the stepped right edge on that theme only, at some widths only.
mutate "a theme reaches into the layout metrics" css-lint \
  src/styles/themes.css '  --shd-page-bg: #0f1115;' '  --shd-gutter: 200px;
  --shd-page-bg: #0f1115;'

# The theme bar is five buttons wide and lives in the header. Without a wrap it is laid out
# on one line and runs off a 360px viewport — bug 31's mechanism, in a new row.
mutate "the theme bar cannot wrap onto a second line" css-lint \
  src/styles/old-reddit.css '.shd-themebar {
  display: flex;
  flex-wrap: wrap;' '.shd-themebar {
  display: flex;'

# Switching theme must repaint, not re-render: the storage listener returns early for a
# theme-only change. Without that, changing colour tears #shd-root down and rebuilds it,
# which on a paginated feed throws away every page the user has loaded.
mutate "a theme change tears the whole page down again" run \
  src/core/pipeline.js "        if (changed.length === 1 && changed[0] === 'theme') return;" \
                       '        /* reverted */'

# Both places the theme gets applied, together. Removing either alone is invisible because
# the other covers it — themes.js reads storage at document_start (which is what keeps a
# dark theme from opening on a white blackout) and pipeline.js applies it again from the
# settings it loads. Reverted together, a stored theme never reaches the page at all.
mutate "a stored theme never gets applied (both paths)" run \
  src/config/themes.js '      apply(settings && settings.theme);' '      /* reverted */' \
  src/core/pipeline.js '    SHD.theme.apply(SHD.settings.theme);
    watchSettings();' '    watchSettings();'

# The buttons are rendered once and updated in place. Without that the page repaints but the
# pressed button still points at the old theme — the switcher lies about what you are looking at.
mutate "the switcher stops reflecting the theme it applied" run \
  src/config/themes.js '    reflect(t);
    return t;' '    return t;'

# The blackout is painted before we have rendered anything, so it is the one thing that must
# be themed outside .shd-active. Losing it is the white flash the whole document_start dance
# exists to prevent.
mutate "the pre-render blackout goes back to white" geometry \
  src/styles/suppress.css 'html.shd-gate { background: var(--shd-blank, #ffffff); }' ''

# A <select> reads .value, not .checked. Treating every control as a checkbox writes
# `theme: undefined`, which resolves back to classic — the options page silently reverts you.
mutate "the options page treats the theme dropdown as a checkbox" run \
  options/options.js "const read = (c) => (c.type === 'checkbox' ? c.checked : c.value);" \
                     'const read = (c) => c.checked;'
# Reddit's own login upsell (desktop_auth_blocking_upsell) sets the same rpl-scroll-lock class
# the age gate does, but has no close control and ignores Escape and its own overlay. Deferring
# to it — the correct policy for every other Reddit modal — traps a logged-out reader behind a
# wall they cannot dismiss, with our layout hidden behind it.
mutate "we defer to a login wall the user cannot dismiss" extension \
  src/core/gate.js "    suppressKnownUpsells();
" ''
# The upsell arrives asynchronously. Watching only body[class] assumes Reddit inserts the
# elements and THEN sets the lock; reverse that order and the class observer has already fired
# by the time the elements exist, so nothing would ever notice them.
mutate "only a class change can notice the upsell, not its insertion" extension \
  src/core/gate.js "      if (!watchHost()) {" "      if (false) {"


# ---------------------------------------------------- the independent review, 2026-08-15 ----
#
# Ten rows from an independent code review that live-tested the extension on real Reddit.
# Finding 0 (hidden tabs) and finding 1 (pre-commit navigation) were confirmed by direct
# reproduction in Chrome 151 before being fixed.

# A page loaded in a background tab never paints, so rAF never fires — while the gate's
# deadline, a setTimeout, does. Measured live: 3 posts, 0 rows, 0 stamps, render-failed,
# and the failure latched because fail() disconnects the observer.
mutate "a hidden tab renders nothing and the deadline fails it" run \
  src/core/pipeline.js "    if (document.visibilityState === 'hidden') setTimeout(flush, 0);
    else requestAnimationFrame(flush);" "    requestAnimationFrame(flush);"

# A flush parked on a rAF booked just before the tab was hidden waits until the tab is
# shown again. The visibilitychange re-arm is what rescues it.
mutate "a flush parked across a visibility flip is never re-booked" run \
  src/core/pipeline.js "  addEventListener('visibilitychange', () => {
    if (queue.size) { scheduled = false; schedule(); }
  });" ""

# The shipped navigation bug, restored whole: read location inside a microtask queued from
# the PRE-COMMIT navigate event (still the old URL), latch it unconditionally, and have no
# post-commit safety net. Every sort change was swallowed or handled one navigation late.
mutate "route.js reads the old URL and latches it (sort desync)" run \
  src/core/route.js "        if (path) emit(path);" \
                    "        queueMicrotask(() => emit(location.pathname));" \
  src/core/route.js "      navigation.addEventListener('navigatesuccess', () => emit(location.pathname));" "" \
  src/core/route.js "    if (next === current && emit.lastPath === path) return;
    current = next;
    emit.lastPath = path;" "    const changed = next !== current || emit.lastPath !== path;
    current = next;
    emit.lastPath = path;
    if (!changed) return;"

# The deadline asked "did we render?" before anything had tried: the pipeline boots at
# document_idle and then awaits chrome.storage.sync, so at 1500ms "sources present, nothing
# rendered" can simply mean nobody has looked yet.
mutate "the deadline accuses a pipeline that has not started" run \
  src/core/gate.js "      if (!engaged) {
        unblank('not-started');
        if (waited < MAX_WAIT_MS) return scheduleCheck();
        return fail('pipeline-stalled', { sources, waited });
      }" ""

# engage() is the pipeline telling the gate "this route is mine". Without the call, the
# upsell surgery never arms and Reddit's login wall stands on pages we render.
mutate "the pipeline never tells the gate it took the route" extension \
  src/core/pipeline.js "    SHD.gate.engage(mode === R.PROFILE);" ""

# The upsell surgery ran on every route, including ones standDown() had promised were
# untouched — deleting Reddit's login wall and its scroll lock on profiles and search.
mutate "the upsell surgery edits routes we handed back" run \
  src/core/gate.js "    if (!engaged || stopped()) return false;" \
                   "    if (stopped()) return false;"

# If shreddit-app was late, the old fallback latched the insertion observer onto body's
# children permanently — so an upsell portalled into the app once it arrived was inserted
# into a node nobody watched, with no class change to notice it by.
mutate "the insertion observer latches onto body and never follows" run \
  src/core/gate.js "      if (!watchHost()) {
        try {
          // shreddit-app is a direct child of body, so a childList observer here sees it
          // arrive. Hand over and disconnect the moment it does.
          const pending = new MutationObserver(() => {
            syncNativeModal();
            if (watchHost()) pending.disconnect();
          });
          pending.observe(document.body, { childList: true });
        } catch { /* same */ }
      }" "      try {
        const host = document.querySelector(SHD.C.APP) || document.body;
        new MutationObserver(syncNativeModal).observe(host, { childList: true });
      } catch { /* same */ }"

# The tempting-but-wrong companion to the route fix: un-stamping in onRoute. onRoute now
# runs PRE-COMMIT, when the DOM still holds the OUTGOING page's posts — un-stamping them
# re-renders the old sort into the new root, racing Reddit's swap. The stamps are what
# make the teardown-time sweep skip them.
mutate "onRoute un-stamps the outgoing page and re-renders it" run \
  src/core/pipeline.js "    observe();
    collect(document.body);" "    document.querySelectorAll(\`[\${C.MARK}]\`).forEach(el => el.removeAttribute(C.MARK));
    observe();
    collect(document.body);"

# ---------------------------------------------------------------- old.reddit fidelity ----
# Measured against a live old.reddit before it goes away. Each of these was a value the
# extension had picked by eye and got wrong; the assertions exist because the source of
# truth is being retired and cannot be re-measured later.

# Two rows, not one: the thread line being ON .child and being OFF .thing.comment are
# separate checks, and either alone leaves the tree looking almost right. Moving it back
# also silently restores the 31px indent, because a border on .comment sits inside the
# per-level arithmetic.
mutate "comment thread line moves off .child" css-lint \
  src/styles/old-reddit.css '  margin: 0 0 0 15px;
  border-left: 1px var(--shd-thread-style) var(--shd-thread-line);' \
                            '  margin: 0 0 0 8px;'

mutate "thread line reappears on .thing.comment" css-lint \
  src/styles/old-reddit.css '  padding: 0 0 3px 0;
  margin: 6px 0 0 9px;' '  padding: 0 0 3px 0;
  margin: 6px 0 0 9px;
  border-left: 1px var(--shd-thread-style) var(--shd-thread-line);'

# The arrow gutter as padding on .thing.comment is inherited by every nested level and
# added again, which is where the 31px step came from.
mutate "arrow gutter back on .thing.comment, not .entry" geometry \
  src/styles/old-reddit.css '.thing.comment > .entry { padding-left: 22px; }' ''

mutate "comment vote arrows hidden until hover" geometry \
  src/styles/old-reddit.css '  left: 2px;
  top: 0;
  width: 15px;' '  left: 2px;
  top: 0;
  width: 15px;
  display: none;'

# The width and the font-size have to move together; the old check was a bare >= 34.
mutate "score column too narrow for its own font-size" css-lint \
  src/styles/old-reddit.css '  width: 43px;' '  width: 34px;'

# Only the placeholders take a border, so without box-sizing they measure 72px against the
# images' 70px and every mixed row loses its baseline.
mutate "bordered placeholder tiles outgrow image thumbnails" geometry \
  src/styles/old-reddit.css '  box-sizing: border-box;
  width: 70px;
  height: 70px;' '  width: 70px;
  height: 70px;'

# ------------------------------------------------------- the Superstonk report ----------
# A report hit "sources: 26, rendered: 0, errors: 0" and could not tell a stale
# contract from a render queue that never ran — the card blamed markup either way, and the
# report chased contract renames its own attribute dump disproved. These four keep the
# evidence chain alive.

# model.js returning bare nulls again: rejects vanish, the card loses its tally, and the
# next such report is back to guessing.
mutate "model rejects go unrecorded again" run \
  src/core/model.js "    if (!id) return reject('comment', [A.id]);" \
                    "    if (!id) return null;" \
  src/core/model.js "      return reject('post',
        [!id && A.id, !title && A.title, !permalink && A.permalink].filter(Boolean));" \
                    "      return null;"

# The card drops the fork evidence: stamped and rejected lines gone from diagnostics.
mutate "the error card loses the stamped/rejected evidence" run \
  src/core/gate.js '      `stamped:    ${stampedCount()} processed by the renderer (0 here means the render queue never ran)`,
      `rejected:   ${(SHD.model && SHD.model.rejectSummary()) || '"'"'none recorded'"'"'}`,
' ''

# The explanation stops branching on the stamp count: a queue that never ran gets blamed
# on Reddit markup again, which is the exact wrong-file chase the report went on.
mutate "zero-stamped failures blame the markup again" run \
  src/core/gate.js "      why: d.stamped === 0" \
                   "      why: false"

# The post text vanishes from the comments page — the original symptom, "comments fine,
# post content missing".
mutate "post selftext body vanishes from the comments page" run \
  src/modules/comments.js "    if (m.bodyNode) {
      row.querySelector('.entry').appendChild(
        h('div.usertext-body.shd-selftext', null, m.bodyNode.cloneNode(true)));
    }
" ""

# The cascade the report DIAGNOSED (wrongly, but nothing asserted otherwise): the first
# unconsumable element aborts the flush, so one broken post zeroes out a whole thread.
mutate "one bad element takes the whole flush down" run \
  src/core/pipeline.js "        markDone(el);                 // stamp regardless: a skipped item must not be retried
        if (ok) rendered++;" \
                       "        markDone(el);
        if (!ok) { queue.clear(); break; }
        rendered++;"

# ------------------------------------------------- popups never take the layout ----------
# POLICY (project decision, 2026-08-20): suppression replaced deferral. These reintroduce the
# behaviours the policy forbids.

# The bug the old defer machinery caused BY DESIGN: a popup throws the reader out of the
# layout. Reintroduced crudely at the suppression site.
mutate "a popup once again throws the reader out of the layout" run \
  src/core/gate.js "    if (nativeModalUp()) document.body.classList.remove(SHD.C.NATIVE_MODAL_CLASS);" \
                   "    if (nativeModalUp()) { document.body.classList.remove(SHD.C.NATIVE_MODAL_CLASS); document.documentElement.classList.remove(SHD.C.BODY_CLASS); }"

# The lock never stripped: the layout stays but the page cannot scroll, under a modal
# nobody can see — reads as a hang, and nothing on screen says why.
mutate "the scroll lock is never stripped" run \
  src/core/gate.js "    suppressKnownUpsells();
    stripScrollLock();" "    suppressKnownUpsells();"

# Bug 37, lock edition: stripping must not reach routes we handed back.
mutate "lock-stripping reaches stood-down routes" run \
  src/core/gate.js "  function stripScrollLock() {
    if (!engaged || stopped()) return;" "  function stripScrollLock() {
    if (stopped()) return;"

# Reddit sometimes reinforces the lock with an INLINE overflow:hidden; stripping the class
# alone leaves the page frozen. The CSS backstop is what unfreezes it.
mutate "the inline overflow lock outlives suppression" extension \
  src/styles/old-reddit.css "  overflow: visible !important;
" ""

# The one modal we answer, and the two ways answering can rot. The click matcher losing its
# caution is the dangerous direction: the decline button navigates away, so "clicks
# something" is strictly worse than "clicks nothing".
mutate "the age-gate click stops caring which button" run \
  src/core/gate.js "          return SHD.C.AGE_GATE.affirm.test(t) && !SHD.C.AGE_GATE.decline.test(t);" \
                   "          return true;"

# Silent regression to suppress-only: the gate is hidden but never answered, so Reddit
# never learns the preference and pagination stays unattested.
mutate "the age gate is never answered" run \
  src/core/gate.js "    answerAgeGate();
    suppressKnownUpsells();" "    suppressKnownUpsells();"

# Live testing, verified build: every back/forward landed on the error card (9/9), because
# Reddit REUSES its cached post elements on a history traversal — same nodes, data-shd
# stamps and all — and the sweep skipped them as already-rendered. The fix revives a
# STAMPED element on INSERTION when its rendered row is gone; reverting it turns every
# traversal back into "sources N, stamped N, rendered 0".
mutate "history traversals dead-end on stale stamps again" run \
  src/core/pipeline.js "  const revive = (el) => {
    if (isDone(el) && !rowFor(el)) el.removeAttribute(C.MARK);
  };" "  const revive = () => {};"

# The revival's own guard: without the row check, ANY re-inserted stamped element gets
# re-rendered — a reparented element with a live row renders twice.
mutate "revival ignores whether the row still exists" run \
  src/core/pipeline.js "    if (isDone(el) && !rowFor(el)) el.removeAttribute(C.MARK);" \
                       "    if (isDone(el)) el.removeAttribute(C.MARK);"

# Observed live 2026-08-20 on a quarantined sub, logged out: Reddit serves zero posts and
# renders its own "no posts yet" panel inside shreddit-feed. Counting DESCENDANTS reads that
# panel as a populated feed, so an empty subreddit gets the failure screen — an error card
# over a page that is working exactly as Reddit intended, which is this module's cardinal
# sin (bugs 21, 29). The counterweight row below it must stay caught: a feed genuinely full
# of unreadable post markup still has to fail loudly.
mutate "an empty subreddit is blamed for having no posts" run \
  src/core/gate.js "      let scope = c;
      if (scope.children.length === 1) scope = scope.children[0];
      const byTag = new Map();
      for (const kid of scope.children) byTag.set(kid.tagName, (byTag.get(kid.tagName) || 0) + 1);
      return [...byTag.values()].some(n => n >= SHELL_ELEMENTS);" \
                   "      return c.querySelectorAll('*').length > SHELL_ELEMENTS;"

# ------------------------------------------------------------- live testing ------------
# Comment pagination had never worked live, and the sentinel's own diagnostics finally
# said why: shdIoTicks 0 — the IntersectionObserver never delivered even its initial
# report, and it was the only thing that could start the chain. Bug 40 demoted it to a
# wake-up but left it the ONLY wake-up.
mutate "the chain starts only if the observer speaks first" run \
  src/core/paginator.js "    // Start the chain OURSELVES. Bug 40 demoted the observer to a wake-up but left it the
    // only wake-up, and live testing measured the failure that allows: shdIoTicks stuck at
    // 0 across serials — an observer that never delivered even its initial report — with
    // the sentinel visibly in range and the chain never starting. pump() is geometry-gated
    // by inRange(), so on a page where the sentinel is far away this is a no-op.
    pump('attach');" ""

# The live thread anatomy: ~25 per-branch expanders plus ONE top-level continuation
# partial. Document order puts the branches first, so without the placement preference the
# paginator spends its pages expanding branch after branch and never continues the thread.
mutate "document order beats placement and the thread never continues" run \
  src/core/paginator.js "    const all = document.querySelectorAll(SEL);
    for (const p of all) if (!p.closest(ITEM)) return p;
    return ITEM_FALLBACK[MODE] ? (all[0] || null) : null;" "    return document.querySelector(SEL);"

# The pick crosses the bridge as a selector only the chosen element matches. Reverting to
# "both sides querySelector the same string" re-splits the two worlds: the isolated world
# stamps its preferred partial while the main world drives the first one in document
# order — one element stamped, a different one driven, measured twice in the fixture.
mutate "the two worlds pick different partials again" run \
  src/core/paginator.js "    target.setAttribute(DRIVING, '');
    root.dataset[C.BRIDGE.selKey] = \`\${C.LAZY_LOADER}[\${DRIVING}]\`;" \
                        "    root.dataset[C.BRIDGE.selKey] = SEL;"

# Live testing clicked Reddit's own "N more replies" control on a live thread: it works logged
# out and the pipeline rendered everything it loaded. The delegated control is that click,
# offered in our layout; late replies must nest under the branch that was expanded, which
# the depth-stack cannot do (it points at the latest rendered chain by then).
mutate "the more-replies control vanishes from truncated branches" run \
  src/modules/comments.js "    const more = moreRepliesControl(m);
    if (more) childListing.appendChild(more);" ""

mutate "late replies nest under the latest chain, not their branch" run \
  src/modules/comments.js "    let target = null;
    const parentEl = el.parentElement?.closest(C.COMMENT);
    if (parentEl) {
      const pid = parentEl.getAttribute(C.COMMENT_ATTR.id);
      const prow = pid && document.querySelector(\`#\${C.ROOT_ID} .thing[data-fullname=\"\${pid}\"]\`);
      target = prow?.querySelector(':scope > .child > .sitetable') || null;
    }
    if (!target) {" "    let target = null;
    if (!target) {"

# Two field cards read "sources: N, stamped: 0" — a queue starved of its frame, blamed by
# a deadline that never tried to drain it. gate.js kicks the pipeline before accusing.
mutate "the deadline accuses a queue it never tried to drain" run \
  src/core/gate.js "      if (stampedCount() === 0) {
        SHD.pipeline?.kick?.();
        if (renderedCount() > 0) return;    // reveal() ran inside the flush; we are done
      }" ""

# Reported from real use: "very hard to read on the light themes". Cloned bodies wear
# Reddit's own classes, Reddit's page stylesheet still matches them (open question 7), and
# its text color rides the HOST page's theme — theme-dark, so near-white text on our light
# palettes. The fixture now serves the leaking rules; only geometry computes real styles.
mutate "cloned bodies wear Reddit's theme color again" geometry \
  src/styles/old-reddit.css ".usertext-body,
.usertext-body :not(a) { color: var(--shd-text) !important; }
.usertext-body blockquote,
.usertext-body blockquote :not(a) { color: var(--shd-quote-text) !important; }
.usertext-body a { color: var(--shd-link) !important; }" \
".usertext-body a { color: var(--shd-link); }"

# ------------------------------------------------------------- live testing ------------
# Live testing measured BOTH event wake-ups dead in the field (ioTicks 0 for the whole round,
# and a real scroll to the bottom that changed nothing) while every timer worked. The
# heartbeat is the wake-up that cannot be taken away — remove it and a sentinel that
# enters range with no event delivered is never noticed.
mutate "no heartbeat: a chain no event wakes never starts" run \
  src/core/paginator.js "    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (busy && busySince && Date.now() - busySince > BUSY_LIMIT_MS) {
        console.warn(\`[sheddit] a page load wedged for \${Date.now() - busySince}ms — releasing. \` +
          'The chain continues; whatever that load was doing is abandoned.');
        busy = false;
        lastRefusal = 'busy-wedged';
      }
      diag();
      pump('tick');
    }, HEARTBEAT_MS);" ""

# Live testing field state: busy wedged true for 60+ seconds, no refusal, chain dead. The
# watchdog releases and names it so a hang costs one page, not the session.
mutate "a wedged load kills the chain for good again" run \
  src/core/paginator.js "      if (busy && busySince && Date.now() - busySince > BUSY_LIMIT_MS) {
        console.warn(\`[sheddit] a page load wedged for \${Date.now() - busySince}ms — releasing. \` +
          'The chain continues; whatever that load was doing is abandoned.');
        busy = false;
        lastRefusal = 'busy-wedged';
      }
" ""

# v.redd.it 302s a logged-out session back to the comments page — a closed loop under our
# layout. The mp4 out of packaged-media-json is the watchable link.
mutate "video posts link back into the closed loop" run \
  src/core/model.js "    const videoUrl = type === 'video' ? mp4Of(el) : null;" \
                    "    const videoUrl = null;"

# The fixture lists renditions low-quality-FIRST precisely so this row means something.
mutate "the mp4 pick stops preferring the best rendition" run \
  src/core/model.js "        .sort((a, b) => (b.height - a.height) || (Number(a.vp9) - Number(b.vp9)) || (a.i - b.i))
        [0].url;" "        [0].url;"

# ------------------------------------------------------------- live testing ------------
# Live testing's front page: 40 page slots burned, ZERO new rows. `shreddit-feed
# faceplate-partial` also matches Reddit's HOVERCARD partials, one per author and
# subreddit link INSIDE the posts, so once the real feed partial was spent the chain drove
# hovercard after hovercard. No partial inside a post ever continues a feed.
mutate "hovercard partials inside posts are driven as pages again" run \
  src/core/paginator.js "    for (const p of all) if (!p.closest(ITEM)) return p;
    return ITEM_FALLBACK[MODE] ? (all[0] || null) : null;" \
                        "    return all[0] || null;"

# The second guard on the same failure: a load that yields no new sources is a dead end,
# whatever it was we drove. Without this the chain keeps paying for nothing. The mutation
# is the pre-guard code: every load reads as productive, nothing is ever refused.
mutate "a load that produces nothing counts as progress" run \
  src/core/paginator.js "      if (sourcesAfter > sourcesBefore) {
        pages++;
        unproductive = 0;
        lastRefusal = 'none';
        setStatus(null);
        return true;
      }
      if (++unproductive >= UNPRODUCTIVE_LIMIT) {
        setStatus(null);
        return refuse('unproductive');
      }
      lastRefusal = 'none';
      setStatus(null);
      return true;" \
                        "      pages++;
      unproductive = 0;
      lastRefusal = 'none';
      setStatus(null);
      return true;"

# ------------------------------------------------------------- live testing ------------
# Live testing measured the limit's real field behaviour: SOFT — the heartbeat retries past it,
# and that softness rescued a throttled front page (28 -> 178 rows). The fix made soft
# honest, in two halves; each half gets its own row because either alone leaves the other
# looking covered.
#
# Half one: `pages` counted ATTEMPTS, not content — live testing read `pages` 33 for ~7
# productive loads, so a throttled tab starved its own 40-page budget on loads that
# added nothing.
mutate "barren loads eat the page budget again" run \
  src/core/paginator.js "      if (sourcesAfter > sourcesBefore) {
        pages++;
        unproductive = 0;" \
                        "      pages++;
      if (sourcesAfter > sourcesBefore) {
        unproductive = 0;"

# Half two: the limit declared "no more pages" and then the heartbeat visibly resumed —
# the label flapped six times in one field series. That string belongs to `exhausted`,
# the state where nothing is left to drive.
mutate "a soft refusal claims no more pages again" run \
  src/core/paginator.js "      if (++unproductive >= UNPRODUCTIVE_LIMIT) {
        setStatus(null);
        return refuse('unproductive');
      }" \
                        "      if (++unproductive >= UNPRODUCTIVE_LIMIT) {
        setStatus('no more pages');
        return refuse('unproductive');
      }"

# pump() guarded on the cap and returned BEFORE loadNext could set a label, so a chain at
# the ceiling sat reading "load more" — the label of a load that succeeded. Measured on
# both a 2,040-comment thread and the front page.
mutate "the page cap goes unreported again" run \
  src/core/paginator.js "    if (pages >= MAX_PAGES) { setStatus(\`stopped after \${MAX_PAGES} pages\`); return; }
    if (!inRange() || busy) return;" \
                        "    if (!inRange() || busy || pages >= MAX_PAGES) return;"

# packaged-media-json is on a nested <shreddit-player>, NOT the post element — captured
# live after two rounds of assuming otherwise. Reading it off the post finds nothing and
# every video title falls back to the v.redd.it closed loop.
mutate "the video JSON is read off the post element again" run \
  src/core/model.js "      const host = [...el.querySelectorAll(\`[\${C.POST_VIDEO_JSON}]\`)]
        .find(n => n.closest(C.POST) === el);
      const raw = host && host.getAttribute(C.POST_VIDEO_JSON);" \
                    "      const raw = el.getAttribute(C.POST_VIDEO_JSON);"

# The live filenames are m2-res_<height>p.mp4. Ranking on DASH_ scores every one of them
# zero, so the sort is stable and the FIRST url wins — which is the LOWEST quality.
mutate "the rendition rank stops understanding live filenames" run \
  src/core/model.js "      const fileRank = (u) => {
        const file = u.split('?')[0].split('/').pop() || '';
        return Math.max(0, ...(file.match(/\d+/g) || ['0']).map(Number));
      };" "      const fileRank = (u) => Number((u.match(/DASH_(\d+)/i) || [])[1] || 0);"

# ------------------------------------------------------- 2026-08-22 report -------
# The title stops being the mp4 (project decision, open question 9): Reddit's packaged
# renditions die asset by asset, so a title that resolves to one intermittently lands on
# Chrome's "source fetch error". The title goes where the v.redd.it bounce was going to
# land anyway; the mp4 gets its own link.
mutate "the video title carries the mp4 again" run \
  src/core/model.js "      href: (isSelf || type === 'video') ? permalink : (contentHref || permalink)," \
                    "      href: isSelf ? permalink : (videoUrl || contentHref || permalink),"

# ...and the watch link stays off the comments page, where it would point at the page you
# are already on.
mutate "the watch link turns up on the comments page too" run \
  src/modules/listing.js "      m.type === 'video' && SHD.route.current !== SHD.route.COMMENTS" \
                         "      m.type === 'video'"

# Two halves of one fix, and they need separate rows because either alone hides the other.
# The JSON states `dimensions.height`; the filename scan exists to RECOVER that number, so
# a rendition whose name carries no number must not lose to one that does.
mutate "the mp4 pick ignores the height the JSON states" run \
  src/core/model.js "        .map(([url, stated], i) =>
          ({ url, i, height: stated == null ? fileRank(url) : stated, vp9: isVp9(url) }))" \
                    "        .map(([url], i) => ({ url, i, height: fileRank(url), vp9: isVp9(url) }))"

# And the tie itself: Reddit lists a vp9 and an h264 rendition at the SAME height, vp9
# first, so without this the codec is whatever Reddit happened to send first — measured
# live as four of six video posts on one sub resolving to vp9 by nobody's decision.
mutate "the codec tie goes back to Reddit's array order" run \
  src/core/model.js "(Number(a.vp9) - Number(b.vp9)) || " ""

# The player hydrates late — 3 of 4 live video posts had no JSON at first paint — so a
# render-time href alone leaves most video titles pointing back into the loop.
mutate "video links stop re-resolving at click time" run \
  src/modules/listing.js "            onclick: function () {
              const late = SHD.model.mp4Of(m.source);
              if (late) this.href = late;
            }" "            onclick: null"

# Live testing: two clicks on the more-replies control did nothing, and the label never changed
# to "loading…" — the handler had not run, because the click landed on the list item's box
# rather than the anchor inside it.
mutate "the more-replies handler moves back onto the anchor only" run \
  src/modules/comments.js "        e.preventDefault();
        if (loading) return;" "        if (e.target !== link) return;
        e.preventDefault();
        if (loading) return;"

# Live testing: rows grew 28 -> 203 while `pages` stayed 0 and every load read as
# unproductive — the live feed delivers after settle()'s window closes, so the page budget
# never advanced and the unproductive counter never reset.
mutate "a page that delivers late is never counted" run \
  src/core/paginator.js "      if (lastAfter !== null && sourcesBefore > lastAfter) {
        pages++;
        unproductive = 0;
        lastRefusal = 'none';
      }
" ""

# --------------------------------------------------- 0.10.0: profiles + label honesty ---
# Reported live on 0.9.0's release day: the sentinel flashed "no more pages" between pages
# that then loaded fine — the successor partial streams in late, and the exhausted branch
# announced "nothing to drive right now" as "nothing left". The auto path must wait for
# the empty state to PERSIST before committing the label.
mutate "a single empty look claims no more pages again" run \
  src/core/paginator.js "      if (reason === 'manual' || ++exhausted >= EXHAUSTED_STICKY) setStatus('no more pages');" \
                        "      setStatus('no more pages');"

# User profiles (project decision 2026-08-21). Dropping the classification silently reverts
# the whole feature to the pre-scope state — native Reddit with no telltale symptom.
mutate "user profiles route to OTHER again" run \
  src/core/route.js "    if (/^\\/user\\/[^/]+\\/?$/.test(path)) return PROFILE;
    if (/^\\/user\\/[^/]+\\/(overview|comments|submitted)\\/?$/.test(path)) return PROFILE;" \
                    ""

# The profile contract is unverified, so failures there must hand back quietly — an error
# card over a profile we merely cannot read yet covers a page that works fine natively.
mutate "a profile failure raises the error card again" run \
  src/core/gate.js "    if (soft) {
      document.documentElement.setAttribute('data-shd-soft-fail', reason);" \
                   "    if (false) {
      document.documentElement.setAttribute('data-shd-soft-fail', reason);"

# One reject on a profile is the whole verdict: rendering the readable remainder shows a
# profile with most of its content silently missing. Without the flush-time check the
# partial page REVEALS, the gate's deadline never looks again, and nothing hands back.
mutate "an unreadable profile renders a partial page again" run \
  src/core/pipeline.js "    if (mode === R.PROFILE) {
      const sent = document.querySelectorAll(C.PROFILE_COMMENT).length;
      const drawn = document.querySelectorAll(\`#\${C.ROOT_ID} .shd-profile-comment\`).length;
      if (sent > 0 && drawn === 0) {
        SHD.gate.fail('profile-unreadable',
          { sent, rejected: SHD.model.rejectSummary() });
        return;
      }
    }" ""

# The counterweight, and the reason the rule above is 'none rendered' rather than 'any
# reject': a history traversal re-consumes restored elements mid-hydration, and one that
# is not ready yet must not cost a profile that is rendering fine.
mutate "one unreadable comment hands back the whole profile again" run \
  src/core/pipeline.js "      if (sent > 0 && drawn === 0) {" \
                       "      if (SHD.model.rejects.length) {"

# Reddit wraps the real markdown container in an outer div whose LAST class is also `md`,
# and that wrapper carries layout utilities Reddit's own stylesheet applies to our clone.
mutate "the profile body clones Reddit's wrapper instead of the markdown node" run \
  src/core/model.js "    const bodyNode = bodies.find(n => !bodies.some(o => o !== n && n.contains(o)))
      || bodies[0] || null;" \
                    "    const bodyNode = bodies[0] || null;"

# 0.10.0 read profile comments with THREAD comment attribute names (thingid/permalink),
# which is why every live profile handed back — live testing captured comment-id/href instead.
# The tag was right and the attributes were wrong, so this is the half worth guarding.
mutate "profile comments are read with thread-comment attribute names again" run \
  src/core/model.js "    const A = C.PROFILE_COMMENT_ATTR;" \
                    "    const A = C.COMMENT_ATTR;"

# The half the reject check cannot see: if the real tag is neither one we query, nothing
# matches, nothing REJECTS, the posts render and the comments are silently absent — a
# profile that looks fine and is missing most of its content.
mutate "an unqueried comment element goes unnoticed (posts-only profile)" run \
  src/core/pipeline.js "    if (mode === R.PROFILE && !SHD.gate.revealed) {
      const unknown = unreadProfileComment();
      if (unknown) {
        SHD.gate.fail('profile-unknown-comment', { tag: unknown });
        return;
      }
    }" ""

# ...and its counterweight, which is what keeps the check above from being a hair trigger.
# A readable profile carries comment-shaped FURNITURE — action rows inside comments,
# hovercards inside posts — and none of it may hand the page back.
mutate "the unknown-element check turns into a hair trigger" run \
  src/core/pipeline.js "      if (el.closest(\`\${known}, \${C.POST}\`)) continue;
      if (el.querySelector(known)) continue;" ""

# The suite's own machinery, ported from the public-docs branch along with its bug entry.
# Every booted page leaves the paginator heartbeat and the pipeline's observers running;
# nothing closed them, so the late sections shared an event loop with every window before
# them and the manual-drive paginator tests went flaky (measured `pages: 0` where 40 was
# asserted, ~1 run in 6). This row IS probabilistic — the bug it restores is intermittent,
# so a green run clears nothing, and the round-12 sweep duly reported it SURVIVED. That is
# why the suite no longer relies on it: BOOTING A SECTION CLOSES THE PREVIOUS ONE asserts
# the fact rather than the flake (jsdom has no window.closed, so it measures the thing that
# mattered — the abandoned window's timers stop). Bug 69's entry claimed that guard already
# existed; it did not. Keep this row anyway: it is the only thing that exercises the flake
# itself.
mutate "sections leak live windows again (flaky paginator drives)" run \
  test/run.js "  if (previousWindow) {
    try { previousWindow.close(); } catch { /* already torn down */ }
    previousWindow = null;
  }" ""

# The window-close row above stops a window LEAKING INTO a later section; it does nothing
# for a race WITHIN one, which is what this row restores. This exact line was independently
# lost and silently reintroduced the flake it fixes — dropped during a file-by-file merge
# that carried other changes across but not this one line — so a row that would have caught
# that regression on the next mutation sweep is worth more here than almost anywhere else in
# this file. Probabilistic like its neighbour above — the bug is a race, not a
# deterministic failure — and it SURVIVED the round-12 sweep for that reason. The
# deterministic half is in the section itself now: whether the opt-out is in force is a
# fact even when the race it prevents is not, so the section asserts autoPaginate === false
# before it drives anything by hand.
mutate "the hovercard section's manual drive races the auto chain again" run \
  test/run.js "    const { window, doc } = await boot(withHovercards, 'https://www.reddit.com/', (win) => {
      noAuto(win);   // this section drives by hand; an auto load in flight refuses it as \`busy\`
      win.eval(PAGER_SCRIPT);" \
                "    const { window, doc } = await boot(withHovercards, 'https://www.reddit.com/', (win) => {
      win.eval(PAGER_SCRIPT);"


# ------------------------------------------------------- 0.12.2: live testing's findings ---
# Live testing: six clicks on a 620-comment thread delivered 3, 0, 1, 5, 4 and 4 replies
# against labels of 3, 8, 1, 7, 11 and 15 — and every one of them consumed the control,
# which removed itself four seconds after the click whether or not anything arrived. A
# branch you cannot finish expanding is a thread you cannot read to the end.
mutate "the expander removes itself on a timer again, win or lose" run \
  src/modules/comments.js "        const deadline = Date.now() + timings.waitMs;
        const poll = () => {" "        setTimeout(() => line.remove(), timings.waitMs);
        const deadline = Date.now() + timings.waitMs;
        const poll = () => {"

# The other half of the same bug: an expansion that delivered nothing looked exactly like
# one that worked. "Fails loudly, never silently" applies to our own controls too.
mutate "a no-op expansion goes back to saying nothing" run \
  src/modules/comments.js "          link.textContent = still ? 'no replies loaded — try again' : 'no more replies';" \
                          "          link.textContent = label(native);"

# And it must not credit someone else's arrivals to our click: a page-wide count reports
# success whenever the paginator happens to deliver a top-level page mid-expansion.
mutate "the expansion measures the whole page instead of its own branch" run \
  src/modules/comments.js "      return row
        ? row.querySelectorAll(':scope > .child .thing.comment').length
        : document.querySelectorAll(\`#\${C.ROOT_ID} .thing.comment\`).length;" \
                          "      return document.querySelectorAll(\`#\${C.ROOT_ID} .thing.comment\`).length;"

# Live testing: `218586` on a live front page — rank 2 beside score 18586. The boxes abutted
# exactly, which is what both guards were checking; what collides is the ink.
mutate "the rank column loses its gutter and the ink collides again" css-lint \
  src/styles/old-reddit.css "  box-sizing: content-box;
  width: 36px;
  padding-right: 6px;" "  width: 36px;" \
  src/styles/old-reddit.css "  left: 42px;                    /* 36px rank + its 6px gutter — see .thing .rank above */" \
                            "  left: 36px;"

mutate "...and geometry has to catch it too, on painted text" geometry \
  src/styles/old-reddit.css "  box-sizing: content-box;
  width: 36px;
  padding-right: 6px;" "  width: 36px;" \
  src/styles/old-reddit.css "  left: 42px;                    /* 36px rank + its 6px gutter — see .thing .rank above */" \
                            "  left: 36px;"

# Live testing: thirty comments on /user/spez/ all read "comment in u/spez". On a profile the
# permalink can be user-scoped for every comment, so the first path segment is the page we
# are standing on rather than the community — and printing it is the bug.
mutate "a profile comment names the profile owner as its community again" run \
  src/core/model.js "    } else if (kindOf === 'user' && name && name !== owner) {" \
                    "    } else if (kindOf === 'user' && name) {"

mutate "the rendered community link stops being preferred over the rewritten path" run \
  src/core/model.js "    const linkedSub = subredditLinkIn(el);" "    const linkedSub = null;"

# Live testing: the sentinel flapped loading more… -> load more -> loading more… on /r/aww.
# attach() runs after every flush and built a node whose label starts idle.
mutate "the sentinel forgets an in-flight load on every re-attach" run \
  src/core/paginator.js "        href: '#', text: status || 'load more'," "        href: '#', text: 'load more',"

# Live testing: the README claimed 72px rows and the geometry suite had never measured one.
mutate "long titles are clipped instead of growing the row" geometry \
  src/styles/old-reddit.css ".thing.link {
  position: relative;" ".thing.link {
  height: 72px;
  overflow: hidden;
  position: relative;"

# Two independent reports: opening a comments page locked the tab for 30+ seconds, and a
# [-] collapse did the same. Both are the chain filling an untouched page until it hits a
# cap. The fill is bounded twice and the halves get SEPARATE rows, because they cover
# different situations — a page that is already tall, and a run of loads that never makes
# one — so either alone would leave the other looking covered.
#
# The height half. Only geometry can see it: jsdom does no layout and reports scrollHeight
# 0, so under `run` this mutation changes nothing and would read as a hole that isn't one.
mutate "the unprompted fill stops noticing the page is already worth scrolling" geometry \
  src/core/paginator.js "    return m.pageHeight >= m.viewport * FILL_VIEWPORTS;" \
                        "    return false;"

# The attempt half — the backstop for loads that deliver nothing, which never grow the page
# and so would spin against the height test for ever.
mutate "the unprompted fill loses its attempt limit" run \
  src/core/paginator.js "      if (enough || unprompted >= UNPROMPTED_MAX) {" \
                        "      if (enough) {"

# And the release. Everything above is only acceptable because scrolling turns the chain
# back on; without it the limits stop being a pause and become a dead end.
mutate "scrolling stops counting as a reason to keep loading" run \
  src/core/paginator.js "    interacted = true;
    if (!sentinel) return;" "    if (!sentinel) return;"

# An image post's comments page showed a title, a 70px thumbnail and nothing else, and the
# thumbnail navigated out of the layout into Reddit's own /media viewer. Two halves of one
# gap: the picture is not an attribute, so nothing read it.
mutate "an image submission loses its picture again" run \
  src/modules/comments.js "    try { picture = postImage(m); } catch { picture = null; }" \
                          "    try { picture = null; } catch { picture = null; }"

# The responsive set lists 320, 1080, 640. Taking the first is the same mistake the video
# rendition rank made: it scores every candidate zero and the stable sort hands back
# whichever Reddit happened to list first, which is the SMALLEST.
mutate "the largest rendition stops winning, and the first one does" run \
  src/core/model.js "        if (c.w > bestW) { bestW = c.w; best = c.url; }" \
                    "        if (bestW < 0) { bestW = c.w; best = c.url; }"

mutate "an image title points at the viewer-bound image URL again" run \
  src/core/model.js "        : (type === 'image' && imageUrl && viewerBound(contentHref)) ? permalink" \
                    "        : false ? permalink"

# The adult-content gate, on BOTH surfaces that draw a picture. Separate rows on purpose:
# they are different call sites covering different pages, so removing one leaves the other
# looking covered. This is bug 41's family — rendering our own <img> is what walks past the
# blur Reddit applies for logged-out readers, and a full-size copy is that bypass enlarged.
mutate "an adult post is enlarged on its comments page" run \
  src/modules/comments.js "    if (m.nsfw && !SHD.settings.showNsfwThumbnails) return null;" \
                          "    if (false) return null;"

mutate "an adult row gets an expando that opens the picture" run \
  src/modules/listing.js "    if (m.nsfw && !SHD.settings.showNsfwThumbnails) return null;" \
                         "    if (false) return null;"

# Building the <img> at render time instead of on first open. A listing is dozens of rows,
# so this fetches every full-size picture on the page for rows nobody opened — the exact
# cost old reddit's expando exists to avoid, and invisible on screen.
mutate "every row fetches its full-size picture up front" run \
  src/modules/listing.js "    return h('div.expando', { hidden: true, dataset: { shdSrc: m.image } });" \
                         "    return h('div.expando', { hidden: true, dataset: { shdSrc: m.image } }, h('img.shd-expando-img', { src: m.image, alt: '' }));"

# The other half, and it needs its own row: appending on every toggle rather than on first
# open leaves a stack of identical pictures. Nothing counted them until a mutation survived.
mutate "reopening an expando stacks another copy of the picture" run \
  src/modules/listing.js "      if (opening && !box.firstChild) {" \
                         "      if (true) {"

# The cap. A picture arrives at whatever size Reddit stored it at, so without this a wide
# photo widens the column and pushes the document sideways. Only geometry can see it.
mutate "the comments-page picture loses its width cap" geometry \
  src/styles/old-reddit.css ".shd-selfpost .shd-image { margin: 5px 0; max-width: var(--shd-video-max); }" \
                            ".shd-selfpost .shd-image { margin: 5px 0; }"

# The comments-page head: `all N comments` + the sort menu, requested twice from live use.
mutate "the comment sort strip vanishes again" run \
  src/modules/comments.js "    ensureCommentHead(r, m);" "    ;"

# The current-sort marker read from the URL. Gutting it marks `best` always — caught by the
# ?sort=new boot, which exists precisely because a strip that always marks the default
# looks perfectly correct on the default page.
mutate "the sort strip stops noticing which sort the page is on" run \
  src/modules/comments.js "      if (q && C.COMMENT_SORTS.some(s => s.id === q)) current = q;" \
                          "      if (false) current = q;"

# The late-timestamp patch: a restored profile element re-consumed mid-hydration grows its
# <time> after consume, and the row used to lose it permanently.
mutate "a timestamp that arrives late is lost again" run \
  src/modules/listing.js "    armLateTime(thing, m);" "    ;"

# A gallery reduced to its single largest frame — the exact reduction imageOf() rightly
# performs for an image post, wrong here because frames are peers.
mutate "a gallery collapses to one picture" run \
  src/modules/comments.js "      : m.type === 'gallery' ? m.images : [];" \
                          "      : m.type === 'gallery' && m.images.length ? [m.images[0]] : [];"

# Per-frame ranking: scoring frames into one global winner is the same bug one level down.
mutate "gallery frames stop being ranked per element" run \
  src/core/model.js "      if (best && !out.includes(best)) out.push(best);" \
                    "      if (best && !out.length) out.push(best);"

# NOT MUTATED, deliberately, and recorded so the gap is a decision rather than an oversight:
# measure()'s per-frame cache is what stopped inRange() and diag() forcing three synchronous
# layouts per pump, and it is a COST change with no behavioural consequence — reverting it
# leaves every assertion in every suite green, correctly. A row for it would survive and
# read as a hole. What would make it testable is a layout-count probe the suites do not have.

# The accounting. DECLARED is read from this file itself rather than maintained by hand —
# a count that has to be kept in step with the rows is the same trap as the hand-maintained
# token list in bug 43, and it would have been wrong the first time a row was added.
DECLARED=$(grep -c '^mutate "' "$SRC/test/mutate.sh")
echo
printf 'rows: %s declared, %s run — %s caught, %s survived, %s anchor misses\n' \
  "$DECLARED" "$ROWS_RUN" "$ROWS_CAUGHT" "$ROWS_SURVIVED" "$ROWS_MISSED"

if [ "$ROWS_RUN" -ne "$DECLARED" ]; then
  printf '\033[31mSWEEP INCOMPLETE: %s of %s rows ran; %s never did. Something above stopped\n' \
    "$ROWS_RUN" "$DECLARED" "$((DECLARED - ROWS_RUN))"
  printf 'bash from executing them — look for a shell error in the output, not a test\n'
  printf 'failure, and check whether this script was edited while it was running.\n'
  printf 'A partial sweep is not evidence about the rows it skipped.\033[0m\n'
  exit 1
fi

echo
echo "all sources restored; verifying the suite is clean again:"
node build.js >/dev/null 2>&1
npm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^[0-9]+ passed'
