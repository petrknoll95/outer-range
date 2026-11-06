// Films the link preview's video: the intro's tunnel (src/canvas/intro.ts) as a seamless loop, in
// the dark theme, with the studio logo still in the middle, and a poster frame for og:image.
// Usage: node scripts/videos/build-og-video.mjs
//
// 1. Starts the dev server and opens the canvas in Chromium, so the page can import the intro's own
//    code and draw with its own layer (src/canvas/introlayer.ts): the lines look as they do on the site.
// 2. Builds the tunnel the camera cruises through at the speed it goes halfway through the cruise.
//    The intro's camera slows as it nears the tiles, so no stretch of it repeats; here each line
//    repeats down the tunnel instead, every `meet × speed × LOOP` focal lengths, so over LOOP s it
//    moves on exactly one repeat and the last frame runs into the first. As many lines as are near
//    the camera then, fading out far off so none appears out of nothing.
// 3. Films each frame (the canvas, the page's UI hidden), encodes them as H.264 MP4 (faststart,
//    the most widely played in link previews) and keeps the first as a JPEG poster, in src/assets/og/.
//
// Needs ffmpeg on the PATH and Playwright's Chromium.
import { dev } from 'astro';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'src/assets/og/');
/** The size link previews draw, px; filmed at DPR and scaled down, for clean lines. */
const [WIDTH, HEIGHT, DPR] = [1200, 630, 1.5];
const FPS = 30;
/** How long the loop is, s. */
const LOOP = 4;
/** The logo's width, as a share of the frame's. */
const LOGO = 0.45;
/** H.264 quality: thin lines on near black break up into blocks much past this. AQ mode 3 spends more on the dark. */
const CRF = 20;
const PORT = 4398;

const frames = mkdtempSync(join(tmpdir(), 'og-video-'));
const server = await dev({ root: ROOT, server: { port: PORT }, logLevel: 'error' });
const browser = await chromium.launch({ args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: DPR, colorScheme: 'dark' });
  // No hot reload mid-film: the dev server's socket never connects, nor gives up (which reloads too).
  await page.addInitScript(() => {
    window.WebSocket = class {
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    };
  });
  page.on('pageerror', (error) => console.error(error));
  // `?test`: no intro of its own, and the layer is drawn even on a software renderer.
  await page.goto(`http://localhost:${PORT}/?test`);
  await page.waitForFunction(() => window.__canvas);
  await page.evaluate(setUp, { loop: LOOP, logo: LOGO });

  const count = LOOP * FPS;
  for (let n = 0; n < count; n++) {
    await page.evaluate((t) => window.__og(t), n / FPS);
    await page.screenshot({ path: join(frames, `${String(n).padStart(4, '0')}.png`) });
  }
  console.log(`Filmed ${count} frames`);

  mkdirSync(OUT, { recursive: true });
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(frames, '%04d.png')],
    ...['-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`],
    ...['-c:v', 'libx264', '-preset', 'veryslow', '-profile:v', 'high', '-crf', String(CRF), '-x264-params', 'aq-mode=3:deblock=-1,-1', '-g', String(count)],
    ...['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'],
    ...['-movflags', '+faststart', '-an', join(OUT, 'video.mp4')],
  ]);
  await sharp(join(frames, '0000.png')).resize(WIDTH, HEIGHT, { kernel: 'lanczos3' }).jpeg({ quality: 88, mozjpeg: true }).toFile(join(OUT, 'poster.jpg'));
  console.log(`Encoded ${OUT}video.mp4 and poster.jpg`);
} finally {
  await browser.close();
  await server.stop();
  rmSync(frames, { recursive: true, force: true });
}

