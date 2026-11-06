import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media as manifest } from '../src/assets/media';
import { LONG, OVERLAP_BUDGET, PITCH } from '../src/canvas/config';
import type { CellRect, Geometry } from '../src/canvas/layout';
import { cellRect, computeGeometry, forEachCellIn } from '../src/canvas/layout';
import type { World } from '../src/canvas/world';
import { createWorld, emptyCell, orientation, tileSize } from '../src/canvas/world';

const images = manifest.map((m) => ({ ratio: m.width / m.height }));
const world = createWorld(images);
/** A world of every shape, from a 1:3 strip to a 3:1 panorama, for the rules that must hold whatever the work is. */
const RANGE = [1 / 3, 9 / 21, 9 / 16, 2 / 3, 3 / 4, 4 / 5, 1, 5 / 4, 4 / 3, 3 / 2, 16 / 9, 21 / 9, 3];
const anyShape = createWorld(Array.from({ length: 78 }, (_, n) => ({ ratio: RANGE[n % RANGE.length]! })));
const worlds: [string, World][] = [
  ['the work', world],
  ['every shape', anyShape],
];
/** World geometry in units of S, so tests are independent of any screen. */
const unitGeometry: Geometry = { vw: 0, vh: 0, s: 1, pitch: PITCH, radius: 0, noRepeatGuaranteed: true };

// Cell indices, mostly near the origin, some far out: ±2^24 cells is ±4·10^9 px at S = 185.
const index = fc.oneof(fc.integer({ min: -400, max: 400 }), fc.integer({ min: -(2 ** 24), max: 2 ** 24 }));

function rect(i: number, j: number, w: World = world): CellRect {
  return cellRect(w.cell(i, j), unitGeometry, { left: 0, top: 0, width: 0, height: 0 });
}

function overlapArea(a: CellRect, b: CellRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

describe('determinism', () => {
  it('the same coordinates always give the same cell, whatever was computed before', () => {
    fc.assert(
      fc.property(index, index, fc.array(fc.tuple(index, index), { maxLength: 20 }), (i, j, noise) => {
        const before = world.cell(i, j, emptyCell());
        for (const [a, b] of noise) world.cell(a, b);
        const fresh = createWorld(images).cell(i, j, emptyCell());
        expect(world.cell(i, j, emptyCell())).toEqual(before);
        expect(fresh).toEqual(before);
      }),
      { numRuns: 5_000 },
    );
  });
});

describe('tile sizes', () => {
  it('keep the shapes the canvas was drawn for', () => {
    expect(tileSize(4 / 3)).toEqual({ w: LONG, h: 1 });
    expect(tileSize(3 / 4)).toEqual({ w: 1, h: LONG });
    expect(tileSize(1)).toEqual({ w: 1, h: 1 });
  });

  it("keep every image's own shape, inside a LONG × LONG box, short edge at most S", () => {
    fc.assert(
      fc.property(fc.double({ min: Math.log(0.2), max: Math.log(5), noNaN: true }), (log) => {
        const ratio = Math.exp(log);
        const { w, h } = tileSize(ratio);
        expect(w / h).toBeCloseTo(ratio, 9);
        expect(Math.max(w, h)).toBeLessThanOrEqual(LONG);
        expect(Math.min(w, h)).toBeLessThanOrEqual(1);
        // As large as the box allows: one side reaches its limit.
        expect(Math.max(w, h) >= LONG - 1e-12 || Math.min(w, h) >= 1 - 1e-12).toBe(true);
      }),
      { numRuns: 10_000 },
    );
  });

  it('fit wide and tall images to the long edge', () => {
    expect(tileSize(16 / 9).w).toBeCloseTo(LONG);
    expect(tileSize(16 / 9).h).toBeCloseTo(0.75);
    expect(tileSize(9 / 16).w).toBeCloseTo(0.75);
    expect(tileSize(9 / 16).h).toBeCloseTo(LONG);
  });
});

describe('image slices', () => {
  it('are disjoint, cover every image, and give every class at least two images', () => {
    const all = world.slices.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(images.length);
    for (const slice of world.slices) expect(slice.length).toBeGreaterThanOrEqual(2);
  });

  it('spread each shape evenly, so no class is all one shape more than the counts force', () => {
    for (const shape of ['landscape', 'portrait', 'square'] as const) {
      const perSlice = world.slices.map((slice) => slice.filter((n) => orientation(images[n]!.ratio) === shape).length);
      expect(Math.max(...perSlice) - Math.min(...perSlice)).toBeLessThanOrEqual(1);
    }
  });
});

describe('no repeats', () => {
  it(`no image appears twice inside any ${world.cols}×${world.rows} block of cells`, () => {
    let checked = 0;
    fc.assert(
      fc.property(index, index, (i0, j0) => {
        const size = 32;
        const grid: number[][] = [];
        for (let i = 0; i < size + world.cols; i++) {
          grid.push([]);
          for (let j = 0; j < size + 2 * world.rows; j++) grid[i]!.push(world.cell(i0 + i, j0 + j).image);
        }
        for (let i = 0; i < size; i++) {
          for (let j = world.rows; j < size + world.rows; j++) {
            for (let di = 0; di < world.cols; di++) {
              for (let dj = -(world.rows - 1); dj < world.rows; dj++) {
                if (di === 0 && dj <= 0) continue;
                expect(grid[i + di]![j + dj]).not.toBe(grid[i]![j]);
              }
            }
            checked++;
          }
        }
      }),
      { numRuns: 120 },
    );
    expect(checked).toBeGreaterThanOrEqual(100_000);
  });

  // [width, height, must be guaranteed]
  const viewports: [number, number, boolean][] = [
    [1440, 900, true],
    [1280, 800, true],
    [1920, 1080, true],
    [2560, 1440, true],
    [2560, 1080, true],
    [3440, 1440, true],
    [1024, 1366, true],
    [768, 1024, true],
    [390, 844, true],
    [360, 640, true],
    [5120, 2160, false],
    [7680, 4320, false],
  ];
  for (const [vw, vh, required] of viewports) {
    it(`a ${vw}×${vh} viewport ${required ? 'never shows' : 'reports whether it can show'} a duplicate`, () => {
      const g = computeGeometry(vw, vh, world);
      expect(g.noRepeatGuaranteed).toBe(required);
      if (!g.noRepeatGuaranteed) return;
      fc.assert(
        fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.double({ min: -1e9, max: 1e9, noNaN: true }), (x, y) => {
          const seen = new Set<number>();
          forEachCellIn(world, g, x, y, x + vw, y + vh, (cell) => {
            expect(seen.has(cell.image)).toBe(false);
            seen.add(cell.image);
          });
        }),
        { numRuns: 1_000 },
      );
    });
  }
});

