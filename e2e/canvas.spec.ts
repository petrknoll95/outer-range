import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import {
  COLUMN_STAGGER,
  COLUMN_STAGGER_JITTER,
  DRAG_THRESHOLD,
  JITTER_X,
  JITTER_Y,
  KEY_STEP,
  KEY_ZOOM,
  LEAD_MAX,
  LONG,
  MARGIN,
} from '../src/canvas/config';

interface CanvasApi {
  physics: { x: number; y: number; z: number; tx: number; ty: number; vx: number; vy: number };
  renderer: {
    poolSize: number;
    activeCount: number;
    zoomLaidOut: number;
    visibleCells: () => { i: number; j: number; image: number; left: number; top: number; width: number; height: number }[];
    trailOffsets: () => { i: number; j: number; x: number; y: number }[];
  };
  geometry: () => { vw: number; vh: number; s: number; pitch: number };
  zoomLimits: () => { min: number; max: number };
  isSettled: () => boolean;
  domNodes: () => number;
  onFrame: (fn: () => void) => () => void;
}
declare global {
  interface Window {
    __canvas: CanvasApi;
  }
}

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await settled(page);
}

async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__canvas?.isSettled(), null, { timeout: 30_000 });
}

const camera = (page: Page) =>
  page.evaluate(() => ({ x: window.__canvas.physics.x, y: window.__canvas.physics.y, z: window.__canvas.physics.z }));

/** ctrl + wheel at (x, y): what Chrome and Firefox send for a trackpad pinch. */
async function pinchWheel(page: Page, x: number, y: number, deltaY: number, events: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let n = 0; n < events; n++) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(16);
  }
  await page.keyboard.up('Control');
}

/** Mouse drag by (dx, dy) in `steps` moves of ~8 ms, optionally pausing before release. */
async function drag(page: Page, dx: number, dy: number, steps: number, holdMs = 0): Promise<void> {
  await page.mouse.move(720, 450);
  await page.mouse.down();
  for (let n = 1; n <= steps; n++) {
    await page.mouse.move(720 + (dx * n) / steps, 450 + (dy * n) / steps);
    await page.waitForTimeout(8);
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

test('dragging moves the canvas 1:1 with the pointer', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await drag(page, -300, -180, 30, 150);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(300, 6);
  expect(after.y - before.y).toBeCloseTo(180, 6);
});

test('a quick flick keeps gliding after release', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await drag(page, -240, 0, 6);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeGreaterThan(400);
});

test('a press that moves less than the threshold is a click, not a drag', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await drag(page, DRAG_THRESHOLD - 2, 0, 3);
  await page.waitForTimeout(100);
  expect(await camera(page)).toEqual(before);
});

test('wheel pans both axes', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(250, -120);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(250, 6);
  expect(after.y - before.y).toBeCloseTo(-120, 6);
});

test('pinch (ctrl+wheel) zooms about the cursor, and the browser page never zooms', async ({ page }) => {
  await open(page);
  const prevented = await page.evaluate(
    () => !window.dispatchEvent(new WheelEvent('wheel', { cancelable: true, deltaY: 0, ctrlKey: true })),
  );
  expect(prevented).toBe(true);

  const under = (c: { x: number; y: number; z: number }) => ({ x: c.x + 400 / c.z, y: c.y + 260 / c.z });
  const before = await camera(page);
  await pinchWheel(page, 400, 260, -15, 10);
  await settled(page);
  const after = await camera(page);
  expect(after.z).toBeGreaterThan(1.5);
  expect(under(after).x).toBeCloseTo(under(before).x, 6);
  expect(under(after).y).toBeCloseTo(under(before).y, 6);
  // Tiles are laid out again at the final zoom, so they are rasterised sharp.
  expect(await page.evaluate(() => window.__canvas.renderer.zoomLaidOut)).toBe(after.z);
});

test('zoom stops at its limits', async ({ page }) => {
  await open(page);
  const limits = await page.evaluate(() => window.__canvas.zoomLimits());
  expect(limits.min).toBeLessThan(1);
  expect(limits.max).toBeGreaterThan(1);
  await pinchWheel(page, 720, 450, -25, 40);
  await settled(page);
  expect((await camera(page)).z).toBe(limits.max);
  await pinchWheel(page, 720, 450, 25, 60);
  await settled(page);
  expect((await camera(page)).z).toBe(limits.min);
});

test('+ − and 0 zoom about the centre', async ({ page }) => {
  await open(page);
  await page.keyboard.press('=');
  await settled(page);
  expect((await camera(page)).z).toBeCloseTo(KEY_ZOOM, 9);
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await settled(page);
  expect((await camera(page)).z).toBeCloseTo(1 / KEY_ZOOM, 9);
  await page.keyboard.press('0');
  await settled(page);
  expect((await camera(page)).z).toBe(1);
});

