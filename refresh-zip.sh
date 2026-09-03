#!/usr/bin/env bash
#
# Make the README's download links serve the current code.
#
#   ./refresh-zip.sh            pull main, rebuild BOTH zips, push if they changed
#   ./refresh-zip.sh <version>  bump manifest.json + package.json to it first
#
# The zips are build artifacts kept in version control so the README can link a
# download without a release. That only works if they are rebuilt whenever the source
# changes, and it fails quietly when they are not — the link keeps working and hands
# people code nobody is looking at any more. This is the one command that fixes it.
#
# BOTH of them, and that is the whole reason this line reads the way it does.
# package-extension.js has always written dist/sheddit.zip AND dist/sheddit-firefox.zip,
# but this script staged only the first — so every run left the Firefox zip rebuilt,
# uncommitted and dirty in the working tree, and the README's Firefox download went on
# serving whichever version someone last remembered to add by hand (0.28.1, by the log).
# Exactly the quiet failure the paragraph above describes, in the script written to
# prevent it. Found 2026-09-03; test/run.js now asserts both names appear here.
set -euo pipefail
cd "$(dirname "$0")"

BUMP="${1:-}"

# Start from what is actually published, so the zip cannot be built from a stale tree.
git fetch origin main --quiet
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Working tree has uncommitted changes. Commit or stash them first:" >&2
  git status --short >&2
  exit 1
fi
git merge --ff-only origin/main --quiet

if [ -n "$BUMP" ]; then
  if ! printf '%s' "$BUMP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "Version must look like 1.2.3, got: $BUMP" >&2
    exit 1
  fi
  # Both files, always — a tester reads the manifest version off the failure screen,
  # and a mismatch between the two has cost this project whole test rounds before.
  for f in manifest.json package.json; do
    perl -0pi -e 's/("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")/${1}'"$BUMP"'${2}/' "$f"
  done

  # And the two halves of the update check, which fail QUIETLY rather than loudly.
  #
  # dist/latest.json is what an installed copy is answered with when its reader asks
  # whether there is anything newer. Left at the old version it does not error — it tells
  # every reader on every build that they are already current, which is worse than having
  # no check at all, because they now believe they checked.
  #
  # BUILT in update.js is the local half: the header's nudge measures this copy's age from
  # it without touching the network. Frozen, it eventually calls a fresh install stale and
  # trains people to ignore the one notice they get.
  #
  # run.js asserts all four names appear in this script, so dropping one fails the suite
  # rather than the next release.
  TODAY=$(date -u +%F)
  perl -0pi -e 's/("version":\s*")[0-9]+\.[0-9]+\.[0-9]+(")/${1}'"$BUMP"'${2}/' dist/latest.json
  perl -0pi -e 's/("released":\s*")[0-9-]+(")/${1}'"$TODAY"'${2}/' dist/latest.json
  perl -0pi -e "s/(const BUILT = ')[0-9-]+(')/\${1}$TODAY\${2}/" src/core/update.js
  echo "bumped manifest.json + package.json to $BUMP"
  echo "stamped dist/latest.json + src/core/update.js with $BUMP / $TODAY"
fi

VERSION=$(perl -ne 'print $1 and exit if /"version":\s*"([^"]+)"/' manifest.json)

# Decide BEFORE rebuilding. A zip stores mtimes, so rebuilding an unchanged tree
# produces different bytes every time — comparing the file itself would commit noise
# on every run. --check compares what is inside the zip against the working tree.
if [ -z "$BUMP" ] && node package-extension.js --check >/dev/null 2>&1; then
  echo "Already current at $VERSION — nothing to do."
  exit 0
fi

node package-extension.js
node package-extension.js --check

git add dist/sheddit.zip dist/sheddit-firefox.zip dist/latest.json \
        manifest.json package.json src/core/update.js
git commit --quiet --message "Rebuild the download zips for $VERSION"
git push --quiet origin main
echo
echo "Pushed. Both README downloads now serve $VERSION."
