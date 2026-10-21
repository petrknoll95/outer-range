import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { STEP, TRAIL_LAG_MAX, TRAIL_LAG_MIN } from '../src/canvas/config';
import {
  easeLag,
  limitOffset,
  placeTrail,
  restingTrail,
  stepTrail,
  taperedLag,
  taperWeight,
  zoomTaperWeight,
} from '../src/canvas/trail';

/** Move the grid position at (ux, uy) px/s for `seconds`, then hold it still for `rest` seconds. */
function simulate(lag: number, ux: number, uy: number, seconds: number, rest = 0) {
  const t = restingTrail();
  let gx = 0;
  let gy = 0;
  const offsets: number[] = [];
  for (let n = 0; n < Math.round(seconds / STEP); n++) {
    gx += ux * STEP;
    gy += uy * STEP;
    stepTrail(t, gx, gy, lag, STEP, true);
  }
  const moving = { ox: t.ox, oy: t.oy };
  for (let n = 0; n < Math.round(rest / STEP); n++) {
    stepTrail(t, gx, gy, lag, STEP, false);
    offsets.push(Math.hypot(t.ox, t.oy));
  }
  return { t, moving, offsets };
}

describe('image trail', () => {
  it('trails behind the motion by lag × velocity, along the velocity vector', () => {
    fc.assert(
      fc.property(
        fc.double({ min: TRAIL_LAG_MIN, max: TRAIL_LAG_MAX, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        (lag, ux, uy) => {
          const { moving } = simulate(lag, ux, uy, 1);
          expect(Math.abs(moving.ox + ux * lag)).toBeLessThan(1e-6);
          expect(Math.abs(moving.oy + uy * lag)).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('settles back exactly onto its grid position once the canvas stops', () => {
    const { t, offsets } = simulate(TRAIL_LAG_MAX, 2500, -900, 0.5, 1);
    expect(t.resting).toBe(true);
    expect(t.ox).toBe(0);
    expect(t.oy).toBe(0);
    // It comes back within a third of a second.
    expect(offsets.findIndex((o) => o === 0) * STEP).toBeLessThan(0.35);
  });

  it('overshoots only a little on the way back', () => {
    const { moving, t } = simulate(TRAIL_LAG_MAX, 2000, 0, 0.5);
    const start = moving.ox;
    let furthest = 0;
    for (let n = 0; n < 240; n++) {
      stepTrail(t, 1000, 0, TRAIL_LAG_MAX, STEP, false);
      furthest = Math.max(furthest, t.ox);
    }
    expect(start).toBeLessThan(0);
    expect(furthest / -start).toBeLessThan(0.15);
  });

  it('stays stable at the shortest lag and the fixed step', () => {
    const { t } = simulate(TRAIL_LAG_MIN, 8000, 8000, 2, 1);
    expect(Number.isFinite(t.px)).toBe(true);
    expect(t.resting).toBe(true);
  });

  it('starts new images already trailing, so they never pop', () => {
    const t = restingTrail();
    placeTrail(t, 100, 50, 1200, 0, 0.02);
    const before = t.ox;
    stepTrail(t, 100 + 1200 * STEP, 50, 0.02, STEP, true);
    expect(t.ox).toBeCloseTo(before, 6);
  });

  it('soft-limits large offsets and leaves small ones alone', () => {
    const out = { x: 0, y: 0 };
    limitOffset(2, -1, 40, out);
    expect(out.x).toBeCloseTo(2, 2);
    expect(out.y).toBeCloseTo(-1, 2);
    limitOffset(3000, 4000, 40, out);
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(40);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(39.9);
    expect(out.y / out.x).toBeCloseTo(4 / 3, 9);
  });
});

describe('taper along the direction of motion', () => {
  const hx = 720;
  const hy = 450;

  it('is weakest at the edge the images move toward and strongest at the opposite edge', () => {
    // Moving left: left edge leads, right edge trails.
    expect(taperWeight(-hx, 0, -1, 0, hx, hy)).toBe(0);
    expect(taperWeight(hx, 0, -1, 0, hx, hy)).toBe(1);
    expect(taperWeight(0, 0, -1, 0, hx, hy)).toBe(0.5);
    // Moving up: top leads.
    expect(taperWeight(0, -hy, 0, -1, hx, hy)).toBe(0);
    expect(taperWeight(0, hy, 0, -1, hx, hy)).toBe(1);
    // Position across the motion doesn't matter.
    expect(taperWeight(-300, -hy, -1, 0, hx, hy)).toBe(taperWeight(-300, hy, -1, 0, hx, hy));
  });

  it('runs corner to corner for diagonal motion', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), (angle) => {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        // The corner the motion heads into leads; the opposite corner trails.
        const lx = Math.sign(dx) * hx;
        const ly = Math.sign(dy) * hy;
        expect(taperWeight(lx, ly, dx, dy, hx, hy)).toBeCloseTo(0, 9);
        expect(taperWeight(-lx, -ly, dx, dy, hx, hy)).toBeCloseTo(1, 9);
        expect(taperWeight(0, 0, dx, dy, hx, hy)).toBeCloseTo(0.5, 9);
      }),
      { numRuns: 500 },
    );
  });

  it('clamps images beyond the viewport to the edge values', () => {
    expect(taperWeight(-3 * hx, 0, -1, 0, hx, hy)).toBe(0);
    expect(taperWeight(3 * hx, 0, -1, 0, hx, hy)).toBe(1);
  });

  it('holds the image under the zoom anchor and grows with distance from it', () => {
    expect(zoomTaperWeight(0, 850)).toBe(0);
    expect(zoomTaperWeight(425, 850)).toBe(0.5);
    expect(zoomTaperWeight(5000, 850)).toBe(1);
  });

  it('maps taper and own weight onto the lag range', () => {
    expect(taperedLag(0, 0, 0.85)).toBeCloseTo(TRAIL_LAG_MIN, 12);
    expect(taperedLag(1, 1, 0.85)).toBeCloseTo(TRAIL_LAG_MAX, 12);
    expect(taperedLag(1, 0, 0.85)).toBeGreaterThan(taperedLag(0, 1, 0.85));
  });

  it('eases a lag toward its new target without jumping', () => {
    let lag = TRAIL_LAG_MIN;
    const first = easeLag(lag, TRAIL_LAG_MAX, STEP, 0.12);
    expect(first).toBeGreaterThan(TRAIL_LAG_MIN);
    expect(first).toBeLessThan(TRAIL_LAG_MIN + (TRAIL_LAG_MAX - TRAIL_LAG_MIN) * 0.05);
    for (let n = 0; n < 480; n++) lag = easeLag(lag, TRAIL_LAG_MAX, STEP, 0.12);
    expect(lag).toBeCloseTo(TRAIL_LAG_MAX, 6);
    expect(easeLag(TRAIL_LAG_MIN, TRAIL_LAG_MAX, STEP, 0)).toBe(TRAIL_LAG_MAX);
  });
});
