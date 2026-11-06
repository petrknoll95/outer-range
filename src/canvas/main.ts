import { gsap } from 'gsap';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LONG, FLIGHT_DURATION, FLIGHT_EASE, FOCUS_FRAME_RETURN, FLIGHT_REDUCED_DURATION, FLIGHT_RETURN_DURATION, INTRO_CRUISE, INTRO_HANDOVER, INTRO_WAIT, MENU_BACK, MENU_BACK_ABOUT, MENU_RETURN_DURATION, MENU_RETURN_EASE, PROJECT_COLUMN, PROJECT_COLUMN_MAX, SEED, STEP, ZOOM_DURATION, ZOOM_NARROW } from './config';
import type { FlightView } from './flight';
import { flightFar, flightFrame, flightHandover, flightInstances, flightTravel, menuBackEase, menuBackView } from './flight';
import { centerDelta, focusDuration, nearestImageCentre } from './focus';
import { FocusFrame } from './focusframe';
import { GlassLayer } from './glass';
import { GlassText } from './glasstext';
import { setHint } from './hints';
import { attachInput } from './input';
import type { IntroFrame } from './intro';
import { INTRO_FARTHEST, INTRO_LENGTH, INTRO_STRIDE, introBuild, introFrame, introInstances, introPalette } from './intro';
import { IntroLayer } from './introlayer';
import { IntroTitle } from './introtitle';
import type { CellRect, Geometry } from './layout';
import { computeGeometry, sizingReach, zoomInFor, zoomInLevel } from './layout';
import { DEFAULT_LENS, Lens } from './lens';
import type { Snapper } from './physics';
import { CameraPhysics, GLIDE, ZOOM_TO } from './physics';
import { ProjectLabel } from './projectlabel';
import type { Leg } from './projectview';
import { ProjectView } from './projectview';
import type { ClientProject } from './projects';
import { createProjectIndex, projectCategories } from './projects';
import type { CameraStep, CanvasData } from './renderer';
import type { Rgb } from './pixels';
import { pixelColors } from './pixels';
import { Renderer } from './renderer';
import { createWorld, Z_LEVELS } from './world';

const root = document.querySelector<HTMLElement>('[data-canvas]')!;
const layer = root.querySelector<HTMLElement>('[data-canvas-layer]')!;
const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as CanvasData & { projects: ClientProject[] };
const projects = createProjectIndex(data.projects, data.images.length);
/** Each project's categories, by index into projects.projects. */
const categoriesOf = projects.projects.map((p) => projectCategories(p, data.images));

const params = new URLSearchParams(location.search);
const debug = params.has('debug');

