import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media } from '../src/assets/media';
import { INTRO_DISTANCE, INTRO_CRUISE, INTRO_CRUISE_RATE, INTRO_DURATION, INTRO_FOG_CLEAR, INTRO_FOG_FAR, INTRO_HANDOVER, INTRO_LINES, INTRO_PACE, INTRO_TITLE_IN, INTRO_TITLE_IN_DURATION, INTRO_TITLE_OUT, INTRO_WAIT, PIXEL_GRID, SEED } from '../src/canvas/config';
import type { IntroTile } from '../src/canvas/intro';
import { INTRO_LENGTH, INTRO_STRIDE, introDistance, introFog, introFrame, introInstances, introLetter, introLineCount, introPalette, introTitleEnd, introTravel, LINE_CLEAR } from '../src/canvas/intro';
import { hexRgb, pixelColor, pixelColors } from '../src/canvas/pixels';

/** Seconds in, u of the way from launch to landing. */
const at = (u: number) => INTRO_CRUISE + u * INTRO_DURATION;
const frame = (t: number) => introFrame(t, { z: 0, tail: 0, scale: 0, closed: 0, corners: 0, fade: 0, rays: 0 });
/** A portrait tile, its cells numbered in the red channel so each can be told apart. */
const CELLS = PIXEL_GRID.portrait[0] * PIXEL_GRID.portrait[1];
const pixels = Array.from({ length: CELLS }, (_, n) => `${(n % 256).toString(16).padStart(2, '0')}8040`).join('');
const tile = (x: number, y: number): IntroTile => ({ i: 1, j: 2, x, y, width: 300, height: 400, radius: 12, aspect: 'portrait', pixels });
const palette = [hexRgb('ff8040')];

/** What the layer gets for one instance. */
const instance = (data: Float32Array, n: number) => {
  const v = [...data.subarray(n * INTRO_STRIDE, (n + 1) * INTRO_STRIDE)];
  return { pos: v.slice(0, 2), offset: v.slice(2, 4), half: v.slice(4, 6), thin: v[6]!, color: v.slice(10, 13), depth: v.slice(14, 16), pace: v[16]! };
};

