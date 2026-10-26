import { LONG } from './config';
import type { Aspect } from './world';

/** Where one image of the project view sits: its centre and size, px, and its stacking order. */
export interface RingSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Higher draws over lower: the nearer the bottom of the ring (the front), the higher. */
  z: number;
}

/** Each image's short edge, against the gap between neighbouring centres: over 1, neighbours always overlap (squares too). */
export const RING_OVERLAP = 1.15;
/** No image's short edge is drawn bigger than this share of the area's short side (a small project would otherwise fill it). */
export const RING_MAX_SHORT = 0.36;

/**
 * The project view's ring: `aspects.length` images evenly round a circle centred in the area
 * (`width` × `height` px, inset by `inset` px on every side), the first at the bottom, the front,
 * and the rest clockwise. Each keeps its shape (4:3, 3:4 or 1:1, short edge u) and u is
 * RING_OVERLAP × the distance between neighbouring centres, so every image overlaps both its
 * neighbours. The ring is as large as fits the area, every image wholly inside it.
 */
export function ringLayout(aspects: readonly Aspect[], width: number, height: number, inset = 0): RingSlot[] {
  const n = aspects.length;
  const halfW = width / 2 - inset;
  const halfH = height / 2 - inset;
  const cx = width / 2;
  const cy = height / 2;
  const angle = (k: number) => Math.PI / 2 + (k * 2 * Math.PI) / n;
  const size = (aspect: Aspect, u: number) => ({ w: aspect === 'landscape' ? LONG * u : u, h: aspect === 'portrait' ? LONG * u : u });
  // The short edge u per unit of radius R: RING_OVERLAP × the chord between neighbours.
  const chord = n > 1 ? 2 * Math.sin(Math.PI / n) : 1;
  const uPerR = RING_OVERLAP * chord;
  // Everything scales with R: take the largest R that keeps every image inside the area.
  let r = Number.POSITIVE_INFINITY;
  aspects.forEach((aspect, k) => {
    const { w, h } = size(aspect, uPerR);
    const a = angle(k);
    r = Math.min(r, halfW / (Math.abs(Math.cos(a)) + w / 2), halfH / (Math.abs(Math.sin(a)) + h / 2));
  });
  let u = uPerR * r;
  const uMax = RING_MAX_SHORT * Math.min(width, height);
  if (u > uMax) {
    // Capped: a smaller ring, so neighbours still overlap as much.
    u = uMax;
    r = u / uPerR;
  }
  return aspects.map((aspect, k) => {
    const a = angle(k);
    const { w, h } = size(aspect, u);
    return {
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
      width: w,
      height: h,
      // By height on screen, the first winning ties so it is always on top.
      z: Math.round((Math.sin(a) + 1) * 1000) * 2 + (k === 0 ? 1 : 0),
    };
  });
}
