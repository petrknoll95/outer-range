import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { DRAG_THRESHOLD, FADE_OPACITY, KEY_STEP, LEAD_MAX, LONG, MARGIN } from '../src/canvas/config';

interface Tile {
  i: number;
  j: number;
  image: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
  opacity: number;
}

interface CanvasApi {
  physics: { x: number; y: number; z: number; tx: number; ty: number; vx: number; vy: number };
  renderer: {
    poolSize: number;
    activeCount: number;
    zoomLaidOut: number;
    visibleCells: () => Tile[];
    rectOf: (el: Element) => unknown;
    trailOffsets: () => { i: number; j: number; cx: number; cy: number; x: number; y: number }[];
  };
  world: { jitterX: number; jitterY: number; maxStagger: number };
  geometry: () => { vw: number; vh: number; s: number; pitch: number };
  lens: { reach: number; params: unknown };
  /** Screen point → the unlensed canvas point the lens draws there. */
  toCanvas: (x: number, y: number) => { x: number; y: number };
  zoomLimits: () => { min: number; max: number };
  zoomState: () => 'out' | 'in';
  zoomInLevel: () => number;
  activeImage: () => (Omit<Tile, 'scale' | 'opacity'>) | null;
  isSettled: () => boolean;
  domNodes: () => number;
  onFrame: (fn: () => void) => () => void;
}
declare global {
  interface Window {
    __canvas: CanvasApi;
  }
}

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/?test${query}`);
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

test('dragging moves the canvas with the pointer: what was under it stays under it', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  // From the centre well into the shrinking edge band, so the lens is part of the test.
  await drag(page, -560, -330, 40, 150);
  await settled(page);
  const after = await camera(page);
  const [from, to] = await page.evaluate(() => [window.__canvas.toCanvas(720, 450), window.__canvas.toCanvas(160, 120)]);
  // There, a screen pixel covers more than one canvas pixel.
  expect(720 - to!.x).toBeGreaterThan(560 + 20);
  expect(after.x - before.x).toBeCloseTo(from!.x - to!.x, 6);
  expect(after.y - before.y).toBeCloseTo(from!.y - to!.y, 6);
});

test('the lens keeps the centre full size and shrinks images towards every edge; ?flat turns it off', async ({ page }) => {
  await open(page);
  const tiles = await page.evaluate(() => window.__canvas.renderer.visibleCells());
  const distance = (t: (typeof tiles)[number]) =>
    Math.max(Math.abs(t.left + t.width / 2 - 720) / 720, Math.abs(t.top + t.height / 2 - 450) / 450);
  // The most central tile is (nearly) full size: the lens takes scale at a tile's far corner,
  // so one that pokes out of the full-size zone dips a little. (Exactly 1 at the very centre
  // is checked by the click-to-centre test.)
  const centre = tiles.reduce((a, b) => (distance(a) < distance(b) ? a : b));
  expect(centre.scale).toBeGreaterThan(0.95);
  for (const t of tiles) if (distance(t) > 0.9) expect(t.scale).toBeLessThan(0.75);
  // Scale falls (or holds) with distance from the centre.
  const sorted = [...tiles].sort((a, b) => distance(a) - distance(b));
  expect(sorted.at(-1)!.scale).toBeLessThan(sorted[0]!.scale);

  await open(page, '&flat');
  const flat = await page.evaluate(() => window.__canvas.renderer.visibleCells());
  expect(flat.every((t) => t.scale === 1)).toBe(true);
  expect(await page.evaluate(() => window.__canvas.lens.reach)).toBe(1);
});

test('a quick flick keeps gliding after release', async ({ page }) => {
  await open(page);
  const before = await camera(page);
  await drag(page, -240, 0, 6);
  await settled(page);
  const after = await camera(page);
  expect(after.x - before.x).toBeGreaterThan(400);
});

/** A screen point with no image under it (only the canvas itself), or null. */
const emptySpot = (page: Page) =>
  page.evaluate(() => {
    for (let y = 60; y < 860; y += 20) {
      for (let x = 60; x < 1380; x += 20) {
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('[data-canvas]') && !window.__canvas.renderer.rectOf(el)) return { x, y };
      }
    }
    return null;
  });

test('a press that moves less than the threshold is a tap, not a drag', async ({ page }) => {
  await open(page);
  const spot = (await emptySpot(page))!;
  const before = await camera(page);
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.mouse.move(spot.x + DRAG_THRESHOLD - 2, spot.y);
  await page.mouse.up();
  await page.waitForTimeout(100);
  // Between images, a tap does nothing.
  expect(await camera(page)).toEqual(before);
});

test('clicking an image opens the focused view on it; zoomed in, clicking another glides to it', async ({ page }) => {
  await open(page);
  // A tile fully on screen, off centre, and the one drawn on top at its centre.
  const offCentre = () =>
    page.evaluate(() => {
      const tiles = window.__canvas.renderer
        .visibleCells()
        .filter((t) => t.opacity > 0.05 && t.left > 20 && t.top > 20 && t.left + t.width < 1420 && t.top + t.height < 880)
        .sort((a, b) => Math.hypot(b.left + b.width / 2 - 720, b.top + b.height / 2 - 450) - Math.hypot(a.left + a.width / 2 - 720, a.top + a.height / 2 - 450));
      for (const t of tiles) {
        const x = t.left + t.width / 2;
        const y = t.top + t.height / 2;
        if (Math.hypot(x - 720, y - 450) > 150 && window.__canvas.renderer.rectOf(document.elementFromPoint(x, y)!)) return { ...t, x, y };
      }
      return null;
    });
  const target = (await offCentre())!;
  expect(target).not.toBeNull();
  await page.mouse.click(target.x, target.y);
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('in');
  expect((await camera(page)).z).toBeCloseTo(await page.evaluate(() => window.__canvas.zoomInLevel()), 6);
  let t = await tileOf(page, target);
  expect(t.left + t.width / 2).toBeCloseTo(720, 1);
  expect(t.top + t.height / 2).toBeCloseTo(450, 1);

  // Zoomed in, a click on a neighbour (faded, at the edge) glides it to the centre, still zoomed in.
  const next = await page.evaluate(() => {
    const c = window.__canvas;
    const a = c.activeImage()!;
    const n = c.renderer
      .visibleCells()
      .filter((t) => (t.i !== a.i || t.j !== a.j) && t.left + t.width / 2 > 40 && t.left + t.width / 2 < 1400 && t.top + t.height / 2 > 40 && t.top + t.height / 2 < 860)
      .find((t) => c.renderer.rectOf(document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)!));
    return n ? { ...n, x: n.left + n.width / 2, y: n.top + n.height / 2 } : null;
  });
  expect(next).not.toBeNull();
  await page.mouse.click(next!.x, next!.y);
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('in');
  t = await tileOf(page, next!);
  expect(t.left + t.width / 2).toBeCloseTo(720, 1);
  expect(t.top + t.height / 2).toBeCloseTo(450, 1);
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

/** A tile fully on screen, well off-centre, and the one drawn on top at its centre. */
const offCentreTile = (page: Page) =>
  page.evaluate(() => {
    const tiles = window.__canvas.renderer
      .visibleCells()
      .filter((t) => t.left > 20 && t.top > 20 && t.left + t.width < 1420 && t.top + t.height < 880)
      .sort((a, b) => Math.hypot(b.left + b.width / 2 - 720, b.top + b.height / 2 - 450) - Math.hypot(a.left + a.width / 2 - 720, a.top + a.height / 2 - 450));
    for (const t of tiles) {
      const x = t.left + t.width / 2;
      const y = t.top + t.height / 2;
      if (window.__canvas.renderer.rectOf(document.elementFromPoint(x, y)!)) return { ...t, x, y };
    }
    return null;
  });

/** The tile with the given cell, as drawn now. */
const tileOf = (page: Page, t: { i: number; j: number }) =>
  page.evaluate((t) => window.__canvas.renderer.visibleCells().find((c) => c.i === t.i && c.j === t.j)!, t);

test('pinching in locks onto the image under the cursor, centred, and the browser page never zooms', async ({ page }) => {
  await open(page);
  const prevented = await page.evaluate(
    () => !window.dispatchEvent(new WheelEvent('wheel', { cancelable: true, deltaY: 0, ctrlKey: true })),
  );
  expect(prevented).toBe(true);

  const target = (await offCentreTile(page))!;
  await pinchWheel(page, target.x, target.y, -15, 10);
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('in');
  const z = await page.evaluate(() => window.__canvas.zoomInLevel());
  expect((await camera(page)).z).toBe(z);
  const t = await tileOf(page, target);
  expect(t.left + t.width / 2).toBeCloseTo(720, 1);
  expect(t.top + t.height / 2).toBeCloseTo(450, 1);
  // Opaque; everything else faded.
  expect(t.opacity).toBe(1);
  const others = (await page.evaluate(() => window.__canvas.renderer.visibleCells())).filter((c) => c.i !== t.i || c.j !== t.j);
  expect(others.length).toBeGreaterThan(0);
  for (const o of others) expect(o.opacity).toBeCloseTo(FADE_OPACITY, 2);
  // Tiles are laid out again at the final zoom, so they are rasterised sharp.
  expect(await page.evaluate(() => window.__canvas.renderer.zoomLaidOut)).toBe(z);
});

test('there are only two zoom levels: more pinching stays in, pinching out goes back to 1', async ({ page }) => {
  await open(page);
  const z = await page.evaluate(() => window.__canvas.zoomInLevel());
  expect(z).toBeGreaterThan(1.5);
  await pinchWheel(page, 720, 450, -25, 40);
  await settled(page);
  expect((await camera(page)).z).toBe(z);
  await pinchWheel(page, 720, 450, -25, 40);
  await settled(page);
  expect((await camera(page)).z).toBe(z);
  await pinchWheel(page, 720, 450, 25, 40);
  await settled(page);
  expect((await camera(page)).z).toBe(1);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('out');
  // Zoomed out, nothing is faded.
  const tiles = await page.evaluate(() => window.__canvas.renderer.visibleCells());
  expect(tiles.every((t) => t.opacity === 1)).toBe(true);
});

test('+ zooms in on the active image, − and 0 zoom out, and pressing again changes nothing', async ({ page }) => {
  await open(page);
  const active = (await page.evaluate(() => window.__canvas.activeImage()))!;
  const z = await page.evaluate(() => window.__canvas.zoomInLevel());
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  await settled(page);
  expect((await camera(page)).z).toBe(z);
  const centred = (await page.evaluate(() => window.__canvas.activeImage()))!;
  expect([centred.i, centred.j]).toEqual([active.i, active.j]);
  await page.keyboard.press('-');
  await settled(page);
  expect((await camera(page)).z).toBe(1);
  await page.keyboard.press('=');
  await settled(page);
  await page.keyboard.press('0');
  await settled(page);
  expect((await camera(page)).z).toBe(1);
});

test('Space or Enter zooms in on the active image, and pressing again zooms back out', async ({ page }) => {
  await open(page);
  const active = (await page.evaluate(() => window.__canvas.activeImage()))!;
  await page.keyboard.press(' ');
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('in');
  expect((await camera(page)).z).toBeCloseTo(await page.evaluate(() => window.__canvas.zoomInLevel()), 3);
  // It's the framed image that zooms in, centred.
  const t = await tileOf(page, active);
  expect(t.left + t.width / 2).toBeCloseTo(720, 1);
  expect(t.top + t.height / 2).toBeCloseTo(450, 1);

  await page.keyboard.press('Enter');
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('out');
  expect((await camera(page)).z).toBe(1);
  await page.keyboard.press('Enter');
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('in');
  await page.keyboard.press(' ');
  await settled(page);
  expect(await page.evaluate(() => window.__canvas.zoomState())).toBe('out');
});

test('zoomed in, a scroll moves exactly one image in its direction, however far it goes', async ({ page }) => {
  await open(page);
  await page.keyboard.press('=');
  await settled(page);
  const start = (await page.evaluate(() => window.__canvas.activeImage()))!;
  const g = await page.evaluate(() => ({ pitch: window.__canvas.geometry().pitch, z: window.__canvas.physics.z }));
  const before = await camera(page);
  await page.mouse.move(720, 450);
  // Three pitches' worth of scroll to the right: still only one image.
  await page.mouse.wheel(g.pitch * g.z * 3, 0);
  await settled(page);
  const after = await camera(page);
  const now = (await page.evaluate(() => window.__canvas.activeImage()))!;
  expect([now.i, now.j]).not.toEqual([start.i, start.j]);
  expect(Math.abs(now.i - start.i)).toBe(1);
  expect(after.x - before.x).toBeGreaterThan(g.pitch * 0.5);
  expect(after.x - before.x).toBeLessThan(g.pitch * 1.5);
  expect(now.left + now.width / 2).toBeCloseTo(720, 1);
  expect(now.top + now.height / 2).toBeCloseTo(450, 1);
  // A nudge too small to page springs back to the same image.
  await page.mouse.wheel(g.pitch * g.z * 0.1, 0);
  await settled(page);
  const back = (await page.evaluate(() => window.__canvas.activeImage()))!;
  expect([back.i, back.j]).toEqual([now.i, now.j]);
  expect(back.left + back.width / 2).toBeCloseTo(720, 1);
});

test('zoomed in, even a long fast flick moves exactly one image, and lands centred', async ({ page }) => {
  await open(page);
  await page.keyboard.press('=');
  await settled(page);
  const start = (await camera(page))!;
  const g = await page.evaluate(() => ({ pitch: window.__canvas.geometry().pitch }));
  await drag(page, -600, 0, 5);
  await settled(page);
  const end = await camera(page);
  expect(end.x - start.x).toBeGreaterThan(g.pitch * 0.5);
  expect(end.x - start.x).toBeLessThan(g.pitch * 1.5);
  const active = (await page.evaluate(() => window.__canvas.activeImage()))!;
  expect(active.left + active.width / 2).toBeCloseTo(720, 1);
  expect(active.top + active.height / 2).toBeCloseTo(450, 1);
});

test('images trail most at the edge the motion leaves, least where it heads, and land exactly on the grid', async ({ page }) => {
  await open(page);
  await page.mouse.move(1100, 450);
  await page.mouse.down();
  for (let n = 1; n <= 12; n++) {
    await page.mouse.move(1100 - n * 40, 450);
    await page.waitForTimeout(8);
  }
  const moving = await page.evaluate(() => window.__canvas.renderer.trailOffsets());
  await page.mouse.up();
  // Dragging left, every image trails to the right of its grid position...
  expect(moving.every((o) => o.x > 0)).toBe(true);
  // ...least at the left (leading) edge, most at the right (trailing) edge.
  const mean = (xs: typeof moving) => xs.reduce((a, o) => a + o.x, 0) / xs.length;
  const left = moving.filter((o) => o.cx < 480);
  const right = moving.filter((o) => o.cx > 960);
  expect(left.length).toBeGreaterThan(0);
  expect(right.length).toBeGreaterThan(0);
  expect(mean(right)).toBeGreaterThan(mean(left) * 1.4);
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
  // Videos play on: their frames differ between any two shots, so leave them out (video.spec.ts covers them),
  // and with them what a shown video clears under it: every tile shows its poster, on no colour.
  await page.addStyleTag({
    content:
      '[data-canvas-layer] video { visibility: hidden } [data-canvas-layer] picture { visibility: visible !important } [data-canvas-layer] > div { background-color: transparent !important }',
  });
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

test('zoomed in, the lens still shrinks images towards the edges and dragging still trails them', async ({ page }) => {
  await open(page);
  await page.keyboard.press('=');
  await settled(page);
  const tiles = await page.evaluate(() => window.__canvas.renderer.visibleCells());
  expect(tiles.some((t) => t.scale < 0.9)).toBe(true);
  await page.mouse.move(1100, 450);
  await page.mouse.down();
  for (let n = 1; n <= 10; n++) {
    await page.mouse.move(1100 - n * 30, 450);
    await page.waitForTimeout(8);
  }
  const moving = await page.evaluate(() => window.__canvas.renderer.trailOffsets());
  await page.mouse.up();
  expect(moving.length).toBeGreaterThan(1);
  // Dragging left, every image trails to the right of its grid position, by different amounts.
  expect(moving.every((o) => o.x > 0)).toBe(true);
  const xs = moving.map((o) => o.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  await settled(page);
});

test('zooming in on an image and back out leaves it at the centre', async ({ page }) => {
  await open(page);
  const target = (await offCentreTile(page))!;
  await pinchWheel(page, target.x, target.y, -20, 8);
  await settled(page);
  await pinchWheel(page, 1100, 700, 20, 8);
  await settled(page);
  expect((await camera(page)).z).toBe(1);
  const t = await tileOf(page, target);
  expect(t.left + t.width / 2).toBeCloseTo(720, 1);
  expect(t.top + t.height / 2).toBeCloseTo(450, 1);
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
  const sample = async () =>
    page.evaluate(() => ({
      dom: window.__canvas.domNodes(),
      pool: window.__canvas.renderer.poolSize,
      videos: document.querySelectorAll('[data-canvas-layer] video').length,
    }));

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
  // loaded range covers at the smallest zoom with the full lead margin and the lens's reach.
  const bound = await page.evaluate(
    ({ MARGIN, LEAD_MAX, LONG }) => {
      const c = window.__canvas;
      const g = c.geometry();
      const w = c.world;
      const z = c.zoomLimits().min;
      const lensReach = c.lens.reach;
      const span = (view: number, reach: number) =>
        Math.floor(((view * lensReach) / z + (2 * MARGIN + LEAD_MAX) * g.pitch + 2 * reach * g.s) / g.pitch) + 1;
      return span(g.vw, LONG / 2 + w.jitterX) * span(g.vh, LONG / 2 + w.jitterY + w.maxStagger);
    },
    { MARGIN, LEAD_MAX, LONG },
  );
  console.info(`pool bound ${bound}`);
  expect(after.pool).toBeLessThanOrEqual(bound);
  // Four nodes per tile, one more for a tile that has shown a video, plus the layer and the focus frame.
  expect(after.videos).toBeLessThanOrEqual(after.pool);
  expect(after.dom).toBe(after.pool * 4 + after.videos + 2);
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
