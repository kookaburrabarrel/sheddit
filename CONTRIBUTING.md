# Contributing to Sheddit

Thanks for looking. This project has an unusual shape — it depends on a website it does not
control, and most of what has gone wrong with it was invisible to the tests at the time. So
before the mechanics, two things that will save you an afternoon.

## Two habits this codebase runs on

**Measure before you conclude anything about Reddit's markup.** Nearly every entry in the
[engineering log](docs/engineering-log.md) began as a confident, reasonable assumption that a
five-minute check would have disproved. *Comments are flat. The dev harness proves pagination
works. An empty feed means Sheddit is broken.* All wrong, all cheap to verify, all shipped.

**A green test proves nothing until you have watched it go red.** If you add an assertion,
add a matching row to `test/mutate.sh` that reintroduces the bug, and confirm the suite
catches it. A test that would pass with the bug present is worse than no test — it looks
like coverage.

## The most useful thing you can contribute

**Live findings.** CI cannot see real Reddit: datacenter IPs get served a bot-mitigation
shim instead of the page (an ~8 KB spinner, HTTP 200, zero `shreddit-post` elements). That
means `npm run verify:live` and `npm run capture:live` can only be run from an ordinary
machine on an ordinary connection — and they are the only way to settle a question about
what Reddit actually ships.

If you can run this:

```bash
npm run verify:live
```

...and paste the output into an issue, that is genuinely more valuable than most code
changes. Same for `npm run capture:live -- --path=/r/something/`, which records a real page
shape so it can become a fixture.

A few questions are open right now and each needs one run from a real browser — they are
listed at the bottom of [docs/engineering-log.md](docs/engineering-log.md#open-questions).

## Reddit changed something and Sheddit broke

Almost always a one-file fix. **Every Reddit selector and attribute name lives in
[`src/config/contracts.js`](src/config/contracts.js) and nowhere else.** Nothing outside that
file should ever name a `shreddit-*` element. If you find yourself adding a selector
somewhere else, that is the bug.

Sheddit's failure screen is built for exactly this moment: it names the reason, prints the
attribute dump, and tells you whether the render queue ran at all. Include that screen in
your issue and the diagnosis is usually immediate.

## Development

```bash
npm install
npm test           # all six suites
npm run test:fast  # css-lint + jsdom only, no browser — use this while iterating
npm run preview    # writes openable dist/preview.*.html
npm run build      # dist/sheddit.dev.js — paste into DevTools on a Reddit page
npm run package    # rebuilds both download zips the README links (Chrome + Firefox)
npm run package:check   # fails if either zip no longer matches the source
```

To run the extension itself: `chrome://extensions` → Developer mode → Load unpacked → this
folder. **A pushed commit is not a loaded extension** — Chrome keeps running the code it
read at load time, so hit the ↻ on the extension card before testing anything. The failure
screen prints the version so you can check which build you are actually looking at.

### The six suites, and why each exists

| Suite | Runs on | Exists because |
|---|---|---|
| `test/css-lint.js` | the stylesheets, statically | fast guard on floats, column arithmetic, theme drift |
| `test/run.js` | the bundle in jsdom | structure, routing, idempotency, delegation |
| `test/geometry.js` | headless Chromium | **jsdom does no layout** — the suite once passed 39/39 while the page rendered visibly wrong |
| `test/extension.js` | the **packed extension** | content scripts don't share Reddit's JS realm; pagination was broken in every installed copy while the dev harness worked fine |
| `test/extension-firefox.js` | the **Firefox build** in a real Firefox | Gecko polices that realm boundary harder still, and its ESR has no `navigation` API — SPA routing rides the bridge's relay there |
| `test/media-sync.js` | headless Chromium | **jsdom has no media pipeline** — `play()` resolves nothing, so the player's audio pairing was invisible to every other suite |

Browser suites skip cleanly when no matching browser is found, so `npm test` works on a
machine without one. A fork's CI can set `SHEDDIT_REQUIRE_BROWSER=1` (and
`SHEDDIT_REQUIRE_FIREFOX=1`) to turn those skips into failures.

### Mutation testing

```bash
npm run test:mutate   # ~30 min, runs on a throwaway copy — your working tree is never touched
```

Each row reintroduces a bug this project shipped. Before you
trust a green sweep, know the three ways a row can look like proof while proving nothing:

1. **A dead anchor reads as silence.** `ANCHOR MISS` is neither a pass nor a failure, and the
   summary only counts `FAIL` lines. Editing *any* source file can break a row belonging to
   an unrelated bug — check the anchors after every change, including for duplicates, since
   the replacement only hits the first occurrence.
2. **The mutated branch may be unreachable.** One row gutted a function to `return false` and
   the suite stayed green, because an earlier condition short-circuited before it was ever
   consulted.
3. **Redundant paths hide each other.** If three call sites all clear a flag, removing one is
   invisible. Rows that test defence-in-depth must remove *all* the paths, and say so.

## Pull requests

- **Branch from `main`.** Keep the change focused on one thing.
- **Run `npm test` and say so in the PR.** If a browser suite skipped, say that too.
- **Add a mutation row** for any new assertion, and confirm it catches.
- **Bump the version** in `manifest.json`, `package.json` and the README (badge, header
  line, install block) if a tester might load your build. It is the only build identity
  anyone has, and `npm test` fails if the four disagree.
- **Write the commit message long-form**, explaining *what the wrong behaviour looked like*
  rather than only what changed. The engineering log is assembled from these, and a
  description you can match against a symptom is worth far more than "fixed pagination".

### Things that will get a change sent back

- A `shreddit-*` selector outside `src/config/contracts.js`
- A hard-coded colour in `src/styles/old-reddit.css` — every colour is a `--shd-*` token, or
  it is invisible to four of the five themes
- A new assertion with no mutation row
- Touching an unhandled route. Search, modmail, chat and the post composer must be left
  *completely* untouched — deleting an element counts as touching it
- Anything that makes a network request of its own. There are none, and that is a feature

## Firefox

Done, and tested. Firefox has accepted `"world": "MAIN"` content scripts since 128, so
`src/core/bridge.js` runs unchanged; the build floor is 140 (the current ESR), which is
where the manifest's data-collection declaration is read. The Firefox build is
`dist/sheddit-firefox.zip`, whose manifest is **derived** at package time
(`firefoxManifest()` in `package-extension.js` — the one place the two stores may
differ), and `test/extension-firefox.js` installs it into a real Firefox and drives it.
Two things the port surfaced, both worth knowing before touching route or bridge code:
Firefox's realm separation meant the old same-realm history patch never saw a Reddit
navigation (engineering log bug 82 — the fix is the bridge's history relay, and a static
check refuses the patch coming back), and Firefox treats MV3 host permissions as
revocable, which is what the options page's access warning exists for.

## Scope

Sheddit is built for **logged-out reading**. Please don't add affordances that need a
session — `save` and `report` were removed for exactly this reason. Voting is deliberately
not a supported feature.

**In scope:** the home feed, `/r/*` listings, comment pages, user profiles, and the chrome
around them. **Out for now:** search, modmail, chat, the composer, anything auth-gated.

## Reporting a bug

Use the issue templates — there is one specifically for "Reddit changed and Sheddit broke",
which asks for the things that make it diagnosable in one pass. In general, the most useful
report includes the extension version, the exact URL shape, whether you were logged in, and
a screenshot of the failure screen if you got one.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Contributions are accepted under [GPL-3.0-or-later](LICENSE), the same license as the
project.
