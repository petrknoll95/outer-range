import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

interface Api {
  isSettled: () => boolean;
  zoomState: () => 'out' | 'in';
  physics: { x: number; y: number };
  flight: () => { u: number; to: 0 | 1 } | null;
  holdFlight: (u: number | null) => void;
  route: () => 'home' | 'about';
  activeImage: () => { image: number } | null;
}
async function open(page: Page): Promise<void> {
  await page.goto('/?test');
  await settled(page);
}
const settled = (page: Page) => page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });

/** What the page recorded about every tile on screen, every frame. */
interface Samples {
  tiles: { w: number; h: number }[];
  /** [ms, ...per tile x, y, scale, opacity, blur (screen px)], one per frame. */
  frames: number[][];
  /** Long animation frames, ms. */
  loaf: number[];
}

/**
 * Sample every tile on screen, every frame from now on. The samples go to sessionStorage as
 * they are taken, so they outlast the page: read them with samples() from the next one.
 */
const sampleTiles = (page: Page) =>
  page.evaluate(() => {
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && el.style.opacity !== '0';
    });
    const out = { tiles: tiles.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight })), frames: [] as number[][], loaf: [] as number[] };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) out.loaf.push(e.duration);
    }).observe({ type: 'long-animation-frame' });
    const t0 = performance.now();
    // (The browser reads the 0 back as 0px.)
    const read = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0(?:px)?\)(?: scale\(([-\d.e]+)\))?/;
    const tick = () => {
      const row = [performance.now() - t0];
      for (const el of tiles) {
        const m = read.exec(el.style.transform)!;
        const scale = Number(m[3] ?? 1);
        // The blur is drawn before the scale: on screen it is that times the scale.
        const blur = Number(/blur\(([\d.e]+)px\)/.exec(el.style.filter)?.[1] ?? 0) * scale;
        row.push(Number(m[1]), Number(m[2]), scale, el.style.opacity === '' ? 1 : Number(el.style.opacity), blur);
      }
      out.frames.push(row);
      sessionStorage.setItem('samples', JSON.stringify(out));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const samples = (page: Page): Promise<Samples> => page.evaluate(() => JSON.parse(sessionStorage.getItem('samples')!));

/** Fly out from the keyboard: a plain navigation (nothing prerendered), so sessionStorage carries over. */
async function enterAbout(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'About' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/about', { timeout: 5000 });
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.u === 1, null, { timeout: 5000 });
}

