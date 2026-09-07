#!/usr/bin/env node
/**
 * build.js — produces dist/sheddit.dev.js
 *
 * A single self-contained file you can paste into DevTools on any reddit.com page to run
 * the whole extension immediately. Same source files, same order as the manifest; the
 * stylesheets are inlined and injected as <style> tags instead of arriving via the manifest.
 *
 * This exists so the extension is testable without the load-unpacked / reload cycle.
 *
 *   node build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'sheddit.dev.js');

// Must match manifest.json content_scripts order.
// themes.css is delivered at document_start in the manifest (--shd-blank has to beat the
// pre-render blackout); in one bundle that distinction does not exist, so it goes last.
const CSS = ['src/styles/suppress.css', 'src/styles/old-reddit.css', 'src/styles/themes.css',
             // The old.reddit interstitial. Inert anywhere else — every rule is under
             // .shd-redirecting, which only oldreddit.js sets and only on that host — so
             // the one bundle stays honest about what the extension delivers.
             'src/styles/redirect.css'];
const JS = [
  'src/config/contracts.js',
  'src/config/themes.js',
  // In the extension this runs in the page's MAIN world (manifest "world": "MAIN"); the
  // dev harness has only one world, so it simply registers its listener alongside
  // everything else. Either way it must load before paginator.js dispatches to it.
  'src/core/bridge.js',
  // route.js sits at document_start in the manifest (before gate.js): the gate's
  // not-started branch asks classify() whether the URL is one the pipeline will take,
  // and on a streamed page that question is asked before route.js would load at idle.
  'src/core/route.js',
  'src/core/gate.js',
  // Only ever acts on old.reddit.com, where the manifest delivers it alone at
  // document_start; on any other host targetFor() returns null and start() does nothing.
  // It is here because the drift check below is a check on the SET of files that ship,
  // and a file exempted from it is a file that can go missing unnoticed.
  'src/core/oldreddit.js',
  'src/core/dom.js',
  'src/core/model.js',
  'src/core/media.js',
  'src/core/paginator.js',
  // Loaded before chrome.js, which subscribes to it as it evaluates.
  'src/core/update.js',
  // Who is logged in, then what that changes. Both before listing.js and comments.js,
  // which build their vote columns and reply links out of account.js.
  'src/core/session.js',
  'src/modules/account.js',
  'src/modules/listing.js',
  'src/modules/comments.js',
  'src/modules/chrome.js',
  'src/core/pipeline.js'
];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Verify the manifest and this list have not drifted apart.
const manifest = JSON.parse(read('manifest.json'));
const manifestJs = manifest.content_scripts.flatMap(cs => cs.js || []);
const drift = manifestJs.filter(f => !JS.includes(f)).concat(JS.filter(f => !manifestJs.includes(f)));
if (drift.length) {
  console.error('build.js and manifest.json disagree on script list:', drift);
  process.exit(1);
}

const css = CSS.map(read).join('\n\n');

const banner = `/* sheddit dev harness — built ${new Date().toISOString()}
 * Paste into DevTools on any reddit.com page. Re-running is safe (it tears down first).
 */`;

const bundle = `${banner}
(() => {
  // --- teardown any previous run ------------------------------------------------
  document.getElementById('shd-style')?.remove();
  document.getElementById('shd-root')?.remove();
  document.getElementById('shd-header')?.remove();
  document.querySelectorAll('[data-shd]').forEach(el => el.removeAttribute('data-shd'));
  document.documentElement.classList.remove('shd-gate', 'shd-active');
  globalThis.SHD?.__teardown?.();
  globalThis.SHD = undefined;

  // --- styles ------------------------------------------------------------------
  const style = document.createElement('style');
  style.id = 'shd-style';
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);

  // --- chrome.storage shim (DevTools has no extension APIs) ---------------------
  // A REAL in-memory implementation, not a stub that swallows writes. The first version
  // resolved set() and stored nothing, with no onChanged at all — so every in-page
  // control that persists a setting (the header's nsfw toggle) appeared to do nothing
  // here while working perfectly when installed, and the harness reported no error
  // because the write "succeeded". Settings do not survive a reload in the harness,
  // which is honest: there is nowhere to put them. Within one session they behave.
  if (typeof chrome === 'undefined' || !chrome.storage) {
    const store = {};
    const listeners = [];
    globalThis.chrome = Object.assign(globalThis.chrome || {}, {
      storage: {
        sync: {
          get: async (key) => (key ? { [key]: store[key] } : { ...store }),
          set: async (obj) => {
            const changes = {};
            for (const [k, newValue] of Object.entries(obj)) {
              changes[k] = { oldValue: store[k], newValue };
              store[k] = newValue;
            }
            listeners.forEach(fn => { try { fn(changes, 'sync'); } catch (e) { console.warn(e); } });
          }
        },
        onChanged: { addListener: (fn) => listeners.push(fn) }
      }
    });
  }

${JS.map(f => `  // ===== ${f} =====\n${read(f).split('\n').map(l => '  ' + l).join('\n')}`).join('\n\n')}

  console.log('%c[sheddit] dev harness loaded', 'color:#369;font-weight:bold');
})();
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, bundle);

const kb = (bundle.length / 1024).toFixed(1);
console.log(`built ${path.relative(ROOT, OUT)}  (${JS.length} modules, ${CSS.length} stylesheets, ${kb} KB)`);
