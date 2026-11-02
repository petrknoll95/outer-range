import { gsap } from 'gsap';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { FocusCaption } from './caption';
import { FLIGHT_DURATION, FOCUS_FRAME_RETURN, FLIGHT_REDUCED_DURATION, FLIGHT_RETURN_DURATION, INTRO_HANDOVER, INTRO_TITLE, SEED, STEP, ZOOM_DURATION } from './config';
import type { FlightView } from './flight';
import { flightFar, flightTravel } from './flight';
import { centerDelta, focusDuration, nearestImageCentre } from './focus';
import { FocusFrame } from './focusframe';
import { attachInput } from './input';
import type { IntroFrame } from './intro';
import { INTRO_LENGTH, introFrame, introInstances, introPalette } from './intro';
import { IntroLayer } from './introlayer';
import { IntroTitle } from './introtitle';
import type { CellRect, Geometry } from './layout';
import { computeGeometry, sizingReach, zoomInLevel } from './layout';
import { DEFAULT_LENS, Lens } from './lens';
import type { Snapper } from './physics';
import { CameraPhysics, GLIDE, ZOOM_TO } from './physics';
import { ProjectLabel } from './projectlabel';
import type { Guest } from './project';
import { clusterBounds, projectGuests } from './project';
import type { ClientProject } from './projects';
import { createProjectIndex } from './projects';
import type { CameraStep, CanvasData } from './renderer';
import { pixelColors } from './pixels';
import { Renderer } from './renderer';
import { createWorld, Z_LEVELS } from './world';

const root = document.querySelector<HTMLElement>('[data-canvas]')!;
const layer = root.querySelector<HTMLElement>('[data-canvas-layer]')!;
const data = JSON.parse(document.getElementById('canvas-data')!.textContent!) as CanvasData & { projects: ClientProject[] };
const projects = createProjectIndex(data.projects, data.images.length);

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
// Zoomed in, the active image's category and alt text below it.
const caption = new FocusCaption(document.body);
// The active image's project, above the frame, zoomed out and in.
const projectLabel = new ProjectLabel(frame.el);
renderer.onActiveChange = (tile) => {
  frame.focus(tile);
  updateCaption();
  updateProjectLabel();
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
  const still = zoomState === 'in' && !flight && !project && physics.isStill() && renderer.isAtRest() && !frame.moving;
  const active = still ? renderer.activeImage() : null;
  caption.show(active ? data.images[active.image]! : null);
}

/**
 * The project view (project.ts): "P" in the focused view narrows the canvas to the focused
 * image's project. The camera draws back from the focused image, the cells round it take the
 * rest of the project, each image gliding in from where its nearest copy is on the canvas, and
 * everything else fades away: a small canvas of the project alone.
 *
 * Landed, it is browsed like the canvas, dragged and scrolled, though the project is kept in
 * view (keepProjectInView) and its images trail less than they do there. Leaving sends the images back
 * where they came from as the camera returns, from wherever it has got to: "P" or Esc, to the
 * image the view was opened on; focusing one of the images (a click, Space, zooming in), to
 * that one, following it back to where it really is on the canvas and landing in the focused
 * view on it.
 *
 * One progress drives the way in and out, camera included, so the images move in step with the
 * zoom: a critically damped spring chasing a goal that itself eases towards 1 (in) or 0 (out).
 * The goal sets off gently, so the motion does too, building up rather than kicking off at full
 * acceleration as a bare spring would; changing direction mid-way keeps the spring's momentum
 * and turns smoothly, never jumping. The canvas ignores input until it lands.
 */
/** The spring's and its goal's rates, 1/s: together they settle in about 0.9 s. */
const PROJECT_RATE = 10;
const PROJECT_GOAL_RATE = 10;
/** Of the window the project may fill, and how much is kept clear above and below for the header and info bar, px. */
const PROJECT_FILL = 0.84;
const PROJECT_CLEAR = 72;
/** Landed, how close to the window's sides the project may be left, px. */
const PROJECT_MARGIN = 24;
/**
 * The furthest the camera draws back for it. A big project needs further than the canvas's own
 * zoomed-out view (zoom 1): its cluster is wider than the screen there.
 */
const PROJECT_MIN_ZOOM = 0.4;
/** With reduced motion nothing moves: it only fades, this long, s. */
const PROJECT_FADE = 0.25;