const world = createWorld(data.images);
/** Every image's width over height, for the zoom limit. */
const ratios = data.images.map((image) => image.ratio);
// `?flat` turns the watchOS-style lens off, for comparison.
const lens = new Lens(params.has('flat') ? null : DEFAULT_LENS);
const physics = new CameraPhysics();
physics.snapper = (x, y, z) => snapper(x, y, z);
const renderer = new Renderer(layer, world, data.images, lens, debug);
// The frame around the active image, on top of the tiles; it follows the active image as it changes.
const frame = new FocusFrame(root);
// The active image's project, its name above the frame and its categories below, zoomed out and in.
const projectLabel = new ProjectLabel(frame.el);
/** The active image's tile element. */
let activeTile: HTMLElement | null = null;
renderer.onActiveChange = (tile) => {
  activeTile = tile;
  frame.focus(tile);
  updateProjectLabel();
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

/**
 * The project view (projectview.ts): "P" swaps the canvas for the active image's project, all of
 * its images in one column. As for the menu, the canvas backs away (backAway) while the image
 * comes forward to where the column has it and the rest of the column comes in from in front of
 * the camera. The canvas holds there under it, exactly as it was left and taking no input; "P" or
 * Esc sends the column on past the camera as the canvas comes home, and picking one of the images
 * comes home onto that one. The frame steps aside meanwhile, and is back once the canvas is home.
 * The canvas's videos start again once it is (starting several at once mid-move costs frames).
 */
const projectView = new ProjectView(
  document.querySelector<HTMLElement>('[data-project-view]')!,
  data.images,
  (image) => closeProject(image),
  params.has('glass'),
);
projectView.onHidden = () => playVideos();

function openProject(): void {
  if (projectView.isOpen || intro || flight || route !== 'home') return;
  const active = renderer.activeImage();
  const n = active ? projects.projectOf(active.image) : -1;
  if (!active || n < 0) return;
  root.inert = true;
  frame.conceal();
  clearTimeout(frameTimer);
  showProject(projects.projects[n]!);
  // Its hint in the info bar (InfoBar.astro) says Back, ESC joining the P.
  setHint('project', true);
  // The canvas backs away, as for the menu, as the view starts to fade in; the image flies on its leg.
  projectView.open(projects.projects[n]!, active.image, activeTile, () => {
    backAway(true, 'project');
    return backingLeg();
  });
  playVideos();
}

/**
 * Back to the canvas as it was left, or (`image`, one of the project's) to the focused view on
 * it: the canvas comes home as the column flies on past the camera. `instant`: nothing moves, the
 * canvas home at once (going to the about view, which flies from there).
 */
function closeProject(image: number | null = null, instant = false): void {
  if (!projectView.isOpen) return;
  root.inert = false;
  showProject(null);
  setHint('project', false);
  if (image !== null && image !== renderer.activeImage()?.image && !instant) {
    // Under the view: home at once, onto that image, then backed away again to come home from there.
    homeAtOnce();
    focusOn(image);
    backAway(true, 'project');
    Object.assign(backing!, { back: MENU_BACK, from: MENU_BACK, p: 1 });
    stepBacking();
  }
  if (instant) homeAtOnce();
  backAway(false, 'project');
  projectView.close(backing && !instant ? backingLeg() : null);
  // (Out of sight until the canvas is home: the frame fades as it backs away, data-leaving.)
  frame.reveal();
  wake();
}

/**
 * The header in the project view (Header.astro): the wordmark, a cross and the project's title,
 * kept centred, the wordmark sliding left by half the width of what follows it; or (null) the
 * wordmark alone. html[data-showing-project] is the project's id, for its info (ProjectInfo.astro).
 */
const wordmark = document.querySelector<HTMLElement>('[data-wordmark]')!;
const wordmarkProject = wordmark.querySelector<HTMLElement>('[data-header-project]')!;
function showProject(project: ClientProject | null): void {
  if (project === null) {
    delete document.documentElement.dataset.showingProject;
    return;
  }
  wordmarkProject.querySelector('[data-header-project-name]')!.textContent = project.title;
  wordmark.style.setProperty('--project-shift', `${wordmarkProject.offsetWidth / 2}px`);
  document.documentElement.dataset.showingProject = project.id;
}

/**
 * The focused view's project: zoomed in on the canvas, html[data-focused-project] is the active
 * image's project's id, for the info bar, whose hints for moving and the theme give way to the
 * project's (P and I: InfoBar.astro), and for the project's info, which "I" opens from here too
 * (ProjectInfo.astro). Kept up to date from the loop, which runs whenever any of it can change.
 */
let focusedProject: string | null = null;
function markFocus(): void {
  const active = zoomState === 'in' && route === 'home' && !intro && !flight ? renderer.activeImage() : null;
  const n = active ? projects.projectOf(active.image) : -1;
  const id = n >= 0 ? projects.projects[n]!.id : null;
  if (id === focusedProject) return;
  focusedProject = id;
  if (id) document.documentElement.dataset.focusedProject = id;
  else delete document.documentElement.dataset.focusedProject;
}

// The info bar's P (InfoBar.astro) does what the key does: the project view, or back out of it.
for (const trigger of document.querySelectorAll('[data-project-trigger]')) trigger.addEventListener('click', () => (projectView.isOpen ? closeProject() : openProject()));

/**
 * At rest on the canvas, the active image's project is readied in the page's next idle moment,
 * so "P" opens straight onto its images, decoded. (Tests can hold it off: once its images are
 * cached, tiles of the same images made from then on show those larger copies.)
 */
let readying = true;
function readyProject(): void {
  if (!readying) return;
  const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 200));
  idle(() => {
    // (Not while backed away for the menu: it is held there, not at rest.)
    if (awake || intro || flight || backing || route !== 'home') return;
    const active = renderer.activeImage();
    const n = active ? projects.projectOf(active.image) : -1;
    if (n >= 0) projectView.prepare(projects.projects[n]!, active!.image);
  });
}

/** Straight to the focused view on the copy of `image` nearest the view's centre, unseen under the project view. */
function focusOn(image: number): void {
  const cx = physics.x + geometry.vw / 2 / physics.z;
  const cy = physics.y + geometry.vh / 2 / physics.z;
  const copy = nearestCopy(image, cx, cy);
  if (!copy) return;
  physics.halt();
  zoomState = 'in';
  physics.setPaging(geometry.pitch);
  const z = focusZoom(copy);
  physics.jumpTo(copy.x - geometry.vw / 2 / z, copy.y - geometry.vh / 2 / z, z);
  draw(0, 0, true);
}

/** How far round a point to look for a copy of an image, in cells. */
const COPY_SEARCH = 24;

/** The centre (world px) and size of the copy of `image` nearest (x, y), or null if none is within COPY_SEARCH cells. */
function nearestCopy(image: number, x: number, y: number): { x: number; y: number; width: number; height: number } | null {
  const ci = Math.round(x / geometry.pitch);
  const cj = Math.round(y / geometry.pitch);
  let best: { x: number; y: number; width: number; height: number; d: number } | null = null;
  for (let i = ci - COPY_SEARCH; i <= ci + COPY_SEARCH; i++) {
    for (let j = cj - COPY_SEARCH; j <= cj + COPY_SEARCH; j++) {
      const cell = world.cell(i, j);
      if (cell.image !== image) continue;
      const cx = i * geometry.pitch + cell.dx * geometry.s;
      const cy = j * geometry.pitch + cell.dy * geometry.s;
      const d = Math.hypot(cx - x, cy - y);
      if (!best || d < best.d) best = { x: cx, y: cy, width: cell.w * geometry.s, height: cell.h * geometry.s, d };
    }
  }
  return best;
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (projectView.isOpen) closeProject();
    else openProject();
  } else if (e.key === 'Escape' && projectView.isOpen) {
    e.preventDefault();
    closeProject();
  }
});
// The header's Back in the project view (Header.astro) does what P and Esc do.
document.querySelector('[data-project-back]')!.addEventListener('click', () => closeProject());

