import {
  ACTIVE_SWITCH_MARGIN,
  FADE_OPACITY,
  FADE_TAU,
  LEAD_MAX,
  LEAD_TIME,
  MARGIN,
  RELAYOUT_RATIO,
  TRAIL_DIRECTION_MIN_SPEED,
  TRAIL_LAG_TAU,
  TRAIL_MAX_OFFSET,
  VIDEO_SMALL_EDGE,
} from './config';
import type { FlightView } from './flight';
import { flightDepth, flightView } from './flight';
import { hash, unit } from './hash';
import type { CellRange, CellRect, Geometry } from './layout';
import { cellRange } from './layout';
import type { Lens, LensPoint } from './lens';
import type { Trail } from './trail';
import { easeLag, limitOffset, placeTrail, restingTrail, stepTrail, taperedLag, taperWeight, zoomTaperWeight } from './trail';
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
  /** A video to play over the image (its poster frame), or none: URLs of its copies (VideoCopies in media.ts). */
  video?: { webm: string; mp4: string; smallWebm: string; smallMp4: string };
  /** From the image's content entry: shown under the focused view, and the alt text set on every tile. */
  title: string;
  category: string;
  alt: string;
}

/** Everything the page hands the canvas. */
export interface CanvasData {
  /** Source short edge, px, that three quarters of the images reach; bounds zooming in. */
  sharpEdge: number;
  images: ClientImage[];
}