interface ProjectState {
  guests: Guest[];
  /** Round its images, world px: the camera's centre is kept inside it. */
  bounds: CellRect;
  /** The camera's centre (world px) and zoom on the focused image it was opened on; where the way out ends (there, or leaving onto another image, on that one); and on the whole project. */
  home: { x: number; y: number; z: number };
  from: { x: number; y: number; z: number };
  overview: { x: number; y: number; z: number };
  /** Where the way in lands: the overview, or, coming back after turning round, where it was left. */
  to: { x: number; y: number; z: number };
  /** Landed: the camera is the canvas's own again, and takes input. */
  free: boolean;
  /** The spring: where it is (0 the focused view, 1 the project), how fast it is going, and the goal it chases. */
  u: number;
  v: number;
  goal: number;
  target: 0 | 1;
  last: number;
}
let project: ProjectState | null = null;
const projectMoving = () => project !== null && (project.u !== project.target || project.v !== 0);
/** Moving perceptibly: short of the last few thousandths the spring takes to come fully to rest. */
const projectInMotion = () => project !== null && (Math.abs(project.target - project.u) > 0.003 || Math.abs(project.v) > 0.03);

function openProject(): void {
  if (project) {
    // Mid-way out: turn back in.
    if (project.target === 0) setProjectTarget(1);
    return;
  }
  if (zoomState !== 'in' || flight) return;
  const active = renderer.activeImage();
  const rect = renderer.activeRect();
  const n = active ? projects.projectOf(active.image) : -1;
  if (!active || !rect || n < 0) return;
  const members = projects.projects[n]!.images;
  const at = members.indexOf(active.image);
  const others = [...members.slice(at + 1), ...members.slice(0, at)];
  // With no copy near, a guest comes from a screen-width off in its direction.
  const guests = projectGuests(world, geometry, active.i, active.j, others, (k) => data.images[k]!.aspect, geometry.vw / zoomIn);
  const bounds = clusterBounds(rect, guests);
  const z = physics.z;
  const fit = Math.min((geometry.vw * PROJECT_FILL) / bounds.width, ((geometry.vh - 2 * PROJECT_CLEAR) * PROJECT_FILL) / bounds.height);
  const overview = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, z: Math.min(z, Math.max(PROJECT_MIN_ZOOM, fit)) };
  project = {
    guests,
    bounds,
    home: { x: physics.x + geometry.vw / 2 / z, y: physics.y + geometry.vh / 2 / z, z },
    from: { x: physics.x + geometry.vw / 2 / z, y: physics.y + geometry.vh / 2 / z, z },
    overview,
    to: overview,
    free: false,
    u: 0,
    v: 0,
    goal: 0,
    target: 1,
    last: now(),
  };
  // The camera is placed from the progress alone: no paging snap, no trails.
  physics.setPaging(0);
  renderer.setTrails(false);
  renderer.setProject(guests, active, rect.left + rect.width / 2, rect.top + rect.height / 2, overview.z);
  document.documentElement.dataset.project = 'open';
  playVideos();
  updateCaption();
  wake();
}

/** Leave the project view: back to the image it was opened on, or (landed) onto the one of its images at `onto`. */
function closeProject(onto: CellRect | null = null): void {
  if (project?.target !== 1) return;
  if (project.free) unland(onto);
  setProjectTarget(0);
}

/** Landed: the camera and input are the canvas's again, at the overview's zoom (zooming in leaves: see zoomInOn). */
function land(): void {
  const p = project!;
  p.free = true;
  // (Turned back on its way out onto another image: leaving is back to the first again.)
  p.from = p.home;
  zoomState = 'out';
  physics.setZoomLimits(Math.min(p.overview.z, physics.z), Math.max(p.overview.z, physics.z), geometry.vw / 2, geometry.vh / 2);
  physics.setPaging(0);
  renderer.projectFree = true;
  renderer.setTrails(!reducedMotion.matches);
  updateCaption();
}

/**
 * Leaving after browsing: the spring takes the camera back from wherever it is now, to the image
 * it was opened on or onto the one at `onto`. Onto a guest, the camera ends on its copy, where the
 * guest goes back to: it follows the image home.
 */
