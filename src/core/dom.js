/**
 * dom.js — minimal DOM builder + formatters. No dependencies, no innerHTML with data.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.dom = (() => {
  /**
   * h('a.title', {href, target}, 'text' | node | [..])
   * Tag string supports .class and #id shorthand.
   */
  function h(tag, attrs, children) {
    const [name, ...rest] = tag.split(/(?=[.#])/);
    const el = document.createElement(name || 'div');

    for (const token of rest) {
      if (token[0] === '.') el.classList.add(token.slice(1));
      else if (token[0] === '#') el.id = token.slice(1);
    }

    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') { el.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
        else if (k === 'text') { el.textContent = v; }
        else if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2), v); }
        else if (k === 'dataset') { Object.assign(el.dataset, v); }
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }

    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children == null) return;
    if (Array.isArray(children)) { children.forEach(c => append(el, c)); return; }
    el.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  }

  /** 8364 -> "8364"; old reddit shows raw scores, but caps display width. */
  function score(n) {
    if (n == null || Number.isNaN(n)) return '•';
    return String(n);
  }

  /** ISO timestamp -> "6 hours ago" */
  function ago(iso) {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
    const units = [
      [31536000, 'year'], [2592000, 'month'], [604800, 'week'],
      [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']
    ];
    for (const [secs, label] of units) {
      if (s >= secs) {
        const n = Math.floor(s / secs);
        return `${n} ${label}${n === 1 ? '' : 's'} ago`;
      }
    }
    return 'just now';
  }

  /** "self.Layoffs" -> "self.Layoffs"; strips protocol from real domains. */
  function domain(d) { return (d || '').replace(/^www\./, ''); }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  /* ------------------------------------------------------------------ *
   * Cloned-body repair
   * ------------------------------------------------------------------ */

  /**
   * Swap a cloned body's <shreddit-player gif> for a plain <img> — bug 88.
   *
   * Cloned comment and selftext bodies keep their custom elements, and custom-element
   * upgrade is DOCUMENT-global — so the clone in our layout comes alive as Reddit's own
   * player and inherits its defect wholesale: the gif variant feeds a raw `.gif` URL to
   * a <video> (which cannot decode GIF — readyState 0 on 8 of 8 captured live) and,
   * carrying no poster, paints a solid black box where the picture should be. The
   * picture is sitting in the player's light-DOM <source> the whole time, and the
   * comment GIFs that already rendered fine on the same page were plain <img>s from the
   * same host — so degrade to that. A player with no resolvable source is left alone:
   * a black box beats silently deleting content someone wrote a comment around.
   *
   * SHD.C is read at CALL time, not load time — dom.js stays dependency-free at load,
   * and nothing calls this before boot.
   */
  function inlineGifs(root) {
    if (!root || !SHD.C || typeof root.querySelectorAll !== 'function') return root;
    root.querySelectorAll(SHD.C.GIF_PLAYER).forEach(p => {
      const src = p.querySelector('source')?.getAttribute('src') || p.getAttribute('src');
      if (!src) return;
      p.replaceWith(h('img.shd-comment-gif', { src, alt: '', loading: 'lazy' }));
    });
    return root;
  }

  /* ------------------------------------------------------------------ *
   * Shadow-piercing lookup
   * ------------------------------------------------------------------ */

  /**
   * querySelector that descends into OPEN shadow roots.
   *
   * Needed for vote delegation. The action bar hydrates inside a shreddit-async-loader,
   * and ARCHITECTURE §1.2 records that element as having a shadow root — so a plain
   * light-DOM querySelector may never find the native button no matter how long we wait.
   * A closed shadow root is unreachable by design; we return null and the caller reports.
   */
  function deepQuery(root, selector) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const el of root.querySelectorAll('*')) {
      if (!el.shadowRoot) continue;
      const hit = deepQuery(el.shadowRoot, selector);
      if (hit) return hit;
    }
    return null;
  }

  /** How many open shadow roots hang below `root`. Diagnostics only. */
  function shadowRoots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let n = 0;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) n += 1 + shadowRoots(el.shadowRoot);
    }
    return n;
  }

  /* ------------------------------------------------------------------ *
   * Native passthrough
   * ------------------------------------------------------------------ */

  const PASS = 'shd-passthrough';           // an ancestor on the path to the target
  const PASS_HIDE = 'shd-passthrough-hide'; // a sibling of that path
  const PASS_ROOT = 'shd-native-passthrough';
  const EXIT_ID = 'shd-passthrough-exit';

  /**
   * Reveal one native element in place, hiding everything else.
   *
   * suppress.css clips the DIRECT CHILD OF <body> (shreddit-app). clip-path and opacity
   * apply to the whole subtree, so tagging a deep descendant — which is what the first
   * cut did to the <shreddit-comment> — cannot un-hide it: the ancestor is still clipped
   * seven levels up.
   *
   * So we walk the path from the target to the body child, un-clip that body child, and
   * display:none every SIBLING along the way. Only the corridor down to the target
   * survives. #shd-root is hidden for the duration and restored by passthroughClear().
   */
  function passthrough(el) {
    passthroughClear();
    if (!el || !el.isConnected || el === document.body) return false;

    const chain = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) chain.push(n);
    const top = chain[chain.length - 1];
    if (!top || top.parentElement !== document.body) return false;

    for (const n of chain) {
      n.classList.add(n === top ? PASS_ROOT : PASS);
      // Body-level siblings are already suppressed by the base rule, and hiding them
      // here would take #shd-root with them.
      if (n === top) continue;
      for (const sib of n.parentElement.children) {
        if (sib !== n) sib.classList.add(PASS_HIDE);
      }
    }

    document.documentElement.classList.add('shd-passthrough-active');
    document.body.appendChild(h('div#' + EXIT_ID, null,
      h('a', { href: '#', text: '← back to sheddit',
               onclick: (e) => { e.preventDefault(); passthroughClear(); } })));
    return true;
  }

  /** Undo passthrough() and put our own layout back. */
  function passthroughClear() {
    for (const cls of [PASS, PASS_HIDE, PASS_ROOT]) {
      document.querySelectorAll('.' + cls).forEach(e => e.classList.remove(cls));
    }
    document.getElementById(EXIT_ID)?.remove();
    document.documentElement.classList.remove('shd-passthrough-active');
  }

  return { h, score, ago, domain, plural, inlineGifs,
           deepQuery, shadowRoots, passthrough, passthroughClear };
})();
