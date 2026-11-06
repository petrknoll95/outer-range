import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  flight: () => { u: number; to: 0 | 1 } | null;
}

const api = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight());
const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const flownPast = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.u === 1, null, { timeout: 5000 });
const home = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight() === null, null, { timeout: 5000 });
/** A view's hint (KeyHint.astro): whether it shows its view open, and what it says. */
const hint = (page: Page, name: string) =>
  page.locator(`[data-hint="${name}"]`).first().evaluate((el) => ['active' in (el as HTMLElement).dataset, el.querySelector('[data-hint-label]')!.textContent]);
/** Done moving: the hint's keys and label. */
const still = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => !(a.effect as KeyframeEffect | null)?.target?.closest('[data-hint]')));

test('S flies to Start a project, an empty page, as A does to the about view; S or Esc flies back', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  expect(await hint(page, 'start')).toEqual([false, 'Start a project']);

  await page.keyboard.press('s');
  await page.waitForURL((url) => url.pathname === '/start');
  await flownPast(page);
  await expect(page).toHaveTitle('Start a project · Outer Range');
  // Its own block in the layer behind the canvas, empty for now; the about text isn't there.
  await expect(page.locator('[data-view-content="start"]')).toHaveCSS('display', 'block');
  await expect(page.locator('[data-view-content="start"]')).toHaveText('');
  await expect(page.locator('[data-view-content="about"]')).toBeHidden();
  await expect.poll(() => hint(page, 'start')).toEqual([true, 'Back']);
  expect(await hint(page, 'about')).toEqual([false, 'About']);

  await page.keyboard.press('Escape');
  await page.waitForURL((url) => url.pathname === '/');
  await home(page);
  await expect.poll(() => hint(page, 'start')).toEqual([false, 'Start a project']);

  await page.keyboard.press('s');
  await flownPast(page);
  await page.keyboard.press('s');
  await page.waitForURL((url) => url.pathname === '/');
  await home(page);
});

test('from the about view, S goes straight to Start a project, and A straight back, the canvas staying flown past', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press('a');
  await flownPast(page);
  await page.keyboard.press('s');
  await page.waitForURL((url) => url.pathname === '/start');
  expect(await api(page)).toEqual({ u: 1, to: 1 });
  await expect(page.locator('[data-view-content="about"]')).toBeHidden();
  await expect.poll(() => Promise.all([hint(page, 'about'), hint(page, 'start')])).toEqual([
    [false, 'About'],
    [true, 'Back'],
  ]);
  await page.keyboard.press('a');
  await page.waitForURL((url) => url.pathname === '/about');
  expect(await api(page)).toEqual({ u: 1, to: 1 });
  await expect(page.locator('[data-view-content="about"]')).toBeVisible();
  // Esc from there goes all the way back to the canvas.
  await page.keyboard.press('Escape');
  await page.waitForURL((url) => url.pathname === '/');
  await home(page);
});

test('opened at /start: the canvas is flown past, and its hint already says Back', async ({ page }) => {
  await page.goto('/start?test');
  expect(await api(page)).toEqual({ u: 1, to: 1 });
  expect(await hint(page, 'start')).toEqual([true, 'Back']);
  await page.keyboard.press('Escape');
  await page.waitForURL((url) => url.pathname === '/');
  await home(page);
});

test('a view open, its hint adds ESC to the right of its key, the key moving left to make room, the label staying put', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const parts = (name: string) =>
    page.locator(`[data-hint="${name}"]`).first().evaluate((el) => {
      const box = (sel: string) => {
        const r = el.querySelector(sel)!.getBoundingClientRect();
        return { left: r.left, right: r.right, middle: (r.top + r.bottom) / 2 };
      };
      return { key: box('[data-hint-key]'), esc: box('[data-hint-esc]'), label: box('[data-hint-label]'), escOpacity: Number(getComputedStyle(el.querySelector('[data-hint-esc]')!).opacity) };
    });
  for (const [name, open, close] of [
    ['about', 'a', 'Escape'],
    ['start', 's', 'Escape'],
    ['menu', 'm', 'Escape'],
  ] as const) {
    const before = await parts(name);
    expect(before.escOpacity).toBe(0);
    await page.keyboard.press(open);
    await page.waitForTimeout(900);
    await still(page);
    const after = await parts(name);
    expect(after.escOpacity).toBe(1);
    // The label where it was, right-aligned (its words may be shorter or longer); the ESC where the
    // key sat before it, and the key one ESC and a gap to its left (35 + 4.8 design px, at 0.85).
    const gap = 9.6 * 0.85;
    expect(after.label.right).toBeCloseTo(before.label.right, 0);
    expect(before.label.left - before.key.right).toBeCloseTo(gap, 0);
    expect(after.label.left - after.esc.right).toBeCloseTo(gap, 0);
    expect(after.esc.right - after.esc.left).toBeCloseTo(35 * 0.85, 0);
    expect(after.esc.left - after.key.right).toBeCloseTo(4.8 * 0.85, 0);
    expect(Math.abs(after.esc.middle - after.key.middle)).toBeLessThan(0.5);
    await page.keyboard.press(close);
    await page.waitForTimeout(1200);
    await still(page);
    expect(await parts(name)).toEqual(before);
  }
});
