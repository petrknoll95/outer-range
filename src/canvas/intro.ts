import { INTRO_ABERRATION, INTRO_ABERRATION_SPEED, INTRO_FOG_CLEAR, INTRO_FOG_DEPTH, INTRO_FOG_FAR, INTRO_DISTANCE, INTRO_CRUISE, INTRO_CRUISE_RATE, INTRO_DURATION, INTRO_EASE, INTRO_HANDOVER, INTRO_LINE_AREA, INTRO_LINE_WIDTH, INTRO_LINES, INTRO_PACE, INTRO_SHUTTER, INTRO_SPREAD, INTRO_THIN, INTRO_TILE_PACE, PIXEL_GRID } from './config';
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
 * cell, and lines along a tube around the view, which the camera really flies past, so it is
 * under way from the first frame and the launch only speeds it up. This file works out where
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
  /** A finer grid, sampled from its image as drawn: columns, rows and RGBA bytes, in place of `pixels`. */
  fine?: { cols: number; rows: number; rgba: Uint8ClampedArray };
  /** How opaque it is drawn (faded round a focused image or a project): its rays are as faint. 1 if not given. */
  opacity?: number;
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
  /** 0 while the tiles' rays are held back, to 1: out of the vanishing point as the launch builds. */
  rays: number;
  /** How solid the tube's lines are, 0 to 1. */
  lines: number;
  /** 1 on the flight to the about view (flight.ts): things are `z` and `tail` along, as they are, and fade before they reach the camera. */
  flight: number;
  /** 1 flying back: a streak's head, where it is now, is its far end. */
  back: number;
  /** How far apart red and blue are drawn at the screen's corners, CSS px: none at rest, more the faster the camera goes. */
  aberration: number;
  /** How much of each image is still on the page under its rays (flightHandover): a faded one's rays make up the rest of it, no more. */
  handover: number;
}

/** How solid something at `depth` is drawn, 1 to INTRO_FOG_FAR. The layer's vertex shader works this out; here for the tests. */
export function introFog(depth: number): number {
  return INTRO_FOG_FAR + (1 - INTRO_FOG_FAR) * Math.exp(-Math.max(depth - INTRO_FOG_CLEAR, 0) / INTRO_FOG_DEPTH);
}

/** How long it all takes, s. */
export const INTRO_LENGTH = INTRO_CRUISE + INTRO_DURATION;

const introEase = cubicBezier(...INTRO_EASE);
const LOG_DEPTH = Math.log(1 + INTRO_DISTANCE);
/** The cruise eases off into the launch, so its speed only ever hands over, never drops. */
const CRUISE_EASE = 0.6;

/**
 * How far the camera has left to go, t s in, launching `wait` s after INTRO_CRUISE: reaches
 * exactly 0 at INTRO_LENGTH + wait, at no speed. Up to the launch `wait` makes no difference,
 * so it can still be growing as the camera flies.
 */
export function introDistance(t: number, wait = 0): number {
  const launch = INTRO_CRUISE + wait;
  const after = Math.min(1, Math.max(0, (t - launch) / CRUISE_EASE));
  const cruise = INTRO_CRUISE_RATE * (Math.max(0, launch - t) + (CRUISE_EASE / 3) * (1 - after) ** 3);
  return Math.expm1((LOG_DEPTH - INTRO_CRUISE_RATE * wait) * (1 - introEase((t - launch) / INTRO_DURATION)) + cruise);
}

/** The smallest a tile is drawn while still whole enough to see: further off it is only rays near the centre. */
export const INTRO_FARTHEST = 0.5;

/** The camera t s in, launching `wait` s late. Writes into `out`. */
export function introFrame(t: number, out: IntroFrame, wait = 0): IntroFrame {
  const between = (from: number, to: number, x: number) => smoothstep(Math.min(1, Math.max(0, (x - from) / (to - from))));
  out.z = introDistance(t, wait);
  out.scale = 1 / (1 + out.z);
  out.closed = 1 - between(0.2, 0.8, out.z);
  // Whole tiles still streak; the streaks draw in as the images are about to take over.
  out.tail = out.z + (introDistance(t - INTRO_SHUTTER * INTRO_DURATION, wait) - out.z) * between(INTRO_HANDOVER, 0.35, out.z);
  out.corners = 1 - between(INTRO_HANDOVER, 0.2, out.z);
  out.fade = between(0, 0.25, t);
  // Far off they would only be a blob behind the controls; the tunnel stays open until they have gone.
  out.rays = 1 - between(12, 34, out.z);
  out.lines = 1;
  out.flight = 0;
  out.back = 0;
  out.handover = 0;
  // By how much the camera closes in over a shutter, as a ratio: steady through the cruise, peaking at the launch.
  out.aberration = INTRO_ABERRATION * between(INTRO_ABERRATION_SPEED[0], INTRO_ABERRATION_SPEED[1], Math.log1p(out.tail) - Math.log1p(out.z));
  return out;
}

/** When something at the centre rises and leaves, s (see config.ts). */
export interface IntroReveal {
  start: number;
  rise: number;
  leave: number;
  fall: number;
  stagger: number;
}

