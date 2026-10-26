import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  activeImage: () => { i: number; j: number; image: number; left: number; top: number; width: number; height: number } | null;
  physics: { x: number; y: number; z: number };
  zoomInLevel: () => number;
  project: () => { free: boolean; target: 0 | 1; overview: number } | null;
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const camera = (page: Page) => page.evaluate(() => (({ x, y, z }) => ({ x, y, z }))((window as unknown as { __canvas: Api }).__canvas.physics));
const state = (page: Page) => page.evaluate(() => document.documentElement.dataset.project ?? null);
const free = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.project()?.free ?? null);
const active = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage());
const zoomState = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState());
const landed = (page: Page) =>
  page.waitForFunction(() => {
    const c = (window as unknown as { __canvas: Api }).__canvas;
    return c.project()?.free && c.isSettled();
  }, null, { timeout: 30_000 });
const activeAlt = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { images: { alt: string }[] };
    return data.images[(window as unknown as { __canvas: Api }).__canvas.activeImage()!.image]!.alt;
  });

/** The focused image's project, as the page's data has it. */
const project = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { projects: { title: string; images: number[] }[]; images: { alt: string }[] };
    const image = (window as unknown as { __canvas: Api }).__canvas.activeImage()!.image;
    const p = data.projects.find((p) => p.images.includes(image))!;
    return { title: p.title, alts: p.images.map((n) => data.images[n]!.alt) };
  });

/** Zoomed in on an image of a project with `min` to `max` images. */
async function focusOnProject(page: Page, min = 3, max = 99): Promise<void> {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  for (let n = 0; n < 40; n++) {
    const size = (await project(page)).alts.length;
    if (size >= min && size <= max) return;
    await page.keyboard.press('ArrowRight');
    await settled(page);
  }
  throw new Error(`No project of ${min}–${max} images within reach.`);
}

