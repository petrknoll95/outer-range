import { gsap } from 'gsap';
import { FocusCaption } from './caption';
import { CAPTION_ZOOM_DELAY, FLIGHT_DURATION, FLIGHT_REDUCED_DURATION, FLIGHT_RETURN_DURATION, STEP, ZOOM_DURATION } from './config';
import { flightTravel } from './flight';
import { centerDelta, focusDuration, nearestImageCentre } from './focus';
import { FocusFrame } from './focusframe';
import { attachInput } from './input';
import type { CellRect, Geometry } from './layout';
import { computeGeometry, sizingReach, zoomInLevel } from './layout';
import { DEFAULT_LENS, Lens } from './lens';
import type { Snapper } from './physics';
import { CameraPhysics, GLIDE, ZOOM_TO } from './physics';
import type { CameraStep, CanvasData } from './renderer';
import { Renderer } from './renderer';
import { createWorld } from './world';

const root = document.querySelector<HTMLElement>('[data-canvas]')!;
const layer = root.querySelector<HTMLElement>('[data-canvas-layer]')!;
const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as CanvasData;

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const world = createWorld(data.images);
// `?flat` turns the watchOS-style lens off, for comparison.
const lens = new Lens(params.has('flat') ? null : DEFAULT_LENS);
const physics = new CameraPhysics();
physics.snapper = (x, y, z) => snapper(x, y, z);
const renderer = new Renderer(layer, world, data.images, lens, debug);
// The frame around the active image, on top of the tiles; it follows the active image as it changes.
const frame = new FocusFrame(root);
// Zoomed in, the active image's category, title and alt text at the bottom left.
const caption = new FocusCaption(document.body);
renderer.onActiveChange = (tile) => {
  frame.focus(tile);
  updateCaption();
};
renderer.onRelease = (tile) => frame.release(tile);

// How much world the no-repeat sizing counts as visible; see LENS_REPEAT_SHARE.
const seen = sizingReach(lens.reach);
let geometry: Geometry = computeGeometry(root.clientWidth, root.clientHeight, world, seen);
let dpr = window.devicePixelRatio;
renderer.setGeometry(geometry);

/**
 * Two zoom states. Out is zoom 1; in is zoomInLevel(), and there the view always settles
 * with an image exactly centred (the snapper), every other image faded.
 */
let zoomState: 'out' | 'in' = 'out';
let zoomIn = 1;

/** Zoomed in, and far enough into the zoom that the caption shows. */
let captionOn = false;
let captionTimer = 0;

function updateCaption(): void {
  const active = captionOn ? renderer.activeImage() : null;
  caption.show(active ? data.images[active.image]! : null);
}

/** 0 zoomed out to 1 zoomed in, from the actual zoom, so the fade follows the animation. */
const focusAt = (z: number) => (zoomIn > 1 ? Math.min(1, Math.max(0, (z - 1) / (zoomIn - 1))) : 0);

/** The camera position that centres the image nearest the view centre; paging uses it to find neighbours. */
const nearest = { x: 0, y: 0 };
const snapper: Snapper = (x, y, z) => {
  const hx = geometry.vw / 2 / z;
  const hy = geometry.vh / 2 / z;
  nearestImageCentre(world, geometry, x + hx, y + hy, nearest);
  return { x: nearest.x - hx, y: nearest.y - hy };
};

const stepCam: CameraStep = { x: 0, y: 0, z: 1, panVx: 0, panVy: 0, zooming: false, anchorX: 0, anchorY: 0, focus: 0 };
physics.onStep = () => {
  stepCam.x = physics.x;
  stepCam.y = physics.y;
  stepCam.z = physics.z;
  stepCam.panVx = physics.panVx;
  stepCam.panVy = physics.panVy;
  stepCam.zooming = physics.zooming;
  stepCam.anchorX = physics.anchorX;
  stepCam.anchorY = physics.anchorY;
  stepCam.focus = focusAt(physics.z);
  renderer.step(stepCam, STEP);
};

function applyZoomLimits(): void {
  zoomIn = zoomInLevel(geometry, window.devicePixelRatio, data.sharpEdge);
  physics.setZoomLimits(1, zoomIn, geometry.vw / 2, geometry.vh / 2);
  physics.centreX = geometry.vw / 2;
  physics.centreY = geometry.vh / 2;
}
applyZoomLimits();
// Start with the world origin in the middle of the screen.
physics.jumpTo(-geometry.vw / 2, -geometry.vh / 2, 1);

const now = () => ((document.timeline?.currentTime as number | null) ?? performance.now()) / 1000;

let awake = false;
const listeners = new Set<() => void>();

function draw(vx: number, vy: number, zoomAtRest: boolean): void {
  renderer.update(physics.renderX, physics.renderY, physics.renderZ, vx, vy, zoomAtRest);
}

/** At rest: no motion, no image still trailing, fading or still to be snapped to. */
const atRest = () => physics.isAtRest() && renderer.isAtRest();

