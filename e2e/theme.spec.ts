import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** The page's background: how light it is (0 black to 1 white), once any cross-fade has run. */
const lightness = (page: Page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    c.fillStyle = getComputedStyle(document.body).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return (r! + g! + b!) / 765;
  });
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? null);

for (const system of ['light', 'dark'] as const) {
  test(`with the system ${system}, L switches to the other theme and back, and the choice is kept`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.goto('/?test');
    await settled(page);
    const other = system === 'light' ? 'dark' : 'light';
    expect(await theme(page)).toBeNull();
    const start = await lightness(page);
    expect(start > 0.5).toBe(system === 'light');

    await page.keyboard.press('l');
    await expect.poll(() => theme(page)).toBe(other);
    await expect.poll(async () => (await lightness(page)) > 0.5).toBe(other === 'light');

    // Kept: a reload comes back in it, set before the page's own script runs (so it never flashes the other).
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => ((window as unknown as { __early: string | undefined }).__early = document.documentElement.dataset.theme));
    });
    await page.reload();
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { __early: string | undefined }).__early)).toBe(other);

    // And back, with Shift too.
    await page.keyboard.press('Shift+L');
    await expect.poll(() => theme(page)).toBe(system);
    await expect.poll(async () => (await lightness(page)) > 0.5).toBe(system === 'light');
  });
}

test('L works on the about view too', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/about?test');
  await page.keyboard.press('l');
  await expect.poll(() => theme(page)).toBe('dark');
  await expect.poll(async () => (await lightness(page)) < 0.5).toBe(true);
});
