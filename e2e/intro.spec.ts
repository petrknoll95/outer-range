import { expect, test, type Page } from '@playwright/test';

interface Api {
  intro: () => boolean;
  holdIntro: (u: number) => void;
  isSettled: () => boolean;
  physics: { x: number; y: number; z: number };
  renderer: { visibleCells: () => { i: number; j: number; left: number; top: number }[] };
}

const playing = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.intro());
const hold = (page: Page, u: number) => page.evaluate((u) => (window as unknown as { __canvas: Api }).__canvas.holdIntro(u), u);
const isPlaying = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.intro());
const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const layer = (page: Page) => page.locator('canvas[data-intro]');
const waiting = (page: Page) => page.evaluate(() => 'intro' in document.documentElement.dataset);
const open = async (page: Page) => {
  await page.goto('/?test&intro', { waitUntil: 'commit' });
  await playing(page);
  await hold(page, 0);
};

test('plays on opening the canvas, then gets out of the way', async ({ page }) => {
  await page.goto('/?test&intro', { waitUntil: 'commit' });
  await playing(page);
  await expect(layer(page)).toHaveCount(1);
  expect(await page.locator('header').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await page.waitForFunction(() => !(window as unknown as { __canvas: Api }).__canvas.intro(), null, { timeout: 4000 });
  await expect(layer(page)).toHaveCount(0);
  await settled(page);
  await expect(page.locator('header')).toHaveCSS('opacity', '1');
});

test('takes about two seconds', async ({ page }) => {
  await page.goto('/?test&intro', { waitUntil: 'commit' });
  await playing(page);
  const ms = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        const from = performance.now();
        const look = () => ((window as unknown as { __canvas: Api }).__canvas.intro() ? requestAnimationFrame(look) : done(performance.now() - from));
        look();
      }),
  );
  expect(ms).toBeGreaterThan(1500);
  expect(ms).toBeLessThan(3000);
});

test('lands on the canvas as it opens without one', async ({ page }) => {
  const tiles = () => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.renderer.visibleCells().map(({ i, j, left, top }) => ({ i, j, left, top })));
  await page.goto('/?test');
  await settled(page);
  const plain = await tiles();
  await page.goto('/?test&intro', { waitUntil: 'commit' });
  await playing(page);
  await settled(page);
  expect(await tiles()).toEqual(plain);
});

test('hands over to the real tiles for the last of the way, then leaves them untouched', async ({ page }) => {
  const scale = () => page.locator('[data-canvas-layer]').evaluate((el) => (el as HTMLElement).style.transform);
  await open(page);
  expect(await scale()).toBe('');
  await hold(page, 0.75);
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-canvas-layer]')!.style.transform !== '');
  expect(await waiting(page)).toBe(false);
  await expect(layer(page)).toHaveCount(0);
  await hold(page, 1);
  await settled(page);
  expect(await scale()).toBe('');
  await expect(page.locator('.focus-frame')).toHaveCSS('opacity', '1');
});

test('draws lines at speed', async ({ page }) => {
  await open(page);
  await hold(page, 0.3);
  await page.waitForTimeout(200);
  const lines = await page.screenshot();
  await hold(page, 0);
  await page.waitForTimeout(200);
  expect(Buffer.compare(lines, await page.screenshot())).not.toBe(0);
});

for (const [what, act] of [
  ['a click', (page: Page) => page.mouse.click(300, 300)],
  ['a scroll', (page: Page) => page.mouse.wheel(0, 200)],
  ['a key', (page: Page) => page.keyboard.press('ArrowRight')],
] as const) {
  test(`${what} cuts it short`, async ({ page }) => {
    await open(page);
    await act(page);
    expect(await isPlaying(page)).toBe(false);
    expect(await waiting(page)).toBe(false);
    await expect(layer(page)).toHaveCount(0);
    await expect(page.locator('[data-canvas-layer]')).toHaveCSS('transform', 'none');
  });
}

test('and what cut it short counts', async ({ page }) => {
  await open(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.physics.x !== -innerWidth / 2);
});

test('the About link takes you straight there', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'About' }).click();
  await page.waitForURL((url) => url.pathname === '/about');
  expect(await isPlaying(page)).toBe(false);
  await expect(layer(page)).toHaveCount(0);
});

test('a resize ends it', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(() => !(window as unknown as { __canvas: Api }).__canvas.intro());
});

test('a tile shows its colour grid, pixelated, until its image is in, and the image stays smooth', async ({ page }) => {
  await page.route(/\.(avif|webp)$/, () => {});
  await page.goto('/?test', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('[data-canvas-layer] > div:not([hidden])'));
  const tile = page.locator('[data-canvas-layer] > div:not([hidden])').first();
  const style = await tile.evaluate((el) => {
    const css = getComputedStyle(el);
    const image = getComputedStyle(el.querySelector('img')!);
    return { background: css.backgroundImage, rendering: css.imageRendering, size: css.backgroundSize, img: image.imageRendering };
  });
  expect(style.background).toContain('data:image/png');
  expect(style.rendering).toBe('pixelated');
  expect(style.size).toBe('100% 100%');
  expect(style.img).toBe('auto');
});

test('videos wait for it', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(300);
  expect(await page.locator('[data-canvas] video').evaluateAll((videos) => videos.filter((v) => !(v as HTMLVideoElement).paused).length)).toBe(0);
});

test('reduced motion goes straight to the canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?test&intro');
  expect(await isPlaying(page)).toBe(false);
  expect(await waiting(page)).toBe(false);
  await expect(layer(page)).toHaveCount(0);
});

test('not on the about view', async ({ page }) => {
  await page.goto('/about?test&intro');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas);
  expect(await isPlaying(page)).toBe(false);
  expect(await waiting(page)).toBe(false);
});

test('not coming back with the back button', async ({ page }) => {
  await page.goto('/?test&intro', { waitUntil: 'commit' });
  await playing(page);
  await settled(page);
  await page.goto('/about?test');
  await page.goBack();
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas);
  expect(await isPlaying(page)).toBe(false);
  expect(await waiting(page)).toBe(false);
});

test('without WebGL the canvas just opens', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : get.call(this, type as '2d', ...(rest as []));
    } as typeof get;
  });
  await page.goto('/?test&intro');
  await settled(page);
  expect(await waiting(page)).toBe(false);
  await expect(layer(page)).toHaveCount(0);
});