function tick(): void {
  if (flight) {
    stepFlight();
    return;
  }
  physics.advance(now());
  draw(physics.stepVx, physics.stepVy, physics.z === physics.tz);
  for (const fn of listeners) fn();
  if (atRest() && listeners.size === 0) {
    // One last update so tiles are laid out sharp at the final zoom, then sleep.
    draw(0, 0, true);
    sleep();
  }
}

function wake(): void {
  if (awake || document.hidden) return;
  awake = true;
  physics.resync();
  gsap.ticker.add(tick);
}

function sleep(): void {
  if (!awake) return;
  awake = false;
  gsap.ticker.remove(tick);
}

// The physics runs on event timestamps; GSAP's lag smoothing would bend its clock.
gsap.ticker.lagSmoothing(0);

/** The grid rectangle of the tile drawn at screen point (x, y), if any. */
function tileAt(x: number, y: number): CellRect | null {
  const target = document.elementFromPoint(x, y);
  return target && root.contains(target) ? renderer.rectOf(target) : null;
}

/** Glide the clicked image's grid centre to the middle of the screen. */
function centreAt(x: number, y: number, t: number): void {
  const rect = tileAt(x, y);
  if (!rect) return;
  // Measure against where the camera is heading, so a click mid-scroll still centres.
  const { dx, dy } = centerDelta(rect, physics.tx, physics.ty, physics.tz, geometry.vw, geometry.vh);
  physics.push(GLIDE, t, dx, dy, focusDuration(Math.hypot(dx, dy)));
}

/** Zoom in on the image at grid rectangle `rect`: it grows and glides to the centre in one move. */
function zoomInOn(rect: CellRect | null, t: number): void {
  if (zoomState === 'in' || !rect) return;
  zoomState = 'in';
  // Zoomed in, the view pages from image to image, one neighbour per gesture.
  physics.setPaging(geometry.pitch);
  physics.push(ZOOM_TO, t, rect.left + rect.width / 2, rect.top + rect.height / 2, zoomIn, ZOOM_DURATION);
  revealCaption();
}

/** Show the caption once a zoom-in is nearly there (it eases out), or at once if there's no zoom to wait for. */
function revealCaption(zooming = true): void {
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(
    () => {
      captionOn = true;
      updateCaption();
    },
    zooming && !reducedMotion.matches ? ZOOM_DURATION * CAPTION_ZOOM_DELAY * 1000 : 0,
  );
}

/** Zoom back out, keeping whatever is centred in place. */
function zoomOut(t: number): void {
  if (zoomState === 'out') return;
  zoomState = 'out';
  physics.setPaging(0);
  physics.push(ZOOM_TO, t, physics.tx + geometry.vw / 2 / physics.tz, physics.ty + geometry.vh / 2 / physics.tz, 1, ZOOM_DURATION);
  captionOn = false;
  clearTimeout(captionTimer);
  updateCaption();
}

/** Switch zoom state. Zooming in locks onto the image under (x, y), or the active one if there's none there. */
function setZoom(direction: 1 | -1, x: number, y: number, t: number): void {
  if (direction > 0) zoomInOn(tileAt(x, y) ?? renderer.activeRect(), t);
  else zoomOut(t);
}

/** Space / Enter: into the active image (the one in the focus frame), or back out. */
function toggleZoom(t: number): void {
  if (zoomState === 'out') zoomInOn(renderer.activeRect(), t);
  else zoomOut(t);
}

attachInput({
  root,
  physics,
  wake,
  tap: centreAt,
  zoom: setZoom,
  toggleZoom,
  enabled: () => !flight,
  metrics: () => ({ pitch: geometry.pitch * physics.tz, vw: geometry.vw, vh: geometry.vh }),
  toCanvas,
});

/** Screen point → the unlensed canvas point the lens draws there. */
function toCanvas(x: number, y: number, out: { x: number; y: number }): void {
  const hx = geometry.vw / 2;
  const hy = geometry.vh / 2;
  lens.unapply(x - hx, y - hy, hx, hy, out);
  out.x += hx;
  out.y += hy;
}

function relayout(): void {
  // Mid-flight the tiles are drawn from a snapshot; catch up once back.
  if (flight) return;
  const next = computeGeometry(root.clientWidth, root.clientHeight, world, seen);
  const dprChanged = window.devicePixelRatio !== dpr;
  dpr = window.devicePixelRatio;
  if (!dprChanged && next.vw === geometry.vw && next.vh === geometry.vh) return;
  // Keep the world point under the viewport centre where it is.
  physics.rescale(next.s / geometry.s, geometry.vw / 2, geometry.vh / 2, next.vw / 2, next.vh / 2);
  geometry = next;
  renderer.setGeometry(geometry);
  applyZoomLimits();
  if (zoomState === 'in') {
    physics.setPaging(geometry.pitch);
    // The zoomed-in level depends on the viewport: settle at the new one, still centred.
    const cx = physics.tx + geometry.vw / 2 / physics.tz;
    const cy = physics.ty + geometry.vh / 2 / physics.tz;
    physics.push(ZOOM_TO, now(), cx, cy, zoomIn, STEP);
  }
  wake();
}
new ResizeObserver(relayout).observe(root);
// Moving the window to a screen with another pixel ratio changes no size, so watch it directly.
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      relayout();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const applyMotion = () => {
  physics.setReducedMotion(reducedMotion.matches);
  renderer.setTrails(!reducedMotion.matches);
};
applyMotion();
reducedMotion.addEventListener('change', applyMotion);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sleep();
  else wake();
});

