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
# dist/ is excluded because it is build output — and dist/latest.json is not. It is the
# file an installed copy READS to learn whether a newer version exists, committed
# deliberately (.gitignore carries a `!dist/latest.json`), and run.js asserts against it.
# Without it here, run.js threw ENOENT at that assertion and DIED — so every check after
# it, roughly the second half of the file, never ran under mutation and every row whose
# only detector lives down there reported SURVIVED. A sweep that cannot execute the
# assertion it is testing is not evidence about it; that is this file's whole thesis,
# turned on itself. Found 2026-09-03 while adding the old.reddit rows.
mkdir -p "$WORK/dist" && cp "$SRC/dist/latest.json" "$WORK/dist/latest.json"
cd "$WORK"

BK=$(mktemp -d)
cp -r src test options package.json manifest.json package-extension.js "$BK/"
restore() {
  rm -rf src test options package.json manifest.json package-extension.js
  cp -r "$BK/src" "$BK/test" "$BK/options" "$BK/package.json" "$BK/manifest.json" \
        "$BK/package-extension.js" .
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
ROWS_NOBROWSER=0

mutate() { # mutate <name> <suite> <file old new>...
  local name="$1" suite="$2"; shift 2
  ROWS_RUN=$((ROWS_RUN + 1))
  if ! apply "$@"; then
    ROWS_MISSED=$((ROWS_MISSED + 1))
    printf '  %-56s ANCHOR MISS\n' "$name"; restore; return
  fi
  node build.js >/dev/null 2>&1
  local out n
  out=$(node "test/$suite.js" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  n=$(printf '%s' "$out" | grep -c '^  FAIL')
  # A BROWSER SUITE WITH NO BROWSER IS NOT A RESULT, AND IT LOOKS LIKE ONE BOTH WAYS.
  # Unset, SHEDDIT_REQUIRE_BROWSER makes the suite print SKIP and exit clean, so every
  # row reads SURVIVED. Set to 1 it makes the suite print a line beginning "  FAIL" and
  # exit 1 — so every row reads "caught (1)", a whole suite's worth of rows reporting a
  # bug they caught without a browser ever having launched. Neither is evidence.
  if printf '%s' "$out" | grep -qE '^  SKIP|SHEDDIT_REQUIRE_BROWSER=1 turns this skip'; then
    ROWS_NOBROWSER=$((ROWS_NOBROWSER + 1))
    printf '  \033[33m%-56s %-10s NO BROWSER\033[0m\n' "$name" "$suite"
    restore; node build.js >/dev/null 2>&1; return
  fi
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
      // A feed that was empty when we asked' '    if (rendered > 0 && !SHD.gate.revealed) {
      // A feed that was empty when we asked' \
  src/core/gate.js '    revealed = false;
    engaged = false;                      // the incoming route has not been taken yet' \
                   '    engaged = false;                      // the incoming route has not been taken yet'

mutate "reset() leaves the stale header behind" run \
  src/modules/chrome.js "    document.querySelector('#shd-header')?.remove();" ''

mutate "failure leaves our unstyled DOM on the page" run \
  src/core/gate.js "    document.documentElement.classList.remove('shd-gate', SHD.C.BODY_CLASS);
    document.documentElement.removeAttribute('data-shd-empty');   // our listing is gone with it
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
  src/modules/account.js '    up: SHD.dom.deepQuery(source, C.NATIVE.upvote),
    down: SHD.dom.deepQuery(source, C.NATIVE.downvote)' \
                         '    up: source.querySelector(C.NATIVE.upvote),
    down: source.querySelector(C.NATIVE.downvote)'

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
  src/core/gate.js "      unblank(why);
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
  src/modules/account.js '    up: SHD.dom.deepQuery(source, C.NATIVE.upvote),
    down: SHD.dom.deepQuery(source, C.NATIVE.downvote)' \
                         '    up: source.querySelector(C.NATIVE.upvote),
    down: source.querySelector(C.NATIVE.downvote)'
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
  src/core/gate.js "      unblank(why);
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
    const m = measure();" \
                        "  function inRange() {
    if (true) return true;
    const m = measure();
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
  src/core/route.js "        if (path) emit(path, search);" \
                    "        queueMicrotask(() => emit(location.pathname));" \
  src/core/route.js "      navigation.addEventListener('navigatesuccess', () => emit(location.pathname));" "" \
  src/core/route.js "    if (next === current && emit.lastPath === path && emit.lastSort === sort) return;
    current = next;
    emit.lastPath = path;" "    const changed = next !== current || emit.lastPath !== path;
    current = next;
    emit.lastPath = path;
    if (!changed) return;"

# The deadline asked "did we render?" before anything had tried: the pipeline boots at
# document_idle and then awaits chrome.storage.sync, so at 1500ms "sources present, nothing
# rendered" can simply mean nobody has looked yet. (The block's body moved when the
# not-started unblank learned to consult route.classify — the anchor empties the guard,
# which falls through to the same premature accusation the original removal did.)
mutate "the deadline accuses a pipeline that has not started" run \
  src/core/gate.js "        const mode = SHD.route?.classify?.(location.pathname);
        if (!mode || mode === SHD.route.OTHER) unblank('not-started');
        if (waited < MAX_WAIT_MS) return scheduleCheck();
        return fail('pipeline-stalled', { sources, waited });
      }" \
                   "      }"

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
        h('div.usertext-body.shd-selftext', null,
          SHD.dom.adoptBody(m.bodyNode)));
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

# --- bug 94: an empty feed is an ANSWER, not a wait ---
#
# Not failing over an empty feed (bug 52, above) was mistaken for a reason to keep waiting
# for one. Reported from /r/DIYfail/top/, where Reddit's unstated 24-hour window genuinely
# holds nothing: the page sat at data-shd-waiting="empty-feed" for ever in native Reddit's
# UI, and told the reader that a twelve-year-old subreddit "doesn't have any posts yet".

# The deadline tick's own attempt. It has to be pinned by a page that answers LATE,
# because the boot-time attempt below covers every page that answers immediately —
# two mechanisms, one observable (bug 75).
mutate "an empty feed goes back to waiting for ever" run \
  src/core/gate.js "      if (why === 'empty-feed' && engaged && SHD.pipeline?.renderEmpty?.()) return;" ''

# ...and the boot-time attempt, which is what keeps the reader from looking at Reddit's
# page — and Reddit's wording — for the 1500ms until the first tick. Only the packed suite
# can see the difference: both paths reach the same rendered page, so only the CLOCK
# separates them.
mutate "the empty page waits for the tick instead of the render pass" extension \
  src/core/pipeline.js "    // ...unless Reddit has already said there is nothing coming, in which case the answer
    // is in the document we were served and there is no reason to make the reader look at
    // native Reddit for a deadline tick first. Declines unless it is certain — see
    // gate.emptyFeedReason.
    renderEmpty();" ''

# The settle test is a CONTRACT, not a count, and this is why: without Reddit's own
# no-content panel to go on, "a feed with no posts in it" also describes an age gate that
# ships bare feed scaffolding — and drawing our empty page over one buries the button the
# reader has to press. Bug 21's cardinal sin, reached through the new door.
mutate "any feed with no posts in it is called empty" run \
  src/core/gate.js "      if (feed.querySelector(SHD.C.FEED_EMPTY)) return 'reddit-says-empty';" \
                   "      return 'reddit-says-empty';"

# The copy. Saying "there is nothing here" without saying which question was asked is
# Reddit's own mistake in our own markup.
mutate "the empty line stops naming the time window" run \
  src/modules/listing.js "    const why = onProfile ? \`\${where} has nothing on this tab.\`
      : period ? \`\${where} has no posts from \${period.phrase}.\`
        : timed ? \`\${where} has no posts in the time window this sort ranks over.\`
          : \`\${where} has no posts.\`;" \
                         "    const why = \`\${where} has no posts.\`;"

# ...and the other direction, which is the decision the window strip already defends one
# file over: with no `t=` in the URL, Reddit's window is UNVERIFIED and neither the strip
# nor this line may name one. A guess here is the same guess in a full sentence — worse,
# because a sentence reads as knowledge.
mutate "the empty line guesses the window Reddit is using" run \
  src/modules/listing.js "    const period = timed ? R.TIMES.find(t => t.id === R.timeQuery) : null;" \
                         "    const period = timed ? (R.TIMES.find(t => t.id === R.timeQuery) || R.TIMES[1]) : null;"

# A post arriving after we concluded the feed was empty — a stream, a driven partial, a
# history traversal. The notice must go, or the page claims to be empty above a list.
mutate "a late post leaves the empty notice standing" run \
  src/modules/listing.js "    box.querySelector('.' + EMPTY_CLASS)?.remove();" ''

mutate "a late post leaves the empty state on <html>" run \
  src/core/pipeline.js "      SHD.gate.notEmpty();" ''

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
      const prow = pid && document.querySelector(\`#\${C.ROOT_ID} \${SHD.dom.rowSel(pid)}\`);
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
# The title stops routing to the comments page (project decision, open question 9): a
# video title that leaves the layout lands on the v.redd.it bounce — a 302 straight back
# to the comments page we were already rendering. The title goes there directly; the
# watch link is the deliberate exit.
mutate "the video title leaves the layout again" run \
  src/core/model.js "      href: (isSelf || type === 'video') ? permalink" \
                    "      href: isSelf ? permalink"

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
# attach() runs after every flush and built a node whose label starts idle. The label now
# has ONE writer (syncControl — bug 85 gave the idle face two states), so that is where
# the status has to be dropped to reintroduce the flap; mutating only the build-time text
# is repaired by the very next sync and proves nothing.
mutate "the sentinel forgets an in-flight load on every re-attach" run \
  src/core/paginator.js "    const label = status || idleLabel();" "    const label = idleLabel();"

# Bug 85: a tab switch paints three posts with `load more` under them, the fill lands the
# rest ABOVE the button seconds later, and a click at the painted position opens whichever
# post slid under the cursor. The control is held inert while the fill still owes the page
# content. Two rows, because the hold has two independent halves: the predicate that
# decides it, and the handler guard that enforces it when styling cannot.
mutate "the fill-settling hold never engages and the control is bait again" run \
  src/core/paginator.js "  function settling() {
    return !!SHD.settings.autoPaginate &&" "  function settling() {
    return false &&"

mutate "a click on the held control fires anyway" run \
  src/core/paginator.js "          if (settling()) return;" "          if (false) return;"

# Bug 86: an SPA navigation tears the render down pre-commit and the incoming feed can be
# seconds away — without the placeholder that window is a blank viewport that swallows
# clicks, which is exactly what was reported.
mutate "the between-pages window goes back to being an unexplained blank" run \
  src/core/gate.js "      showLoading();" "      ;"

# Bug 87, measured live: a comments-page sort is a QUERY-ONLY navigation, and a latch
# keyed on pathname alone swallowed it — no teardown, Reddit's replacement tree consumed
# under the stale render, two sorts interleaved on one page. Two rows for the two halves:
# the sort key in the emit latch, and the sort-swap unstamp without which the re-sorted
# thread renders with no post row and no strip (the post element never re-inserts).
mutate "a query-only sort change is swallowed and the sorts interleave again" run \
  src/core/route.js "    if (next === current && emit.lastPath === path && emit.lastSort === sort) return;" \
                    "    if (next === current && emit.lastPath === path) return;"

mutate "the re-sorted thread loses its post row and sort strip" run \
  src/core/pipeline.js "    if (sortSwap) {" "    if (false) {"

# Bug 88: cloned comment bodies bring <shreddit-player gif> across, the clone UPGRADES
# (custom elements are document-global), and the upgraded player paints the same solid
# black box it paints natively — a <video> fed a raw .gif, with no poster. The repair
# swaps the clone for a plain <img>; neutralising the lookup puts the black boxes back.
mutate "comment gifs go back to being black boxes" run \
  src/core/dom.js "    root.querySelectorAll(SHD.C.GIF_PLAYER).forEach(p => {" \
                  "    [].forEach(p => {"

# Bug 89: a hidden comment score ships as a placeholder score="1", so every comment on an
# active thread read "1 point". The flag read is the fix; dropping it parrots the
# placeholder again.
mutate "hidden comment scores go back to reading 1 point" run \
  src/core/model.js "      scoreHidden: el.hasAttribute(C.COMMENT_SCORE_HIDDEN)," \
                    "      scoreHidden: false,"

# Bug 90 (QA F1): expansion-delivered comments carry the affordances for the branch
# remainder, and they land in a comment's light DOM AFTER it was consumed — with no
# watcher, deep branches are one click deep for ever.
mutate "late-arriving expanders never get controls and branches dead-end again" run \
  src/modules/comments.js "    watchLateExpanders();" "    ;"

# Bug 91 (QA F3): gallery frames hydrate late — srcless at consume — so live galleries
# rendered one frame while the page carried two, and nothing ever looked again.
mutate "late-hydrating gallery frames are dropped again" run \
  src/modules/comments.js "    try { armLateGalleryFrames(row, m); } catch { /* the frames already rendered stand */ }" \
                          "    ;"

# QA F5: a gallery title's content-href is reddit.com/gallery/<id>, which only lands on
# the comments page today by Reddit's SPA grace. The reroute is deliberate, like 0.22.0's
# image posts.
mutate "gallery titles lean on Reddit's /gallery/ redirect again" run \
  src/core/model.js "          : (type === 'gallery' && galleryImages.length && viewerBound(contentHref)) ? permalink" \
                    "          : false ? permalink"

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
# whichever Reddit happened to list first, which is the SMALLEST. The anchor carries
# imageOf()'s whole loop because the comparison line alone also matches imagesOf() —
# a duplicated anchor silently tests whichever call site comes first (bug 48).
# Anchored on imageOf()'s own head rather than on the loop body: the pick moved into
# betterPicture() in 0.39.0, so the old anchor stopped matching and the row went silent.
# Shadowing the helper is what reinstates first-url-wins.
mutate "the largest rendition stops winning, and the first one does" run \
  src/core/model.js "  function imageOf(el) {
    let best = null, bestW = -1, bestOrig = false;" \
                    "  function imageOf(el) {
    let best = null, bestW = -1, bestOrig = false;
    const betterPicture = () => bestW < 0;"

mutate "an image title points at the viewer-bound image URL again" run \
  src/core/model.js "        : (type === 'image' && imageUrl && viewerBound(contentHref)) ? permalink" \
                    "        : false ? permalink"

# The adult-content gate, on BOTH surfaces that draw a picture. Separate rows on purpose:
# they are different call sites covering different pages, so removing one leaves the other
# looking covered. This is bug 41's family — rendering our own <img> is what walks past the
# blur Reddit applies for logged-out readers, and a full-size copy is that bypass enlarged.
mutate "an adult post is enlarged on its comments page" run \
  src/modules/comments.js "  const adultGate = (m) => !!m.nsfw && !SHD.settings.showNsfwThumbnails;" \
                          "  const adultGate = (m) => false;"

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
  src/styles/old-reddit.css ".shd-selfpost .shd-image { margin: 5px 0; max-width: var(--shd-video-max); position: relative; }" \
                            ".shd-selfpost .shd-image { margin: 5px 0; position: relative; }"

# The comments-page head: `all N comments` + the sort menu, requested twice from live use.
mutate "the comment sort strip vanishes again" run \
  src/modules/comments.js "    ensureCommentHead(r, m);" "    ;"

# The current-sort marker read from the URL. Gutting it marks `best` always — caught by the
# ?sort=new boot, which exists precisely because a strip that always marks the default
# looks perfectly correct on the default page.
mutate "the sort strip stops noticing which sort the page is on" run \
  src/modules/comments.js "    if (q && C.COMMENT_SORTS.some(s => s.id === q)) current = q;" \
                          "    if (false) current = q;"

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

# ----------------------------------------------------------- 0.24.0: the Firefox port ---
# The relay (bug 82). Reddit's router calls the PAGE realm's pushState; a content-script
# patch wraps a copy nothing ever calls, and passes every one-world test environment while
# shipping broken — the pagination bug's shape, one module over. Dispatch and listener get
# separate rows: the SPA tests traverse the whole chain, and either half's removal has to
# be caught on its own.
mutate "the relay never dispatches — SPA navigation goes unseen" run \
  src/core/bridge.js "      dispatchEvent(new Event(NAVIGATED));" "      ;"

mutate "route.js stops listening for the relay" run \
  src/core/route.js "    addEventListener(SHD.C.BRIDGE.navigated, () => emit(location.pathname));" \
                    "    ;"

# The two halves of the protocol are literals in different worlds; a drift disables SPA
# routing silently, exactly like the load-more protocol it copies.
mutate "the relay protocol drifts between bridge and contracts" run \
  src/core/bridge.js "  const NAVIGATED = 'shd:navigated';" \
                     "  const NAVIGATED = 'shd:navigate';"

# The tempting wrong fix: patch history in route.js's own realm "as well". It masks a
# dead relay in every one-world environment while Firefox ESR ships broken — the static
# check is what refuses it.
mutate "a same-realm history patch sneaks back into route.js" run \
  src/core/route.js "    addEventListener('popstate', () => emit(location.pathname));" \
                    "    addEventListener('popstate', () => emit(location.pathname));
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...args) { const r = orig.apply(this, args); emit(location.pathname); return r; };
    }"

# The Firefox manifest is DERIVED, and each transform property has one guard in run.js;
# these prove the guards are not vacuous. The fork row models the realistic bad edit:
# "fixing" a Firefox issue by dropping the MAIN-world script from the Firefox build only.
mutate "the Firefox floor drops below what the manifest's own keys need" run \
  package-extension.js "      strict_min_version: '140.0'," \
                       "      strict_min_version: '109.0',"

# The Android floor is the silent one: delete the key and nothing is missing, the floor
# just inherits the desktop number on an application that reads the key later. That is
# the shape AMO warned about, and an absence is what a guard has to notice.
mutate "the Android floor goes back to inheriting the desktop one" run \
  package-extension.js "    gecko_android: { strict_min_version: '142.0' }" \
                       "    gecko_android: undefined"

mutate "the transform forks the layout per store" run \
  package-extension.js "  out.browser_specific_settings = {" \
                       "  out.content_scripts = (out.content_scripts || []).filter(cs => cs.world !== 'MAIN');
  out.browser_specific_settings = {"

mutate "the data-collection declaration vanishes from the Firefox build" run \
  package-extension.js "      data_collection_permissions: { required: ['none'] }" \
                       "      data_collection_permissions: undefined"

# The host-permission banner: Firefox can revoke reddit.com access, and a content script
# that never runs cannot report it anywhere. Hidden is the banner's default state, so a
# gutted check is a banner that can never appear — invisible everywhere but under test.
mutate "the host-permission warning can never appear" run \
  options/options.js "    hostWarning.hidden = await chrome.permissions.contains(HOSTS);" \
                     "    hostWarning.hidden = true;"

mutate "the banner asks about origins the manifest does not grant" run \
  options/options.js "const HOSTS = { origins: ['*://*.reddit.com/*'] };" \
                     "const HOSTS = { origins: ['*://www.reddit.com/*'] };"

# ------------------------------------------- 0.25.0: two field reports from real machines ---
# The flash: real Reddit streams, document_idle waits for DOMContentLoaded, and the gate's
# 1500ms tick used to unblank a page the pipeline was about to take — native feed shown,
# then snatched away. The hold and its counterweight get separate rows because either
# alone leaves the other looking covered: unconditional unblank flashes handled pages,
# never unblanking blanks pages we are about to disown.
mutate "the not-started unblank flashes handled pages again" extension \
  src/core/gate.js "        const mode = SHD.route?.classify?.(location.pathname);
        if (!mode || mode === SHD.route.OTHER) unblank('not-started');" \
                   "        unblank('not-started');"

mutate "the hold blanks routes nobody will ever take" extension \
  src/core/gate.js "        if (!mode || mode === SHD.route.OTHER) unblank('not-started');" \
                   "        ;"

# The question the hold asks only has an answer if route.js is THERE at the 1500ms tick —
# delivered at idle it answers undefined, which silently reverts to unblank-and-flash.
mutate "route.js slips back to document_idle" run \
  manifest.json "        \"src/config/contracts.js\",
        \"src/core/route.js\",
        \"src/config/themes.js\",
        \"src/core/gate.js\"" \
                "        \"src/config/contracts.js\",
        \"src/config/themes.js\",
        \"src/core/gate.js\""

# The expando's [-]: any author display declaration beats the UA's [hidden]{display:none},
# so without the counterpart rule a collapsed box keeps its layout in every real browser.
# Two suites, two rows, on purpose: css-lint sees the missing rule statically everywhere,
# geometry is the only suite that can see the picture actually stay on screen.
mutate "the expando's [hidden] counterpart vanishes (static)" css-lint \
  src/styles/old-reddit.css ".expando[hidden] { display: none; }" ""

mutate "the expando's [hidden] counterpart vanishes (layout)" geometry \
  src/styles/old-reddit.css ".expando[hidden] { display: none; }" ""

# ------------------------------ the time window on top/controversial listings ---
# The strip itself. Without it, "top" is half a control: the reader gets whatever window
# Reddit defaults to and cannot ask for another.
mutate "the time window disappears from top/controversial" run \
  src/modules/chrome.js "      timeMenu(base, active)" "      null"

# The window is a QUERY-ONLY navigation, so a latch keyed on the path alone sees nothing:
# no teardown, and Reddit's replacement feed is consumed UNDER the old window's rows —
# bug 87's interleave, on the listing side.
mutate "a time-window change is invisible to the route latch" run \
  src/core/route.js "  const CONTENT_PARAMS = ['sort', 't'];" \
                    "  const CONTENT_PARAMS = ['sort'];"

# Offering the window on sorts that ignore it is a control that changes nothing — bug 62's
# shape, and bug 10's (our own UI leading somewhere it should not).
mutate "the window is offered on sorts that have none" run \
  src/modules/chrome.js "    if (!SHD.route.TIMED_SORTS.includes(active)) return null;" "    ;"

# Marking a guessed default tells the reader they are looking at a span they may not be.
mutate "an absent t= is rendered as though a period were chosen" run \
  src/modules/chrome.js "    const current = SHD.route.timeQuery;" \
                        "    const current = SHD.route.timeQuery || 'day';"

# ------------------------------------------------ 0.26.0: the header's nsfw toggle ---
# The control itself. Without it the setting is options-page-only again — which is where
# it went unnoticed, and the reason the toggle exists.
mutate "the nsfw toggle disappears from the header" run \
  src/modules/chrome.js "      nsfwToggle()
    ]);" "    ]);"

# The toggle reading its own state. Hardcoding it renders a control that always claims to
# be off — it still works, and it lies about what it just did.
mutate "the toggle stops reflecting the setting" run \
  src/modules/chrome.js "    const on = !!(SHD.settings && SHD.settings.showNsfwThumbnails);" \
                        "    const on = false;"

# Writing through storage is what re-renders (the listener does the work). Mutating the
# in-memory object instead changes only what renders LATER — everything already on screen
# stays stale, which looks like a toggle that half works.
mutate "the toggle mutates settings in memory instead of writing them" run \
  src/core/pipeline.js "      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({" "      SHD.settings[key] = value; if (true) return; await Promise.resolve({"

# NOT MUTATED, deliberately, and recorded so the gap is a decision rather than an
# oversight: there is no row for "a settings change keeps your scroll position", because
# nothing of ours implements it. An explicit save/restore was written first and measured
# to be dead code — the browser's scroll anchoring holds the position on its own — so it
# was deleted. geometry still asserts the property, which would catch a future change
# that defeats anchoring; there is simply no line of ours to reintroduce.

# The dev bundle's storage shim. Reverting it to a stub that accepts writes and drops
# them makes every in-page settings control silently do nothing in the harness and the
# preview — which is exactly how this shipped-looking-fine bug was found.
mutate "the dev harness storage shim swallows writes again" geometry \
  build.js "        sync: {
          get: async (key) => (key ? { [key]: store[key] } : { ...store }),
          set: async (obj) => {
            const changes = {};
            for (const [k, newValue] of Object.entries(obj)) {
              changes[k] = { oldValue: store[k], newValue };
              store[k] = newValue;
            }
            listeners.forEach(fn => { try { fn(changes, 'sync'); } catch (e) { console.warn(e); } });
          }
        }," \
           "        sync: { get: async () => ({}), set: async () => {} },"

# Bug 93: Reddit delivers the same `.gif` name as a real GIF or as an mp4, and only the
# query says which. Three rows for the three ways the fix can be undone — collapsing the
# discrimination (everything back to an <img>, so the mp4 ones are blank boxes again),
# dropping the `type` reading, and setting `muted` as an attribute alone, which leaves the
# PROPERTY false and hands Chrome's autoplay policy a video it is obliged to block.
mutate "an mp4 delivered under a .gif name goes back into an <img> that cannot show it" run \
  src/core/dom.js "        SHD.C.GIF_MP4_SRC.test(src);" "        false;"

mutate "a stated video/mp4 type stops being believed" run \
  src/core/dom.js "      const mp4 = /^video\\//i.test(source?.getAttribute('type') || '') ||" \
                  "      const mp4 = false ||"

mutate "the gif video is muted in markup only, so autoplay is blocked and the box stays blank" run \
  src/core/dom.js "    video.muted = true;" "    ;"

# --- old.reddit.com: the hop, and the notice on it ------------------------------------
#
# The whole feature is one script on a host nothing else runs on, so every row here is a
# way it could go quietly wrong: a hop that goes to the wrong page, a hop with no notice on
# it, a hop that cannot be turned off, or a redirect that follows a parameter anywhere.

# The failure the login wall actually produces. Swapping the host on /login/ rather than
# reading `dest` lands the reader on WWW's login page — a hop that "works", to another wall.
# A <shreddit-post> carries the author's own title and selftext in its light DOM, so the
# sentence walk can read the post's own words as Reddit's notice about it. A live thread
# titled "This post was removed by Reddit — anyone know why?" tombstones itself, and
# r/ModSupport and r/undelete are made of those titles. The two existing guards miss it: the
# title anchor IS the innermost node, and a title is under the length ceiling, not over it.
mutate "a post's own title and selftext are searched for Reddit's removal notice" run \
  src/core/model.js '        !n.closest(authored) &&' '        true &&'

mutate "the login wall's dest is ignored and only the host is swapped" run \
  src/core/oldreddit.js '    if (isLogin(url)) {' '    if (false) {'

# An open redirect wearing this extension's name: `dest` arrives in a URL anyone can hand
# a reader, and following it off reddit.com is a security bug, not a layout one.
mutate "any dest is followed, including one pointing off reddit.com" run \
  src/core/oldreddit.js '(d && isHttp(d) && isReddit(d) && !isLogin(d))' '(d && isHttp(d) && true && !isLogin(d))'

# ...and the nested wall, which is the other half of the same line: a dest that is itself a
# login page becomes www's login page, so the hop lands on a wall again.
mutate "a dest that is itself a login wall is followed" run \
  src/core/oldreddit.js '(d && isHttp(d) && isReddit(d) && !isLogin(d))' '(d && isHttp(d) && isReddit(d))'

# The scheme half of the same line, and the reason it is a pair. `new URL()` parses
# `javascript://reddit.com/x%0a…` with hostname `reddit.com`, so the host check alone passes
# it; the hostname rewrite keeps the scheme on purpose, and location.replace() runs what it
# is handed. Dropping isHttp() is a script-execution bug, not a layout one.
mutate "a javascript: dest passes the host check and is followed" run \
  src/core/oldreddit.js '(d && isHttp(d) && isReddit(d) && !isLogin(d))' '(d && isReddit(d) && !isLogin(d))'

# NOT `host` instead of `hostname`: that row was written first, SURVIVED, and was the row
# that was wrong rather than the test. Measured — the WHATWG host setter keeps the existing
# port when the value it is handed carries none, so the two setters are identical here and
# the mutation changed nothing. The bug that really loses the port is a target built by
# concatenating onto a hardcoded origin, which drops the scheme with it: the packed suite's
# hop then aims at the real internet, and a reader on any non-default port goes nowhere.
mutate "the target is concatenated onto a hardcoded origin, losing port and scheme" run \
  src/core/oldreddit.js '    out.hostname = NEW_HOST;' '    return `https://${NEW_HOST}${out.pathname}${out.search}${out.hash}`;'

# The silent hop. This is the version that would still "work" and still be blamed for the
# hostname changing under the reader — the entire reason the card exists.
mutate "the hop happens with no interstitial at all" run \
  src/core/oldreddit.js '    whenBody(() => mount(target, false));' ''

# The blackout moved after the first await: the storage read is a promise, so the login
# wall gets a frame to paint before anything of ours lands on <html>.
mutate "the blackout waits for the settings read" run \
  src/core/oldreddit.js '    document.documentElement.classList.add(CLASS);' ''

# A setting that cannot turn the feature off is not a setting.
mutate "redirectOldReddit stops being consulted" run \
  src/core/oldreddit.js '    if (!await enabled()) { standDown(); return; }' ''

# Two redirectors volleying between hosts: a hang, with nothing on screen to say why.
mutate "the loop guard stops recognising a repeat hop" run \
  src/core/oldreddit.js '    if (looped(target)) { whenBody(() => mount(target, true)); return; }' ''

# ...and the other half of it. A guard that never records cannot fire.
mutate "the loop guard records nothing to recognise" run \
  src/core/oldreddit.js '    recordHop(target);' ''

# A feed reader asked for XML and gets an HTML card painted into it.
mutate "a .rss document is redirected like a page" run \
  src/core/oldreddit.js '    if (document.contentType && document.contentType !== ' '    if (false && document.contentType !== '

# The stylesheet ungated: old.reddit.com is blanked for the reader who turned the redirect
# off, which is the one group whose page must be left exactly as it was.
mutate "redirect.css blanks old.reddit unconditionally" run \
  src/styles/redirect.css 'html.shd-redirecting body > *:not(#shd-redirect) { display: none !important; }' \
                          'body > *:not(#shd-redirect) { display: none !important; }'

# The manifest half. A script nothing delivers is a file, not a feature — and the packed
# suite is the only place that can tell the difference.
mutate "the manifest stops delivering the old.reddit script" extension \
  manifest.json '        "src/core/oldreddit.js"' '        "src/core/pipeline.js"'

# ...and the exclusion that keeps the renderer off the page it imitates.
mutate "the renderer is let loose on old.reddit.com" run \
  manifest.json '      "exclude_matches": [
        "*://old.reddit.com/*",
        "*://*.reddit.com/media*"
      ],
      "run_at": "document_start",
      "all_frames": false,
      "world": "MAIN",' '      "exclude_matches": [
        "*://*.reddit.com/media*"
      ],
      "run_at": "document_start",
      "all_frames": false,
      "world": "MAIN",'

