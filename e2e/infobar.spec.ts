import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  route: () => 'home' | 'about';
  flight: () => { u: number; to: 0 | 1 } | null;
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

test('the info bar spans the bottom: moving and the theme at the left, the menu at the right, set like the header, and lets the canvas take the pointer', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Controls' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('listitem')).toHaveText(['Drag/Pinch/Scroll', 'LTheme', 'SESCStart a project', 'MESCMenu']);
  const box = (await bar.boundingBox())!;
  // 24 px in from either side like the header's link, on a 36 px band 16 px up from the bottom like the header's.
  const list = (await bar.getByRole('list').boundingBox())!;
  expect(list.x).toBeCloseTo(24, 0);
  expect(1440 - (list.x + list.width)).toBeCloseTo(24, 0);
  const [drag, menu] = await Promise.all([bar.getByRole('listitem').first().boundingBox(), bar.getByRole('listitem').last().boundingBox()]);
  expect(drag!.x).toBeCloseTo(24, 0);
  expect(1440 - (menu!.x + menu!.width)).toBeCloseTo(24, 0);
  expect(900 - (box.y + box.height)).toBeCloseTo(16, 0);
  expect(box.height).toBeCloseTo(36, 0);
  const style = await bar.evaluate((el) => ({ blend: getComputedStyle(el).mixBlendMode, colour: getComputedStyle(el).color, pointer: getComputedStyle(el).pointerEvents }));
  expect(style).toEqual({ blend: 'difference', colour: 'rgb(255, 255, 255)', pointer: 'none' });
  // What is under it is the canvas, but for Start a project and Menu, which are buttons (see below).
  const theme = (await bar.getByText('Theme').boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('aside') === null, [theme.x + theme.width / 2, box.y + box.height / 2])).toBe(true);
  // Its icons are the design's, at their own sizes, drawn at 0.85 of the design (InfoBar.astro's SCALE).
  const icons = await bar.locator('img').evaluateAll((imgs) => imgs.map((i) => [(i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0, Math.round(i.getBoundingClientRect().width)]));
  expect(icons).toEqual([
    [true, 13],
    [true, 24],
    [true, 8],
  ]);
});

test('on a phone (a touch screen, no keys) it is Start a project and Menu alone, keys and all, at the bottom right, a tap doing what the key does', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/?test');
  const bar = page.getByRole('complementary', { name: 'Controls' });
  await expect(bar).toBeVisible();
  await expect(bar.getByText('Drag/Pinch/Scroll')).toBeHidden();
  await expect(bar.getByText('Theme')).toBeHidden();
  const start = bar.getByRole('link', { name: 'Start a project' });
  const menu = bar.getByRole('button', { name: 'Menu' });
  // Each with its key in its pill, as on a desktop.
  await expect(start.locator('[data-hint-key]')).toBeVisible();
  await expect(start.locator('[data-hint-key]')).toHaveText('S');
  await expect(menu.locator('[data-hint-key]')).toBeVisible();
  await expect(menu.locator('[data-hint-key]')).toHaveText('M');
  // On screen, in a row at the bottom right, and big enough to tap.
  const [s, m] = [(await start.boundingBox())!, (await menu.boundingBox())!];
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(m.x);
  expect(m.x + m.width).toBeLessThanOrEqual(390);
  expect(m.y + m.height).toBeLessThanOrEqual(844);
  expect(m.height).toBeGreaterThanOrEqual(40);
  await menu.tap();
  await expect(page.locator('dialog[data-menu]')).toHaveJSProperty('open', true);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[data-menu]')).toHaveJSProperty('open', false);
  await start.tap();
  await page.waitForFunction(() => (window as unknown as { __canvas: { route: () => string } }).__canvas.route() === 'start');
  await context.close();
});

test('in a narrow desktop window the left of the bar gives way, but Start a project and Menu stay, at the right', async ({ page }) => {
  const bar = page.getByRole('complementary', { name: 'Controls' });
  for (const width of [759, 480, 360]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/?test');
    await expect(bar).toBeVisible();
    await expect(bar.getByText('Drag/Pinch/Scroll')).toBeHidden();
    await expect(bar.getByText('Theme')).toBeHidden();
    const start = (await bar.getByRole('link', { name: 'Start a project' }).boundingBox())!;
    const menu = (await bar.getByRole('button', { name: 'Menu' }).boundingBox())!;
    // In a row, the menu last, in from the right as the header's link is, and all on screen.
    expect(start.x + start.width).toBeLessThanOrEqual(menu.x);
    expect(start.x).toBeGreaterThanOrEqual(0);
    expect(Math.abs(menu.x + menu.width - (width - 24 + 8 * 0.85))).toBeLessThan(3);
  }
  // Wide enough, all of it.
  await page.setViewportSize({ width: 760, height: 700 });
  await expect(bar.getByText('Drag/Pinch/Scroll')).toBeVisible();
});

test('Start a project and Menu are buttons too: a click goes to the view (and back), or opens the menu', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Controls' });
  const start = bar.getByRole('link', { name: 'Start a project' });
  await expect(start).toHaveAttribute('href', /\/start$/);
  await start.click();
  await page.waitForFunction(() => (window as unknown as { __canvas: { route: () => string } }).__canvas.route() === 'start');
  await expect(page).toHaveURL(/\/start(\?|$)/);
  // There it says Back, and takes you back.
  await bar.getByRole('link', { name: 'Back' }).click();
  await page.waitForFunction(() => (window as unknown as { __canvas: { route: () => string } }).__canvas.route() === 'home');
  await settled(page);
  await bar.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('dialog[data-menu]')).toHaveJSProperty('open', true);
  // Everything else in the bar still lets the canvas take the pointer.
  const box = (await bar.getByText('Theme').boundingBox())!;
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[data-menu]')).toHaveJSProperty('open', false);
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('aside') === null, [box.x + box.width / 2, box.y + box.height / 2])).toBe(true);
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
