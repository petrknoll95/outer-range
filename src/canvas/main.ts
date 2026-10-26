import { gsap } from 'gsap';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { FocusCaption } from './caption';
import { FLIGHT_DURATION, FOCUS_FRAME_RETURN, FLIGHT_REDUCED_DURATION, FLIGHT_RETURN_DURATION, STEP, ZOOM_DURATION } from './config';
import type { FlightView } from './flight';
import { flightFar, flightTravel } from './flight';
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
// Zoomed in, the active image's title above it, and its category and alt text below.
const caption = new FocusCaption(document.body);
renderer.onActiveChange = (tile) => {
  frame.focus(tile);
  updateCaption();
};
frame.onSettle = () => updateCaption();
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

/**
 * The caption shows only while the view rests on an image: zoomed in, landed, nothing
 * moving and the frame done handing over. The moment anything moves (a drag, a scroll, a
 * key, a zoom, a flight) it leaves, where it stands (see FocusCaption), so it is never seen
 * riding along with the frame; it comes back once all is still again.
 */
function updateCaption(): void {
  const still = zoomState === 'in' && !flight && physics.isStill() && renderer.isAtRest() && !frame.moving;
  const active = still ? renderer.activeImage() : null;
  caption.show(active ? data.images[active.image]! : null);
}

/** Zooming onto another image, when the frame that stepped aside comes back. */
let frameTimer = 0;

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
  // Mid zoom-to, tiles keep their layout until it lands.
  renderer.update(physics.renderX, physics.renderY, physics.renderZ, vx, vy, zoomAtRest, physics.zoomingTo);
  frame.setRadius(geometry.radius * physics.renderZ);
}

/** At rest: no motion, no image still trailing, fading or still to be snapped to. */
const atRest = () => physics.isAtRest() && renderer.isAtRest();