/** The project label names the active image's project and its categories, zoomed out and in. */
function updateProjectLabel(): void {
  const active = renderer.activeImage();
  const n = active ? projects.projectOf(active.image) : -1;
  projectLabel.show(n < 0 ? null : { title: projects.projects[n]!.title, categories: categoriesOf[n]! });
}

/** Zooming onto another image, when the frame that stepped aside comes back. */
let frameTimer = 0;

/** 0 zoomed out to 1 zoomed in, from the actual zoom, so the fade follows the animation. */
const focusAt = (z: number) => {
  // All the way by the lowest zoom any image is focused at.
  const focused = zoomInFor(geometry, LONG * geometry.s, LONG * geometry.s, zoomIn);
  return focused > 1 ? Math.min(1, Math.max(0, (z - 1) / (focused - 1))) : 0;
};

/** The camera position that centres the image nearest the view centre; paging uses it to find neighbours. */
const nearest = { x: 0, y: 0, width: 0, height: 0 };
const snapper: Snapper = (x, y, z) => {
  nearestImageCentre(world, geometry, x + geometry.vw / 2 / z, y + geometry.vh / 2 / z, nearest);
  const to = focusZoom(nearest);
  return { x: nearest.x - geometry.vw / 2 / to, y: nearest.y - geometry.vh / 2 / to, z: to };
};

/** The zoom an image is focused at. */
const focusZoom = (image: { width: number; height: number }) => zoomInFor(geometry, image.width, image.height, zoomIn);

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
  zoomIn = zoomInLevel(geometry, window.devicePixelRatio, data.sharpEdge, ratios);
  physics.setZoomLimits(1, zoomIn, geometry.vw / 2, geometry.vh / 2);
  // The project view's column, a little wider than the focused view's longest image.
  projectView.setColumn(Math.min(PROJECT_COLUMN_MAX * geometry.vw, PROJECT_COLUMN * LONG * geometry.s * zoomIn));
  physics.centreX = geometry.vw / 2;
  physics.centreY = geometry.vh / 2;
}
applyZoomLimits();
// Start with the world origin in the middle of the screen.
physics.jumpTo(-geometry.vw / 2, -geometry.vh / 2, 1);

// A shared image link opens the canvas at its nearest copy.
const requestedImage = params.get('image');
const requestedIndex = requestedImage === null ? -1 : data.images.findIndex((image) => image.title === requestedImage);
const requestedCopy = requestedIndex >= 0 ? nearestCopy(requestedIndex, 0, 0) : null;
if (requestedCopy) physics.jumpTo(requestedCopy.x - geometry.vw / 2, requestedCopy.y - geometry.vh / 2, 1);

const now = () => ((document.timeline?.currentTime as number | null) ?? performance.now()) / 1000;

let awake = false;
const listeners = new Set<() => void>();

function draw(vx: number, vy: number, zoomAtRest: boolean): void {
  lens.relax = geometry.vw < ZOOM_NARROW ? focusAt(physics.renderZ) : 0;
  // Mid zoom-to, tiles keep their layout until it lands.
  renderer.update(physics.renderX, physics.renderY, physics.renderZ, vx, vy, zoomAtRest, physics.zoomingTo);
  frame.setRadius(geometry.radius * physics.renderZ);
}

/** At rest: no motion, no image still trailing, fading or still to be snapped to. */
const atRest = () => physics.isAtRest() && renderer.isAtRest();

/** The tile layer's scale about the centre: the intro's glide, or 1. */
let layerScale = 1;

// The glass edges, on the canvas and the about view: drawn last each frame, from the tiles and text as drawn. Tests ask for it with `?glass`.
const glass = GlassLayer.create(
  root,
  layer,
  new GlassText(document.querySelector<HTMLElement>('[data-about-layer]')!, document.querySelector<HTMLElement>('[data-about]')!),
  params.has('glass'),
  // (The window as it is: on the about view the canvas is only laid out again on the way back.)
  () => ({ tiles: renderer.glassTiles(), vw: root.clientWidth, vh: root.clientHeight, scale: layerScale }),
  () => awake,
);

function tick(): void {
  advance();
  glass?.draw();
}

function advance(): void {
  markFocus();
  if (backing) {
    stepBacking();
    return;
  }
  if (intro) {
    stepIntro();
    return;
  }
  if (flight) {
    stepFlight();
    return;
  }
  physics.advance(now());
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
  readyProject();
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
  renderer.prepare(rect, focusZoom(rect));
  // Onto another image than the framed one: the frame steps aside rather than chase it, and
  // comes back round it as it arrives.
  const active = renderer.activeRect();
  if (!active || active.left !== rect.left || active.top !== rect.top) {
    frame.conceal();
    clearTimeout(frameTimer);
    frameTimer = window.setTimeout(() => frame.reveal(), reducedMotion.matches ? 0 : ZOOM_DURATION * FOCUS_FRAME_RETURN * 1000);
  }
  physics.push(ZOOM_TO, t, rect.left + rect.width / 2, rect.top + rect.height / 2, focusZoom(rect), ZOOM_DURATION);
}

