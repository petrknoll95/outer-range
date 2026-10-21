import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/placeholders/manifest.json';
import { OVERLAP_BUDGET } from '../src/canvas/config';
import { computeGeometry, forEachCellIn, sizingReach } from '../src/canvas/layout';
import { DEFAULT_LENS, Lens, type LensPoint } from '../src/canvas/lens';
import type { Aspect } from '../src/canvas/world';
import { createWorld } from '../src/canvas/world';

const lens = new Lens(DEFAULT_LENS);
const flat = new Lens(null);
const { inner, outer, minScale, roundness } = DEFAULT_LENS;
const world = createWorld(manifest.map((m) => ({ aspect: m.aspect as Aspect })));

const rho = fc.double({ min: 0, max: 3, noNaN: true });
const coord = fc.double({ min: -2000, max: 2000, noNaN: true });
const p = (): LensPoint => ({ x: 0, y: 0, scale: 1 });

describe('lens profile', () => {
  it('is the identity inside the inner radius, and with no params', () => {
    fc.assert(
      fc.property(coord, coord, (x, y) => {
        const out = flat.apply(x, y, 720, 450, p(), 50, 50);
        expect(out).toEqual({ x, y, scale: 1 });
        if (lens.radius(x / 720, y / 450) <= inner) expect(lens.apply(x, y, 720, 450, p())).toEqual({ x, y, scale: 1 });
      }),
    );
  });

  it("takes a tile's scale at its far corner, so a big tile shrinks before its centre leaves full size", () => {
    const point = lens.apply(300, 0, 720, 450, p(), 120, 90);
    expect(lens.radius(300 / 720, 0)).toBeLessThan(inner);
    expect(point.x).toBe(300);
    expect(point.scale).toBeCloseTo(lens.scaleAt(lens.radius(420 / 720, 90 / 450)), 12);
    expect(point.scale).toBeLessThan(1);
  });

  it('shrinks monotonically from 1 to minScale, and never below', () => {
    fc.assert(
      fc.property(rho, rho, (a, b) => {
        const [near, far] = a < b ? [a, b] : [b, a];
        expect(lens.scaleAt(far)).toBeLessThanOrEqual(lens.scaleAt(near) + 1e-12);
        expect(lens.scaleAt(far)).toBeGreaterThanOrEqual(minScale - 1e-12);
      }),
    );
    expect(lens.scaleAt(inner)).toBe(1);
    expect(lens.scaleAt(outer)).toBeCloseTo(minScale, 12);
  });

  it('maps radii in order, with slope equal to the scale (spacing shrinks exactly as fast as tiles)', () => {
    fc.assert(
      fc.property(rho, (r) => {
        const h = 1e-6;
        const slope = (lens.mapRadius(r + h) - lens.mapRadius(r)) / h;
        expect(slope).toBeCloseTo(lens.scaleAt(r), 4);
        expect(lens.unmapRadius(lens.mapRadius(r))).toBeCloseTo(r, 9);
      }),
    );
  });

  it('unapply undoes apply', () => {
    fc.assert(
      fc.property(coord, coord, (x, y) => {
        const a = lens.apply(x, y, 720, 450, p());
        const back = lens.unapply(a.x, a.y, 720, 450, { x: 0, y: 0 });
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }),
    );
  });

  it('reach covers every point of the viewport', () => {
    expect(lens.reach).toBeGreaterThan(1);
    fc.assert(
      fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -1, max: 1, noNaN: true }), (u, v) => {
        const back = lens.unapply(u * 720, v * 450, 720, 450, { x: 0, y: 0 });
        expect(Math.abs(back.x)).toBeLessThanOrEqual(lens.reach * 720 + 1e-6);
        expect(Math.abs(back.y)).toBeLessThanOrEqual(lens.reach * 450 + 1e-6);
      }),
    );
    // A corner is the farthest point and sits exactly on the superellipse radius 2^(1/p).
    expect(lens.radius(1, 1)).toBeCloseTo(2 ** (1 / roundness), 12);
  });
});

