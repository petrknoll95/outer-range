import { INTRO_DISTANCE, INTRO_EASE, INTRO_HANDOVER, INTRO_LINE_AREA, INTRO_LINES, INTRO_PACE, INTRO_SHUTTER, INTRO_SPREAD, INTRO_THIN, INTRO_TILE_PACE, PIXEL_GRID } from './config';
import { cubicBezier, smoothstep } from './focus';
import { hash, unit } from './hash';
import type { Rgb } from './pixels';
import { hexRgb, pixelColor } from './pixels';
import type { Aspect } from './world';

/**
 * The intro, as a pinhole camera: the canvas is the focal plane, and something at depth D is
 * drawn 1 / D as big, that much nearer the screen centre. The camera is `z` from landing, so a
 * tile, at depth 1 + z, is drawn exactly as it lies on the canvas once z reaches 0.
 *
 * Each thing drawn is a box: its rectangle as seen now and, behind that, as seen a moment ago.
 * That sweep is its motion blur, and at this speed it is a line.
 * There are two kinds: rays, one per cell of each tile's colour grid, which land on that
 * cell, and lines on a tube around the view, which pass the camera before it lands. This file works out where
 * they go; introlayer.ts draws them.
 */

/** A tile on screen as the intro lands on it, px from the viewport centre. */
export interface IntroTile {
  i: number;
  j: number;
  /** Its centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  aspect: Aspect;
  /** Its colour grid. */
  pixels: string;
}

export interface IntroFrame {
  /** Distance from landing now, and where a streak's tail is drawn from. */
  z: number;
  tail: number;
  /** How big the focal plane is drawn: 1 landed. */
  scale: number;
  /** 0 at speed (rays thin) to 1 closed up into their tile's grid. */
  closed: number;
  /** 0 while tiles are lines to 1 with their rounded corners cut. */
  corners: number;
  /** Out of nothing, at the very start. */
  fade: number;
}

const introEase = cubicBezier(...INTRO_EASE);
const LOG_DEPTH = Math.log(1 + INTRO_DISTANCE);

/** How far the camera has left to go at progress u: reaches exactly 0, at no speed. */
export function introDistance(u: number): number {
  return Math.expm1(LOG_DEPTH * (1 - introEase(u)));
}

/** The camera at progress u (0 to 1, in time). Writes into `out`. */
export function introFrame(u: number, out: IntroFrame): IntroFrame {
  const between = (from: number, to: number, x: number) => smoothstep(Math.min(1, Math.max(0, (x - from) / (to - from))));
  out.z = introDistance(u);
  out.scale = 1 / (1 + out.z);
  out.closed = 1 - between(0.2, 0.8, out.z);
  // Whole tiles still streak; the streaks draw in as the images are about to take over.
  out.tail = out.z + (introDistance(u - INTRO_SHUTTER) - out.z) * between(INTRO_HANDOVER, 0.35, out.z);
  out.corners = 1 - between(INTRO_HANDOVER, 0.2, out.z);
  out.fade = between(0, 0.06, u);
  return out;
}

const lightness = ([r, g, b]: Rgb) => (r + g + b) / 3;
const vividness = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

/** The colours that show up against the background; all of them, if too few do. */
export function introPalette(all: readonly Rgb[], background: Rgb): readonly Rgb[] {
  const seen = all.filter((c) => Math.abs(lightness(c) - lightness(background)) > 0.18);
  return seen.length >= 4 ? seen : all;
}

/** How many lines pass the camera on a viewport this big. */
export function introLineCount(vw: number, vh: number): number {
  return Math.min(INTRO_LINES, Math.round((vw * vh) / INTRO_LINE_AREA));
}

/**
 * How far something at `pace` is along the way with the camera `z` out: all of it is at z at
 * the handover, so a pace over 1 starts further back and makes up the distance, and under 1
 * gets ahead and is caught up. The layer's vertex shader works this out; here for the tests.
 */
export function introTravel(z: number, pace: number, closed: number): number {
  return INTRO_HANDOVER * (z / INTRO_HANDOVER) ** (pace + (1 - pace) * closed);
}