/** Zoom back out, keeping whatever is centred in place. */
function zoomOut(t: number): void {
  if (zoomState === 'out') return;
  zoomState = 'out';
  physics.setPaging(0);
  physics.push(ZOOM_TO, t, physics.tx + geometry.vw / 2 / physics.tz, physics.ty + geometry.vh / 2 / physics.tz, 1, ZOOM_DURATION);
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


attachInput({
  root,
  physics,
  wake,
  tap: tapAt,
  zoom: setZoom,
  toggleZoom,
  escape: zoomOut,
  enabled: () => !intro && !flight && !projectView.isOpen,
  // Backed away for the menu, nothing runs the camera: a scroll's momentum would only pile up,
  // to carry the view off from where it was the moment it is home.
  held: () => backing !== null,
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
  // Mid-flight (or backed away for the menu) the tiles are drawn from a snapshot; catch up once back.
  if (flight || backing) return;
  const next = computeGeometry(root.clientWidth, root.clientHeight, world, seen);
  const dprChanged = window.devicePixelRatio !== dpr;
  dpr = window.devicePixelRatio;
  if (!dprChanged && next.vw === geometry.vw && next.vh === geometry.vh) return;
  endIntro();
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
    nearestImageCentre(world, geometry, cx, cy, nearest);
    physics.push(ZOOM_TO, now(), cx, cy, focusZoom(nearest), STEP);
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
  if (document.hidden) {
    endIntro();
    sleep();
  } else wake();
});

/**
 * Views of one document: the canvas (`/`) and, off it, the about view (`/about`) and Start a
 * project (`/start`, empty for now). Going to one the camera flies on into the canvas, each image growing towards
 * it at its own depth and fading (flight.ts), until only the header is left; coming back the
 * flight runs in reverse, and browsing picks up exactly where it was. The view lives in the
 * URL (History API), so the browser's back and forward buttons run the same flight, and a
 * change of mind mid-flight turns it round from wherever it has got to.
 */
type Route = 'home' | View;
/** The views off the canvas, each flown to the same way, each a block in the one layer behind it (Site.astro), with its key (and hint: KeyHint.astro). */
type View = 'about' | 'start';
// All under the site's base: the root, or /outer-range/ on GitHub Pages.
const HOME = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const ROUTES: Record<Route, { path: string; title: string }> = {
  home: { path: HOME, title: 'Outer Range' },
  about: { path: `${HOME}about`, title: 'About · Outer Range' },
  start: { path: `${HOME}start`, title: 'Start a project · Outer Range' },
};
const VIEW_KEYS: Record<string, View> = { a: 'about', s: 'start' };
const routeAt = (path: string): Route => (Object.keys(ROUTES) as Route[]).find((r) => r !== 'home' && path.replace(/\/+$/, '') === ROUTES[r].path) ?? 'home';
let route: Route = routeAt(location.pathname);

/**
 * Opening the canvas, the camera is already flying down a tunnel of lines as a line of text
 * and then the controls rise and leave, then it speeds up into a wormhole that closes up into the tiles (intro.ts). The tiles lie ready under it the whole way, loading as they would; once the
 * lines are tiles the layer fades to them, and they glide in the rest of the way themselves.
 * The time goes on loading: once the images on screen are in the videos on screen are fetched,
 * so they are moving on arrival, and if the images aren't in by the launch it waits for them.
 * Anything the visitor does cuts it short: they get the canvas, and what they did counts.
 */
interface Intro {
  lines: IntroLayer;
  logo: IntroTitle;
  tagline: IntroTitle;
  /** Timed from its first frame, so the page's own start doesn't eat into it. */
  start: number | null;
  /** For tests: stay this many seconds in. */
  held: number | null;
  /** The real tiles have taken over. */
  gliding: boolean;
  /** The images on screen are in. */
  loaded: boolean;
  /** Set off, and how late, s. */
  launched: boolean;
  wait: number;
  frame: IntroFrame;
  /** The lines' colours, to rebuild the rays with the finer grids (refineIntro). */
  palette: readonly Rgb[];
  /** The rebuild, under way, and whether it is over, done or given up. */
  build: Generator<void, Float32Array> | null;
  refined: boolean;
  stop: AbortController;
}
let intro: Intro | null = null;

/** The page's background now (it follows the theme), 0 to 1 a channel. */
function pageBackground(): Rgb {
  const body = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  body.fillStyle = getComputedStyle(document.body).backgroundColor;
  body.fillRect(0, 0, 1, 1);
  const [r, g, b] = body.getImageData(0, 0, 1, 1).data as unknown as [number, number, number];
  return [r / 255, g / 255, b / 255];
}

/** The colours the tunnel's lines are drawn in: the work's, those that show up on `background`. */
const linePalette = (background: Rgb) => introPalette(data.images.flatMap((image) => pixelColors(image.pixels).filter((_, n) => n % 16 === 0)), background);

function startIntro(): void {
  const background = pageBackground();
  const palette = linePalette(background);
  const instances = introInstances(renderer.introTiles(INTRO_FARTHEST), palette, geometry.vw, geometry.vh, SEED);
  const lines = IntroLayer.create(root, instances, background, geometry.vw, geometry.vh, Z_LEVELS + 2, params.has('test'));
  if (!lines) return;
  const stop = new AbortController();
  for (const type of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(type, endIntro, { capture: true, passive: true, signal: stop.signal });
  intro = { lines, logo: IntroTitle.logo(root, Z_LEVELS + 3), tagline: IntroTitle.tagline(root, Z_LEVELS + 3), start: null, held: null, gliding: false, loaded: false, launched: false, wait: 0, frame: { z: 0, tail: 0, scale: 0, closed: 0, corners: 0, fade: 0, rays: 0, lines: 0, flight: 0, back: 0, aberration: 0, handover: 0 }, palette, build: null, refined: false, stop };
  lines.draw(introFrame(0, intro.frame));
  intro.logo.draw(0);
  intro.tagline.draw(0);
  frame.conceal();
}

function stepIntro(): void {
  const i = intro!;
  const t = now();
  i.start ??= t;
  const at = i.held ?? t - i.start;
  if (!i.loaded && renderer.visibleLoaded()) {
    i.loaded = true;
    if (!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) renderer.readyVideos();
  }
  refineIntro(i);
  if (!i.launched) {
    i.wait = i.held === null ? Math.max(0, at - INTRO_CRUISE) : 0;
    i.launched = i.held !== null || (at >= INTRO_CRUISE && (i.loaded || i.wait >= INTRO_WAIT));
  }
  if (at >= INTRO_LENGTH + i.wait) return endIntro();
  const f = introFrame(at, i.frame, i.wait);
  i.logo.draw(at);
  i.tagline.draw(at);
  if (f.z <= INTRO_HANDOVER && !i.gliding) {
    i.gliding = true;
    i.lines.leave();
    delete document.documentElement.dataset.intro;
    layer.style.willChange = 'transform';
    playVideos();
  }
  if (i.gliding) {
    layerScale = Number(f.scale.toFixed(5));
    layer.style.transform = `scale(${layerScale})`;
  }
  i.lines.draw(f);
}

/** A frame's share of the intro's refining, ms: well inside a frame at 120 Hz, beside the drawing. */
const REFINE_BUDGET = 3;

/**
 * Once the images are in, while their rays are still held back, rebuild the rays from the images,
 * finer (FLIGHT_GRID_FINER): sampled and put a little each frame, never a frame's worth at once.
 * If the rays come out before it's done, they stay as they were.
 */
function refineIntro(i: Intro): void {
  if (!i.loaded || i.refined) return;
  if (i.frame.rays > 0) {
    i.refined = true;
    return;
  }
  // (The clock, not now(): that is the frame's time, which stands still while it is worked on.)
  const until = performance.now() + REFINE_BUDGET;
  if (!i.build) {
    if (!renderer.sampleOnScreen(REFINE_BUDGET)) return;
    i.build = introBuild(renderer.introTiles(INTRO_FARTHEST, true, false), i.palette, geometry.vw, geometry.vh, SEED);
  }
  while (performance.now() < until) {
    const step = i.build.next();
    if (step.done) {
      i.lines.load(step.value, geometry.vw, geometry.vh);
      i.refined = true;
      return;
    }
  }
}

function endIntro(): void {
  if (!intro) return;
  intro.lines.leave();
  intro.logo.remove();
  intro.tagline.remove();
  intro.stop.abort();
  intro = null;
  delete document.documentElement.dataset.intro;
  layerScale = 1;
  layer.style.transform = '';
  layer.style.willChange = '';
  frame.reveal();
  playVideos();
  wake();
  readyFlightRays();
}

/** Videos play on the canvas, unless motion is to be reduced: then each holds its poster frame. */
function playVideos(): void {
  // (Under the project view they hold still: no one sees them.)
  renderer.setVideos(!reducedMotion.matches && route === 'home' && !projectView.isShown && (!intro || intro.gliding));
}

/** How far the flight has got, 0 (the canvas) to 1 (every image flown past), and which way it is going. */
interface Flight {
  u: number;
  to: 0 | 1;
  last: number;
}
let flight: Flight | null = null;
/** For tests: hold the flight this far along. */
let flightHeld: number | null = null;
/**
 * The menu's flight (Menu.astro): how far the camera has backed away, 0 (as it was) to MENU_BACK
 * (behind the open menu), and which way it is going. Each leg runs from wherever the last one
 * left off (`from`), `p` of the way along its own ease. See backAway.
 */
interface Backing {
  back: number;
  from: number;
  to: 0 | 1;
  p: number;
  last: number;
}
let backing: Backing | null = null;

function go(next: Route): void {
  if (next === route) return;
  endIntro();
  // (The browser's back button, under the open menu: back at once, to fly from there.)
  if (backing) {
    Object.assign(backing, { back: 0, from: 0, to: 0, p: 1 });
    stepBacking();
  }
  // (The header link and "A" work from the project view too: it fades as the flight sets off.)
  closeProject(null, true);
  const from = route;
  route = next;
  document.title = ROUTES[next].title;
  showLink(next);
  showAbout(next !== 'home');
  playVideos();
  if (next === 'home') {
    if (flight) turn(0);
  } else if (from === 'home') {
    leaveCanvas();
  }
  // (From one view to another the canvas stays flown past; the layer shows the other: showAbout.)
}

/** Send the flight on (1) or back (0) from wherever it has got to. */
function turn(to: 0 | 1): void {
  root.style.visibility = '';
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
  beginFlight();
  flight = { u: 0, to: 1, last: now() };
  wake();
}

function stepFlight(): void {
  const f = flight!;
  const t = now();
  const still = reducedMotion.matches;
  const duration = still ? FLIGHT_REDUCED_DURATION : f.to === 1 ? FLIGHT_DURATION : FLIGHT_RETURN_DURATION;
  f.u = flightHeld ?? Math.min(1, Math.max(0, f.u + ((f.to === 1 ? 1 : -1) * (t - f.last)) / duration));
  renderer.relaxFlight(t - f.last);
  f.last = t;
  const travel = flightTravel(f.u);
  const rays = !still && flightRays !== null;
  renderer.drawFlight(travel, still, rays ? flightHandover(f.u) : 1);
  drawAbout(travel, still);
  if (rays) flightRays!.draw(flightFrame(f.u, f.to, rayFrame));
  if (f.u !== f.to) return;
  // Flown past: only the header is left, and nothing to draw until it turns back.
  if (f.to === 1) {
    root.style.visibility = 'hidden';
    return sleep();
  }
  // Back where it was: browse on from exactly here.
  flightRays?.hide();
  renderer.endFlight();
  aboutLayer.removeAttribute('style');
  flight = null;
  delete document.documentElement.dataset.leaving;
  relayout();
  resettle(t);
}

/**
 * The flight's rays (flight.ts): drawn with the intro's layer, made once and kept, as making
 * it costs a frame or two. Null until then, or where it can't be drawn: the flight is just the images.
 */
let flightRays: IntroLayer | null = null;
let raysTried = false;
const rayFrame: IntroFrame = { z: 0, tail: 0, scale: 1, closed: 1, corners: 1, fade: 0, rays: 0, lines: 0, flight: 1, back: 0, aberration: 0, handover: 0 };

function makeFlightRays(): void {
  if (raysTried || reducedMotion.matches) return;
  raysTried = true;
  // Only where it is smooth: a software renderer (tests run on one) draws a frame of it in a fifth of a second. Tests ask for it with `?rays`.
  // One invisible ray, drawn once now, so the first flight doesn't wait on the GPU getting it ready.
  flightRays = IntroLayer.create(root, new Float32Array(INTRO_STRIDE), null, geometry.vw, geometry.vh, Z_LEVELS + 2, params.has('rays'));
  flightRays?.draw(rayFrame);
  flightRays?.hide();
}

/** Make the rays' layer when the page has a moment, a little after it opens. */
function readyFlightRays(): void {
  window.setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(makeFlightRays, { timeout: 2000 }) : makeFlightRays()), 1000);
}

