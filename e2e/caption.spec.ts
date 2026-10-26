import { expect, test, type Page } from '@playwright/test';
import { CAPTION_IN, CAPTION_OUT, CAPTION_OUT_STAGGER, CAPTION_STAGGER, ZOOM_DURATION } from '../src/canvas/config';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  activeImage: () => { image: number } | null;
}
interface Content {
  category: string;
  alt: string;
}

async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await settled(page);
}
const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** The active image's content entry, as the page has it. */
const activeContent = (page: Page) =>
  page.evaluate(() => {
    const images = JSON.parse(document.getElementById('canvas-data')!.textContent!).images as Content[];
    const { category, alt } = images[(window as unknown as { __canvas: Api }).__canvas.activeImage()!.image]!;
    return { category, alt };
  });

/** What the caption shows, once every line has fully risen in. */
const shown = (page: Page): Promise<Content> =>
  page.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('.focus-caption')!;
    const spans = [...el.querySelectorAll('span')];
    if (el.hidden || el.dataset.state !== 'in' || spans.some((s) => getComputedStyle(s).opacity !== '1')) return null;
    const text = (line: string) => el.querySelector(`.focus-caption-${line} span`)!.textContent;
    return { category: text('category'), alt: text('alt') };
  }).then((h) => h.jsonValue() as Promise<Content>);

const done = (CAPTION_IN + CAPTION_STAGGER) * 1000 + 100;
const gone = (CAPTION_OUT + CAPTION_OUT_STAGGER) * 1000 + 100;

/** Where the caption's lines are drawn, against the focus frame around the focused image. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, centre: (r.left + r.right) / 2 };
    };
    const size = (sel: string) => getComputedStyle(document.querySelector(sel)!).fontSize;
    return {
      frame: box('.focus-frame'),
      category: box('.focus-caption-category span'),
      alt: box('.focus-caption-alt'),
      sizes: [size('.focus-caption-category'), size('.focus-caption-alt')],
      align: getComputedStyle(document.querySelector('.focus-caption-alt')!).textAlign,
    };
  });

/** The category centred below the frame, and the alt text centred just under that. */
function expectAroundFrame(l: Awaited<ReturnType<typeof layout>>): void {
  for (const line of [l.category, l.alt]) expect(Math.abs(line.centre - l.frame.centre)).toBeLessThan(1);
  expect(l.category.top - l.frame.bottom).toBeGreaterThan(8);
  expect(l.category.top - l.frame.bottom).toBeLessThan(20);
  expect(l.alt.top - l.category.bottom).toBeGreaterThanOrEqual(4);
  expect(l.alt.top - l.category.bottom).toBeLessThan(10);
  expect(l.align).toBe('center');
}

test('zoomed out there is no caption; zoomed in, the category and alt rise in centred below the image', async ({ page }) => {
  await open(page);
  const caption = page.locator('.focus-caption');
  await expect(caption).toBeHidden();

  await page.keyboard.press(' ');
  await settled(page);
  expect(await shown(page)).toEqual(await activeContent(page));
  const l = await layout(page);
  expectAroundFrame(l);
  // Category 11 px, alt 13 px.
  expect(l.sizes).toEqual(['11px', '13px']);
  // No title: the project label names the image's project above it instead.
  expect(await page.locator('.focus-caption-title').count()).toBe(0);
  // It takes no pointer events: what's under it is the canvas.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.focus-caption') === null, [l.category.centre, (l.category.top + l.category.bottom) / 2])).toBe(true);

  // Paging, it moves with the frame to the next image, and stays centred on it.
  await page.keyboard.press('ArrowDown');
  await settled(page);
  await page.waitForTimeout(done);
  expect(await shown(page)).toEqual(await activeContent(page));
  expectAroundFrame(await layout(page));

  await page.keyboard.press(' ');
  await page.waitForTimeout(gone);
  await expect(caption).toBeHidden();
});

