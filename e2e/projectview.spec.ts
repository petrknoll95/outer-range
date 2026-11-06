import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  activeImage: () => { i: number; j: number; image: number } | null;
  physics: { x: number; y: number; z: number };
  project: () => { id: string; title: string } | null;
  route: () => 'home' | 'about';
}

const settled = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
const camera = (page: Page) => page.evaluate(() => (({ x, y, z }) => ({ x, y, z }))((window as unknown as { __canvas: Api }).__canvas.physics));
const active = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.activeImage()?.image ?? null);
const openProject = (page: Page) => page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.project()?.title ?? null);
const view = (page: Page) => page.locator('section[data-project-view]');
/** The box the column scrolls in. */
const scroller = (page: Page) => page.locator('[data-project-scroll]');
/** The image's item nearest the centre of the window (the column runs its images over and over), marked `data-nearest`. */
const nearest = async (page: Page, image: number | null) => {
  await page.evaluate((image) => {
    document.querySelector('[data-nearest]')?.removeAttribute('data-nearest');
    const middle = innerHeight / 2;
    const off = (el: Element) => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - middle);
    };
    const items = [...document.querySelectorAll(`[data-project-images] [data-image="${image}"]`)].sort((a, b) => off(a) - off(b));
    items[0]!.setAttribute('data-nearest', '');
  }, image);
  return page.locator('[data-nearest]');
};
/** Faded all the way in (or out). */
const opacity = (page: Page) => view(page).evaluate((el) => Number(getComputedStyle(el).opacity));
const covered = (page: Page) => page.waitForFunction(() => document.documentElement.dataset.project === 'covered');
/** Faded right out, and inert: clicks and focus go to the canvas. */
const gone = (page: Page) =>
  page.waitForFunction(() => {
    const el = document.querySelector<HTMLElement>('section[data-project-view]')!;
    return Number(getComputedStyle(el).opacity) === 0 && el.inert && getComputedStyle(el).pointerEvents === 'none';
  });

/** The active image's project, as the page's data has it. */
const project = (page: Page) =>
  page.evaluate(() => {
    const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as {
      projects: { title: string; year?: number; images: number[] }[];
      images: { alt: string; video?: object }[];
    };
    const image = (window as unknown as { __canvas: Api }).__canvas.activeImage()!.image;
    const p = data.projects.find((p) => p.images.includes(image))!;
    return { title: p.title, year: p.year, images: p.images, alts: p.images.map((n) => data.images[n]!.alt), videos: p.images.filter((n) => data.images[n]!.video).length };
  });

/** Zoomed in on an image of a project with at least `min` images (and, if asked, a video; or one that isn't the project's first). */
async function focusOnProject(page: Page, min = 3, { withVideo = false, notFirst = false } = {}): Promise<void> {
  await page.goto('/?test');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  for (let n = 0; n < 40; n++) {
    const p = await project(page);
    if (p.images.length >= min && (!withVideo || p.videos > 0) && (!notFirst || p.images[0] !== (await active(page)))) return;
    await page.keyboard.press('ArrowRight');
    await settled(page);
  }
  throw new Error(`No project of ${min}+ images${withVideo ? ' with a video' : ''} within reach.`);
}

