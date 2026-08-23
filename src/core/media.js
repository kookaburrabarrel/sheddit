/**
 * media.js — resolves a v.redd.it asset to a playable file, by reading Reddit's manifest.
 *
 * WHY THIS EXISTS. Reddit is repackaging video from legacy progressive renditions
 * (`DASH_720.mp4`, and the `m2-res_<h>p.mp4` files in `packaged-media-json`) to CMAF. On a
 * repackaged asset the legacy files 403 and only `CMAF_<n>.mp4` serves, so `model.mp4Of()`
 * resolves null, and before this module a video post degraded to a link and a thumbnail
 * with nothing to play. That is the reported bug, measured on `v.redd.it/nzafnbgwcxkh1`:
 * every `DASH_*` 403, every `CMAF_*` 200, and no combined rendition anywhere.
 *
 * WHY A MANIFEST READ AND NOT A CONSTRUCTED NAME. The rungs of the ladder are Reddit's
 * encoding choices, not the source's dimensions. That asset has 96/220/270/360/480 and no
 * 720 or 1080 — probed, not guessed — because the source is a 480x854 phone video. So
 * `CMAF_720.mp4` is the `DASH_720.mp4` mistake with a new prefix: a name that is right
 * often enough to look correct and wrong often enough to break. `DASHPlaylist.mpd` states
 * every rendition WITH its exact width and height, in ~3 KB, and it answers for legacy and
 * CMAF assets alike because it is the same manifest either way.
 *
 * Nor can the file tell us its own name: reading `moov` for dimensions requires already
 * having fetched the file, which requires already knowing the name. The manifest is the
 * only thing that breaks that circle without guessing.
 *
 * THE ONE REQUEST. This module contains the extension's only `fetch`. It is a GET of a
 * static XML file from a CDN — no endpoint, no API, no credentials, no cookies
 * (`credentials: 'omit'`), and it happens only when a reader opens a video post's comments
 * page with `inlineVideo` on. `v.redd.it` answers it with `access-control-allow-origin: *`,
 * which is why no new host permission is needed. PRIVACY.md documents it; before 0.16.0
 * the extension made no requests at all, and that change is deliberate, not incidental.
 *
 * SOUND. CMAF splits video and audio into separate files and offers no combined rendition,
 * so the manifest is read for BOTH and the two are played together as a pair — see pair()
 * below, and test/media-sync.js, which proves in a real browser that they stay together.
 * An asset whose manifest lists no audio at all is genuinely silent, and comments.js says
 * so on screen rather than letting a reader conclude their sound is broken.
 */
globalThis.SHD = globalThis.SHD || {};