/** Set the flight off from the tiles as drawn now, and their rays with them. */
function beginFlight(): void {
  renderer.beginFlight();
  makeFlightRays();
  flightRays?.load(flightInstances(renderer.introTiles(1, true), linePalette(pageBackground()), geometry.vw, geometry.vh, SEED), geometry.vw, geometry.vh);
}

/** Back from a flight: finish settling into the zoom state, on an image's centre when zoomed in. */
function resettle(t: number): void {
  const cx = physics.x + geometry.vw / 2 / physics.z;
  const cy = physics.y + geometry.vh / 2 / physics.z;
  if (zoomState === 'in') nearestImageCentre(world, geometry, cx, cy, nearest);
  const z = zoomState === 'in' ? focusZoom(nearest) : 1;
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
  if (zoomState === 'in') nearestImageCentre(world, geometry, view.cx * geometry.s, view.cy * geometry.s, nearest);
  const z = zoomState === 'in' ? focusZoom(nearest) : 1;
  physics.jumpTo(view.cx * geometry.s - geometry.vw / 2 / z, view.cy * geometry.s - geometry.vh / 2 / z, z);
  if (zoomState === 'in') physics.setPaging(geometry.pitch);
  return true;
}

/**
 * Dev only: until when a reload comes back to the saved view instead of playing the intro,
 * set as "X" deletes an image (devdelete.ts). A time, not a one-off flag, so it covers both the
 * dev server's own reload and the one devdelete.ts makes after it.
 */