function tick(): void {
  if (flight) {
    stepFlight();
    return;
  }
  physics.advance(now());
  // Before anything is drawn moved, so a caption leaving stays where it was.
  updateCaption();
  // (A zoom-to keeps its zoom and target equal at every step; it's at rest only once it lands.)
  draw(physics.stepVx, physics.stepVy, physics.z === physics.tz && !physics.zoomingTo);
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

/**
 * A click on an image. Zoomed out, it opens the focused view on it (zooming in, centred);
 * zoomed in, it glides the image's grid centre to the middle of the screen.
 */
function tapAt(x: number, y: number, t: number): void {
  const rect = tileAt(x, y);
  if (!rect) return;
  if (zoomState === 'out') return zoomInOn(rect, t);
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
  // Sharp all the way in, its full-size image loading on the way.
  renderer.prepare(rect, zoomIn);
  // Onto another image than the framed one: the frame steps aside rather than chase it, and
  // comes back round it as it arrives.
  const active = renderer.activeRect();
  if (!active || active.left !== rect.left || active.top !== rect.top) {
    frame.conceal();
    clearTimeout(frameTimer);
    frameTimer = window.setTimeout(() => frame.reveal(), reducedMotion.matches ? 0 : ZOOM_DURATION * FOCUS_FRAME_RETURN * 1000);
  }
  physics.push(ZOOM_TO, t, rect.left + rect.width / 2, rect.top + rect.height / 2, zoomIn, ZOOM_DURATION);
}

/** Zoom back out, keeping whatever is centred in place. */
function zoomOut(t: number): void {
  if (zoomState === 'out') return;
  zoomState = 'out';
  physics.setPaging(0);
  physics.push(ZOOM_TO, t, physics.tx + geometry.vw / 2 / physics.tz, physics.ty + geometry.vh / 2 / physics.tz, 1, ZOOM_DURATION);
  updateCaption();
  clearTimeout(frameTimer);
  frame.reveal();
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

/** Esc: out of the focused view, back to the canvas. */
function backOut(t: number): void {
  if (zoomState === 'in') zoomOut(t);
}

attachInput({
  root,
  physics,
  wake,
  tap: tapAt,
  zoom: setZoom,
  toggleZoom,
  escape: backOut,
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
reducedMotion.addEventListener('change', () => {
  applyMotion();
  playVideos();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sleep();
  else wake();
});

/**
 * Two views of one document: the canvas (`/`) and the about view (`/about`, blank for now).
 * Going to the about view the camera flies on into the canvas, each image growing towards
 * it at its own depth and fading (flight.ts), until only the header is left; coming back the
 * flight runs in reverse, and browsing picks up exactly where it was. The view lives in the
 * URL (History API), so the browser's back and forward buttons run the same flight, and a
 * change of mind mid-flight turns it round from wherever it has got to.
 */
type Route = 'home' | 'about';
const ROUTES: Record<Route, { path: string; title: string; link: { href: string; label: string } }> = {
  home: { path: '/', title: 'Petr Knoll', link: { href: '/about', label: 'About' } },
  about: { path: '/about', title: 'About · Petr Knoll', link: { href: '/', label: 'Back' } },
};
const routeAt = (path: string): Route => (path.replace(/\/+$/, '') === '/about' ? 'about' : 'home');
let route: Route = routeAt(location.pathname);

/** Videos play on the canvas, unless motion is to be reduced: then each holds its poster frame. */
function playVideos(): void {
  renderer.setVideos(!reducedMotion.matches && route !== 'about');
}
playVideos();

/** How far the flight has got, 0 (the canvas) to 1 (every image flown past), and which way it is going. */
interface Flight {
  u: number;
  to: 0 | 1;
  last: number;
}
let flight: Flight | null = null;

function go(next: Route): void {
  if (next === route) return;
  route = next;
  document.title = ROUTES[next].title;
  showLink(next);
  showAbout(next === 'about');
  playVideos();
  if (next === 'about') leaveCanvas();
  else if (flight) turn(0);
}

/** Send the flight on (1) or back (0) from wherever it has got to. */
function turn(to: 0 | 1): void {
  flight!.to = to;
  flight!.last = now();
  wake();
}

function leaveCanvas(): void {
  if (flight) return turn(1);
  // Hold the camera where it is drawn; nothing else moves while the flight plays.
  physics.halt();
  saveView();
  document.documentElement.dataset.leaving = '';
  renderer.beginFlight();
  flight = { u: 0, to: 1, last: now() };
  updateCaption();
  wake();
}

function stepFlight(): void {
  const f = flight!;
  const t = now();
  const still = reducedMotion.matches;
  const duration = still ? FLIGHT_REDUCED_DURATION : f.to === 1 ? FLIGHT_DURATION : FLIGHT_RETURN_DURATION;
  f.u = Math.min(1, Math.max(0, f.u + ((f.to === 1 ? 1 : -1) * (t - f.last)) / duration));
  f.last = t;
  const travel = flightTravel(f.u);
  renderer.drawFlight(travel, still);
  drawAbout(travel, still);
  if (f.u !== f.to) return;
  // Flown past: only the header is left, and nothing to draw until it turns back.
  if (f.to === 1) return sleep();
  // Back where it was: browse on from exactly here.
  renderer.endFlight();
  aboutLayer.removeAttribute('style');
  flight = null;
  delete document.documentElement.dataset.leaving;
  relayout();
  resettle(t);
}

/** Back from a flight: finish settling into the zoom state, on an image's centre when zoomed in. */
function resettle(t: number): void {
  const z = zoomState === 'in' ? zoomIn : 1;
  const cx = physics.x + geometry.vw / 2 / physics.z;
  const cy = physics.y + geometry.vh / 2 / physics.z;
  if (zoomState === 'in') nearestImageCentre(world, geometry, cx, cy, nearest);
  const [px, py] = zoomState === 'in' ? [nearest.x, nearest.y] : [cx, cy];
  if (z !== physics.z || px !== cx || py !== cy) physics.push(ZOOM_TO, t, px, py, z, ZOOM_DURATION);
}

/**
 * The view the canvas was left in, kept for this tab: where its centre was (in units of S, so
 * it survives a resize) and the zoom state. A reload of the about view, or a reloaded tab
 * going back to the canvas, comes back to it.
 */
const VIEW_KEY = 'canvas:view';
function saveView(): void {
  const cx = (physics.x + geometry.vw / 2 / physics.z) / geometry.s;
  const cy = (physics.y + geometry.vh / 2 / physics.z) / geometry.s;
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ cx, cy, zoom: zoomState }));
  } catch {
    // Storage blocked: a reload just starts from the default view.
  }
}
function restoreView(): boolean {
  let view: { cx: number; cy: number; zoom: 'in' | 'out' } | null = null;
  try {
    view = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null');
  } catch {
    return false;
  }
  if (!view) return false;
  zoomState = view.zoom;
  const z = zoomState === 'in' ? zoomIn : 1;
  physics.jumpTo(view.cx * geometry.s - geometry.vw / 2 / z, view.cy * geometry.s - geometry.vh / 2 / z, z);
  if (zoomState === 'in') physics.setPaging(geometry.pitch);
  return true;
}

// The about view's text (Site.astro), a layer behind the canvas.
const about = document.querySelector<HTMLElement>('[data-about]')!;
const aboutContent = about.querySelector<HTMLElement>('[data-about-content]')!;
const aboutLayer = aboutContent.querySelector<HTMLElement>('[data-about-layer]')!;

// Its scroll, smoothed: the page scrolls (only on the about view, global.css) and ScrollSmoother
// eases the text after it. Touch scrolls natively; with reduced motion nothing is eased.
gsap.registerPlugin(ScrollTrigger, ScrollSmoother);
const ABOUT_SMOOTH = 1.1;
// Not 0: at 0 ScrollSmoother stops moving the text at all, so it would never scroll.
const ABOUT_SMOOTH_REDUCED = 0.001;
const smoothing = () => (reducedMotion.matches ? ABOUT_SMOOTH_REDUCED : ABOUT_SMOOTH);
const smoother = ScrollSmoother.create({
  wrapper: about,
  content: aboutContent,
  smooth: smoothing(),
  smoothTouch: false,
  effects: false,
});
reducedMotion.addEventListener('change', () => smoother.smooth(smoothing()));
const far: FlightView = { scale: 1, opacity: 1, blur: 0 };

