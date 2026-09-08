/**
 * background.js — the update check, asked once when the browser starts.
 *
 * WHAT CHANGED, AND WHY IT IS WRITTEN DOWN HERE. Until 0.37.0 the check fired only on a
 * click, and update.js still carries the reasoning for that restraint because it is still
 * the reasoning: a request that leaves by itself is a request the reader did not ask for.
 * What changed is not the analysis but the decision — a hand-installed copy that nobody
 * thinks to check is the single likeliest cause of "Sheddit stopped rendering", and a
 * notice that waits to be pressed is a notice the people who need it most never see.
 *
 * So the check now runs once at browser start, and three properties keep it honest:
 *
 *   IT IS A SWITCH, NOT A FACT OF LIFE. `settings.autoUpdateCheck` gates it, the header
 *   carries the toggle beside the control it feeds, and off means off — no request leaves
 *   at startup at all, and the click-to-check button behaves exactly as it always has.
 *
 *   IT ASKS GITHUB, NOT US. The file is served out of this repository by GitHub. There is
 *   still no server of this project's own, so there is nothing here that could collect
 *   anything even if it wanted to. GitHub sees what any host sees — an IP and a timestamp
 *   — which is the honest description and the one PRIVACY.md now gives.
 *
 *   IT IS RATE-LIMITED, because "at browser start" is not a rate. A browser restarted six
 *   times in an afternoon must not send six requests: MIN_INTERVAL_MS is the floor, read
 *   from the stored answer's own timestamp, so the frequency is bounded by the clock
 *   rather than by how someone uses their computer.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not render, notify, badge, or open anything.
 * It writes the answer to the same `chrome.storage.local` record the header already reads
 * at boot, so the result surfaces the next time a Reddit page is opened, through code that
 * already existed. A worker that could put something on screen would be a second UI path
 * with no tests behind it; this one has no opinions at all.
 *
 * THE CONSTANTS ARE DUPLICATED FROM update.js ON PURPOSE. A service worker and a content
 * script are separate scripts with no shared module scope, and the alternative — a build
 * step that concatenates them — is the bundling this project does not do. So they are
 * written twice and `test/run.js` asserts the two copies agree, which is exactly the
 * protocol-literal check bridge.js already carries for the same reason.
 */

/* Keep in step with src/core/update.js — asserted equal by test/run.js. */
const LATEST_URL =
  'https://raw.githubusercontent.com/kookaburrabarrel/sheddit/main/dist/latest.json';
const KEY = 'update';
const HOME = 'https://github.com/kookaburrabarrel/sheddit#install';
const TIMEOUT_MS = 6000;

/* Twenty hours, not twenty-four: a reader who starts their browser at the same hour every
   morning must not be pushed to every other day by a boundary they cannot see. */
const MIN_INTERVAL_MS = 20 * 3600 * 1000;

/** The reader's switch. Absent storage, or an absent key, means the default: on. */
async function enabled() {
  try {
    const { settings } = await chrome.storage.sync.get('settings');
    return !settings || settings.autoUpdateCheck !== false;
  } catch {
    /* No storage is not consent. The check is a request the reader is entitled to refuse,
       and a browser that will not tell us the setting cannot tell us it was left on. */
    return false;
  }
}

/** How long since the last answer of any kind. Infinity when there has never been one. */
async function sinceLast() {
  try {
    const got = await chrome.storage.local.get(KEY);
    const at = got && got[KEY] && got[KEY].at;
    return typeof at === 'number' ? Date.now() - at : Infinity;
  } catch { return Infinity; }
}

/** Only https, and only what we asked about — update.js's rule, for the same reason. */
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : HOME);

/**
 * One GET, with update.js's headers exactly: no cookies, no referrer, no cache. The
 * referrer is moot here — a worker has no page to leak — but it is set anyway, because the
 * day this code is copied somewhere that does have one is the day it would matter.
 */
async function check() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(LATEST_URL, {
      signal: ctl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'follow'
    });
    if (!r.ok) return;
    const j = await r.json();
    if (!j || typeof j.version !== 'string') return;
    await chrome.storage.local.set({
      [KEY]: {
        at: Date.now(),
        version: j.version,
        url: safeUrl(j.url),
        notes: typeof j.notes === 'string' ? j.notes : null
      }
    });
  } catch {
    /* Offline, blocked, malformed, timed out — all the same here, and all silent. There is
       nobody to tell: the header reports what it finds, and finding nothing new is what a
       failed startup check correctly looks like. */
  } finally {
    clearTimeout(timer);
  }
}

/** The whole worker: two gates, then one request. */
async function maybeCheck() {
  if (!(await enabled())) return;
  if ((await sinceLast()) < MIN_INTERVAL_MS) return;
  await check();
}

/* onStartup is the browser opening. onInstalled covers the install and the update, where
   the stored answer belongs to the copy that was just replaced — checking then is what
   stops a fresh install claiming an update is available on its first page. */
chrome.runtime.onStartup.addListener(() => { maybeCheck(); });
chrome.runtime.onInstalled.addListener(() => { maybeCheck(); });

/* Exported for the suite only; a worker has no other consumer. */
globalThis.SHD_BG = { LATEST_URL, KEY, HOME, TIMEOUT_MS, MIN_INTERVAL_MS,
                      enabled, sinceLast, check, maybeCheck };
