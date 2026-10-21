import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  physics: { x: number; y: number };
  flight: () => { back: boolean } | null;
}
const api = () => (window as unknown as { __canvas: Api }).__canvas;

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await settled(page);
}
const settled = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** What the page recorded about every tile on screen, every frame. */
interface Samples {
  tiles: { w: number; h: number }[];
  /** [ms, ...per tile x, y, scale, opacity], one per frame. */
  frames: number[][];
  /** Long animation frames, ms. */
  loaf: number[];
}

/**
 * Sample every tile on screen, every frame from now on. The samples go to sessionStorage as
 * they are taken, so they outlast the page: read them with samples() from the next one.
 */
const sampleTiles = (page: Page) =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && el.style.opacity !== '0';
    });
    const out = { tiles: tiles.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight })), frames: [] as number[][], loaf: [] as number[] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) out.loaf.push(e.duration);
    }).observe({ type: 'long-animation-frame' });
    const t0 = performance.now();
    // (The browser reads the 0 back as 0px.)
    const read = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0(?:px)?\)(?: scale\(([-\d.e]+)\))?/;
    const tick = () => {
      const row = [performance.now() - t0];
      for (const el of tiles) {
        const m = read.exec(el.style.transform)!;
        row.push(Number(m[1]), Number(m[2]), Number(m[3] ?? 1), el.style.opacity === '' ? 1 : Number(el.style.opacity));
      }
      out.frames.push(row);
      sessionStorage.setItem('samples', JSON.stringify(out));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const samples = (page: Page): Promise<Samples> => page.evaluate(() => JSON.parse(sessionStorage.getItem('samples')!));

/** Fly out from the keyboard: a plain navigation (nothing prerendered), so sessionStorage carries over. */
async function enterAbout(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'About' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/about\/?$/, { timeout: 5000 });
}

/** Every frame the browser composites from now on, through any change of page, as PNGs. */
async function screencast(page: Page): Promise<{ stop: () => Promise<Buffer[]> }> {
  const cdp = await page.context().newCDPSession(page);
  const shots: Buffer[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    shots.push(Buffer.from(f.data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => {});
      return shots;
    },
  };
}

/** The colour of a PNG if every pixel is that colour (within a couple of levels), else null. */
function uniformColour(png: Buffer): number[] | null {
  const { data } = PNG.sync.read(png);
  const first = [data[0]!, data[1]!, data[2]!];
  for (let k = 0; k < data.length; k += 4) {
    for (let c = 0; c < 3; c++) if (Math.abs(data[k + c]! - first[c]!) > 2) return null;
  }
  return first;
}

test('the About link sits at the top right, set exactly like the wordmark', async ({ page }) => {
  await open(page);
  const link = page.getByRole('link', { name: 'About' });
  await expect(link).toHaveAttribute('href', '/about');
  const style = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.color];
    });
  expect(await style('header a')).toEqual(await style('header h1'));
  const box = (await link.boundingBox())!;
  const mark = (await page.getByRole('heading', { name: 'Petr Knoll' }).boundingBox())!;
  expect(box.x + box.width).toBeCloseTo(1440 - 24, 0);
  expect(box.y + box.height / 2).toBeCloseTo(mark.y + mark.height / 2, 0);
});

test('About flies the camera into the canvas: every image grows outward at its own pace and fades, then the blank page swaps in without a visible change', async ({
  page,
}) => {
  await open(page);
  await sampleTiles(page);
  const video = await screencast(page);
  await enterAbout(page);
  await page.waitForTimeout(500);
  const shots = await video.stop();
  await expect(page).toHaveTitle('About · Petr Knoll');

  const { tiles: sizes, frames, loaf } = await samples(page);
  const tiles = sizes.length;
  expect(tiles).toBeGreaterThan(10);
  // From the frame before anything moved to the first with every tile gone.
  const end = frames.findIndex((f) => f.slice(1).every((v, k) => k % 4 !== 3 || v === 0));
  expect(end).toBeGreaterThan(5);
  const [cx, cy] = [720, 450];
  const scales: number[][] = [];
  for (let t = 0; t < tiles; t++) {
    const s0 = frames[0]![1 + t * 4 + 2]!;
    const track = frames.slice(0, end + 1).map((f) => {
      const [x, y, s, o] = f.slice(1 + t * 4, 5 + t * 4) as [number, number, number, number];
      return {
        k: s / s0,
        o,
        d: Math.hypot(x + (sizes[t]!.w * s) / 2 - cx, y + (sizes[t]!.h * s) / 2 - cy),
      };
    });
    for (let n = 1; n < track.length; n++) {
      // Only ever nearer the camera: bigger, further from the centre, fainter.
      expect(track[n]!.k).toBeGreaterThanOrEqual(track[n - 1]!.k - 1e-9);
      expect(track[n]!.d).toBeGreaterThanOrEqual(track[n - 1]!.d - 0.01);
      expect(track[n]!.o).toBeLessThanOrEqual(track[n - 1]!.o + 1e-9);
    }
    expect(track.at(-1)!.o).toBe(0);
    scales.push(track.map((p) => p.k));
  }
  // Each at its own depth: halfway through, some have grown far more than others.
  const mid = Math.round(end / 2);
  const atMid = scales.map((s) => s[mid]!);
  expect(Math.max(...atMid) / Math.min(...atMid)).toBeGreaterThan(1.3);
  // Smooth: not one long animation frame.
  expect(loaf).toEqual([]);

  // On screen: images, then from the first blank frame on, through the change of page, only
  // ever that one colour. The new page never shows anything the old one didn't.
  const colours = shots.map(uniformColour);
  const clear = colours.findIndex((c) => c !== null);
  expect(clear).toBeGreaterThan(0);
  for (const c of colours.slice(clear)) expect(c).toEqual(colours[clear]);
  const page2 = uniformColour(await page.screenshot());
  expect(page2).toEqual(colours[clear]);
});

test('from the zoomed-in view too: the focused image comes at the camera, and the page changes', async ({ page }) => {
  await open(page);
  await page.keyboard.press(' ');
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');
  await page.getByRole('link', { name: 'About' }).click();
  // Input is locked while it flies: a scroll moves nothing.
  await page.waitForTimeout(200);
  const x = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 400);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x)).toBe(x);
  // The caption has gone out.
  await expect(page.locator('.focus-caption')).toBeHidden({ timeout: 2000 });
  await page.waitForURL(/\/about\/?$/, { timeout: 5000 });
});

test('a modified click opens About in a new tab and leaves the canvas as it is', async ({ page, context }) => {
  await open(page);
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'About' }).click({ modifiers: ['ControlOrMeta'] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/\/about\/?$/);
  expect(page.url()).not.toMatch(/about/);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight())).toBeNull();
});

test('with reduced motion nothing flies: the images just fade, then the page changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await sampleTiles(page);
  await enterAbout(page);
  const { tiles, frames } = await samples(page);
  for (let t = 0; t < tiles.length; t++) {
    const at = (f: number[]) => f.slice(1 + t * 4, 5 + t * 4);
    // Not moved or grown at all, only faded, to nothing.
    for (const f of frames) expect(at(f).slice(0, 3)).toEqual(at(frames[0]!).slice(0, 3));
    expect(frames.some((f) => at(f)[3] === 0)).toBe(true);
  }
});
