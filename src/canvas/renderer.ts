import { LEAD_MAX, LEAD_TIME, MARGIN, RELAYOUT_RATIO, TRAIL_MAX_OFFSET } from './config';
import { hash, unit } from './hash';
import type { CellRange, Geometry } from './layout';
import { cellRange } from './layout';
import type { Lens, LensPoint } from './lens';
import type { Trail } from './trail';
import { limitOffset, placeTrail, restingTrail, stepTrail, trailLag } from './trail';
import type { Cell, World, WorldImage } from './world';
import { emptyCell } from './world';

/** One image as delivered by the page: build-time variants plus a placeholder colour. */
export interface ClientImage extends WorldImage {
  color: string;
  /** srcset strings with width descriptors. */
  avif: string;
  webp: string;
  /** Fallback src (smallest WebP). */
  src: string;
}

/** Everything the page hands the canvas. */
export interface CanvasData {
  /** Source short edge, px, that three quarters of the images reach; bounds zooming in. */
  sharpEdge: number;
  images: ClientImage[];
}

interface Slot {
  el: HTMLDivElement;
  source: HTMLSourceElement;
  img: HTMLImageElement;
  label: HTMLSpanElement | null;
  key: number;
  i: number;
  j: number;
  image: number;
  /** Image rectangle in world px at zoom 1. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** This image's own share of the trail lag, in [0, 1). */
  weight: number;
  lag: number;
  trail: Trail;
  frame: number;
  loaded: boolean;
  token: number;
  /** Last values written to CSS, to skip redundant writes. */
  cssX: number;
  cssY: number;
  cssScale: number;
}

// Cell keys pack (i, j) into one float64-safe integer; valid for |i|, |j| < 2^25.
const KEY_OFFSET = 2 ** 25;
const KEY_SCALE = 2 ** 26;
const cellKey = (i: number, j: number) => (i + KEY_OFFSET) * KEY_SCALE + (j + KEY_OFFSET);
const SALT_WEIGHT = 7;

const TILE_CLASS =
  'absolute top-0 left-0 origin-top-left overflow-hidden rounded-(--tile-radius) will-change-transform [contain:strict]';
const IMG_CLASS =
  'block size-full object-cover select-none [-webkit-user-drag:none] transition-opacity duration-[240ms] ease-out data-loading:opacity-0 data-loading:transition-none motion-reduce:transition-none';

/**
 * Keeps a pool of tile elements on the cells around the viewport.
 *
 * Tiles are positioned in screen space: the renderer computes (world − camera)·zoom in
 * doubles and writes only that small number, so precision never degrades however far
 * the camera travels. Each tile adds its own trail offset (see trail.ts), so the images
 * move as a loose sheet rather than one rigid layer.
 *
 * Zoom: tiles are laid out (sized in CSS) at a layout zoom and scaled by
 * zoom / layoutZoom. They are laid out again at the current zoom when it settles or has
 * drifted by RELAYOUT_RATIO, so they are re-rasterised sharp and pick a fitting variant.
 *
 * Lens: last of all, each tile's centre goes through the lens (lens.ts), which pulls it
 * towards the viewport centre and scales the tile down near the edges. Because the lens
 * squeezes extra world into the viewport, cells are loaded out to `lens.reach`.
 */
