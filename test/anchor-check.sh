#!/usr/bin/env bash
#
# anchor-check.sh — does every mutation row still point at code that exists?
#
# WHY THIS IS A SEPARATE TOOL. `mutate.sh` prints ANCHOR MISS for a row whose anchor
# stopped matching, and a miss now fails the sweep — but the sweep takes about half an
# hour, and the row you break is rarely the row for the code you edited. This answers the
# same question in a minute, without running a single suite, so it can be run after any
# source edit rather than discovered at the end of a long sweep.
#
# HOW IT WORKS, AND WHY IT IS GENERATED RATHER THAN MAINTAINED. It splices a counting
# redefinition of `mutate` into a copy of mutate.sh, immediately after the real one so
# the later definition wins, and truncates everything from the accounting block down so
# no suite ever runs. A hand-kept copy of the rows would be a second list to drift — and
# the first version of this file WAS a snapshot, which silently reported rows that had
# already been repaired. It reads mutate.sh every time now.
#
# TWO TRAPS, BOTH LEARNED EXPENSIVELY:
#   - The generated copy must live inside test/, because mutate.sh opens with
#     `cd "$(dirname "$0")/.."`. Run from /tmp that resolves to `/`, and the next thing
#     the script does is tar its working directory.
#   - The rows must be parsed by BASH, not by a regex over the file: the anchors carry
#     escaped quotes and backticks that only the shell unquotes correctly.
set -u
cd "$(dirname "$0")/.."

SRC=test/mutate.sh
GEN=test/.anchor-check.generated.sh
trap 'rm -f "$GEN"' EXIT

DEF_END=$(grep -n '^mutate() {' "$SRC" | cut -d: -f1)
DEF_END=$(awk -v start="$DEF_END" 'NR >= start && /^}$/ { print NR; exit }' "$SRC")
STOP=$(grep -n '^DECLARED=' "$SRC" | cut -d: -f1)
if [ -z "$DEF_END" ] || [ -z "$STOP" ]; then
  echo "anchor-check: could not find mutate() or the accounting block in $SRC" >&2
  exit 2
fi

{
  sed -n "1,${DEF_END}p" "$SRC"
  cat <<'SPLICE'

# ---- generated: count anchor occurrences, change nothing --------------------
mutate() {
  local name="$1"; shift 2
  python3 - "$name" "$@" <<'PY'
import sys
name, args = sys.argv[1], sys.argv[2:]
bad = []
for i in range(0, len(args), 3):
    path, old = args[i], args[i + 1]
    try:
        s = open(path).read()
    except OSError:
        bad.append(f"{path}: MISSING FILE")
        continue
    n = s.count(old)
    if n != 1:
        bad.append(f"{path}: {n} matches for {old[:64]!r}")
if bad:
    print(f"  {name:<58} " + " | ".join(bad))
PY
}
SPLICE
  sed -n "$((DEF_END + 1)),$((STOP - 1))p" "$SRC"
} > "$GEN"

DECLARED=$(grep -c '^mutate "' "$SRC")
echo "checking $DECLARED anchors against the working tree"
OUT=$(bash "$GEN" 2>&1 | grep -v '^MUTATION TESTING' | grep -v '^$')
# The row headings mutate.sh prints between sections are not findings.
BAD=$(printf '%s' "$OUT" | grep -c 'matches for\|MISSING FILE')

if [ "$BAD" -eq 0 ]; then
  echo "all $DECLARED anchors match exactly once"
  exit 0
fi

printf '%s\n' "$OUT" | grep 'matches for\|MISSING FILE'
echo
echo "$BAD row(s) point at code that has moved or changed."
echo "0 matches: the row tests NOTHING and reads as silence in a sweep."
echo "2+ matches: apply() replaces the FIRST one, so the row tests whichever came first."
exit 1
