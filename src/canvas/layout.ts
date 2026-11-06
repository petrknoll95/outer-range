import { ZOOM_NARROW, ZOOM_NARROW_HEIGHT, ZOOM_NARROW_WIDTH, CELLS_PER_VIEWPORT, LENS_REPEAT_SHARE, LONG, PITCH, RADIUS, S_MAX_PX, S_MIN_PX, ZOOM_IN_FILL, ZOOM_MAX } from './config';
import type { Cell, World } from './world';
import { emptyCell, tileSize } from './world';

/** Pixel geometry for one viewport size. */
export interface Geometry {
  vw: number;
  vh: number;
  /** Shared short edge, px. */
  s: number;
  /** Lattice pitch, px. */
  pitch: number;
  radius: number;
  /**
   * True when S is large enough that two copies of an image can never both be within the
   * span the sizing counted (`reach` viewports): the whole screen without the lens.
   */
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

/** How much world, in viewports per axis, the no-repeat sizing counts as visible under a lens with this reach. */
export function sizingReach(lensReach: number, share = LENS_REPEAT_SHARE): number {
  return 1 + share * (lensReach - 1);
}

/**
 * `reach` is how much world the viewport shows per axis, in viewports: 1 without the
 * lens, Lens.reach with it (the lens squeezes extra world in around the edges). The
 * no-repeat sizing counts all of it as visible.
 */
export function computeGeometry(vw: number, vh: number, world: World, reach = 1): Geometry {
  const byArea = Math.sqrt((vw * vh) / CELLS_PER_VIEWPORT) / PITCH;
  const span = noRepeatSpan(world);
  const seenX = vw * reach;
  const seenY = vh * reach;
  // A hair above the bound so rounding never lands exactly on it.
  const byRepeat = Math.max(seenX / span.x, seenY / span.y) * 1.02;
  const s = Math.min(S_MAX_PX, Math.max(S_MIN_PX, byArea, byRepeat));
  return {
    vw,
    vh,
    s,
    pitch: s * PITCH,
    radius: Math.round(s * RADIUS),
    noRepeatGuaranteed: s * span.x > seenX && s * span.y > seenY,
  };
}

/**
 * The zoomed-in zoom for a geometry: the longest a tile can be, LONG, fills ZOOM_IN_FILL of
 * the viewport's short side, unless images would go soft first (the on-screen short edge
 * in device pixels reaching `sharpEdge`) or ZOOM_MAX is reached. Never below 1. On a narrow
 * viewport, the most any of the images, by their `ratios` (width over height), zooms to (see zoomInFor).
 */
export function zoomInLevel(g: Geometry, dpr: number, sharpEdge: number, ratios: readonly number[]): number {
  const fill = (ZOOM_IN_FILL * Math.min(g.vw, g.vh)) / (LONG * g.s);
  if (g.vw < ZOOM_NARROW) {
    return ratios.reduce((most, ratio) => {
      const { w, h } = tileSize(ratio);
      return Math.max(most, zoomInFor(g, w * g.s, h * g.s, 1));
    }, 1);
  }
  return Math.max(1, Math.min(ZOOM_MAX, sharpEdge / (g.s * dpr), fill));
}

/**
 * The zoomed-in zoom for an image `width` × `height` world px at zoom 1. `level` is the
 * zoomed-in zoom (zoomInLevel): on a wide viewport every image shares it. On a narrow one the
 * image fills ZOOM_NARROW_WIDTH of the width, or ZOOM_NARROW_HEIGHT of the height if that's less.
 */
export function zoomInFor(g: Geometry, width: number, height: number, level: number): number {
  if (g.vw >= ZOOM_NARROW) return level;
  return Math.max(1, Math.min((ZOOM_NARROW_WIDTH * g.vw) / width, (ZOOM_NARROW_HEIGHT * g.vh) / height));
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
