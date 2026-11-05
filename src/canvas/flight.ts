import { FLIGHT_ABERRATION, FLIGHT_ABERRATION_SPEED, FLIGHT_BLUR, FLIGHT_DEPTH_SPREAD, FLIGHT_EASE, FLIGHT_FADE_FROM, FLIGHT_FADE_TO, FLIGHT_FAR, FLIGHT_FAR_BLUR, FLIGHT_FAR_FADE, FLIGHT_HANDOVER, FLIGHT_LINE_ALPHA, FLIGHT_LINES, FLIGHT_RAY_PACE, FLIGHT_SHUTTER, FLIGHT_THINNING, INTRO_THIN } from './config';
import { cubicBezier, smoothstep } from './focus';
import { hash, unit } from './hash';
import type { IntroFrame, IntroTile } from './intro';
import { Detail, instances, introLineCount, lineUnits, lineWidth, putLine, putRays } from './intro';
import type { Rgb } from './pixels';

/**
 * The flight out of the canvas, as a pinhole camera.
 *
 * Every image on screen is given a depth (for the flight only; browsing stays flat), and
 * they all start out drawn exactly as they are. As the camera moves forward by `travel`,
 * an image at depth D is drawn D / (D − travel) times bigger, and its centre moves away
 * from the vanishing point by the same factor: true perspective, so nearer images grow
 * and leave faster than farther ones. Each blurs and fades out as it nears the camera.
 */

const SALT_DEPTH = 8;

/** The depth of the image in cell (i, j) during the flight: 1 to 1 + FLIGHT_DEPTH_SPREAD. */
export function flightDepth(i: number, j: number, seed: number): number {
  return 1 + FLIGHT_DEPTH_SPREAD * unit(hash(i, j, seed, SALT_DEPTH));
}

/** How far the camera travels in all: until even the farthest image has faded. */
export const FLIGHT_TRAVEL = FLIGHT_FADE_TO * (1 + FLIGHT_DEPTH_SPREAD);

const flightEase = cubicBezier(...FLIGHT_EASE);

/** The camera's travel at progress u (0 to 1, in time): eased in and out (FLIGHT_EASE). */
export function flightTravel(u: number): number {
  return FLIGHT_TRAVEL * flightEase(Math.min(1, Math.max(0, u)));
}

export interface FlightView {
  /** How many times bigger it is drawn, about the vanishing point. */
  scale: number;
  opacity: number;
  /** How blurred it is, screen px: none in the focal plane, more as it nears the camera. */
  blur: number;
}

/** How an image at `depth` is drawn with the camera `travel` in. Writes into `out`. */
export function flightView(depth: number, travel: number, out: FlightView): FlightView {
  // Once faded it is gone; it never reaches the camera.
  const r = Math.min(Math.max(0, travel / depth), FLIGHT_FADE_TO);
  out.scale = 1 / (1 - r);
  out.opacity = 1 - smoothstep(Math.min(1, Math.max(0, (r - FLIGHT_FADE_FROM) / (FLIGHT_FADE_TO - FLIGHT_FADE_FROM))));
  out.blur = FLIGHT_BLUR * smoothstep(Math.min(1, r / FLIGHT_FADE_TO));
  return out;
}

/**
 * The far plane (the about view's text) with the camera `travel` in. It sits FLIGHT_FAR
 * beyond where the camera stops, so by perspective it is drawn FLIGHT_FAR / (distance left)
 * as big: small and far off as the flight sets out, its own size when the camera arrives.
 * Writes into `out`.
 */
export function flightFar(travel: number, out: FlightView): FlightView {
  const t = Math.min(Math.max(0, travel), FLIGHT_TRAVEL);
  out.scale = FLIGHT_FAR / (FLIGHT_TRAVEL + FLIGHT_FAR - t);
  out.opacity = smoothstep(Math.min(1, Math.max(0, (t / FLIGHT_TRAVEL - FLIGHT_FAR_FADE) / (1 - FLIGHT_FAR_FADE))));
  // Out of focus far off, sharp in the focal plane.
  const start = FLIGHT_FAR / (FLIGHT_TRAVEL + FLIGHT_FAR);
  out.blur = (FLIGHT_FAR_BLUR * (1 - out.scale)) / (1 - start);
  return out;
}