# The duplicated default drifting from contracts.js: the checkbox says one thing and the
# page does another, with nothing but an assertion between the two.
mutate "oldreddit.js default drifts from the shipped setting" run \
  src/core/oldreddit.js '  const REDIRECT_BY_DEFAULT = true;' '  const REDIRECT_BY_DEFAULT = false;'

# The release script builds both zips and, for most of this project's life, committed only
# Chrome's — so every release left the Firefox download serving whatever version someone
# last added by hand. Anchored on the Firefox name alone: dropping it from the `git add` is
# exactly the mistake, and it leaves no other trace.
mutate "the release script stops committing the Firefox download" run \
  refresh-zip.sh 'git add dist/sheddit.zip dist/sheddit-firefox.zip dist/latest.json \
        manifest.json package.json src/core/update.js' \
                 'git add dist/sheddit.zip dist/latest.json manifest.json package.json src/core/update.js'

# The README now TELLS a reader which version the downloads are, in three places. A
# stated version that has gone stale is worse than none — it is the one fact a reader
# uses to decide whether their copy is current. Mutating the manifest models the real
# mistake: bumping the version and forgetting the README.
# Anchored on a key that never changes rather than on the version itself: a row carrying
# the current version goes dead at every release, and a dead row reads as a quiet one.
# Duplicate JSON keys resolve to the LAST occurrence, so injecting one after the real
# version is what makes the manifest disagree with the README.
mutate "the README's stated version drifts from the manifest" run \
  manifest.json '  "icons": {' '  "version": "9.9.9",
  "icons": {'

# ------------------------------------------- the release half of refresh-zip.sh ---
# GitHub builds "Source code (zip)" from the TAG, so a release step that uploads the zips
# and leaves the tag where it is republishes the current binaries against stale source —
# the shape measured on 2026-09-01, 0.30.0 assets beside a 0.25.0 archive. The upload is
# the visible half and the tag is the load-bearing one, which is the wrong way round for
# noticing, hence the row.
mutate "the release uploads new zips but leaves the tag behind" run \
  refresh-zip.sh '  git tag -f Release HEAD -m "Sheddit $VERSION" >/dev/null || return 1' \
                 '  :'

# An unannotated tag cannot carry a signature, and a signing config refuses to write one,
# so dropping -m fails at the last step of a release rather than at the first.
mutate "the Release tag stops being annotated" run \
  refresh-zip.sh 'git tag -f Release HEAD -m "Sheddit $VERSION"' \
                 'git tag -f Release HEAD'

# A literal note is a fourth place a version string can go stale, and the only one nothing
# checks — latest.json's is asserted to name its own version, so reading it inherits that.
# Anchored on the EXTRACTION, which occurs once; `--notes "$notes"` appears twice, once per
# branch, and a row anchored there would silently mutate one call site and leave the other
# holding the assertion up — bug 48's duplicate anchor, caught before it shipped this time.
mutate "the release note is written in the script instead of read from latest.json" run \
  refresh-zip.sh '  notes=$(node -e '"'"'const j=require("./dist/latest.json");process.stdout.write(j.notes||"")'"'"')' \
                 '  notes="A new build of Sheddit."'

# A tag naming a commit the remote has not been given is rejected on push, so syncing
# before the push of main inverts the only ordering that works.
mutate "the release is cut before main is pushed" run \
  refresh-zip.sh 'git push --quiet origin main
echo
echo "Pushed. Both README downloads now serve $VERSION."

# After the push, never before: the tag has to name a commit the remote already has.
sync_release' \
                 'sync_release
git push --quiet origin main
echo
echo "Pushed. Both README downloads now serve $VERSION."
:'
# deepQuery's own-root hole, 2026-09-05: searching only the descendants' shadow roots
# reports NOT FOUND for a control the host renders on its own root.
mutate "deepQuery skips the host element's own shadow root again" run \
  src/core/dom.js '    if (root.shadowRoot) {
      const own = deepQuery(root.shadowRoot, selector);
      if (own) return own;
    }
