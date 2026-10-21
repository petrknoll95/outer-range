import { LEAD_MAX, LEAD_TIME, MARGIN, REBASE_DISTANCE } from './config';
import type { CellRange, Geometry } from './layout';
import { cellRange } from './layout';
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

interface Slot {
  el: HTMLDivElement;
  source: HTMLSourceElement;
  img: HTMLImageElement;
  label: HTMLSpanElement | null;
  key: number;
  i: number;
  j: number;
  image: number;
  left: number;
  top: number;
  width: number;
  height: number;
  frame: number;
  loaded: boolean;
  token: number;
}

// Cell keys pack (i, j) into one float64-safe integer; valid for |i|, |j| < 2^25.
const KEY_OFFSET = 2 ** 25;
const KEY_SCALE = 2 ** 26;
const cellKey = (i: number, j: number) => (i + KEY_OFFSET) * KEY_SCALE + (j + KEY_OFFSET);

const TILE_CLASS = 'absolute top-0 left-0 overflow-hidden rounded-(--tile-radius) [contain:strict]';
const IMG_CLASS =
  'block size-full object-cover select-none [-webkit-user-drag:none] transition-opacity duration-[240ms] ease-out data-loading:opacity-0 data-loading:transition-none motion-reduce:transition-none';

/**
 * Keeps a pool of tile elements on the cells around the viewport.
 *
 * Tiles never move in the DOM. They sit at fixed positions inside one layer relative to
 * a floating origin near the camera, so every number written to CSS stays small however
 * far the camera travels. Each frame writes a single transform (the layer's). Tiles are
 * only reassigned when the set of cells in range changes.
 */
export class Renderer {
  private readonly slots: Slot[] = [];
  private readonly active: Slot[] = [];
  private readonly free: Slot[] = [];
  private readonly byKey = new Map<number, Slot>();
  private readonly cell: Cell = emptyCell();
  private readonly range: CellRange = { i0: 0, i1: -1, j0: 0, j1: -1 };
  private lastRange = { i0: 0, i1: -1, j0: 0, j1: -1 };
  private geometry: Geometry | null = null;
  private dirty = true;
  private frame = 0;
  private originX = 0;
  private originY = 0;
  private layerX = Number.NaN;
  private layerY = Number.NaN;
  private camX = 0;
  private camY = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly layer: HTMLElement,
    private readonly world: World,
    private readonly images: readonly ClientImage[],
    private readonly debug = false,
  ) {}

  setGeometry(g: Geometry): void {
    this.geometry = g;
    this.root.style.setProperty('--tile-radius', `${g.radius}px`);
    this.dirty = true;
  }

  /** Draw the camera at (camX, camY), preloading in the direction of (vx, vy) px/s. */
  update(camX: number, camY: number, vx: number, vy: number): void {
    const g = this.geometry;
    if (!g) return;
    this.camX = camX;
    this.camY = camY;

    // The origin is a pure function of the camera, so the same camera position always
    // produces the same CSS numbers and the same pixels, however it was reached.
    const originX = Math.round(camX / REBASE_DISTANCE) * REBASE_DISTANCE;
    const originY = Math.round(camY / REBASE_DISTANCE) * REBASE_DISTANCE;
    if (originX !== this.originX || originY !== this.originY) {
      this.originX = originX;
      this.originY = originY;
      for (const slot of this.active) this.place(slot);
    }
    const lx = this.originX - camX;
    const ly = this.originY - camY;
    if (lx !== this.layerX || ly !== this.layerY) {
      this.layerX = lx;
      this.layerY = ly;
      this.layer.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
    }

    const margin = MARGIN * g.pitch;
    const leadCap = LEAD_MAX * g.pitch;
    const leadX = Math.max(-leadCap, Math.min(leadCap, vx * LEAD_TIME));
    const leadY = Math.max(-leadCap, Math.min(leadCap, vy * LEAD_TIME));
    const range = cellRange(
      this.world,
      g,
      camX - margin + Math.min(leadX, 0),
      camY - margin + Math.min(leadY, 0),
      camX + g.vw + margin + Math.max(leadX, 0),
      camY + g.vh + margin + Math.max(leadY, 0),
      this.range,
    );
    const last = this.lastRange;
    if (!this.dirty && range.i0 === last.i0 && range.i1 === last.i1 && range.j0 === last.j0 && range.j1 === last.j1) return;
    last.i0 = range.i0;
    last.i1 = range.i1;
    last.j0 = range.j0;
    last.j1 = range.j1;
    const relayout = this.dirty;
    this.dirty = false;
    this.frame++;

    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) {
        const key = cellKey(i, j);
        let slot = this.byKey.get(key);
        if (!slot) {
          slot = this.acquire(key);
          this.assign(slot, key, i, j);
        } else if (relayout) {
          this.assign(slot, key, i, j);
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

  /** Forces every tile to be re-laid out on the next update (geometry or DPR changed). */
  invalidate(): void {
    this.dirty = true;
  }

  get poolSize(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    return this.active.length;
  }

  /** True when every tile that intersects the viewport has its image decoded and shown. */
  visibleLoaded(): boolean {
    const g = this.geometry;
    if (!g) return false;
    for (const slot of this.active) {
      if (slot.loaded) continue;
      const left = slot.left - this.camX;
      const top = slot.top - this.camY;
      if (left < g.vw && left + slot.width > 0 && top < g.vh && top + slot.height > 0) return false;
    }
    return true;
  }

  /** Cells currently on screen, for tests and the debug overlay. */
  visibleCells(): { i: number; j: number; image: number; left: number; top: number; width: number; height: number }[] {
    const g = this.geometry;
    if (!g) return [];
    return this.active
      .map((s) => ({ i: s.i, j: s.j, image: s.image, left: s.left - this.camX, top: s.top - this.camY, width: s.width, height: s.height }))
      .filter((c) => c.left < g.vw && c.left + c.width > 0 && c.top < g.vh && c.top + c.height > 0);
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
    const slot: Slot = { el, source, img, label, key: -1, i: 0, j: 0, image: -1, left: 0, top: 0, width: 0, height: 0, frame: 0, loaded: false, token: 0 };
    this.slots.push(slot);
    return slot;
  }

  private assign(slot: Slot, key: number, i: number, j: number): void {
    const g = this.geometry!;
    const cell = this.world.cell(i, j, this.cell);
    const width = cell.w * g.s;
    const height = cell.h * g.s;
    slot.left = i * g.pitch + cell.dx * g.s - width / 2;
    slot.top = j * g.pitch + cell.dy * g.s - height / 2;
    slot.i = i;
    slot.j = j;
    slot.key = key;
    if (width !== slot.width || height !== slot.height) {
      slot.width = width;
      slot.height = height;
      slot.el.style.width = `${width}px`;
      slot.el.style.height = `${height}px`;
      const sizes = `${Math.round(width)}px`;
      slot.source.sizes = sizes;
      slot.img.sizes = sizes;
    }
    slot.el.style.zIndex = String(cell.z);
    this.place(slot);
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

  private place(slot: Slot): void {
    slot.el.style.transform = `translate3d(${slot.left - this.originX}px, ${slot.top - this.originY}px, 0)`;
  }
}