for (const [name, w] of worlds) {
  describe(`overlap, in ${name}`, () => {
    // Every pair that can touch: right-hand columns (stagger can shift rows by up to 1) and the cell below.
    const neighbours: [number, number][] = [
      [1, -2], [1, -1], [1, 0], [1, 1], [1, 2],
      [0, 1], [0, 2],
    ];

    it(`no two images overlap by more than ${OVERLAP_BUDGET * 100}% of the smaller one`, () => {
      let pairs = 0;
      let overlapping = 0;
      let worst = 0;
      fc.assert(
        fc.property(index, index, (i, j) => {
          const a = rect(i, j, w);
          for (const [di, dj] of neighbours) {
            const b = rect(i + di, j + dj, w);
            const fraction = overlapArea(a, b) / Math.min(a.width * a.height, b.width * b.height);
            expect(fraction).toBeLessThanOrEqual(OVERLAP_BUDGET + 1e-9);
            worst = Math.max(worst, fraction);
            if (Math.abs(dj) <= 1 || di === 0) {
              pairs++;
              if (fraction > 0) overlapping++;
            }
          }
        }),
        { numRuns: 100_000 },
      );
      const frequency = overlapping / pairs;
      console.info(`overlap in ${name}: ${(frequency * 100).toFixed(2)}% of neighbouring pairs, worst ${(worst * 100).toFixed(1)}%`);
      expect(frequency).toBeGreaterThan(0);
      expect(frequency).toBeLessThan(1 / 6);
    });

    it('images in one column never overlap', () => {
      fc.assert(
        fc.property(index, index, (i, j) => {
          expect(overlapArea(rect(i, j, w), rect(i, j + 1, w))).toBe(0);
        }),
        { numRuns: 100_000 },
      );
    });
  });
}

describe('coverage', () => {
  it('every pitch × pitch window touches an image (no empty hole wider than one cell)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.double({ min: -1e6, max: 1e6, noNaN: true }), (x, y) => {
        let hit = false;
        forEachCellIn(world, unitGeometry, x, y, x + PITCH, y + PITCH, () => (hit = true));
        expect(hit).toBe(true);
      }),
      { numRuns: 100_000 },
    );
  });
});