' ''

# The live reply control (2026-09-05) has no attribute at all; without the text test the
# attribute clauses miss it and every reply hands off.
mutate "the reply control's text test is dropped" run \
  src/modules/account.js '    return scan(target, 0);
  }' '    return null;
  }'

# Bug 95: a same-page URL rewrite tears the render down and the sweep skips every stamped
# source; without the deadline's re-adoption the reader gets the failure card.
mutate "the deadline stops re-adopting stamped sources after a URL rewrite" run \
  src/core/gate.js '        SHD.pipeline?.readopt?.();
        if (renderedCount() > 0) return;    // reveal() ran inside the flush; we are done
      }
      return fail' '      }
      return fail'

# ---------------------------------------------------------------- the account layer ----
# 0.34.0. The layer is ON only for a page that affirmatively reads as logged in, and every
# action is a click on Reddit's own control. Each row below is one of the ways that story
# quietly stops being true.

# The one direction of error the detector must never take: with no affirmative signal
# required, every logged-out fixture (an EMPTY header) reads as logged in and the layer
# switches on for the primary reader.
mutate "session detection becomes absence-based (no login button = logged in)" run \
  src/core/session.js 'loggedIn: matched.length > 0 && vetoed.length === 0' 'loggedIn: vetoed.length === 0'