/** The tiles drawn now that can be seen: what they show, where, and how visible. */
const seen = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div:not([hidden])')]
      .map((el) => ({ el, opacity: Number(getComputedStyle(el).opacity), visible: getComputedStyle(el).visibility !== 'hidden' }))
      .filter((t) => t.visible && t.opacity > 0.02)
      .map(({ el, opacity }) => {
        const r = el.getBoundingClientRect();
        return { alt: el.querySelector('img')!.alt, opacity, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
  );

/** Every frame for `ms`: the camera, and the frame gaps. */
const recordCamera = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<{ rows: number[][]; gap: number }>((resolve) => {
        const c = (window as unknown as { __canvas: Api }).__canvas;
        const rows: number[][] = [];
        let last = performance.now();
        const t0 = last;
        let gap = 0;
        const tick = () => {
          const now = performance.now();
          gap = Math.max(gap, now - last);
          last = now;
          rows.push([now - t0, c.physics.x, c.physics.y, c.physics.z]);
          if (now - t0 < ms) requestAnimationFrame(tick);
          else resolve({ rows, gap });
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

test('P narrows the canvas to the project: the camera draws back and only the project’s images are left, round the focused one', async ({ page }) => {
  await focusOnProject(page, 5);
  const { alts } = await project(page);
  const before = await camera(page);
  await page.keyboard.press('p');
  expect(await state(page)).toBe('open');
  await page.waitForTimeout(1600);
  const after = await camera(page);
  // Drawn back from the focused view.
  expect(after.z).toBeLessThan(before.z * 0.8);
  // What can be seen is the project, every image of it, whole on screen, and nothing else.
  const tiles = await seen(page);
  expect(tiles.map((t) => t.alt).sort()).toEqual([...alts].sort());
  for (const t of tiles) {
    expect(t.opacity).toBe(1);
    expect(t.left).toBeGreaterThanOrEqual(0);
    expect(t.top).toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(1440);
    expect(t.bottom).toBeLessThanOrEqual(900);
  }
  // The focused image keeps its frame, and the frame its project label; the caption stands aside.
  await expect(page.locator('.focus-project')).toHaveText((await project(page)).title);
  await expect(page.locator('.focus-caption')).toBeHidden();
});

test('on its way in the canvas takes no input; landed, it is dragged and scrolled like the canvas, and kept over the project', async ({ page }) => {
  await focusOnProject(page, 5);
  const { alts } = await project(page);
  await page.keyboard.press('p');
  await page.waitForTimeout(150);
  const moving = await camera(page);
  await page.mouse.move(1300, 450);
  await page.mouse.wheel(400, 0);
  await page.waitForTimeout(50);
  // Only the way in moved it: on towards the overview, not sideways by the scroll.
  expect((await camera(page)).z).toBeLessThan(moving.z);
  await landed(page);
  const rest = await camera(page);
  // A drag carries it, as on the canvas, and let go, it settles back where all of it is in view.
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(620, 430, { steps: 8 });
  await page.waitForTimeout(100);
  const held = await camera(page);
  expect(held.x).toBeGreaterThan(rest.x + 20);
  expect(held.z).toBe(rest.z);
  await page.mouse.up();
  await settled(page);
  for (const t of await seen(page)) expect(t.left >= 0 && t.right <= 1440 && t.top >= 0 && t.bottom <= 900).toBe(true);
  // A scroll too.
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(120);
  expect((await camera(page)).y).toBeGreaterThan(rest.y + 20);
  await settled(page);
  // Thrown far off, it glides back until the whole project is in view again: its images, and only them, all of each on screen.
  for (let n = 0; n < 4; n++) await page.mouse.wheel(3000, 0);
  await settled(page);
  const tiles = await seen(page);
  expect(tiles.map((t) => t.alt).sort()).toEqual([...alts].sort());
  for (const t of tiles) {
    expect(t.left).toBeGreaterThanOrEqual(0);
    expect(t.right).toBeLessThanOrEqual(1440);
    expect(t.top).toBeGreaterThanOrEqual(0);
    expect(t.bottom).toBeLessThanOrEqual(900);
  }
  expect(await free(page)).toBe(true);
});

test('landed, focusing one of its images leaves the project view onto it: the camera follows it back to where it lives on the canvas', async ({ page }) => {
  await focusOnProject(page, 4);
  const { alts } = await project(page);
  const homeAlt = await activeAlt(page);
  await page.keyboard.press('p');
  await landed(page);
  expect(await zoomState(page)).toBe('out');
  // A click on another of its images.
  const other = (await seen(page)).find((t) => t.alt !== homeAlt)!;
  await page.mouse.click((other.left + other.right) / 2, (other.top + other.bottom) / 2);
  expect(await state(page)).toBe('closing');
  await settled(page);
  expect(await state(page)).toBeNull();
  // The focused view on it, centred, with its caption, and the canvas round it again.
  expect(await zoomState(page)).toBe('in');
  expect(await activeAlt(page)).toBe(other.alt);
  expect((await camera(page)).z).toBeCloseTo(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomInLevel()), 6);
  const a = (await active(page))!;
  expect(Math.abs(a.left + a.width / 2 - 720)).toBeLessThan(2);
  expect(Math.abs(a.top + a.height / 2 - 450)).toBeLessThan(2);
  await expect(page.locator('.focus-caption')).toBeVisible();
  expect((await seen(page)).some((t) => !alts.includes(t.alt))).toBe(true);
  // Where it lives: the cell there shows it.
  const cell = await page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api & { world: { cell: (i: number, j: number) => { image: number } } } }).__canvas;
    const x = c.activeImage()!;
    return { shown: c.world.cell(x.i, x.j).image, image: x.image };
  });
  expect(cell.shown).toBe(cell.image);
  // Space does the same, onto the image in the frame; paging from there is the canvas's own.
  await page.keyboard.press('p');
  await landed(page);
  const framed = await activeAlt(page);
  await page.keyboard.press(' ');
  await settled(page);
  expect(await state(page)).toBeNull();
  expect(await activeAlt(page)).toBe(framed);
  await page.keyboard.press('ArrowRight');
  await settled(page);
  expect(await zoomState(page)).toBe('in');
});

