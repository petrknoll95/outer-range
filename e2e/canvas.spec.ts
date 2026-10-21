import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { DRAG_THRESHOLD, KEY_STEP } from '../src/canvas/config';

interface CanvasApi {
  physics: { x: number; y: number; tx: number; ty: number; vx: number; vy: number };
  renderer: { poolSize: number; activeCount: number; visibleCells: () => { i: number; j: number }[] };
  geometry: () => { vw: number; vh: number; s: number; pitch: number };
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

const camera = (page: Page) => page.evaluate(() => ({ x: window.__canvas.physics.x, y: window.__canvas.physics.y }));

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

test('wheel pans both axes; ctrl+wheel (pinch) is left to the browser', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(250, -120);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeCloseTo(250, 6);
  expect(after.y - before.y).toBeCloseTo(-120, 6);

  const prevented = await page.evaluate(() => {
    const send = (init: WheelEventInit) => !window.dispatchEvent(new WheelEvent('wheel', { cancelable: true, deltaY: 10, ...init }));
    return { plain: send({}), pinch: send({ ctrlKey: true }) };
  });
  expect(prevented).toEqual({ plain: true, pinch: false });
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

test('reduced motion: no glide after a flick', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const before = await camera(page);
  await drag(page, -240, 0, 6);
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

  // Warm up: one lap in every direction so the pool reaches its working size.
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
  while (Date.now() < end) {
    angle += 0.05;
    await page.mouse.wheel(Math.cos(angle) * 160, Math.sin(angle * 0.7) * 160);
    await page.waitForTimeout(16);
    if (pools.length < 600 && Math.random() < 0.05) pools.push((await sample()).pool);
  }
  await settled(page);
  const after = await sample();
  const afterHeap = await heap();
  console.info(`pool ${base.pool} → ${after.pool} (max seen ${Math.max(...pools)}), dom ${base.dom} → ${after.dom}, heap ${(baseHeap / 1e6).toFixed(2)} → ${(afterHeap / 1e6).toFixed(2)} MB`);
  // The pool only grows when the lead margin reaches a new extreme; it never leaks per frame.
  expect(after.pool).toBeLessThanOrEqual(base.pool + 12);
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
    await page.waitForTimeout(700);
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
