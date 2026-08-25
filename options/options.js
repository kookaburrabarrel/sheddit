/* Kept in step with SHD.settings in src/config/contracts.js by a test in test/run.js —
   this page cannot import that file, so the list is duplicated and asserted instead.
   `theme` is the one non-boolean setting; its control is a <select>, not a checkbox. */
const DEFAULTS = {
  listing: true, comments: true, chrome: true, profiles: true,
  compactRows: true, showThumbnails: true, showNsfwThumbnails: false, autoPaginate: true,
  inlineVideo: true, inlineImages: true,
  theme: 'classic'
};

const controls = [...document.querySelectorAll('[data-k]')];
const read = (c) => (c.type === 'checkbox' ? c.checked : c.value);
const write = (c, v) => { if (c.type === 'checkbox') c.checked = !!v; else c.value = v; };

chrome.storage.sync.get('settings').then(({ settings }) => {
  const s = { ...DEFAULTS, ...(settings || {}) };
  controls.forEach(c => write(c, s[c.dataset.k]));
});

controls.forEach(c => c.addEventListener('change', async () => {
  const { settings } = await chrome.storage.sync.get('settings');
  const next = { ...DEFAULTS, ...(settings || {}) };
  next[c.dataset.k] = read(c);
  await chrome.storage.sync.set({ settings: next });
}));

/* Firefox treats MV3 host permissions as revocable — and as declined, on versions before
   its install-time prompt — while Chrome grants them at install. A content script that
   never runs cannot say so on any page, so the missing grant is indistinguishable from
   the extension not being installed, and this page is the one surface left that can
   surface it. Must match manifest.json's host_permissions — asserted by test/run.js. */
const HOSTS = { origins: ['*://*.reddit.com/*'] };
const hostWarning = document.querySelector('#host-warning');

async function syncHostWarning() {
  try {
    hostWarning.hidden = await chrome.permissions.contains(HOSTS);
  } catch { /* no permissions API (granted at install, or the dev harness) — stay hidden */ }
}

document.querySelector('#host-grant').addEventListener('click', async () => {
  try { await chrome.permissions.request(HOSTS); } catch { /* declined — warning stands */ }
  syncHostWarning();
});

syncHostWarning();