test('P or Esc leaves from anywhere: dragged off, it glides smoothly back to the image it was opened on', async ({ page }) => {
  await focusOnProject(page, 3);
  const before = await camera(page);
  const home = await active(page);
  for (const key of ['p', 'Escape']) {
    await page.keyboard.press('p');
    await landed(page);
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(560, 380, { steps: 8 });
    await page.mouse.up();
    await settled(page);
    const closing = recordCamera(page, 1800);
    await page.keyboard.press(key);
    const { rows, gap } = await closing;
    expect(gap).toBeLessThan(50);
    // The camera moves on from where it was, never jumping.
    const steps = rows.slice(1).map((r, n) => Math.hypot(r[1]! - rows[n]![1]!, r[2]! - rows[n]![2]!) * r[3]!);
    expect(Math.max(...steps)).toBeLessThan(80);
    await settled(page);
    expect(await state(page)).toBeNull();
    expect(await camera(page)).toEqual(before);
    expect(await active(page)).toEqual(home);
    expect(await zoomState(page)).toBe('in');
  }
});

test('P sets off seamlessly: every tile carries on from where it was, as it was, and no image is ever shown twice over itself', async ({ page }) => {
  await focusOnProject(page, 5);
  // Every frame from just before P for 1.2 s: each visible tile, its element, what it shows, where and how visible.
  const frames = page.evaluate(
    () =>
      new Promise<{ id: number; alt: string; opacity: number; l: number; t: number; r: number; b: number }[][]>((resolve) => {
        const ids = new Map<Element, number>();
        const out: { id: number; alt: string; opacity: number; l: number; t: number; r: number; b: number }[][] = [];
        const t0 = performance.now();
        const grab = () => {
          out.push(
            [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div:not([hidden])')]
              .map((el) => ({ el, cs: getComputedStyle(el) }))
              .filter(({ cs }) => cs.visibility !== 'hidden' && Number(cs.opacity) > 0.02)
              .map(({ el, cs }) => {
                if (!ids.has(el)) ids.set(el, ids.size);
                const r = el.getBoundingClientRect();
                return { id: ids.get(el)!, alt: el.querySelector('img')!.alt, opacity: Number(cs.opacity), l: r.left, t: r.top, r: r.right, b: r.bottom };
              })
              .filter((x) => x.r > 0 && x.l < innerWidth && x.b > 0 && x.t < innerHeight),
          );
          if (performance.now() - t0 < 1200) requestAnimationFrame(grab);
          else resolve(out);
        };
        requestAnimationFrame(grab);
      }),
  );
  await page.waitForTimeout(50);
  await page.keyboard.press('p');
  const rows = await frames;
  // The last frame before P moved anything, and the first after.
  const n = rows.findIndex((f, k) => k > 0 && JSON.stringify(f) !== JSON.stringify(rows[k - 1]));
  expect(n).toBeGreaterThan(0);
  const [before, after] = [rows[n - 1]!, rows[n]!];
  // Nothing new shows up: every tile seen now was there, showing the same, barely moved, as visible.
  for (const t of after) {
    const was = before.find((b) => b.id === t.id);
    expect(was, `a tile appeared: ${t.alt}`).toBeDefined();
    expect(t.alt).toBe(was!.alt);
    expect(Math.abs(t.l - was!.l)).toBeLessThan(40);
    expect(Math.abs(t.t - was!.t)).toBeLessThan(40);
    expect(Math.abs(t.opacity - was!.opacity)).toBeLessThan(0.08);
  }
  // At no point do two tiles of one image overlap: no copy is left behind where its image set off from.
  for (const f of rows) {
    for (const a of f) {
      for (const b of f) {
        if (a.id >= b.id || a.alt !== b.alt) continue;
        const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l) > 2 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 2;
        expect(overlap, `${a.alt} twice over itself`).toBe(false);
      }
    }
  }
});

test('closing hands each image back to its own cell: the tile that came back is the one left there', async ({ page }) => {
  await focusOnProject(page, 5);
  const tiles = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div:not([hidden])')]
        .filter((el) => getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0.02)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { alt: el.querySelector('img')!.alt, l: Math.round(r.left), t: Math.round(r.top), o: Number(getComputedStyle(el).opacity).toFixed(2) };
        })
        .sort((a, b) => a.l - b.l || a.t - b.t),
    );
  const before = await tiles();
  await page.keyboard.press('p');
  await landed(page);
  await page.keyboard.press('p');
  await settled(page);
  // The canvas exactly as it was: the same images in the same places, as faded.
  expect(await tiles()).toEqual(before);
});