/** Where item n of a reveal is t s in, as a share of its height below (+) or above (−) its place: past ±1 it is out of the mask. */
export function introLetter(t: number, n: number, { start, rise, leave, fall, stagger }: IntroReveal): number {
  const delay = n * stagger;
  const progress = (from: number, duration: number) => Math.min(1, Math.max(0, (t - from - delay) / duration));
  const up = 1 - (1 - progress(start, rise)) ** 4;
  const out = progress(leave, fall) ** 3;
  return 1 - up - out;
}

/** When the last of `items` has gone, s. */
export const introTitleEnd = (items: number, { leave, fall, stagger }: IntroReveal) => leave + fall + items * stagger;

const lightness = ([r, g, b]: Rgb) => (r + g + b) / 3;
const vividness = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

/** The colours that show up against the background; all of them, if too few do. */
export function introPalette(all: readonly Rgb[], background: Rgb): readonly Rgb[] {
  const seen = all.filter((c) => Math.abs(lightness(c) - lightness(background)) > 0.18);
  return seen.length >= 4 ? seen : all;
}

/** How many lines there are on a viewport this big. */
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

/** Per instance: pos 2, offset 2, half 2, thin 1, detail 1 (see Detail), tile 3, colour 4, depth 2, pace 1. */
export const INTRO_STRIDE = 18;

/**
 * Which grid a ray is drawn for. A coarse ray and its finer² finer ones move as one: the layer draws
 * the coarse one while the finer would be under a pixel wide (and so each drawn a pixel wide, finer²
 * times the work for nothing to see), and the finer ones once they would show their detail.
 */
export const Detail = { Always: 0, Coarse: 1, Fine: 2 } as const;
export type Detail = (typeof Detail)[keyof typeof Detail];

/** How far along the tunnel a line has to be for the camera to be past it before the tiles land. */
export const LINE_CLEAR = 2;

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

/** What the layer draws, per INTRO_STRIDE: every tile's rays, then the tunnel's lines. */
export function introInstances(tiles: readonly IntroTile[], palette: readonly Rgb[], vw: number, vh: number, seed: number): Float32Array {
  const build = introBuild(tiles, palette, vw, vh, seed);
  for (;;) {
    const step = build.next();
    if (step.done) return step.value;
  }
}

/** introInstances a tile at a time: it pauses after each, so the work can be spread over frames. */
export function* introBuild(tiles: readonly IntroTile[], palette: readonly Rgb[], vw: number, vh: number, seed: number): Generator<void, Float32Array> {
  const lines = introLineCount(vw, vh);
  const { data, put } = instances(tiles, lines, true);

  for (const tile of tiles) {
    yield;
    const tilePace = unit(hash(tile.i, tile.j, seed, SALT_TILE_PACE));
    // Each cell of the coarse grid, and of the finer one its finer cells, at the coarse cell's pace and depth.
    const ray = (n: number, out: RayDepth) => {
      out.pace = rayPace(tilePace, unit(hash(tile.i, tile.j, seed, SALT_PACE + n * 100)));
      // The ones that hang back and rush are the finest.
      out.thin = INTRO_THIN / out.pace;
      out.depth = 1;
      out.travel = 1 + INTRO_SPREAD * unit(hash(tile.i, tile.j, seed, SALT_RAY + n * 100));
    };
    putRays(put, { ...tile, fine: undefined }, tile.fine ? Detail.Coarse : Detail.Always, ray);
    if (tile.fine) putRays(put, tile, Detail.Fine, ray);
  }

  const reach = Math.hypot(vw, vh) / 2;
  const START = introDistance(0);
  for (let n = 0; n < lines; n++) {
    const u = lineUnits(n, seed);
    const pace = rayPace(unit(hash(n, 0, seed, SALT_TILE_PACE)), unit(hash(n, 0, seed, SALT_PACE)));
    const meet = 1 + 0.5 * u.meet;
    // Somewhere along the tunnel, between here and where the camera sets out: more of them
    // nearer the tiles, where it goes fastest.
    const along = Math.expm1(u.along * Math.log1p(meet * START));
    // Far along it can be anywhere, up close to the very middle: the camera is past it long
    // before it lands (and just off centre it goes off screen as it passes, unlike dead on it).
    // Near the tiles it has to be outside the view, to be off screen when they land.
    const inner = along > LINE_CLEAR ? 0.03 : 1.05;
    const ring = reach * (inner + (2.25 - inner) * u.ring);
    // As wide as a ray at its pace, the same way: the ones that rush are the finest.
    const size = lineWidth(n, seed) / pace;
    // A speed of 1 is the camera's; a little over and the line comes to meet it. Lines go by
    // at their own depth, so at no pace of their own.
    putLine(put, n, 2 * Math.PI * u.angle, ring, size, palette, seed, 1 - along, meet);
  }
  return data;
}