/** Every frame the browser composites from now on, through any change of page, as PNGs. */
async function screencast(page: Page): Promise<{ stop: () => Promise<Buffer[]> }> {
  const cdp = await page.context().newCDPSession(page);
  const shots: Buffer[] = [];
  cdp.on('Page.screencastFrame', (f) => {
    shots.push(Buffer.from(f.data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  return {
    stop: async () => {
      await cdp.send('Page.stopScreencast').catch(() => {});
      return shots;
    },
  };
}

/** The header's band at the top of the screen, px: it stays as it is through the flight. */
const HEADER_BAND = 60;
/** The info bar's band at the bottom (InfoBar.astro), px: it stays put too. */
const INFO_BAND = 60;

/** The colour of a PNG if every pixel between the header and the info bar is that colour (within a couple of levels), else null. */
function uniformColour(png: Buffer): number[] | null {
  const { data, width, height } = PNG.sync.read(png);
  const from = HEADER_BAND * width * 4;
  const to = (height - INFO_BAND) * width * 4;
  const first = [data[from]!, data[from + 1]!, data[from + 2]!];
  for (let k = from; k < to; k += 4) {
    for (let c = 0; c < 3; c++) if (Math.abs(data[k + c]! - first[c]!) > 2) return null;
  }
  return first;
}

test('the About link sits at the top right, set exactly like the wordmark', async ({ page }) => {
  await open(page);
  const link = page.getByRole('link', { name: 'About' });
  await expect(link).toHaveAttribute('href', '/about');
  const style = (sel: string) =>
    page.locator(sel).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing, s.color];
    });
  expect(await style('header a')).toEqual(await style('header h1'));
  const box = (await link.boundingBox())!;
  const mark = (await page.getByRole('heading', { name: 'Petr Knoll' }).boundingBox())!;
  expect(box.x + box.width).toBeCloseTo(1440 - 24, 0);
  expect(box.y + box.height / 2).toBeCloseTo(mark.y + mark.height / 2, 0);
});

test('About flies the camera into the canvas: every image grows outward at its own pace and fades, leaving the header over a blank page', async ({
  page,
}) => {
  await open(page);
  await sampleTiles(page);
  // The canvas alone: the about view's text, coming in over it, is checked in about.spec.
  await page.addStyleTag({ content: '[data-about] { visibility: hidden !important; }' });
  const video = await screencast(page);
  await enterAbout(page);
  await page.waitForTimeout(500);
  const shots = await video.stop();
  await expect(page).toHaveTitle('About · Petr Knoll');

  const { tiles: sizes, frames } = await samples(page);
  const tiles = sizes.length;
  expect(tiles).toBeGreaterThan(10);
  // From the frame before anything moved to the first with every tile gone.
  const end = frames.findIndex((f) => f.slice(1).every((v, k) => k % 5 !== 3 || v === 0));
  expect(end).toBeGreaterThan(5);
  const [cx, cy] = [720, 450];
  const scales: number[][] = [];
  for (let t = 0; t < tiles; t++) {
    const s0 = frames[0]![1 + t * 5 + 2]!;
    const track = frames.slice(0, end + 1).map((f) => {
      const [x, y, s, o, b] = f.slice(1 + t * 5, 6 + t * 5) as [number, number, number, number, number];
      return {
        k: s / s0,
        o,
        b,
        d: Math.hypot(x + (sizes[t]!.w * s) / 2 - cx, y + (sizes[t]!.h * s) / 2 - cy),
      };
    });
    for (let n = 1; n < track.length; n++) {
      // Only ever nearer the camera: bigger, further from the centre, fainter, blurrier.
      expect(track[n]!.k).toBeGreaterThanOrEqual(track[n - 1]!.k - 1e-9);
      expect(track[n]!.d).toBeGreaterThanOrEqual(track[n - 1]!.d - 0.01);
      expect(track[n]!.o).toBeLessThanOrEqual(track[n - 1]!.o + 1e-9);
      // (Read back to two decimals of the pre-scale blur.)
      expect(track[n]!.b).toBeGreaterThanOrEqual(track[n - 1]!.b - 0.01 * track[n]!.k * s0 - 1e-9);
    }
    expect(track[0]!.b).toBe(0);
    expect(track.at(-1)!.o).toBe(0);
    // Out of focus as it nears the camera, while it can still be seen.
    expect(Math.max(...track.filter((p) => p.o > 0.3).map((p) => p.b))).toBeGreaterThan(4);
    scales.push(track.map((p) => p.k));
  }
  // Each at its own depth: halfway through, some have grown far more than others.
  const mid = Math.round(end / 2);
  const atMid = scales.map((s) => s[mid]!);
  expect(Math.max(...atMid) / Math.min(...atMid)).toBeGreaterThan(1.3);

  // On screen: images under the header, then from the first frame with the canvas clear on,
  // through the change of page, that same frame, header and all: the new page never shows
  // anything the old one didn't.
  const blank = PNG.sync.read(await page.screenshot());
  const differs = (shot: Buffer) => {
    const png = PNG.sync.read(shot);
    return pixelmatch(blank.data, png.data, null, png.width, png.height, { threshold: 0.05 });
  };
  // The last frame is the canvas colour under the header...
  expect(uniformColour(PNG.sync.write(blank))).not.toBeNull();
  // ...and from the first frame like it, through the change of page, every frame is the same.
  const clear = shots.findIndex((shot) => differs(shot) === 0);
  expect(clear).toBeGreaterThan(0);
  for (const shot of shots.slice(clear)) expect(differs(shot)).toBe(0);
  // The header is still drawn on that blank frame, and so on the new page: it never left.
  const band = blank.data.subarray(0, HEADER_BAND * blank.width * 4);
  expect(band.some((v, k) => k % 4 < 3 && Math.abs(v - blank.data[HEADER_BAND * blank.width * 4 + (k % 4)]!) > 40)).toBe(true);
});

test('the flight there and back runs without a long frame (measured with nothing else recording)', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as unknown as { __loaf: number[] };
    w.__loaf = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__loaf.push(e.duration))).observe({ type: 'long-animation-frame' });
  });
  await page.getByRole('link', { name: 'About' }).click();
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.u === 1, null, { timeout: 5000 });
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight() === null, null, { timeout: 5000 });
  expect(await page.evaluate(() => (window as unknown as { __loaf: number[] }).__loaf)).toEqual([]);
});