/** In the page: the tunnel, the layer drawing it and the logo, and `window.__og(t)` to draw it t s in. */
async function setUp({ loop, logo: logoShare }) {
  const { IntroLayer } = await import('/src/canvas/introlayer.ts');
  const intro = await import('/src/canvas/intro.ts');
  const { hash, unit } = await import('/src/canvas/hash.ts');
  const { pixelColors } = await import('/src/canvas/pixels.ts');
  const config = await import('/src/canvas/config.ts');
  const logo = (await import('/src/assets/logo.svg?raw')).default;
  const { SEED } = config;
  const vw = innerWidth;
  const vh = innerHeight;

  // The page's background and the lines' colours, as main.ts works them out.
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = getComputedStyle(document.body).backgroundColor;
  probe.fillRect(0, 0, 1, 1);
  const background = [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3).map((c) => c / 255);
  const data = JSON.parse(document.getElementById('canvas-data').textContent);
  const palette = intro.introPalette(data.images.flatMap((image) => pixelColors(image.pixels).filter((_, n) => n % 16 === 0)), background);

  // The camera halfway through the cruise: how fast it goes, focal lengths a second, and how far a streak reaches back.
  const start = intro.introDistance(0);
  const mid = intro.introDistance(config.INTRO_CRUISE / 2);
  const speed = config.INTRO_CRUISE_RATE * (1 + mid);
  const shutter = intro.introDistance(config.INTRO_CRUISE / 2 - config.INTRO_SHUTTER * config.INTRO_DURATION) - mid;

  // How many of the intro's lines are within 20 focal lengths of the camera then, a focal length.
  const NEAR = 20;
  let near = 0;
  for (let n = 0; n < intro.introLineCount(vw, vh); n++) {
    const u = intro.lineUnits(n, SEED);
    const meet = 1 + 0.5 * u.meet;
    const ahead = 1 - Math.expm1(u.along * Math.log1p(meet * start)) + meet * mid;
    if (ahead > 0 && ahead < NEAR) near++;
  }
  // As many here, each line repeating every period: on average 1.25 × speed × loop.
  const count = Math.round((near / NEAR) * speed * loop * 1.25);
  const reach = Math.hypot(vw, vh) / 2;
  // A ray's pace (rayPace in intro.ts), which sets a line's width.
  const [slowest, fastest] = config.INTRO_PACE;
  const pace = (n) => slowest + (fastest - slowest) * (config.INTRO_TILE_PACE * unit(hash(n, 0, SEED, 10)) + (1 - config.INTRO_TILE_PACE) * unit(hash(n, 0, SEED, 19)) ** 2);
  const lines = [];
  for (let n = 0; n < count; n++) {
    const u = intro.lineUnits(n, SEED);
    const meet = 1 + 0.5 * u.meet;
    const one = intro.instances([], 1);
    // Anywhere round the view, from up close to the middle out past the corners, as the intro's far lines are.
    intro.putLine(one.put, n, 2 * Math.PI * u.angle, reach * (0.03 + 2.22 * u.ring), intro.lineWidth(n, SEED) / pace(n), palette, SEED, 0, meet);
    lines.push({ values: one.data, meet, period: meet * speed * loop, at: u.along });
  }

  // Out to where the intro's lines start, fading over the far part of it.
  const far = [start * 0.6, start * 1.4];
  const fade = (d) => {
    const x = Math.min(1, Math.max(0, (d - far[0]) / (far[1] - far[0])));
    return 1 - x * x * (3 - 2 * x);
  };
  /** Every line's repeats t s in, at their depths: from just behind the camera, while its streak still shows, to far off. */
  const tunnel = (t) => {
    const out = [];
    for (const line of lines) {
      const first = ((((line.at * line.period - line.meet * speed * t) % line.period) + line.period) % line.period) - 2;
      for (let depth = first; depth < far[1]; depth += line.period) {
        if (depth + shutter * line.meet <= 0) continue;
        const values = line.values.slice();
        values[14] *= fade(depth);
        values[15] = depth;
        out.push(values);
      }
    }
    const all = new Float32Array(out.length * intro.INTRO_STRIDE);
    out.forEach((values, n) => all.set(values, n * intro.INTRO_STRIDE));
    return all;
  };

  document.head.insertAdjacentHTML('beforeend', '<style>body > *:not([data-intro]):not([data-og-logo]) { visibility: hidden !important; }</style>');
  const layer = IntroLayer.create(document.body, tunnel(0), background, vw, vh, 9998, true);
  // The logo as the intro draws it (introtitle.ts), in the ink, held still.
  const mark = document.createElement('div');
  mark.dataset.ogLogo = '';
  mark.className = 'text-ink';
  mark.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:none';
  mark.innerHTML = logo.replace(/black/g, 'currentColor').replace(/ width="\d+" height="\d+"/, ` style="display:block;width:${Math.round(vw * logoShare)}px;height:auto"`);
  document.body.append(mark);
  // The camera stays put and the tunnel comes to it: z 0, and a streak reaches back as far as the cruise's do. The cruise has no aberration.
  const frame = { z: 0, tail: shutter, scale: 1, closed: 0, corners: 0, fade: 1, rays: 0, lines: 1, flight: 0, back: 0, aberration: 0, handover: 0 };
  window.__og = (t) => {
    layer.load(tunnel(t), vw, vh);
    layer.draw(frame);
  };
}