const DEV_RESUME_KEY = 'canvas:dev-resume';
const DEV_RESUME_FOR = 10_000;
function devResuming(): boolean {
  try {
    return Date.now() < Number(sessionStorage.getItem(DEV_RESUME_KEY) ?? 0);
  } catch {
    return false;
  }
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
  // The text under the glass moves with it. (Mid-flight the canvas's loop draws it.)
  onUpdate: () => {
    if (!awake) glass?.draw();
  },
});
reducedMotion.addEventListener('change', () => smoother.smooth(smoothing()));
const far: FlightView = { scale: 1, opacity: 1, blur: 0 };
// Avoid filtering the tall, scaled text surface on mobile WebKit: its composited
// edges can flash as a pale rectangle. Touch keeps the perspective and fade.
const touchAbout = matchMedia('(hover: none) and (pointer: coarse)');

/** Which view is showing; the other is inert: no clicks, focus or scrolls. */
function showAbout(on: boolean): void {
  about.inert = !on;
  root.inert = on;
  if (!on) {
    // (It keeps showing the view it was on, as the canvas flies back in over it.)
    delete about.dataset.state;
    return;
  }
  const switching = about.dataset.state === 'in' && about.dataset.view !== route;
  about.dataset.state = 'in';
  about.dataset.view = route;
  if (!switching) return;
  // From one view straight to another: the new one fades in, from the top.
  smoother.scrollTo(0, false);
  if (!reducedMotion.matches) about.querySelector(`[data-view-content="${route}"]`)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
}

/**
 * Draw the about text as the far plane with the camera `travel` in (flightFar): coming
 * towards the camera from behind the canvas as it flies in, receding as it flies back.
 * `still` (reduced motion): it only fades.
 */