/** The active image: which cell it is and where it is drawn (screen px, lens and trail included). */
export interface ActiveImage {
  i: number;
  j: number;
  image: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The camera after one physics step, as the image trails need it. */
export interface CameraStep {
  x: number;
  y: number;
  z: number;
  /** Pan part of the camera's velocity, world px/s (zero during a pure zoom). */
  panVx: number;
  panVy: number;
  zooming: boolean;
  /** Zoom anchor, canvas px. */
  anchorX: number;
  anchorY: number;
  /** How far zoomed in, 0 (out) to 1 (in): fades every image but the active one. */
  focus: number;
}

interface Slot {
  el: HTMLDivElement;
  source: HTMLSourceElement;
  img: HTMLImageElement;
  /** Made the first time the tile shows a video, then kept (empty) for the next; and what it plays. */
  video: HTMLVideoElement | null;
  videoSrc: string | null;
  /** On screen, as the IntersectionObserver last reported. */
  visible: boolean;
  label: HTMLSpanElement | null;
  key: number;
  i: number;
  j: number;
  image: number;
  /** The zoom it is laid out (sized in CSS, so rasterised) at; drawn scaled by zoom / layout. */
  layout: number;
  /** Image rectangle in world px at zoom 1. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** This image's own share of the trail lag, in [0, 1). */
  weight: number;
  lag: number;
  trail: Trail;
  loaded: boolean;
  token: number;
  /** Last values written to CSS, to skip redundant writes. */
  cssX: number;
  cssY: number;
  cssScale: number;
  /** Drawn size, screen px, and distance from the drawn centre to the viewport centre. */
  drawnWidth: number;
  drawnHeight: number;
  distance: number;
  /** Opacity now, and the last value written to CSS. */
  opacity: number;
  cssOpacity: number;
}

// Cell keys pack (i, j) into one float64-safe integer; valid for |i|, |j| < 2^25.
const KEY_OFFSET = 2 ** 25;
const KEY_SCALE = 2 ** 26;
const cellKey = (i: number, j: number) => (i + KEY_OFFSET) * KEY_SCALE + (j + KEY_OFFSET);
const SALT_WEIGHT = 7;

/** A tile's CSS transform: its top-left corner at (x, y) screen px, scaled about it. */
const transform = (x: number, y: number, scale: number) => (scale === 1 ? `translate3d(${x}px, ${y}px, 0)` : `translate3d(${x}px, ${y}px, 0) scale(${scale})`);

const TILE_CLASS =
  'absolute top-0 left-0 origin-top-left overflow-hidden will-change-transform [contain:strict]';
const IMG_CLASS =
  'block size-full object-cover select-none [-webkit-user-drag:none] transition-opacity duration-[240ms] ease-out data-loading:opacity-0 data-loading:transition-none motion-reduce:transition-none';
// Over the image (its poster frame), shown once it is actually playing so it never flashes black.
const VIDEO_CLASS =
  'pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-[240ms] ease-out data-waiting:opacity-0 data-waiting:transition-none motion-reduce:transition-none';
/** VIDEO_CLASS's fade in, ms. */
const VIDEO_FADE = 240;

/**
 * Keeps a pool of tile elements on the cells around the viewport.
 *
 * Tiles are positioned in screen space: the renderer computes (world − camera)·zoom in
 * doubles and writes only that small number, so precision never degrades however far
 * the camera travels. Each tile adds its own trail offset (see trail.ts), so the images
 * move as a loose sheet rather than one rigid layer.
 *
 * Zoom: each tile is laid out (sized in CSS) at a layout zoom and scaled by zoom / layout.
 * Tiles are laid out again at the current zoom when it settles or has drifted by
 * RELAYOUT_RATIO, so they are re-rasterised sharp and pick a fitting variant; never while
 * a zoom-to is in flight, for which the tile it zooms into is laid out ahead (prepare).
 *
 * Lens: last of all, each tile's centre goes through the lens (lens.ts), which pulls it
 * towards the viewport centre and scales the tile down near the edges. Because the lens
 * squeezes extra world into the viewport, cells are loaded out to `lens.reach`.
 *
 * Video: a video's tile is an image tile (its poster frame) with the video playing over it,
 * muted and looping. It plays only while the tile is on screen and videos are on (setVideos):
 * off screen, or with videos off, it holds its frame and downloads nothing more. A tile laid
 * out small plays the small copy, and swaps to the full one (at the same moment) when it is
 * laid out large, as the one zoomed into is.
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
  private layoutZoom = 1;
  /** Mid zoom-to: no tile is laid out again until it lands (see update). */
  private holding = false;
  private camX = 0;
  private camY = 0;
  private camZ = 1;
  private stepX = Number.NaN;
  private stepY = Number.NaN;
  private stepZ = Number.NaN;
  /** On-screen velocity of the images (opposite to the camera's), px/s, and its last clear direction. */
  private motionX = 0;
  private motionY = 0;
  private dirX = 1;
  private dirY = 0;
  private zooming = false;
  private anchorX = 0;
  private anchorY = 0;
  private trails = true;
  private resetTrails = false;
  private activeSlot: Slot | null = null;
  private focus = 0;
  /** Called with the active image's tile element whenever another image becomes active. */
  onActiveChange: ((tile: HTMLElement | null) => void) | null = null;
  /** Called when a tile element is about to be reused for another image. */
  onRelease: ((tile: HTMLElement) => void) | null = null;
  /** The flight out of the canvas (flight.ts), or null: each on-screen tile as drawn when it began. */
  private flight: { slot: Slot; x: number; y: number; scale: number; opacity: number; depth: number }[] | null = null;
  private readonly view: FlightView = { scale: 1, opacity: 1, blur: 0 };
  private videos = true;
  private readonly slotOf = new Map<Element, Slot>();
  private readonly visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const slot = this.slotOf.get(entry.target)!;
      slot.visible = entry.isIntersecting;
      this.syncVideo(slot);
    }
  });

  constructor(
    private readonly container: HTMLElement,
    private readonly world: World,
    private readonly images: readonly ClientImage[],
    private readonly lens: Lens,
    private readonly debug = false,
  ) {}

  /** Whether this browser plays VP9 WebM; if not, videos play from their MP4 copies. */
  private readonly webm = document.createElement('video').canPlayType('video/webm; codecs="vp9"') === 'probably';

  setGeometry(g: Geometry): void {
    this.geometry = g;
    this.dirty = true;
    // S changed, so every grid position moves; restart trails there instead of springing across.
    this.resetTrails = true;
  }

  /** Let videos play (on screen), or hold every one on its frame. */
  setVideos(on: boolean): void {
    if (on === this.videos) return;
    this.videos = on;
    for (const slot of this.active) this.syncVideo(slot);
  }

  /** Play a tile's video if it has one, is on screen and videos are on; otherwise hold it. */
  private syncVideo(slot: Slot): void {
    const video = slot.video;
    if (!video?.src) return;
    if (this.videos && slot.visible && !slot.el.hidden) {
      if (video.paused) video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  }

  setTrails(on: boolean): void {
    this.trails = on;
    for (const slot of this.active) this.restTrail(slot);
  }

  /** Advance every image's trail and fade by one physics step. */
  step(cam: CameraStep, h: number): void {
    const g = this.geometry;
    if (!g) return;
    this.focus = cam.focus;
    // Zoomed in, the active image stays opaque and the rest fade; reduced motion skips the easing.
    const fade = this.trails ? 1 - Math.exp(-h / FADE_TAU) : 1;
    for (const slot of this.active) {
      const target = this.opacityTarget(slot);
      slot.opacity = Math.abs(target - slot.opacity) < 0.002 ? target : slot.opacity + (target - slot.opacity) * fade;
    }
    if (!this.trails) return;
    const { x, y, z } = cam;
    const moving = x !== this.stepX || y !== this.stepY || z !== this.stepZ;
    this.stepX = x;
    this.stepY = y;
    this.stepZ = z;
    this.motionX = -cam.panVx * z;
    this.motionY = -cam.panVy * z;
    const speed = Math.hypot(this.motionX, this.motionY);
    if (speed > TRAIL_DIRECTION_MIN_SPEED) {
      this.dirX = this.motionX / speed;
      this.dirY = this.motionY / speed;
    }
    this.zooming = cam.zooming;
    this.anchorX = cam.anchorX;
    this.anchorY = cam.anchorY;
    if (!moving && this.isAtRest()) return;
    for (const slot of this.active) {
      const gx = (slot.left - x) * z;
      const gy = (slot.top - y) * z;
      const target = this.lagFor(slot, gx, gy, z);
      // A resting image takes its new lag at once; a moving one eases into it.
      slot.lag = slot.trail.resting ? target : easeLag(slot.lag, target, h, TRAIL_LAG_TAU);
      stepTrail(slot.trail, gx, gy, slot.lag, h, moving);
    }
  }

  /**
   * Draw the camera at (camX, camY, camZ). (vx, vy) is its velocity in world px/s, used
   * to preload ahead. `zoomAtRest` lets tiles be re-laid out sharp at the final zoom.
   * `holdLayout` (a zoom-to in flight) lays nothing out again until it lands: re-laying
   * out every tile mid-zoom costs frames and swaps their images for sharper ones mid-move.
   * The tile it zooms into is laid out for where it lands beforehand (see prepare).
   */
  update(camX: number, camY: number, camZ: number, vx: number, vy: number, zoomAtRest: boolean, holdLayout = false): void {
    const g = this.geometry;
    if (!g) return;
    this.camX = camX;
    this.camY = camY;
    this.camZ = camZ;
    this.holding = holdLayout;

    const drift = Math.abs(Math.log(camZ / this.layoutZoom));
    if (!holdLayout && ((zoomAtRest && camZ !== this.layoutZoom) || drift > Math.log(RELAYOUT_RATIO))) {
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
      this.reassign(range);
    }

    const maxOffset = TRAIL_MAX_OFFSET * g.s * camZ;
    const lensed = this.lensed;
    let nearest: Slot | null = null;
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
      const scale = (camZ / slot.layout) * lensed.scale;
      slot.drawnWidth = w * lensed.scale;
      slot.drawnHeight = h * lensed.scale;
      slot.distance = Math.hypot(lensed.x, lensed.y);
      if (!nearest || slot.distance < nearest.distance) nearest = slot;
      if (slot.opacity !== slot.cssOpacity) {
        slot.cssOpacity = slot.opacity;
        slot.el.style.opacity = slot.opacity === 1 ? '' : slot.opacity.toFixed(3);
      }
      if (x === slot.cssX && y === slot.cssY && scale === slot.cssScale) continue;
      slot.cssX = x;
      slot.cssY = y;
      slot.cssScale = scale;
      slot.el.style.transform = transform(x, y, scale);
    }
    // The centremost image is active; keep the current one unless another is clearly closer.
    const current = this.activeSlot;
    if (!current || current.key < 0 || !this.byKey.has(current.key) || (nearest && nearest.distance < current.distance - ACTIVE_SWITCH_MARGIN)) {
      this.setActive(nearest);
    }
  }

  /**
   * Start the flight out of the canvas (flight.ts) from the tiles as drawn now. Until
   * endFlight(), draw with drawFlight() instead of step() and update().
   */
  beginFlight(): void {
    const g = this.geometry;
    if (!g) return;
    this.flight = [];
    for (const slot of this.active) {
      // Off screen a tile only flies further off; leave it.
      if (slot.cssX > g.vw || slot.cssY > g.vh || slot.cssX + slot.drawnWidth < 0 || slot.cssY + slot.drawnHeight < 0) continue;
      const depth = flightDepth(slot.i, slot.j, this.world.seed);
      this.flight.push({ slot, x: slot.cssX, y: slot.cssY, scale: slot.cssScale, opacity: slot.cssOpacity, depth });
    }
  }

  /** Draw the flight with the camera `travel` in (see flightTravel). `still`: fade only, nothing moves (reduced motion). */
  drawFlight(travel: number, still = false): void {
    const g = this.geometry;
    if (!this.flight || !g) return;
    // The vanishing point is the viewport centre: each tile's corner moves away from it as much as the tile grows.
    const cx = g.vw / 2;
    const cy = g.vh / 2;
    for (const f of this.flight) {
      const v = flightView(f.depth, travel, this.view);
      const s = still ? 1 : v.scale;
      f.slot.el.style.transform = transform(cx + (f.x - cx) * s, cy + (f.y - cy) * s, f.scale * s);
      f.slot.el.style.opacity = (f.opacity * v.opacity).toFixed(3);
      // The blur is drawn before the tile is scaled: ask for the share that comes out at v.blur on screen.
      const blur = still ? 0 : v.blur / (f.scale * s);
      f.slot.el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
    }
  }

  /** End the flight: every tile as it was drawn when it began. */
  endFlight(): void {
    if (!this.flight) return;
    for (const { slot } of this.flight) {
      slot.el.style.filter = '';
      slot.el.style.transform = transform(slot.cssX, slot.cssY, slot.cssScale);
      slot.el.style.opacity = slot.cssOpacity === 1 ? '' : slot.cssOpacity.toFixed(3);
    }
    this.flight = null;
  }

  /** The active image: the one drawn nearest the viewport centre (see ACTIVE_SWITCH_MARGIN). */
  activeImage(): ActiveImage | null {
    const slot = this.activeSlot;
    if (!slot) return null;
    return { i: slot.i, j: slot.j, image: slot.image, left: slot.cssX, top: slot.cssY, width: slot.drawnWidth, height: slot.drawnHeight };
  }

  private setActive(slot: Slot | null): void {
    if (slot === this.activeSlot) return;
    this.activeSlot = slot;
    this.onActiveChange?.(slot?.el ?? null);
  }

  /** True when no image is still trailing or fading. */
  isAtRest(): boolean {
    for (const slot of this.active) if (!slot.trail.resting || slot.opacity !== this.opacityTarget(slot)) return false;
    return true;
  }

  /** The active image's grid rectangle, world px. */
  activeRect(): CellRect | null {
    const s = this.activeSlot;
    return s ? { left: s.left, top: s.top, width: s.width, height: s.height } : null;
  }

  private opacityTarget(slot: Slot): number {
    return slot === this.activeSlot ? 1 : 1 - (1 - FADE_OPACITY) * this.focus;
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

  /**
   * Lay out the tile of grid rectangle `rect` for zoom `z` ahead of zooming there: it stays
   * sharp all the way (drawn smaller until it arrives), and the image for that size is on
   * its way while it moves.
   */
  prepare(rect: CellRect, z: number): void {
    const slot = this.active.find((s) => s.left === rect.left && s.top === rect.top);
    if (slot && slot.layout !== z) {
      this.layOut(slot, z);
      this.fitVideo(slot);
    }
  }

  /** Size a tile in CSS for zoom `layout`; the browser picks an image to fit. */
  private layOut(slot: Slot, layout: number): void {
    const g = this.geometry!;
    slot.layout = layout;
    const cssWidth = Math.round(slot.width * layout * 100) / 100;
    const cssHeight = Math.round(slot.height * layout * 100) / 100;
    slot.el.style.width = `${cssWidth}px`;
    slot.el.style.height = `${cssHeight}px`;
    slot.el.style.borderRadius = `${Math.round(g.radius * layout * 100) / 100}px`;
    const sizes = `${Math.round(cssWidth)}px`;
    if (slot.img.sizes !== sizes) {
      slot.source.sizes = sizes;
      slot.img.sizes = sizes;
    }
    slot.cssScale = Number.NaN;
  }

  /** The grid rectangle (world px) of the tile that `target` is part of, if any. */
  rectOf(target: Element): CellRect | null {
    for (const slot of this.active) {
      if (slot.el.contains(target)) return { left: slot.left, top: slot.top, width: slot.width, height: slot.height };
    }
    return null;
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
  visibleCells(): { i: number; j: number; image: number; left: number; top: number; width: number; height: number; scale: number; opacity: number }[] {
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
          opacity: s.opacity,
        };
      })
      .filter((c) => c.left < g.vw && c.left + c.width > 0 && c.top < g.vh && c.top + c.height > 0);
  }

  /** Trail offsets of the tiles on screen, with their unlensed on-screen centres, for tests. */
  trailOffsets(): { i: number; j: number; cx: number; cy: number; x: number; y: number }[] {
    const on = new Set(this.visibleCells().map((c) => cellKey(c.i, c.j)));
    const z = this.camZ;
    return this.active
      .filter((s) => on.has(s.key))
      .map((s) => ({
        i: s.i,
        j: s.j,
        cx: (s.left + s.width / 2 - this.camX) * z,
        cy: (s.top + s.height / 2 - this.camY) * z,
        x: s.trail.ox,
        y: s.trail.oy,
      }));
  }

  /**
   * The lag an image should have now. Panning, it tapers along the direction the images
   * move (least at the leading viewport edge, most at the trailing one); zooming, it
   * grows with distance from the zoom anchor. (gx, gy) is the tile's grid corner on screen.
   */
  private lagFor(slot: Slot, gx: number, gy: number, z: number): number {
    const g = this.geometry!;
    const hx = g.vw / 2;
    const hy = g.vh / 2;
    const cx = gx + (slot.width * z) / 2;
    const cy = gy + (slot.height * z) / 2;
    const taper = this.zooming
      ? zoomTaperWeight(Math.hypot(cx - this.anchorX, cy - this.anchorY), Math.hypot(hx, hy))
      : taperWeight(cx - hx, cy - hy, this.dirX, this.dirY, hx, hy);
    return taperedLag(taper, slot.weight);
  }

  private reassign(range: CellRange): void {
    const last = this.lastRange;
    last.i0 = range.i0;
    last.i1 = range.i1;
    last.j0 = range.j0;
    last.j1 = range.j1;
    const relayout = this.dirty;
    const resetTrails = this.resetTrails;
    this.dirty = false;
    this.resetTrails = false;
    // Release the tiles that left the range first, so their elements go to the ones arriving
    // and the pool never holds both sets at once.
    for (let n = this.active.length - 1; n >= 0; n--) {
      const slot = this.active[n]!;
      if (slot.i >= range.i0 && slot.i <= range.i1 && slot.j >= range.j0 && slot.j <= range.j1) continue;
      this.active[n] = this.active[this.active.length - 1]!;
      this.active.pop();
      this.byKey.delete(slot.key);
      if (slot === this.activeSlot) this.setActive(null);
      this.onRelease?.(slot.el);
      slot.el.hidden = true;
      slot.video?.pause();
      this.free.push(slot);
    }
    for (let i = range.i0; i <= range.i1; i++) {
      for (let j = range.j0; j <= range.j1; j++) {
        const key = cellKey(i, j);
        const slot = this.byKey.get(key);
        if (!slot) {
          this.assign(this.acquire(key), key, i, j, true);
        } else if (relayout) {
          this.assign(slot, key, i, j, false);
          if (resetTrails) this.restTrail(slot);
        }
      }
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
    this.container.append(el);
    const slot: Slot = {
      el,
      source,
      img,
      video: null,
      videoSrc: null,
      visible: false,
      label,
      key: -1,
      i: 0,
      j: 0,
      image: -1,
      layout: 1,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      weight: 0,
      lag: 0,
      trail: restingTrail(),
      loaded: false,
      token: 0,
      cssX: Number.NaN,
      cssY: Number.NaN,
      cssScale: Number.NaN,
      drawnWidth: 0,
      drawnHeight: 0,
      distance: Number.POSITIVE_INFINITY,
      opacity: 1,
      cssOpacity: 1,
    };
    this.slots.push(slot);
    this.slotOf.set(el, slot);
    this.visibility.observe(el);
    return slot;
  }

  /** The copy of the tile's video that fits the size it is laid out at, in the format this browser plays, or null if it has none. */
  private videoFor(slot: Slot): string | null {
    const { video } = this.images[slot.image]!;
    if (!video) return null;
    const small = Math.min(slot.width, slot.height) * slot.layout * devicePixelRatio <= VIDEO_SMALL_EDGE * 1.25;
    if (small) return this.webm ? video.smallWebm : video.smallMp4;
    return this.webm ? video.webm : video.mp4;
  }

  /** Laid out at another size: swap to the copy of its video that fits, carrying on from the same moment. */
  private fitVideo(slot: Slot): void {
    const want = this.videoFor(slot);
    if (want && slot.videoSrc && want !== slot.videoSrc) this.setVideo(slot, want, slot.video!.currentTime);
  }

  /**
   * With its video shown, a tile has nothing under it: no poster frame, no placeholder colour.
   * Under a different frame (a light poster, a dark scene playing) they bleed through the
   * anti-aliased edge of its rounded clip as a fringe. Uncovered, they are back for whenever
   * the video isn't showing.
   */
  private cover(slot: Slot, covered: boolean): void {
    slot.img.parentElement!.style.visibility = covered ? 'hidden' : '';
    slot.el.style.backgroundColor = covered ? 'transparent' : this.images[slot.image]!.color;
  }

  /** Show `src` playing over the tile's image (from `at` seconds in), or (null) no video. */
  private setVideo(slot: Slot, src: string | null, at = 0): void {
    let video = slot.video;
    slot.videoSrc = src;
    if (video?.src || src) this.cover(slot, false);
    if (!src) {
      if (!video?.src) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.hidden = true;
      return;
    }
    if (!video) {
      video = slot.video = document.createElement('video');
      video.className = VIDEO_CLASS;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      // Nothing loads until the tile is on screen and it plays.
      video.preload = 'none';
      video.setAttribute('aria-hidden', 'true');
      video.addEventListener('playing', () => {
        delete video!.dataset.waiting;
        // Faded in: clear what is under it (see cover).
        const src = slot.videoSrc;
        setTimeout(() => {
          if (slot.videoSrc === src && video!.dataset.waiting === undefined && !video!.hidden) this.cover(slot, true);
        }, VIDEO_FADE);
      });
      slot.el.append(video);
    }
    video.hidden = false;
    video.dataset.waiting = '';
    video.src = src;
    if (at) video.currentTime = at;
    this.syncVideo(slot);
  }

  private assign(slot: Slot, key: number, i: number, j: number, fresh: boolean): void {
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
    // Arriving mid zoom-to, a tile is laid out for the zoom as it is now: sharp from the start.
    this.layOut(slot, fresh && this.holding ? this.camZ : this.layoutZoom);
    slot.el.style.zIndex = String(cell.z);
    if (fresh) {
      // Arrive already faded (or not), like the tiles around it.
      slot.opacity = this.opacityTarget(slot);
      slot.weight = unit(hash(i, j, this.world.seed, SALT_WEIGHT));
      if (this.trails) {
        // Start already trailing as its neighbours do, so a tile entering mid-fling never pops.
        const z = this.camZ;
        const gx = (slot.left - this.camX) * z;
        const gy = (slot.top - this.camY) * z;
        slot.lag = this.lagFor(slot, gx, gy, z);
        placeTrail(slot.trail, gx, gy, this.motionX, this.motionY, slot.lag);
      } else {
        placeTrail(slot.trail, 0, 0, 0, 0, 0);
      }
    }
    if (slot.label) slot.label.textContent = `${i},${j} #${cell.image}`;
    if (slot.image === cell.image) return this.fitVideo(slot);

    const source = this.images[cell.image]!;
    slot.image = cell.image;
    slot.loaded = false;
    slot.el.style.backgroundColor = source.color;
    slot.img.alt = source.alt;
    slot.img.dataset.loading = '';
    slot.source.srcset = source.avif;
    slot.img.srcset = source.webp;
    slot.img.src = source.src;
    this.setVideo(slot, this.videoFor(slot));
    const token = ++slot.token;
    const reveal = () => {
      if (slot.token !== token) return;
      slot.loaded = true;
      delete slot.img.dataset.loading;
    };
    slot.img.decode().then(reveal, reveal);
  }
}