function unland(onto: CellRect | null): void {
  const p = project!;
  physics.halt();
  const z = physics.z;
  p.free = false;
  p.to = { x: physics.x + geometry.vw / 2 / z, y: physics.y + geometry.vh / 2 / z, z };
  const guest = onto && p.guests.find((g) => g.to.left === onto.left && g.to.top === onto.top);
  if (guest?.copy) {
    p.from = { x: guest.from.left + guest.from.width / 2, y: guest.from.top + guest.from.height / 2, z: zoomIn };
    // Sharp all the way in, as when zooming in on the canvas.
    renderer.prepare(onto!, zoomIn);
  }
  p.u = p.goal = 1;
  p.v = 0;
  physics.setPaging(0);
  renderer.projectFree = false;
  renderer.setTrails(false);
  // The frame goes with it to the image it lands on.
  renderer.projectFocus(guest?.copy ? onto : null);
  clearTimeout(frameTimer);
  frame.reveal();
  updateCaption();
}

/**
 * The project is kept in view: let go with any of it off screen (or under the header or info
 * bar), it glides back until all of it is in view again, and only as far as that.
 */
function keepProjectInView(t: number): void {
  const { bounds } = project!;
  const z = physics.z;
  // The range of camera centres that show it all, per axis (its middle, if it can't all show).
  const keep = (start: number, size: number, half: number, at: number) => {
    const lo = start + size - half;
    const hi = start + half;
    return lo > hi ? start + size / 2 - at : Math.min(hi, Math.max(lo, at)) - at;
  };
  const cx = physics.x + geometry.vw / 2 / z;
  const cy = physics.y + geometry.vh / 2 / z;
  const dx = keep(bounds.left, bounds.width, (geometry.vw / 2 - PROJECT_MARGIN) / z, cx) * z;
  const dy = keep(bounds.top, bounds.height, (geometry.vh / 2 - PROJECT_CLEAR) / z, cy) * z;
  if (Math.hypot(dx, dy) > 0.5) physics.push(GLIDE, t, dx, dy, focusDuration(Math.hypot(dx, dy)));
}

function setProjectTarget(target: 0 | 1): void {
  project!.target = target;
  project!.last = now();
  document.documentElement.dataset.project = target === 1 ? 'open' : 'closing';
  playVideos();
  wake();
}

/** One frame of the project view: the spring on, and the camera and images placed from it. */
function stepProject(t: number): void {
  const p = project!;
  const dt = Math.min(0.05, Math.max(0, t - p.last));
  p.last = t;
  let place: number;
  if (reducedMotion.matches) {
    p.u = p.goal = Math.min(1, Math.max(0, p.u + (Math.sign(p.target - p.u) * dt) / PROJECT_FADE));
    p.v = 0;
    place = p.target;
  } else {
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      p.goal += (p.target - p.goal) * PROJECT_GOAL_RATE * h;
      p.v += (PROJECT_RATE ** 2 * (p.goal - p.u) - 2 * PROJECT_RATE * p.v) * h;
      p.u += p.v * h;
    }
    if (Math.abs(p.target - p.u) < 5e-4 && Math.abs(p.v) < 5e-3 && Math.abs(p.target - p.goal) < 5e-4) {
      p.u = p.goal = p.target;
      p.v = 0;
    }
    p.u = Math.min(1, Math.max(0, p.u));
    place = p.u;
  }
  // The camera: its centre straight across, its zoom evenly in log space, both by the same progress.
  const z = Math.exp(Math.log(p.from.z) + (Math.log(p.to.z) - Math.log(p.from.z)) * place);
  const cx = p.from.x + (p.to.x - p.from.x) * place;
  const cy = p.from.y + (p.to.y - p.from.y) * place;
  physics.jumpTo(cx - geometry.vw / 2 / z, cy - geometry.vh / 2 / z, z);
  renderer.projectProgress = p.u;
  renderer.projectPlace = place;
  // Landed (or setting off): the videos play, or hold.
  playVideos();
  if (p.target === 0 && p.u === 0) endProject();
  else if (p.target === 1 && p.u === 1 && p.v === 0) land();
}

/** Back in the focused view, exactly as it was (at once, if it was still going). */
function endProject(): void {
  const p = project;
  if (!p) return;
  project = null;
  zoomState = 'in';
  physics.halt();
  physics.jumpTo(p.from.x - geometry.vw / 2 / p.from.z, p.from.y - geometry.vh / 2 / p.from.z, p.from.z);
  physics.setZoomLimits(1, zoomIn, geometry.vw / 2, geometry.vh / 2);
  physics.setPaging(geometry.pitch);
  renderer.setProject(null);
  renderer.projectProgress = 0;
  renderer.projectPlace = 0;
  renderer.projectFree = false;
  renderer.setTrails(!reducedMotion.matches);
  clearTimeout(frameTimer);
  frame.reveal();
  delete document.documentElement.dataset.project;
  playVideos();
  updateCaption();
  wake();
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (project?.target === 1) closeProject();
    else openProject();
  } else if (e.key === 'Escape' && project?.target === 1 && !project.free) {
    // On its way in. (Landed, Esc is the canvas's: see backOut.)
    e.preventDefault();
    closeProject();
  }
});

