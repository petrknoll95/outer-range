import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  physics: { x: number; y: number };
  flight: () => { back: boolean } | null;
}

// Playwright starts Chromium with the back/forward cache off, and its default headless shell
// has none: this runs in full (new headless) Chromium with it on, as people browse.
test.use({ channel: 'chromium', launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] } });

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

test('Back restores the canvas from the cache: the images fly back from the camera into place, and it browses again', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  // The centremost tile, and where it is drawn.
  const placed = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')];
    const d = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2);
    };
    const el = tiles.reduce((a, b) => (d(a) <= d(b) ? a : b));
    el.dataset.watch = '';
    // From the moment the page comes back, record that tile every frame.
    addEventListener('pageshow', (e) => {
      const w = window as unknown as { __back: { persisted: boolean; frames: [number, number][] } };
      w.__back = { persisted: e.persisted, frames: [] };
      const t0 = performance.now();
      const tick = () => {
        const m = /scale\(([-\d.e]+)\)/.exec(el.style.transform);
        w.__back.frames.push([m ? Number(m[1]) : 1, el.style.opacity === '' ? 1 : Number(el.style.opacity)]);
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { transform: el.style.transform, opacity: el.style.opacity };
  });
  await page.getByRole('link', { name: 'About' }).click();
  await page.waitForURL(/\/about\/?$/, { timeout: 5000 });
  // A restore from the cache fires no load event.
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __canvas?: Api }).__canvas;
      return c && c.flight() === null && c.isSettled();
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => (window as unknown as { __back: { persisted: boolean; frames: [number, number][] } }).__back);
  expect(back.persisted).toBe(true);
  // It comes back large and faint (or gone) and shrinks steadily into place, opaque again.
  const [first] = back.frames;
  expect(first![1]).toBeLessThan(0.5);
  for (let n = 1; n < back.frames.length; n++) {
    expect(back.frames[n]![0]).toBeLessThanOrEqual(back.frames[n - 1]![0] + 1e-9);
    expect(back.frames[n]![1]).toBeGreaterThanOrEqual(back.frames[n - 1]![1] - 1e-9);
  }
  expect(await page.locator('[data-watch]').evaluate((el) => ({ transform: el.style.transform, opacity: el.style.opacity }))).toEqual(placed);
  await expect(page.locator('header')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-leaving'))).toBe(false);
  // And it browses again.
  const x = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(300, 0);
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x)).not.toBe(x);
});
