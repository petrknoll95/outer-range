import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLIGHT_BLUR, FLIGHT_DEPTH_SPREAD, FLIGHT_FADE_FROM, FLIGHT_FAR_BLUR, SEED } from '../src/canvas/config';
import { FLIGHT_TRAVEL, flightDepth, flightFar, flightTravel, flightView } from '../src/canvas/flight';

const view = (depth: number, u: number) => flightView(depth, flightTravel(u), { scale: 0, opacity: 0, blur: 0 });
const depth = fc.double({ min: 1, max: 1 + FLIGHT_DEPTH_SPREAD, maxExcluded: true, noNaN: true });
const progress = fc.double({ min: 0, max: 1, noNaN: true });

describe('the flight out of the canvas', () => {
  it('starts from the canvas exactly as drawn', () => {
    fc.assert(
      fc.property(depth, (d) => {
        expect(view(d, 0)).toEqual({ scale: 1, opacity: 1, blur: 0 });
      }),
    );
  });

  it('only ever brings an image closer: it grows and fades, never the other way', () => {
    fc.assert(
      fc.property(depth, progress, progress, (d, a, b) => {
        const [u0, u1] = a <= b ? [a, b] : [b, a];
        const v0 = { ...view(d, u0) };
        const v1 = view(d, u1);
        expect(v1.scale).toBeGreaterThanOrEqual(v0.scale);
        expect(v1.opacity).toBeLessThanOrEqual(v0.opacity);
      }),
    );
  });

  it('is perspective: a nearer image is always at least as big, and at most as opaque, as a farther one', () => {
    fc.assert(
      fc.property(depth, depth, progress, (a, b, u) => {
        const [near, far] = a <= b ? [a, b] : [b, a];
        const n = { ...view(near, u) };
        const f = view(far, u);
        expect(n.scale).toBeGreaterThanOrEqual(f.scale);
        expect(n.opacity).toBeLessThanOrEqual(f.opacity);
      }),
    );
  });

  it('leaves a blank canvas: by the end every image has faded out', () => {
    fc.assert(
      fc.property(depth, (d) => {
        expect(view(d, 1).opacity).toBe(0);
      }),
    );
  });

  it('nearer images leave first', () => {
    // The progress at which an image has fully faded.
    const gone = (d: number) => {
      let u = 0;
      while (view(d, u).opacity > 0) u += 1 / 1000;
      return u;
    };
    expect(gone(1)).toBeLessThan(gone(1.5));
    expect(gone(1.5)).toBeLessThan(gone(2.4));
    // Nothing fades before it has grown noticeably.
    expect(view(1, 0.2).opacity).toBe(1);
    expect(1 - 1 / view(1, 0.2).scale).toBeLessThan(FLIGHT_FADE_FROM);
  });

  it('the camera eases: setting off gently, rushing, and easing off, ending exactly at its full travel', () => {
    expect(flightTravel(0)).toBe(0);
    expect(flightTravel(1)).toBe(FLIGHT_TRAVEL);
    const h = 1e-4;
    const average = FLIGHT_TRAVEL;
    // Gentle at both ends, much faster than average in between.
    expect(flightTravel(h) / h).toBeLessThan(average * 0.05);
    expect((FLIGHT_TRAVEL - flightTravel(1 - h)) / h).toBeLessThan(average * 0.05);
    expect((flightTravel(0.5) - flightTravel(0.5 - h)) / h).toBeGreaterThan(average * 1.3);
  });

  it('blurs an image more the nearer it comes, from sharp to FLIGHT_BLUR', () => {
    fc.assert(
      fc.property(depth, progress, progress, (d, a, b) => {
        const [u0, u1] = a <= b ? [a, b] : [b, a];
        expect(view(d, u1).blur).toBeGreaterThanOrEqual(view(d, u0).blur);
      }),
    );
    expect(view(1.5, 0).blur).toBe(0);
    expect(view(1.5, 1).blur).toBeCloseTo(FLIGHT_BLUR, 9);
  });

  it('gives every cell its own depth, the same every time, spread over the whole range', () => {
    const depths: number[] = [];
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) depths.push(flightDepth(i, j, SEED));
    expect(flightDepth(3, -7, SEED)).toBe(flightDepth(3, -7, SEED));
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...depths)).toBeLessThan(1 + FLIGHT_DEPTH_SPREAD);
    // Spread out: each fifth of the range holds a fair share.
    for (let k = 0; k < 5; k++) {
      const lo = 1 + (FLIGHT_DEPTH_SPREAD * k) / 5;
      const share = depths.filter((d) => d >= lo && d < lo + FLIGHT_DEPTH_SPREAD / 5).length / depths.length;
      expect(share).toBeGreaterThan(0.15);
    }
  });

  it('the far plane (the about text) comes towards the camera: small, faint and soft far off, its own size, opaque and sharp on arrival', () => {
    const far = (u: number) => flightFar(flightTravel(u), { scale: 0, opacity: 0, blur: 0 });
    expect(far(0).opacity).toBe(0);
    expect(far(0).scale).toBeLessThan(0.4);
    expect(far(0).blur).toBeCloseTo(FLIGHT_FAR_BLUR, 9);
    expect(far(1)).toEqual({ scale: 1, opacity: 1, blur: 0 });
    // Coming closer the whole way, and behind every image: it never grows past its own size.
    fc.assert(
      fc.property(progress, progress, (a, b) => {
        const [u0, u1] = a <= b ? [a, b] : [b, a];
        const [v0, v1] = [{ ...far(u0) }, far(u1)];
        expect(v1.scale).toBeGreaterThanOrEqual(v0.scale);
        expect(v1.opacity).toBeGreaterThanOrEqual(v0.opacity);
        expect(v1.blur).toBeLessThanOrEqual(v0.blur + 1e-12);
        expect(v1.scale).toBeLessThanOrEqual(1);
      }),
    );
  });
});
