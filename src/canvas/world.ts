import { COLUMN_STAGGER, COLUMN_STAGGER_JITTER, JITTER_X, JITTER_Y, LONG, REPEAT_COLS, REPEAT_ROWS, SEED, SLACK_JITTER } from './config';
import { hash, mod, signed } from './hash';

export interface WorldImage {
  /** Width over height. */
  ratio: number;
}

/** Wide, tall or about square: the shapes the slices deal out evenly. */
export type Orientation = 'landscape' | 'portrait' | 'square';

/** Ratios within this factor of 1 count as square. */
const SQUARE_WITHIN = 1.1;

export function orientation(ratio: number): Orientation {
  return ratio > SQUARE_WITHIN ? 'landscape' : ratio < 1 / SQUARE_WITHIN ? 'portrait' : 'square';
}

/**
 * A tile's width and height, in S, for an image of this ratio: its own shape, as large as fits
 * a LONG × LONG box with its short edge at most S. So 4:3 is LONG × 1, 1:1 is 1 × 1, and
 * anything wider than 4:3 is LONG wide and less than S tall (16:9: LONG × 0.75). No tile is
 * ever larger than LONG either way, which the lattice, jitter and no-repeat sizing rely on.
 */
export function tileSize(ratio: number): { w: number; h: number } {
  if (ratio >= 1) {
    const h = Math.min(1, LONG / ratio);
    return { w: Math.min(LONG, h * ratio), h };
  }
  const w = Math.min(1, LONG * ratio);
  return { w, h: Math.min(LONG, w / ratio) };
}

/** Everything about one lattice cell. Sizes and offsets are in units of S. */
export interface Cell {
  i: number;
  j: number;
  image: number;
  w: number;
  h: number;
  /** Image centre relative to the lattice point (i·PITCH, j·PITCH), column stagger included. */
  dx: number;
  dy: number;
  z: number;
}

export interface WorldOptions {
  seed?: number;
  cols?: number;
  rows?: number;
  jitterX?: number;
  jitterY?: number;
  stagger?: number;
  staggerJitter?: number;
  slackJitter?: number;
}

export interface World {
  readonly seed: number;
  readonly cols: number;
  readonly rows: number;
  readonly jitterX: number;
  readonly jitterY: number;
  /** Largest |columnStagger|, in S. */
  readonly maxStagger: number;
  readonly images: readonly WorldImage[];
  /** slices[class] = the images that class may show. Slices are disjoint. */
  readonly slices: readonly (readonly number[])[];
  /** Pure: the same (i, j) always yields the same cell. Writes into `out` to avoid allocating. */
  cell(i: number, j: number, out?: Cell): Cell;
  /** Vertical offset shared by every cell in column i, in S. */
  columnStagger(i: number): number;
}

const SALT_PICK = 1;
const SALT_JX = 2;
const SALT_JY = 3;
const SALT_STAGGER = 4;
const SALT_Z = 5;
const SALT_SHUFFLE = 6;

const ORIENTATIONS: readonly Orientation[] = ['landscape', 'portrait', 'square'];

/** Cells stack in a random order, at z 0 to Z_LEVELS − 1 (a power of two); the active image goes at Z_LEVELS, and anything drawn over every tile above that. */
export const Z_LEVELS = 1024;

export function emptyCell(): Cell {
  return { i: 0, j: 0, image: 0, w: 1, h: 1, dx: 0, dy: 0, z: 0 };
}

/**
 * Splits the images into one disjoint slice per lattice class. Each orientation is dealt
 * round-robin from a different starting class, so every slice gets a mix of shapes
 * and no class ends up as an all-landscape column of the lattice.
 */
function buildSlices(images: readonly WorldImage[], classes: number, seed: number): number[][] {
  const slices: number[][] = Array.from({ length: classes }, () => []);
  ORIENTATIONS.forEach((shape, a) => {
    const group = images
      .map((img, index) => ({ img, index }))
      .filter((x) => orientation(x.img.ratio) === shape)
      .map((x) => ({ index: x.index, key: hash(x.index, a, seed, SALT_SHUFFLE) }))
      .sort((p, q) => p.key - q.key || p.index - q.index);
    const start = Math.floor((a * classes) / ORIENTATIONS.length);
    group.forEach((x, k) => slices[(start + k) % classes]!.push(x.index));
  });
  return slices;
}

export function createWorld(images: readonly WorldImage[], options: WorldOptions = {}): World {
  const seed = options.seed ?? SEED;
  const cols = options.cols ?? REPEAT_COLS;
  const rows = options.rows ?? REPEAT_ROWS;
  const jitterX = options.jitterX ?? JITTER_X;
  const jitterY = options.jitterY ?? JITTER_Y;
  const stagger = options.stagger ?? COLUMN_STAGGER;
  const staggerJitter = options.staggerJitter ?? COLUMN_STAGGER_JITTER;
  const slackJitter = options.slackJitter ?? SLACK_JITTER;
  const classes = cols * rows;
  if (images.length < classes) {
    throw new Error(`The no-repeat lattice needs at least ${classes} images (${cols}×${rows}); got ${images.length}.`);
  }
  const slices = buildSlices(images, classes, seed);
  const sizes = images.map((img) => tileSize(img.ratio));
  // Each image's extra jitter either way, in S: its share of the room a 4:3 or 3:4 tile would fill (SLACK_JITTER).
  const slack = sizes.map(({ w, h }) => ({ x: (Math.max(0, 1 - w) / 2) * slackJitter, y: (Math.max(0, 1 - h) / 2) * slackJitter }));

  // Brick offset: even columns up, odd columns down, each nudged by its own random amount.
  const columnStagger = (i: number) => ((i & 1) === 0 ? -stagger : stagger) + signed(hash(i, 0, seed, SALT_STAGGER)) * staggerJitter;

  return {
    seed,
    cols,
    rows,
    jitterX,
    jitterY,
    maxStagger: stagger + staggerJitter,
    images,
    slices,
    columnStagger,
    cell(i, j, out = emptyCell()) {
      const slice = slices[mod(j, rows) * cols + mod(i, cols)]!;
      const image = slice[hash(i, j, seed, SALT_PICK) % slice.length]!;
      const size = sizes[image]!;
      out.i = i;
      out.j = j;
      out.image = image;
      out.w = size.w;
      out.h = size.h;
      out.dx = signed(hash(i, j, seed, SALT_JX)) * (jitterX + slack[image]!.x);
      out.dy = signed(hash(i, j, seed, SALT_JY)) * (jitterY + slack[image]!.y) + columnStagger(i);
      out.z = hash(i, j, seed, SALT_Z) & (Z_LEVELS - 1);
      return out;
    },
  };
}