/** The project label names the active image's project, zoomed out and in. */
function updateProjectLabel(): void {
  const active = renderer.activeImage();
  const n = active ? projects.projectOf(active.image) : -1;
  projectLabel.show(n < 0 ? null : projects.projects[n]!.title);
}

/** Zooming onto another image, when the frame that stepped aside comes back. */
let frameTimer = 0;

/** 0 zoomed out (to the project's overview, in the project view) to 1 zoomed in, from the actual zoom, so the fade follows the animation. */
const focusAt = (z: number) => {
  const out = project ? project.overview.z : 1;
  return zoomIn > out ? Math.min(1, Math.max(0, (z - out) / (zoomIn - out))) : 0;
};

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

// A shared image link opens the canvas at its nearest copy.
const requestedImage = params.get('image');
const requestedIndex = requestedImage === null ? -1 : data.images.findIndex((image) => image.title === requestedImage);
if (requestedIndex >= 0) {
  let nearestCell: { x: number; y: number; distance: number } | null = null;
  for (let i = -24; i <= 24; i++) {
    for (let j = -24; j <= 24; j++) {
      const cell = world.cell(i, j);
      if (cell.image !== requestedIndex) continue;
      const x = i * geometry.pitch + cell.dx * geometry.s;
      const y = j * geometry.pitch + cell.dy * geometry.s;
      const distance = x * x + y * y;
      if (!nearestCell || distance < nearestCell.distance) nearestCell = { x, y, distance };
    }
  }
  if (nearestCell) physics.jumpTo(nearestCell.x - geometry.vw / 2, nearestCell.y - geometry.vh / 2, 1);
}

const now = () => ((document.timeline?.currentTime as number | null) ?? performance.now()) / 1000;

let awake = false;
const listeners = new Set<() => void>();

function draw(vx: number, vy: number, zoomAtRest: boolean): void {
  // Mid zoom-to, tiles keep their layout until it lands.
  renderer.update(physics.renderX, physics.renderY, physics.renderZ, vx, vy, zoomAtRest, physics.zoomingTo || projectMoving());
  frame.setRadius(geometry.radius * physics.renderZ);
}

/** At rest: no motion, no image still trailing, fading or still to be snapped to. */
const atRest = () => physics.isAtRest() && renderer.isAtRest() && !projectMoving();

