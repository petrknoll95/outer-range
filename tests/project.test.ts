import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { media } from '../src/assets/media';
import { clusterBounds, projectGuests } from '../src/canvas/project';
import type { Aspect } from '../src/canvas/world';
import { createWorld } from '../src/canvas/world';

const world = createWorld(media.map((m) => ({ aspect: m.aspect as Aspect })));
const g = { s: 200, pitch: 200 * (4 / 3 + 0.5) };
const aspectOf = (n: number) => media[n]!.aspect as Aspect;
const centre = (i: number, j: number) => {
  const c = world.cell(i, j);
  return { x: i * g.pitch + c.dx * g.s, y: j * g.pitch + c.dy * g.s };
};

/** A focused cell anywhere, and 2–14 other images (not its own). */
const scene = fc
  .record({ i: fc.integer({ min: -500, max: 500 }), j: fc.integer({ min: -500, max: 500 }), others: fc.uniqueArray(fc.integer({ min: 0, max: media.length - 1 }), { minLength: 2, maxLength: 14 }) })
  .map((s) => ({ ...s, others: s.others.filter((n) => n !== world.cell(s.i, s.j).image) }))
  .filter((s) => s.others.length >= 2);

describe('projectGuests', () => {
  it('gives every other image its own cell, the ones nearest the focused cell', () => {
    fc.assert(
      fc.property(scene, ({ i, j, others }) => {
        const guests = projectGuests(world, g, i, j, others, aspectOf, 5000);
        expect(guests.map((x) => x.image)).toEqual(others);
        const keys = guests.map((x) => `${x.i},${x.j}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).not.toContain(`${i},${j}`);
        // No cell left out is nearer the focused cell than one used.
        const f = centre(i, j);
        const d = (a: { i: number; j: number }) => Math.hypot(centre(a.i, a.j).x - f.x, centre(a.i, a.j).y - f.y);
        const furthest = Math.max(...guests.map(d));
        for (let a = i - 3; a <= i + 3; a++) for (let b = j - 3; b <= j + 3; b++) {
          if ((a === i && b === j) || keys.includes(`${a},${b}`)) continue;
          expect(d({ i: a, j: b })).toBeGreaterThanOrEqual(furthest - 1e-6);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('starts each from its nearest copy on the canvas, in its own shape, and one already in place stays put', () => {
    fc.assert(
      fc.property(scene, ({ i, j, others }) => {
        const guests = projectGuests(world, g, i, j, others, aspectOf, 5000);
        for (const x of guests) {
          const ratio = x.to.width / x.to.height;
          expect(ratio).toBeCloseTo({ landscape: 4 / 3, portrait: 3 / 4, square: 1 }[aspectOf(x.image)], 6);
          expect(x.from.width).toBeCloseTo(x.to.width, 6);
          // It names its copy's cell, which shows it, centred where it comes from.
          if (x.copy) {
            expect(world.cell(x.copy.i, x.copy.j).image).toBe(x.image);
            expect(x.from.left + x.from.width / 2).toBeCloseTo(centre(x.copy.i, x.copy.j).x, 6);
            expect(x.from.top + x.from.height / 2).toBeCloseTo(centre(x.copy.i, x.copy.j).y, 6);
          }
          // Its cell already shows it: it doesn't move.
          if (world.cell(x.i, x.j).image === x.image) {
            expect(x.from.left).toBeCloseTo(x.to.left, 6);
            expect(x.from.top).toBeCloseTo(x.to.top, 6);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  it('brings one with no copy near in from well off, away from the focused cell', () => {
    // An image index no cell shows: never on the canvas.
    const missing = media.length + 5;
    const guests = projectGuests(world, g, 0, 0, [missing, missing + 1], () => 'square', 5000);
    const f = centre(0, 0);
    for (const x of guests) {
      expect(x.copy).toBeNull();
      const to = { x: x.to.left + x.to.width / 2, y: x.to.top + x.to.height / 2 };
      const from = { x: x.from.left + x.from.width / 2, y: x.from.top + x.from.height / 2 };
      expect(Math.hypot(from.x - to.x, from.y - to.y)).toBeCloseTo(5000, 3);
      expect(Math.hypot(from.x - f.x, from.y - f.y)).toBeGreaterThan(Math.hypot(to.x - f.x, to.y - f.y));
    }
  });
});

describe('clusterBounds', () => {
  it('holds the focused rectangle and every guest', () => {
    fc.assert(
      fc.property(scene, ({ i, j, others }) => {
        const guests = projectGuests(world, g, i, j, others, aspectOf, 5000);
        const c = world.cell(i, j);
        const focused = { left: centre(i, j).x - (c.w * g.s) / 2, top: centre(i, j).y - (c.h * g.s) / 2, width: c.w * g.s, height: c.h * g.s };
        const b = clusterBounds(focused, guests);
        for (const r of [focused, ...guests.map((x) => x.to)]) {
          expect(r.left).toBeGreaterThanOrEqual(b.left - 1e-6);
          expect(r.top).toBeGreaterThanOrEqual(b.top - 1e-6);
          expect(r.left + r.width).toBeLessThanOrEqual(b.left + b.width + 1e-6);
          expect(r.top + r.height).toBeLessThanOrEqual(b.top + b.height + 1e-6);
        }
      }),
      { numRuns: 40 },
    );
  });
});
