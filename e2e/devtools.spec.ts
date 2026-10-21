import { expect, test, type Page } from '@playwright/test';
import { ACTIVE_SWITCH_MARGIN, FOCUS_FRAME_PADDING } from '../src/canvas/config';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface Api {
  isSettled: () => boolean;
  physics: { x: number; y: number };
  renderer: { visibleCells: () => (Rect & { i: number; j: number; image: number })[] };
  activeImage: () => (Rect & { i: number; j: number; image: number }) | null;
  devtools: { devLayer: () => boolean; setDevLayer: (on: boolean) => void; isOpen: () => boolean };
}
const api = () => (window as unknown as { __canvas: Api }).__canvas;

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
}
const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.isSettled(), null, { timeout: 30_000 });

/** Click the pane's Dev layer box (Tweakpane draws its own; the real checkbox is hidden), as a person would. */
async function toggleDevLayer(page: Page, on: boolean): Promise<void> {
  await page.locator('#canvas-tweaks label:has(input[type=checkbox])').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.devtools.devLayer())).toBe(on);
}

/** The on-screen tile whose drawn centre is nearest the viewport centre, and its distance. */
const centremost = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    const d = (t: Rect) => Math.hypot(t.left + t.width / 2 - innerWidth / 2, t.top + t.height / 2 - innerHeight / 2);
    const tiles = c.renderer.visibleCells();
    const best = tiles.reduce((a, b) => (d(a) <= d(b) ? a : b));
    const active = c.activeImage()!;
    return { best: { i: best.i, j: best.j, d: d(best) }, active: { i: active.i, j: active.j, d: d(active) } };
  });

test('a dark translucent button at the top right opens and closes the tweak pane', async ({ page }) => {
  await open(page);
  const button = page.getByRole('button', { name: 'Tweaks' });
  const box = (await button.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(1440 - 40);
  expect(box.y).toBeLessThan(40);
  const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
  // Dark and translucent: low RGB, alpha below 1.
  const [r, g, b, a] = bg.match(/[\d.]+/g)!.map(Number);
  expect(Math.max(r!, g!, b!)).toBeLessThan(60);
  expect(a).toBeLessThan(1);

  await expect(page.getByText('Dev layer')).toBeHidden();
  await button.click();
  await expect(page.getByText('Dev layer')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Dev layer')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('the dev layer marks the focus frame and labels the active image', async ({ page }) => {
  await open(page);
  const frame = page.locator('.focus-frame');
  await expect(frame).toBeVisible();
  await expect(frame).not.toHaveAttribute('data-dev');
  await expect(page.locator('.focus-frame-label')).toBeHidden();
  await page.getByRole('button', { name: 'Tweaks' }).click();
  await toggleDevLayer(page, true);
  await expect(frame).toHaveAttribute('data-dev');
  await expect(frame).toHaveCSS('box-shadow', 'rgb(255, 255, 255) 0px 0px 0px 1px inset');
  const active = (await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage()))!;
  await expect(page.locator('.focus-frame-label')).toHaveText(`active #${active.image}`);
  const box = (await frame.boundingBox())!;
  const p = FOCUS_FRAME_PADDING;
  expect(box.x).toBeCloseTo(active.left - p, 0);
  expect(box.width).toBeCloseTo(active.width + 2 * p, 0);

  // Off again, and the setting survives a reload.
  await toggleDevLayer(page, false);
  await expect(frame).not.toHaveAttribute('data-dev');
  await toggleDevLayer(page, true);
  await open(page);
  await expect(page.locator('.focus-frame')).toHaveAttribute('data-dev');
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

test('scrolling over the pane leaves the canvas alone', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Tweaks' }).click();
  await expect(page.getByText('Dev layer')).toBeVisible();
  const before = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x);
  const box = (await page.locator('#canvas-tweaks').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x)).toBe(before);
});