SHD.media = (() => {
  const C = SHD.C;

  /* Resolutions in flight or already made, keyed by asset base. An asset is immutable, so
     a second post of the same video costs nothing — but this is MEMORY ONLY and dies with
     the page. Reddit's media URLs carry a signature and a ~12h expiry (see C.POST_VIDEO_JSON),
     and a cache that outlived the tab would hand back a dead URL as confidently as a live
     one. */
  const inflight = new Map();

  /** How long to wait before giving up. A player that never appears beats a page that hangs. */
  const TIMEOUT_MS = 6000;

  /* The width of the box the player sits in — --shd-video-max in old-reddit.css, repeated
     here because a stylesheet is not readable from script and a rendition taller than the
     box is bandwidth spent on pixels nobody sees.
     WIDTH, not height, and that distinction matters on exactly the asset that prompted
     this module: it is a 480x854 phone video, so every rendition is TALLER than a 720
     ceiling would allow while all of them are narrower than the box. A height rule would
     have thrown away every rung and fallen back to the smallest, i.e. served 220x392 for a
     video that had a perfectly good 480 available. */
  const BOX_WIDTH = 640;

  /**
   * The asset root for a video post, or null.
   *
   * `content-href` is the source: it is a bare `https://v.redd.it/<id>` on video posts, it
   * is an ATTRIBUTE on `<shreddit-post>` rather than on the late-hydrating player, so it is
   * there at first paint — and it is the URL whose logged-out 302 back to the comments page
   * is the loop this extension has been working around since live testing. The redirect makes it
   * useless as a link and perfectly good as an identifier.
   */
  function assetBase(m) {
    const hit = C.VIDEO_ASSET.exec((m && m.contentHref) || '');
    return hit ? `https://v.redd.it/${hit[1]}` : null;
  }

  /**
   * Pick a rendition out of a parsed MPD.
   *
   * Reads `width`/`height` off the Representation, which is where the manifest states them,
   * and takes the BaseURL as written — relative to the asset root, which is how DASH
   * on-demand profiles address a self-contained file. Anything missing a BaseURL or a
   * usable height is skipped rather than guessed at.
   */
  function pickRendition(doc, base) {
    const reps = [...doc.querySelectorAll('Representation')].map(r => {
      const set = r.closest('AdaptationSet');
      const mime = r.getAttribute('mimeType') || (set && set.getAttribute('mimeType')) || '';
      const kind = (set && set.getAttribute('contentType')) || mime.split('/')[0] || '';
      const file = (r.querySelector('BaseURL') || {}).textContent;
      const height = Number(r.getAttribute('height'));
      const width = Number(r.getAttribute('width'));
      return { kind, file: (file || '').trim(), height, width };
    }).filter(r => r.file);

    const video = reps.filter(r => r.kind === 'video' && isFinite(r.height) && r.height > 0);
    const audio = reps.filter(r => r.kind === 'audio');
    if (!video.length) return null;

    /* Smallest rendition that still fills the box, else the largest there is. The usual
       adaptive rule, with the ladder standing in for a bandwidth estimate we do not have.
       On a HiDPI display this is softer than the panel could show — a deliberate trade
       against downloading four times the bytes for a 640px box, and a reader who wants the
       full rendition still has `watch` and the permalink. */
    const byWidth = [...video].sort((a, b) => (a.width || 0) - (b.width || 0));
    const best = byWidth.find(r => (r.width || 0) >= BOX_WIDTH) || byWidth[byWidth.length - 1];
    /* The loudest audio rung, for whoever implements MediaSource. Unused by the player
       today and deliberately still resolved — see the header. */
    const sound = audio.length ? audio[audio.length - 1] : null;

    return {
      url: `${base}/${best.file}`,
      width: isFinite(best.width) && best.width > 0 ? best.width : null,
      height: best.height,
      /* The separate audio track. CMAF offers no combined rendition, so this is the only
         way the post has sound — comments.js plays it alongside the video and keeps the
         two aligned (see pair() below). Null means genuinely silent, and is reported as
         such on screen rather than left to the reader to wonder about. */
      audioUrl: sound ? `${base}/${sound.file}` : null
    };
  }

  /**
   * Resolve a post's video to something a <video> element can play.
   *
   * @returns {Promise<{url,width,height,audioUrl,silent}|null>} null for every failure —
   *   not a video post, no asset id, the request failed, the manifest did not parse, or it
   *   listed nothing playable. The caller renders no player and the page is exactly what it
   *   was before this module existed.
   */
  function resolve(m) {
    const base = assetBase(m);
    if (!base) return Promise.resolve(null);
    if (inflight.has(base)) return inflight.get(base);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const p = fetch(`${base}/${C.VIDEO_MANIFEST}`, {
      signal: ctl.signal,
      credentials: 'omit',      // never carry the reader's cookies to the CDN
      redirect: 'follow',
      cache: 'default'
    })
      .then(r => (r.ok ? r.text() : null))
      .then(xml => {
        if (!xml) return null;
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        // A parse failure is reported as a document containing <parsererror>, not by throwing.
        if (doc.querySelector('parsererror')) return null;
        return pickRendition(doc, base);
      })
      .catch(() => null)        // abort, network failure, CORS — all the same to the caller
      .finally(() => clearTimeout(timer));

    inflight.set(base, p);
    return p;
  }

  /* How far apart the two elements may drift before it is worth a correction. MEASURED,
     not guessed: two media elements playing the same timeline in Chromium hold a CONSTANT
     offset rather than diverging — eight samples over three seconds read -75ms every time,
     and a seek left it at -67ms. So the thing to correct is a fixed startup offset (the
     elements cannot be started in the same instant), not accumulating drift, and one
     correction usually settles it for the whole video. 120ms sits above the noise and below
     the ~150ms where audio lag becomes noticeable against lips. */
  const SYNC_SLOP = 0.12;

  /**
   * Play a separate audio file in lockstep with a video element.
   *
   * WHY THIS EXISTS AT ALL. Reddit's CMAF packaging has no combined rendition — video and
   * audio are separate files — so a post either plays silent or plays as two elements kept
   * together. The alternative is MediaSource with two SourceBuffers, which is the textbook
   * answer and is NOT used here for a reason worth recording: it would have shipped
   * unverified. This project's headless Chromium is the open-source build with no H.264 and
   * no AAC (`isTypeSupported` says false for both), and Chrome's WebM byte stream accepts
   * only ONE SourceBuffer, so there is no combination available here that exercises
   * two-buffer MSE. Two media elements can be tested end to end, and are — see
   * test/media-sync.js, which runs in a real browser.
   *
   * THE VIDEO IS THE CLOCK. Every correction moves the audio, never the video, so the
   * picture never stutters and the reader's scrubbing is never fought. The video element is
   * also the single source of truth for volume: Chrome may or may not draw a volume control
   * for a video with no audio track, so ours writes to the video and this mirrors it
   * onward — whichever control the reader finds, both stay consistent.
   */
  function pair(video, audio) {
    const align = () => { audio.currentTime = video.currentTime; };
    const drifted = () => Math.abs(audio.currentTime - video.currentTime) > SYNC_SLOP;
    /* Never let a rejected play() reach the console as an unhandled rejection: autoplay
       policy rejects it routinely and it is not an error we can or should act on. */
    const resume = () => { if (!video.paused) audio.play().catch(() => {}); };

    video.addEventListener('play', () => { align(); resume(); });
    video.addEventListener('pause', () => audio.pause());
    video.addEventListener('seeking', align);
    video.addEventListener('ratechange', () => { audio.playbackRate = video.playbackRate; });
    video.addEventListener('volumechange', () => {
      audio.volume = video.volume;
      audio.muted = video.muted;
    });
    /* The video buffering is the one case where the audio must wait: it is a fraction of
       the video's size, so it is almost always the one that is ahead. */
    video.addEventListener('waiting', () => audio.pause());
    video.addEventListener('playing', () => { align(); resume(); });
    video.addEventListener('ended', () => audio.pause());
    /* The standing correction. timeupdate fires ~4x/second, which is often enough to catch
       a stall-induced jump and rare enough to cost nothing. */
    video.addEventListener('timeupdate', () => { if (drifted()) align(); });

    audio.volume = video.volume;
    audio.muted = video.muted;
    return { align, drifted };
  }

  /** Drop the memo. Called on teardown so a re-render does not serve a stale resolution. */
  function reset() { inflight.clear(); }

  return { resolve, assetBase, pickRendition, pair, reset };
})();
