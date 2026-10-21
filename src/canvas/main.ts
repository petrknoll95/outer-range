import { gsap } from 'gsap';
import { STEP } from './config';
import { attachInput } from './input';
import type { Geometry } from './layout';
import { computeGeometry, zoomLimits } from './layout';
import { CameraPhysics } from './physics';
import type { CanvasData } from './renderer';
import { Renderer } from './renderer';
import { createWorld } from './world';

const root = document.querySelector<HTMLElement>('[data-canvas]')!;
const layer = root.querySelector<HTMLElement>('[data-canvas-layer]')!;
const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as CanvasData;

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const world = createWorld(data.images);
const physics = new CameraPhysics();
const renderer = new Renderer(root, layer, world, data.images, debug);
physics.onStep = (x, y, z) => renderer.step(x, y, z, STEP);

let geometry: Geometry = computeGeometry(root.clientWidth, root.clientHeight, world);
let dpr = window.devicePixelRatio;
renderer.setGeometry(geometry);

function applyZoomLimits(): void {
  const { min, max } = zoomLimits(geometry, window.devicePixelRatio, data.sharpEdge);
  physics.setZoomLimits(min, max, geometry.vw / 2, geometry.vh / 2);
}
applyZoomLimits();
// Start with the world origin in the middle of the screen.
physics.jumpTo(-geometry.vw / 2, -geometry.vh / 2, 1);

const now = () => ((document.timeline?.currentTime as number | null) ?? performance.now()) / 1000;

let awake = false;
const listeners = new Set<() => void>();

function tick(): void {
  physics.advance(now());
  renderer.update(physics.renderX, physics.renderY, physics.renderZ, physics.stepVx, physics.stepVy, physics.z === physics.tz);
  for (const fn of listeners) fn();
  if (physics.isAtRest() && renderer.isAtRest() && listeners.size === 0) {
    // One last update so tiles are laid out sharp at the final zoom, then sleep.
    renderer.update(physics.renderX, physics.renderY, physics.renderZ, 0, 0, true);
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

attachInput({
  root,
  physics,
  wake,
  focus: (x, y) => renderer.setFocus(x, y),
  metrics: () => ({ pitch: geometry.pitch * physics.tz, vw: geometry.vw, vh: geometry.vh }),
});

function relayout(): void {
  const next = computeGeometry(root.clientWidth, root.clientHeight, world);
  const dprChanged = window.devicePixelRatio !== dpr;
  dpr = window.devicePixelRatio;
  if (!dprChanged && next.vw === geometry.vw && next.vh === geometry.vh) return;
  // Keep the world point under the viewport centre where it is.
  physics.rescale(next.s / geometry.s, geometry.vw / 2, geometry.vh / 2, next.vw / 2, next.vh / 2);
  geometry = next;
  renderer.setGeometry(geometry);
  applyZoomLimits();
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

// First frame now, so tiles are in place before the first paint.
renderer.update(physics.renderX, physics.renderY, physics.renderZ, 0, 0, true);
wake();

if (debug || params.has('test')) {
  const api = {
    world,
    physics,
    renderer,
    geometry: () => geometry,
    zoomLimits: () => ({ min: physics.zoomMin, max: physics.zoomMax }),
    /** At rest, every image back on its grid position, and every on-screen image decoded. */
    isSettled: () => physics.isAtRest() && renderer.isAtRest() && renderer.visibleLoaded(),
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