test('the lines rise in one after another, each easing in through every opacity', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as { __rise: number[][] };
    w.__rise = [];
    const spans = [...document.querySelectorAll('.focus-caption span')];
    const t0 = performance.now();
    const tick = () => {
      w.__rise.push([performance.now() - t0, ...spans.map((s) => Number(getComputedStyle(s).opacity))]);
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press(' ');
  await page.waitForTimeout(3100);
  const rise = await page.evaluate(() => (window as unknown as { __rise: number[][] }).__rise);
  // When each line first shows at all, and is half in.
  const first = (line: number, above: number) => rise.find((r) => r[line]! > above)?.[0] ?? Infinity;
  for (const line of [1, 2]) {
    expect(rise.some((r) => r[line]! > 0.1 && r[line]! < 0.9)).toBe(true);
    expect(first(line, 0.99)).toBeLessThan(Infinity);
  }
  expect(first(1, 0.5)).toBeLessThan(first(2, 0.5));
  // Not before the zoom has landed: it never rides along with the image.
  expect(first(1, 0.01)).toBeGreaterThan(ZOOM_DURATION * 1000);
});

test('the moment the view moves the caption leaves, where it stands, fast; once still it comes back, slowly', async ({ page }) => {
  await open(page);
  await page.keyboard.press(' ');
  await settled(page);
  await shown(page);
  // Every frame from here: where the category's line (its mask) is drawn and how visible each line is.
  await page.evaluate(() => {
    const w = window as unknown as { __caption: number[][] };
    w.__caption = [];
    const title = document.querySelector('.focus-caption-category')!;
    const spans = [...document.querySelectorAll('.focus-caption span')];
    const t0 = performance.now();
    const tick = () => {
      const r = title.getBoundingClientRect();
      w.__caption.push([performance.now() - t0, r.left, r.top, ...spans.map((s) => Number(getComputedStyle(s).opacity))]);
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // A drag that pulls the image well aside, held, then let go (it springs back).
  await page.mouse.move(720, 450);
  await page.mouse.down();
  for (let n = 1; n <= 10; n++) {
    await page.mouse.move(720 - n * 6, 450 - n * 4);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await settled(page);
  await page.waitForTimeout(done);
  const rows = await page.evaluate(() => (window as unknown as { __caption: number[][] }).__caption);
  const [, x0, y0] = rows[0]!;
  // Whenever any of it can be seen, the category is exactly where it was: it never moves with the frame...
  const seen = rows.filter((r) => r.slice(3).some((o) => o > 0.02));
  for (const [, x, y] of seen) {
    expect(x).toBeCloseTo(x0!, 1);
    expect(y).toBeCloseTo(y0!, 1);
  }
  // ...it goes fast: gone within a few frames of the pull starting...
  const goneAt = rows.findIndex((r) => r.slice(3).every((o) => o < 0.02));
  const leaving = rows.findIndex((r) => r.slice(3).some((o) => o < 0.99));
  expect(goneAt).toBeGreaterThan(-1);
  expect(rows[goneAt]![0]! - rows[leaving]![0]!).toBeLessThan((CAPTION_OUT + CAPTION_OUT_STAGGER) * 1000 + 60);
  // ...and comes back slowly, once the view is still again.
  const back = rows.slice(goneAt);
  const from = back.findIndex((r) => r.slice(3).some((o) => o > 0.02));
  const full = back.findIndex((r) => r.slice(3).every((o) => o > 0.99));
  expect(from).toBeGreaterThan(-1);
  // (Its ease starts and ends gently, so the visible part of the rise is a little under CAPTION_IN.)
  expect(back[full]![0]! - back[from]![0]!).toBeGreaterThan(CAPTION_IN * 1000 * 0.7);
});

test('paging to another image switches the caption: out, then the new one in', async ({ page }) => {
  await open(page);
  await page.keyboard.press(' ');
  await settled(page);
  const before = await shown(page);
  const states: string[] = [];
  await page.exposeFunction('__state', (s: string) => states.push(s));
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.focus-caption')!;
    // Each change's new value is the next one's old value, or what it is now for the last.
    new MutationObserver((records) =>
      records.forEach((_, n) =>
        (window as unknown as { __state: (s: string) => void }).__state(records[n + 1]?.oldValue ?? el.dataset.state ?? ''),
      ),
    ).observe(el, { attributes: true, attributeFilter: ['data-state'], attributeOldValue: true });
  });
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await page.waitForTimeout(done);
  const after = await shown(page);
  expect(after).toEqual(await activeContent(page));
  expect(after.alt).not.toBe(before.alt);
  expect(states).toEqual(['out', 'below', 'in']);
});
