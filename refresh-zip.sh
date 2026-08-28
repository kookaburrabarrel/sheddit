#!/usr/bin/env bash
#
# Make the README's download link serve the current code.
#
#   ./refresh-zip.sh            pull main, rebuild dist/sheddit.zip, push if it changed
#   ./refresh-zip.sh <version>  bump manifest.json + package.json to it first
#
# The zip is a build artifact kept in version control so the README can link a
# download without a release. That only works if it is rebuilt whenever the source
# changes, and it fails quietly when it is not — the link keeps working and hands
# people code nobody is looking at any more. This is the one command that fixes it.
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
  echo "bumped manifest.json + package.json to $BUMP"
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

git add dist/sheddit.zip manifest.json package.json
git commit --quiet --message "Rebuild the download zip for $VERSION"
git push --quiet origin main
echo
echo "Pushed. The README download now serves $VERSION."