test('zoomed in, the info bar’s moving and theme hints give way to the project’s, P and I, and come back zoomed out; a click on P opens the project view', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const bar = page.getByRole('complementary', { name: 'Controls' });
  const shown = (text: string) => bar.getByText(text, { exact: true }).evaluate((el) => {
    const css = getComputedStyle(el.closest('li')!);
    return css.visibility === 'visible' && Number(css.opacity) === 1;
  });
  const gone = (text: string) => bar.getByText(text, { exact: true }).evaluate((el) => getComputedStyle(el.closest('li')!).visibility === 'hidden');
  expect(await shown('Drag/Pinch/Scroll')).toBe(true);
  expect(await gone('Project info')).toBe(true);
  // No hint below the image any more: the bar is the hint.
  await expect(page.locator('.focus-frame').getByText('Project')).toHaveCount(0);

  await page.keyboard.press(' ');
  await settled(page);
  await expect.poll(() => shown('Project')).toBe(true);
  await expect.poll(() => shown('Project info')).toBe(true);
  await expect.poll(() => gone('Drag/Pinch/Scroll')).toBe(true);
  await expect.poll(() => gone('Theme')).toBe(true);
  const project = await page.evaluate(() => document.documentElement.dataset.focusedProject);
  expect(project).toBeTruthy();
  // In the same place the moving hint was, rising in rather than popping.
  const transition = await bar.getByText('Project info', { exact: true }).evaluate((el) => getComputedStyle(el.closest('li')!).transitionProperty);
  expect(transition).toContain('translate');

  // P, clicked, does what the key does; there it says Back.
  await bar.getByRole('button', { name: 'Project', exact: true }).click();
  await covered(page);
  await expect(bar.getByRole('button', { name: 'Back' })).toBeVisible();
  await bar.getByRole('button', { name: 'Back' }).click();
  await page.waitForFunction(() => (window as unknown as { __canvas: { backing: () => unknown } }).__canvas.backing() === null);

  await page.keyboard.press('Escape');
  await expect.poll(() => shown('Drag/Pinch/Scroll')).toBe(true);
  await expect.poll(() => gone('Project info')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.dataset.focusedProject ?? null)).toBeNull();
});

test('zoomed in on the canvas, I opens the project’s info too: the canvas backs away behind it, as for the menu, and comes home when it closes', async ({ page }) => {
  await focusOnProject(page);
  const p = await project(page);
  const info = page.locator('dialog[data-project-info]');
  const backing = () => page.evaluate(() => (window as unknown as { __canvas: { backing: () => { u: number; to: 0 | 1 } | null } }).__canvas.backing());
  await page.keyboard.press('i');
  await expect(info).toHaveJSProperty('open', true);
  await expect(info.locator('[data-info-title]')).toHaveText(p.title);
  await expect.poll(async () => (await backing())?.u).toBe(1);
  await page.keyboard.press('Escape');
  await expect(info).toHaveJSProperty('open', false);
  await expect.poll(backing).toBeNull();
  // A click on its hint opens it too.
  await page.getByRole('complementary', { name: 'Controls' }).getByRole('button', { name: 'Project info' }).click();
  await expect(info).toHaveJSProperty('open', true);
});

test('in the project view the header reads Outer Range, a drawn cross, and the project’s name, centred; and the wordmark alone again after', async ({ page }) => {
  await focusOnProject(page);
  const p = await project(page);
  const header = () =>
    page.evaluate(() => {
      const mark = document.querySelector('[data-wordmark]')!;
      const h1 = mark.querySelector('h1')!.getBoundingClientRect();
      const name = mark.querySelector('[data-header-project-name]')!;
      const x = mark.querySelector('[data-header-project] svg')!;
      const shown = Number(getComputedStyle(x).opacity) > 0.5;
      const extra = mark.querySelector('[data-header-project]')!.getBoundingClientRect();
      return {
        name: name.textContent,
        rise: name.getBoundingClientRect().top - (name.parentElement!.getBoundingClientRect().top + parseFloat(getComputedStyle(name.parentElement!).paddingTop)),
        cross: Number(getComputedStyle(x).opacity),
        tag: x.tagName.toLowerCase(),
        centre: (h1.left + (shown ? extra.right : h1.right)) / 2,
        between: x.getBoundingClientRect().left > h1.right && x.getBoundingClientRect().right < name.getBoundingClientRect().left,
      };
    });
  const before = await header();
  expect(before.cross).toBe(0);
  expect(Math.abs(before.centre - 720)).toBeLessThanOrEqual(1);
  await page.keyboard.press('p');
  await covered(page);
  await expect.poll(async () => (await header()).cross).toBe(1);
  // Risen all the way through its mask.
  await expect.poll(async () => Math.abs((await header()).rise)).toBeLessThan(0.5);
  const open = await header();
  expect(open.name).toBe(p.title);
  // A drawn cross, not a letter, between the two, and the three of them centred.
  expect(open.tag).toBe('svg');
  expect(open.between).toBe(true);
  expect(await page.locator('[data-wordmark]').innerText()).not.toMatch(/[x×✕]\s/i);
  expect(Math.abs(open.centre - 720)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await header()).cross).toBe(0);
  await expect.poll(async () => Math.abs((await header()).centre - 720)).toBeLessThanOrEqual(1);
});