/** Every tile on a vw×vh screen centred on world point (cx, cy), with its lensed rectangle. */
function screen(vw: number, vh: number, share: number, cx: number, cy: number) {
  const g = computeGeometry(vw, vh, world, sizingReach(lens.reach, share));
  const hx = vw / 2;
  const hy = vh / 2;
  const tiles: { image: number; flat: Rect; lensed: Rect; scale: number }[] = [];
  const out = p();
  forEachCellIn(world, g, cx - hx * lens.reach, cy - hy * lens.reach, cx + hx * lens.reach, cy + hy * lens.reach, (cell, r) => {
    lens.apply(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy, hx, hy, out, r.width / 2, r.height / 2);
    const w = r.width * out.scale;
    const h = r.height * out.scale;
    const lensed = { left: hx + out.x - w / 2, top: hy + out.y - h / 2, width: w, height: h };
    if (lensed.left < vw && lensed.left + w > 0 && lensed.top < vh && lensed.top + h > 0) {
      tiles.push({ image: cell.image, flat: { left: r.left, top: r.top, width: r.width, height: r.height }, lensed, scale: out.scale });
    }
  });
  return tiles;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.width * a.height, b.width * b.height) : 0;
}

const centre = fc.integer({ min: -1_000_000, max: 1_000_000 });

describe('lens on the canvas', () => {
  it(`never pushes images together: at most a sliver, and always within the ${OVERLAP_BUDGET * 100}% budget`, () => {
    let pairs = 0;
    let slivers = 0;
    let worst = 0;
    fc.assert(
      fc.property(centre, centre, (cx, cy) => {
        const tiles = screen(1440, 900, 0.55, cx, cy);
        for (let a = 0; a < tiles.length; a++) {
          for (let b = a + 1; b < tiles.length; b++) {
            const lensed = overlap(tiles[a]!.lensed, tiles[b]!.lensed);
            if (lensed === 0) continue;
            pairs++;
            worst = Math.max(worst, lensed);
            expect(lensed).toBeLessThanOrEqual(OVERLAP_BUDGET + 1e-9);
            // Where the unlensed grid had no overlap, the lens may add at most a sliver
            // (off-axis, where the superellipse bends its rays).
            if (overlap(tiles[a]!.flat, tiles[b]!.flat) === 0) {
              slivers++;
              expect(lensed).toBeLessThan(0.02);
            }
          }
        }
      }),
      { numRuns: 2_000 },
    );
    console.info(`lensed overlaps: ${pairs} pairs (${slivers} new slivers), worst ${(worst * 100).toFixed(1)}%`);
  });

  it('with LENS_REPEAT_SHARE = 1, no image ever appears twice on screen', () => {
    for (const [vw, vh] of [[1440, 900], [1920, 1080], [1280, 800], [768, 1024], [390, 844]] as const) {
      fc.assert(
        fc.property(centre, centre, (cx, cy) => {
          const images = screen(vw, vh, 1, cx, cy).map((t) => t.image);
          expect(new Set(images).size).toBe(images.length);
        }),
        { numRuns: 500 },
      );
    }
  });

  it('with the default share, a repeat is rare and only ever between small edge images', () => {
    let screens = 0;
    let repeats = 0;
    let largest = 0;
    fc.assert(
      fc.property(centre, centre, (cx, cy) => {
        const byImage = new Map<number, number[]>();
        for (const t of screen(1440, 900, 0.55, cx, cy)) byImage.set(t.image, [...(byImage.get(t.image) ?? []), t.scale]);
        screens++;
        let any = false;
        for (const scales of byImage.values()) {
          if (scales.length < 2) continue;
          any = true;
          largest = Math.max(largest, ...scales);
          expect(Math.max(...scales)).toBeLessThan(0.6);
        }
        if (any) repeats++;
      }),
      { numRuns: 4_000 },
    );
    console.info(`repeats on ${((100 * repeats) / screens).toFixed(1)}% of screens, largest copy at scale ${largest.toFixed(2)}`);
    expect(repeats / screens).toBeLessThan(0.08);
  });
});
