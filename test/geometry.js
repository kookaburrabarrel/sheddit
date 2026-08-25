#!/usr/bin/env node
/**
 * geometry.js — real layout assertions in a real engine.
 *
 * THE GAP THIS FILLS
 * jsdom does no layout, so test/run.js can prove the DOM is perfect while the page
 * renders wrong — that is not hypothetical, it happened. test/css-lint.js closes part of
 * the gap statically, but it reads one declaration at a time and cannot see what two
 * correct-looking rules do to each other once boxes are laid out.
 *
 * This file loads the REAL bundle over the REAL fixtures in headless Chromium and reads
 * getBoundingClientRect(). Two bugs invisible to both other suites turned up the first
 * time it ran:
 *
 *   1. #shd-sidebar's margin box was 338px against a 320px reserved gutter, so every row
 *      that vertically overlapped the sidebar was laid out 18px narrower than the rows
 *      below it — a stepped right edge that grows with sidebar height.
 *   2. The comment [–] toggle and the hover-revealed vote arrows were positioned at the
 *      same left offset and painted over each other.
 *
 * It also settles the staircase-indentation report that ARCHITECTURE could not
 * reproduce: row left offsets are measured directly, at ten widths.
 *
 *   node build.js && node test/geometry.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { POSTS, COMMENT_DEPTHS } = require('./fixtures');
const { requireChrome, makeChecker, serveFixtures, PATHS, LAUNCH_ARGS } = require('./harness');

const EXE = requireChrome('LAYOUT GEOMETRY');
const BUNDLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sheddit.dev.js'), 'utf8');
/* 500 is here because live testing could not drive Chrome below it and reported
   horizontal overflow at exactly that width — the one band between 480 and 640 nothing
   measured. It is measured now. */
const WIDTHS = [360, 480, 500, 640, 768, 900, 1024, 1100, 1280, 1440, 1920];

const { check, report } = makeChecker();
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * A solid-colour PNG of given size, built here so image tests have a picture with a real
 * INTRINSIC size without committing a binary or touching the network.
 *
 * Aborting image requests — which this suite does, to stay offline — leaves an <img> with
 * no intrinsic dimensions, and every "does the picture fit inside the row" assertion then
 * passes on a zero-sized box. That is a vacuous green, which is worse than no assertion:
 * it reads as coverage of exactly the overflow this section exists to catch.
 */