test('it moves as one smooth motion, and closing returns to exactly the focused view', async ({ page }) => {
  await focusOnProject(page, 3);
  const before = await camera(page);
  const active = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage());
  const opening = recordCamera(page, 1600);
  await page.keyboard.press('p');
  const open = await opening;
  expect(open.gap).toBeLessThan(50);
  // The zoom falls steadily, never back up, from where it was to where it rests.
  const zs = open.rows.map((r) => r[3]!);
  for (let n = 1; n < zs.length; n++) expect(zs[n]!).toBeLessThanOrEqual(zs[n - 1]! + 1e-9);
  // From where it was (the first frame recorded may already be a step in).
  expect(Math.abs(Math.log(zs[0]! / before.z))).toBeLessThan(0.02);
  // No step bigger than a little (at 60 fps): it eases out of the start and into the end.
  const steps = zs.slice(1).map((z, n) => Math.abs(Math.log(z / zs[n]!)));
  expect(Math.max(...steps)).toBeLessThan(0.08);
  expect(steps[0]!).toBeLessThan(Math.max(...steps) * 0.5);
  const closing = recordCamera(page, 1800);
  await page.keyboard.press('p');
  const close = await closing;
  expect(close.gap).toBeLessThan(50);
  await settled(page);
  expect(await state(page)).toBeNull();
  // Exactly where it was: the same view, the same image framed, the caption back.
  expect(await camera(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage())).toEqual(active);
  await expect(page.locator('.focus-caption')).toBeVisible();
});

test('a change of mind mid-way turns it round smoothly: the zoom never jumps, and turns without a jolt', async ({ page }) => {
  await focusOnProject(page, 3);
  const rec = recordCamera(page, 2200);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  await page.waitForTimeout(200);
  await page.keyboard.press('p');
  const { rows } = await rec;
  const logz = rows.map((r) => Math.log(r[3]!));
  // Small steps only, and the speed changes gradually (momentum carries through each turn).
  const v = logz.slice(1).map((z, n) => z - logz[n]!);
  expect(Math.max(...v.map(Math.abs))).toBeLessThan(0.08);
  for (let n = 1; n < v.length; n++) expect(Math.abs(v[n]! - v[n - 1]!)).toBeLessThan(0.012);
  await page.waitForTimeout(600);
  expect(await state(page)).toBe('open');
});

test('videos hold still while it moves, and play once it has landed', async ({ page }) => {
  // Off Menu, the big project, has videos.
  await focusOnProject(page, 9);
  const playing = () => page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.closest('[hidden]')).length);
  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  expect(await playing()).toBe(0);
  await expect.poll(playing, { timeout: 4000 }).toBeGreaterThan(0);
});

test('Esc on its way in or from the overview closes it, and P zoomed out does nothing', async ({ page }) => {
  await focusOnProject(page, 3);
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await state(page)).toBeNull();
  // Esc closed the project view, not the focused view.
  expect(await zoomState(page)).toBe('in');
  await page.keyboard.press('p');
  await landed(page);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await state(page)).toBeNull();
  expect(await zoomState(page)).toBe('in');
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('out');
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  expect(await state(page)).toBeNull();
});

test('with reduced motion nothing moves: the camera is there at once and the canvas only fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await focusOnProject(page, 3);
  const rec = recordCamera(page, 600);
  await page.keyboard.press('p');
  const { rows } = await rec;
  const zs = [...new Set(rows.map((r) => r[3]!.toFixed(6)))];
  // Two zooms only: before, and the project's.
  expect(zs.length).toBeLessThanOrEqual(2);
  await page.keyboard.press('p');
  await settled(page);
  expect(await state(page)).toBeNull();
});

test('going to the about view ends it at once', async ({ page }) => {
  await focusOnProject(page, 3);
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  await page.keyboard.press('a');
  await page.waitForURL((url) => url.pathname === '/about');
  expect(await state(page)).toBeNull();
});
