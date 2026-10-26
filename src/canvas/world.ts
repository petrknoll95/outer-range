import { COLUMN_STAGGER, COLUMN_STAGGER_JITTER, JITTER_X, JITTER_Y, LONG, REPEAT_COLS, REPEAT_ROWS, SEED } from './config';
import { hash, mod, signed } from './hash';

export type Aspect = 'landscape' | 'portrait' | 'square';

export interface WorldImage {
  aspect: Aspect;
}

/** Everything about one lattice cell. Sizes and offsets are in units of S. */
export interface Cell {
  i: number;
  j: number;
  image: number;
  aspect: Aspect;
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

const ASPECTS: readonly Aspect[] = ['landscape', 'portrait', 'square'];

/** Cells stack in a random order, at z 0 to Z_LEVELS − 1 (a power of two); anything drawn over every tile goes at Z_LEVELS. */
export const Z_LEVELS = 1024;

export function emptyCell(): Cell {
  return { i: 0, j: 0, image: 0, aspect: 'square', w: 1, h: 1, dx: 0, dy: 0, z: 0 };
}

/**
 * Splits the images into one disjoint slice per lattice class. Each aspect is dealt
 * round-robin from a different starting class, so every slice gets a mix of shapes
 * and no class ends up as an all-landscape column of the lattice.
 */
function buildSlices(images: readonly WorldImage[], classes: number, seed: number): number[][] {
  const slices: number[][] = Array.from({ length: classes }, () => []);
  ASPECTS.forEach((aspect, a) => {
    const group = images
      .map((img, index) => ({ img, index }))
      .filter((x) => x.img.aspect === aspect)
      .map((x) => ({ index: x.index, key: hash(x.index, a, seed, SALT_SHUFFLE) }))
      .sort((p, q) => p.key - q.key || p.index - q.index);
    const start = Math.floor((a * classes) / ASPECTS.length);
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
  const classes = cols * rows;
  if (images.length < classes) {
    throw new Error(`The no-repeat lattice needs at least ${classes} images (${cols}×${rows}); got ${images.length}.`);
  }
  const slices = buildSlices(images, classes, seed);

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
      const aspect = images[image]!.aspect;
      out.i = i;
      out.j = j;
      out.image = image;
      out.aspect = aspect;
      out.w = aspect === 'landscape' ? LONG : 1;
      out.h = aspect === 'portrait' ? LONG : 1;
      out.dx = signed(hash(i, j, seed, SALT_JX)) * jitterX;
      out.dy = signed(hash(i, j, seed, SALT_JY)) * jitterY + columnStagger(i);
      out.z = hash(i, j, seed, SALT_Z) & (Z_LEVELS - 1);
      return out;
    },
  };
}
