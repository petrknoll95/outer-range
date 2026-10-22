import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  world: { cell: (i: number, j: number) => { image: number; dx: number; dy: number } };
  geometry: () => { pitch: number; s: number; vw: number; vh: number };
  physics: { jumpTo: (x: number, y: number, z: number) => void };
  onFrame: (fn: () => void) => () => void;
}

/** Wake the canvas loop for a frame, so a camera placed with jumpTo is drawn there (at rest, the loop sleeps). */
const redraw = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const off = (window as unknown as { __canvas: Api }).__canvas.onFrame(() => {
          off();
          requestAnimationFrame(() => resolve());
        });
      }),
  );

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** A video's URLs: the full copy and the small one for tiles drawn small. */
interface Clip {
  full: string;
  small: string;
}

/** Centre the view on the nearest cell showing a video; returns that video's URLs. */
async function centreOnVideo(page: Page): Promise<Clip> {
  const clip = await page.evaluate(() => {
    const api = (window as unknown as { __canvas: Api }).__canvas;
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { images: { video?: string; videoSmall?: string }[] };
    const g = api.geometry();
    for (let r = 0; r < 12; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const cell = api.world.cell(i, j);
          const { video, videoSmall } = data.images[cell.image]!;
          if (!video) continue;
          const cx = i * g.pitch + cell.dx * g.s;
          const cy = j * g.pitch + cell.dy * g.s;
          api.physics.jumpTo(cx - g.vw / 2, cy - g.vh / 2, 1);
          return { full: video, small: videoSmall! };
        }
      }
    }
    throw new Error('No video within 12 cells.');
  });
  await redraw(page);
  await settled(page);
  return { full: new URL(clip.full, page.url()).href, small: new URL(clip.small, page.url()).href };
}

/** The tile playing `clip` (either copy) drawn nearest the viewport centre, as it is now. */
const centreVideo = (page: Page, clip: Clip) =>
  page.evaluate((clip) => {
    const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-canvas-layer] video')].filter(
      (v) => (v.src === clip.full || v.src === clip.small) && !v.closest('[hidden]'),
    );
    const distance = (v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2);
    };
    const v = videos.sort((a, b) => distance(a) - distance(b))[0];
    return v
      ? { paused: v.paused, time: v.currentTime, shown: v.dataset.waiting === undefined, muted: v.muted, loop: v.loop, copy: v.src === clip.small ? 'small' : 'full' }
      : null;
  }, clip);

test('a video tile on screen plays, muted and looping, over its poster frame', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const src = await centreOnVideo(page);
  await expect.poll(async () => (await centreVideo(page, src))?.shown, { timeout: 10_000 }).toBe(true);
  const a = (await centreVideo(page, src))!;
  expect(a).toMatchObject({ paused: false, muted: true, loop: true });
  await page.waitForTimeout(500);
  expect((await centreVideo(page, src))!.time).toBeGreaterThan(a.time);
  // Under it, the tile is an image like any other: the poster frame, with the entry's alt text.
  const poster = await page.evaluate((src) => {
    const v = [...document.querySelectorAll<HTMLVideoElement>('[data-canvas-layer] video')].find((v) => (v.src === src.full || v.src === src.small) && !v.closest('[hidden]'))!;
    const img = v.parentElement!.querySelector('img')!;
    return { alt: img.alt, loaded: img.complete && img.naturalWidth > 0 };
  }, src);
  expect(poster.alt).not.toBe('');
  expect(poster.loaded).toBe(true);
  // Once the video has faded in, nothing is left under it to bleed through its rounded edge as a light fringe.
  await expect
    .poll(() =>
      page.evaluate((src) => {
        const v = [...document.querySelectorAll<HTMLVideoElement>('[data-canvas-layer] video')].find((v) => (v.src === src.full || v.src === src.small) && !v.closest('[hidden]'))!;
        return [getComputedStyle(v.parentElement!.querySelector('picture')!).visibility, getComputedStyle(v.parentElement!).backgroundColor];
      }, src),
    )
    .toEqual(['hidden', 'rgba(0, 0, 0, 0)']);
});

test('zoomed out a tile plays the small copy; zoomed in on, it swaps to the full one and carries on', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const clip = await centreOnVideo(page);
  await expect.poll(async () => (await centreVideo(page, clip))?.shown, { timeout: 10_000 }).toBe(true);
  expect((await centreVideo(page, clip))!.copy).toBe('small');
  await page.waitForTimeout(800);
  const before = (await centreVideo(page, clip))!.time;
  await page.keyboard.press(' ');
  await settled(page);
  await expect.poll(async () => (await centreVideo(page, clip))?.shown, { timeout: 10_000 }).toBe(true);
  const after = (await centreVideo(page, clip))!;
  expect(after).toMatchObject({ copy: 'full', paused: false });
  // From about where the small copy had got to, not from the start.
  expect(after.time).toBeGreaterThanOrEqual(before);
});

test('videos hold still off screen and on the about view', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const src = await centreOnVideo(page);
  await expect.poll(async () => (await centreVideo(page, src))?.paused, { timeout: 10_000 }).toBe(false);
  // Flying to the about view, every video stops.
  await page.getByRole('link', { name: 'About' }).click();
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLVideoElement>('[data-canvas-layer] video')].every((v) => v.paused)))
    .toBe(true);
  // Back on the canvas it plays again.
  await page.getByRole('link', { name: 'Back' }).click();
  await expect.poll(async () => (await centreVideo(page, src))?.paused, { timeout: 10_000 }).toBe(false);
  // Moved well away, a video whose tile has left the screen stops too.
  await page.evaluate(() => {
    const api = (window as unknown as { __canvas: Api }).__canvas;
    const g = api.geometry();
    api.physics.jumpTo(40 * g.pitch, 40 * g.pitch, 1);
  });
  await redraw(page);
  await settled(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLVideoElement>('[data-canvas-layer] video')]
          .filter((v) => {
            const r = v.getBoundingClientRect();
            return v.closest('[hidden]') || r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight;
          })
          .every((v) => v.paused),
      ),
    )
    .toBe(true);
});

test('with reduced motion a video shows its poster frame and does not play', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?test');
  await settled(page);
  const src = await centreOnVideo(page);
  await page.waitForTimeout(1000);
  const v = await centreVideo(page, src);
  expect(v).toMatchObject({ paused: true, time: 0, shown: false });
});
