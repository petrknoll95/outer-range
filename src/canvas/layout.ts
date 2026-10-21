import { CELLS_PER_VIEWPORT, LONG, PITCH, RADIUS, S_MAX_PX, S_MIN_PX } from './config';
import type { Cell, World } from './world';
import { emptyCell } from './world';

/** Pixel geometry for one viewport size. */
export interface Geometry {
  vw: number;
  vh: number;
  /** Shared short edge, px. */
  s: number;
  /** Lattice pitch, px. */
  pitch: number;
  radius: number;
  /** True when S is large enough that two copies of an image can never both be on screen. */
  noRepeatGuaranteed: boolean;
}

/**
 * The largest viewport extent, in S, that can never show two copies of one image.
 * Copies are at least `cols` columns apart: their lattice points are cols·PITCH apart,
 * jitter can pull them 2·JITTER_X closer, and each can poke LONG/2 into view.
 * Same for rows with JITTER_Y (copies in one column share its stagger, so it cancels).
 */
export function noRepeatSpan(world: World): { x: number; y: number } {
  return {
    x: world.cols * PITCH - 2 * world.jitterX - LONG,
    y: world.rows * PITCH - 2 * world.jitterY - LONG,
  };
}

export function computeGeometry(vw: number, vh: number, world: World): Geometry {
  const byArea = Math.sqrt((vw * vh) / CELLS_PER_VIEWPORT) / PITCH;
  const span = noRepeatSpan(world);
  // A hair above the bound so rounding never lands exactly on it.
  const byRepeat = Math.max(vw / span.x, vh / span.y) * 1.02;
  const s = Math.min(S_MAX_PX, Math.max(S_MIN_PX, byArea, byRepeat));
  return {
    vw,
    vh,
    s,
    pitch: s * PITCH,
    radius: Math.round(s * RADIUS),
    noRepeatGuaranteed: s * span.x > vw && s * span.y > vh,
  };
}

/** Pixel rectangle of a cell's image in world space. */
export interface CellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function cellRect(cell: Cell, g: Geometry, out: CellRect): CellRect {
  out.width = cell.w * g.s;
  out.height = cell.h * g.s;
  out.left = cell.i * g.pitch + cell.dx * g.s - out.width / 2;
  out.top = cell.j * g.pitch + cell.dy * g.s - out.height / 2;
  return out;
}

/** Index range of lattice columns/rows that can reach into a world-space rectangle. */
export interface CellRange {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** Max distance from a lattice point to any edge of its image, in S, per axis. */
function reach(world: World): { x: number; y: number } {
  return { x: LONG / 2 + world.jitterX, y: LONG / 2 + world.jitterY + world.maxStagger };
}

export function cellRange(world: World, g: Geometry, left: number, top: number, right: number, bottom: number, out: CellRange): CellRange {
  const r = reach(world);
  // `+ 0` turns -0 into 0, so cell indices print and compare cleanly.
  out.i0 = Math.ceil((left - r.x * g.s) / g.pitch) + 0;
  out.i1 = Math.floor((right + r.x * g.s) / g.pitch) + 0;
  out.j0 = Math.ceil((top - r.y * g.s) / g.pitch) + 0;
  out.j1 = Math.floor((bottom + r.y * g.s) / g.pitch) + 0;
  return out;
}

const scratchCell = emptyCell();
const scratchRect: CellRect = { left: 0, top: 0, width: 0, height: 0 };
const scratchRange: CellRange = { i0: 0, i1: 0, j0: 0, j1: 0 };

/**
 * Calls `visit` for every cell whose image intersects the rectangle. The cell and rect
 * passed in are reused between calls; copy what you need.
 */
export function forEachCellIn(
  world: World,
  g: Geometry,
  left: number,
  top: number,
  right: number,
  bottom: number,
  visit: (cell: Cell, rect: CellRect) => void,
): void {
  const range = cellRange(world, g, left, top, right, bottom, scratchRange);
  for (let i = range.i0; i <= range.i1; i++) {
    for (let j = range.j0; j <= range.j1; j++) {
      const cell = world.cell(i, j, scratchCell);
      const rect = cellRect(cell, g, scratchRect);
      if (rect.left < right && rect.left + rect.width > left && rect.top < bottom && rect.top + rect.height > top) {
        visit(cell, rect);
      }
    }
  }
}
