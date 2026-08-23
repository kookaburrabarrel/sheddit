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
        themeBar()
      ])
    );
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
      ]))
    ]);
  }

  /** Sort tabs for listing pages; overview/comments/submitted on a profile. */
  function tabMenu() {
    if (SHD.route.current === SHD.route.PROFILE) return profileTabMenu();
    const sub = SHD.route.subredditOf();
    const active = SHD.route.sortOf();
    const base = sub ? `/r/${sub}` : '';
    return h('div.shd-tabmenu-wrap', null,
      h('ul.tabmenu', null, SORTS.map(s =>
        h('li' + (s === active ? '.selected' : ''), null,
          h('a', { href: `${base}/${s}/`, text: s })))));
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
    root.prepend(
      h('div#shd-sidebar.side', null, [
        h('div.spacer', null, [
          h('div.titlebox', null, [
            h('h1.redditname', null, h('a', title)),
            h('div.shd-note', { text: 'Rendered locally from page data. No API calls.' })
          ])
        ])
      ])
    );
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

  return { header, tabMenu, themeBar, sidebar, reset };
})();