/** One instance's INTRO_STRIDE values, in order. */
type Put = (...values: Instance) => void;
type Instance = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** Room for `tiles`' rays and `lines` lines, and a way to fill it in order. */
export function instances(tiles: readonly IntroTile[], lines: number, coarse = false): { data: Float32Array; put: Put } {
  // (With `coarse`, room for each tile's coarse grid alongside its finer one.)
  const rays = tiles.reduce((sum, tile) => sum + (tile.fine ? tile.fine.cols * tile.fine.rows : 0) + (!tile.fine || coarse ? tile.pixels.length / 6 : 0), 0);
  const data = new Float32Array((rays + lines) * INTRO_STRIDE);
  let at = 0;
  // Each value written as it is: a flight's finer grids are tens of thousands of these, put while the visitor waits.
  return {
    data,
    put: (a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r) => {
      data[at] = a;
      data[at + 1] = b;
      data[at + 2] = c;
      data[at + 3] = d;
      data[at + 4] = e;
      data[at + 5] = f;
      data[at + 6] = g;
      data[at + 7] = h;
      data[at + 8] = i;
      data[at + 9] = j;
      data[at + 10] = k;
      data[at + 11] = l;
      data[at + 12] = m;
      data[at + 13] = n;
      data[at + 14] = o;
      data[at + 15] = p;
      data[at + 16] = q;
      data[at + 17] = r;
      at += INTRO_STRIDE;
    },
  };
}

/** A ray's thinness at speed and its depth, at the focal plane and per unit of travel, and its pace (see the shader). */
export interface RayDepth {
  thin: number;
  depth: number;
  travel: number;
  pace: number;
}

/** Line n's draws, each 0 to 1: its angle, how far out, how far along, and how fast it comes. */
export const lineUnits = (n: number, seed: number) => ({
  angle: unit(hash(n, 0, seed, SALT_ANGLE)),
  ring: unit(hash(n, 0, seed, SALT_RING)),
  along: unit(hash(n, 0, seed, SALT_NEAR)),
  meet: unit(hash(n, 0, seed, SALT_FAR)),
});

const rayDepth: RayDepth = { thin: 0, depth: 0, travel: 0, pace: 0 };

/**
 * Put `tile`'s colour grid, its finer one if it has one, a ray per cell where it lands, drawn
 * for `detail`: `ray(n, out)` writes the RayDepth of cell n of the coarse grid, which a finer cell shares.
 */
export function putRays(put: Put, tile: IntroTile, detail: Detail, ray: (n: number, out: RayDepth) => void): void {
  const { fine } = tile;
  const [coarseCols] = PIXEL_GRID[tile.aspect];
  const [cols, rows] = fine ? [fine.cols, fine.rows] : PIXEL_GRID[tile.aspect];
  const finer = cols / coarseCols;
  const hx = tile.width / 2;
  const hy = tile.height / 2;
  // A little over its share, so no gap shows between cells as they close up.
  const cx = hx / cols + 0.5;
  const cy = hy / rows + 0.5;
  const opacity = tile.opacity ?? 1;
  for (let n = 0; n < cols * rows; n++) {
    const col = n % cols;
    const row = (n - col) / cols;
    ray(finer === 1 ? n : Math.floor(row / finer) * coarseCols + Math.floor(col / finer), rayDepth);
    const { thin, depth, travel, pace } = rayDepth;
    const x = ((2 * col + 1) / cols - 1) * hx;
    const y = ((2 * row + 1) / rows - 1) * hy;
    if (fine) {
      const { rgba } = fine;
      put(tile.x, tile.y, x, y, cx, cy, thin, detail, hx, hy, tile.radius, rgba[n * 4]! / 255, rgba[n * 4 + 1]! / 255, rgba[n * 4 + 2]! / 255, opacity, depth, travel, pace);
    } else {
      const [r, g, b] = hexRgb(pixelColor(tile.pixels, n));
      put(tile.x, tile.y, x, y, cx, cy, thin, detail, hx, hy, tile.radius, r, g, b, opacity, depth, travel, pace);
    }
  }
}

/** Line n's width before its pace, px. */
export const lineWidth = (n: number, seed: number) => INTRO_LINE_WIDTH[0] + (INTRO_LINE_WIDTH[1] - INTRO_LINE_WIDTH[0]) * unit(hash(n, 0, seed, SALT_SIZE));

/** Put line n of the tube, `ring` px out at `angle` at the focal plane, and its depth there and per unit of travel. */
export function putLine(put: Put, n: number, angle: number, ring: number, size: number, palette: readonly Rgb[], seed: number, depth: number, travel: number): void {
  // Of two colours, the more vivid: the work is mostly pale, its accents are what light the tunnel.
  const pick = (salt: number) => palette[Math.floor(unit(hash(n, 0, seed, salt)) * palette.length)]!;
  const [r, g, b] = [pick(SALT_COLOR), pick(SALT_COLOR2)].sort((a, c) => vividness(c) - vividness(a))[0]!;
  // A box this big marks a line: no tile corners to cut, and the tiles' fade doesn't apply.
  put(Math.cos(angle) * ring, Math.sin(angle) * ring, 0, 0, size, size, 1, Detail.Always, 1e4, 1e4, 0, r, g, b, 0.85 + 0.15 * unit(hash(n, 0, seed, SALT_ALPHA)), depth, travel, 1);
}
