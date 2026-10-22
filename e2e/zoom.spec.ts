import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  renderer: { setVideos: (on: boolean) => void };
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

// Videos hold still here (video.spec.ts covers them): once the zoom lands, if only a video
// changes on screen, Chrome lowers the frame rate to the video's (30 fps), which would read
// as slow frames in the recording that runs on past the zoom.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    addEventListener('load', () => (window as unknown as { __canvas: Api }).__canvas.renderer.setVideos(false));
  });
});

interface Zoom {
  /** Long animation frames, ms, and the longest gap between frames. */
  loaf: number[];
  longestFrame: number;
  /** Per frame: the target tile's drawn width and its layout width, a neighbour's layout width, and the focus frame's centre, width and opacity. */
  rows: { w: number; layout: number; nLayout: number; fx: number; fy: number; fw: number; fo: number }[];
}

/**
 * Zoom in on `how` (Space: the centremost image; pinch: one well off centre, a trackpad
 * pinch dispatched in the page at frame rate) or back out, and record every frame.
 */
const record = (page: Page, how: 'space' | 'pinch' | 'out'): Promise<Zoom> =>
  page.evaluate(async (how) => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].filter((el) => !el.hidden);
    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const off = (el: HTMLElement) => Math.hypot(centre(el).x - innerWidth / 2, centre(el).y - innerHeight / 2);
    const onScreen = (el: HTMLElement) => centre(el).x > 100 && centre(el).x < innerWidth - 100 && centre(el).y > 100 && centre(el).y < innerHeight - 100;
    const target = how === 'pinch' ? tiles.filter((t) => off(t) > 250 && off(t) < 420 && onScreen(t)).sort((a, b) => off(a) - off(b))[0]! : tiles.reduce((a, b) => (off(a) <= off(b) ? a : b));
    // The next nearest to the centre (zoomed in, it may be only partly on screen).
    const neighbour = tiles.filter((t) => t !== target).sort((a, b) => off(a) - off(b))[0]!;
    const frame = document.querySelector<HTMLElement>('.focus-frame')!;
    const out: Zoom = { loaf: [], longestFrame: 0, rows: [] };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => out.loaf.push(e.duration))).observe({ type: 'long-animation-frame' });
    const at = centre(target);
    const t0 = performance.now();
    let last = t0;
    const done = new Promise<void>((resolve) => {
      const tick = () => {
        const now = performance.now();
        out.longestFrame = Math.max(out.longestFrame, now - last);
        last = now;
        const f = frame.getBoundingClientRect();
        out.rows.push({
          w: target.getBoundingClientRect().width,
          layout: target.offsetWidth,
          nLayout: neighbour.offsetWidth,
          fx: f.left + f.width / 2,
          fy: f.top + f.height / 2,
          fw: f.width,
          fo: Number(getComputedStyle(frame).opacity),
        });
        if (now - t0 < 1300) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (how === 'pinch') {
      for (let n = 0; n < 12; n++) {
        window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -12, clientX: at.x, clientY: at.y, cancelable: true }));
        await new Promise((r) => requestAnimationFrame(r));
      }
    } else {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    }
    await done;
    return out;
  }, how);

/** Smooth: no stalls, a gentle start, no jolts, and tiles laid out at most once mid-zoom (where it lands). */
function expectSmooth({ loaf, longestFrame, rows }: Zoom): void {
  expect(loaf).toEqual([]);
  expect(longestFrame).toBeLessThan(30);
  const growth = rows.slice(1).map((r, n) => r.w - rows[n]!.w);
  const moving = growth.filter((g) => Math.abs(g) > 0.01);
  const peak = Math.max(...moving.map(Math.abs));
  expect(moving.length).toBeGreaterThan(20);
  // It sets off gently...
  expect(Math.abs(moving[0]!)).toBeLessThan(peak * 0.25);
  // ...and never lurches: the speed changes by little from one frame to the next.
  for (let n = 1; n < moving.length; n++) expect(Math.abs(moving[n]! - moving[n - 1]!)).toBeLessThan(peak * 0.4);
  // Its size in CSS, and a neighbour's, change at most once on the way: nothing is re-laid out mid-zoom.
  for (const key of ['layout', 'nLayout'] as const) expect(new Set(rows.map((r) => r[key])).size).toBeLessThanOrEqual(2);
}

test('zooming in on the centre image is smooth, and the image is sharp all the way: laid out once, for where it lands', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const zoom = await record(page, 'space');
  expectSmooth(zoom);
  expect(new Set(zoom.rows.map((r) => r.layout)).size).toBe(1);
  // The frame stays round it the whole way, never stepping aside.
  expect(Math.min(...zoom.rows.map((r) => r.fo))).toBe(1);
});

test('zooming in on an image off centre is smooth, and the frame never jumps where it can be seen', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const zoom = await record(page, 'pinch');
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');
  expectSmooth(zoom);
  // From the old image to the new one, the frame moves only once out of sight, and comes back round it.
  for (let n = 1; n < zoom.rows.length; n++) {
    const [a, b] = [zoom.rows[n - 1]!, zoom.rows[n]!];
    if (Math.hypot(b.fx - a.fx, b.fy - a.fy) > 60) expect(Math.max(a.fo, b.fo)).toBeLessThan(0.1);
  }
  expect(zoom.rows.at(-1)!.fo).toBe(1);
});

test('zooming back out is smooth too', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  expectSmooth(await record(page, 'out'));
});

test('zooming onto another image while the frame is mid hand-over leaves the frame, and only the frame, on it', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const result = await page.evaluate(async () => {
    const c = (window as unknown as { __canvas: Api & { activeImage: () => { image: number; left: number; top: number; width: number; height: number } } }).__canvas;
    // A scroll that makes another image the centremost: the frame starts handing over to it...
    const before = c.activeImage().image;
    window.dispatchEvent(new WheelEvent('wheel', { deltaX: 200, deltaY: 90, clientX: 720, clientY: 450, cancelable: true }));
    for (let n = 0; n < 40 && c.activeImage().image === before; n++) await new Promise((r) => requestAnimationFrame(r));
    // ...and at once a pinch onto an image well off centre.
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].filter((t) => !t.hidden);
    const centre = (t: HTMLElement) => {
      const r = t.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const off = (t: HTMLElement) => Math.hypot(centre(t).x - innerWidth / 2, centre(t).y - innerHeight / 2);
    const target = tiles.filter((t) => off(t) > 250 && off(t) < 420 && centre(t).x > 100 && centre(t).y > 100 && centre(t).x < innerWidth - 100 && centre(t).y < innerHeight - 100).sort((a, b) => off(a) - off(b))[0]!;
    const at = centre(target);
    for (let n = 0; n < 12; n++) {
      window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -12, clientX: at.x, clientY: at.y, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 2500));
    const named = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].filter((t) => t.style.getPropertyValue('anchor-name'));
    const a = c.activeImage();
    const f = document.querySelector('.focus-frame')!.getBoundingClientRect();
    return { named: named.length, off: Math.hypot(f.left + f.width / 2 - (a.left + a.width / 2), f.top + f.height / 2 - (a.top + a.height / 2)) };
  });
  // One tile carries the frame's anchors (a stale one elsewhere would pull it off), and it is round the active image.
  expect(result.named).toBe(1);
  expect(result.off).toBeLessThan(1);
});