test('images trail by different amounts while moving, and land exactly on the grid', async ({ page }) => {
  await open(page);
  await page.mouse.move(1000, 450);
  await page.mouse.down();
  for (let n = 1; n <= 12; n++) {
    await page.mouse.move(1000 - n * 40, 450);
    await page.waitForTimeout(8);
  }
  const moving = await page.evaluate(() => window.__canvas.renderer.trailOffsets());
  await page.mouse.up();
  // Dragging left, every image trails to the right of its grid position...
  expect(moving.every((o) => o.x > 0)).toBe(true);
  // ...but not as one block: the offsets spread out.
  const xs = moving.map((o) => o.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
  await settled(page);
  const resting = await page.evaluate(() => window.__canvas.renderer.trailOffsets());
  expect(resting.every((o) => o.x === 0 && o.y === 0)).toBe(true);
});

test('arrow keys pan by a fraction of the pitch', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  const pitch = await page.evaluate(() => window.__canvas.geometry().pitch);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(pitch * KEY_STEP, 6);
  expect(after.y - before.y).toBeCloseTo(pitch * KEY_STEP, 6);
});

test('reduced motion: no glide after a flick and no image trail', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const before = await camera(page);
  await page.mouse.move(720, 450);
  await page.mouse.down();
  for (let n = 1; n <= 6; n++) {
    await page.mouse.move(720 - n * 40, 450);
    await page.waitForTimeout(8);
  }
  const offsets = await page.evaluate(() => window.__canvas.renderer.trailOffsets());
  await page.mouse.up();
  expect(offsets.every((o) => o.x === 0 && o.y === 0)).toBe(true);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(240, 6);
});

test('the page never rubber-bands or swipes back', async ({ page }) => {
  await open(page);
  const styles = await page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorX, getComputedStyle(document.body).overscrollBehaviorX]);
  expect(styles).toEqual(['none', 'none']);
});

test('panning 20 screens away and back is pixel-identical', async ({ page }) => {
  await open(page);
  const shoot = async () => PNG.sync.read(await page.screenshot({ animations: 'disabled' }));
  const tiles = () =>
    page.evaluate(() => window.__canvas.renderer.visibleCells().sort((a, b) => a.i - b.i || a.j - b.j));
  const start = await shoot();
  const startTiles = await tiles();
  const origin = await camera(page);
  const { vw, vh } = await page.evaluate(() => window.__canvas.geometry());
  await page.mouse.move(720, 450);
  const moves: [number, number][] = [];
  for (let n = 0; n < 20; n++) moves.push([vw, n % 3 === 0 ? vh : -vh / 2]);
  for (const [dx, dy] of moves) {
    await page.mouse.wheel(dx, dy);
    await page.waitForTimeout(30);
  }
  await settled(page);
  const away = await camera(page);
  expect(Math.abs(away.x - origin.x)).toBeGreaterThan(vw * 19);
  for (const [dx, dy] of moves.reverse()) {
    await page.mouse.wheel(-dx, -dy);
    await page.waitForTimeout(30);
  }
  await settled(page);
  expect(await camera(page)).toEqual(origin);
  // Same cells, same images, same pixel positions: exact.
  expect(await tiles()).toEqual(startTiles);
  await page.waitForTimeout(300); // let fade-ins finish
  const end = await shoot();
  // Chrome may re-rasterise a tile edge a few levels differently after the layer has moved.
  // That stays under 0.05; a tile off by a single pixel trips ~150k pixels at the same threshold.
  const diff = pixelmatch(start.data, end.data, null, start.width, start.height, { threshold: 0.05 });
  expect(diff).toBe(0);
});

test('zooming in and out and back to 1 puts every tile back in place', async ({ page }) => {
  await open(page);
  const tiles = () =>
    page.evaluate(() => window.__canvas.renderer.visibleCells().sort((a, b) => a.i - b.i || a.j - b.j));
  const startTiles = await tiles();
  const origin = await camera(page);
  await pinchWheel(page, 300, 200, -20, 8);
  await pinchWheel(page, 1100, 700, 20, 14);
  await settled(page);
  await page.keyboard.press('0');
  await settled(page);
  // Zooming about different points shifts the camera; pan it back with the wheel.
  const back = await camera(page);
  expect(back.z).toBe(1);
  await page.mouse.wheel(origin.x - back.x, origin.y - back.y);
  await settled(page);
  const end = await camera(page);
  // The browser hands fractional wheel deltas over slightly rounded; 1/1000 px is invisible.
  expect(end.x).toBeCloseTo(origin.x, 3);
  expect(end.y).toBeCloseTo(origin.y, 3);
  // Same cells, same images, same rectangles. (Not a pixel comparison: having zoomed in,
  // the browser keeps the sharper variants it loaded, so tiles are now resampled from
  // better sources, which is what you want.)
  const endTiles = await tiles();
  expect(endTiles.length).toBe(startTiles.length);
  startTiles.forEach((t, n) => {
    const e = endTiles[n]!;
    expect([e.i, e.j, e.image]).toEqual([t.i, t.j, t.image]);
    for (const key of ['left', 'top', 'width', 'height'] as const) expect(e[key]).toBeCloseTo(t[key], 3);
  });
});

