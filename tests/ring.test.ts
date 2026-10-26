import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LONG } from '../src/canvas/config';
import { RING_MAX_SHORT, ringLayout } from '../src/canvas/ring';
import type { Aspect } from '../src/canvas/world';

const aspect = fc.constantFrom<Aspect>('landscape', 'portrait', 'square');
const project = fc.array(aspect, { minLength: 3, maxLength: 16 });
const viewport = fc.record({ width: fc.integer({ min: 360, max: 3440 }), height: fc.integer({ min: 480, max: 1600 }), inset: fc.integer({ min: 0, max: 80 }) });

describe('ringLayout', () => {
  it('puts every image wholly inside the area, in its own shape', () => {
    fc.assert(
      fc.property(project, viewport, (aspects, { width, height, inset }) => {
        const slots = ringLayout(aspects, width, height, inset);
        slots.forEach((s, k) => {
          expect(s.x - s.width / 2).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(s.x + s.width / 2).toBeLessThanOrEqual(width - inset + 1e-6);
          expect(s.y - s.height / 2).toBeGreaterThanOrEqual(inset - 1e-6);
          expect(s.y + s.height / 2).toBeLessThanOrEqual(height - inset + 1e-6);
          const ratio = { landscape: LONG, portrait: 1 / LONG, square: 1 }[aspects[k]!];
          expect(s.width / s.height).toBeCloseTo(ratio, 6);
        });
      }),
    );
  });

  it('spaces them evenly round a circle centred in the area, the first at the bottom', () => {
    fc.assert(
      fc.property(project, viewport, (aspects, { width, height, inset }) => {
        const slots = ringLayout(aspects, width, height, inset);
        const radius = Math.hypot(slots[0]!.x - width / 2, slots[0]!.y - height / 2);
        for (const s of slots) expect(Math.hypot(s.x - width / 2, s.y - height / 2)).toBeCloseTo(radius, 6);
        expect(slots[0]!.x).toBeCloseTo(width / 2, 6);
        expect(slots[0]!.y).toBeGreaterThan(height / 2);
        // Neighbours all the same distance apart.
        const gaps = slots.map((s, k) => Math.hypot(s.x - slots[(k + 1) % slots.length]!.x, s.y - slots[(k + 1) % slots.length]!.y));
        for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
      }),
    );
  });

  it('overlaps neighbours: even the short edge is longer than the gap between their centres', () => {
    fc.assert(
      fc.property(project, viewport, (aspects, { width, height, inset }) => {
        const slots = ringLayout(aspects, width, height, inset);
        for (let k = 0; k < slots.length; k++) {
          const [a, b] = [slots[k]!, slots[(k + 1) % slots.length]!];
          const gap = Math.hypot(a.x - b.x, a.y - b.y);
          expect(Math.min(a.width, a.height)).toBeGreaterThan(gap);
        }
      }),
    );
  });

  it('never draws an image bigger than its share of the area, and stacks the front over the back, the first on top', () => {
    fc.assert(
      fc.property(project, viewport, (aspects, { width, height, inset }) => {
        const slots = ringLayout(aspects, width, height, inset);
        for (const s of slots) expect(Math.min(s.width, s.height)).toBeLessThanOrEqual(RING_MAX_SHORT * Math.min(width, height) + 1e-6);
        const top = slots.reduce((a, b) => (b.z > a.z ? b : a));
        expect(top).toBe(slots[0]);
        for (const a of slots) for (const b of slots) if (a.y > b.y + 1) expect(a.z).toBeGreaterThan(b.z);
      }),
    );
  });
});