test('from the zoomed-in view too: the focused image comes at the camera', async ({ page }) => {
  await open(page);
  await page.keyboard.press(' ');
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.zoomState())).toBe('in');
  await page.getByRole('link', { name: 'About' }).click();
  // Input is locked while it flies: a scroll moves nothing.
  await page.waitForTimeout(200);
  const x = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 400);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.physics.x)).toBe(x);
  // The caption has gone out.
  await expect(page.locator('.focus-caption')).toBeHidden({ timeout: 2000 });
  await page.waitForURL((url) => url.pathname === '/about', { timeout: 5000 });
});

test('a modified click opens About in a new tab and leaves the canvas as it is', async ({ page, context }) => {
  await open(page);
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'About' }).click({ modifiers: ['ControlOrMeta'] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/\/about\/?$/);
  expect(page.url()).not.toMatch(/about/);
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight())).toBeNull();
});

test('with reduced motion nothing flies: the images just fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await sampleTiles(page);
  await enterAbout(page);
  const { tiles, frames } = await samples(page);
  for (let t = 0; t < tiles.length; t++) {
    const at = (f: number[]) => f.slice(1 + t * 5, 6 + t * 5);
    // Not moved, grown or blurred at all, only faded, to nothing.
    for (const f of frames) expect([...at(f).slice(0, 3), at(f)[4]]).toEqual([...at(frames[0]!).slice(0, 3), 0]);
    expect(frames.some((f) => at(f)[3] === 0)).toBe(true);
  }
});

/** The camera, zoom state and focused image: the view a flight back must return to exactly. */
const view = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as { __canvas: Api & { physics: { z: number } } }).__canvas;
    return { x: c.physics.x, y: c.physics.y, z: c.physics.z, zoom: c.zoomState(), image: c.activeImage()?.image };
  });
/** The flight has finished: flown past (1) or back on the canvas (0), settled. */
const landed = (page: Page, at: 0 | 1) =>
  page.waitForFunction(
    (at) => {
      const c = (window as unknown as { __canvas?: Api }).__canvas;
      if (!c) return false;
      const f = c.flight();
      return at === 1 ? f?.u === 1 : f === null && c.isSettled();
    },
    at,
    { timeout: 30_000 },
  );
const label = (page: Page) => page.locator('header a').evaluate((a) => [a.textContent, a.getAttribute('href')]);