mutate "the login button no longer vetoes a logged-in signal" run \
  src/core/session.js 'loggedIn: matched.length > 0 && vetoed.length === 0' 'loggedIn: matched.length > 0'

mutate "the account setting is ignored" run \
  src/core/session.js 'function active() { return !!SHD.settings?.account && loggedIn(); }' \
                      'function active() { return loggedIn(); }'

mutate "vote arrows stop forwarding to Reddit's button" run \
  src/modules/account.js '    native.click();
    // Optimistic' '    // Optimistic'

mutate "clicking the lit arrow no longer un-votes" run \
  src/modules/account.js 'paint(col, m, kind, before === dir ? 0 : dir);' 'paint(col, m, kind, dir);'

# Our guess is corrected by the page's answer; without the read-back a vote Reddit refused
# stays lit.
mutate "the page's own vote state is no longer read back after a click" run \
  src/modules/account.js '    const s = nativeState(btns);
    if (s !== null) paint(col, m, kind, s);
  }' '  }'

mutate "the score no longer discounts the reader's standing vote" run \
  src/modules/account.js 'const n = m.score + (state - initial);' 'const n = m.score + state;'

# Logged out the control is KNOWN not to exist (ARCHITECTURE §7d); a warning there is
# noise about a settled decision, and the row that removed the guard reintroduces it.
mutate "a missing vote control is reported on a logged-out session too" run \
  src/modules/account.js 'if (missWarned || !active()) return;' 'if (missWarned) return;'

