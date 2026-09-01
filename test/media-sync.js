#!/usr/bin/env node
/**
 * media-sync.js — proves SHD.media.pair() actually keeps two media elements together,
 * in a real browser, because nothing else in this project can.
 *
 * WHY A SEPARATE SUITE. jsdom implements no media pipeline at all: `play()` resolves
 * nothing, `currentTime` never advances, and `timeupdate` never fires. run.js can prove the
 * right elements are built with the right URLs and it can prove nothing whatever about
 * whether the audio stays with the picture. That is the entire risk of the feature, so it
 * gets a browser.
 *
 * WHY WEBM AND NOT THE REAL FILES. Reddit's CMAF is H.264 + AAC, and the Chromium these
 * tests run against is the open-source build with neither — `MediaSource.isTypeSupported`
 * returns false for both, measured. VP8 and Opus are present, and pair() is codec-agnostic:
 * it reads `currentTime` and calls `play`/`pause`, and does not know or care what is inside
 * the elements. So the media is generated in the browser with MediaRecorder — no fixture
 * to commit, no network, and nobody's video in the repository.
 *
 * WHY THE MODULE AND NOT THE BUNDLE. This exercises src/core/media.js directly against a
 * stub of the one contract it reads. The bundle's own wiring is covered by run.js; booting
 * the whole extension on a page with no Reddit in it would add a pipeline, a gate and a
 * failure screen to a test about two <video> elements. build.js already fails if this file
 * ever stops being part of the bundle.
 *
 *   node test/media-sync.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { requireChrome, makeChecker, LAUNCH_ARGS } = require('./harness');

const EXE = requireChrome('MEDIA SYNC');
const MEDIA_JS = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'media.js'), 'utf8');
const { check, report } = makeChecker();

/* Autoplay is blocked by default and every play() here is script-driven, so the policy has
   to be relaxed or the suite measures the policy instead of the code. */
const ARGS = [...LAUNCH_ARGS, '--autoplay-policy=no-user-gesture-required'];

(async () => {
  console.log('\n\x1b[1mMEDIA SYNC — AUDIO PAIRED TO VIDEO\x1b[0m');
  const browser = await puppeteer.launch({ executablePath: EXE, args: ARGS });
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    /* The module under test, plus the only contract entry it reads. */
    await page.evaluate(`globalThis.SHD = { C: { VIDEO_ASSET: /^x$/, VIDEO_MANIFEST: 'x' } };`);
    await page.evaluate(MEDIA_JS);

    const r = await page.evaluate(async () => {
      const ms = (n) => new Promise(res => setTimeout(res, n));

      /** Record `kind` for `dur` ms and return an object URL for it. */
      const record = async (kind, dur) => {
        let stream, stop = () => {};
        if (kind === 'video') {
          const cv = document.createElement('canvas');
          cv.width = 320; cv.height = 240;
          const cx = cv.getContext('2d');
          let t = 0;
          const iv = setInterval(() => {
            cx.fillStyle = `hsl(${(t += 7) % 360},80%,50%)`; cx.fillRect(0, 0, 320, 240);
          }, 33);
          cx.fillRect(0, 0, 320, 240);
          stop = () => clearInterval(iv);
          stream = cv.captureStream(30);
        } else {
          const ac = new AudioContext();
          const osc = ac.createOscillator();
          const dst = ac.createMediaStreamDestination();
          osc.connect(dst); osc.start();
          stream = dst.stream;
        }
        const chunks = [];
        const mr = new MediaRecorder(stream, {
          mimeType: kind === 'video' ? 'video/webm;codecs=vp8' : 'audio/webm;codecs=opus'
        });
        mr.ondataavailable = (e) => chunks.push(e.data);
        mr.start();
        await ms(dur);
        await new Promise(res => { mr.onstop = res; mr.stop(); });
        stop();
        return URL.createObjectURL(new Blob(chunks));
      };

      const [vUrl, aUrl] = [await record('video', 5000), await record('audio', 5000)];
      const video = document.createElement('video');
      const audio = document.createElement('audio');
      video.src = vUrl; audio.src = aUrl;
      document.body.append(video, audio);
      await Promise.all([video, audio].map(el => el.readyState >= 1
        ? null : new Promise(res => el.addEventListener('loadedmetadata', res, { once: true }))));

      const out = { slop: 0.12 };
      const paired = SHD.media.pair(video, audio);

      // pair() must start the audio off the video's own play event — nobody calls it.
      await video.play();
      await ms(700);
      out.audioStartedItself = !audio.paused;

      // Offset while both run. The startup gap is pair()'s to close, not the caller's.
      const offsets = [];
      for (let i = 0; i < 6; i++) { await ms(300); offsets.push(audio.currentTime - video.currentTime); }
      out.offsetsMs = offsets.map(o => Math.round(o * 1000));
      out.worstMs = Math.max(...offsets.map(o => Math.abs(o) * 1000));

      // A deliberate shove, which is what a stall looks like from the outside. The standing
      // timeupdate correction has to pull it back without anyone asking.
      audio.currentTime = video.currentTime + 1.5;
      await ms(900);
      out.recoveredMs = Math.abs(audio.currentTime - video.currentTime) * 1000;

      // Seeking follows the video, and the video is never moved to chase the audio.
      const before = video.currentTime;
      video.currentTime = 1.0;
      await ms(500);
      out.seekFollowedMs = Math.abs(audio.currentTime - video.currentTime) * 1000;
      out.videoNotDragged = before !== video.currentTime;

      // Volume and mute mirror, because the video is the single source of truth for both.
      video.volume = 0.25;
      video.muted = true;
      await ms(60);
      out.volumeMirrored = Math.abs(audio.volume - 0.25) < 1e-6;
      out.muteMirrored = audio.muted === true;

      video.pause();
      await ms(200);
      out.audioPausedWithVideo = audio.paused;

      /* THE UNHOOK, which is what a player falling back to another source depends on. A
         pairing left attached to an audio element that is no longer on the page keeps
         driving it, and the next pairing stacks a second set of listeners on the same
         video — two soundtracks, one picture. So stop() has to actually let go: after it,
         the video's own play event must move nothing. */
      paired.stop();
      audio.currentTime = 0;
      video.currentTime = 2.0;
      await video.play();
      await ms(500);
      out.stoppedAudioStayedPut = audio.paused && audio.currentTime < 0.5;
      video.pause();
      return out;
    });

    check('pair() starts the audio from the video\'s own play event', r.audioStartedItself);
    check(`audio holds within ${r.slop * 1000}ms of the picture while playing`,
      r.worstMs <= r.slop * 1000, `worst ${Math.round(r.worstMs)}ms of ${JSON.stringify(r.offsetsMs)}`);
    check('a 1.5s shove is pulled back automatically (what a stall looks like)',
      r.recoveredMs <= r.slop * 1000, `${Math.round(r.recoveredMs)}ms after recovery`);
    check('seeking the video takes the audio with it',
      r.seekFollowedMs <= r.slop * 1000, `${Math.round(r.seekFollowedMs)}ms apart`);
    check('...and the video is never dragged to chase the audio', r.videoNotDragged);
    check('volume mirrors from the video, which owns it', r.volumeMirrored);
    check('mute mirrors too, so the control is never a lie', r.muteMirrored);
    check('pausing the video pauses the sound', r.audioPausedWithVideo);
    check('stop() lets go completely, so a fallback source cannot inherit the old pairing',
      r.stoppedAudioStayedPut);
  } finally {
    await browser.close();
  }
  report();
})().catch((e) => { console.error(e); process.exit(1); });
