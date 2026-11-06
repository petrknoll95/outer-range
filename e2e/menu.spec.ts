import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  physics: { x: number; y: number; z: number };
  zoomState: () => 'out' | 'in';
  backing: () => { u: number; to: 0 | 1 } | null;
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const camera = (page: Page) =>
  page.evaluate(() => {
    const { x, y, z } = (window as unknown as { __canvas: Api }).__canvas.physics;
    return { x, y, z };
  });

const menu = (page: Page) => page.locator('dialog[data-menu]');
const box = (page: Page) => page.locator('[data-menu-box]');
/** Open, and done animating in. */
const opened = async (page: Page) => {
  await expect(menu(page)).toHaveAttribute('open');
  await page.waitForFunction(() => document.querySelector('dialog[data-menu]')!.getAnimations({ subtree: true }).length === 0);
};
const closed = (page: Page) => expect(menu(page)).not.toHaveAttribute('open');
/** The camera all the way back behind the open menu (main.ts, backAway), or home again. */
const backedAway = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.backing()?.u === 1);
const backHome = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.backing() === null);

/** Every tile drawn on screen: its centre, width, opacity and transform. */
const tiles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > *')]
      .filter((el) => el.style.visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, o: Number(getComputedStyle(el).opacity), t: el.style.transform };
      })
      .filter((t) => t.w > 0 && t.x > 0 && t.y > 0 && t.x < innerWidth && t.y < innerHeight),
  );

test('M opens the menu: a square at the centre, its links at the top and Start a project at the bottom, over the canvas far off behind it', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await expect(menu(page)).toBeHidden();

  await page.keyboard.press('m');
  await opened(page);
  const vp = page.viewportSize()!;
  const r = (await box(page).boundingBox())!;
  expect(r.width).toBe(576);
  expect(r.height).toBe(r.width);
  expect(Math.abs(r.x + r.width / 2 - vp.width / 2)).toBeLessThan(1);
  expect(Math.abs(r.y + r.height / 2 - vp.height / 2)).toBeLessThan(1);

  const links = box(page).getByRole('link');
  await expect(links).toHaveText(['Work', 'Projects', 'About', 'Journal', 'Start a project']);
  // The rest top-aligned, starting near the top of the square and ending well above its bottom;
  // Start a project on its own at the bottom, as far in from it as the first is from the top.
  const first = (await links.first().boundingBox())!;
  const rest = (await links.nth(3).boundingBox())!;
  const last = (await links.last().boundingBox())!;
  expect(first.y - r.y).toBeLessThan(r.height * 0.1);
  expect(rest.y + rest.height).toBeLessThan(r.y + r.height * 0.6);
  expect(r.y + r.height - (last.y + last.height)).toBeCloseTo(first.y - r.y, 0);

  // Translucent, and blurring what is under it.
  const style = await box(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { filter: s.backdropFilter, background: s.backgroundColor, font: getComputedStyle(el.querySelector('a')!).fontFamily };
  });
  expect(style.filter).toContain('blur(');
  expect(style.background).not.toMatch(/^(oklch|rgb)\([^/]*\)$/);
  expect(style.font).toContain('Timeless Sans');

  // The dialog has focus, not a link: none is ringed until Tab moves to the first.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('DIALOG');
  await page.keyboard.press('Tab');
  await expect(links.first()).toBeFocused();
});

