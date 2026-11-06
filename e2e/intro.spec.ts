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
  await page.waitForFunction(() => !(window as unknown as { __canvas: Api }).__canvas.intro(), null, { timeout: 10_000 });
  await expect(layer(page)).toHaveCount(0);
  await settled(page);
  await expect(page.locator('header')).toHaveCSS('opacity', '1');
});

test('takes under six seconds', async ({ page }) => {
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
  expect(ms).toBeGreaterThan(4400);
  expect(ms).toBeLessThan(6800);
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
  await hold(page, 5.3);
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-canvas-layer]')!.style.transform !== '');
  expect(await waiting(page)).toBe(false);
  await expect(layer(page)).toHaveCount(0);
  await hold(page, 99);
  await settled(page);
  expect(await scale()).toBe('');
  await expect(page.locator('.focus-frame')).toHaveCSS('opacity', '1');
});

test('first the logo, glyph by glyph, its letters as tall as the wordmark’s, then the tagline, set like the wordmark', async ({ page }) => {
  const line = page.locator('[data-intro-line]');
  const glyphs = line.locator('svg');
  const tagline = page.locator('[data-intro-tagline]');
  const first = tagline.locator('span span').first();
  await open(page);
  await expect(glyphs).toHaveCount(11);
  await expect(tagline).toHaveText('Creative partner for the age of AI');
  await expect(line).toHaveAttribute('aria-hidden', 'true');
  await expect(tagline).toHaveAttribute('aria-hidden', 'true');
  await hold(page, 1.1);
  await expect.poll(() => glyphs.last().evaluate((el) => (el as SVGElement).style.transform)).toBe('translateY(0%)');
  expect(await first.evaluate((el) => (el as HTMLElement).style.transform)).toBe('translateY(170%)');
  // The logo centred; its U (a flat-topped capital, 16.7 of its 104 units) as tall as the wordmark's capitals, give or take.
  const box = (await line.locator('> span').boundingBox())!;
  const view = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(2);
  const u = (await glyphs.nth(1).boundingBox())!;
  const fontSize = await page.locator('h1').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect((u.height * 16.7) / 104).toBeCloseTo(fontSize * 0.7, -0.5);
  const type = (el: Element) => { const css = getComputedStyle(el); return [css.fontSize, css.fontWeight, css.letterSpacing]; };
  expect(await tagline.locator('span').first().evaluate(type)).toEqual(await page.locator('h1').evaluate(type));
  await hold(page, 1.9);
  await expect(line).toHaveCount(0);
  await expect.poll(() => first.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe('translateY(170%)');
});

test('the tagline rises in at the centre, and has gone before the launch', async ({ page }) => {
  const tagline = page.locator('[data-intro-tagline]');
  const last = tagline.locator('span span').last();
  await open(page);
  await hold(page, 2.8);
  await expect.poll(() => last.evaluate((el) => (el as HTMLElement).style.transform)).toBe('translateY(0%)');
  const box = (await tagline.locator('> span').boundingBox())!;
  const view = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(2);
  await hold(page, 3.7);
  await expect(tagline).toHaveCount(0);
});

test('the info bar stays out of the intro', async ({ page }) => {
  await open(page);
  await expect(page.locator('[data-intro-title]')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Controls' })).toHaveCSS('opacity', '0');
});

test('it waits for images that are slow to load, but not for ever', async ({ page }) => {
  await page.route(/\.(avif|webp)$/, () => {});
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
  // Longer than the 5.6 s it takes with the images in. (The clock here starts a little after it does.)
  expect(ms).toBeGreaterThan(5800);
  expect(ms).toBeLessThan(9000);
});

test('the view\'s middle loads first, and what\'s off screen last', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const priorities = await page.locator('[data-canvas-layer] > div:not([hidden]) img').evaluateAll((images) => images.map((img) => (img as HTMLImageElement).fetchPriority));
  expect(priorities).toContain('high');
  expect(priorities).toContain('low');
});

test('with the images in, the videos on screen are fetched ahead of playing', async ({ page }) => {
  const videos = page.locator('[data-canvas] video');
  await open(page);
  await expect.poll(() => videos.evaluateAll((all) => all.some((v) => (v as HTMLVideoElement).preload === 'auto'))).toBe(true);
  expect(await videos.evaluateAll((all) => all.every((v) => (v as HTMLVideoElement).paused))).toBe(true);
});

test('draws lines at speed', async ({ page }) => {
  await open(page);
  await hold(page, 4.3);
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
    await expect(page.locator('[data-intro-tagline]')).toHaveCount(0);
    await expect(page.locator('[data-intro-line]')).toHaveCount(0);
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
