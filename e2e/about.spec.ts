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

interface Api {
  isSettled: () => boolean;
  flight: () => { u: number; to: 0 | 1 } | null;
}

/** How the about text's layer is drawn (scale about the window's centre, opacity, blur), and whether the view is inert. */
const layer = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[data-about]')!;
    const s = getComputedStyle(view.querySelector('[data-about-layer]')!);
    const m = /matrix\(([-\d.e]+)/.exec(s.transform);
    return { scale: m ? Number(m[1]) : 1, opacity: Number(s.opacity), blur: Number(/blur\(([\d.e]+)px\)/.exec(s.filter)?.[1] ?? 0), inert: view.inert };
  });

test('the about view has the same header, with Back in place of About', async ({ page }) => {
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
});

test('its text sits in a narrow column, centred, over the flown-past canvas', async ({ page }) => {
  await page.goto('/about');
  await page.evaluate(() => document.fonts.ready);
  const article = page.locator('article.about');
  // The statement (under the wordmark, the page's h1), the line under it, then four chapters.
  await expect(article.locator(':scope > h2')).toHaveText('Good design gives you something to feel, something to recognize, and very little to figure out.');
  await expect(article.locator(':scope > h2 + p')).toHaveText('Currently at Off Menu');
  // Each numeral is dead centre, in the statement's serif and size, with "Chapter" on its left and its title on its right.
  await expect(article.locator(':scope > h3 .numeral')).toHaveText(['I', 'II', 'III', 'IV']);
  await expect(article.locator(':scope > h3')).toHaveText(['I On Intent', 'II On Philosophy', 'III On Process', 'IV On Ethics']);
  const type = await article.evaluate((el) => {
    const s = (sel: string) => getComputedStyle(el.querySelector(sel)!);
    const column = el.getBoundingClientRect();
    return {
      statement: [s(':scope > h2').fontFamily, s(':scope > h2').fontSize],
      numeral: [s(':scope > h3 .numeral').fontFamily, s(':scope > h3 .numeral').fontSize],
      title: s(':scope > h3').fontFamily,
      sections: [...el.querySelectorAll(':scope > h3')].map((h) => {
        const n = h.querySelector('.numeral')!.getBoundingClientRect();
        const t = h.querySelector('.title')!.getBoundingClientRect();
        return {
          offCentre: Math.abs((n.left + n.right) / 2 - (column.left + column.right) / 2),
          rightOf: t.left >= n.right,
          offMiddle: Math.abs((t.top + t.bottom) / 2 - (n.top + n.bottom) / 2),
          before: getComputedStyle(h, '::before').content,
        };
      }),
    };
  });
  expect(type.statement[0]).toMatch(/^"Timeless Serif/);
  expect(type.numeral).toEqual(type.statement);
  expect(type.title).toMatch(/^"Timeless Sans/);
  for (const section of type.sections) {
    expect(section.offCentre).toBeLessThan(1);
    expect(section.rightOf).toBe(true);
    expect(section.offMiddle).toBeLessThan(2);
    expect(section.before).toBe('"Chapter"');
  }
  const sections = article.locator(':scope > h3 + p');
  await expect(sections).toHaveCount(4);
  await expect(sections.first()).toContainText('Knowing what the work needs to do gives you room to experiment.');
  await expect(sections.nth(1)).toContainText('Clarity can have character.');
  await expect(sections.nth(2)).toContainText('The challenge is keeping sight of the whole while giving the details their due.');
  await expect(sections.last()).toContainText('without having to become suspicious first.');
  // Centred, all of it.
  expect(await article.evaluate((el) => getComputedStyle(el).textAlign)).toBe('center');
  // The services, between the statement and the chapters: a group per column, in order.
  const services = article.getByRole('region', { name: 'Services' });
  expect(await services.evaluate((s) => [s.previousElementSibling!.textContent, s.nextElementSibling!.textContent])).toEqual([
    'Currently at Off Menu',
    'I On Intent',
  ]);
  await expect(services.getByRole('heading', { level: 3 })).toHaveText(['Digital Design', 'Branding', 'Print Design']);
  await expect(services.getByRole('listitem')).toHaveText([
    'UX/UI Design',
    'Motion Design',
    '3D Design',
    'Social Media',
    'Identity Design',
    'Art Direction',
    'Brand Guidelines',
    'Storytelling',
    'Packaging',
    'Editorial',
    'Wayfinding',
    'Signage',
  ]);
  // After the chapters, the awards: a title over the list, in the serif.
  const awards = article.getByRole('region', { name: 'Awards' });
  await expect(awards.getByRole('listitem')).toHaveText(['Awwwards x4', 'DDA x2', 'CSSDA x2', 'The FWA x2']);
  expect(await awards.getByRole('list').evaluate((l) => getComputedStyle(l).fontFamily)).toMatch(/^"Timeless Serif/);
  // Last, the social links, listed the same way.
  const social = article.getByRole('region', { name: 'Social' });
  expect(await social.evaluate((s) => s === s.parentElement!.lastElementChild && s.previousElementSibling!.matches('[aria-labelledby="awards"]'))).toBe(true);
  await expect(social.getByRole('link')).toHaveText(['LinkedIn', 'Instagram', 'X']);
  expect(await social.getByRole('list').evaluate((l) => getComputedStyle(l).fontFamily)).toMatch(/^"Timeless Serif/);
  // Side by side: the three groups start on one line.
  const tops = await services.getByRole('heading', { level: 3 }).evaluateAll((hs) => hs.map((h) => Math.round(h.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const box = (await article.boundingBox())!;
  // Narrow (34 rem), centred across the window; taller than it, so it starts clear of the header and scrolls.
  expect(box.width).toBeLessThanOrEqual(34 * 16);
  expect(box.x + box.width / 2).toBeCloseTo(1440 / 2, 0);
  // The statement alone runs 65% wider, centred on the column.
  const statement = (await article.locator(':scope > h2').boundingBox())!;
  expect(statement.width).toBeCloseTo(box.width * 1.65, 0);
  expect(statement.x + statement.width / 2).toBeCloseTo(1440 / 2, 0);
  expect(box.y).toBeGreaterThan(100);
  expect(await page.locator('[data-about]').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The canvas behind is flown past and inert.
  expect(await page.evaluate(() => document.querySelector<HTMLElement>('[data-canvas]')!.inert)).toBe(true);
  expect(await layer(page)).toEqual({ scale: 1, opacity: 1, blur: 0, inert: false });
});

test('the text is a layer behind the canvas: flying in it comes towards the camera, flying back it recedes; on the canvas it lets everything through', async ({ page }) => {
  await page.goto('/?test');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
  // On the canvas: out of sight, inert, and under the middle of the screen is an image.
  let l = await layer(page);
  expect([l.opacity, l.inert]).toEqual([0, true]);
  expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-canvas-layer]') !== null)).toBe(true);
  // Behind the canvas: the images are drawn over it.
  expect(await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-canvas]')!).zIndex) > Number(getComputedStyle(document.querySelector('[data-about]')!).zIndex))).toBe(true);

  /** Every frame from now: how far the flight is, and the layer's scale, opacity and blur. */
  const track = () =>
    page.evaluate(() => {
      const w = window as unknown as { __about: number[][] };
      w.__about = [];
      const el = document.querySelector('[data-about-layer]')!;
      const t0 = performance.now();
      const tick = () => {
        const s = getComputedStyle(el);
        w.__about.push([
          // (-1: no flight under way.)
          (window as unknown as { __canvas: Api }).__canvas.flight()?.u ?? -1,
          Number(/matrix\(([-\d.e]+)/.exec(s.transform)?.[1] ?? 1),
          Number(s.opacity),
          Number(/blur\(([\d.e]+)px\)/.exec(s.filter)?.[1] ?? 0),
        ]);
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const rows = () => page.evaluate(() => (window as unknown as { __about: number[][] }).__about);

  await track();
  await page.getByRole('link', { name: 'About' }).click();
  await page.waitForTimeout(1600);
  // (Outside a flight the layer isn't drawn in perspective at all: it's out of sight or at rest.)
  const going = (await rows()).filter((r) => r[0]! >= 0);
  // Unseen until the camera is well on its way, then only ever nearer: bigger, clearer, sharper, to its own size.
  expect(going.find((r) => r[2]! > 0.01)![0]).toBeGreaterThan(0.3);
  expect(going.filter((r) => r[2]! > 0.01)[0]![1]).toBeLessThan(0.7);
  for (let n = 1; n < going.length; n++) {
    expect(going[n]![1]).toBeGreaterThanOrEqual(going[n - 1]![1] - 1e-4);
    expect(going[n]![2]).toBeGreaterThanOrEqual(going[n - 1]![2] - 1e-3);
  }
  expect(going.at(-1)!.slice(1)).toEqual([1, 1, 0]);
  l = await layer(page);
  expect(l.inert).toBe(false);

  await track();
  await page.getByRole('link', { name: 'Back' }).click();
  // At once it takes nothing, and as the camera pulls back it recedes and fades, behind the images.
  expect((await layer(page)).inert).toBe(true);
  await page.waitForTimeout(1600);
  const leaving = (await rows()).filter((r) => r[0]! >= 0);
  for (let n = 1; n < leaving.length; n++) {
    expect(leaving[n]![1]).toBeLessThanOrEqual(leaving[n - 1]![1] + 1e-4);
    expect(leaving[n]![2]).toBeLessThanOrEqual(leaving[n - 1]![2] + 1e-3);
  }
  expect(leaving.some((r) => r[1]! < 0.7 && r[2]! > 0)).toBe(true);
  expect(leaving.at(-1)![2]).toBe(0);
});

test('on a small screen the text scrolls on its own', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await page.goto('/about');
  const view = page.locator('[data-about]');
  expect(await view.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.mouse.move(195, 300);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
  // Scrolled under the header, it fades out rather than running into the wordmark.
  expect(await view.evaluate((el) => getComputedStyle(el).maskImage)).toMatch(/linear-gradient/);
});

test('on a narrow screen the services groups wrap instead of squeezing, a lone last one centred', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/about');
  const groups = page.locator('.services-groups > div');
  const boxes = await groups.evaluateAll((gs) =>
    gs.map((g) => {
      const r = g.getBoundingClientRect();
      const name = g.querySelector('h3')!.getBoundingClientRect();
      return { top: Math.round(r.top), width: r.width, centre: (name.left + name.right) / 2 };
    }),
  );
  // Not all on one line, and none narrower than its minimum.
  expect(new Set(boxes.map((b) => b.top)).size).toBeGreaterThan(1);
  for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(9.5 * 16 - 1);
  // A group alone on the last line sits centred in the window.
  const last = boxes.at(-1)!;
  expect(boxes.filter((b) => b.top === last.top)).toHaveLength(1);
  expect(last.centre).toBeCloseTo(390 / 2, 0);
});