test('P swaps the canvas for the project: every one of its images in order, named for it', async ({ page }) => {
  await focusOnProject(page, 4);
  const p = await project(page);
  await page.keyboard.press('p');
  await covered(page);
  expect(await opacity(page)).toBe(1);
  expect(await openProject(page)).toBe(p.title);
  await expect(view(page)).toHaveAttribute('aria-label', p.title);
  // Over and over: each run the project's images in order, only the first read out.
  const alts = await page.locator('[data-project-images] img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).alt));
  expect(alts.length % p.alts.length).toBe(0);
  expect(alts.length / p.alts.length).toBeGreaterThanOrEqual(3);
  for (let k = 0; k < alts.length; k += p.alts.length) expect(alts.slice(k, k + p.alts.length)).toEqual(p.alts);
  expect(await page.locator('[data-project-images] li:not([aria-hidden]) img').count()).toBe(p.alts.length);
  // Rounder than before, but never past 20 px.
  const radius = await page.locator('.project-image').first().evaluate((el) => parseFloat(getComputedStyle(el).borderRadius));
  expect(radius).toBeGreaterThanOrEqual(12);
  expect(radius).toBeLessThanOrEqual(20);
  // The canvas under it takes no input.
  expect(await page.locator('[data-canvas]').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
});

test('as for the menu, the canvas backs away as the image comes forward to its place and the column comes in from in front of the camera; leaving, the column goes on past the camera as the canvas comes home', async ({ page }) => {
  await focusOnProject(page, 4);
  const image = await active(page);
  type Rect = { left: number; top: number; width: number };
  const rect = (selector: string) => page.locator(selector).evaluate((el) => (({ left, top, width }) => ({ left, top, width }))(el.getBoundingClientRect()));
  const near = (a: Rect, b: Rect) => {
    expect(Math.abs(a.left - b.left)).toBeLessThan(1.5);
    expect(Math.abs(a.top - b.top)).toBeLessThan(1.5);
    expect(Math.abs(a.width - b.width)).toBeLessThan(1.5);
  };
  const backing = () => page.evaluate(() => (window as unknown as { __canvas: { backing: () => { u: number; to: 0 | 1 } | null } }).__canvas.backing());
  /** The copy's animation, and the column's coming in with it, held at `at` of the way (0 to 1); the copy's duration, ms. */
  const hold = (at: number) =>
    page.evaluate(
      (at) =>
        new Promise<number>((resolve) => {
          const go = () => {
            const copy = document.querySelector('.project-flight');
            if (!copy) return requestAnimationFrame(go);
            let duration = 0;
            for (const a of [copy, document.querySelector('[data-project-stage]')!].flatMap((el) => el.getAnimations())) {
              const d = Number(a.effect!.getTiming().duration);
              duration ||= d;
              a.pause();
              a.currentTime = (d - 1) * at;
            }
            resolve(duration);
          };
          go();
        }),
      at,
    );
  const release = () => page.evaluate(() => [document.querySelector('.project-flight')!, document.querySelector('[data-project-stage]')!].flatMap((el) => el.getAnimations()).forEach((a) => a.play()));
  const tile = await page.evaluate(() => {
    const el = document.querySelector('.focus-frame')!;
    const r = el.getBoundingClientRect();
    const t = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div:not([hidden])')].find((d) => {
      const b = d.getBoundingClientRect();
      return Math.abs(b.left + b.width / 2 - (r.left + r.width / 2)) < 2 && Math.abs(b.top + b.height / 2 - (r.top + r.height / 2)) < 2;
    })!;
    t.dataset.trigger = '';
    const b = t.getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width };
  });
  // A tile next to it, which backs away with the rest.
  const neighbour = await page.evaluate(() => {
    const t = document.querySelector('[data-trigger]')!.getBoundingClientRect();
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div:not([hidden]):not([data-trigger])')];
    const d = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - (t.left + t.width / 2), r.top + r.height / 2 - (t.top + t.height / 2));
    };
    const n = tiles.sort((a, b) => d(a) - d(b))[0]!;
    n.dataset.neighbour = '';
    const r = n.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  await page.keyboard.press('p');
  // On the backing's own time: away over the flight's.
  expect(await hold(0)).toBe(800);
  // The rest of the column, from in front of the camera, big and soft, on the same time, as the menu's square comes.
  const coming = await page.evaluate(() => {
    const a = document.querySelector('[data-project-stage]')!.getAnimations()[0]!;
    const k = (a.effect as KeyframeEffect).getKeyframes();
    return { duration: Number(a.effect!.getTiming().duration), from: [k[0]!.transform, k[0]!.filter], to: [k.at(-1)!.transform, k.at(-1)!.filter] };
  });
  expect(coming).toEqual({ duration: 800, from: ['scale(1.4)', 'blur(12px)'], to: ['scale(1)', 'blur(0px)'] });
  near(await rect('.project-flight'), tile);
  expect(await page.locator('[data-flying]').count()).toBe(2);
  await hold(1);
  await nearest(page, image);
  near(await rect('.project-flight'), await rect('[data-nearest]'));
  // At the centre of the window.
  const landed = await page.locator('[data-nearest]').evaluate((el) => (({ top, height }) => top + height / 2)(el.getBoundingClientRect()));
  expect(Math.abs(landed - 450)).toBeLessThan(1.5);
  await release();
  // The rest of the canvas backs away: drawn smaller, in towards the centre, fainter. The canvas itself never moves.
  await expect.poll(async () => (await backing())?.u).toBe(1);
  const n = await page.locator('[data-neighbour]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2, opacity: Number(getComputedStyle(el).opacity) };
  });
  expect(n.width).toBeLessThan(neighbour.width * 0.8);
  expect(Math.hypot(n.cx - 720, n.cy - 450)).toBeLessThan(Math.hypot(neighbour.cx - 720, neighbour.cy - 450));
  expect(n.opacity).toBeLessThan(0.5);
  expect(await page.locator('[data-canvas]').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await covered(page);
  await expect(page.locator('.project-flight')).toHaveCount(0);
  expect(await page.locator('[data-flying]').count()).toBe(0);

  // Leaving, as the menu's square does: the column (and its glass) flies on past the camera, bigger and softer, and nothing flies back.
  await page.keyboard.press('Escape');
  const leaving = await page.evaluate(() => {
    const a = document.querySelector('[data-project-stage]')!.getAnimations()[0]!;
    const k = (a.effect as KeyframeEffect).getKeyframes();
    return { duration: Number(a.effect!.getTiming().duration), to: [k.at(-1)!.transform, k.at(-1)!.filter] };
  });
  expect(leaving).toEqual({ duration: 550, to: ['scale(1.4)', 'blur(12px)'] });
  await expect(page.locator('.project-flight')).toHaveCount(0);
  expect(await page.locator('[data-flying]').count()).toBe(0);
  expect(await page.locator('.focus-frame').evaluate((el) => 'concealed' in (el as HTMLElement).dataset || document.documentElement.dataset.leaving !== undefined)).toBe(true);
  await expect.poll(backing).toBeNull();
  // Let go of once there: nothing stays scaled or blurred.
  expect(await page.locator('[data-project-stage]').evaluate((el) => [getComputedStyle(el).transform, getComputedStyle(el).filter, el.getAnimations().length])).toEqual(['none', 'none', 0]);
  near(await rect('[data-trigger]'), tile);
  near(await rect('[data-neighbour]'), neighbour);
  await expect.poll(() => page.locator('.focus-frame').evaluate((el) => 'concealed' in (el as HTMLElement).dataset)).toBe(false);
});

