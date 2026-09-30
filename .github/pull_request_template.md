<!--
Thanks for contributing. The checklist below is short on purpose — every item on it is
something that has actually gone wrong in this repo before.
-->

## What this changes

<!-- What the code does now that it didn't before. -->

## What the wrong behaviour looked like

<!--
For a bug fix, this is the important part, and the engineering log is assembled from it.
Describe the *symptom*, not just the cause: "the feed dead-ended at three posts" is
something a future reader can match against what they're seeing. "Fixed pagination" isn't.

For a new feature, say what it looks like on screen instead.
-->

## Testing

<!-- Paste the summary lines from `npm test` (one per suite), e.g. "41 passed, 0 failed". -->

- [ ] `npm test` passes
- [ ] Browser suites actually ran (with no Chromium, or no Firefox + geckodriver, they print `SKIP` and exit 0 — say so if they skipped)
- [ ] New assertions have a matching row in `test/mutate.sh`, and I watched it catch
- [ ] `bash test/anchor-check.sh` says every anchor still matches (editing any source file can break a row belonging to an unrelated bug)

## Checklist

- [ ] No `shreddit-*` selector outside `src/config/contracts.js`
- [ ] No hard-coded colours in `src/styles/old-reddit.css` — colours are `--shd-*` tokens
- [ ] Unhandled routes (search, modmail, chat, composer) are still completely untouched
- [ ] No network requests of its own were added
- [ ] Version bumped in `manifest.json`, `package.json`, the README and `dist/latest.json` (see CONTRIBUTING), if a tester might load this build
- [ ] `npm run package` re-run if anything under `src/`, `icons/`, `options/` or
      `manifest.json` changed — `dist/sheddit.zip` and `dist/sheddit-firefox.zip` are what
      the README downloads serve, and `npm run package:check` fails if either has gone stale
- [ ] Docs updated if behaviour changed

## Anything reviewers should know

<!-- Trade-offs, things you weren't sure about, things you deliberately left out. -->