const SALT_RAY_PACE = 20;

/**
 * What the flight's rays draw (introlayer.ts): each of `tiles`' colour grids, a ray per cell
 * coming at the camera as fast as its image does or faster (FLIGHT_RAY_PACE), so the image
 * comes apart as it flies; then a tube of lines ahead, all near enough to go by.
 */
export function flightInstances(tiles: readonly IntroTile[], palette: readonly Rgb[], vw: number, vh: number, seed: number): Float32Array {
  const lines = Math.round(introLineCount(vw, vh) * FLIGHT_LINES);
  const { data, put } = instances(tiles, lines);
  const [slowest, fastest] = FLIGHT_RAY_PACE;
  for (const tile of tiles) {
    // Its image, at this depth, reaches the camera after `depth` of travel.
    const depth = flightDepth(tile.i, tile.j, seed);
    // Every cell its own pace, finer cells too: the image comes apart (and the flight draws few enough to afford it).
    let cell = 0;
    putRays(put, tile, Detail.Always, (_, out) => {
      out.thin = INTRO_THIN;
      out.depth = 1;
      out.travel = -(slowest + (fastest - slowest) * unit(hash(tile.i, tile.j, seed, SALT_RAY_PACE + cell++ * 100))) / depth;
      out.pace = 1;
    });
  }
  const reach = Math.hypot(vw, vh) / 2;
  for (let n = 0; n < lines; n++) {
    const u = lineUnits(n, seed);
    const meet = 1 + 0.5 * u.meet;
    // Ahead, but no further than the camera gets past by the end; more of them near, where they go by fastest.
    const ahead = 0.6 + (FLIGHT_TRAVEL * meet - 0.6) * u.along ** 1.5;
    putLine(put, n, 2 * Math.PI * u.angle, reach * (0.2 + 1.1 * u.ring), lineWidth(n, seed), palette, seed, ahead, -meet);
  }
  return data;
}

/**
 * The rays at progress u of the flight, heading `to` (1 out, 0 back). Writes into `out`.
 * Setting out each image turns to its colour grid, which thins into streaks as it speeds up;
 * the lines come in once under way, and it is all gone as the about view arrives.
 */
export function flightFrame(u: number, to: 0 | 1, out: IntroFrame): IntroFrame {
  const between = (from: number, end: number, x: number) => smoothstep(Math.min(1, Math.max(0, (x - from) / (end - from))));
  const now = flightTravel(u);
  const then = flightTravel(u + (to === 1 ? -FLIGHT_SHUTTER : FLIGHT_SHUTTER));
  // A streak runs from its nearer end, whichever way the camera is going.
  out.z = Math.max(now, then);
  out.tail = Math.min(now, then);
  out.back = to === 1 ? 0 : 1;
  out.flight = 1;
  out.scale = 1;
  out.closed = 1 - FLIGHT_THINNING * between(0.04, 0.4, u);
  out.corners = 1 - between(0.04, 0.2, u);
  out.fade = 1 - between(0.85, 1, u);
  out.rays = between(0, 0.1, u);
  out.lines = FLIGHT_LINE_ALPHA * between(0.08, 0.4, u);
  out.aberration = FLIGHT_ABERRATION * between(0, FLIGHT_ABERRATION_SPEED, out.z - out.tail) * out.fade;
  out.handover = flightHandover(u);
  return out;
}

/**
 * How much of each image is left at progress u, under its rays: they take it over once they are
 * solid, and it stays until they have come well apart, so the first hairline gaps between its
 * cells show the image (soft by then) and not the page.
 */
export function flightHandover(u: number): number {
  return 1 - smoothstep(Math.min(1, Math.max(0, (u - FLIGHT_HANDOVER[0]) / (FLIGHT_HANDOVER[1] - FLIGHT_HANDOVER[0]))));
}
