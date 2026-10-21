import { expect, test } from '@playwright/test';
import { readImageEntries } from '../tests/entries';

interface Api {
  isSettled: () => boolean;
  renderer: { visibleCells: () => { image: number }[] };
}

test('every image on screen carries its entry’s alt text', async ({ page }) => {
  await page.goto('/?test');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
  const { expected, shown } = await page.evaluate(() => {
    const api = (window as unknown as { __canvas: Api }).__canvas;
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as { images: { alt: string }[] };
    const images = new Set(api.renderer.visibleCells().map((c) => c.image));
    const tiles = [...document.querySelectorAll<HTMLImageElement>('[data-canvas-layer] > div:not([hidden]) img')];
    return { expected: [...images].map((n) => data.images[n]!.alt).sort(), shown: [...new Set(tiles.map((img) => img.alt))].sort() };
  });
  expect(expected.length).toBeGreaterThan(10);
  for (const alt of expected) expect(alt).not.toBe('');
  // Pooled tiles just off screen are bound too, so the page may show more than the visible cells.
  for (const alt of expected) expect(shown).toContain(alt);
});

test('private notes and write-ups never reach the page', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const entries = readImageEntries();
  const notes = entries.flatMap((e) => (e.notes ? [e.notes] : []));
  const bodies = entries.flatMap((e) => (e.body ? [e.body] : []));
  expect(notes.length).toBeGreaterThan(0);
  expect(bodies.length).toBeGreaterThan(0);
  for (const text of [...notes, ...bodies]) expect(html).not.toContain(text.slice(0, 40));
});
