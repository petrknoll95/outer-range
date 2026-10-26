import { expect, test, type Page } from '@playwright/test';

interface Api {
  isSettled: () => boolean;
  physics: { x: number; y: number; z: number };
  flight: () => { u: number; to: 0 | 1 } | null;
  zoomState: () => 'out' | 'in';
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

/**
 * Start `motion`, press L partway through it, and record every frame from the start: the frame
 * gaps, and per frame `probe` (what the motion moves) and the page's lightness.
 */
async function switchMidway(page: Page, motion: () => Promise<void>, probe: string, after = 120) {
  await page.evaluate((probe) => {
    const w = window as unknown as { __rows: number[][]; __stop: boolean };
    const read = new Function('c', `return ${probe}`) as (c: unknown) => number;
    const c = (window as unknown as { __canvas: unknown }).__canvas;
    const ctx = document.createElement('canvas').getContext('2d')!;
    w.__rows = [];
    w.__stop = false;
    const tick = () => {
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      w.__rows.push([performance.now(), read(c), (r! + g! + b!) / 765]);
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, probe);
  await motion();
  await page.waitForTimeout(after);
  const at = await page.evaluate(() => performance.now());
  await page.keyboard.press('l');
  await page.waitForTimeout(900);
  const rows = await page.evaluate(() => {
    const w = window as unknown as { __rows: number[][]; __stop: boolean };
    w.__stop = true;
    return w.__rows;
  });
  return { rows, at };
}

/** Frames kept coming, the motion kept going after the switch, and the colour faded through. */
function expectUninterrupted({ rows, at }: Awaited<ReturnType<typeof switchMidway>>, still: (a: number, b: number) => boolean) {
  const gaps = rows.slice(1).map((r, n) => r[0]! - rows[n]![0]!);
  expect(Math.max(...gaps)).toBeLessThan(60);
  const afterSwitch = rows.filter((r) => r[0]! > at);
  const moved = afterSwitch.slice(1).filter((r, n) => !still(r[1]!, afterSwitch[n]![1]!)).length;
  expect(moved).toBeGreaterThan(3);
  const shades = afterSwitch.map((r) => r[2]!);
  const [lo, hi] = [Math.min(...shades), Math.max(...shades)];
  expect(hi - lo).toBeGreaterThan(0.5);
  expect(shades.filter((v) => v > lo + 0.1 && v < hi - 0.1).length).toBeGreaterThan(2);
}

test('switching theme never interrupts anything: a pan gliding on, a drag, a zoom, a flight to the about view', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    // No view transitions: they freeze the page into snapshots until they end.
    (window as unknown as { __transitions: number }).__transitions = 0;
    if (document.startViewTransition) {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = ((...a: Parameters<typeof start>) => {
        (window as unknown as { __transitions: number }).__transitions++;
        return start(...a);
      }) as typeof start;
    }
  });
  await page.goto('/?test');
  await settled(page);
  await page.mouse.move(720, 450);

  // A pan gliding on after a fling.
  const pan = await switchMidway(
    page,
    async () => {
      for (let n = 0; n < 6; n++) {
        await page.mouse.wheel(220, 60);
        await page.waitForTimeout(16);
      }
    },
    'c.physics.x',
    60,
  );
  expectUninterrupted(pan, (a, b) => Math.abs(a - b) < 0.01);
  await settled(page);

  // A drag, held through the switch: the canvas still follows the pointer, every step.
  await page.mouse.down();
  const xs: number[] = [];
  const camX = () => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x);
  for (let n = 1; n <= 16; n++) {
    if (n === 8) await page.keyboard.press('l');
    await page.mouse.move(720 - n * 15, 450);
    await page.waitForTimeout(16);
    xs.push(await camX());
  }
  await page.mouse.up();
  for (let n = 1; n < xs.length; n++) expect(xs[n]!).toBeGreaterThan(xs[n - 1]!);
  await settled(page);

  // A zoom in.
  const zoom = await switchMidway(page, () => page.keyboard.press(' '), 'c.physics.z', 80);
  expectUninterrupted(zoom, (a, b) => Math.abs(a - b) < 1e-6);
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');

  // The flight to the about view.
  const flight = await switchMidway(page, () => page.getByRole('link', { name: 'About' }).click(), 'c.flight()?.u ?? 0', 80);
  expectUninterrupted(flight, (a, b) => Math.abs(a - b) < 1e-6);
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.u === 1);

  expect(await page.evaluate(() => (window as unknown as { __transitions: number }).__transitions)).toBe(0);
});