function png(width, height) {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit, truecolour RGB
  // One filter byte per scanline, then 3 bytes per pixel.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}
const TEST_PNG = png(1000, 750);

/** Load a fixture over a real URL, run the bundle on it, wait for our layout to exist. */
async function open(browser, origin, urlPath, waitFor, viewport, { images = false } = {}) {
  const page = await browser.newPage();
  // Settable before the bundle runs, because the paginator measures the page against the
  // viewport the moment it attaches — resizing afterwards would be measuring the wrong one.
  await page.setViewport(viewport || { width: 1280, height: 900 });
  // Fixture image URLs point at real Reddit hosts. Nothing here should touch the network:
  // block subresources so the run is offline and deterministic. Sections that measure a
  // picture opt in to a locally generated one instead — still offline, but with a real
  // intrinsic size, without which their assertions would measure a 0x0 box.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isNavigationRequest()) return req.continue();
    if (images && req.resourceType() === 'image') {
      return req.respond({ status: 200, contentType: 'image/png', body: TEST_PNG });
    }
    return req.abort();
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(origin + urlPath, { waitUntil: 'domcontentloaded' });
  await page.evaluate(BUNDLE);
  await page.waitForSelector(waitFor, { timeout: 10000 });
  return { page, pageErrors };
}

const overlaps = (a, b) =>
  !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

(async () => {
  const server = await serveFixtures();
  const origin = `http://127.0.0.1:${server.port}`;
  const browser = await puppeteer.launch({ executablePath: EXE, args: LAUNCH_ARGS });

  /* ================================================================== *
   * LISTING
   * ================================================================== */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — LISTING\x1b[0m');
  {
    const { page, pageErrors } = await open(browser, origin, PATHS.listing, '#shd-root .thing.link');

    // --- the staircase report: measure it instead of arguing about it ---
    const perWidth = [];
    for (const w of WIDTHS) {
      await page.setViewport({ width: w, height: 900 });
      perWidth.push({ w, ...await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#siteTable > .thing.link')];
        const rect = (e) => e.getBoundingClientRect();
        return {
          lefts: rows.map(e => Math.round(rect(e).left * 10) / 10),
          widths: rows.map(e => Math.round(rect(e).width * 10) / 10),
          hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })});
    }

    check('every row shares one left offset, at every width',
      perWidth.every(p => new Set(p.lefts).size === 1),
      perWidth.filter(p => new Set(p.lefts).size !== 1)
              .map(p => `w=${p.w} lefts=[${p.lefts}]`).join('; '));

    // The sidebar-gutter bug. Rows beside the sidebar were 18px narrower than rows below
    // it — invisible to css-lint, which never compares the float's margin box to the
    // gutter the content column reserves.
    check('every row shares one width, at every width (float gutter is correctly reserved)',
      perWidth.every(p => new Set(p.widths).size === 1),
      perWidth.filter(p => new Set(p.widths).size !== 1)
              .map(p => `w=${p.w} widths=[${[...new Set(p.widths)]}]`).join('; '));

    check('no horizontal page overflow at any width',
      perWidth.every(p => p.hOverflow <= 0),
      perWidth.filter(p => p.hOverflow > 0).map(p => `w=${p.w} +${p.hOverflow}px`).join('; '));

    // --- the float's margin box must fit the gutter it was given ---
    await page.setViewport({ width: 1280, height: 900 });
    const gutter = await page.evaluate(() => {
      const sb = document.querySelector('#shd-sidebar');
      const st = document.querySelector('#siteTable');
      const cs = getComputedStyle(sb);
      const marginBox = sb.getBoundingClientRect().width +
        parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
      return {
        marginBox: Math.round(marginBox * 10) / 10,
        reserved: parseFloat(getComputedStyle(st).marginRight),
        sidebarLeft: Math.round(sb.getBoundingClientRect().left * 10) / 10,
        contentRight: Math.round(st.getBoundingClientRect().right * 10) / 10
      };
    });
    check('sidebar margin box fits inside the reserved gutter',
      gutter.marginBox <= gutter.reserved,
      `margin box ${gutter.marginBox}px vs reserved ${gutter.reserved}px ` +
      `(intrudes ${r1(gutter.marginBox - gutter.reserved)}px)`);
    check('sidebar does not overhang the content column',
      gutter.sidebarLeft >= gutter.contentRight,
      `sidebar starts at ${gutter.sidebarLeft}, content ends at ${gutter.contentRight}`);

    // --- the absolutely-positioned columns must not collide with each other or the text ---
    const rows = await page.evaluate(() => {
      const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
                 width: r.width, height: r.height }; };
      return [...document.querySelectorAll('#siteTable > .thing.link')].map(row => ({
        id: row.dataset.fullname,
        row: box(row), rank: box(row.querySelector('.rank')),
        midcol: box(row.querySelector('.midcol')), score: box(row.querySelector('.midcol .score')),
        thumb: box(row.querySelector('.thumbnail')), entry: box(row.querySelector('.entry')),
        scoreLineHeight: parseFloat(getComputedStyle(row.querySelector('.midcol .score')).lineHeight) || 14
      }));
    });

    check('rank never overlaps midcol', rows.every(r => !overlaps(r.rank, r.midcol)),
      rows.filter(r => overlaps(r.rank, r.midcol)).map(r => r.id).join(', '));

    /* AND THEIR INK MUST NOT MEET, which the box test above cannot see.
       The two columns abutted exactly — 0..36 and 36..79 — so "do not overlap" was true
       while the live front page rendered rank 2 beside score 18586 as `218586` (live testing;
       four of them on one screen of /r/AmItheAsshole). The rank is right-aligned to its box
       edge and a 5-digit score nearly fills the midcol it is centred in, so the glyphs met
       with half a pixel between them. Measured with a Range over the text nodes, which is
       the actual painted extent rather than the box that contains it — the same reason
       css-lint's version of this rule derives the score's width instead of trusting the
       column's. t3_longtitle1 carries the 5-digit score that makes this reproduce. */
    const INK_GAP = 4;
    const ink = await page.evaluate(() => {
      const range = document.createRange();
      const extent = (el) => { range.selectNodeContents(el); return range.getBoundingClientRect(); };
      return [...document.querySelectorAll('#siteTable > .thing.link')].map(row => {
        const rank = row.querySelector('.rank');
        const score = row.querySelector('.midcol .score');
        return {
          id: row.dataset.fullname,
          rank: rank.textContent, score: score.textContent,
          gap: Math.round((extent(score).left - extent(rank).right) * 10) / 10
        };
      });
    });
    check(`the rank's ink and the score's ink keep >= ${INK_GAP}px of clear air`,
      ink.length > 0 && ink.every(r => r.gap >= INK_GAP),
      ink.filter(r => r.gap < INK_GAP)
         .map(r => `${r.id}: "${r.rank}" + "${r.score}" only ${r.gap}px apart`).join(', '));
    check('...and the row that reproduces it is on the page: a 5-digit score',
      ink.some(r => r.score.replace(/\D/g, '').length >= 5),
      ink.map(r => r.score).join(' '));
    check('midcol never overlaps the thumbnail',
      rows.every(r => !r.thumb || !overlaps(r.midcol, r.thumb)),
      rows.filter(r => r.thumb && overlaps(r.midcol, r.thumb)).map(r => r.id).join(', '));
    check('thumbnail never overlaps the entry text',
      rows.every(r => !r.thumb || !overlaps(r.thumb, r.entry)),
      rows.filter(r => r.thumb && overlaps(r.thumb, r.entry)).map(r => r.id).join(', '));
    check('every column stays inside its row',
      rows.every(r => r.rank.left >= r.row.left - 0.5 && r.entry.right <= r.row.right + 0.5),
      rows.filter(r => r.rank.left < r.row.left - 0.5 || r.entry.right > r.row.right + 0.5)
          .map(r => r.id).join(', '));

    // The 5-digit score that wrapped onto three lines. css-lint checks the declared width;
    // this checks the rendered box.
    check('a 5-digit score renders on ONE line',
      rows.every(r => r.score.height <= r.scoreLineHeight * 1.6),
      rows.filter(r => r.score.height > r.scoreLineHeight * 1.6)
          .map(r => `${r.id}: ${r1(r.score.height)}px`).join(', '));

    // --- the float actually stays inside its row (the geometric version of css-lint's rule) ---
    /* Old reddit's thumbnail is a 70x70 square. Ours has two kinds — an <img> and a
       generated-content placeholder — and only the placeholder carries a border, because
       without one it is three grey letters floating in the row. That makes box-sizing
       load-bearing: drop it and the bordered tiles become 72px while the images stay 70,
       so a mixed feed loses its baseline by 2px on every placeholder row. Measuring both
       kinds together is what catches that; measuring either alone cannot. */
    const thumbs = await page.evaluate(() => [...document.querySelectorAll('#shd-root .thumbnail')]
      .map(t => { const r = t.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), placeholder: !t.querySelector('img') }; }));
    check('the feed renders both an image thumbnail and a placeholder tile',
      thumbs.some(t => t.placeholder) && thumbs.some(t => !t.placeholder),
      `${thumbs.filter(t => t.placeholder).length} placeholders / ${thumbs.length} thumbnails`);
    check('every thumbnail is 70x70, placeholder or image alike',
      thumbs.length > 0 && thumbs.every(t => t.w === 70 && t.h === 70),
      thumbs.map(t => `${t.w}x${t.h}${t.placeholder ? '(tile)' : ''}`).join(' '));

    check('thumbnail float is contained by its row',
      rows.every(r => !r.thumb || r.thumb.bottom <= r.row.bottom + 0.5),
      rows.filter(r => r.thumb && r.thumb.bottom > r.row.bottom + 0.5)
          .map(r => `${r.id}: thumb ends ${r1(r.thumb.bottom - r.row.bottom)}px below its row`).join(', '));

    check('rows are laid out in rank order, top to bottom',
      rows.every((r, i) => i === 0 || r.row.top >= rows[i - 1].row.bottom - 0.5));
    check(`all ${POSTS.length} posts laid out`, rows.length === POSTS.length, `got ${rows.length}`);

    const sentinel = await page.evaluate(() => {
      const s = document.querySelector('.shd-sentinel');
      const st = document.querySelector('#siteTable');
      if (!s || !st) return null;
      return { right: s.getBoundingClientRect().right, contentRight: st.getBoundingClientRect().right };
    });
    check('pagination sentinel stays inside the content column',
      sentinel && sentinel.right <= sentinel.contentRight + 0.5,
      sentinel && `sentinel right ${r1(sentinel.right)} vs content right ${r1(sentinel.contentRight)}`);

    check('no page errors during listing layout', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
  }

  /* ================================================================== *
   * THE "N MORE REPLIES" LINE
   * ================================================================== */
  /**
   * It used to be an <li> between `permalink` and `reply`, which rendered
   * `permalink 1 more reply reply` — two reply-ish words running together as one broken
   * phrase. Old reddit gave it a line of its own at the bottom of the reply
   * list. That is a layout change, so it gets a layout test: the line is where it should
   * be, it is not sitting in the action row, and moving it did not push anything out of
   * its box.
   */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — THE MORE-REPLIES LINE\x1b[0m');
  {
    const { page, pageErrors } = await open(browser, origin, PATHS.commentBranches,
      '#shd-root .shd-more-replies');
    await page.setViewport({ width: 1280, height: 900 });
    const lines = await page.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height }; };
      return [...document.querySelectorAll('#shd-root .shd-more-replies')].map(line => {
        const row = line.closest('.thing.comment');
        const listing = line.parentElement;
        return {
          id: row.dataset.fullname,
          inActionRow: !!line.closest('.flat-list.buttons'),
          inReplyList: listing.classList.contains('sitetable') &&
                       !!listing.closest('.child'),
          isLast: listing.lastElementChild === line,
          line: box(line), row: box(row),
          tagline: box(row.querySelector(':scope > .entry > .tagline')),
          buttons: box(row.querySelector(':scope > .entry > .flat-list.buttons'))
        };
      });
    });
    check('a truncated branch draws the line', lines.length > 0, `${lines.length} found`);
    check('it is NOT an item in the action row', lines.every(l => !l.inActionRow),
      lines.filter(l => l.inActionRow).map(l => l.id).join(', '));
    check('it is the last thing in the branch\'s reply list',
      lines.every(l => l.inReplyList && l.isLast),
      lines.filter(l => !(l.inReplyList && l.isLast)).map(l => l.id).join(', '));
    check('it sits BELOW the action row it used to be inside',
      lines.every(l => l.line.top >= l.buttons.bottom - 0.5),
      lines.filter(l => l.line.top < l.buttons.bottom - 0.5).map(l => l.id).join(', '));
    check('it overlaps neither the tagline nor the action row',
      lines.every(l => !overlaps(l.line, l.tagline) && !overlaps(l.line, l.buttons)),
      lines.filter(l => overlaps(l.line, l.tagline) || overlaps(l.line, l.buttons))
           .map(l => l.id).join(', '));
    check('it stays inside its own comment row',
      lines.every(l => l.line.right <= l.row.right + 0.5 && l.line.left >= l.row.left - 0.5),
      lines.map(l => `${l.id}: ${r1(l.line.left)}..${r1(l.line.right)} in ` +
                     `${r1(l.row.left)}..${r1(l.row.right)}`).join('; '));
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal overflow on a thread full of branch expanders', overflow <= 0,
      `+${overflow}px`);
    check('no page errors on the branch-expander page', pageErrors.length === 0,
      pageErrors.join(' | '));
    await page.close();
  }

  /* ================================================================== *
   * ROW HEIGHT — what the 72px claim actually is
   * ================================================================== */
  /**
   * THE CLAIM THAT WAS NEVER TESTED. The README said rows are 72px tall in every theme and
   * that "the geometry suite pins them there"; nothing here measured a row's height at all.
   * Live testing measured the LIVE front page and got 26x72 + 1x77 + 1x117 in classic, and
   * 22x72 + 4x74 + 1x75 + 1x113 in carbon, whose monospace face is wider so titles that fit
   * elsewhere wrap here. On /r/todayilearned almost no row was 72px.
   *
   * The fixtures were the reason it looked fine: every title in POSTS fits on one or two
   * lines. So a pathological one was added (t3_longtitle1) and the invariant is now stated
   * as what it really is — a FLOOR with honest growth above it, not a fixed height:
   *
   *   1. Every row is at least 72px, in every theme. That is the thumbnail's margin box
   *      and it does not move.
   *   2. A row whose title fits on one line is EXACTLY 72px, in every theme. This is the
   *      part the README's density claim rests on and the part that genuinely holds.
   *   3. A row whose title does not fit GROWS, rather than clipping the title. That is a
   *      deliberate choice over truncation: a title is the whole content of a listing row,
   *      and this extension does not hide what it cannot fit — the same rule that keeps it
   *      from inventing a score it does not have.
   *   4. Growing never breaks the row: no horizontal overflow, nothing escapes its box, the
   *      thumbnail float stays contained, and an unbreakable 62-character token in the
   *      title cannot push the column past its own right edge.
   */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — ROW HEIGHT\x1b[0m');
  {
    const { page, pageErrors } = await open(browser, origin, PATHS.listing, '#shd-root .thing.link');
    const ids = await page.evaluate(() => SHD.theme.ids);
    const THUMB_FLOOR = 72;        // 70px tile + its 2px bottom margin

    const perTheme = {};
    for (const id of ids) {
      await page.evaluate((t) => SHD.theme.apply(t), id);
      for (const w of [640, 1024, 1280]) {
        await page.setViewport({ width: w, height: 900 });
        const m = await page.evaluate(() => {
          const de = document.documentElement;
          const rows = [...document.querySelectorAll('#siteTable > .thing.link')];
          return {
            hOverflow: de.scrollWidth - de.clientWidth,
            rows: rows.map(row => {
              const r = row.getBoundingClientRect();
              const title = row.querySelector('a.title');
              const tr = title.getBoundingClientRect();
              const thumb = row.querySelector('.thumbnail');
              const entry = row.querySelector('.entry').getBoundingClientRect();
              return {
                id: row.dataset.fullname,
                h: Math.round(r.height * 10) / 10,
                right: r.right,
                // How many line boxes the title occupies, from its own rendered metrics.
                lines: Math.round(tr.height / (parseFloat(getComputedStyle(title).lineHeight) || 18)),
                entryOverflows: entry.right > r.right + 0.5,
                thumbEscapes: !!thumb && thumb.getBoundingClientRect().bottom > r.bottom + 0.5
              };
            })
          };
        });
        if (w === 1280) perTheme[id] = m.rows;

        check(`${id} @${w}px: every row clears the 72px thumbnail floor`,
          m.rows.every(r => r.h >= THUMB_FLOOR - 0.5),
          m.rows.filter(r => r.h < THUMB_FLOOR - 0.5).map(r => `${r.id}=${r.h}px`).join(', '));
        check(`${id} @${w}px: a one-line title still gives exactly a ${THUMB_FLOOR}px row`,
          m.rows.filter(r => r.lines <= 1).every(r => Math.abs(r.h - THUMB_FLOOR) <= 0.5),
          m.rows.filter(r => r.lines <= 1 && Math.abs(r.h - THUMB_FLOOR) > 0.5)
                .map(r => `${r.id}=${r.h}px`).join(', '));
        /* The long title is what makes these two worth running at all — an unbreakable
           62-character token is the one thing a wrapping algorithm cannot help with. */
        check(`${id} @${w}px: no horizontal overflow with a pathological title on the page`,
          m.hOverflow <= 0, `+${m.hOverflow}px`);
        check(`${id} @${w}px: no row's text escapes its own box`,
          m.rows.every(r => !r.entryOverflows),
          m.rows.filter(r => r.entryOverflows).map(r => r.id).join(', '));
        check(`${id} @${w}px: the thumbnail float stays contained even in a grown row`,
          m.rows.every(r => !r.thumbEscapes),
          m.rows.filter(r => r.thumbEscapes).map(r => r.id).join(', '));
      }
    }

    /* And the fixture has to actually BE pathological, or every check above passes for the
       reason the old suite passed: because nothing on the page wrapped. Carbon is named
       explicitly — its monospace face is wider, so it is the theme that wraps first and the
       one live testing found drifting on six rows rather than one. */
    const longRow = (id) => perTheme[id].find(r => r.id === 't3_longtitle1');
    check('the long-title fixture wraps past one line in EVERY theme',
      ids.every(id => longRow(id) && longRow(id).lines >= 2),
      ids.map(id => `${id}=${longRow(id)?.lines} lines`).join(' '));
    check('...and its row grows to fit rather than clipping the title',
      ids.every(id => longRow(id).h > THUMB_FLOOR),
      ids.map(id => `${id}=${longRow(id).h}px`).join(' '));
    check('carbon wraps at least as much as classic — the wider face is covered, not assumed',
      longRow('carbon').lines >= longRow('classic').lines,
      `carbon=${longRow('carbon').lines} classic=${longRow('classic').lines}`);

    check('no page errors during row-height layout', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
  }

  /* ================================================================== *
   * COMMENTS
   * ================================================================== */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — COMMENTS\x1b[0m');
  {
    const { page, pageErrors } = await open(browser, origin, PATHS.comments, '#shd-root .thing.comment');
    await page.setViewport({ width: 1280, height: 900 });

    const indent = await page.evaluate(() => {
      const byDepth = {};
      for (const c of document.querySelectorAll('.thing.comment')) {
        (byDepth[c.dataset.depth] ||= new Set()).add(Math.round(c.getBoundingClientRect().left * 10) / 10);
      }
      return Object.fromEntries(Object.entries(byDepth).map(([k, v]) => [k, [...v]]));
    });
    const depths = Object.keys(indent).map(Number).sort((a, b) => a - b);

    check('every comment at a given depth shares one left offset',
      depths.every(d => indent[d].length === 1),
      depths.filter(d => indent[d].length !== 1).map(d => `depth ${d}: [${indent[d]}]`).join('; '));
    check('indentation increases strictly with depth',
      depths.every((d, i) => i === 0 || indent[d][0] > indent[depths[i - 1]][0]),
      JSON.stringify(indent));
    const steps = depths.slice(1).map((d, i) => r1(indent[d][0] - indent[depths[i]][0]));
    check('the indent step is uniform at every level', new Set(steps).size === 1, `steps: [${steps}]`);
    check('every declared depth is represented',
      depths.length === new Set(COMMENT_DEPTHS).size,
      `laid out ${depths.length}, fixture declares ${new Set(COMMENT_DEPTHS).size}`);

    /* Old reddit's per-level indent measures 25px — .child's 15px margin plus its 1px
       border plus .comment's own 9px margin. Pinned rather than left as "uniform" because
       uniform was already true when it was 31px: the arrow gutter was padding on
       .thing.comment, so every level inherited it and added it again. A uniform-only check
       cannot tell those two apart. */
    check('the indent step matches old reddit at 25px', steps.every(s => s === 25),
      `steps: [${steps}]`);

    /* Measured BEFORE the hover below. The arrows used to be display:none until :hover, so
       asserting visibility after hovering passed either way — this is the control that
       makes the assertion mean something. */
    const restShown = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#shd-root .thing.comment > .midcol')).display !== 'none');
    check('comment vote arrows are visible without hovering', restShown);

    /* Cloned bodies wear Reddit's classes, and the fixture now serves the leaking rules
       Reddit's page stylesheet is known to apply to them (#reddit-page-css) — including
       the near-white text color that shipped as "very hard to read on the light themes".
       Only a real browser computing real styles can check who wins. The control asserts
       the hostile sheet genuinely targets the clone; without it, deleting the fixture's
       style block would green these for the wrong reason. */
    const bodyColors = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'md';
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const hostile = getComputedStyle(probe).color;
      probe.remove();
      const c = document.querySelector('#shd-root .thing.comment .usertext-body');
      const p = c.querySelector('p') || c;
      return { hostile, body: getComputedStyle(p).color };
    });
    check('control: the fixture\'s hostile page CSS is live',
      bodyColors.hostile === 'rgb(226, 226, 232)', bodyColors.hostile);
    check('comment body text wears OUR palette, not Reddit\'s theme color',
      bodyColors.body === 'rgb(0, 0, 0)',
      `computed ${bodyColors.body} — Reddit's page stylesheet is restyling the clone (open question 7)`);

    // --- the [–] / vote-arrow collision, measured under a REAL :hover ---
    await page.hover('#shd-root .thing.comment');
    const controls = await page.evaluate(() => {
      const c = document.querySelector('#shd-root .thing.comment');
      const box = (s) => { const e = c.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };
      const mc = c.querySelector(':scope > .midcol');
      return {
        midcolShown: getComputedStyle(mc).display !== 'none',
        expand: box('.expand'), up: box(':scope > .midcol .arrow.up'),
        down: box(':scope > .midcol .arrow.down'), midcol: box(':scope > .midcol'),
        tagline: box('.tagline'), body: box('.usertext-body')
      };
    });

    check('a comment keeps its vote arrows under :hover too', controls.midcolShown);
    check('the [–] toggle does not overlap the up arrow',
      !overlaps(controls.expand, controls.up),
      `expand ${r1(controls.expand.left)}–${r1(controls.expand.right)}, ` +
      `up ${r1(controls.up.left)}–${r1(controls.up.right)}`);
    check('the [–] toggle does not overlap the down arrow',
      !overlaps(controls.expand, controls.down));
    check('the vote arrows do not overlap the tagline text',
      !overlaps(controls.midcol, controls.tagline),
      `midcol ends at ${r1(controls.midcol.right)}, tagline starts at ${r1(controls.tagline.left)}`);
    check('the [–] toggle is inside the tagline, where old reddit puts it',
      controls.expand.left >= controls.tagline.left - 0.5 &&
      controls.expand.top >= controls.tagline.top - 0.5);

    // --- the toggle must actually receive its own clicks ---
    const hit = await page.evaluate(() => {
      const e = document.querySelector('#shd-root .thing.comment .expand');
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return top === e || e.contains(top);
    });
    check('the [–] toggle is the topmost element at its own centre', hit);

    /**
     * Report WHICH element sticks out, not just by how much.
     *
     * "+11px" was the entire failure message when this fired on a machine with different
     * fonts installed, and turning that into a cause cost a round trip. The offending
     * elements are right there in the DOM at the moment of failure; print them.
     */
    const overflowOf = () => page.evaluate(() => {
      const de = document.documentElement;
      const cw = de.clientWidth;
      const offenders = [];
      for (const el of document.querySelectorAll('#shd-root *, #shd-header *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > cw + 0.5) {
          offenders.push(el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') +
            `@${Math.round(r.right)}`);
        }
      }
      return { over: de.scrollWidth - cw, offenders: [...new Set(offenders)].slice(0, 5) };
    });

    for (const w of [360, 768, 1280]) {
      await page.setViewport({ width: w, height: 900 });
      const { over: o, offenders } = await overflowOf();
      check(`comments page has no horizontal overflow at ${w}px`, o <= 0,
        `+${o}px, viewport ${w}px — overflowing: ${offenders.join(', ') || '(none identified)'}`);
    }

    /**
     * TRIED AND DELIBERATELY NOT KEPT: simulating Verdana with `font-size`/`letter-spacing`
     * scaling on a machine that does not have it installed.
     *
     * The real failure (docs/engineering-log.md, this session) was 11px of overflow on a Mac with Verdana
     * present, invisible here because the fallback font is narrower. The natural fix looked
     * like "scale the type up to approximate that" — it does not work. `.flat-list.buttons`
     * is a flex row with no explicit item widths, so a flex item's default `min-width: auto`
     * lets its OWN text wrap onto a second line and the item shrink to fit, rather than
     * forcing the row wider. Result: font-size at 115% produced zero overflow, 112% and 150%
     * produced very different amounts, and letter-spacing up to 8px produced none at all —
     * non-monotonic and mechanism-dependent, not a stand-in for a wider font. Shipping that
     * would be exactly the "looks like proof, proves nothing" trap this file warns about
     * elsewhere: it can pass when the bug is present and there is no way to tell from a
     * green run.
     *
     * The actual guard for "a flex row can overflow a narrow viewport" is the static rule in
     * css-lint.js (`every display:flex declares flex-wrap`), which does not depend on which
     * fonts happen to be installed on the machine running the suite.
     */

    /* --- native passthrough: the reply handoff, proven in a real engine ---
     * The old implementation tagged the <shreddit-comment> itself while the clip lived on
     * <shreddit-app> seven levels up, so nothing became visible. Only layout can show
     * that; jsdom would happily confirm the class was applied.
     */
    await page.setViewport({ width: 1280, height: 900 });
    // NB: clip-path and opacity do not change the layout box, so getBoundingClientRect()
    // still reports a height for a suppressed element. Visibility has to be read from
    // checkVisibility() (which accounts for an opacity:0 ancestor) plus a hit test
    // (which accounts for clip-path).
    const nativeProbe = () => {
      const src = document.querySelector('shreddit-comment');
      const r = src.getBoundingClientRect();
      const centre = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return {
        width: Math.round(r.width), height: Math.round(r.height),
        painted: src.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        hit: !!centre && src.contains(centre),
        rootVisible: getComputedStyle(document.querySelector('#shd-root')).display !== 'none'
      };
    };

    const before = await page.evaluate(nativeProbe);
    check('before handoff: our layout is visible and the native comment is not',
      before.rootVisible && !before.painted && !before.hit, JSON.stringify(before));

    await page.click('#shd-root .thing.comment a.reply');
    const after = await page.evaluate((probe) => {
      const app = document.querySelector('shreddit-app');
      const sibling = document.querySelector('shreddit-comment:nth-of-type(2)');
      return {
        ...eval('(' + probe + ')')(),
        appClip: getComputedStyle(app).clipPath, appOpacity: getComputedStyle(app).opacity,
        siblingHidden: !sibling || getComputedStyle(sibling).display === 'none',
        exitVisible: !!document.querySelector('#shd-passthrough-exit') &&
                     document.querySelector('#shd-passthrough-exit').getBoundingClientRect().height > 0
      };
    }, nativeProbe.toString());

    check('handoff un-clips the ancestor that actually carries the clip',
      after.appClip === 'none' && after.appOpacity === '1',
      `clip-path: ${after.appClip}, opacity: ${after.appOpacity}`);
    check('handoff makes the native comment genuinely visible',
      after.painted && after.hit && after.width > 50,
      JSON.stringify(after));
    check('handoff hides our own layout', !after.rootVisible);
    check('handoff hides the comments the user did not ask for',
      after.siblingHidden, 'a sibling comment is still on screen');
    check('handoff offers a way back', after.exitVisible);

    await page.click('#shd-passthrough-exit a');
    const restored = await page.evaluate((probe) => ({
      ...eval('(' + probe + ')')(),
      exitGone: !document.querySelector('#shd-passthrough-exit')
    }), nativeProbe.toString());
    check('leaving the handoff restores our layout and re-hides native Reddit',
      restored.rootVisible && !restored.painted && !restored.hit && restored.exitGone,
      JSON.stringify(restored));

    check('no page errors during comments layout', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
  }

  /* ================================================================== *
   * THEMES
   *
   * css-lint checks that a theme declares the right tokens; only a real engine can say
   * what those tokens DO. Two things are worth measuring here and nowhere else:
   *
   *   1. Every theme has to survive a 360px viewport. Themes change the font stack —
   *      sepia is serif, carbon is monospace — and different glyph metrics at a narrow
   *      width is precisely the mechanism behind bug 31, which shipped because the suite
   *      ran a font the reporter did not have. Running every theme at 360px is the closest
   *      this machine can get to that, and unlike the font-size scaling tried above it is
   *      a real difference in metrics rather than a simulation of one.
   *   2. The layout must not move. A theme is paint; if switching one shifts a row by a
   *      pixel, a token has escaped into geometry.
   * ================================================================== */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — THEMES\x1b[0m');
  {
    const { page, pageErrors } = await open(browser, origin, PATHS.listing, '#shd-root .thing.link');
    const ids = await page.evaluate(() => SHD.theme.ids);
    check('the bundle registers more than one theme', ids.length > 1, ids.join(','));

    const measure = () => page.evaluate(() => {
      const de = document.documentElement;
      const rows = [...document.querySelectorAll('#siteTable > .thing.link')];
      const rect = (e) => e.getBoundingClientRect();
      const title = document.querySelector('#shd-root a.title');
      return {
        lefts: [...new Set(rows.map(e => Math.round(rect(e).left * 10) / 10))],
        widths: [...new Set(rows.map(e => Math.round(rect(e).width * 10) / 10))],
        hOverflow: de.scrollWidth - de.clientWidth,
        pageBg: getComputedStyle(document.body).backgroundColor,
        titleColor: title ? getComputedStyle(title).color : null,
        font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, '')
      };
    });

    const seen = {};
    for (const id of ids) {
      await page.evaluate((t) => SHD.theme.apply(t), id);
      for (const w of [360, 1280]) {
        await page.setViewport({ width: w, height: 900 });
        const m = await measure();
        if (w === 1280) seen[id] = m;
        check(`${id} has no horizontal overflow at ${w}px`, m.hOverflow <= 0,
          `+${m.hOverflow}px — this theme's font is ${m.font}`);
        check(`${id} keeps every row on one left offset at ${w}px`, m.lefts.length === 1,
          `lefts: [${m.lefts}]`);
        check(`${id} keeps every row one width at ${w}px`, m.widths.length === 1,
          `widths: [${m.widths}]`);
      }
    }

    // Paint changed, layout did not. Both halves matter: identical colours would mean the
    // palette never arrived, and different geometry would mean a theme touched the metrics.
    const bgs = new Set(ids.map(id => seen[id].pageBg));
    check('every theme paints a different page background', bgs.size === ids.length,
      [...bgs].join(' | '));
    check('every theme paints its own link colour',
      new Set(ids.map(id => seen[id].titleColor)).size === ids.length,
      ids.map(id => `${id}=${seen[id].titleColor}`).join(' '));
    check('no theme moves a row',
      new Set(ids.map(id => `${seen[id].lefts}|${seen[id].widths}`)).size === 1,
      ids.map(id => `${id}: ${seen[id].lefts}/${seen[id].widths}`).join(' '));

    // The blackout is themed too. This is the flash the whole document_start dance exists
    // to prevent: with nothing declared on <html>, a dark theme opened on a white page.
    await page.evaluate(() => SHD.theme.apply('night'));
    const blank = await page.evaluate(() => {
      // .shd-active has to come OFF. The blackout is the state before we have rendered
      // anything, and old-reddit.css paints <html> once we are active — leaving that class
      // on made this assertion pass with the blackout rule deleted, because the active
      // background happens to be the same colour. Green for the wrong reason is worse than
      // red: reproduce the real pre-render state instead.
      const cl = document.documentElement.classList;
      cl.remove('shd-active');
      cl.add('shd-gate');
      const bg = getComputedStyle(document.documentElement).backgroundColor;
      cl.remove('shd-gate');
      cl.add('shd-active');
      return bg;
    });
    check('the pre-render blackout takes the theme\'s colour, not white',
      blank === 'rgb(15, 17, 21)', `html background while blanked: ${blank}`);

    // And the button is genuinely clickable — not covered by a header sibling, not zero-sized.
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluate(() => SHD.theme.apply('classic'));
    await page.click('.shd-theme-btn[data-theme="sepia"]');
    const afterClick = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-shd-theme'),
      bg: getComputedStyle(document.body).backgroundColor
    }));
    check('clicking a theme button in a real engine repaints the page',
      afterClick.theme === 'sepia' && afterClick.bg === 'rgb(232, 223, 204)',
      JSON.stringify(afterClick));

    check('no page errors during theme switching', pageErrors.length === 0, pageErrors.join(' | '));
    await page.close();
  }

  /* ================================================================== *
   * IMAGES
   * ================================================================== */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — IMAGES\x1b[0m');
  {
    /* A picture is the one thing in this layout whose size the page does not control: the
       file arrives at whatever dimensions Reddit stored it at, and a 4000px-wide photo will
       widen the column, overflow the row and push the whole document sideways unless it is
       capped. jsdom cannot see any of that. */
    const { page, pageErrors } = await open(browser, origin, PATHS.imageComments,
      '#shd-root .shd-selfpost', undefined, { images: true });
    await page.evaluate(() => Promise.all(
      [...document.images].map(i => i.complete ? null : new Promise(r => {
        i.addEventListener('load', r); i.addEventListener('error', r);
      }))));

    const box = await page.$eval('.shd-selfpost .shd-image img',
      n => { const r = n.getBoundingClientRect(); return { w: r.width, right: r.right }; });
    const cap = await page.evaluate(() => parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--shd-video-max')));
    check('the comments-page picture is capped at the expando width',
      box.w > 0 && box.w <= cap + 1, `${Math.round(box.w)}px against a ${cap}px cap`);

    const doc = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    check('...and the page does not scroll sideways because of it',
      doc.scrollW <= doc.clientW + 1, JSON.stringify(doc));

    // Narrow: the cap is a ceiling, not a width. A phone-width window must shrink it
    // rather than keep 640px and overflow.
    await page.setViewport({ width: 360, height: 900 });
    const narrow = await page.evaluate(() => ({
      img: document.querySelector('.shd-selfpost .shd-image img').getBoundingClientRect().width,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    check('at 360px the picture shrinks to fit instead of overflowing',
      narrow.img <= narrow.clientW && narrow.scrollW <= narrow.clientW + 1,
      JSON.stringify(narrow));
    check('no page errors on an image submission', pageErrors.length === 0,
      pageErrors.join(' | '));
    await page.close();

    /* The expando on a listing row. Two floats now sit in front of the entry — the
       thumbnail and the control — and an opened picture must clear both rather than
       wrapping around them (bug 4's rule, one element on). */
    const listing = await open(browser, origin, PATHS.listing, '#shd-root .thing.link',
      undefined, { images: true });
    const sel = '.thing[data-fullname="t3_image1"]';
    const before = await listing.page.$eval(sel, n => n.getBoundingClientRect().height);
    const rects = await listing.page.$eval(sel, n => {
      const t = n.querySelector('.thumbnail')?.getBoundingClientRect();
      const b = n.querySelector('.expando-button').getBoundingClientRect();
      return { t: t && { l: t.left, r: t.right }, b: { l: b.left, r: b.right, w: b.width } };
    });
    check('the expando control has a real box', rects.b.w > 0, JSON.stringify(rects.b));
    check('...and does not sit on top of the thumbnail',
      !rects.t || rects.b.l >= rects.t.r || rects.b.r <= rects.t.l,
      JSON.stringify(rects));

    await listing.page.click(`${sel} .expando-button`);
    await listing.page.evaluate((s) => {
      const i = document.querySelector(`${s} .expando img`);
      return i && !i.complete
        ? new Promise(r => { i.addEventListener('load', r); i.addEventListener('error', r); })
        : null;
    }, sel);
    const after = await listing.page.evaluate((s) => {
      const row = document.querySelector(s);
      const img = row.querySelector('.expando img');
      return {
        rowH: row.getBoundingClientRect().height,
        imgRight: img ? img.getBoundingClientRect().right : null,
        rowRight: row.getBoundingClientRect().right,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      };
    }, sel);
    check('opening the expando grows the row', after.rowH > before,
      `${Math.round(before)} -> ${Math.round(after.rowH)}`);
    check('...with the picture inside the row, not spilling past it',
      after.imgRight !== null && after.imgRight <= after.rowRight + 1, JSON.stringify(after));
    check('...and still no sideways scroll',
      after.scrollW <= after.clientW + 1, JSON.stringify(after));

    // The [-]: reported from a real machine as doing nothing, and it was CSS, not the
    // toggle — `.expando` declares `display`, and any author display declaration beats
    // the UA's `[hidden] { display: none }`, so the collapsed box kept its layout in
    // every real browser. jsdom checks the attribute and cannot see this; asserting the
    // GROWTH above without asserting the shrink is exactly the half-test that let it
    // ship. Computed display is checked alongside the height so a future rhythm change
    // cannot turn the height comparison vacuous.
    await listing.page.click(`${sel} .expando-button`);
    const closed = await listing.page.evaluate((s) => {
      const row = document.querySelector(s);
      return {
        rowH: row.getBoundingClientRect().height,
        boxDisplay: getComputedStyle(row.querySelector('.expando')).display,
        stillHasImg: !!row.querySelector('.expando img')
      };
    }, sel);
    check('collapsing the expando actually removes the picture from layout',
      closed.boxDisplay === 'none', `computed display=${closed.boxDisplay} — [hidden] is losing ` +
      `to .expando's own display declaration`);
    check('...and the row returns to its original height',
      Math.abs(closed.rowH - before) < 1, `${Math.round(before)} -> ${Math.round(closed.rowH)}`);
    check('...while the fetched picture stays cached in the box for the next open',
      closed.stillHasImg === true);

    check('no page errors from the expando', listing.pageErrors.length === 0,
      listing.pageErrors.join(' | '));
    await listing.page.close();
  }

  /* ================================================================== *
   * THE UNPROMPTED FILL
   * ================================================================== */
  console.log('\n\x1b[1mLAYOUT GEOMETRY — THE UNPROMPTED FILL\x1b[0m');
  {
    /* A page nobody has touched fills until it is worth scrolling, and then waits. Two
       independent reports of the same failure: opening a comments page locked the tab for
       30+ seconds, and a [-] collapse did the same, both of them this chain running at
       rest until it hit a cap.

       The stopping point is FILL_VIEWPORTS, measured against real document height, and
       this is the ONLY suite that can see it — jsdom does no layout and reports
       scrollHeight 0, so run.js can exercise the attempt bound and nothing else.

       The fixture is held constant and the VIEWPORT is varied, which isolates the
       measurement: identical content and identical rows, differing only in whether the
       document clears two screens. */
    const settle = async (p) => { await p.evaluate(() => new Promise(r => setTimeout(r, 2600))); };
    const rows = (p) => p.$$eval('#shd-root .thing.link', n => n.length);

    // Short viewport: the delivered posts already clear two screens, so there is nothing
    // worth filling and the chain must not spend a load.
    const tallEnough = await open(browser, origin, PATHS.pager, '#shd-root .thing.link',
      { width: 1280, height: 200 });
    const startShort = await rows(tallEnough.page);
    // Control: the premise. If the fixture did NOT clear two screens this proves nothing,
    // because parking would be the wrong behaviour rather than the right one.
    const geom = await tallEnough.page.evaluate(() => ({
      pageHeight: document.documentElement.scrollHeight, viewport: innerHeight
    }));
    check('control: the page really is taller than two screens at this viewport',
      geom.pageHeight >= geom.viewport * 2, JSON.stringify(geom));
    await settle(tallEnough.page);
    check('a page already worth scrolling does not auto-load anything',
      await rows(tallEnough.page) === startShort,
      `${startShort} -> ${await rows(tallEnough.page)} rows with no interaction`);
    check('...and says why on the sentinel',
      await tallEnough.page.$eval('.shd-sentinel', n => n.dataset.shdFilled) === 'true');
    // The release, measured in a real engine: scrolling is what turns the fill back on.
    await tallEnough.page.evaluate(() => { scrollTo(0, 1); dispatchEvent(new Event('scroll')); });
    await settle(tallEnough.page);
    check('...until the reader scrolls, and then it loads',
      await rows(tallEnough.page) > startShort,
      `${startShort} -> ${await rows(tallEnough.page)} rows after a scroll`);
    check('no page errors during the fill', tallEnough.pageErrors.length === 0,
      tallEnough.pageErrors.join(' | '));
    await tallEnough.page.close();

    /* The counterweight, and the reason this cannot simply be "never load until scrolled":
       a listing ships three posts and is unusable without a fill, and three rows do not
       make a scrollable page — there is no gesture to wait for. Same fixture, a viewport
       tall enough that the content does NOT clear two screens. */
    const tooShort = await open(browser, origin, PATHS.pager, '#shd-root .thing.link',
      { width: 1280, height: 2000 });
    const startTall = await rows(tooShort.page);
    await settle(tooShort.page);
    check('a page that does not fill the window loads without being asked',
      await rows(tooShort.page) > startTall,
      `${startTall} -> ${await rows(tooShort.page)} rows, untouched`);
    await tooShort.page.close();
  }

  await browser.close();
  await server.close();
  report();
})().catch((e) => { console.error(e); process.exit(1); });