test('opening, the camera backs away: every image drawn in towards the centre, by its depth, dimmer and softer; closing, all back exactly as it was', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const before = await tiles(page);
  // Each tile on screen as drawn now, kept on the page to compare the same tile with later.
  await page.evaluate(() => {
    const w = window as unknown as { __was: Map<Element, DOMRect> };
    w.__was = new Map([...document.querySelectorAll('[data-canvas-layer] > *')].map((el) => [el, el.getBoundingClientRect()]));
  });

  await page.keyboard.press('m');
  await backedAway(page);
  await opened(page);
  const drawn = await page.evaluate(() => {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const out: { ratio: number; inward: number; opacity: number; blurred: boolean }[] = [];
    for (const [el, was] of (window as unknown as { __was: Map<HTMLElement, DOMRect> }).__was) {
      const onScreen = was.right > 0 && was.bottom > 0 && was.left < innerWidth && was.top < innerHeight && was.width > 0;
      if (!onScreen || el.style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      const ratio = r.width / was.width;
      // How far its centre has come in towards the window's centre, as a share of where it was.
      const inward = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy) / Math.max(1, Math.hypot(was.x + was.width / 2 - cx, was.y + was.height / 2 - cy));
      out.push({ ratio, inward, opacity: Number(getComputedStyle(el).opacity), blurred: el.style.filter.includes('blur(') });
    }
    return out;
  });
  expect(drawn.length).toBeGreaterThan(8);
  const ratios = drawn.map((d) => d.ratio);
  // Drawn in, each by its depth: not all by as much.
  expect(Math.max(...ratios)).toBeLessThan(0.8);
  expect(Math.min(...ratios)).toBeGreaterThan(0.3);
  expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.05);
  for (const d of drawn) {
    // True perspective: its centre comes in by as much as it shrinks.
    expect(d.inward).toBeCloseTo(d.ratio, 1);
    expect(d.opacity).toBeLessThan(0.35);
    expect(d.blurred).toBe(true);
  }
  // The header has faded, and the info bar but for the menu's hint, which says Close now, ESC beside its M.
  await expect(page.locator('header')).toHaveCSS('opacity', '0');
  const bar = page.getByRole('complementary', { name: 'Controls' });
  const hint = bar.locator('[data-hint="menu"]');
  await expect(hint.locator('[data-hint-label]')).toHaveText('Close');
  const esc = hint.getByText('ESC', { exact: true }).locator('..');
  await expect(bar).toHaveCSS('opacity', '1');
  // (A hint that is a button sits in its item: InfoBar.astro.)
  const hintOf = (item: typeof bar) => item.evaluate((el) => (el.matches('[data-hint]') ? el : el.querySelector('[data-hint]'))?.getAttribute('data-hint') ?? null);
  for (const item of await bar.getByRole('listitem').all()) await expect(item).toHaveCSS('opacity', (await hintOf(item)) === 'menu' ? '1' : '0');
  await expect(esc).toHaveCSS('opacity', '1');
  // To the right of the M, the M having moved left to make room (KeyHint.astro).
  const [e, m] = await Promise.all([esc.boundingBox(), hint.getByText('M', { exact: true }).locator('..').boundingBox()]);
  expect(m!.x + m!.width).toBeLessThan(e!.x);
  expect(Math.abs(e!.y + e!.height / 2 - (m!.y + m!.height / 2))).toBeLessThan(0.5);

  await page.keyboard.press('Escape');
  await backHome(page);
  await closed(page);
  await settled(page);
  expect((await tiles(page)).map((t) => t.t)).toEqual(before.map((t) => t.t));
  await expect(page.locator('header')).toHaveCSS('opacity', '1');
  for (const item of await bar.getByRole('listitem').all()) await expect(item).toHaveCSS('opacity', '1');
  await expect(esc).toHaveCSS('opacity', '0');
});

test('open, the menu has the keyboard and the wheel: nothing moves under it, and nothing navigates', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const before = await camera(page);
  await page.keyboard.press('m');
  await opened(page);

  for (const key of ['ArrowRight', 'ArrowDown', ' ', '+', 'p', 'a']) await page.keyboard.press(key);
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await camera(page)).toEqual(before);
  await expect(menu(page)).toHaveAttribute('open');

  // A placeholder link goes nowhere. (About goes to the about view: wordmark.spec.ts.)
  await box(page).getByRole('link', { name: 'Journal' }).click();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).hash).toBe('');
});

test('closing, the canvas takes the wheel again at once: a scroll as it comes home moves it', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.mouse.move(720, 450);
  await page.keyboard.press('m');
  await backedAway(page);
  const before = await camera(page);
  await page.keyboard.press('Escape');
  // Scrolling the moment it closes, while it is still coming home.
  for (let n = 0; n < 10; n++) {
    await page.mouse.wheel(0, 30);
    await page.waitForTimeout(16);
  }
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.backing()?.to)).toBe(0);
  await expect.poll(async () => (await camera(page)).y - before.y).toBeGreaterThan(100);
  await backHome(page);
});