/** Which view is showing; the other is inert: no clicks, focus or scrolls. */
function showAbout(on: boolean): void {
  about.inert = !on;
  root.inert = on;
  if (on) about.dataset.state = 'in';
  else delete about.dataset.state;
}

/**
 * Draw the about text as the far plane with the camera `travel` in (flightFar): coming
 * towards the camera from behind the canvas as it flies in, receding as it flies back.
 * `still` (reduced motion): it only fades.
 */
function drawAbout(travel: number, still: boolean): void {
  flightFar(travel, far);
  // About the viewport's centre, however far down the text is scrolled (and wherever the smooth
  // scroll has carried it): the content moves the layer up by its offset, so the centre is that
  // far further down the layer.
  const top = aboutContent.getBoundingClientRect().top;
  aboutLayer.style.transformOrigin = `50% ${(innerHeight / 2 - top).toFixed(1)}px`;
  aboutLayer.style.opacity = far.opacity.toFixed(3);
  aboutLayer.style.transform = still || far.scale === 1 ? '' : `scale(${far.scale.toFixed(4)})`;
  // The blur is drawn before the scale: ask for the share that comes out at far.blur on screen.
  const blur = still ? 0 : far.blur / far.scale;
  aboutLayer.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
}

// The header link: About on the canvas, Back on the about view.
const link = document.querySelector<HTMLAnchorElement>('a[data-route-link]')!;

/** Point the link at the other view; its old label slides up out of the mask and the new one up in. */
function showLink(r: Route): void {
  link.href = ROUTES[r].link.href;
  const text = link.firstElementChild as HTMLElement;
  for (const a of text.getAnimations()) a.cancel();
  if (reducedMotion.matches) {
    text.textContent = ROUTES[r].link.label;
    return;
  }
  const out = text.animate([{ transform: 'translateY(-110%)', opacity: 0 }], { duration: 140, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' });
  out.finished.then(
    () => {
      // Whatever the route is by now.
      text.textContent = ROUTES[route].link.label;
      out.cancel();
      text.animate([{ transform: 'translateY(110%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    },
    // Cancelled by a newer change.
    () => {},
  );
}

// Plain clicks and Enter go between the views; modified ones (new tab, new window) open the link as usual.
link.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  // (Any query, like ?debug or ?flat, carries over.)
  switchView();
});

/** What the header link does: About from the canvas, Back from the about view. */
function switchView(): void {
  if (route === 'home') {
    history.pushState({ canvas: true }, '', ROUTES.about.path + location.search);
    go('about');
  } else {
    backToCanvas();
  }
}

/** From the about view back to the canvas, as it was left (zoomed in or out). */
function backToCanvas(): void {
  if ((history.state as { canvas?: boolean } | null)?.canvas) {
    // Arrived here from the canvas: Back is going back in history, so Forward comes here again.
    history.back();
  } else {
    history.pushState({ canvas: true }, '', ROUTES.home.path + location.search);
    go('home');
  }
}

// "L": the other theme, light or dark, whichever the page isn't showing, kept for next time
// (Layout.astro sets it again before the first paint). Only an attribute changes: the colours
// fade on their own in CSS (global.css), so nothing else stops or waits for it.
const THEME_KEY = 'theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'l' || e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
  const html = document.documentElement;
  const next = (html.dataset.theme ?? (systemDark.matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: it switches, but isn't kept.
  }
});

// "A" does what the header link does: About, or Back from the about view (the info bar lists it).
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'a' || e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  switchView();
});

// Esc on the about view goes back too, like the Back link. (On the canvas it backs out of the focused view: input.ts.)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || e.defaultPrevented || route !== 'about') return;
  e.preventDefault();
  backToCanvas();
});
// The browser's back and forward buttons, including back after a reload of the about view.
window.addEventListener('popstate', () => go(routeAt(location.pathname)));

const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
// Opened on the about view, or a reloaded tab coming back to the canvas: start flown past, in the view it was left in.
const arriving = route === 'home' && navigation?.type === 'back_forward' && restoreView();
if (route === 'about') restoreView();
if (route === 'about' || arriving) document.documentElement.dataset.leaving = '';

// First frame now, so tiles are in place before the first paint.
draw(0, 0, true);
if (route === 'about' || arriving) {
  renderer.beginFlight();
  flight = { u: 1, to: 1, last: now() };
  renderer.drawFlight(flightTravel(1), reducedMotion.matches);
  drawAbout(flightTravel(1), reducedMotion.matches);
  // Coming back to the canvas: fly in.
  if (arriving) turn(0);
} else {
  wake();
}

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
    /** The view, and the flight between the two, or null. */
    route: () => route,
    flight: () => (flight ? { u: flight.u, to: flight.to } : null),
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