describe('the intro camera', () => {
  it('sets out far off and lands exactly', () => {
    expect(introDistance(INTRO_CRUISE)).toBeGreaterThan(INTRO_DISTANCE);
    expect(introDistance(INTRO_LENGTH)).toBe(0);
    expect(introDistance(INTRO_LENGTH + 1)).toBe(0);
  });

  it('only ever comes closer, never stopping on the way', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: INTRO_LENGTH - 0.05, noNaN: true }), (t) => {
        expect(introDistance(t + 0.02)).toBeLessThan(introDistance(t));
      }),
    );
  });

  /** The rate of the flight at t, as seen: in ratios, a second. */
  const speed = (t: number) => (Math.log1p(introDistance(t)) - Math.log1p(introDistance(t + 0.02))) / 0.02;

  it('is already under way, at a steady rate, while the name is up', () => {
    expect(speed(0)).toBeCloseTo(INTRO_CRUISE_RATE);
    expect(speed(INTRO_CRUISE - 0.1)).toBeCloseTo(INTRO_CRUISE_RATE);
  });

  it('only speeds up from there, until it brakes: no lull before the launch', () => {
    const peak = at(0.2);
    for (let t = 0; t < peak; t += 0.05) expect(speed(t + 0.05)).toBeGreaterThanOrEqual(speed(t) - 1e-6);
    expect(speed(peak)).toBeGreaterThan(INTRO_CRUISE_RATE * 8);
  });

  it('flies the same way however late it launches, up to the launch', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: INTRO_CRUISE, noNaN: true }), fc.double({ min: 0, max: INTRO_WAIT, noNaN: true }), (t, wait) => {
        expect(introDistance(t, wait)).toBeCloseTo(introDistance(t));
      }),
    );
  });

  it('launched late, still only speeds up, and lands exactly, as far from any lull', () => {
    const speed = (t: number) => (Math.log1p(introDistance(t, INTRO_WAIT)) - Math.log1p(introDistance(t + 0.02, INTRO_WAIT))) / 0.02;
    const launch = INTRO_CRUISE + INTRO_WAIT;
    for (let t = launch - 0.5; t < launch + 0.3; t += 0.05) expect(speed(t + 0.05)).toBeGreaterThanOrEqual(speed(t) - 1e-6);
    expect(speed(launch + 0.4)).toBeGreaterThan(INTRO_CRUISE_RATE * 6);
    expect(introDistance(INTRO_LENGTH + INTRO_WAIT, INTRO_WAIT)).toBe(0);
    expect(introDistance(INTRO_LENGTH + INTRO_WAIT - 0.5, INTRO_WAIT)).toBeGreaterThan(0);
  });

  /** How fast the zoom changes, as seen: in ratios. */
  const rate = (u: number) => Math.log1p(introDistance(at(u))) - Math.log1p(introDistance(at(u + 0.01)));

  it('launches, peaks early, and spends most of its time easing out', () => {
    const rates = Array.from({ length: 99 }, (_, n) => rate(n / 100));
    const peak = rates.indexOf(Math.max(...rates)) / 100;
    expect(peak).toBeGreaterThan(0.08);
    expect(peak).toBeLessThan(0.3);
    for (let u = peak + 0.02; u < 0.98; u += 0.02) expect(rate(u)).toBeLessThanOrEqual(rate(u - 0.02));
    expect(rate(0.7)).toBeLessThan(rate(peak) / 10);
  });

  it('draws streaks longest at speed, and none once the images take over', () => {
    const streak = (u: number) => {
      const f = frame(at(u));
      return Math.log((1 + f.tail) / (1 + f.z));
    };
    expect(streak(0.2)).toBeGreaterThan(streak(0.4));
    const over = Array.from({ length: 1000 }, (_, n) => n / 1000).find((u) => frame(at(u)).z <= INTRO_HANDOVER)!;
    expect(streak(over)).toBe(0);
    expect(frame(at(over)).closed).toBe(1);
    expect(frame(at(over)).scale).toBeGreaterThan(0.85);
  });

  it('holds the tiles\' rays back until the name has gone, and has them out just past the peak', () => {
    expect(frame(INTRO_CRUISE).rays).toBe(0);
    expect(frame(at(0.3)).rays).toBe(1);
  });

  it('is all lines at speed, and landed is flat, closed up and has its corners', () => {
    expect(frame(at(0.15))).toMatchObject({ closed: 0, corners: 0 });
    expect(frame(INTRO_LENGTH)).toMatchObject({ z: 0, tail: 0, scale: 1, closed: 1, corners: 1, fade: 1, rays: 1 });
  });

  it('fades up out of nothing', () => {
    expect(frame(0).fade).toBe(0);
  });
});

describe('the depth fog', () => {
  it('leaves everything near solid, so tiles land at their true colours', () => {
    expect(introFog(1)).toBe(1);
    expect(introFog(INTRO_FOG_CLEAR)).toBe(1);
  });

  it('tapers without a step, always fainter further off, never gone', () => {
    fc.assert(
      fc.property(fc.double({ min: INTRO_FOG_CLEAR, max: 200, noNaN: true }), (depth) => {
        const [near, far] = [introFog(depth), introFog(depth + 0.5)];
        expect(far).toBeLessThan(near);
        expect(near - far).toBeLessThan(0.05);
        expect(far).toBeGreaterThanOrEqual(INTRO_FOG_FAR);
      }),
    );
  });
});

describe('the controls', () => {
  it('wait below the mask, rise to their place, and leave above it', () => {
    expect(introLetter(0, 0)).toBe(1);
    expect(introLetter(INTRO_TITLE_OUT - 0.01, 0)).toBeCloseTo(0, 2);
    expect(introLetter(introTitleEnd(10), 0)).toBe(-1);
  });

  it('sets them off one after the other', () => {
    const t = INTRO_TITLE_IN + 0.1;
    expect(introLetter(t, 0)).toBeLessThan(introLetter(t, 1));
    expect(introLetter(introTitleEnd(10), 9)).toBe(-1);
  });

  it('stay up long enough to read', () => {
    const readable = INTRO_TITLE_IN + INTRO_TITLE_IN_DURATION * 0.7;
    expect(INTRO_TITLE_OUT - readable).toBeGreaterThan(1);
  });

  it('are gone before the wormhole gets going', () => {
    expect(introTitleEnd(5)).toBeLessThanOrEqual(INTRO_CRUISE + 1e-9);
  });
});

