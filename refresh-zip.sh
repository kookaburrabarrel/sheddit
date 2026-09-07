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

# The GitHub release is a SECOND copy of the same build, and until this function existed
# nothing here touched it — so it drifted the way anything unowned drifts. Measured on
# 2026-09-01: the release offered 0.30.0 binaries beside a 0.25.0 source archive, seven
# versions apart, under a title that claimed one of them.
#
# The tag is the load-bearing half. GitHub generates "Source code (zip)" from the TAG,
# not from the assets, so uploading new zips to a tag that has not moved republishes the
# binaries against the old source and reads as current. This project asks people to read
# the source and check it against the extension they installed — that is what "plain
# unminified source, no build step" is FOR — and a release page where those two disagree
# turns the invitation into a dead end.
#
# The body is read from dist/latest.json rather than written a second time here. That
# field is already a sentence about this exact release, and run.js already asserts it
# names its own version, so the release inherits that guarantee instead of adding a
# fourth place a version string can go stale.
sync_release() {
  command -v gh >/dev/null 2>&1 || {
    echo "gh not found — skipping the release. Both README downloads are still current."
    return 0
  }
  local notes
  notes=$(node -e 'const j=require("./dist/latest.json");process.stdout.write(j.notes||"")')

  # -m makes the tag annotated, which a signed tag has to be; whether it is actually
  # signed is left to tag.gpgSign, so a machine with no key still finishes the release
  # rather than failing at the last step of one.
  git tag -f Release HEAD -m "Sheddit $VERSION" >/dev/null || return 1
  git push -f --quiet origin Release || return 1

  if gh release view Release >/dev/null 2>&1; then
    gh release upload Release dist/sheddit.zip dist/sheddit-firefox.zip --clobber || return 1
    gh release edit Release --title "$VERSION" --notes "$notes" >/dev/null || return 1
  else
    gh release create Release dist/sheddit.zip dist/sheddit-firefox.zip \
      --title "$VERSION" --notes "$notes" >/dev/null || return 1
  fi
  echo "Release now serves $VERSION, source archive included."
}

if [ -z "$BUMP" ] && node package-extension.js --check >/dev/null 2>&1; then
  echo "Already current at $VERSION — nothing to rebuild."
  # The zips are current; the release need not be, and a hand-edited one is how the
  # drift above started. Check the cheap half — where the tag points — so an ordinary
  # no-op run stays a no-op and a stale release still gets caught.
  if [ "$(git rev-parse 'Release^{commit}' 2>/dev/null)" != "$(git rev-parse HEAD)" ]; then
    sync_release || echo "Release sync failed. Both README downloads are still current." >&2
  fi
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

# After the push, never before: the tag has to name a commit the remote already has.
sync_release || echo "Release sync failed. Both README downloads are still current." >&2
