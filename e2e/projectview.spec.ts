import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  activeImage: () => { image: number; left: number; top: number; width: number; height: number } | null;
  physics: { x: number; y: number; z: number };
  route: () => 'home' | 'about';
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const api = <T,>(page: Page, fn: (c: Api) => T) => page.evaluate((src) => new Function('c', `return (${src})(c)`)((window as unknown as { __canvas: Api }).__canvas), fn.toString()) as Promise<T>;

/** The focused image's project, as the page's data has it. */
const project = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { projects: { title: string; images: number[] }[]; images: { alt: string }[] };
    const image = (window as unknown as { __canvas: Api }).__canvas.activeImage()!.image;
    const p = data.projects.find((p) => p.images.includes(image))!;
    return { title: p.title, alts: p.images.map((n) => data.images[n]!.alt), focusedAlt: data.images[image]!.alt };
  });

/** Zoomed in on an image of a project with at least `min` images. */
async function focusOnProject(page: Page, min = 3): Promise<void> {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  for (let n = 0; n < 30 && (await project(page)).alts.length < min; n++) {
    await page.keyboard.press('ArrowRight');
    await settled(page);
  }
}

/** The cards as drawn: where, how big, how visible, stacked how, and what they show. */
const cards = (page: Page) =>
  page.locator('.project-card').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, opacity: Number(getComputedStyle(el).opacity), z: Number(el.style.zIndex), alt: el.querySelector('img')!.alt };
    }),
  );

/** Record the first card's (the focused image's) rectangle every frame, and the longest gap between frames. */
const recordFocused = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<{ rows: number[][]; gap: number }>((resolve) => {
        const rows: number[][] = [];
        let last = performance.now();
        const t0 = last;
        let gap = 0;
        const tick = () => {
          const now = performance.now();
          gap = Math.max(gap, now - last);
          last = now;
          const el = document.querySelector('.project-card');
          const r = el?.getBoundingClientRect();
          rows.push(r ? [now - t0, r.left, r.top, r.width] : [now - t0]);
          if (now - t0 < ms) requestAnimationFrame(tick);
          else resolve({ rows, gap });
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

test('P in the focused view brings the whole project round a ring, overlapping, the focused image at the front', async ({ page }) => {
  await focusOnProject(page, 5);
  const { title, alts, focusedAlt } = await project(page);
  await page.keyboard.press('p');
  await page.waitForTimeout(1300);
  const all = await cards(page);
  expect(all.map((c) => c.alt).sort()).toEqual([...alts].sort());
  // The focused image first, in front of the rest, at the bottom of the ring.
  expect(all[0]!.alt).toBe(focusedAlt);
  expect(Math.max(...all.map((c) => c.z))).toBe(all[0]!.z);
  const centres = all.map((c) => [c.left + c.width / 2, c.top + c.height / 2] as const);
  expect(centres[0]![1]).toBeGreaterThan(450);
  // On one circle about the window's centre, every card whole on screen, each overlapping the next.
  const radii = centres.map(([x, y]) => Math.hypot(x - 720, y - 450));
  for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 0);
  for (const c of all) {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.top).toBeGreaterThanOrEqual(0);
    expect(c.left + c.width).toBeLessThanOrEqual(1440);
    expect(c.top + c.height).toBeLessThanOrEqual(900);
    expect(c.opacity).toBe(1);
  }
  const overlaps = (a: (typeof all)[number], b: (typeof all)[number]) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  for (let k = 0; k < all.length; k++) expect(overlaps(all[k]!, all[(k + 1) % all.length]!)).toBe(true);
  // Its name at the centre; the frame and caption stood aside.
  await expect(page.locator('.project-view-title')).toHaveText(title);
  await expect.poll(() => page.locator('.focus-frame').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect(page.locator('.focus-caption')).toBeHidden();
  // The canvas takes no input meanwhile.
  const before = await api(page, (c) => [c.physics.x, c.physics.y, c.physics.z]);
  await page.keyboard.press('ArrowRight');
  await page.mouse.move(100, 450);
  await page.mouse.wheel(400, 0);
  await page.waitForTimeout(300);
  expect(await api(page, (c) => [c.physics.x, c.physics.y, c.physics.z])).toEqual(before);
});

test('opening starts from the focused image exactly where it is drawn, and closing puts it back there', async ({ page }) => {
  await focusOnProject(page, 3);
  const tile = (await api(page, (c) => c.activeImage()))!;
  // No pop: the moment it opens, before a frame has moved it, the focused image's copy is the tile, to the subpixel.
  const start = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
    const r = document.querySelector('.project-card')!.getBoundingClientRect();
    return [r.left, r.top, r.width];
  });
  expect(Math.abs(start[0]! - tile.left)).toBeLessThan(0.05);
  expect(Math.abs(start[1]! - tile.top)).toBeLessThan(0.05);
  expect(Math.abs(start[2]! - tile.width)).toBeLessThan(0.05);
  const { gap } = await recordFocused(page, 1300);
  expect(gap).toBeLessThan(50);
  const closing = recordFocused(page, 1100);
  await page.keyboard.press('p');
  const back = await closing;
  expect(back.gap).toBeLessThan(50);
  // Its last frame (before the copies go) is the tile again, which is back and the view gone.
  const last = back.rows.filter((r) => r.length > 1).at(-1)!;
  expect(Math.abs(last[1]! - tile.left)).toBeLessThan(1);
  expect(Math.abs(last[2]! - tile.top)).toBeLessThan(1);
  expect(Math.abs(last[3]! - tile.width)).toBeLessThan(1);
  await expect(page.locator('.project-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.project ?? null)).toBeNull();
  expect(await api(page, (c) => c.activeImage())).toEqual(tile);
  // The caption comes back.
  await expect(page.locator('.focus-caption')).toBeVisible();
});

test('a change of mind mid-way turns it round from where it is, never jumping', async ({ page }) => {
  await focusOnProject(page, 5);
  const rec = recordFocused(page, 1800);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  await page.keyboard.press('p');
  const { rows } = await rec;
  const drawn = rows.filter((r) => r.length > 1);
  // Frame to frame it only ever moves a little: never a jump back to either end.
  for (let n = 1; n < drawn.length; n++) {
    expect(Math.abs(drawn[n]![1]! - drawn[n - 1]![1]!)).toBeLessThan(40);
    expect(Math.abs(drawn[n]![2]! - drawn[n - 1]![2]!)).toBeLessThan(40);
    expect(Math.abs(drawn[n]![3]! - drawn[n - 1]![3]!)).toBeLessThan(40);
  }
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.dataset.project)).toBe('open');
});