test('opened under the menu’s backing or not, the canvas comes home only once neither holds it', async ({ page }) => {
  await focusOnProject(page);
  const backing = () => page.evaluate(() => (window as unknown as { __canvas: { backing: () => { u: number; to: 0 | 1 } | null } }).__canvas.backing());
  await page.keyboard.press('p');
  await covered(page);
  // The menu over the project view, and closed again: the canvas stays back, under the project view.
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  expect(await backing()).toEqual({ u: 1, to: 1 });
  expect(await openProject(page)).not.toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(backing).toBeNull();
});

test('with reduced motion nothing flies: it only fades', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await focusOnProject(page);
  // Counts every copy that is ever added.
  await page.evaluate(() => {
    const w = window as unknown as { flights: number };
    w.flights = 0;
    new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => (w.flights += (n as Element).classList?.contains('project-flight') ? 1 : 0)))).observe(document.body, { childList: true });
  });
  await page.keyboard.press('p');
  await covered(page);
  await page.keyboard.press('Escape');
  await gone(page);
  expect(await page.evaluate(() => (window as unknown as { flights: number }).flights)).toBe(0);
  expect(await page.locator('[data-flying]').count()).toBe(0);
});

test('it opens with the image it was opened on at the centre of the window, and scrolls endlessly, either way; the canvas never moves', async ({ page }) => {
  await focusOnProject(page, 4, { notFirst: true });
  const image = await active(page);
  const before = await camera(page);
  await page.keyboard.press('p');
  await covered(page);
  const box = (await (await nearest(page, image)).boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - 450)).toBeLessThan(1.5);
  // Down, then up, well past a whole run of the images each way: it never runs out, and never stops.
  const scroll = () => scroller(page).evaluate((el) => el.scrollTop);
  const period = await page.evaluate(() => {
    const l = document.querySelector('[data-project-images]')!;
    return (l.querySelector('[data-run="1"]') as HTMLElement).offsetTop - (l.firstElementChild as HTMLElement).offsetTop;
  });
  await page.mouse.move(720, 450);
  for (const dy of [600, -600]) {
    for (let moved = 0; moved < period * 1.5; moved += 600) {
      const at = await scroll();
      await page.mouse.wheel(0, dy);
      await expect.poll(async () => Math.abs((await scroll()) - at)).toBeGreaterThan(0);
      // Always a window's height of images below and above.
      const room = await scroller(page).evaluate((el) => ({ below: el.scrollHeight - el.scrollTop - el.clientHeight, above: el.scrollTop }));
      expect(room.below).toBeGreaterThan(450);
      expect(room.above).toBeGreaterThan(450);
    }
  }
  expect(await camera(page)).toEqual(before);
  // The arrow keys scroll it too.
  const s = await scroll();
  await page.keyboard.press('ArrowDown');
  await expect.poll(scroll).not.toBe(s);
  expect(await camera(page)).toEqual(before);
});

