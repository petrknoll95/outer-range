import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  activeImage: () => { image: number } | null;
  zoomState: () => 'out' | 'in';
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** The project the active image belongs to, as the page's data has it. */
const activeProject = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { projects: { title: string; images: number[] }[] };
    const image = (window as unknown as { __canvas: Api }).__canvas.activeImage()!.image;
    return data.projects.find((p) => p.images.includes(image))!.title;
  });

/** What the label says and whether it shows (fully), once its fade has run. */
const label = (page: Page) =>
  page.locator('.focus-project').evaluate((el) => ({ text: el.textContent, opacity: Number(getComputedStyle(el).opacity) }));

test('the active image’s project sits in a pill just above the frame’s top-left corner', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await expect.poll(() => label(page)).toEqual({ text: await activeProject(page), opacity: 1 });
  const [pill, frame] = await Promise.all([page.locator('.focus-project').boundingBox(), page.locator('.focus-frame').boundingBox()]);
  expect(pill!.x).toBeCloseTo(frame!.x, 0);
  expect(frame!.y - (pill!.y + pill!.height)).toBeCloseTo(8, 0);
  // Small, round, translucent: a tint over a blur of what is behind it.
  const style = await page.locator('.focus-project').evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, radius: s.borderRadius, blur: s.backdropFilter, background: s.backgroundColor, events: s.pointerEvents };
  });
  expect(style).toMatchObject({ size: '12px', radius: '9999px', blur: 'blur(12px)', events: 'none' });
  expect(style.background).toMatch(/color\(srgb [\d.]+ [\d.]+ [\d.]+ \/ 0\.1\d*\)|rgba\(\d+, \d+, \d+, 0\.1\d*\)|oklab\([^)]* \/ 0\.1\d*\)/);
});

test('zoomed in it stays, naming the focused image’s project in place of a title', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  await expect.poll(() => label(page)).toEqual({ text: await activeProject(page), opacity: 1 });
  const [pill, frame] = await Promise.all([page.locator('.focus-project').boundingBox(), page.locator('.focus-frame').boundingBox()]);
  expect(pill!.x).toBeCloseTo(frame!.x, 0);
  expect(frame!.y - (pill!.y + pill!.height)).toBeCloseTo(8, 0);
  // Paging to another project's image, it names that one.
  const first = await activeProject(page);
  for (let n = 0; n < 12 && (await activeProject(page)) === first; n++) {
    await page.keyboard.press('ArrowRight');
    await settled(page);
  }
  await expect.poll(() => label(page)).toEqual({ text: await activeProject(page), opacity: 1 });
});

test('moving to an image of another project, the label follows', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const first = await activeProject(page);
  // Step right until the active image is in another project.
  for (let n = 0; n < 12 && (await activeProject(page)) === first; n++) {
    await page.keyboard.press('ArrowRight');
    await settled(page);
  }
  const now = await activeProject(page);
  expect(now).not.toBe(first);
  await expect.poll(() => label(page)).toEqual({ text: now, opacity: 1 });
});

test('the frame and its label are drawn over every tile, so an overlapping neighbour never covers them', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const z = await page.evaluate(() => ({
    frame: Number(getComputedStyle(document.querySelector('.focus-frame')!).zIndex),
    tiles: Math.max(...[...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].map((t) => Number(t.style.zIndex))),
    sameLayer: document.querySelector('.focus-frame')!.parentElement === document.querySelector('[data-canvas-layer]')!.parentElement,
  }));
  expect(z.sameLayer).toBe(true);
  expect(z.frame).toBeGreaterThan(z.tiles);
});