export class Renderer {
  private readonly slots: Slot[] = [];
  private readonly active: Slot[] = [];
  private readonly free: Slot[] = [];
  private readonly byKey = new Map<number, Slot>();
  private readonly cell: Cell = emptyCell();
  private readonly range: CellRange = { i0: 0, i1: -1, j0: 0, j1: -1 };
  private readonly lastRange: CellRange = { i0: 0, i1: -1, j0: 0, j1: -1 };
  private readonly offset = { x: 0, y: 0 };
  private readonly lensed: LensPoint = { x: 0, y: 0, scale: 1 };
  private geometry: Geometry | null = null;
  private dirty = true;
  private frame = 0;
  private layoutZoom = 1;
  private camX = 0;
  private camY = 0;
  private camZ = 1;
  private stepX = Number.NaN;
  private stepY = Number.NaN;
  private stepZ = Number.NaN;
  private focusX = 0;
  private focusY = 0;
  private trails = true;
  private resetTrails = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly world: World,
    private readonly images: readonly ClientImage[],
    private readonly lens: Lens,
    private readonly debug = false,
  ) {}

  setGeometry(g: Geometry): void {
    this.geometry = g;
    this.focusX = g.vw / 2;
    this.focusY = g.vh / 2;
    this.dirty = true;
    // S changed, so every grid position moves; restart trails there instead of springing across.
    this.resetTrails = true;
  }

  /** Where the pointer is, screen px; images near it trail least. */
  setFocus(x: number, y: number): void {
    this.focusX = x;
    this.focusY = y;
  }

  setTrails(on: boolean): void {
    this.trails = on;
    for (const slot of this.active) this.restTrail(slot);
  }

  /** Advance every image's trail by one physics step to camera (x, y, z). */
  step(x: number, y: number, z: number, h: number): void {
    const g = this.geometry;
    if (!g || !this.trails) return;
    const moving = x !== this.stepX || y !== this.stepY || z !== this.stepZ;
    this.stepX = x;
    this.stepY = y;
    this.stepZ = z;
    if (!moving && this.isAtRest()) return;
    const diagonal = Math.hypot(g.vw, g.vh);
    for (const slot of this.active) {
      const gx = (slot.left - x) * z;
      const gy = (slot.top - y) * z;
      const cx = gx + (slot.width * z) / 2 - this.focusX;
      const cy = gy + (slot.height * z) / 2 - this.focusY;
      slot.lag = trailLag(Math.hypot(cx, cy), diagonal, slot.weight);
      stepTrail(slot.trail, gx, gy, slot.lag, h, moving);
    }
  }

  /**
   * Draw the camera at (camX, camY, camZ). (vx, vy) is its velocity in world px/s, used
   * to preload ahead and to start new tiles already trailing. `zoomAtRest` lets tiles be
   * re-laid out sharp at the final zoom.
   */
  update(camX: number, camY: number, camZ: number, vx: number, vy: number, zoomAtRest: boolean): void {
    const g = this.geometry;
    if (!g) return;
    this.camX = camX;
    this.camY = camY;
    this.camZ = camZ;

    const drift = Math.abs(Math.log(camZ / this.layoutZoom));
    if ((zoomAtRest && camZ !== this.layoutZoom) || drift > Math.log(RELAYOUT_RATIO)) {
      this.layoutZoom = camZ;
      this.dirty = true;
    }

    const margin = MARGIN * g.pitch;
    const leadCap = LEAD_MAX * g.pitch;
    const leadX = Math.max(-leadCap, Math.min(leadCap, vx * LEAD_TIME));
    const leadY = Math.max(-leadCap, Math.min(leadCap, vy * LEAD_TIME));
    // The world the lens squeezes into the viewport, around the world point at its centre.
    const hx = g.vw / 2;
    const hy = g.vh / 2;
    const centreX = camX + hx / camZ;
    const centreY = camY + hy / camZ;
    const reachX = (hx * this.lens.reach) / camZ;
    const reachY = (hy * this.lens.reach) / camZ;
    const range = cellRange(
      this.world,
      g,
      centreX - reachX - margin + Math.min(leadX, 0),
      centreY - reachY - margin + Math.min(leadY, 0),
      centreX + reachX + margin + Math.max(leadX, 0),
      centreY + reachY + margin + Math.max(leadY, 0),
      this.range,
    );
    const last = this.lastRange;
    if (this.dirty || range.i0 !== last.i0 || range.i1 !== last.i1 || range.j0 !== last.j0 || range.j1 !== last.j1) {
      this.reassign(range, vx, vy);
    }

    const zoomScale = camZ / this.layoutZoom;
    const maxOffset = TRAIL_MAX_OFFSET * g.s * camZ;
    const lensed = this.lensed;
    for (const slot of this.active) {
      limitOffset(slot.trail.ox, slot.trail.oy, maxOffset, this.offset);
      const w = slot.width * camZ;
      const h = slot.height * camZ;
      // Centre on screen (grid + trail), relative to the viewport centre, then the lens.
      const qx = (slot.left - camX) * camZ + this.offset.x + w / 2 - hx;
      const qy = (slot.top - camY) * camZ + this.offset.y + h / 2 - hy;
      this.lens.apply(qx, qy, hx, hy, lensed, w / 2, h / 2);
      // Tiles scale about their top-left corner, so place that corner for the lensed size.
      const x = hx + lensed.x - (w * lensed.scale) / 2;
      const y = hy + lensed.y - (h * lensed.scale) / 2;
      const scale = zoomScale * lensed.scale;
      if (x === slot.cssX && y === slot.cssY && scale === slot.cssScale) continue;
      slot.cssX = x;
      slot.cssY = y;
      slot.cssScale = scale;
      slot.el.style.transform = scale === 1 ? `translate3d(${x}px, ${y}px, 0)` : `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    }
  }

  /** True when no image is still trailing. */
  isAtRest(): boolean {
    for (const slot of this.active) if (!slot.trail.resting) return false;
    return true;
  }

  get poolSize(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    return this.active.length;
  }

  get zoomLaidOut(): number {
    return this.layoutZoom;
  }

  /** True when every tile that intersects the viewport has its image decoded and shown. */
  visibleLoaded(): boolean {
    for (const c of this.visibleCells()) if (!this.byKey.get(cellKey(c.i, c.j))!.loaded) return false;
    return true;
  }

  /**
   * Cells currently on screen with their screen rectangles and lens scale (trail offsets
   * excluded), for tests and debugging.
   */
  visibleCells(): { i: number; j: number; image: number; left: number; top: number; width: number; height: number; scale: number }[] {
    const g = this.geometry;
    if (!g) return [];
    const z = this.camZ;
    const hx = g.vw / 2;
    const hy = g.vh / 2;
    const p: LensPoint = { x: 0, y: 0, scale: 1 };
    return this.active
      .map((s) => {
        const w = s.width * z;
        const h = s.height * z;
        this.lens.apply((s.left - this.camX) * z + w / 2 - hx, (s.top - this.camY) * z + h / 2 - hy, hx, hy, p, w / 2, h / 2);
        return {
          i: s.i,
          j: s.j,
          image: s.image,
          left: hx + p.x - (w * p.scale) / 2,
          top: hy + p.y - (h * p.scale) / 2,
          width: w * p.scale,
          height: h * p.scale,
          scale: p.scale,
        };
      })
      .filter((c) => c.left < g.vw && c.left + c.width > 0 && c.top < g.vh && c.top + c.height > 0);
  }

  /** Trail offsets of the tiles on screen, for tests. */
  trailOffsets(): { i: number; j: number; x: number; y: number }[] {
    const on = new Set(this.visibleCells().map((c) => cellKey(c.i, c.j)));
    return this.active.filter((s) => on.has(s.key)).map((s) => ({ i: s.i, j: s.j, x: s.trail.ox, y: s.trail.oy }));
  }

  private reassign(range: CellRange, vx: number, vy: number): void {
    const last = this.lastRange;
    last.i0 = range.i0;
    last.i1 = range.i1;
    last.j0 = range.j0;
    last.j1 = range.j1;
    const relayout = this.dirty;
    const resetTrails = this.resetTrails;
    this.dirty = false;
    this.resetTrails = false;
    this.frame++;
    if (relayout) {
      this.root.style.setProperty('--tile-radius', `${this.geometry!.radius * this.layoutZoom}px`);
    }
    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) {
        const key = cellKey(i, j);
        let slot = this.byKey.get(key);
        if (!slot) {
          slot = this.acquire(key);
          this.assign(slot, key, i, j, true, vx, vy);
        } else if (relayout) {
          this.assign(slot, key, i, j, false, vx, vy);
          if (resetTrails) this.restTrail(slot);
        }
        slot.frame = this.frame;
      }
    }
    for (let n = this.active.length - 1; n >= 0; n--) {
      const slot = this.active[n]!;
      if (slot.frame === this.frame) continue;
      this.active[n] = this.active[this.active.length - 1]!;
      this.active.pop();
      this.byKey.delete(slot.key);
      slot.el.hidden = true;
      this.free.push(slot);
    }
  }

  /** Put an image's trail at rest on its current grid position. */
  private restTrail(slot: Slot): void {
    placeTrail(slot.trail, (slot.left - this.camX) * this.camZ, (slot.top - this.camY) * this.camZ, 0, 0, 0);
  }

  private acquire(key: number): Slot {
    // Prefer the tile that last showed this cell (panning back and forth over an edge), then the oldest free one.
    let index = this.free.findIndex((s) => s.key === key);
    if (index < 0 && this.free.length) index = 0;
    const slot = index >= 0 ? this.free.splice(index, 1)[0]! : this.create();
    slot.el.hidden = false;
    this.active.push(slot);
    this.byKey.set(key, slot);
    return slot;
  }

  private create(): Slot {
    const el = document.createElement('div');
    el.className = TILE_CLASS;
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.type = 'image/avif';
    const img = document.createElement('img');
    img.className = IMG_CLASS;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    picture.append(source, img);
    el.append(picture);
    let label: HTMLSpanElement | null = null;
    if (this.debug) {
      label = document.createElement('span');
      label.className = 'absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] leading-4 text-white';
      el.append(label);
    }
    this.layer.append(el);
    const slot: Slot = {
      el,
      source,
      img,
      label,
      key: -1,
      i: 0,
      j: 0,
      image: -1,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      weight: 0,
      lag: 0,
      trail: restingTrail(),
      frame: 0,
      loaded: false,
      token: 0,
      cssX: Number.NaN,
      cssY: Number.NaN,
      cssScale: Number.NaN,
    };
    this.slots.push(slot);
    return slot;
  }

  private assign(slot: Slot, key: number, i: number, j: number, fresh: boolean, vx: number, vy: number): void {
    const g = this.geometry!;
    const cell = this.world.cell(i, j, this.cell);
    const width = cell.w * g.s;
    const height = cell.h * g.s;
    slot.left = i * g.pitch + cell.dx * g.s - width / 2;
    slot.top = j * g.pitch + cell.dy * g.s - height / 2;
    slot.i = i;
    slot.j = j;
    slot.key = key;
    slot.width = width;
    slot.height = height;
    const cssWidth = Math.round(width * this.layoutZoom * 100) / 100;
    const cssHeight = Math.round(height * this.layoutZoom * 100) / 100;
    slot.el.style.width = `${cssWidth}px`;
    slot.el.style.height = `${cssHeight}px`;
    const sizes = `${Math.round(cssWidth)}px`;
    if (slot.img.sizes !== sizes) {
      slot.source.sizes = sizes;
      slot.img.sizes = sizes;
    }
    slot.el.style.zIndex = String(cell.z);
    slot.cssScale = Number.NaN;
    if (fresh) {
      slot.weight = unit(hash(i, j, this.world.seed, SALT_WEIGHT));
      if (this.trails) {
        // Start already trailing as its neighbours do, so a tile entering mid-fling never pops.
        const z = this.camZ;
        const gx = (slot.left - this.camX) * z;
        const gy = (slot.top - this.camY) * z;
        const diagonal = Math.hypot(g.vw, g.vh);
        const cx = gx + (width * z) / 2 - this.focusX;
        const cy = gy + (height * z) / 2 - this.focusY;
        slot.lag = trailLag(Math.hypot(cx, cy), diagonal, slot.weight);
        placeTrail(slot.trail, gx, gy, -vx * z, -vy * z, slot.lag);
      } else {
        placeTrail(slot.trail, 0, 0, 0, 0, 0);
      }
    }
    if (slot.label) slot.label.textContent = `${i},${j} #${cell.image}`;
    if (slot.image === cell.image) return;

    const image = this.images[cell.image]!;
    slot.image = cell.image;
    slot.loaded = false;
    slot.el.style.backgroundColor = image.color;
    slot.img.dataset.loading = '';
    slot.source.srcset = image.avif;
    slot.img.srcset = image.webp;
    slot.img.src = image.src;
    const token = ++slot.token;
    const reveal = () => {
      if (slot.token !== token) return;
      slot.loaded = true;
      delete slot.img.dataset.loading;
    };
    slot.img.decode().then(reveal, reveal);
  }
}
