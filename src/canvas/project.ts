import { LONG } from './config';
import type { CellRect, Geometry } from './layout';
import type { Aspect, World } from './world';

/**
 * The project view is the canvas, narrowed to one project: the cells nearest the focused
 * image show the rest of its project for a while (guests), and everything else fades away.
 * Each guest comes from where its image really is on the canvas, its nearest copy, so it
 * is seen crossing the canvas into place, and goes back there after.
 */
export interface Guest {
  /** The cell it shows in. */
  i: number;
  j: number;
  image: number;
  /** Its rectangle there, world px (at the cell's own lattice point, in the image's own shape). */
  to: CellRect;
  /** Where it comes from: its nearest copy's rectangle, or, with none near, one well off to the side in its direction. */
  from: CellRect;
  /** The cell of that copy, or null. */
  copy: { i: number; j: number } | null;
}

/** How far round the focused image to look for a copy of each guest, in cells. */
export const GUEST_SEARCH = 8;

const rectAt = (cx: number, cy: number, aspect: Aspect, s: number): CellRect => {
  const width = (aspect === 'landscape' ? LONG : 1) * s;
  const height = (aspect === 'portrait' ? LONG : 1) * s;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
};

/**
 * The guests for showing `others` (image indices) round the focused cell (fi, fj): one each,
 * in the cells nearest it (by distance between lattice points, so the cluster is round), every
 * cell used once. An image whose nearest copy is already one of those cells stays there and
 * doesn't move; the rest take the free cell nearest their copy, nearest copies first, so no
 * guest travels further than it must. `far` (world px) is how far off a guest with no copy
 * within GUEST_SEARCH cells comes from, beyond its cell, away from the focused one.
 */
export function projectGuests(
  world: World,
  g: Pick<Geometry, 's' | 'pitch'>,
  fi: number,
  fj: number,
  others: readonly number[],
  aspectOf: (image: number) => Aspect,
  far: number,
): Guest[] {
  const centre = (i: number, j: number) => {
    const c = world.cell(i, j);
    return { x: i * g.pitch + c.dx * g.s, y: j * g.pitch + c.dy * g.s };
  };
  const focus = centre(fi, fj);
  // The cells round the focused one, nearest first, as many as there are guests.
  const around: { i: number; j: number; x: number; y: number; d: number }[] = [];
  const reach = Math.ceil(Math.sqrt(others.length)) + 1;
  for (let i = fi - reach; i <= fi + reach; i++) {
    for (let j = fj - reach; j <= fj + reach; j++) {
      if (i === fi && j === fj) continue;
      const c = centre(i, j);
      around.push({ i, j, ...c, d: Math.hypot(c.x - focus.x, c.y - focus.y) });
    }
  }
  around.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const cells = around.slice(0, others.length);
  // Each guest's nearest copy on the canvas.
  const copies = others.map((image) => {
    let best: { i: number; j: number; d: number } | null = null;
    for (let i = fi - GUEST_SEARCH; i <= fi + GUEST_SEARCH; i++) {
      for (let j = fj - GUEST_SEARCH; j <= fj + GUEST_SEARCH; j++) {
        if (world.cell(i, j).image !== image) continue;
        const c = centre(i, j);
        const d = Math.hypot(c.x - focus.x, c.y - focus.y);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    return best;
  });
  const taken = new Set<number>();
  const at = new Map<number, (typeof cells)[number]>();
  // Already in one of the cells: it stays.
  others.forEach((_, k) => {
    const copy = copies[k];
    const n = copy ? cells.findIndex((c) => c.i === copy.i && c.j === copy.j) : -1;
    if (n >= 0 && !taken.has(n)) {
      taken.add(n);
      at.set(k, cells[n]!);
    }
  });
  // The rest, nearest copies first, each to the free cell nearest where it comes from.
  const rest = others.map((_, k) => k).filter((k) => !at.has(k));
  rest.sort((a, b) => (copies[a]?.d ?? Infinity) - (copies[b]?.d ?? Infinity) || a - b);
  for (const k of rest) {
    const copy = copies[k];
    const from = copy ? centre(copy.i, copy.j) : focus;
    let n = -1;
    cells.forEach((c, m) => {
      if (taken.has(m)) return;
      if (n < 0 || Math.hypot(c.x - from.x, c.y - from.y) < Math.hypot(cells[n]!.x - from.x, cells[n]!.y - from.y)) n = m;
    });
    taken.add(n);
    at.set(k, cells[n]!);
  }
  return others.map((image, k) => {
    const cell = at.get(k)!;
    const aspect = aspectOf(image);
    const copy = copies[k];
    let fromCentre: { x: number; y: number };
    if (copy) {
      fromCentre = centre(copy.i, copy.j);
    } else {
      const dx = cell.x - focus.x;
      const dy = cell.y - focus.y;
      const d = Math.hypot(dx, dy) || 1;
      fromCentre = { x: cell.x + (dx / d) * far, y: cell.y + (dy / d) * far };
    }
    return {
      i: cell.i,
      j: cell.j,
      image,
      to: rectAt(cell.x, cell.y, aspect, g.s),
      from: rectAt(fromCentre.x, fromCentre.y, aspect, g.s),
      copy: copy ? { i: copy.i, j: copy.j } : null,
    };
  });
}

/** The world rectangle round the focused image's rectangle and its guests'. */
export function clusterBounds(focused: CellRect, guests: readonly Guest[]): CellRect {
  let left = focused.left;
  let top = focused.top;
  let right = focused.left + focused.width;
  let bottom = focused.top + focused.height;
  for (const { to } of guests) {
    left = Math.min(left, to.left);
    top = Math.min(top, to.top);
    right = Math.max(right, to.left + to.width);
    bottom = Math.max(bottom, to.top + to.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}