test('the images run down one column at the centre, a little wider than the focused view’s image, every one as wide as it', async ({ page }) => {
  await focusOnProject(page, 4);
  await page.keyboard.press('p');
  await covered(page);
  const items = await page.evaluate(() => [...document.querySelectorAll('[data-project-images] [data-image]')].map((el) => (({ left, right, top, height }) => ({ left, right, top, height }))(el.getBoundingClientRect())));
  // A little wider than the focused view's longest image (which it was opened from), a good deal narrower than 58% of the window.
  const focused = await page.evaluate(() => {
    const c = (window as unknown as { __canvas: { geometry: () => { s: number }; zoomInLevel: () => number } }).__canvas;
    return (4 / 3) * c.geometry().s * c.zoomInLevel();
  });
  const width = Math.min(1440 * 0.58, focused * 1.1);
  expect(width).toBeGreaterThan(focused);
  expect(width).toBeLessThan(1440 * 0.5);
  for (const item of items) {
    expect(Math.abs(item.right - item.left - width)).toBeLessThan(1);
    expect(Math.abs((item.left + item.right) / 2 - 720)).toBeLessThan(1);
  }
  // Its images are asked for at that width.
  const sizes = await page.locator('[data-project-images] img').first().getAttribute('sizes');
  expect(sizes).toBe(`(min-width: 760px) ${Math.round(width)}px, 100vw`);
  // One under the next.
  for (let n = 1; n < items.length; n++) expect(items[n]!.top).toBeGreaterThan(items[n - 1]!.top + items[n - 1]!.height);
  // Nothing else on the page: just the images.
  expect(await view(page).evaluate((el) => (el as HTMLElement).innerText.trim())).toBe('');
  // The header and info bar stay over it: at the top right, the view's Back.
  const hit = await page.evaluate(() => document.elementFromPoint(innerWidth - 40, 34)?.closest('[data-project-back]') !== null);
  expect(hit).toBe(true);
});

