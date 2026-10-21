import { gsap } from 'gsap';
import { attachInput } from './input';
import type { Geometry } from './layout';
import { computeGeometry } from './layout';
import { CameraPhysics } from './physics';
import type { ClientImage } from './renderer';
import { Renderer } from './renderer';
import { createWorld } from './world';

const root = document.querySelector<HTMLElement>('[data-canvas]')!;
const layer = root.querySelector<HTMLElement>('[data-canvas-layer]')!;
const images = JSON.parse(document.getElementById('canvas-data')!.textContent!) as ClientImage[];

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const world = createWorld(images);
const physics = new CameraPhysics();
const renderer = new Renderer(root, layer, world, images, debug);

let geometry: Geometry = computeGeometry(root.clientWidth, root.clientHeight, world);
let dpr = window.devicePixelRatio;
renderer.setGeometry(geometry);
// Start with the world origin in the middle of the screen.
physics.jumpTo(-geometry.vw / 2, -geometry.vh / 2);

const now = () => ((document.timeline?.currentTime as number | null) ?? performance.now()) / 1000;

let awake = false;
const listeners = new Set<() => void>();

function tick(): void {
  physics.advance(now());
  renderer.update(physics.renderX, physics.renderY, physics.vx, physics.vy);
  for (const fn of listeners) fn();
  if (physics.isAtRest() && listeners.size === 0) sleep();
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

attachInput({ root, physics, wake, metrics: () => geometry });

function relayout(): void {
  const next = computeGeometry(root.clientWidth, root.clientHeight, world);
  const dprChanged = window.devicePixelRatio !== dpr;
  dpr = window.devicePixelRatio;
  if (!dprChanged && next.vw === geometry.vw && next.vh === geometry.vh) return;
  // Keep the world point under the viewport centre where it is.
  physics.rescale(next.s / geometry.s, geometry.vw / 2, geometry.vh / 2, next.vw / 2, next.vh / 2);
  geometry = next;
  renderer.setGeometry(geometry);
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
physics.setReducedMotion(reducedMotion.matches);
reducedMotion.addEventListener('change', () => physics.setReducedMotion(reducedMotion.matches));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sleep();
  else wake();
});

// First frame now, so tiles are in place before the first paint.
renderer.update(physics.renderX, physics.renderY, 0, 0);
wake();

if (debug || params.has('test')) {
  const api = {
    world,
    physics,
    renderer,
    geometry: () => geometry,
    /** At rest and every on-screen image decoded. */
    isSettled: () => physics.isAtRest() && renderer.visibleLoaded(),
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