test('Esc or a click closes it, and P zoomed out does nothing', async ({ page }) => {
  await focusOnProject(page, 3);
  await page.keyboard.press('p');
  await expect(page.locator('.project-card').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.project-card')).toHaveCount(0);
  // Esc closed the project view, not the focused view.
  expect(await api(page, (c) => c.zoomState())).toBe('in');
  await page.keyboard.press('p');
  await page.waitForTimeout(1000);
  await page.mouse.click(720, 450);
  await expect(page.locator('.project-card')).toHaveCount(0);
  expect(await api(page, (c) => c.zoomState())).toBe('in');
  await settled(page);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await api(page, (c) => c.zoomState())).toBe('out');
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await expect(page.locator('.project-card')).toHaveCount(0);
});

test('with reduced motion nothing moves: the ring fades in where it sits, and out', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await focusOnProject(page, 3);
  const rec = recordFocused(page, 600);
  await page.keyboard.press('p');
  const { rows } = await rec;
  const drawn = rows.filter((r) => r.length > 1);
  for (const r of drawn) {
    expect(r[1]).toBeCloseTo(drawn[0]![1]!, 0);
    expect(r[2]).toBeCloseTo(drawn[0]![2]!, 0);
  }
  await page.keyboard.press('p');
  await expect(page.locator('.project-card')).toHaveCount(0);
});

test('going to the about view ends it at once', async ({ page }) => {
  await focusOnProject(page, 3);
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  await page.keyboard.press('a');
  await page.waitForURL((url) => url.pathname === '/about');
  await expect(page.locator('.project-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.project ?? null)).toBeNull();
});