/**
 * Leaving for another page (links marked `data-fly-out`): the camera flies on into the
 * canvas, each image growing towards it at its own depth and fading (flight.ts), and the
 * page changes on the frame the canvas is clear. If the browser brings this page back from
 * its back/forward cache, the flight plays in reverse and browsing picks up where it was.
 */
interface Flight {
  href: string;
  start: number;
  duration: number;
  back: boolean;
  /** Reduced motion: a fade, nothing moves. */
  still: boolean;
}
let flight: Flight | null = null;

function flyOut(href: string): void {
  if (flight) return;
  // Hold the camera where it is drawn; nothing else moves while the flight plays.
  physics.halt();
  captionOn = false;
  clearTimeout(captionTimer);
  updateCaption();
  document.documentElement.dataset.leaving = '';
  renderer.beginFlight();
  const still = reducedMotion.matches;
  flight = { href, start: now(), duration: still ? FLIGHT_REDUCED_DURATION : FLIGHT_DURATION, back: false, still };
  wake();
}

function stepFlight(): void {
  const f = flight!;
  const u = Math.min(1, (now() - f.start) / f.duration);
  renderer.drawFlight(flightTravel(f.back ? 1 - u : u), f.still);
  if (u < 1) return;
  if (!f.back) {
    // The canvas is clear: change page on this frame. Prerendered, the new page is already there.
    sleep();
    location.assign(f.href);
    return;
  }
  // Back where it was: browse on from exactly here.
  renderer.endFlight();
  flight = null;
  relayout();
  resettle(now());
}

/** Back from a flight: finish settling into the zoom state, on an image's centre when zoomed in. */
function resettle(t: number): void {
  const z = zoomState === 'in' ? zoomIn : 1;
  const cx = physics.x + geometry.vw / 2 / physics.z;
  const cy = physics.y + geometry.vh / 2 / physics.z;
  if (zoomState === 'in') nearestImageCentre(world, geometry, cx, cy, nearest);
  const [px, py] = zoomState === 'in' ? [nearest.x, nearest.y] : [cx, cy];
  const moving = z !== physics.z || px !== cx || py !== cy;
  if (moving) physics.push(ZOOM_TO, t, px, py, z, ZOOM_DURATION);
  if (zoomState === 'in') revealCaption(moving);
}

window.addEventListener('pageshow', (e) => {
  if (!e.persisted || !flight) return;
  delete document.documentElement.dataset.leaving;
  flight = { ...flight, start: now(), duration: flight.still ? FLIGHT_REDUCED_DURATION : FLIGHT_RETURN_DURATION, back: true };
  wake();
});

/** The fly-out link an event came from, if any. */
const flyOutLink = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-fly-out]') : null);

// A plain click or Enter flies there; modified clicks (new tab, new window) open the link as usual.
document.addEventListener('click', (e) => {
  const link = flyOutLink(e);
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  prefetch(link.href);
  flyOut(link.href);
});

// Where Speculation Rules can't prerender the page (see index.astro), fetch it early instead.
const speculates = HTMLScriptElement.supports?.('speculationrules') ?? false;
const prefetched = new Set<string>();
function prefetch(href: string): void {
  if (speculates || prefetched.has(href)) return;
  prefetched.add(href);
  const hint = document.createElement('link');
  hint.rel = 'prefetch';
  hint.href = href;
  document.head.append(hint);
}
for (const type of ['pointerover', 'focusin'] as const) {
  document.addEventListener(type, (e) => {
    const link = flyOutLink(e);
    if (link) prefetch(link.href);
  });
}

// First frame now, so tiles are in place before the first paint.
draw(0, 0, true);
wake();

if (debug || params.has('test')) {
  const api = {
    world,
    physics,
    renderer,
    lens,
    toCanvas: (x: number, y: number) => {
      const out = { x: 0, y: 0 };
      toCanvas(x, y, out);
      return out;
    },
    geometry: () => geometry,
    zoomState: () => zoomState,
    zoomInLevel: () => zoomIn,
    zoomLimits: () => ({ min: physics.zoomMin, max: physics.zoomMax }),
    /** Leaving (or coming back to) the canvas, or null. */
    flight: () => (flight ? { back: flight.back } : null),
    activeImage: () => renderer.activeImage(),
    /** At rest, every image back on its grid position, and every on-screen image decoded. */
    isSettled: () => atRest() && renderer.visibleLoaded(),
    domNodes: () => root.getElementsByTagName('*').length,
    /** Keep the loop awake (and call `fn` every frame) while measuring. */
    onFrame(fn: () => void) {
      listeners.add(fn);
      wake();
      return () => listeners.delete(fn);
    },
  };
  (window as unknown as { __canvas: typeof api }).__canvas = api;
  if (debug) import('./debug').then((m) => m.attachDebug(api));
}
