import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  physics: { x: number; y: number };
}

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
}

test('the wordmark sits at the top centre', async ({ page }) => {
  await open(page);
  const wordmark = page.getByRole('heading', { level: 1, name: 'Petr Knoll' });
  await expect(wordmark).toBeVisible();
  const box = (await wordmark.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(1440 / 2, 0);
  // Centred on a 36 px band 16 px from the top.
  expect(Math.abs(box.y + box.height / 2 - 34)).toBeLessThan(1);
});

test('PP Neue Montreal is the page font, and the wordmark is set in its medium weight', async ({ page }) => {
  await open(page);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const h1 = document.querySelector('h1')!;
    return {
      body: getComputedStyle(document.body).fontFamily,
      wordmark: getComputedStyle(h1).fontFamily,
      weight: getComputedStyle(h1).fontWeight,
      loaded: [...document.fonts].filter((f) => f.family.startsWith('PP Neue Montreal') && f.status === 'loaded').map((f) => f.weight),
    };
  });
  expect(fonts.body).toMatch(/^"PP Neue Montreal/);
  expect(fonts.wordmark).toMatch(/^"PP Neue Montreal/);
  expect(fonts.weight).toBe('500');
  expect(fonts.loaded).toContain('500');
});

test('dragging across the wordmark moves the canvas', async ({ page }) => {
  await open(page);
  const box = (await page.getByRole('heading', { name: 'Petr Knoll' }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // The canvas is what's under the pointer there, not the wordmark.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('h1') === null, [x, y])).toBe(true);
  const before = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 150, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.y);
  expect(after).toBeLessThan(before - 50);
});
