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

test('Timeless Sans is the page font, and the wordmark is set in its medium weight', async ({ page }) => {
  await open(page);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const h1 = document.querySelector('h1')!;
    return {
      body: getComputedStyle(document.body).fontFamily,
      wordmark: getComputedStyle(h1).fontFamily,
      weight: getComputedStyle(h1).fontWeight,
      loaded: [...document.fonts].filter((f) => f.family.startsWith('Timeless Sans') && f.status === 'loaded').map((f) => f.weight),
    };
  });
  expect(fonts.body).toMatch(/^"Timeless Sans/);
  expect(fonts.wordmark).toMatch(/^"Timeless Sans/);
  expect(fonts.weight).toBe('500');
  expect(fonts.loaded).toContain('500');
});

test('Timeless Serif is there to use, upright and italic, and loads only when asked for', async ({ page }) => {
  await open(page);
  const serif = await page.evaluate(async () => {
    await document.fonts.ready;
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-timeless-serif');
    const loaded = () =>
      [...document.fonts].filter((f) => f.family.startsWith('Timeless Serif') && f.status === 'loaded').map((f) => `${f.weight} ${f.style}`);
    const before = loaded();
    await document.fonts.load(`400 16px ${family}`);
    await document.fonts.load(`italic 400 16px ${family}`);
    return { family, before, after: loaded() };
  });
  expect(serif.family).toMatch(/^"Timeless Serif/);
  expect(serif.before).toEqual([]);
  expect(serif.after).toEqual(expect.arrayContaining(['400 normal', '400 italic']));
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
