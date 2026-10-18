globalThis.SHD = globalThis.SHD || {};

SHD.preferences = (() => {
  const DEFAULTS = {
    listing: true, comments: true, chrome: true, profiles: true,
    compactRows: true, showThumbnails: true, showNsfwThumbnails: false, autoPaginate: true,
    inlineVideo: true, inlineImages: true, redirectOldReddit: true, account: true,
    autoUpdateCheck: true, theme: 'classic'
  };
  const THEMES = ['classic', 'slate', 'sepia', 'night', 'carbon'];
  const MESSAGE = 'shd:set-setting';
  let tail = Promise.resolve();

  // One writer in the extension background owns read-modify-write across all tabs.
  function write(key, value) {
    const run = async () => {
      if (!Object.hasOwn(DEFAULTS, key) ||
          (key === 'theme' ? !THEMES.includes(value) : typeof value !== 'boolean')) {
        throw new Error('Invalid Sheddit preference');
      }
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({
        settings: { ...DEFAULTS, ...(settings || {}), [key]: value }
      });
    };
    const next = tail.then(run, run);
    tail = next;
    return next;
  }

  async function set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      const result = await chrome.runtime.sendMessage({ type: MESSAGE, key, value });
      if (!result?.ok) throw new Error(result?.error || 'Could not save Sheddit preference');
    } else {
      // The DevTools bundle has no extension background; reuse the same writer locally.
      await write(key, value);
    }
  }

  return { DEFAULTS, THEMES, MESSAGE, write, set };
})();