function drawAbout(travel: number, still: boolean): void {
  placeAbout(flightFar(travel, far), still);
}

/** Draw the about view's text as `v` says. */
function placeAbout(v: FlightView, still: boolean): void {
  // About the viewport's centre, however far down the text is scrolled (and wherever the smooth
  // scroll has carried it): the content moves the layer up by its offset, so the centre is that
  // far further down the layer.
  const top = aboutContent.getBoundingClientRect().top;
  aboutLayer.style.transformOrigin = `50% ${(innerHeight / 2 - top).toFixed(1)}px`;
  aboutLayer.style.opacity = v.opacity.toFixed(3);
  aboutLayer.style.transform = still || v.scale === 1 ? '' : `scale(${v.scale.toFixed(4)})`;
  // The blur is drawn before the scale: ask for the share that comes out at v.blur on screen.
  const blur = still || touchAbout.matches ? 0 : v.blur / v.scale;
  aboutLayer.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : '';
}

// The menu (Menu.astro) says when it opens and closes. Opening, the camera backs away from
// whatever is showing, the About flight the other way round: the canvas's images drawn in
// towards the centre, each by its depth, blurring and dimming (flight.ts, menuBackView), or the
// about view's text with them. Closing, it all comes back to exactly where it was.
window.addEventListener('menu', (e) => backAway((e as CustomEvent<boolean>).detail, 'menu'));

// In the project view the canvas is backed away already: there it is the view that backs away,
// one step further into the distance (projectview.ts, backAway), under the menu or the project's
// info (ProjectInfo.astro), and comes home once neither is open.
const overProject = new Set<'menu' | 'info'>();
function backProject(open: boolean, who: 'menu' | 'info'): void {
  if (open) overProject.add(who);
  else overProject.delete(who);
  projectView.backAway(overProject.size > 0);
}
window.addEventListener('menu', (e) => backProject((e as CustomEvent<boolean>).detail, 'menu'));
// The project's info (ProjectInfo.astro): the project view backs away behind it, or, opened from the focused view, the canvas does, as for the menu.
window.addEventListener('info', (e) => {
  const open = (e as CustomEvent<boolean>).detail;
  backProject(open, 'info');
  if (!open || !projectView.isOpen) backAway(open, 'info');
});

/** What holds the canvas backed away: the menu, the project view (openProject), the project's info opened from the focused view, or more than one. It comes home once none does. */
const backers = new Set<'menu' | 'project' | 'info'>();

function backAway(open: boolean, who: 'menu' | 'project' | 'info'): void {
  if (open) backers.add(who);
  else backers.delete(who);
  open = backers.size > 0;
  if (backing) {
    const to = open ? 1 : 0;
    if (to === backing.to) return;
    // Turned round: a new leg, from wherever it has got to.
    Object.assign(backing, { from: backing.back, to, p: 0, last: now() });
    return wake();
  }
  if (!open) return;
  endIntro();
  // A flight under way lands at once, so there is one place to back away from.
  if (flight && flight.u !== flight.to) {
    flightHeld = flight.to;
    stepFlight();
    flightHeld = null;
  }
  physics.halt();
  if (route === 'home') {
    renderer.beginFlight();
    // The frame fades, as it does for a flight.
    document.documentElement.dataset.leaving = '';
  }
  backing = { back: 0, from: 0, to: 1, p: 0, last: now() };
  wake();
}

function stepBacking(): void {
  const b = backing!;
  const t = now();
  const still = reducedMotion.matches;
  const target = b.to * MENU_BACK;
  const duration = legDuration(b);
  b.p = duration > 0 ? Math.min(1, b.p + (t - b.last) / duration) : 1;
  b.last = t;
  b.back = b.from + (target - b.from) * menuBackEase(b.to === 1, b.p);
  if (route !== 'home') placeAbout(menuBackView(MENU_BACK_ABOUT, b.back, far), still);
  else renderer.drawFlight(b.back, still, 1, menuBackView);
  if (b.p < 1) return;
  // Backed away: held there, behind the menu, until it closes.
  if (b.to === 1) return sleep();
  // Back where it was: browse on from exactly here.
  backing = null;
  if (route !== 'home') {
    drawAbout(flightTravel(1), still);
  } else {
    renderer.endFlight();
    if (!flight) delete document.documentElement.dataset.leaving;
    relayout();
    resettle(t);
  }
}

/**
 * How long a leg of the backing takes, s: away as the flight goes; home slower, landing gently
 * (MENU_RETURN_DURATION). A leg that starts part of the way takes that share of the time.
 */
function legDuration(b: Backing): number {
  const whole = reducedMotion.matches ? FLIGHT_REDUCED_DURATION : b.to === 1 ? FLIGHT_DURATION : MENU_RETURN_DURATION;
  return (Math.abs(b.to * MENU_BACK - b.from) / MENU_BACK) * whole;
}

/** The leg under way, its time (s) and ease, for what moves with it: the project view's image. */
function backingLeg(): Leg {
  const b = backing!;
  return { duration: legDuration(b), easing: `cubic-bezier(${(b.to === 1 ? FLIGHT_EASE : MENU_RETURN_EASE).join(', ')})` };
}

/** The canvas home at once, if it is backed away: unseen under the project view. */
function homeAtOnce(): void {
  if (!backing) return;
  Object.assign(backing, { back: 0, from: 0, to: 0, p: 1 });
  stepBacking();
}

