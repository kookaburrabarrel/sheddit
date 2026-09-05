/**
 * chrome.js — the furniture: top header bar, theme switcher, sort tab menu, right sidebar.
 * All rendered from route state; no data fetching.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.chrome = (() => {
  const { h } = SHD.dom;

  /* route.js owns the sort list so classify() can never disagree with the tabs we
     render — see the comment there. */
  const SORTS = SHD.route.SORTS;

  function header() {
    if (document.querySelector('#shd-header')) return;
    const sub = SHD.route.subredditOf();
    const user = SHD.route.usernameOf();
    document.body.prepend(
      h('div#shd-header.shd-chrome', null, [
        h('span.pagename', null,
          h('a', { href: '/', text: 'reddit' })),
        h('ul.tabmenu', null, [
          h('li', null, h('a', { href: '/', text: 'front' })),
          h('li', null, h('a', { href: '/r/all/', text: 'all' })),
          h('li', null, h('a', { href: '/r/popular/', text: 'popular' })),
          sub ? h('li.selected', null, h('a', { href: `/r/${sub}/`, text: `r/${sub}` })) : null,
          user ? h('li.selected', null, h('a', { href: `/user/${user}/`, text: `u/${user}` })) : null
        ]),
        /* Old reddit's header ended in the account corner. Ours says one word there when
           the account layer is on, so a reader knows the arrows are live without voting
           to find out; null for everyone else. */
        SHD.account.headerStatus(),
        themeBar()
      ])
    );
  }

  /**
   * The update control, at the left end of the theme bar.
   *
   * It lives here rather than on the options page for the reason the theme buttons do: this
   * bar is the surface a reader actually sees. An extension installed by hand never updates
   * itself (see update.js), so a notice nobody opens the options page to find is a notice
   * that does not exist — and the reader who most needs it is by definition the one who set
   * this up once, months ago, and has not thought about it since.
   *
   * Quiet by default. It says nothing but its own name until either the copy is old enough
   * to be worth a look (arithmetic, no network) or the reader has clicked and been told
   * there is something newer (one request, on that click). It never checks by itself.
   */
  function updateControl() {
    /* Kick the stored answer off on first paint. A promise that has already run is a no-op,
       and when it does land it repaints through the watcher below rather than here. */
    SHD.update.load();
    return h('span.shd-update', { role: 'status', 'aria-live': 'polite' }, updateBody());
  }

  /** The control's one child, chosen from update state. A link when there is somewhere to
      go, a button when there is something to ask. */
  function updateBody() {
    const s = SHD.update.state();

    if (s.phase === 'checking') {
      return h('button.shd-update-btn', {
        type: 'button', disabled: true, text: 'checking\u2026'
      });
    }

    if (s.ahead) {
      /* The reload step is the part people miss — Chrome keeps running the copy it read at
         load time, so a downloaded zip changes nothing until the card is reloaded. Saying so
         in the title is cheaper than the bug report that follows from not saying it. */
      return h('a.shd-update-btn.shd-update-new', {
        href: s.url, target: '_blank', rel: 'noopener noreferrer',
        /* Both version numbers, always. "Which one am I on" is the question a reader
           actually has, and the release note — when there is one — answers a different
           one, so it is added to that rather than substituted for it. */
        title: `Version ${s.latest} is out.${s.notes ? ' ' + s.notes : ''} `
             + `You are running ${s.installed}. `
             + 'Download it, replace the folder, then press \u21bb on the Sheddit card in '
             + 'chrome://extensions — until you do, the old copy keeps running.',
        text: `update to ${s.latest}`
      });
    }

    if (s.phase === 'failed') {
      /* A check that cannot reach GitHub must not be a dead end: the reader still wanted to
         know, and the download page answers the question by hand. */
      return h('a.shd-update-btn.shd-update-stale', {
        href: s.url, target: '_blank', rel: 'noopener noreferrer',
        title: 'Could not reach GitHub to ask. Opens the download page instead, '
             + 'where the current version is stated.',
        text: 'check failed'
      });
    }

    if (s.phase === 'done') {
      return h('button.shd-update-btn', {
        type: 'button',
        title: `Version ${s.latest} is the newest, and it is the one you are running. `
             + 'Click to ask again.',
        onclick: () => SHD.update.check(),
        text: 'up to date'
      });
    }

    return h('button.shd-update-btn', {
      type: 'button',
      class: s.stale ? 'shd-update-stale' : null,
      title: s.stale
        ? `This copy is ${s.days} days old and has not been checked. A hand-installed `
          + 'extension never updates itself, so it stays this old until you replace it. '
          + 'Click to ask GitHub whether a newer one exists — one request for a version '
          + 'file, no cookies, no referrer, nothing about you.'
        : 'Ask GitHub whether a newer build exists. One request for a version file, sent '
          + 'only when you click: no cookies, no referrer, nothing about you.',
      onclick: () => SHD.update.check(),
      text: s.stale ? 'update?' : 'updates'
    });
  }

  /* ONE subscription for the life of the page, not one per header. The header is torn down
     and rebuilt on every route change and every re-render (see reset()), so a watcher
     registered inside the builder would leave a dead copy behind on each navigation and
     paint through a detached node. This one finds whatever control is on screen now, and
     does nothing when there is none. */
  SHD.update.onChange(() => {
    const host = document.querySelector('#shd-header .shd-update');
    if (host) host.replaceChildren(updateBody());
  });

  /**
   * The adult-thumbnail toggle, beside the theme buttons.
   *
   * It writes the same `showNsfwThumbnails` the options page writes, so the two surfaces
   * cannot disagree — there is one setting and two ways to reach it. Unlike a theme, this
   * one DOES cost a re-render: the placeholder tile and the picture are different markup,
   * not different paint, and rendering the picture and hiding it with CSS would fetch the
   * image we are declining to show (bug 41's whole point). pipeline.js's storage listener
   * handles that, and preserves scroll position across it.
   */
  function nsfwToggle() {
    const on = !!(SHD.settings && SHD.settings.showNsfwThumbnails);
    return h('button.shd-nsfw-btn', {
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      class: on ? 'selected' : null,
      title: on
        ? 'adult thumbnails are showing — click to replace them with placeholders'
        : 'adult thumbnails are hidden behind placeholders — click to show them',
      onclick: () => SHD.pipeline.setSetting('showNsfwThumbnails', !on)
    }, 'nsfw thumbnails');
  }

  /**
   * The theme switcher.
   *
   * One button per registered theme, rendered from SHD.theme.LIST so the bar cannot
   * disagree with the palettes — the same relationship the sort tabs have with route.SORTS,
   * and for the same reason: we shipped a tab once that routed somewhere we did not handle
   * (bug 10), and a button that paints nothing would be that bug in a new costume.
   *
   * A click repaints immediately and persists afterwards; it does NOT re-render the page.
   * See SHD.theme.apply() and the storage listener in pipeline.js.
   */
  function themeBar() {
    const active = SHD.theme.current();
    return h('div.shd-themebar', { role: 'group', 'aria-label': 'colour theme' }, [
      updateControl(),
      h('span.shd-themelabel', { text: 'theme:' }),
      ...SHD.theme.LIST.map(t => h('button.shd-theme-btn', {
        type: 'button',
        'data-theme': t.id,
        title: t.note,
        'aria-pressed': t.id === active ? 'true' : 'false',
        class: t.id === active ? 'selected' : null,
        onclick: () => SHD.theme.set(t.id)
      }, [
        h('span.shd-swatch', { 'aria-hidden': 'true' }),
        t.label
      ])),
      nsfwToggle()
    ]);
  }

  /** Sort tabs for listing pages; overview/comments/submitted on a profile. */
  function tabMenu() {
    if (SHD.route.current === SHD.route.PROFILE) return profileTabMenu();
    const sub = SHD.route.subredditOf();
    const active = SHD.route.sortOf();
    const base = sub ? `/r/${sub}` : '';
    return h('div.shd-tabmenu-wrap', null, [
      h('ul.tabmenu', null, SORTS.map(s =>
        h('li' + (s === active ? '.selected' : ''), null,
          h('a', { href: `${base}/${s}/`, text: s })))),
      timeMenu(base, active)
    ]);
  }

  /**
   * Old reddit's "links from:" window, on the two sorts that HAVE one.
   *
   * `top` and `controversial` rank over a period, and without this the reader is stuck
   * with whatever Reddit defaults to — the whole point of clicking `top` is usually to
   * ask "of what span". `hot`, `new` and `rising` ignore `t`, so offering it there would
   * be a control that changes nothing (bug 62's shape), which is why route.TIMED_SORTS
   * owns the answer rather than this function guessing.
   *
   * The current window comes from route.timeQuery — the EMITTED query, not
   * location.search — for the reason the comment sort strip does the same: during the
   * pre-commit window location still holds the URL the reader is leaving, so reading it
   * would bold the period they just navigated away from.
   *
   * When the URL carries no `t` at all, NOTHING is marked. That is deliberate: Reddit's
   * default window is unverified, and marking a guess would tell the reader they are
   * looking at a span they may not be.
   */
  function timeMenu(base, active) {
    if (!SHD.route.TIMED_SORTS.includes(active)) return null;
    const current = SHD.route.timeQuery;
    return h('div.shd-timemenu', null, [
      h('span.shd-timelabel', { text: 'links from: ' }),
      ...SHD.route.TIMES.flatMap((t, i) => {
        const el = t.id === current
          ? h('span.selected', { text: t.label })
          : h('a', { href: `${base}/${active}/?t=${t.id}`, text: t.label });
        return i ? [' | ', el] : [el];
      })
    ]);
  }

  /* route.js owns PROFILE_TABS the way it owns SORTS, and for the same reason: every href
     rendered here must classify back to PROFILE, or clicking our own tab drops the reader
     out of the extension (bug 10). run.js asserts it for these exactly as for the sorts. */
  function profileTabMenu() {
    const user = SHD.route.usernameOf();
    const active = SHD.route.profileTabOf();
    return h('div.shd-tabmenu-wrap', null,
      h('ul.tabmenu', null, SHD.route.PROFILE_TABS.map(t =>
        h('li' + (t.id === active ? '.selected' : ''), null,
          h('a', { href: `/user/${user}/${t.path}`, text: t.label })))));
  }

  /** Right rail. Populated from whatever the page already told us — no API. */
  function sidebar() {
    if (document.querySelector('#shd-sidebar')) return;
    const sub = SHD.route.subredditOf();
    const user = SHD.route.usernameOf();
    const root = document.querySelector('#shd-root');
    if (!root) return;
    const title = sub ? { href: `/r/${sub}/`, text: `r/${sub}` }
      : user ? { href: `/user/${user}/`, text: `u/${user}` }
      : { href: '/', text: 'front page' };
    /* The sidebar must start BELOW the blue tab bar: a float overlaps the background of
       any full-width block it sits beside, so prepending it as the first child of
       #shd-root painted the titlebox on top of .shd-tabmenu-wrap and the blue bar cut
       "r/<sub>" in half. Insert after the tab bar (before the content) instead. */
    const tabbar = root.querySelector('.shd-tabmenu-wrap');
    const rail =
      h('div#shd-sidebar.side', null, [
        h('div.spacer', null, [
          h('div.titlebox', null, [
            h('h1.redditname', null, h('a', title)),
            h('div.shd-note', { text: 'Rendered locally from page data. No API calls.' })
          ]),
          /* Old reddit's two submit buttons, under the title box. Only for a logged-in
             reader with the account layer on (account.js decides); a profile page gets
             the front page's door, which is where Reddit asks which community. */
          SHD.account.submitBox(sub)
        ])
      ]);
    if (tabbar) tabbar.after(rail);
    else root.prepend(rail);
  }

  /**
   * Route change. The header carries the current subreddit in its selected tab, so it has
   * to go too — leaving it in place meant navigating /r/aww → /r/programming kept showing
   * "r/aww". pipeline.js rebuilds both on the next flush.
   */
  function reset() {
    document.querySelector('#shd-sidebar')?.remove();
    document.querySelector('#shd-header')?.remove();
  }

  return { header, tabMenu, themeBar, nsfwToggle, timeMenu, updateControl, sidebar, reset };
})();
