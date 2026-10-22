import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media as manifest } from '../src/assets/media';
import { OVERLAP_BUDGET, PITCH } from '../src/canvas/config';
import type { CellRect, Geometry } from '../src/canvas/layout';
import { cellRect, computeGeometry, forEachCellIn } from '../src/canvas/layout';
import type { Aspect } from '../src/canvas/world';
import { createWorld, emptyCell } from '../src/canvas/world';

const images = manifest.map((m) => ({ aspect: m.aspect as Aspect }));
const world = createWorld(images);
/** World geometry in units of S, so tests are independent of any screen. */
const unitGeometry: Geometry = { vw: 0, vh: 0, s: 1, pitch: PITCH, radius: 0, noRepeatGuaranteed: true };

// Cell indices, mostly near the origin, some far out: ±2^24 cells is ±4·10^9 px at S = 185.
const index = fc.oneof(fc.integer({ min: -400, max: 400 }), fc.integer({ min: -(2 ** 24), max: 2 ** 24 }));

function rect(i: number, j: number): CellRect {
  return cellRect(world.cell(i, j), unitGeometry, { left: 0, top: 0, width: 0, height: 0 });
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

describe('image slices', () => {
  it('are disjoint, cover every image, and give every class at least two images', () => {
    const all = world.slices.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(images.length);
    for (const slice of world.slices) expect(slice.length).toBeGreaterThanOrEqual(2);
  });

  it('spread each shape evenly, so no class is all one shape more than the counts force', () => {
    for (const aspect of ['landscape', 'portrait', 'square'] as const) {
      const perSlice = world.slices.map((slice) => slice.filter((n) => images[n]!.aspect === aspect).length);
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

describe('overlap', () => {
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
        const a = rect(i, j);
        for (const [di, dj] of neighbours) {
          const b = rect(i + di, j + dj);
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
    console.info(`overlap: ${(frequency * 100).toFixed(2)}% of neighbouring pairs, worst ${(worst * 100).toFixed(1)}%`);
    expect(frequency).toBeGreaterThan(0);
    expect(frequency).toBeLessThan(1 / 6);
  });

  it('images in one column never overlap', () => {
    fc.assert(
      fc.property(index, index, (i, j) => {
        expect(overlapArea(rect(i, j), rect(i, j + 1))).toBe(0);
      }),
      { numRuns: 100_000 },
    );
  });
});

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