mutate "reply ignores the session and always opens our box" run \
  src/modules/account.js '  function reply(m, thing) {
    if (!active()) {' '  function reply(m, thing) {
    if (false) {'

mutate "reply ignores the session and always hands off" run \
  src/modules/account.js '  function reply(m, thing) {
    if (!active()) {' '  function reply(m, thing) {
    if (true) {'

# A comment's subtree holds its descendants' composers (§1.4 for composers): unscoped, a
# reply to the parent types into the child's open box.
mutate "a composer open on a descendant is taken for this comment's" run \
  src/modules/account.js '? el.closest(C.COMMENT) === target' '? true'

mutate "the reply text never reaches Reddit's editor" run \
  src/modules/account.js '        editor.value = text;
        editor.dispatchEvent' '        editor.dispatchEvent'

mutate "Reddit's submit button is never clicked" run \
  src/modules/account.js '    const count = commentsUnder(target, kind);
    submit.click();' '    const count = commentsUnder(target, kind);'

mutate "a failed reply discards the draft" run \
  src/modules/account.js "      save.disabled = false;
      form.dataset.shdState = 'failed';" "      save.disabled = false;
      form.dataset.shdState = 'failed';
      ta.value = '';"

mutate "a failed reply no longer reveals Reddit's composer" run \
  src/modules/account.js "    if (!reveal || !SHD.dom.passthrough(reveal)) return false;" \
                         "    if (!reveal) return false;"

mutate "the top-level comment box is dropped" run \
  src/modules/account.js '  function commentBox(m) {
    if (!active()) return null;' '  function commentBox(m) {
    if (true) return null;'

mutate "the submit doors lose the type Reddit's composer reads" run \
  src/modules/account.js "h('a.morelink.shd-submit-link', { href: \`\${base}?type=\${C.SUBMIT.types.link}\`" \
                         "h('a.morelink.shd-submit-link', { href: base"

mutate "the submit doors open for a logged-out reader" run \
  src/modules/account.js '  function submitBox(sub) {
    if (!active()) return null;' '  function submitBox(sub) {'

mutate "the account setting no longer hides the corner" run \
  src/modules/account.js '    if (!SHD.settings?.account) return null;' '    if (false) return null;'

# The corner's whole job is answering "am I logged in", and half the answer is the negative
# one. Owner decision 2026-09-09; before it, a logged-out reader saw nothing at all.
mutate "the logged-out corner loses its login link" run \
  src/modules/account.js '  function signedOutCorner() {' '  function signedOutCorner() {
    if (true) return null;'

# ENDING A SESSION ON A GUESS. Unanchored, the matcher also takes "Log out of all devices"
# — so it either clicks the wrong control or, with the rule below intact, clicks nothing.
mutate "the log-out matcher stops being anchored to the exact phrase" run \
  src/config/contracts.js 'logoutText: /^log\s*out$/i,' 'logoutText: /log\s*out/i,'

# The age gate's rule, on the one control where being wrong cannot be undone by a reload.
mutate "log out clicks the first candidate instead of refusing an ambiguous drawer" run \
  src/modules/account.js 'return unique.length === 1 ? unique[0] : null;' 'return unique[0] || null;'

# Every delegated action here MEASURES its outcome. Assuming the click worked reports a
# logout that did not happen and reloads the page out from under the reader.
mutate "log out assumes the click worked instead of checking the session ended" run \
  src/modules/account.js '      if (gone) { nav.reload(); return true; }' '      nav.reload(); return true;'

# Reddit's header hydrates late; caching the FIRST answer means a name that arrives a
# moment later never appears at all.
mutate "a missing username is cached, so a late name never arrives" run \
  src/core/session.js '    if (identity && identity.name) return identity;' '    if (identity) return identity;'

# The corner is the answer to "does this thing know I am logged in", and the name is the
# half that can go missing. Dropping the fallback takes the answer with it.
#
# Written WITHOUT a shell metacharacter, deliberately. The first cut of this row injected
# `null && h(...)`, and bash left the escaped ampersands in — so the mutation wrote invalid
# JavaScript, the bundle would not parse, run.js died before printing a single result, and
# `grep -c FAIL` counted zero. It reported SURVIVED for a mutation the suite catches three
# times over. That is this file's own thesis (a suite that DIES and a suite with nothing to
# report look identical to grep) landing on one of its rows; keep replacements plain.
# Anchored on signedInCorner's own head: `const name = SHD.session.username();` appears
# in fillMenu() too, and apply() replaces the FIRST — so this row spent its life mutating
# the menu rather than the corner it is named for.
mutate "a missed username costs the whole corner, not just the name" run \
  src/modules/account.js '  function signedInCorner() {
    const name = SHD.session.username();' \
                         '  function signedInCorner() {
    const name = SHD.session.username(); if (!name) return null;'

# THE WORST FAILURE AVAILABLE TO THIS FEATURE: an unscoped lookup finds a POST AUTHOR and
# greets the reader by a stranger's name. Caught on the page whose header carries no name.
mutate "the username is read from anywhere on the page, not the header" run \
  src/config/contracts.js "    username: 'reddit-header-large a[href*=\"/user/\"], '" \
                          "    username: 'a[href*=\"/user/\"], '"

# A profile TAB names a page, not a person: /user/x/comments/ must not become an identity.
mutate "a profile tab is taken for the reader's name" run \
  src/core/session.js 'const PROFILE_PATH = /^\/user\/([^/?#]+)\/?$/;' \
                      'const PROFILE_PATH = /^\/user\/([^/?#]+)/;'

# Old reddit put the account area at the top right for a decade; mid-header it reads as a
# caption on the theme bar, which is the report this feature answers.
mutate "the account corner is no longer last in the header" run \
  src/modules/chrome.js '        themeBar(),
        SHD.account.headerAccount()' '        SHD.account.headerAccount(),
        themeBar()' 

# The action bar's tag was a literal in the miss report (copied from listing.js, where it
# had sat since the first version). Every Reddit name lives in contracts.js — the one rule
# CONTRIBUTING says will get a change sent back.
mutate "a Reddit tag name creeps back into account.js" run \
  src/modules/account.js 'const loader = m.source.querySelector(C.ASYNC_LOADER);' \
                         "const loader = m.source.querySelector('shreddit-async-loader');"

# account.js is what listing.js and comments.js build their vote columns from; the manifest
# order is the only thing that says it is defined first in the installed extension.
mutate "account.js is delivered after the modules built from it" run \
  manifest.json '        "src/core/session.js",
        "src/modules/account.js",
        "src/modules/listing.js",' '        "src/modules/listing.js",
        "src/core/session.js",
        "src/modules/account.js",'

# ------------------------------------------- carrying the draft across the handoff ---
# Reported from a signed-in session: save failed at `reply-control`, the layout swapped to
# Reddit's comment, and its composer opened EMPTY. The draft was never lost — it sat in our
# form behind a hidden #shd-root, under a sentence saying so that the reader could not see.
# Dropping the carry puts them back in front of an empty box.
mutate "the handoff reveals Reddit's composer but leaves the draft behind" run \
  src/modules/account.js '      try { carried = await handoff(m.source, kind, posted ? null : text, r); }' \
                         '      try { await handoff(m.source, kind, posted ? null : text, r); }'

# The reveal is what MAKES the control exist: suppressed, the native tree is a clipped 1x1
# box, so Reddit never hydrates the action row. Re-running the chain without revealing
# finds exactly what the first attempt found — nothing.
mutate "the handoff re-runs the chain without revealing first" run \
  src/modules/account.js '    if (!reveal || !SHD.dom.passthrough(reveal)) return false;' \
                         '    if (!reveal) return false;'

# Telling a reader their words are in Reddit's box when they are not is worse than the bug
# it replaces: they press Reddit's reply on an empty composer and lose the draft for real.
mutate "the status claims the draft was carried whether or not it was" run \
  src/modules/account.js "      form.dataset.shdCarried = carried ? 'yes' : 'no';" \
                         "      form.dataset.shdCarried = 'yes';"

# Bug 62's placement, at the reply link: an <li> is wider than the word inside it, so an
# anchor-bound handler misses every click landing on the row's own box.
mutate "the reply handler moves back onto the anchor" run \
  src/modules/comments.js "          h('li', { onclick: (e) => {" \
                          "          h('li', null, h('a.reply', { href: '#', text: 'reply', onclick: (e) => {" \
  src/modules/comments.js "          }}, h('a.reply', { href: '#', text: 'reply' }))" \
                          "          }}))"

# ------------------------------------- the held blackout, and which build is holding it ---
# Bug 83's hold stops the native-feed flash and is right; leaving the window black is not.
# Reported from live use as 6-8 seconds of nothing on a heavy thread, which reads as a dead
# page rather than a loading one. Reverting to mid-session-only is the state that shipped.
mutate "the first-load blackout goes back to being an empty black screen" extension \
  src/core/gate.js '    if (takes && takes !== SHD.route.OTHER) showLoading();' '    ;'

# The blackout hides body with visibility:hidden, and old-reddit.css's #shd-loading rule is
# scoped under .shd-active (not set yet) AND delivered at document_idle (may not have
# arrived on the slow pages this exists for). Without the document_start rule the line is
# in the DOM and invisible — the failure a presence-only assertion cannot see.
mutate "the loading line loses the rule that makes it visible on the blackout" extension \
  src/styles/suppress.css 'html.shd-gate #shd-loading {
  visibility: visible !important;' 'html.shd-gate #shd-loading:not(*) {
  visibility: visible !important;'

# The failure card prints the version, but a card only appears when something FAILS. On a
# working page nothing said which build it was, and two rounds of live diagnosis went at
# the wrong one.
mutate "a working page stops saying which build it is" extension \
  src/core/gate.js "    document.documentElement.setAttribute('data-shd-version', VERSION);" '    ;'

# ALSO NOT MUTATED, same reasoning, recorded so nobody adds it back and watches it survive:
# the route guard on the first-load loading line. Dropping it (showLoading() unconditionally)
# leaves every assertion green, CORRECTLY — on a route we hand back, unblank('not-started')
# runs later in the SAME tick and calls hideLoading(), so the line is added and removed
# before any paint and no sampler can see it. The guard is defence against a future
# reordering, not behaviour a reader can observe today; a row for it would survive and read
# as a hole. This was measured, not assumed: the row existed, ran, and scored 0 failures.

# ------------------------------------------------- a post Reddit has taken down ---
# Reported: a deleted thread rendered as an ordinary post — [deleted] author, a body, and
# nothing saying it was gone. Removal is not an attribute, so the sentence Reddit renders
# is the contract; without the lookup the model has nothing to report.
mutate "a removed post goes back to rendering as an ordinary one" run \
  src/core/model.js '    const removedNotice = removalOf(el);' '    const removedNotice = null;'

# INNERMOST wins. Every ancestor contains the sentence — including <shreddit-post> — so a
# first-match walk returns a container and the whole post is rendered as the notice. Log
# 67's trap, one element over, and the nested fixture is what makes it visible.
mutate "the removal lookup takes the outermost match instead of the innermost" run \
  src/core/model.js '      const inner = hits.find(n => !hits.some(o => o !== n && n.contains(o))) || hits[hits.length - 1];' \
                    '      const inner = hits[0];'

# The comments page shows Reddit's sentence; the row also carries a class so the whole
# thing can be styled as a dead end rather than only the paragraph.
mutate "the comments page stops showing the removal notice" run \
  src/modules/comments.js '    if (m.removedNotice) {
      row.classList.add(' '    if (false) {
      row.classList.add('

# A listing row has no room for a sentence and gets the stamp instead — the one-word
# label that says the row is a dead end before a reader spends a click on it.
mutate "a removed post in a listing loses its stamp" run \
  src/modules/listing.js "          m.removedNotice ? h('span.shd-removed-stamp', { text: 'removed', title: m.removedNotice }) : null," \
                         '          null,'

# ------------------------------------------------- the startup update check ---
# The switch is the whole justification for a request that leaves on its own. Checking it
# AFTER the network, or not at all, sends the request the reader turned off.
mutate "the startup check ignores the reader's switch" run \
  src/core/background.js '  if (!(await enabled())) return;' '  ;'

# Storage that will not answer is not consent: a browser that cannot tell us the setting
# cannot tell us it was left on, and the safe direction is to send nothing.
mutate "unreadable settings are treated as permission to check" run \
  src/core/background.js '    return false;
  }
}' '    return true;
  }
}'

# "At browser start" is not a rate. Without the floor, six restarts in an afternoon are six
# requests — the periodic-ping shape the click-only design existed to avoid.
mutate "the startup check loses its rate limit" run \
  src/core/background.js '  if (!(await due())) return;' '  ;'

# Two clocks, not one. `at` answers "when did we last TRY" and carries the floor; the nudge
# asks "how long since anything ANSWERED". Collapsing them means a reader who cannot reach
# GitHub re-stamps the staleness count at every browser start and never ages past a day —
# the one reader the nudge exists for is the one who can never see it.
mutate "a failed attempt counts as an answer, resetting the staleness clock" run \
  src/core/background.js '               okAt: answer ? Date.now() : (prev.okAt || null) }' '               okAt: Date.now() }'

# ...and the reading half of the same pair, in the module the reader actually meets.
mutate "the nudge measures from the last attempt rather than the last answer" run \
  src/core/update.js '      ? (typeof record.okAt === '"'"'number'"'"' ? record.okAt : (record.ok === false ? 0 : record.at))' '      ? record.at'

# onStartup and onInstalled both fire when a browser opens on an update installed while it
# was closed. The listeners discard the promise, and due() reads a record check() does not
# write until stamp() — so without the lock both pass the gate and two GETs leave at once.
mutate "two events at one browser start each send their own request" run \
  src/core/background.js '  if (inflight) return inflight;' '  ;'

# An answer with no version is not an answer. Storing it stamps `at`, which silences the
# next twenty hours of checks on the strength of nothing.
mutate "an unusable answer is stored anyway and silences the next check" run \
  src/core/background.js '      if (j && typeof j.version === '"'"'string'"'"') {' '      if (j) { j.version = String(j.version);'

# The worker writes the record the header turns into an href; a non-https answer must not
# become a link. update.js's rule, repeated where the answer is actually written.
mutate "the worker links whatever url the answer supplies" run \
  src/core/background.js 'url: safeUrl(j.url),' 'url: j.url,'

# The header repaints by replacing ALL children, so a repaint that rebuilds only the update
# body eats the switch that governs the next check.
mutate "a finished check removes the toggle that governs the next one" run \
  src/modules/chrome.js '    if (host) host.replaceChildren(updateBody(), autoToggle());' \
                        '    if (host) host.replaceChildren(updateBody());'

# Gecko ignores Chrome's service_worker key, so shipping it unchanged means the startup
# check never runs on Firefox and nothing says why — bug 82's silence, in the packaging.
mutate "the Firefox build ships Chrome's worker key, which Gecko ignores" run \
  package-extension.js '    out.background = { scripts: [out.background.service_worker], persistent: false };' \
                       '    out.background = { ...out.background };'

# --------------------------------------------------- a gallery's unshown frames ---
# Reported from live use: a six-frame gallery rendered image 1 of 6. Reddit gives frame 1
# a real src and parks the rest in data-lazy-src, filling src in only when its carousel
# advances — which never happens under this layout, because the carousel is an inert 0x0
# host. Reading only src finds one picture and waits for the others for ever. The URLs are
# in the DOM at first paint; this line is the whole difference.
mutate "a gallery reads only the frames Reddit has already shown" run \
  src/core/model.js '    const lazy = img.getAttribute(C.GALLERY_LAZY_SRC);
    if (lazy) out.push({ url: lazy, w: 0, orig: isOriginal(lazy) });' '    ;'

# The lazy url states a URL, not a size, so it must never outbid a real responsive set —
# a frame with both would drop from its best resolution to whatever Reddit lazy-listed.
mutate "the lazy gallery url outranks a real responsive set" run \
  src/core/model.js '    const lazy = img.getAttribute(C.GALLERY_LAZY_SRC);
    if (lazy) out.push({ url: lazy, w: 0, orig: isOriginal(lazy) });' \
                    '    const lazy = img.getAttribute(C.GALLERY_LAZY_SRC);
    if (lazy) out.push({ url: lazy, w: 99999 });'

# The slideshow, and its counterweight. Both halves are the same guard read in opposite
# directions — several frames become one-at-a-time, one frame stays a picture — so they get
# a row each: either alone leaves the other looking covered. The stacking half runs against
# geometry, because painting is the part jsdom structurally cannot see.
mutate "a gallery stacks its frames down the page again" geometry \
  src/modules/comments.js "    if (frames.length < 2) {" \
                          "    if (frames.length < 99) {"

mutate "a lone picture is dressed up as a slideshow" run \
  src/modules/comments.js "    if (frames.length < 2) {" \
                          "    if (false) {"

# Hiding the rest of the deck is what makes it a slideshow rather than a stack, and an
# author display declaration beats the UA's [hidden]{display:none} — bug 84, one element
# over. Two rows, matching the expando's: the static guard and the measured consequence.
mutate "the gallery frame's [hidden] counterpart vanishes (static)" css-lint \
  src/styles/old-reddit.css ".shd-selfpost .shd-image-el[hidden] { display: none; }" ""

mutate "the gallery frame's [hidden] counterpart vanishes (layout)" geometry \
  src/styles/old-reddit.css ".shd-selfpost .shd-image-el[hidden] { display: none; }" ""

# A deck that dead-ends on an arrow is a control that ignores a click (bug 62) wearing a
# lighter colour. Clamping instead of wrapping is the plausible wrong version.
mutate "the deck dead-ends at its arrows instead of wrapping" run \
  src/modules/comments.js "    const at = (from + delta + frames.length) % frames.length;" \
                          "    const at = Math.max(0, Math.min(frames.length - 1, from + delta));"

# A frame that hydrates after consume (bug 91) lands at the end of the deck, and the resync
# must relabel WITHOUT moving the reader — a gallery being read at frame 2 when frame 6
# arrives has to still be showing frame 2.
mutate "a late frame sends the reader back to the first slide" run \
  src/modules/comments.js "    box.appendChild(nav);
    stepFrame(box, 0);" "    box.appendChild(nav);
    box.dataset.shdFrame = '0';
    stepFrame(box, 0);"

# ------------------------------------------- the original beats every resize ---
# Reported from live use: a post rendered at 640px with a full-size copy in the same
# element. i.redd.it serves the file as uploaded; preview.redd.it serves variants of it —
# and the original states no width, so a widest-descriptor rule scored it zero and every
# resize outbid it.
mutate "a resize outbids the original picture again" run \
  src/core/model.js '    if (c.orig !== bestOrig) return c.orig;' '    ;'

# The other half: preferring the original must not swallow the width tiebreak, or a post
# with no original at all — every gallery frame — has nothing left to rank by.
mutate "preferring the original throws away the width ranking under it" run \
  src/core/model.js '    return c.w > bestW;
  }' '    return c.orig;
  }'

# NOT MUTATED, deliberately, and recorded so the gap is a decision rather than an oversight:
# measure()'s per-frame cache is what stopped inRange() and diag() forcing three synchronous
# layouts per pump, and it is a COST change with no behavioural consequence — reverting it
# leaves every assertion in every suite green, correctly. A row for it would survive and
# read as a hole. What would make it testable is a layout-count probe the suites do not have.

# ---------------------------------------- the adversarial-review round (0.43.0) ---
#
# Each of these reintroduces something a full read of the tree found. The four guards on
# the age-gate click get a row each on purpose: two of them are independent (the host
# class and the button text) and either alone would leave the other looking covered.

# `configured-xpromo` is Reddit's CROSS-PROMOTION container, not the age gate's. An
# "Open in app" interstitial offering Yes / Not now sits in one, and matched every other
# test here.
mutate "the age gate matches any cross-promotion, not the modal" run \
  src/config/contracts.js "    host: '.configured-xpromo-modal'," \
                          "    host: '.configured-xpromo',"

# A bare "yes" is not an age answer. This is the half that stops a promo whose dialog
# DOES carry the modal class.
mutate "a bare yes counts as an age affirmation again" run \
  src/config/contracts.js '    affirm: /\b18\b/i,' \
                          '    affirm: /\byes\b|\bover\s*18\b/i,'

# `\bno\b` does not match "Not". Widening the DECLINE test can only ever make the click
# refuse more often, which is the safe direction and the reason it is separate.
mutate "the decline test stops recognising \"Not now\"" run \
  src/config/contracts.js "    decline: /\\bno\\b|\\bnot\\b|\\bunder\\b|\\bback\\b|\\bleave\\b|\\bcancel\\b/i" \
                          "    decline: /\\bno\\b|\\bunder\\b|\\bback\\b|\\bleave\\b/i"

# The floor is read from the stored record, so an attempt that stores nothing is an
# attempt the floor cannot see: a network that blocks raw.githubusercontent.com produced
# a fresh request at every browser start, for ever.
mutate "a failed update check leaves no trace, so it never backs off" run \
  src/core/background.js "  await stamp(answer);" "  if (answer) await stamp(answer);"

# ...and the other half: a failure must not be charged the full twenty hours, which is
# what the original no-stamp reasoning was protecting.
mutate "a blip silences the update check for a whole day" run \
  src/core/background.js "  return Date.now() - rec.at >= (rec.ok === false ? RETRY_INTERVAL_MS : MIN_INTERVAL_MS);" \
                         "  return Date.now() - rec.at >= MIN_INTERVAL_MS;"

# classify() reads the PATH, so `/` on business.reddit.com is a listing. Measured live:
# a marketing site blanked for the full first tick and stamped with our version.
mutate "the blackout lands on any reddit.com subdomain again" run \
  src/core/gate.js "    if (!SHD.route.rendersHost()) return false;" "    if (false) return false;"

# The hop rewrote every path, including the ones this extension hands back — breaking
# old.reddit for the readers who can still use all of it.
mutate "the old.reddit hop rewrites paths we do not render" run \
  src/core/oldreddit.js "    if (SHD.route.classify(out.pathname) === SHD.route.OTHER) return null;" "    ;"

# `arrival` is the one step PAST the submit. Carrying the draft into Reddit's composer
# and inviting a press is how a slow reply gets posted twice.
mutate "a reply that may have posted is offered for posting again" run \
  src/modules/account.js "      const posted = r.step === 'arrival';" "      const posted = false;"

# standDown() clears our marks and the `load` listener runs after it, so a route we
# disowned was re-marked. CONTRIBUTING promises those pages are untouched.
mutate "a route we handed back is marked anyway" run \
  src/core/gate.js "    if (SHD.route.classify() !== SHD.route.OTHER) {
      document.documentElement.setAttribute('data-shd-waiting', why);
    }" "    document.documentElement.setAttribute('data-shd-waiting', why);"

# One `\"` or `\\` in a Reddit id turns the lookup into invalid CSS; querySelector throws
# inside flush(), and eight of those spend the error budget on a page that is fine.
mutate "a row lookup interpolates an unescaped id again" run \
  src/core/dom.js '  const rowSel = (id) =>' \
                  '  const rowSel = (id) => ".thing[data-fullname=\"" + id + "\"]"; const unusedRowSel = (id) =>'

# A cloned <script> loses its already-started flag and runs on insertion.
mutate "a cloned body carries its scripts across" run \
  src/core/dom.js "    copy.querySelectorAll?.('script, iframe, object, embed').forEach(n => n.remove());" "    ;"

# A malformed % in a header href throws URIError inside readIdentity(), under flush().
mutate "a malformed username href spends an error-budget slot" run \
  src/core/session.js "        try { out.name = decodeURIComponent(m[1]); } catch { out.name = m[1]; }" \
                      "        out.name = decodeURIComponent(m[1]);"

# .DS_Store shipped in both store zips, and broke --check on every machine but the one
# that created it.
mutate "the packager ships dotfiles again" run \
  package-extension.js "const isPacked = (rel) =>
  !rel.endsWith('.md') && !rel.split('/').some(seg => seg.startsWith('.'));" \
                       "const isPacked = (rel) => !rel.endsWith('.md');"

# The accounting. DECLARED is read from this file itself rather than maintained by hand —
# a count that has to be kept in step with the rows is the same trap as the hand-maintained
# token list in bug 43, and it would have been wrong the first time a row was added.
DECLARED=$(grep -c '^mutate "' "$SRC/test/mutate.sh")
echo
printf 'rows: %s declared, %s run — %s caught, %s survived, %s anchor misses, %s no browser\n' \
  "$DECLARED" "$ROWS_RUN" "$ROWS_CAUGHT" "$ROWS_SURVIVED" "$ROWS_MISSED" "$ROWS_NOBROWSER"

# AN ANCHOR MISS IS A FAILURE, NOT A FOOTNOTE.
#
# A row whose anchor stopped matching tests nothing, and it announces that by printing
# ANCHOR MISS — which is neither a PASS nor a FAIL, so it scrolled past in a sweep that
# ended "all caught". A review found 16 dead rows at once this way, two of them the pair
# guarding vote delegation's shadow-root piercing, anchored on a line that had moved to
# another file entirely; the sweep had been reporting a clean run over them for releases.
#
# The rule this file already states about editing a source file breaking someone else's
# row only works if breaking one is loud. It is loud now.
if [ "$ROWS_NOBROWSER" -ne 0 ]; then
  printf '\033[31mNO BROWSER: %s rows needed Chromium and did not get it, so those bugs went\n' \
    "$ROWS_NOBROWSER"
  printf 'UNTESTED. Install a browser (or set SHEDDIT_CHROME) and run again; a sweep that\n'
  printf 'skips the layout and packed-extension suites is not evidence about them.\033[0m\n'
  exit 1
fi

if [ "$ROWS_MISSED" -ne 0 ]; then
  printf '\033[31mDEAD ROWS: %s of %s anchors did not match, so those bugs went UNTESTED.\n' \
    "$ROWS_MISSED" "$DECLARED"
  printf 'An ANCHOR MISS is not a pass. Re-point each anchor at the code as it is now —\n'
  printf 'and note that the row you broke is rarely the row for the code you edited.\n'
  printf 'test/anchor-check.sh lists them in about a minute, without running any suite.\033[0m\n'
  exit 1
fi

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
