import { expect, test, type Page } from '@playwright/test';

/** Where the header's wordmark and link sit, and how they are set. */
const header = (page: Page) =>
  page.evaluate(() => {
    const read = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), type: [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.color] };
    };
    return { mark: read(document.querySelector('header h1')!), link: read(document.querySelector('header a')!) };
  });

test('the about view has the same header, with Back in place of About, and is otherwise blank', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const home = await header(page);
  await page.goto('/about');
  await page.evaluate(() => document.fonts.ready);
  const about = await header(page);
  expect(about.mark).toEqual(home.mark);
  // The same type on the same line, right-aligned in the same place.
  expect([about.link.type, about.link.top, about.link.bottom, about.link.right]).toEqual([home.link.type, home.link.top, home.link.bottom, home.link.right]);
  await expect(page.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'About' })).toHaveCount(0);
  await expect(page).toHaveTitle('About · Petr Knoll');
  // Below the header, nothing: the canvas is flown past.
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].every((el) => getComputedStyle(el).opacity === '0' || el.getBoundingClientRect().bottom < 0 || el.getBoundingClientRect().top > innerHeight || el.getBoundingClientRect().right < 0 || el.getBoundingClientRect().left > innerWidth))).toBe(true);
});
