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

<!-- Paste the summary line from `npm test`, e.g. "846 passed, 0 failed". -->

- [ ] `npm test` passes
- [ ] Browser suites actually ran (they **skip silently** with no Chromium — say so if they skipped)
- [ ] New assertions have a matching row in `test/mutate.sh`, and I watched it catch
- [ ] `bash test/mutate.sh` anchors still match (editing any source file can break a row belonging to an unrelated bug)

## Checklist

- [ ] No `shreddit-*` selector outside `src/config/contracts.js`
- [ ] No hard-coded colours in `src/styles/old-reddit.css` — colours are `--shd-*` tokens
- [ ] Unhandled routes (search, modmail, chat, composer) are still completely untouched
- [ ] No network requests of its own were added
- [ ] Version bumped in **both** `manifest.json` and `package.json`, if a tester might load this build
- [ ] `npm run package` re-run if anything under `src/`, `icons/`, `options/` or
      `manifest.json` changed — `dist/sheddit.zip` is what the README download serves,
      and `npm run package:check` fails if it has gone stale
- [ ] Docs updated if behaviour changed

## Anything reviewers should know

<!-- Trade-offs, things you weren't sure about, things you deliberately left out. -->