test('Back flies the canvas back in, the opposite way, to exactly the view it left: zoomed in on the same image', async ({ page }) => {
  await open(page);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(260, 140);
  await settled(page);
  await page.keyboard.press(' ');
  await settled(page);
  const before = await view(page);
  expect(before.zoom).toBe('in');
  // Watch the tile nearest the centre.
  await page.evaluate(() => {
    const d = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.hypot(r.left + r.width / 2 - innerWidth / 2, r.top + r.height / 2 - innerHeight / 2);
    };
    [...document.querySelectorAll<HTMLElement>('[data-canvas-layer] > div')].reduce((a, b) => (d(a) <= d(b) ? a : b)).dataset.watch = '';
  });
  await page.getByRole('link', { name: 'About' }).click();
  await landed(page, 1);
  expect(await label(page)).toEqual(['Back', '/']);
  // Coming back: each image shrinks into place from the camera, and fades in.
  await page.evaluate(() => {
    const w = window as unknown as { __back: number[][] };
    const el = document.querySelector<HTMLElement>('[data-watch]')!;
    w.__back = [];
    const tick = () => {
      const m = /scale\(([-\d.e]+)\)/.exec(el.style.transform);
      w.__back.push([m ? Number(m[1]) : 1, el.style.opacity === '' ? 1 : Number(el.style.opacity)]);
      if (w.__back.length < 90) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await landed(page, 0);
  const back = await page.evaluate(() => (window as unknown as { __back: number[][] }).__back);
  const moving = back.filter(([s], n) => n > 0 && s !== back[n - 1]![0]);
  expect(moving.length).toBeGreaterThan(5);
  for (let n = 1; n < back.length; n++) {
    expect(back[n]![0]).toBeLessThanOrEqual(back[n - 1]![0] + 1e-9);
    expect(back[n]![1]).toBeGreaterThanOrEqual(back[n - 1]![1] - 1e-9);
  }
  expect(await view(page)).toEqual(before);
  await expect(page).toHaveTitle('Petr Knoll');
  expect(await label(page)).toEqual(['About', '/about']);
  await expect(page.locator('.focus-caption')).toBeVisible();
});

test('Esc on the about view goes back like Back does, to the view it left, zoomed in or out', async ({ page }) => {
  await open(page);
  for (const zoom of ['out', 'in'] as const) {
    if (zoom === 'in') {
      // Focus is still on the header link, which would take Space for itself.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press(' ');
      await settled(page);
    }
    const before = await view(page);
    expect(before.zoom).toBe(zoom);
    await page.getByRole('link', { name: 'About' }).click();
    await landed(page, 1);
    await page.keyboard.press('Escape');
    await page.waitForURL((url) => url.pathname === '/');
    await landed(page, 0);
    expect(await view(page)).toEqual(before);
    expect(await label(page)).toEqual(['About', '/about']);
  }
  // Opened at /about, with no canvas behind it in history: Esc still flies the canvas in.
  await page.goto('/about?test');
  await landed(page, 1);
  await page.keyboard.press('Escape');
  await page.waitForURL((url) => url.pathname === '/');
  await landed(page, 0);
});

test('the browser’s back and forward buttons run the same flights', async ({ page }) => {
  await open(page);
  const before = await view(page);
  await page.getByRole('link', { name: 'About' }).click();
  await landed(page, 1);
  await page.goBack({ waitUntil: 'commit' });
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.to)).toBe(0);
  await landed(page, 0);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await view(page)).toEqual(before);
  await page.goForward({ waitUntil: 'commit' });
  expect(await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight()?.to)).toBe(1);
  await landed(page, 1);
  expect(new URL(page.url()).pathname).toBe('/about');
  expect(await label(page)).toEqual(['Back', '/']);
});

test('a change of mind mid-flight turns it round from where it has got to', async ({ page }) => {
  await open(page);
  const before = await view(page);
  await page.getByRole('link', { name: 'About' }).click();
  await page.waitForFunction(() => ((window as unknown as { __canvas: Api }).__canvas.flight()?.u ?? 0) > 0.3);
  await page.goBack({ waitUntil: 'commit' });
  const turned = await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.flight());
  expect(turned!.to).toBe(0);
  expect(turned!.u).toBeGreaterThan(0.3);
  expect(turned!.u).toBeLessThan(1);
  await landed(page, 0);
  expect(await view(page)).toEqual(before);
});

test('opened at /about: the canvas is flown past, and Back flies it in', async ({ page }) => {
  await page.goto('/about?test');
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.flight()?.u === 1);
  await page.addStyleTag({ content: '[data-about] { visibility: hidden !important; }' });
  expect(uniformColour(await page.screenshot())).not.toBeNull();
  expect(await label(page)).toEqual(['Back', '/']);
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await landed(page, 0);
  expect(uniformColour(await page.screenshot())).toBeNull();
  expect(await label(page)).toEqual(['About', '/about']);
});

test('reloading the about view keeps the view: Back still returns to it', async ({ page }) => {
  await open(page);
  await page.keyboard.press(' ');
  await settled(page);
  const before = await view(page);
  await page.getByRole('link', { name: 'About' }).click();
  await landed(page, 1);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.flight()?.u === 1);
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await landed(page, 0);
  const after = await view(page);
  // The same zoom state, focused on the same image, centred where it was.
  expect([after.zoom, after.image, after.z]).toEqual([before.zoom, before.image, before.z]);
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y).toBeCloseTo(before.y, 3);
});

