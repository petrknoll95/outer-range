import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  route: () => 'home' | 'about';
  flight: () => { u: number; to: 0 | 1 } | null;
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

test('the info bar sits at the bottom right, set like the header, and lets the canvas take the pointer', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Controls' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('listitem')).toHaveText(['Drag/Pinch/Scroll', 'ESCNavigate', 'LTheme', 'AAbout']);
  const box = (await bar.boundingBox())!;
  // 24 px in from the right like the header's link, on a 36 px band 16 px up from the bottom like the header's.
  const list = (await bar.getByRole('list').boundingBox())!;
  expect(1440 - (list.x + list.width)).toBeCloseTo(24, 0);
  expect(900 - (box.y + box.height)).toBeCloseTo(16, 0);
  expect(box.height).toBeCloseTo(36, 0);
  const style = await bar.evaluate((el) => ({ blend: getComputedStyle(el).mixBlendMode, colour: getComputedStyle(el).color, pointer: getComputedStyle(el).pointerEvents }));
  expect(style).toEqual({ blend: 'difference', colour: 'rgb(255, 255, 255)', pointer: 'none' });
  // What is under it is the canvas.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('aside') === null, [list.x + list.width - 20, box.y + box.height / 2])).toBe(true);
  // Its icons are the design's, at their own sizes, drawn at 0.85 of the design (InfoBar.astro's SCALE).
  const icons = await bar.locator('img').evaluateAll((imgs) => imgs.map((i) => [(i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0, Math.round(i.getBoundingClientRect().width)]));
  expect(icons).toEqual([
    [true, 13],
    [true, 24],
    [true, 8],
    [true, 20],
    [true, 20],
  ]);
});

test('on a phone the info bar is not shown', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/?test');
  await expect(page.getByRole('complementary', { name: 'Controls' })).toBeHidden();
});

test('A goes to the about view and back, like the header link', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press('a');
  await page.waitForURL((url) => url.pathname === '/about');
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.u === 1);
  await page.keyboard.press('A');
  await page.waitForURL((url) => url.pathname === '/');
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.route())).toBe('home');
});
