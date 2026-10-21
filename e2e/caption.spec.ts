import { expect, test, type Page } from '@playwright/test';
import { CAPTION_IN, CAPTION_OUT, CAPTION_OUT_STAGGER, CAPTION_STAGGER } from '../src/canvas/config';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  activeImage: () => { image: number } | null;
}
interface Content {
  category: string;
  title: string;
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
    const { category, title, alt } = images[(window as unknown as { __canvas: Api }).__canvas.activeImage()!.image]!;
    return { category, title, alt };
  });

/** What the caption shows, once every line has fully risen in. */
const shown = (page: Page): Promise<Content> =>
  page.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('.focus-caption')!;
    const spans = [...el.querySelectorAll('span')];
    if (el.hidden || el.dataset.state !== 'in' || spans.some((s) => getComputedStyle(s).opacity !== '1')) return null;
    const [category, title, alt] = spans.map((s) => s.textContent);
    return { category, title, alt };
  }).then((h) => h.jsonValue() as Promise<Content>);

const done = (CAPTION_IN + 2 * CAPTION_STAGGER) * 1000 + 100;
const gone = (CAPTION_OUT + 2 * CAPTION_OUT_STAGGER) * 1000 + 100;

test('zoomed out there is no caption; zoomed in, the focused image’s category, title and alt rise in at the bottom left', async ({ page }) => {
  await open(page);
  const caption = page.locator('.focus-caption');
  await expect(caption).toBeHidden();

  await page.keyboard.press(' ');
  await settled(page);
  expect(await shown(page)).toEqual(await activeContent(page));
  const box = (await caption.boundingBox())!;
  expect(box.x).toBeCloseTo(24, 0);
  expect(box.y + box.height).toBeCloseTo(900 - 24, 0);
  // It takes no pointer events: what's under it is the canvas.
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.focus-caption') === null, [box.x + 10, box.y + box.height - 10])).toBe(true);

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
      if (performance.now() - t0 < 1800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press(' ');
  await page.waitForTimeout(1900);
  const rise = await page.evaluate(() => (window as unknown as { __rise: number[][] }).__rise);
  // When each line first shows at all, and is half in.
  const first = (line: number, above: number) => rise.find((r) => r[line]! > above)?.[0] ?? Infinity;
  for (const line of [1, 2, 3]) {
    expect(rise.some((r) => r[line]! > 0.1 && r[line]! < 0.9)).toBe(true);
    expect(first(line, 0.99)).toBeLessThan(Infinity);
  }
  expect(first(1, 0.5)).toBeLessThan(first(2, 0.5));
  expect(first(2, 0.5)).toBeLessThan(first(3, 0.5));
  // Not before the image is nearly there.
  expect(first(1, 0.01)).toBeGreaterThan(150);
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
      records.forEach((r, n) =>
        (window as unknown as { __state: (s: string) => void }).__state(records[n + 1]?.oldValue ?? el.dataset.state ?? ''),
      ),
    ).observe(el, { attributes: true, attributeFilter: ['data-state'], attributeOldValue: true });
  });
  await page.keyboard.press('ArrowRight');
  await settled(page);
  await page.waitForTimeout(done);
  const after = await shown(page);
  expect(after).toEqual(await activeContent(page));
  expect(after.title).not.toBe(before.title);
  expect(states).toEqual(['out', 'below', 'in']);
});
