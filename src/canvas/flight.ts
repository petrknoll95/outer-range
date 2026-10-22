import { FLIGHT_BLUR, FLIGHT_DEPTH_SPREAD, FLIGHT_EASE, FLIGHT_FADE_FROM, FLIGHT_FADE_TO, FLIGHT_FAR, FLIGHT_FAR_BLUR, FLIGHT_FAR_FADE } from './config';
import { cubicBezier, smoothstep } from './focus';
import { hash, unit } from './hash';

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