// The views' hints (KeyHint.astro): the header's About link and the info bar's Start a project.
const link = document.querySelector<HTMLAnchorElement>('a[data-route-link]')!;

/** Show `r` open on its hint, and closed on the others: their labels slide, ESC joining or leaving the key. */
function showLink(r: Route): void {
  link.href = r === 'about' ? ROUTES.home.path : ROUTES.about.path;
  for (const view of Object.values(VIEW_KEYS)) setHint(view, view === r);
}

// Plain clicks and Enter go between the views; modified ones (new tab, new window) open the link as usual.
link.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  // (Any query, like ?debug or ?flat, carries over.)
  toggleView('about');
});

// The menu's links to views (Menu.astro): there, unless it is showing already.
window.addEventListener('view', (e) => {
  const view = (e as CustomEvent<string>).detail;
  if ((view === 'about' || view === 'start') && view !== route) toggleView(view);
});

// The info bar's Start a project (InfoBar.astro): what "S" does, to the view or back from it.
for (const viewLink of document.querySelectorAll<HTMLAnchorElement>('a[data-view-link]')) {
  viewLink.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    toggleView(viewLink.dataset.viewLink as View);
  });
}

/** What a view's link or key does: go to it, or, on it, back to the canvas. */
function toggleView(view: View): void {
  if (route === view) return backToCanvas();
  // Back from it goes back to the canvas through history, if that is where it came from.
  history.pushState({ canvas: route === 'home' }, '', ROUTES[view].path + location.search);
  go(view);
}

/** From a view back to the canvas, as it was left (zoomed in or out). */
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
  // The about text's colours fade (global.css) under the glass too.
  glass?.liveFor(0.35);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage blocked: it switches, but isn't kept.
  }
});

// Each view's key (VIEW_KEYS: "A", About; "S", Start a project) goes to it, or back from it, as its hint says.
window.addEventListener('keydown', (e) => {
  const view = VIEW_KEYS[e.key.toLowerCase()];
  if (!view || e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  toggleView(view);
});

// Esc on a view goes back too, as its hint says. (On the canvas it backs out of the focused view: input.ts.)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || e.defaultPrevented || route === 'home') return;
  e.preventDefault();
  backToCanvas();
});
// The browser's back and forward buttons, including back after a reload of the about view.
window.addEventListener('popstate', () => go(routeAt(location.pathname)));

const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
// Opened on the about view, or a reloaded tab coming back to the canvas: start flown past, in the view it was left in.
const arriving = route === 'home' && navigation?.type === 'back_forward' && restoreView();
if (route !== 'home') restoreView();
if (route !== 'home' || arriving) document.documentElement.dataset.leaving = '';
// Dev only: reloaded after "X" deleted an image (devdelete.ts), back in the view it was in, with no intro.
const resumed = import.meta.env.DEV && route === 'home' && !arriving && devResuming() && restoreView();

// First frame now, so tiles are in place before the first paint.
draw(0, 0, true);
if (route !== 'home' || arriving) {
  beginFlight();
  flight = { u: 1, to: 1, last: now() };
  renderer.drawFlight(flightTravel(1), reducedMotion.matches);
  drawAbout(flightTravel(1), reducedMotion.matches);
  // Coming back to the canvas: fly in.
  if (arriving) turn(0);
  else root.style.visibility = 'hidden';
} else {
  // A fresh load of the canvas, not a return to it. Tests ask for it with `?intro`.
  const opening = !resumed && navigation?.type !== 'back_forward' && !reducedMotion.matches && !document.hidden && (!params.has('test') || params.has('intro'));
  if (opening) startIntro();
  if (!intro) readyFlightRays();
  wake();
}
if (!intro) delete document.documentElement.dataset.intro;
playVideos();
glass?.draw();

// Dev only, and out of the built site: "X" deletes the active image for good (devdelete.ts).
if (import.meta.env.DEV) {
  import('./devdelete').then((m) =>
    m.attachDevDelete({
      images: data.images,
      activeImage: () => renderer.activeImage(),
      onCanvas: () => route === 'home' && !flight && !projectView.isOpen,
      holdView: (hold) => {
        if (hold) saveView();
        try {
          if (hold) sessionStorage.setItem(DEV_RESUME_KEY, String(Date.now() + DEV_RESUME_FOR));
          else sessionStorage.removeItem(DEV_RESUME_KEY);
        } catch {
          // Storage blocked: the reload plays the intro.
        }
      },
    }),
  );
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
    /** The menu's flight: how far the camera has backed away, and which way it is going, or null. */
    backing: () => (backing ? { u: backing.back / MENU_BACK, to: backing.to } : null),
    holdFlight: (u: number | null) => {
      flightHeld = u;
      wake();
    },
    /** Whether the intro is playing; hold it this many seconds in to look at it. */
    intro: () => intro !== null,
    holdIntro: (at: number) => {
      if (intro) intro.held = at;
    },
    activeImage: () => renderer.activeImage(),
    /** The project view's project, while it is open, or null. */
    project: () => projectView.project,
    /** Ready the project view for "P" while the canvas is idle, or not. */
    readyProjects: (on: boolean) => {
      readying = on;
    },
    /** At rest, every image back on its grid position, and every on-screen image decoded. */
    isSettled: () => !intro && atRest() && renderer.visibleLoaded(),
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