for (const zoomed of [false, true]) {
  test(`opened mid-scroll${zoomed ? ', zoomed in' : ''}, the scroll finishes under it: once home, no image moves`, async ({ page }) => {
    await page.goto('/?test');
    await settled(page);
    await page.mouse.move(720, 450);
    if (zoomed) {
      await page.keyboard.press('Space');
      await settled(page);
    }
    // Scrolling (zoomed in, paging on to the next image) as M is pressed.
    for (let n = 0; n < 18; n++) {
      await page.mouse.wheel(0, zoomed ? 60 : 40);
      await page.waitForTimeout(16);
    }
    await page.keyboard.press('m');
    await backedAway(page);
    await page.keyboard.press('Escape');
    await backHome(page);
    const at = () =>
      page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > :not([hidden])')].map((el) => [el.getBoundingClientRect().x, el.getBoundingClientRect().y]));
    const home = await at();
    await page.waitForTimeout(1000);
    const later = await at();
    // Home as it settled: no trail springing back, no glide on to an image.
    const moved = Math.max(...later.map(([x, y], n) => Math.hypot(x! - home[n]![0]!, y! - home[n]![1]!)));
    expect(moved).toBeLessThan(0.5);
  });
}

test('M, Esc and a click off the square each close it, and the canvas is back in charge', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);

  await page.keyboard.press('m');
  await opened(page);
  await page.keyboard.press('m');
  await closed(page);

  await page.keyboard.press('m');
  await opened(page);
  await page.keyboard.press('Escape');
  await closed(page);
  // That Esc was the menu's: the canvas didn't zoom or move for it.
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('out');

  await page.keyboard.press('m');
  await opened(page);
  const r = (await box(page).boundingBox())!;
  await page.mouse.click(r.x / 2, r.y + r.height / 2);
  await closed(page);

  // A click inside it doesn't.
  await page.keyboard.press('m');
  await opened(page);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height - 20);
  await page.waitForTimeout(400);
  await expect(menu(page)).toHaveAttribute('open');
  await page.keyboard.press('m');
  await closed(page);

  // Closed, the keys are the canvas's again.
  const before = await camera(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await camera(page)).x).not.toBe(before.x);
});

test('pressed again mid-close, it opens back up and stays open', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press('m');
  await opened(page);
  await page.keyboard.press('m');
  await page.waitForTimeout(80);
  await page.keyboard.press('m');
  await page.waitForTimeout(600);
  await expect(menu(page)).toHaveAttribute('open');
  expect(await menu(page).getAttribute('data-closing')).toBeNull();
});

test('it works on the about view too, the text backing away, and Esc there closes only the menu', async ({ page }) => {
  await page.goto('/about?test');
  const layer = page.locator('[data-about-layer]');
  await page.keyboard.press('m');
  await backedAway(page);
  await opened(page);
  const scale = await layer.evaluate((el) => Number(/scale\(([\d.]+)\)/.exec(el.style.transform)?.[1] ?? 1));
  expect(scale).toBeLessThan(0.8);
  expect(Number(await layer.evaluate((el) => el.style.opacity))).toBeLessThan(0.3);
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.keyboard.press('Escape');
  await backHome(page);
  await closed(page);
  expect(new URL(page.url()).pathname).toBe('/about');
  expect(await layer.evaluate((el) => [el.style.transform, el.style.opacity, el.style.filter])).toEqual(['', '1', '']);
});

for (const [name, width, height] of [
  ['portrait', 375, 812],
  ['landscape', 812, 375],
] as const) {
  test(`on a ${name} phone the square fits with 16 px round it`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?test');
    await settled(page);
    await page.keyboard.press('m');
    await opened(page);
    const r = (await box(page).boundingBox())!;
    const side = Math.min(width, height) - 32;
    expect(r.width).toBeCloseTo(side, 0);
    expect(r.height).toBeCloseTo(side, 0);
    expect(r.x + r.width / 2).toBeCloseTo(width / 2, 0);
    expect(r.y + r.height / 2).toBeCloseTo(height / 2, 0);
    // The links still fit, top-aligned.
    const last = (await box(page).getByRole('link').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThan(r.y + r.height);
  });
}

test('opening and closing it has no long animation frames', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  // Once the glass has been readied, a moment after the page opens (Menu.astro).
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const w = window as unknown as { __loaf: number[] };
    w.__loaf = [];
    const since = performance.now();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.startTime >= since) w.__loaf.push(e.duration);
    }).observe({ type: 'long-animation-frame', buffered: false });
  });
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press('m');
    await opened(page);
    await page.keyboard.press('Escape');
    await closed(page);
  }
  expect(await page.evaluate(() => (window as unknown as { __loaf: number[] }).__loaf)).toEqual([]);
});