test('a minute of panning keeps the DOM and the heap flat', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  await page.mouse.move(720, 450);
  const sample = async () => page.evaluate(() => ({ dom: window.__canvas.domNodes(), pool: window.__canvas.renderer.poolSize }));

  // Warm up: zoom all the way out and back, and one lap in every direction, so the pool reaches its working size.
  await pinchWheel(page, 720, 450, 25, 40);
  await pinchWheel(page, 720, 450, -25, 20);
  await page.keyboard.press('0');
  for (const [dx, dy] of [[600, 0], [0, 600], [-600, 0], [0, -600]] as const) {
    for (let n = 0; n < 8; n++) {
      await page.mouse.wheel(dx, dy);
      await page.waitForTimeout(16);
    }
  }
  await settled(page);
  const baseHeap = await heap();
  const base = await sample();

  const end = Date.now() + 60_000;
  let angle = 0;
  const pools: number[] = [];
  let tick = 0;
  while (Date.now() < end) {
    angle += 0.05;
    // Every few seconds, a pinch in or out mid-pan.
    if (++tick % 150 === 0) await pinchWheel(page, 720, 450, tick % 300 === 0 ? 20 : -20, 6);
    await page.mouse.wheel(Math.cos(angle) * 160, Math.sin(angle * 0.7) * 160);
    await page.waitForTimeout(16);
    if (pools.length < 600 && Math.random() < 0.05) pools.push((await sample()).pool);
  }
  await settled(page);
  const after = await sample();
  const afterHeap = await heap();
  console.info(`pool ${base.pool} → ${after.pool} (max seen ${Math.max(...pools)}), dom ${base.dom} → ${after.dom}, heap ${(baseHeap / 1e6).toFixed(2)} → ${(afterHeap / 1e6).toFixed(2)} MB`);
  // The pool is the most tiles ever active at once, so it can never exceed the cells the
  // loaded range covers at the smallest zoom with the full lead margin.
  const bound = await page.evaluate(
    ({ MARGIN, LEAD_MAX, LONG, JITTER_X, JITTER_Y, COLUMN_STAGGER, COLUMN_STAGGER_JITTER }) => {
      const g = window.__canvas.geometry();
      const z = window.__canvas.zoomLimits().min;
      const span = (view: number, reach: number) => Math.floor((view / z + (2 * MARGIN + LEAD_MAX) * g.pitch + 2 * reach * g.s) / g.pitch) + 1;
      return span(g.vw, LONG / 2 + JITTER_X) * span(g.vh, LONG / 2 + JITTER_Y + COLUMN_STAGGER + COLUMN_STAGGER_JITTER);
    },
    { MARGIN, LEAD_MAX, LONG, JITTER_X, JITTER_Y, COLUMN_STAGGER, COLUMN_STAGGER_JITTER },
  );
  console.info(`pool bound ${bound}`);
  expect(after.pool).toBeLessThanOrEqual(bound);
  expect(after.dom).toBe(after.pool * 4 + 1);
  expect(afterHeap - baseHeap).toBeLessThan(1_000_000);
});

test('a 10 s scripted fling session has no long animation frames', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as { __loaf: number[]; __frames: number[] };
    w.__loaf = [];
    w.__frames = [];
    // The first paint at page load can be reported late; only judge frames from this session.
    const since = performance.now();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.startTime >= since) w.__loaf.push(e.duration);
    }).observe({ type: 'long-animation-frame', buffered: false });
    let last = performance.now();
    window.__canvas.onFrame(() => {
      const t = performance.now();
      w.__frames.push(t - last);
      last = t;
    });
  });
  const end = Date.now() + 10_000;
  let n = 0;
  while (Date.now() < end) {
    const dir = n++ % 4;
    const dx = [-1, 0, 1, 0][dir]! * 260;
    const dy = [0, -1, 0, 1][dir]! * 200;
    await drag(page, dx, dy, 6);
    await page.waitForTimeout(500);
    // Pinch in and out between flings, so relayouts at new zooms are measured too.
    await pinchWheel(page, 720, 450, dir % 2 ? 20 : -20, 5);
    await page.waitForTimeout(200);
  }
  const { loaf, frames } = await page.evaluate(() => {
    const w = window as unknown as { __loaf: number[]; __frames: number[] };
    return { loaf: w.__loaf, frames: w.__frames.slice(1) };
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.info(`frames ${frames.length}, p50 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted[sorted.length - 1]!.toFixed(1)} ms; long animation frames: ${loaf.length}`);
  expect(loaf).toEqual([]);
});