/** A ray's pace: mostly its own, and most ahead of the camera, a few far behind. */
function rayPace(tile: number, ray: number): number {
  const [slowest, fastest] = INTRO_PACE;
  return slowest + (fastest - slowest) * (INTRO_TILE_PACE * tile + (1 - INTRO_TILE_PACE) * ray ** 2);
}

/** Per instance: pos 2, offset 2, half 2, thin 1, tile 3, colour 4, depth 2, pace 1. */
export const INTRO_STRIDE = 17;

const SALT_RAY = 9;
const SALT_TILE_PACE = 10;
const SALT_PACE = 19;
const SALT_ANGLE = 11;
const SALT_RING = 12;
const SALT_NEAR = 13;
const SALT_FAR = 14;
const SALT_SIZE = 15;
const SALT_COLOR = 16;
const SALT_ALPHA = 17;
const SALT_COLOR2 = 18;

/** What the layer draws, per INTRO_STRIDE: every tile's rays, then the lines that pass. */
export function introInstances(tiles: readonly IntroTile[], palette: readonly Rgb[], vw: number, vh: number, seed: number): Float32Array {
  const lines = introLineCount(vw, vh);
  const rays = tiles.reduce((sum, tile) => sum + tile.pixels.length / 6, 0);
  const data = new Float32Array((rays + lines) * INTRO_STRIDE);
  let at = 0;
  const put = (...values: number[]) => {
    data.set(values, at);
    at += values.length;
  };

  for (const tile of tiles) {
    const [cols, rows] = PIXEL_GRID[tile.aspect];
    const hx = tile.width / 2;
    const hy = tile.height / 2;
    const tilePace = unit(hash(tile.i, tile.j, seed, SALT_TILE_PACE));
    for (let n = 0; n < cols * rows; n++) {
      const col = n % cols;
      const row = (n - col) / cols;
      const [r, g, b] = hexRgb(pixelColor(tile.pixels, n));
      const pace = rayPace(tilePace, unit(hash(tile.i, tile.j, seed, SALT_PACE + n * 100)));
      // A little over its share, so no gap shows between cells as they close up.
      put(
        tile.x,
        tile.y,
        ((2 * col + 1) / cols - 1) * hx,
        ((2 * row + 1) / rows - 1) * hy,
        hx / cols + 0.5,
        hy / rows + 0.5,
        // The ones that hang back and rush are the finest.
        INTRO_THIN / pace,
        hx,
        hy,
        tile.radius,
        r,
        g,
        b,
        1,
        1,
        1 + INTRO_SPREAD * unit(hash(tile.i, tile.j, seed, SALT_RAY + n * 100)),
        pace,
      );
    }
  }

  const reach = Math.hypot(vw, vh) / 2;
  for (let n = 0; n < lines; n++) {
    const angle = 2 * Math.PI * unit(hash(n, 0, seed, SALT_ANGLE));
    // Outside the view at depth 1, so it has left the screen by the time the tiles land.
    const ring = reach * (1.05 + 1.5 * unit(hash(n, 0, seed, SALT_RING)));
    const size = 1.5 + 4.5 * unit(hash(n, 0, seed, SALT_SIZE));
    // Of two colours, the more vivid: the work is mostly pale, its accents are what light the tunnel.
    const pick = (salt: number) => palette[Math.floor(unit(hash(n, 0, seed, salt)) * palette.length)]!;
    const [r, g, b] = [pick(SALT_COLOR), pick(SALT_COLOR2)].sort((a, c) => vividness(c) - vividness(a))[0]!;
    put(
      Math.cos(angle) * ring,
      Math.sin(angle) * ring,
      0,
      0,
      size,
      size,
      1,
      1e4,
      1e4,
      0,
      r,
      g,
      b,
      0.45 + 0.55 * unit(hash(n, 0, seed, SALT_ALPHA)),
      unit(hash(n, 0, seed, SALT_NEAR)),
      0.05 + 0.95 * unit(hash(n, 0, seed, SALT_FAR)),
      rayPace(0.5, unit(hash(n, 0, seed, SALT_PACE))),
    );
  }
  return data;
}
