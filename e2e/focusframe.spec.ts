import { expect, test, type Page } from '@playwright/test';
import { ACTIVE_SWITCH_MARGIN, FOCUS_FRAME_DURATION, FOCUS_FRAME_PADDING } from '../src/canvas/config';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Api {
  isSettled: () => boolean;
  renderer: { visibleCells: () => (Rect & { i: number; j: number })[]; rectOf: (el: Element) => unknown };
  activeImage: () => (Rect & { i: number; j: number; image: number }) | null;
}

/** The on-screen tile whose drawn centre is nearest the viewport centre, the active image, and their distances. */
const centremost = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    const d = (t: Rect) => Math.hypot(t.left + t.width / 2 - innerWidth / 2, t.top + t.height / 2 - innerHeight / 2);
    const tiles = c.renderer.visibleCells();
    const best = tiles.reduce((a, b) => (d(a) <= d(b) ? a : b));
    const active = c.activeImage()!;
    return { best: { i: best.i, j: best.j, d: d(best) }, active: { i: active.i, j: active.j, d: d(active) } };
  });
const P = FOCUS_FRAME_PADDING;

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await settled(page);
}
const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** The frame's box and the active image, read in the same frame. */
const sample = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    const f = document.querySelector('.focus-frame')!.getBoundingClientRect();
    return { frame: { left: f.left, top: f.top, width: f.width, height: f.height }, active: c.activeImage()! };
  });

test('the active image is the centremost one, and follows the canvas', async ({ page }) => {
  await open(page);
  let c = await centremost(page);
  expect([c.active.i, c.active.j]).toEqual([c.best.i, c.best.j]);
  await page.mouse.move(720, 450);
  for (const [dx, dy] of [[300, 0], [0, 240], [-170, -90], [520, 410]] as const) {
    await page.mouse.wheel(dx, dy);
    await settled(page);
    c = await centremost(page);
    // The current one only gives way once another is clearly closer.
    expect(c.active.d).toBeLessThanOrEqual(c.best.d + ACTIVE_SWITCH_MARGIN);
  }
});

test('clicking an image makes it the active one', async ({ page }) => {
  await open(page);
  const target = await page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    const active = c.activeImage()!;
    const t = c.renderer
      .visibleCells()
      .find((t) => (t.i !== active.i || t.j !== active.j) && t.left > 40 && t.top > 40 && t.left + t.width < 1400 && t.top + t.height < 860)!;
    return { i: t.i, j: t.j, x: t.left + t.width / 2, y: t.top + t.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await settled(page);
  const active = (await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage()))!;
  expect([active.i, active.j]).toEqual([target.i, target.j]);
});

test('the frame sits around the active image, a gap all round, and never takes clicks', async ({ page }) => {
  await open(page);
  const { frame, active } = await sample(page);
  expect(frame.left).toBeCloseTo(active.left - P, 0);
  expect(frame.top).toBeCloseTo(active.top - P, 0);
  expect(frame.width).toBeCloseTo(active.width + 2 * P, 0);
  expect(frame.height).toBeCloseTo(active.height + 2 * P, 0);
  const style = await page.locator('.focus-frame').evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, shadow: s.boxShadow, pointer: s.pointerEvents };
  });
  // The line is a 1px inset shadow, not a border.
  expect(style.border).toBe('0px');
  expect(style.shadow).toMatch(/ 0px 0px 0px 1px inset$/);
  expect(style.pointer).toBe('none');
});

test('while the canvas moves, the frame stays locked to its image', async ({ page }) => {
  await open(page);
  const first = (await sample(page)).active;
  await page.mouse.move(720, 450);
  await page.mouse.down();
  let checked = 0;
  for (let n = 1; n <= 12; n++) {
    await page.mouse.move(720 - n * 6, 450 - n * 3);
    const { frame, active } = await sample(page);
    // Only while the same image is active (a hand-over is animated on purpose).
    if (active.i !== first.i || active.j !== first.j) break;
    expect(frame.left).toBeCloseTo(active.left - P, 0);
    expect(frame.top).toBeCloseTo(active.top - P, 0);
    checked++;
  }
  await page.mouse.up();
  expect(checked).toBeGreaterThan(4);
});

test('when another image becomes active, the frame moves to it smoothly, never jumping', async ({ page }) => {
  await open(page);
  // Scroll an image well away from the centre into the middle: the frame hands over on the way.
  const target = await page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    const a = c.activeImage()!;
    const t = c.renderer
      .visibleCells()
      .filter((t) => (t.i !== a.i || t.j !== a.j) && t.left > 40 && t.top > 40 && t.left + t.width < 1400 && t.top + t.height < 860)
      .sort((p, q) => Math.hypot(q.left - 720, q.top - 450) - Math.hypot(p.left - 720, p.top - 450))[0]!;
    return { i: t.i, j: t.j, x: t.left + t.width / 2, y: t.top + t.height / 2 };
  });
  await page.evaluate(() => {
    const w = window as unknown as { __track: number[][] };
    w.__track = [];
    const f = document.querySelector('.focus-frame')!;
    const tick = () => {
      const r = f.getBoundingClientRect();
      const mix = Number(getComputedStyle(f).getPropertyValue('--focus-mix'));
      w.__track.push([r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, mix]);
      if (w.__track.length < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // In steps, like a trackpad, so the canvas itself moves at a steady pace.
  await page.mouse.move(720, 450);
  for (let n = 0; n < 12; n++) {
    await page.mouse.wheel((target.x - 720) / 12, (target.y - 450) / 12);
    await page.waitForTimeout(30);
  }
  await settled(page);
  await page.waitForTimeout(FOCUS_FRAME_DURATION * 1000 + 100);
  const track = await page.evaluate(() => (window as unknown as { __track: number[][] }).__track);
  // Between consecutive frames the box moves and resizes in small steps: no jump.
  let biggest = 0;
  for (let n = 1; n < track.length; n++) {
    const [x0, y0, w0, h0] = track[n - 1]!;
    const [x1, y1, w1, h1] = track[n]!;
    biggest = Math.max(biggest, Math.hypot(x1! - x0!, y1! - y0!), Math.abs(w1! - w0!), Math.abs(h1! - h0!));
  }
  expect(biggest).toBeLessThan(90);
  // The hand-over itself was animated: the blend passed through values between the two images.
  expect(track.filter(([, , , , mix]) => mix! > 0.1 && mix! < 0.9).length).toBeGreaterThan(3);
  const { frame, active } = await sample(page);
  expect([active.i, active.j]).toEqual([target.i, target.j]);
  expect(frame.left).toBeCloseTo(active.left - P, 0);
  expect(frame.top).toBeCloseTo(active.top - P, 0);
  expect(frame.width).toBeCloseTo(active.width + 2 * P, 0);
});

test('with reduced motion, the frame switches without animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const transition = await page.locator('.focus-frame').evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(transition).toBe('0s');
});
