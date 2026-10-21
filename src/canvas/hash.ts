/** murmur3 32-bit finaliser. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Pure hash of integer cell coordinates. It depends only on its arguments, never on
 * call order, which is what makes the world the same however you reach a cell.
 * `salt` separates independent properties of the same cell (image, jitter, z…).
 */
export function hash(i: number, j: number, seed: number, salt: number): number {
  let h = fmix32((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  h = fmix32((h ^ Math.imul(i | 0, 0x27d4eb2f)) >>> 0);
  h = fmix32((h + Math.imul(j | 0, 0x165667b1)) >>> 0);
  return h;
}

/** Hash → [0, 1). */
export function unit(h: number): number {
  return h / 4294967296;
}

/** Hash → [-1, 1). */
export function signed(h: number): number {
  return (h / 4294967296) * 2 - 1;
}

/** Modulo that is never negative. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
