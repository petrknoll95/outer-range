import { TRAIL_DAMPING, TRAIL_LAG_MAX, TRAIL_LAG_MIN, TRAIL_SETTLE_DISTANCE, TRAIL_SETTLE_SPEED, TRAIL_TAPER_SHARE } from './config';

/**
 * One image's trail spring, in screen px.
 *
 * The image has its own position p and velocity v. A spring pulls p toward its grid
 * position p*, and drag proportional to v resists motion:
 *
 *   p″ = −ω²·(p − p*) − c·p′,   c = 2ζω
 *
 * While the canvas moves at a steady velocity u, the image trails behind its grid
 * position by (c/ω²)·u = (2ζ/ω)·u = lag·u, along the velocity vector. When the canvas
 * stops, the spring pulls it back (overshooting slightly for ζ < 1), and it snaps onto
 * its grid position exactly once it is within TRAIL_SETTLE_DISTANCE.
 */
export interface Trail {
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Offset from the grid position after the last step, p − p*. */
  ox: number;
  oy: number;
  resting: boolean;
}

export function restingTrail(): Trail {
  return { px: 0, py: 0, vx: 0, vy: 0, ox: 0, oy: 0, resting: true };
}

/** Start a trail at grid position (gx, gy), already trailing as it would at steady velocity (ux, uy). */
export function placeTrail(t: Trail, gx: number, gy: number, ux: number, uy: number, lag: number): void {
  t.ox = -ux * lag;
  t.oy = -uy * lag;
  t.px = gx + t.ox;
  t.py = gy + t.oy;
  t.vx = ux;
  t.vy = uy;
  t.resting = t.ox === 0 && t.oy === 0;
}

/**
 * Taper along the direction of motion, as a weight in [0, 1]: 0 at the viewport edge
 * the images are moving toward (the leading edge), 1 at the opposite (trailing) edge,
 * linear in between, so the sheet stretches out behind the gesture like cloth pulled
 * from its front edge.
 *
 * (cx, cy) is the image centre relative to the viewport centre, (dx, dy) the unit
 * direction the images move on screen, (hx, hy) the viewport half-extents. The
 * viewport's half-extent along (dx, dy) is |dx|·hx + |dy|·hy, so for diagonal motion
 * the leading corner gets exactly 0 and the trailing corner exactly 1.
 */
export function taperWeight(cx: number, cy: number, dx: number, dy: number, hx: number, hy: number): number {
  const extent = Math.abs(dx) * hx + Math.abs(dy) * hy;
  if (!(extent > 0)) return 0.5;
  const along = (cx * dx + cy * dy) / extent;
  return Math.min(1, Math.max(0, (1 - along) / 2));
}

/**
 * Taper during a zoom, as a weight in [0, 1]: images move radially away from or toward
 * the zoom anchor, so the one under the anchor holds (0) and they trail more with
 * distance, reaching 1 at half the viewport diagonal.
 */
export function zoomTaperWeight(distance: number, halfDiagonal: number): number {
  return halfDiagonal > 0 ? Math.min(1, distance / halfDiagonal) : 0;
}

/** Lag from a taper weight and the image's own weight (both in [0, 1]); `share` of it comes from the taper. */
export function taperedLag(taper: number, own: number, share = TRAIL_TAPER_SHARE): number {
  return TRAIL_LAG_MIN + (TRAIL_LAG_MAX - TRAIL_LAG_MIN) * (share * taper + (1 - share) * own);
}

/**
 * Ease an image's lag toward `target` with time constant `tau` over h seconds. Lag sets
 * the spring's stiffness, so easing it means a change of direction re-tapers the sheet
 * smoothly instead of jolting every spring at once.
 */
export function easeLag(lag: number, target: number, h: number, tau: number): number {
  return tau > 0 ? lag + (target - lag) * (1 - Math.exp(-h / tau)) : target;
}

/**
 * Advance one image by h seconds toward grid position (gx, gy). The drag term is
 * integrated implicitly, so the step stays stable for any lag and step size.
 * `gridMoving` stops the image from snapping while its grid position is still moving.
 */
export function stepTrail(t: Trail, gx: number, gy: number, lag: number, h: number, gridMoving: boolean): void {
  if (lag <= 0) {
    t.px = gx;
    t.py = gy;
    t.vx = t.vy = t.ox = t.oy = 0;
    t.resting = true;
    return;
  }
  // The grid position has already moved by u·h when this step runs, which would shorten
  // the discrete steady-state lag to (lag − h)·u. Tuning ω for lag + h makes it exactly lag·u.
  const omega = (2 * TRAIL_DAMPING) / (lag + h);
  const k = omega * omega;
  const c = 2 * TRAIL_DAMPING * omega;
  t.vx = (t.vx - k * (t.px - gx) * h) / (1 + c * h);
  t.vy = (t.vy - k * (t.py - gy) * h) / (1 + c * h);
  t.px += t.vx * h;
  t.py += t.vy * h;
  t.ox = t.px - gx;
  t.oy = t.py - gy;
  if (
    !gridMoving &&
    Math.abs(t.ox) < TRAIL_SETTLE_DISTANCE &&
    Math.abs(t.oy) < TRAIL_SETTLE_DISTANCE &&
    Math.abs(t.vx) < TRAIL_SETTLE_SPEED &&
    Math.abs(t.vy) < TRAIL_SETTLE_SPEED
  ) {
    t.px = gx;
    t.py = gy;
    t.vx = t.vy = t.ox = t.oy = 0;
    t.resting = true;
  } else {
    t.resting = false;
  }
}

/**
 * Soft-limit an offset to `max` px: unchanged when small, approaching `max` smoothly
 * when large. Writes into `out`.
 */
export function limitOffset(ox: number, oy: number, max: number, out: { x: number; y: number }): void {
  const m = Math.hypot(ox, oy);
  const k = m > 0 && max > 0 ? (max * Math.tanh(m / max)) / m : 0;
  out.x = ox * k;
  out.y = oy * k;
}