for (const [how, wait, gesture] of [
  ['mid-scroll, all the way there', 1, 'scroll'],
  ['mid-scroll, turning back mid-flight', 0.35, 'scroll'],
  ['mid-drag, all the way there', 1, 'drag'],
] as const) {
  test(`left ${how}, the images land back without a jump`, async ({ page }) => {
    await page.goto('/?test');
    await page.waitForFunction(() => (window as unknown as { __canvas?: Api }).__canvas?.isSettled(), null, { timeout: 30_000 });
    await page.evaluate(() => {
      const record = window as unknown as { moves: { landed: boolean; d: number }[]; loop: () => void };
      record.moves = [];
      const last = new Map<Element, DOMMatrix>();
      record.loop = () => {
        let d = 0;
        for (const el of document.querySelectorAll('[data-canvas-layer] > div:not([hidden])')) {
          const m = new DOMMatrix(getComputedStyle(el).transform);
          const box = el.getBoundingClientRect();
          // Only what can be seen, there on both frames: tiles off screen as it left sit the flight out, hidden.
          const seen = (el as HTMLElement).style.visibility !== 'hidden' && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight;
          const was = last.get(el);
          if (was && seen) d = Math.max(d, Math.hypot(m.e - was.e, m.f - was.f));
          if (seen) last.set(el, m);
          else last.delete(el);
        }
        record.moves.push({ landed: (window as unknown as { __canvas: Api }).__canvas.flight() === null, d });
        requestAnimationFrame(record.loop);
      };
      record.loop();
    });
    await page.mouse.move(700, 450);
    if (gesture === 'drag') await page.mouse.down();
    for (let n = 1; n < 8; n++) {
      if (gesture === 'drag') await page.mouse.move(700 - n * 40, 450 - n * 20);
      else await page.mouse.wheel(90, 60);
      await page.waitForTimeout(16);
    }
    await page.keyboard.press('a');
    if (gesture === 'drag') await page.mouse.up();
    await page.waitForFunction((u) => ((window as unknown as { __canvas: Api }).__canvas.flight()?.u ?? 0) >= u, wait);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as unknown as { __canvas: Api }).__canvas.flight() === null);
    await page.waitForTimeout(500);
    const moves = await page.evaluate(() => (window as unknown as { moves: { landed: boolean; d: number }[] }).moves);
    let landing = moves.length - 1;
    while (moves[landing - 1]!.landed) landing--;
    expect(Math.max(...moves.slice(landing, landing + 30).map((m) => m.d))).toBeLessThan(wait === 1 ? 2 : 12);
  });
}

test("the flight goes through the intro's rays: made ahead, shown only while flying, the images' finer grids", async ({ page }) => {
  // (Only where they can be drawn smoothly, which a test's software renderer can't: `?rays` asks for them anyway.)
  await page.goto('/?test&rays');
  await settled(page);
  const rays = page.locator('canvas[data-flight-rays]');
  // Made while the page is idle, hidden until needed.
  await expect(rays).toHaveCount(1);
  await expect(rays).toBeHidden();
  await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.holdFlight(0.2));
  await page.keyboard.press('a');
  await expect(rays).toBeVisible();
  // Drawn: what it shows is a good part of the screen.
  await page.waitForTimeout(300);
  const shown = PNG.sync.read(await page.screenshot());
  await rays.evaluate((canvas) => (canvas.style.visibility = 'hidden'));
  const without = PNG.sync.read(await page.screenshot());
  await rays.evaluate((canvas) => (canvas.style.visibility = ''));
  const differ = pixelmatch(shown.data, without.data, null, shown.width, shown.height, { threshold: 0.1 });
  expect(differ / (shown.width * shown.height)).toBeGreaterThan(0.05);
  await page.evaluate(() => (window as unknown as { __canvas: Api }).__canvas.holdFlight(null));
  await landed(page, 1);
  await page.keyboard.press('Escape');
  await landed(page, 0);
  await expect(rays).toBeHidden();
});

test('with reduced motion there are no rays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?test&rays');
  await settled(page);
  await page.waitForTimeout(2500);
  await page.keyboard.press('a');
  await landed(page, 1);
  await expect(page.locator('canvas[data-flight-rays]')).toHaveCount(0);
});