describe('what the intro draws', () => {
  it('makes up each tile from a ray per cell of its grid, landing exactly on that cell', () => {
    const data = introInstances([tile(-500, 40)], palette, 1440, 900, SEED);
    const [cols, rows] = PIXEL_GRID.portrait;
    for (let n = 0; n < cols * rows; n++) {
      const ray = instance(data, n);
      expect(ray.pos).toEqual([-500, 40]);
      // At depth 1 with the camera landed: where it lies on the canvas.
      expect(ray.depth[0]).toBe(1);
      expect(ray.thin).toBeLessThan(0.5);
      const col = n % cols;
      const row = Math.floor(n / cols);
      // Exactly its own part of the tile, overlapping its neighbours by a hair.
      expect(ray.offset[0]! - ray.half[0]!).toBeCloseTo(-150 + (300 * col) / cols - 0.5);
      expect(ray.offset[1]! + ray.half[1]!).toBeCloseTo(-200 + (400 * (row + 1)) / rows + 0.5);
      expect(ray.color[0]).toBeCloseTo((n % 256) / 255);
    }
  });

  it('gives rays their own pace: some ahead, some behind, a few far behind', () => {
    const paces = Array.from({ length: CELLS }, (_, n) => instance(introInstances([tile(0, 0)], palette, 100, 100, SEED), n).pace);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(0.25);
    for (const pace of paces) {
      expect(pace).toBeGreaterThanOrEqual(INTRO_PACE[0]);
      expect(pace).toBeLessThanOrEqual(INTRO_PACE[1]);
    }
  });

  it('lets tiles differ too, so they arrive in waves', () => {
    const mean = (i: number) => {
      const data = introInstances([{ ...tile(0, 0), i }], palette, 0, 0, SEED);
      return Array.from({ length: CELLS }, (_, n) => instance(data, n).pace).reduce((a, b) => a + b) / CELLS;
    };
    const means = Array.from({ length: 12 }, (_, i) => mean(i));
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(0.15);
  });

  it('spreads rays out in flight, and brings them together exactly on the way in', () => {
    fc.assert(
      fc.property(fc.double({ min: INTRO_PACE[0], max: INTRO_PACE[1], noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (pace, closed) => {
        expect(introTravel(INTRO_HANDOVER, pace, closed)).toBeCloseTo(INTRO_HANDOVER);
        expect(introTravel(0, pace, closed)).toBe(0);
        expect(introTravel(0.5, pace, 1)).toBeCloseTo(0.5);
      }),
    );
    expect(introTravel(5, INTRO_PACE[1], 0)).toBeGreaterThan(5 * 3);
    expect(introTravel(5, INTRO_PACE[0], 0)).toBeLessThan(5 / 1.5);
  });

  it('counts every cell of every tile, whatever its shape', () => {
    const square: IntroTile = { ...tile(0, 0), aspect: 'square', pixels: 'ff8040'.repeat(21 * 21) };
    expect(introInstances([tile(0, 0), square], palette, 100, 100, SEED).length / INTRO_STRIDE).toBe(CELLS + 21 * 21 + introLineCount(100, 100));
  });

  it('sends every line off screen before the tiles land', () => {
    const data = introInstances([], palette, 1440, 900, SEED);
    const count = data.length / INTRO_STRIDE;
    expect(count).toBe(introLineCount(1440, 900));
    const reach = Math.hypot(1440, 900) / 2;
    for (let n = 0; n < count; n++) {
      const { pos, half, depth } = instance(data, n);
      expect(depth[0]).toBeLessThanOrEqual(1);
      // Outside the view, or passed already.
      if (1 - depth[0]! <= LINE_CLEAR) expect(Math.hypot(pos[0]!, pos[1]!) - Math.max(...half)).toBeGreaterThan(reach);
      else expect(depth[0]! + introDistance(at(0.75)) * depth[1]!).toBeLessThan(0);
    }
  });

  it('draws the lines like the rays, so the two read as one field', () => {
    const median = (values: number[]) => values.sort((a, b) => a - b)[values.length >> 1]!;
    const rayData = introInstances([tile(0, 0)], palette, 0, 0, SEED);
    const lineData = introInstances([], palette, 1440, 900, SEED);
    const rays = Array.from({ length: CELLS }, (_, n) => instance(rayData, n));
    const lines = Array.from({ length: lineData.length / INTRO_STRIDE }, (_, n) => instance(lineData, n));
    // A ray's width in flight, and a line's, which never thins.
    const rayWidth = median(rays.map((r) => r.half[0]! * r.thin));
    const lineWidth = median(lines.map((l) => l.half[0]!));
    expect(lineWidth / rayWidth).toBeGreaterThan(0.6);
    expect(lineWidth / rayWidth).toBeLessThan(1.6);
    expect(Math.abs(median(lines.map((l) => l.pace)) - median(rays.map((r) => r.pace)))).toBeLessThan(0.25);
    // Solid, and most about as far back as the rays.
    expect(median(lines.map((l) => l.depth[1]!))).toBeGreaterThan(0.6);
    for (let n = 0; n < lines.length; n++) expect(lineData[n * INTRO_STRIDE + 13]).toBeGreaterThanOrEqual(0.85);
  });

  it('strings the lines out along the tunnel, for the camera to pass from the start', () => {
    const data = introInstances([], palette, 1440, 900, SEED);
    const lines = Array.from({ length: data.length / INTRO_STRIDE }, (_, n) => instance(data, n));
    const depth = (t: number, line: (typeof lines)[number]) => line.depth[0]! + introDistance(t) * line.depth[1]!;
    // All in front of the camera to begin with, and plenty go by while the name is up.
    expect(lines.every((line) => depth(0, line) >= 1 - 1e-3)).toBe(true);
    expect(lines.filter((line) => depth(INTRO_CRUISE, line) < 0).length).toBeGreaterThan(100);
  });

  it('leaves no hole in the middle of the tunnel', () => {
    const data = introInstances([], palette, 1440, 900, SEED);
    const reach = Math.hypot(1440, 900) / 2;
    const lines = Array.from({ length: data.length / INTRO_STRIDE }, (_, n) => instance(data, n));
    const radii = lines.map(({ pos }) => Math.hypot(pos[0]!, pos[1]!));
    expect(radii.filter((r) => r < reach * 0.1).length).toBeGreaterThan(50);
    // But never dead on the axis: the layer holds a passed line 0.02 from the camera, which
    // has to put it off screen.
    expect(Math.min(...radii) / 0.02).toBeGreaterThan(reach);
  });

  it('scales the lines to the screen, up to a limit', () => {
    expect(introLineCount(390, 844)).toBeLessThan(introLineCount(1440, 900));
    expect(introLineCount(5000, 3000)).toBe(INTRO_LINES);
  });

  it('is the same every load', () => {
    expect(introInstances([tile(1, 2)], palette, 800, 600, SEED)).toEqual(introInstances([tile(1, 2)], palette, 800, 600, SEED));
  });

  it('colours the lines with what shows against the background', () => {
    const colors = ['080808', '101010', 'ff8040', 'e8e8e8', '40a0ff', 'f0f040'].map(hexRgb);
    expect(introPalette(colors, hexRgb('0a0a0a'))).toHaveLength(4);
    // Too few that show: better all of them than the same line over and over.
    expect(introPalette(['080808', 'ffffff'].map(hexRgb), hexRgb('0a0a0a'))).toHaveLength(2);
  });
});

describe('colour grids', () => {
  it('every image has one, the right size for its shape', () => {
    expect(media.length).toBeGreaterThan(50);
    for (const { file, aspect, pixels } of media) {
      const [cols, rows] = PIXEL_GRID[aspect];
      expect(pixels, file).toMatch(new RegExp(`^[0-9a-f]{${cols * rows * 6}}$`));
    }
  });

  it('shows the image, not a flat colour', () => {
    const flat = media.filter(({ pixels }) => new Set(pixelColors(pixels).map(String)).size === 1);
    expect(flat).toHaveLength(0);
  });

  it('reads back cell by cell', () => {
    expect(pixelColor('000000ff8040', 1)).toBe('ff8040');
    expect(pixelColors('000000ffffff')).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
  });
});
