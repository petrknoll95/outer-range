import { FOCUS_DISTANCE_UNIT, FOCUS_DURATION_PER_DOUBLING, FOCUS_MAX_DURATION, FOCUS_MIN_DURATION } from './config';
import type { CellRect, Geometry } from './layout';
import { cellRect } from './layout';
import type { World } from './world';
import { emptyCell } from './world';

/** Smoothstep: eases 0 → 1 with zero slope at both ends. */
export function smoothstep(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * A CSS cubic-bezier(x1, y1, x2, y2) timing function: progress for time u in [0, 1]. The
 * x(t) it inverts is monotonic for 0 ≤ x1, x2 ≤ 1, so a few Newton steps (falling back to
 * bisection) find t to well under a pixel.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const at = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const slope = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  return (u: number) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let n = 0; n < 8; n++) {
      const dx = at(x1, x2, t) - u;
      if (Math.abs(dx) < 1e-7) return at(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    let lo = 0;
    let hi = 1;
    t = u;
    for (let n = 0; n < 40; n++) {
      if (at(x1, x2, t) < u) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return at(y1, y2, t);
  };
}

/**
 * Hermite basis for a start velocity: 0 at both ends, slope 1 at the start, 0 at the
 * end. A glide p(u) = from + Δ·smoothstep(u) + v₀·T·startSlope(u) leaves at velocity v₀
 * and arrives exactly at from + Δ, at rest.
 */
export function startSlope(u: number): number {
  return u * (1 - u) * (1 - u);
}

/** How long to glide `distance` screen px: logarithmic, so long moves take only a little longer. */
export function focusDuration(distance: number): number {
  const d = FOCUS_MIN_DURATION + FOCUS_DURATION_PER_DOUBLING * Math.log2(1 + distance / FOCUS_DISTANCE_UNIT);
  return Math.min(FOCUS_MAX_DURATION, Math.max(FOCUS_MIN_DURATION, d));
}

/**
 * The pan, in screen px, that brings a tile's centre to the viewport centre. `rect` is
 * the tile's grid position in world px (no trail offset, no lens, so the result is exact
 * and the lens is the identity there). (camX, camY) is the camera and z the zoom.
 */
export function centerDelta(
  rect: { left: number; top: number; width: number; height: number },
  camX: number,
  camY: number,
  z: number,
  vw: number,
  vh: number,
): { dx: number; dy: number } {
  return {
    dx: (rect.left + rect.width / 2 - camX) * z - vw / 2,
    dy: (rect.top + rect.height / 2 - camY) * z - vh / 2,
  };
}

const nearestCell = emptyCell();
const nearestRect: CellRect = { left: 0, top: 0, width: 0, height: 0 };

/**
 * Centre (world px) of the image nearest world point (wx, wy). Every lattice cell holds
 * an image within jitter and stagger of its lattice point, so the nearest one is always
 * among the cells two around the point's own. Writes into `out`.
 */
export function nearestImageCentre<T extends { x: number; y: number; width?: number; height?: number }>(world: World, g: Geometry, wx: number, wy: number, out: T): T {
  const i0 = Math.round(wx / g.pitch);
  const j0 = Math.round((wy - world.columnStagger(i0) * g.s) / g.pitch);
  let best = Number.POSITIVE_INFINITY;
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const r = cellRect(world.cell(i, j, nearestCell), g, nearestRect);
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = (cx - wx) ** 2 + (cy - wy) ** 2;
      if (d < best) {
        best = d;
        out.x = cx;
        out.y = cy;
        if ('width' in out) {
          out.width = r.width;
          out.height = r.height;
        }
      }
    }
  }
  return out;
}