test('P or Esc fades back to exactly the focused view it was opened on, taking input again', async ({ page }) => {
  await focusOnProject(page);
  const image = await active(page);
  const before = await camera(page);
  for (const key of ['p', 'Escape']) {
    await page.keyboard.press('p');
    await covered(page);
    await page.keyboard.press(key);
    expect(await openProject(page)).toBeNull();
    await gone(page);
    expect(await camera(page)).toEqual(before);
    expect(await active(page)).toBe(image);
    expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');
  }
  // Once the canvas is home, as after the menu.
  await page.waitForFunction(() => (window as unknown as { __canvas: { backing: () => unknown } }).__canvas.backing() === null);
  await page.keyboard.press('ArrowRight');
  await settled(page);
  expect(await active(page)).not.toBe(image);
});

test('picking one of its images comes back to the focused view on that image', async ({ page }) => {
  await focusOnProject(page, 4);
  const p = await project(page);
  const from = await active(page);
  const pick = p.images.find((n) => n !== from)!;
  await page.keyboard.press('p');
  await covered(page);
  await (await nearest(page, pick)).click();
  expect(await openProject(page)).toBeNull();
  // The column goes on past the camera as the canvas comes home onto it.
  await expect(page.locator('.project-flight')).toHaveCount(0);
  await gone(page);
  await settled(page);
  expect(await active(page)).toBe(pick);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');
  // Centred on it, the frame round it.
  const tile = await page.evaluate(() => {
    const frame = document.querySelector('.focus-frame')!.getBoundingClientRect();
    return { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2, opacity: Number(getComputedStyle(document.querySelector('.focus-frame')!).opacity) };
  });
  expect(Math.abs(tile.x - 720)).toBeLessThan(2);
  expect(Math.abs(tile.y - 450)).toBeLessThan(2);
  await expect.poll(() => page.locator('.focus-frame').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
});

test('zoomed out, P opens the active image’s project too', async ({ page }) => {
  await page.goto('/?test');
  await settled(page);
  const p = await project(page);
  await page.keyboard.press('p');
  await covered(page);
  expect(await openProject(page)).toBe(p.title);
  await page.keyboard.press('Escape');
  await gone(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('out');
});

test('the crossfade, the image’s flight, the column’s move and the canvas backing away run at the display’s full rate', async ({ page }) => {
  // As in zoom.spec: the canvas's videos starting up after load would be measured, not the fade.
  await page.addInitScript(() => {
    addEventListener('load', () => (window as unknown as { __canvas: { renderer: { setVideos: (on: boolean) => void } } }).__canvas.renderer.setVideos(false));
  });
  await focusOnProject(page, 6);
  // Readied while the canvas is idle (projectview.ts, prepare), as it is by the time anyone presses P.
  await page.waitForTimeout(1000);
  const record = (key: string) =>
    page.evaluate(async (key) => {
      const el = document.querySelector<HTMLElement>('section[data-project-view]')!;
      const stage = document.querySelector<HTMLElement>('[data-project-stage]')!;
      const out = { longest: 0, at: 0, loaf: [] as number[], opacity: [] as number[], flight: [] as number[][], stage: [] as number[] };
      new PerformanceObserver((l) => l.getEntries().forEach((e) => out.loaf.push(e.duration))).observe({ type: 'long-animation-frame' });
      let last = performance.now();
      const t0 = last;
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await new Promise<void>((resolve) => {
        const tick = () => {
          const now = performance.now();
          if (now - last > out.longest) {
            out.longest = now - last;
            out.at = now - t0;
          }
          last = now;
          const opacity = Number(getComputedStyle(el).opacity);
          out.opacity.push(opacity);
          const copy = document.querySelector('.project-flight');
          if (copy) {
            const r = copy.getBoundingClientRect();
            out.flight.push([r.left, r.top, r.width]);
          }
          const moving = stage.getAnimations().length > 0;
          if (moving) out.stage.push(stage.getBoundingClientRect().width / innerWidth);
          // Until the fade, the flight and the stage's move are done. (Then, closing, the canvas's videos start again: see main.ts.)
          if ((opacity !== (key === 'p' ? 1 : 0) || copy || moving || out.stage.length === 0) && now - t0 < 1500) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return out;
    }, key);
  const smooth = (r: { longest: number; at: number; loaf: number[]; opacity: number[]; flight: number[][]; stage: number[] }, up: boolean) => {
    expect(r.loaf.filter((d) => d > 50)).toEqual([]);
    expect(r.longest, `the frame ending ${Math.round(r.at)} ms in, ${up ? 'opening' : 'closing'}`).toBeLessThan(30);
    for (let n = 1; n < r.opacity.length; n++) {
      if (up) expect(r.opacity[n]!).toBeGreaterThanOrEqual(r.opacity[n - 1]!);
      else expect(r.opacity[n]!).toBeLessThanOrEqual(r.opacity[n - 1]!);
    }
    expect(r.opacity.at(-1)).toBe(up ? 1 : 0);
    // Opening, the copy moves and scales one way all the way, never doubling back; closing, there is none.
    if (up) {
      expect(r.flight.length).toBeGreaterThan(20);
      for (const k of [0, 1, 2]) {
        const d = r.flight.slice(1).map((f, n) => f[k]! - r.flight[n]![k]!).filter((d) => Math.abs(d) > 0.01);
        expect(d.every((x) => x > 0) || d.every((x) => x < 0)).toBe(true);
      }
    } else {
      expect(r.flight).toEqual([]);
    }
    // The column comes in, shrinking to its size, or goes, growing, one way all the way.
    expect(r.stage.length).toBeGreaterThan(up ? 20 : 12);
    for (let n = 1; n < r.stage.length; n++) {
      if (up) expect(r.stage[n]!).toBeLessThanOrEqual(r.stage[n - 1]! + 1e-6);
      else expect(r.stage[n]!).toBeGreaterThanOrEqual(r.stage[n - 1]! - 1e-6);
    }
  };
  smooth(await record('p'), true);
  // A look at it first: its videos start as it covers the window, and starting one is not the fade's to measure.
  await page.waitForTimeout(600);
  smooth(await record('Escape'), false);
});

test('its videos play while open and on screen, and the canvas’s hold still under it', async ({ page }) => {
  await focusOnProject(page, 3, { withVideo: true });
  const playing = (selector: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLVideoElement>(s)].filter((v) => !v.paused).length, selector);
  await page.keyboard.press('p');
  await covered(page);
  expect(await playing('[data-canvas] video')).toBe(0);
  // Scroll each video in turn into view: one plays.
  await page.locator('[data-project-images] video').first().scrollIntoViewIfNeeded();
  await expect.poll(() => playing('section[data-project-view] video'), { timeout: 8000 }).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  expect(await playing('section[data-project-view] video')).toBe(0);
});

test('going to the about view closes it', async ({ page }) => {
  await focusOnProject(page);
  await page.keyboard.press('p');
  await covered(page);
  await page.keyboard.press('a');
  expect(await openProject(page)).toBeNull();
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.route() === 'about');
  await gone(page);
});

test('it has the glass edges too: the bands cut out of the column and drawn again, bent, redrawn as it scrolls', async ({ page }) => {
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => (window as unknown as { __canvas: { renderer: { setVideos: (on: boolean) => void } } }).__canvas.renderer.setVideos(false)));
  await page.goto('/?test&glass');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  await page.keyboard.press('p');
  await covered(page);
  // Its own glass, in the view (so it fades with it), masking the same bands out of the column as the canvas's does out of the tiles.
  const glass = await page.evaluate(() => {
    const view = document.querySelector('section[data-project-view]')!;
    const canvas = view.querySelector('canvas[data-glass]');
    const mask = (el: HTMLElement) => ({ image: el.style.maskImage, size: el.style.maskSize, position: el.style.maskPosition });
    return {
      inView: canvas !== null && canvas.nextElementSibling === view.querySelector('[data-project-scroll]'),
      column: mask(view.querySelector('[data-project-scroll]')!),
      tiles: mask(document.querySelector('[data-canvas-layer]')!),
    };
  });
  expect(glass.inView).toBe(true);
  // The same gradient over the window: clear through each band, then fading in through the strip past it (glass.ts, clip).
  expect(glass.column.image).toMatch(/^linear-gradient\(/);
  expect(glass.column).toEqual(glass.tiles);
  const bandEdge = (Number(/transparent ([\d.]+)%/.exec(glass.column.image)![1]) / 100) * 900;
  // Through the top band, the image under it, not the bare background: the column itself is cut away there.
  const band = async () => {
    const shot = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: bandEdge - 2 }, animations: 'disabled' }));
    const column = { from: Math.round(1440 * 0.21 + 8), to: Math.round(1440 * 0.79 - 8) };
    let off = 0;
    const bg = [shot.data[0], shot.data[1], shot.data[2]];
    for (let y = 0; y < shot.height; y += 4)
      for (let x = column.from; x < column.to; x += 4) {
        const k = (y * shot.width + x) * 4;
        if (Math.abs(shot.data[k]! - bg[0]!) + Math.abs(shot.data[k + 1]! - bg[1]!) + Math.abs(shot.data[k + 2]! - bg[2]!) > 24) off++;
      }
    return { off, data: shot.data };
  };
  // An image under the top band.
  await scroller(page).evaluate((el) => {
    const item = [...el.querySelectorAll('[data-image]')].find((i) => i.getBoundingClientRect().top < -40 && i.getBoundingClientRect().bottom > 120);
    if (!item) el.scrollTop += el.querySelector('[data-image]')!.getBoundingClientRect().height / 2;
  });
  await page.waitForTimeout(300);
  const before = await band();
  expect(before.off).toBeGreaterThan(50);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 333);
  await page.waitForTimeout(400);
  const after = await band();
  expect(Buffer.compare(Buffer.from(before.data), Buffer.from(after.data))).not.toBe(0);
});

