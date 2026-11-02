import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media } from '../src/assets/media';
import { INTRO_DISTANCE, INTRO_HANDOVER, INTRO_LINES, INTRO_PACE, PIXEL_GRID, SEED } from '../src/canvas/config';
import type { IntroTile } from '../src/canvas/intro';
import { INTRO_STRIDE, introDistance, introFrame, introInstances, introLineCount, introPalette, introTravel } from '../src/canvas/intro';
import { hexRgb, pixelColor, pixelColors } from '../src/canvas/pixels';

const frame = (u: number) => introFrame(u, { z: 0, tail: 0, scale: 0, closed: 0, corners: 0, fade: 0 });
/** A portrait tile, its cells numbered in the red channel so each can be told apart. */
const pixels = Array.from({ length: 48 }, (_, n) => `${n.toString(16).padStart(2, '0')}8040`).join('');
const tile = (x: number, y: number): IntroTile => ({ i: 1, j: 2, x, y, width: 300, height: 400, radius: 12, aspect: 'portrait', pixels });
const palette = [hexRgb('ff8040')];

/** What the layer gets for one instance. */
const instance = (data: Float32Array, n: number) => {
  const v = [...data.subarray(n * INTRO_STRIDE, (n + 1) * INTRO_STRIDE)];
  return { pos: v.slice(0, 2), offset: v.slice(2, 4), half: v.slice(4, 6), thin: v[6]!, color: v.slice(10, 13), depth: v.slice(14, 16), pace: v[16]! };
};

describe('the intro camera', () => {
  it('sets out far off and lands exactly', () => {
    expect(introDistance(0)).toBeCloseTo(INTRO_DISTANCE);
    expect(introDistance(1)).toBe(0);
    expect(introDistance(1.2)).toBe(0);
  });

  it('only ever comes closer', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.98, noNaN: true }), (u) => {
        expect(introDistance(u + 0.01)).toBeLessThan(introDistance(u));
      }),
    );
  });

  /** How fast the zoom changes, as seen: in ratios. */
  const rate = (u: number) => Math.log1p(introDistance(u)) - Math.log1p(introDistance(u + 0.01));

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
      const f = frame(u);
      return Math.log((1 + f.tail) / (1 + f.z));
    };
    expect(streak(0.2)).toBeGreaterThan(streak(0.4));
    const over = Array.from({ length: 1000 }, (_, n) => n / 1000).find((u) => frame(u).z <= INTRO_HANDOVER)!;
    expect(streak(over)).toBe(0);
    expect(frame(over).closed).toBe(1);
    expect(frame(over).scale).toBeGreaterThan(0.85);
  });

  it('is all lines at speed, and landed is flat, closed up and has its corners', () => {
    expect(frame(0.15)).toMatchObject({ closed: 0, corners: 0 });
    expect(frame(1)).toMatchObject({ z: 0, tail: 0, scale: 1, closed: 1, corners: 1, fade: 1 });
  });

  it('fades up out of nothing', () => {
    expect(frame(0).fade).toBe(0);
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
      expect(ray.color[0]).toBeCloseTo(n / 255);
    }
  });

  it('gives rays their own pace: some ahead, some behind, a few far behind', () => {
    const paces = Array.from({ length: 48 }, (_, n) => instance(introInstances([tile(0, 0)], palette, 100, 100, SEED), n).pace);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(0.25);
    for (const pace of paces) {
      expect(pace).toBeGreaterThanOrEqual(INTRO_PACE[0]);
      expect(pace).toBeLessThanOrEqual(INTRO_PACE[1]);
    }
  });

  it('lets tiles differ too, so they arrive in waves', () => {
    const mean = (i: number) => {
      const data = introInstances([{ ...tile(0, 0), i }], palette, 0, 0, SEED);
      return Array.from({ length: 48 }, (_, n) => instance(data, n).pace).reduce((a, b) => a + b) / 48;
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
    const square: IntroTile = { ...tile(0, 0), aspect: 'square', pixels: 'ff8040'.repeat(49) };
    expect(introInstances([tile(0, 0), square], palette, 100, 100, SEED).length / INTRO_STRIDE).toBe(48 + 49 + introLineCount(100, 100));
  });

  it('sends every line off screen before the tiles land', () => {
    const data = introInstances([], palette, 1440, 900, SEED);
    const count = data.length / INTRO_STRIDE;
    expect(count).toBe(introLineCount(1440, 900));
    const reach = Math.hypot(1440, 900) / 2;
    for (let n = 0; n < count; n++) {
      const { pos, half, depth } = instance(data, n);
      expect(depth[0]).toBeLessThanOrEqual(1);
      expect(Math.hypot(pos[0]!, pos[1]!) - Math.max(...half)).toBeGreaterThan(reach);
    }
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