function tick(): void {
  if (intro) {
    stepIntro();
    return;
  }
  if (flight) {
    stepFlight();
    return;
  }
  if (project && !project.free) stepProject(now());
  physics.advance(now());
  if (project?.free && zoomState === 'out' && physics.isStill()) keepProjectInView(now());
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
  // In the project view, focusing an image leaves it, onto that image.
  if (project) return closeProject(rect);
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

/** Esc: out of the focused view, back to the canvas (or out of the project view). */
function backOut(t: number): void {
  if (zoomState === 'in') zoomOut(t);
  else closeProject();
}

attachInput({
  root,
  physics,
  wake,
  tap: tapAt,
  zoom: setZoom,
  toggleZoom,
  escape: backOut,
  enabled: () => !intro && !flight && (!project || project.free),
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
  // The project view is laid out for the old size: back to the focused view, then resize.
  if (project) endProject();
  // Mid-flight the tiles are drawn from a snapshot; catch up once back.
  if (flight) return;
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
  if (document.hidden) {
    endIntro();
    sleep();
  } else wake();
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

/**
 * Opening the canvas, the camera is already flying down a tunnel of lines as a line of text
 * rises and leaves, then it speeds up into a wormhole that closes up into the tiles (intro.ts). The tiles lie ready under it the whole way, loading as they would; once the
 * lines are tiles the layer fades to them, and they glide in the rest of the way themselves.
 * Anything the visitor does cuts it short: they get the canvas, and what they did counts.
 */
interface Intro {
  lines: IntroLayer;
  title: IntroTitle;
  /** Timed from its first frame, so the page's own start doesn't eat into it. */
  start: number | null;
  /** For tests: stay this many seconds in. */
  held: number | null;
  /** The real tiles have taken over. */
  gliding: boolean;
  frame: IntroFrame;
  stop: AbortController;
}
let intro: Intro | null = null;

function startIntro(): void {
  const body = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  body.fillStyle = getComputedStyle(document.body).backgroundColor;
  body.fillRect(0, 0, 1, 1);
  const [r, g, b] = body.getImageData(0, 0, 1, 1).data as unknown as [number, number, number];
  const background = [r / 255, g / 255, b / 255] as const;
  const palette = introPalette(data.images.flatMap((image) => pixelColors(image.pixels)), background);
  const instances = introInstances(renderer.introTiles(), palette, geometry.vw, geometry.vh, SEED);
  const lines = IntroLayer.create(root, instances, background, geometry.vw, geometry.vh, Z_LEVELS + 1, params.has('test'));
  if (!lines) return;
  const stop = new AbortController();
  for (const type of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(type, endIntro, { capture: true, passive: true, signal: stop.signal });
  intro = { lines, title: new IntroTitle(root, INTRO_TITLE, Z_LEVELS + 2), start: null, held: null, gliding: false, frame: { z: 0, tail: 0, scale: 0, closed: 0, corners: 0, fade: 0, rays: 0 }, stop };
  lines.draw(introFrame(0, intro.frame));
  intro.title.draw(0);
  frame.conceal();
}

function stepIntro(): void {
  const i = intro!;
  const t = now();
  i.start ??= t;
  const at = i.held ?? t - i.start;
  if (at >= INTRO_LENGTH) return endIntro();
  const f = introFrame(at, i.frame);
  i.title.draw(at);
  if (f.z <= INTRO_HANDOVER && !i.gliding) {
    i.gliding = true;
    i.lines.leave();
    delete document.documentElement.dataset.intro;
    layer.style.willChange = 'transform';
  }
  if (i.gliding) layer.style.transform = `scale(${f.scale.toFixed(5)})`;
  i.lines.draw(f);
}

function endIntro(): void {
  if (!intro) return;
  intro.lines.leave();
  intro.title.remove();
  intro.stop.abort();
  intro = null;
  delete document.documentElement.dataset.intro;
  layer.style.transform = '';
  layer.style.willChange = '';
  frame.reveal();
  playVideos();
  wake();
}

/** Videos play on the canvas, unless motion is to be reduced: then each holds its poster frame. */
function playVideos(): void {
  // (They hold still too while the project view moves: starting several at once mid-move costs frames.)
  renderer.setVideos(!reducedMotion.matches && route !== 'about' && !projectInMotion() && !intro);
}

/** How far the flight has got, 0 (the canvas) to 1 (every image flown past), and which way it is going. */
interface Flight {
  u: number;
  to: 0 | 1;
  last: number;
}
let flight: Flight | null = null;

function go(next: Route): void {
  if (next === route) return;
  endIntro();
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
  root.style.visibility = '';
  flight!.to = to;
  flight!.last = now();
  wake();
}

function leaveCanvas(): void {
  if (flight) return turn(1);
  if (project) endProject();
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
  if (f.to === 1) {
    root.style.visibility = 'hidden';
    return sleep();
  }
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
// Avoid filtering the tall, scaled text surface on mobile WebKit: its composited
// edges can flash as a pale rectangle. Touch keeps the perspective and fade.
const touchAbout = matchMedia('(hover: none) and (pointer: coarse)');

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
  const blur = still || touchAbout.matches ? 0 : far.blur / far.scale;
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
  else root.style.visibility = 'hidden';
} else {
  // A fresh load of the canvas, not a return to it. Tests ask for it with `?intro`.
  const opening = navigation?.type !== 'back_forward' && !reducedMotion.matches && !document.hidden && (!params.has('test') || params.has('intro'));
  if (opening) startIntro();
  wake();
}
if (!intro) delete document.documentElement.dataset.intro;
playVideos();

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
    /** Whether the intro is playing; hold it this many seconds in to look at it. */
    intro: () => intro !== null,
    holdIntro: (at: number) => {
      if (intro) intro.held = at;
    },
    activeImage: () => renderer.activeImage(),
    /** The project view, or null: landed (and browsable) or not, and its overview's zoom. */
    project: () => (project ? { free: project.free, target: project.target, overview: project.overview.z } : null),
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