test('at the bands\' inner edges, where nothing bends yet, the glass\'s copy of the column lines up with the page to the pixel', async ({ browser }) => {
  // At 2×, where a box laid out between whole px is drawn a device px from where it's laid out (projectview.ts, glassFrame).
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => (window as unknown as { __canvas: { renderer: { setVideos: (on: boolean) => void } } }).__canvas.renderer.setVideos(false)));
  await page.goto('/?test&glass');
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  await page.keyboard.press('p');
  await covered(page);
  // An image across the top band's edge.
  await scroller(page).evaluate((el) => {
    const item = [...el.querySelectorAll<HTMLElement>('[data-image]')].find((i) => i.getBoundingClientRect().top > 300)!;
    el.scrollTop += item.getBoundingClientRect().top - 72 + item.getBoundingClientRect().height / 2;
  });
  await page.waitForTimeout(600);
  // Rows 60–72 of the window, in device px.
  const rows = async () => PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 60, width: 1440, height: 12 }, animations: 'disabled' }));
  const glass = await rows();
  // The page itself there: the glass hidden, nothing masked out.
  await page.evaluate(() => {
    for (const c of document.querySelectorAll<HTMLElement>('canvas[data-glass]')) c.style.visibility = 'hidden';
    for (const el of document.querySelectorAll<HTMLElement>('[data-canvas-layer], [data-project-scroll]')) el.style.setProperty('mask-image', 'none', 'important');
  });
  await page.waitForTimeout(300);
  const own = await rows();
  const W = glass.width;
  // Just inside the band (the last 6 css px of it), against the page, unshifted and a device px either way: unshifted is best, by far.
  const error = (dx: number) => {
    let sum = 0;
    let n = 0;
    for (let y = 12; y < 24; y++)
      for (let x = 800; x < 2080; x++) {
        const a = (y * W + x) * 4;
        const b = (y * W + x + dx) * 4;
        for (let c = 0; c < 3; c++) sum += Math.abs(glass.data[a + c]! - own.data[b + c]!);
        n++;
      }
    return sum / n;
  };
  const [left, none, right] = [error(-1), error(0), error(1)];
  expect(none).toBeLessThan(6);
  expect(none).toBeLessThan(Math.min(left, right));
  await context.close();
});

test('on a phone the images take the whole width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await focusOnProject(page, 4);
  await page.keyboard.press('p');
  await covered(page);
  const layout = await page.evaluate(() => {
    const v = document.querySelector('[data-project-scroll]')!;
    const items = [...document.querySelectorAll('[data-project-images] [data-image]')].map((el) => (({ left, width }) => ({ left, width }))(el.getBoundingClientRect()));
    return { items, scrolls: v.scrollWidth > v.clientWidth };
  });
  expect(layout.scrolls).toBe(false);
  for (const item of layout.items) expect(item).toEqual({ left: 16, width: 390 - 32 });
});
