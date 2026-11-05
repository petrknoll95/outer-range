import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FLIGHT_ABERRATION, FLIGHT_BLUR, FLIGHT_DEPTH_SPREAD, FLIGHT_FADE_FROM, FLIGHT_FAR_BLUR, FLIGHT_GRID_FINER, FLIGHT_HANDOVER, FLIGHT_LINES, PIXEL_GRID, SEED } from '../src/canvas/config';
import { FLIGHT_TRAVEL, flightDepth, flightFar, flightFrame, flightHandover, flightInstances, flightTravel, flightView } from '../src/canvas/flight';
import type { IntroTile } from '../src/canvas/intro';
import { INTRO_STRIDE, introLineCount } from '../src/canvas/intro';

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

describe("the flight's rays", () => {
  const frame = (u: number, to: 0 | 1) => flightFrame(u, to, { z: 0, tail: 0, scale: 0, closed: 0, corners: 0, fade: 0, rays: 0, lines: 0, flight: 0, back: 0, aberration: 0, handover: 0 });
  const [cols, rows] = PIXEL_GRID.landscape;
  const tile: IntroTile = { i: 3, j: -2, x: -120, y: 40, width: 240, height: 180, radius: 10, aspect: 'landscape', pixels: 'a0b0c0'.repeat(cols * rows) };
  /** Where each instance is, ahead of the camera, at the start and at the end of the flight. */
  const ahead = (data: Float32Array, n: number, travel: number) => data[n * INTRO_STRIDE + 15]! + travel * data[n * INTRO_STRIDE + 16]!;

  it('set out as each image, closed up into its grid and unseen, and are all gone by the end', () => {
    for (const to of [0, 1] as const) {
      expect(frame(0, to)).toMatchObject({ closed: 1, corners: 1, rays: 0, lines: 0, fade: 1, flight: 1 });
      expect(frame(1, to).fade).toBe(0);
    }
  });

  it('draw a streak from its nearer end, its head where it is now: the near end flying out, the far end flying back', () => {
    fc.assert(
      fc.property(progress, (u) => {
        const out = frame(u, 1);
        const back = frame(u, 0);
        expect(out.z).toBeGreaterThanOrEqual(out.tail);
        expect(back.z).toBeGreaterThanOrEqual(back.tail);
        expect(out.z).toBeCloseTo(flightTravel(u), 9);
        expect(back.tail).toBeCloseTo(flightTravel(u), 9);
        expect([out.back, back.back]).toEqual([0, 1]);
      }),
    );
  });

  it('split their colours only while under way, both ways, never past FLIGHT_ABERRATION', () => {
    for (const to of [0, 1] as const) {
      // (Landing back, a shutter's worth of the last, slowest stretch: a fraction of a px.)
      expect(frame(0, to).aberration).toBeLessThan(0.05);
      expect(frame(1, to).aberration).toBe(0);
      const all = Array.from({ length: 101 }, (_, k) => frame(k / 100, to).aberration);
      expect(Math.max(...all)).toBeGreaterThan(FLIGHT_ABERRATION / 2);
      expect(Math.max(...all)).toBeLessThanOrEqual(FLIGHT_ABERRATION);
    }
  });

  it('hand each image over to its rays once they are solid, and keep it under them until they have come apart', () => {
    expect(flightHandover(0)).toBe(1);
    expect(flightHandover(FLIGHT_HANDOVER[0])).toBe(1);
    expect(flightHandover(FLIGHT_HANDOVER[1])).toBe(0);
    // Solid by then: the rays come in over the first tenth.
    expect(FLIGHT_HANDOVER[0]).toBeGreaterThanOrEqual(0.1);
    fc.assert(
      fc.property(progress, progress, (a, b) => {
        expect(flightHandover(Math.max(a, b))).toBeLessThanOrEqual(flightHandover(Math.min(a, b)));
      }),
    );
  });

  it('put a ray per cell of the finer grid, each landing on its cell, and every ray and line goes past the camera by the end', () => {
    const finer = FLIGHT_GRID_FINER;
    const fine = { cols: cols * finer, rows: rows * finer, rgba: new Uint8ClampedArray(cols * finer * rows * finer * 4) };
    const data = flightInstances([{ ...tile, fine }], [[1, 0, 0]], 1440, 900, SEED);
    const rays = fine.cols * fine.rows;
    expect(data.length / INTRO_STRIDE).toBe(rays + Math.round(introLineCount(1440, 900) * FLIGHT_LINES));
    for (let n = 0; n < data.length / INTRO_STRIDE; n++) {
      expect(ahead(data, n, 0)).toBeGreaterThan(0);
      expect(ahead(data, n, FLIGHT_TRAVEL)).toBeLessThanOrEqual(0);
    }
    // At the start the rays are the image: on the focal plane, in its cells.
    for (let n = 0; n < rays; n++) {
      expect(ahead(data, n, 0)).toBe(1);
      expect(Math.abs(data[n * INTRO_STRIDE + 2]!)).toBeLessThan(tile.width / 2);
      expect(Math.abs(data[n * INTRO_STRIDE + 3]!)).toBeLessThan(tile.height / 2);
    }
    // Each its own pace: the image comes apart.
    expect(new Set(Array.from({ length: rays }, (_, n) => data[n * INTRO_STRIDE + 16])).size).toBeGreaterThan(rays * 0.9);
  });
});
