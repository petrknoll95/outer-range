import {
  DRAG_TAU,
  FLING_HALF_LIFE,
  GLIDE_EASE_OUT,
  GLIDE_MIN_DURATION,
  MAX_CATCH_UP,
  MAX_FLING_SPEED,
  PAGE_FLICK_TIME,
  PAGE_REACH,
  PAGE_SWIPE_MIN_SPEED,
  PAGE_SWIPE_RISE,
  PAGE_SWIPE_WINDOW,
  PAGE_THRESHOLD,
  RELEASE_STALE,
  SETTLE_DISTANCE,
  SNAP_IDLE,
  STEP,
  STOP_SPEED,
  VELOCITY_WINDOW,
  WHEEL_TAU,
  ZOOM_TAU,
} from './config';
import { easeOutCubic, focusDuration, smoothstep, startSlope } from './focus';

/** Input kinds. Plain numbers so they fit the typed-array queue. */
export const WHEEL = 0; // a, b = screen delta, px
export const DRAG_START = 1; // a, b = pointer, screen px
export const DRAG_MOVE = 2; // a, b = pointer, screen px
export const DRAG_END = 3;
export const NUDGE = 4; // a, b = screen delta, px (keyboard)
export const ZOOM = 5; // a, b = anchor, screen px; c = zoom factor (wheel, keys)
export const ZOOM_RESET = 6; // a, b = anchor, screen px; zooms back to 1
export const PINCH = 7; // a, b = pinch midpoint, screen px; c = factor since the last PINCH (inside a drag)
export const GLIDE = 8; // a, b = screen delta, px; c = duration, s; d, e = start velocity, world px/s (eased)
export const ZOOM_TO = 9; // a, b = world point; c = zoom; d = duration, s. Zooms while bringing the point to the view centre.

const QUEUE_SIZE = 512;
const STRIDE = 7;
const SAMPLE_SIZE = 32;
const FLING_K = Math.LN2 / FLING_HALF_LIFE;
const FLING_DECAY = Math.exp(-FLING_K * STEP);
const FLING_TRAVEL = (1 - FLING_DECAY) / FLING_K;
const follow = (tau: number) => (tau > 0 ? 1 - Math.exp(-STEP / tau) : 1);

export type StepListener = (x: number, y: number, z: number) => void;

/**
 * Given a camera position (x, y) at zoom z, the camera position that centres the image
 * nearest the view centre, or null if there is none. Paging uses it to find neighbours.
 */
export type Snapper = (x: number, y: number, z: number) => { x: number; y: number } | null;

/**
 * Camera physics on a fixed 240 Hz step.
 *
 * Inputs carry their event timestamps and are applied at the step they happened in,
 * not the frame they were noticed in, so the same input gives the same trajectory at
 * any frame rate. Rendering interpolates between the last two steps.
 *
 * The camera is (x, y, z): the world point at the viewport's top-left corner, in world
 * pixels at zoom 1, and the zoom. A world point w appears on screen at (w − x)·z.
 *
 * Wheel and keyboard input move a target the camera follows with WHEEL_TAU smoothing.
 * The OS already adds momentum to trackpad scrolls, so wheel input gets no inertia of
 * its own. Dragging moves the target 1:1 with the pointer; on release the target keeps
 * the pointer's velocity and decays exponentially.
 *
 * Zoom moves a target zoom about an anchor (the cursor). While the zoom eases toward
 * it, the camera keeps the world point under the anchor fixed, so the image under
 * your cursor never slides. ZOOM_TO instead zooms while gliding a world point to the
 * view centre, in one eased move.
 *
 * Paging (setPaging, zoomed in): the view is anchored on one image and each gesture
 * moves at most one image, to the neighbour in its direction (found with `snapper`).
 * Pulling stiffens toward PAGE_REACH, so the view can never get further. A scroll commits
 * at PAGE_THRESHOLD and ignores the rest of itself until a new swipe starts; a drag decides on release from how far
 * it pulled plus a little of its release velocity, and leaves at that velocity; arrow
 * keys page directly. Every glide, a click's included, re-anchors on where it lands.
 */
export class CameraPhysics {
  x = 0;
  y = 0;
  z = 1;
  tx = 0;
  ty = 0;
  tz = 1;
  /** Fling velocity, world px/s. */
  vx = 0;
  vy = 0;
  /** The camera's actual velocity over the last step, world px/s. */
  stepVx = 0;
  stepVy = 0;
  /**
   * Pan part of the last step's motion, world px/s: how fast the world point under the
   * zoom anchor moved. A pure zoom about the anchor leaves it at zero.
   */
  panVx = 0;
  panVy = 0;
  /** Whether the zoom changed in the last step. */
  zooming = false;
  renderX = 0;
  renderY = 0;
  renderZ = 1;
  dragging = false;
  reducedMotion = false;
  zoomMin = 1;
  zoomMax = 1;
  /** Called after every simulation step with the new camera. */
  onStep: StepListener | null = null;
  /** Finds the image nearest a camera position; required for paging. */
  snapper: Snapper | null = null;
  /** World px between neighbouring images while paging, or 0 when not paging. */
  pageStep = 0;
  /** The view centre, screen px: where ZOOM_TO brings its point. */
  centreX = 0;
  centreY = 0;

  private prevX = 0;
  private prevY = 0;
  private prevZ = 1;
  private time = Number.NaN;
  private panTau = WHEEL_TAU;
  private zoomTau = ZOOM_TAU;
  private panFollow = follow(WHEEL_TAU);
  private zoomFollow = follow(ZOOM_TAU);
  /** Screen point the zoom is anchored on (the cursor of the last zoom input). */
  anchorX = 0;
  anchorY = 0;

  private anchorTx = 0;
  private anchorTy = 0;
  private anchorPx = 0;
  private anchorPy = 0;
  private pinched = false;
  /** An eased glide of the pan target, or none (duration 0). */
  private glideStart = 0;
  private glideDuration = 0;
  private glideFromX = 0;
  private glideFromY = 0;
  private glideDx = 0;
  private glideDy = 0;
  private glideVx = 0;
  private glideVy = 0;
  /** An eased ZOOM_TO, or none (duration 0). */
  private zoomToStart = 0;
  private zoomToDuration = 0;
  private zoomToFrom = 1;
  private zoomToTarget = 1;
  private zoomToWx = 0;
  private zoomToWy = 0;
  private zoomToPx = 0;
  private zoomToPy = 0;
  /** A wheel scroll still in progress (it ends SNAP_IDLE after its last event). */
  private scrollPending = false;
  private scrollTime = 0;
  /** Paging: the camera position centring the anchored image, the raw pull from it, and whether the current scroll has already paged. */
  private pageAnchorX = 0;
  private pageAnchorY = 0;
  private pageRawX = 0;
  private pageRawY = 0;
  private pageRaw0X = 0;
  private pageRaw0Y = 0;
  private pageAbsorb = false;
  /** Paging: when the last scroll event came, the scroll's speed, and its peak and slowest since, px/s. */
  private wheelTime = Number.NEGATIVE_INFINITY;
  private wheelSpeed = 0;
  private swipeHigh = 0;
  private swipeLow = 0;
  /** Paging: how far the scroll has gone since it was slowest (screen px), which a new swipe started at. */
  private swipeFromLowX = 0;
  private swipeFromLowY = 0;
  private readonly samples = new Float64Array(SAMPLE_SIZE * 3);
  private sampleHead = 0;
  private sampleCount = 0;

  private readonly queue = new Float64Array(QUEUE_SIZE * STRIDE);
  private queueHead = 0;
  private queueLength = 0;

  /** Queue an input that happened at time `t` (seconds, same clock as `advance`). */
  push(kind: number, t: number, a = 0, b = 0, c = 0, d = 0, e = 0): void {
    if (this.queueLength === QUEUE_SIZE) this.drain(Number.POSITIVE_INFINITY);
    const k = ((this.queueHead + this.queueLength) % QUEUE_SIZE) * STRIDE;
    this.queue[k] = kind;
    this.queue[k + 1] = t;
    this.queue[k + 2] = a;
    this.queue[k + 3] = b;
    this.queue[k + 4] = c;
    this.queue[k + 5] = d;
    this.queue[k + 6] = e;
    this.queueLength++;
  }

  /** True while a ZOOM_TO is in flight. */
  get zoomingTo(): boolean {
    return this.zoomToDuration > 0;
  }

  /** Run the simulation up to time `now` (seconds) and update renderX/renderY/renderZ. */
  advance(now: number): void {
    if (Number.isNaN(this.time)) this.time = now;
    if (now - this.time > MAX_CATCH_UP) this.time = now - STEP;
    while (this.time + STEP <= now) {
      const t = this.time + STEP;
      this.drain(t);
      this.prevX = this.x;
      this.prevY = this.y;
      this.prevZ = this.z;
      this.step(t);
      this.time = t;
      this.onStep?.(this.x, this.y, this.z);
    }
    const alpha = (now - this.time) / STEP;
    this.renderX = this.prevX + (this.x - this.prevX) * alpha;
    this.renderY = this.prevY + (this.y - this.prevY) * alpha;
    this.renderZ = this.prevZ + (this.z - this.prevZ) * alpha;
  }

  /** Forget the clock, e.g. after the loop slept; the next advance starts from its own time. */
  resync(): void {
    this.time = Number.NaN;
  }

  isAtRest(): boolean {
    return (
      !this.dragging &&
      this.glideDuration === 0 &&
      this.zoomToDuration === 0 &&
      !this.scrollPending &&
      this.queueLength === 0 &&
      this.vx === 0 &&
      this.vy === 0 &&
      this.x === this.tx &&
      this.y === this.ty &&
      this.z === this.tz &&
      this.prevX === this.x &&
      this.prevY === this.y &&
      this.prevZ === this.z
    );
  }

  /** Stop dead where the camera is drawn, dropping anything in progress or queued. */
  halt(): void {
    this.queueLength = 0;
    this.glideDuration = this.zoomToDuration = 0;
    this.scrollPending = this.pageAbsorb = this.dragging = false;
    this.jumpTo(this.renderX, this.renderY, this.renderZ);
  }

  /** Place the camera without motion. */
  jumpTo(x: number, y: number, z = this.z): void {
    this.x = this.tx = this.prevX = this.renderX = x;
    this.y = this.ty = this.prevY = this.renderY = y;
    this.z = this.tz = this.prevZ = this.renderZ = z;
    this.vx = this.vy = this.stepVx = this.stepVy = 0;
  }

  /**
   * World coordinates were rescaled by k (the viewport resized and S changed). Keep the
   * world point at the old viewport centre (ocx, ocy) at the new centre (ncx, ncy).
   */
  rescale(k: number, ocx: number, ocy: number, ncx: number, ncy: number): void {
    const map = (v: number, z: number, oc: number, nc: number) => (v + oc / z) * k - nc / z;
    this.x = map(this.x, this.z, ocx, ncx);
    this.prevX = map(this.prevX, this.prevZ, ocx, ncx);
    this.renderX = map(this.renderX, this.renderZ, ocx, ncx);
    this.tx = map(this.tx, this.tz, ocx, ncx);
    this.anchorTx = map(this.anchorTx, this.tz, ocx, ncx);
    this.y = map(this.y, this.z, ocy, ncy);
    this.prevY = map(this.prevY, this.prevZ, ocy, ncy);
    this.renderY = map(this.renderY, this.renderZ, ocy, ncy);
    this.ty = map(this.ty, this.tz, ocy, ncy);
    this.anchorTy = map(this.anchorTy, this.tz, ocy, ncy);
    this.vx *= k;
    this.vy *= k;
  }

  /**
   * Page between images `step` world px apart (zoomed in), anchored on where the camera
   * is heading now, or stop paging (0).
   */
  setPaging(step: number): void {
    this.pageStep = step;
    this.pageAnchorX = this.tx;
    this.pageAnchorY = this.ty;
    this.pageRawX = this.pageRawY = 0;
    this.pageAbsorb = false;
  }

  /** Set the zoom range; a target outside it is pulled back in, anchored on (ax, ay). */
  setZoomLimits(min: number, max: number, ax: number, ay: number): void {
    this.zoomMin = min;
    this.zoomMax = Math.max(min, max);
    const clamped = Math.min(this.zoomMax, Math.max(this.zoomMin, this.tz));
    if (clamped !== this.tz) this.zoomAbout(ax, ay, clamped / this.tz);
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.setTaus(this.panTau, this.zoomTau);
    if (on) this.vx = this.vy = 0;
  }

  private drain(until: number): void {
    while (this.queueLength > 0) {
      const k = this.queueHead * STRIDE;
      const t = this.queue[k + 1]!;
      if (t > until) return;
      const q = this.queue;
      this.apply(q[k]!, t, q[k + 2]!, q[k + 3]!, q[k + 4]!, q[k + 5]!, q[k + 6]!);
      this.queueHead = (this.queueHead + 1) % QUEUE_SIZE;
      this.queueLength--;
    }
  }

  private get paging(): boolean {
    return this.pageStep > 0 && this.snapper !== null;
  }

  private apply(kind: number, t: number, a: number, b: number, c: number, d: number, e: number): void {
    if (kind === WHEEL && this.paging) {
      const fresh = this.isNewSwipe(t, a, b);
      // The rest of a scroll that has already paged (trackpad momentum included) changes nothing.
      if (this.pageAbsorb && !fresh) {
        this.scrollPending = true;
        this.scrollTime = t;
        return;
      }
      if (this.pageAbsorb) {
        // Recognised a moment into it: the new swipe pulls by all it has moved so far.
        this.pageAbsorb = false;
        this.pageRawX = this.swipeFromLowX / this.tz;
        this.pageRawY = this.swipeFromLowY / this.tz;
      }
    }
    // Anything the user does takes over from a glide or zoom-to, from wherever it has got to.
    if (kind !== GLIDE) this.glideDuration = 0;
    if (this.zoomToDuration > 0) {
      // Its zoom still reaches its level (there are only two), eased about the view centre.
      this.zoomToDuration = 0;
      this.zoomAbout(this.centreX, this.centreY, this.zoomToTarget / this.tz);
      this.setTaus(this.panTau, ZOOM_TAU);
    }
    this.scrollPending = false;
    if (this.paging && !this.dragging && (kind === WHEEL || kind === NUDGE)) {
      this.vx = this.vy = 0;
      const dx = a / this.tz;
      const dy = b / this.tz;
      if (kind === NUDGE) {
        this.pageToward(t, dx, dy, 0, 0);
        return;
      }
      this.scrollPending = true;
      this.scrollTime = t;
      this.pageRawX += dx;
      this.pageRawY += dy;
      if (Math.hypot(this.pageRawX, this.pageRawY) >= PAGE_THRESHOLD * this.pageStep) {
        this.pageToward(t, this.pageRawX, this.pageRawY, 0, 0);
        this.pageAbsorb = true;
        // Another swipe has to slow down from here first, then speed up again. (A scroll's
        // first event has no speed yet; count it as at least the jitter floor.)
        this.swipeHigh = this.swipeLow = Math.max(this.wheelSpeed, PAGE_SWIPE_MIN_SPEED);
        this.swipeFromLowX = this.swipeFromLowY = 0;
      } else {
        this.setTaus(WHEEL_TAU, this.zoomTau);
        this.pullTo(this.pageRawX, this.pageRawY);
      }
      return;
    }
    switch (kind) {
      case WHEEL:
      case NUDGE: {
        this.vx = this.vy = 0;
        const dx = a / this.tz;
        const dy = b / this.tz;
        if (this.dragging) {
          this.anchorTx += dx;
          this.anchorTy += dy;
        } else {
          this.setTaus(WHEEL_TAU, this.zoomTau);
        }
        this.tx += dx;
        this.ty += dy;
        break;
      }
      case ZOOM:
      case ZOOM_RESET:
        this.vx = this.vy = 0;
        this.zoomAbout(a, b, kind === ZOOM ? c : 1 / this.tz);
        this.setTaus(this.dragging ? DRAG_TAU : this.panTau, ZOOM_TAU);
        break;
      case PINCH:
        if (!this.dragging) break;
        this.pinched = true;
        this.zoomAbout(a, b, c);
        this.setTaus(DRAG_TAU, DRAG_TAU);
        break;
      case DRAG_START:
        this.dragging = true;
        this.pinched = false;
        this.vx = this.vy = 0;
        this.setTaus(DRAG_TAU, this.zoomTau);
        this.anchorTx = this.tx;
        this.anchorTy = this.ty;
        this.anchorPx = a;
        this.anchorPy = b;
        this.sampleCount = 0;
        this.sample(t, a, b);
        // Paging: the pull carries on from wherever the view is (e.g. mid-glide).
        this.pageRaw0X = this.tx - this.pageAnchorX;
        this.pageRaw0Y = this.ty - this.pageAnchorY;
        break;
      case DRAG_MOVE:
        if (!this.dragging) break;
        this.sample(t, a, b);
        if (this.paging) {
          this.pageRawX = this.pageRaw0X - (a - this.anchorPx) / this.tz;
          this.pageRawY = this.pageRaw0Y - (b - this.anchorPy) / this.tz;
          this.pullTo(this.pageRawX, this.pageRawY);
          break;
        }
        this.tx = this.anchorTx - (a - this.anchorPx) / this.tz;
        this.ty = this.anchorTy - (b - this.anchorPy) / this.tz;
        break;
      case DRAG_END:
        if (!this.dragging) break;
        this.dragging = false;
        this.releaseVelocity(t);
        if (this.paging) {
          const vx = this.vx;
          const vy = this.vy;
          this.vx = this.vy = 0;
          this.settlePage(t, vx, vy);
        }
        break;
      case GLIDE:
        if (this.dragging) break;
        this.glide(t, a / this.tz, b / this.tz, c, d, e);
        break;
      case ZOOM_TO: {
        this.vx = this.vy = 0;
        this.glideDuration = 0;
        const z1 = Math.min(this.zoomMax, Math.max(this.zoomMin, c));
        this.zoomToStart = t;
        this.zoomToDuration = Math.max(STEP, d);
        this.zoomToFrom = this.z;
        this.zoomToTarget = z1;
        this.zoomToWx = a;
        this.zoomToWy = b;
        // Where the point is on screen now; it travels from here to the view centre.
        this.zoomToPx = (a - this.x) * this.z;
        this.zoomToPy = (b - this.y) * this.z;
        // Paging anchors on where it will land, so a scroll mid-zoom pages from there.
        if (this.paging) {
          this.pageAnchorX = a - this.centreX / z1;
          this.pageAnchorY = b - this.centreY / z1;
          this.pageRawX = this.pageRawY = 0;
        }
        break;
      }
    }
  }

  /**
   * Glide the pan target by (dx, dy) world px over `duration` s, easing out (see
   * GLIDE_EASE_OUT). (vx, vy), world px/s, is how it is moving already: any sideways part
   * carries on and fades out, and along the way it leaves at whichever is faster.
   */
  private glide(t: number, dx: number, dy: number, duration: number, vx: number, vy: number): void {
    let time = Math.max(STEP, duration);
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const ux = dx / d;
      const uy = dy / d;
      const along = vx * ux + vy * uy;
      // A flick faster than the ease-out arrives sooner, on the same curve, rather than overshooting.
      if (along * time > GLIDE_EASE_OUT * d) time = Math.min(time, Math.max(GLIDE_MIN_DURATION, (GLIDE_EASE_OUT * d) / along));
      // Moving away from it (a pull let go the other way), it swings round instead.
      const lead = along < 0 ? along : (GLIDE_EASE_OUT * d) / time;
      vx += (lead - along) * ux;
      vy += (lead - along) * uy;
    }
    this.vx = this.vy = 0;
    this.glideStart = t;
    this.glideDuration = time;
    this.glideFromX = this.tx;
    this.glideFromY = this.ty;
    this.glideDx = dx;
    this.glideDy = dy;
    this.glideVx = vx;
    this.glideVy = vy;
    // The camera follows the eased target closely; the ease itself is the smoothing.
    this.setTaus(DRAG_TAU, this.zoomTau);
    if (this.paging) {
      // Wherever a glide lands is the image the view is anchored on.
      this.pageAnchorX = this.glideFromX + dx;
      this.pageAnchorY = this.glideFromY + dy;
      this.pageRawX = this.pageRawY = 0;
    }
  }

  /**
   * Paging: move the target to the anchor plus a pull of (rx, ry), stiffening so it never
   * gets further than PAGE_REACH from the anchor.
   */
  private pullTo(rx: number, ry: number): void {
    const reach = PAGE_REACH * this.pageStep;
    const m = Math.hypot(rx, ry);
    const k = m > 0 ? (reach * Math.tanh(m / reach)) / m : 0;
    this.tx = this.pageAnchorX + rx * k;
    this.ty = this.pageAnchorY + ry * k;
  }

  /**
   * Paging: track the scroll's speed and tell whether this event (screen delta (a, b) at
   * time t) shows a new swipe has started: it speeds up again after slowing down (see
   * PAGE_SWIPE_RISE). The new swipe started where the scroll was slowest; swipeFromLow is
   * how far it has gone since, before this event.
   */
  private isNewSwipe(t: number, a: number, b: number): boolean {
    // Each event's own speed (its delta over the time it covers), averaged over the last
    // PAGE_SWIPE_WINDOW or so. Events merged by a busy frame read as fast as they were; a
    // pause, like fingers landing on the trackpad, reads as slowing down.
    const gap = Math.max(t - this.wheelTime, 1 / 240);
    this.wheelTime = t;
    const v = (this.wheelSpeed += (Math.hypot(a, b) / gap - this.wheelSpeed) * (1 - Math.exp(-gap / PAGE_SWIPE_WINDOW)));
    // Slowed to 1/RISE of its peak, then sped up to RISE × that (plus the jitter margin), or
    // back to its old peak, whichever comes first.
    const slowed = this.swipeLow * PAGE_SWIPE_RISE <= this.swipeHigh;
    if (slowed && v >= Math.min(this.swipeHigh, this.swipeLow * PAGE_SWIPE_RISE + PAGE_SWIPE_MIN_SPEED)) {
      // Track the new swipe from here; swipeFromLow is read before the next event resets it.
      this.swipeHigh = this.swipeLow = v;
      return true;
    }
    if (v >= this.swipeHigh || v <= this.swipeLow) {
      // A new peak (the slowest since starts again from it) or a new slowest.
      if (v >= this.swipeHigh) this.swipeHigh = v;
      this.swipeLow = v;
      this.swipeFromLowX = this.swipeFromLowY = 0;
    }
    this.swipeFromLowX += a;
    this.swipeFromLowY += b;
    return false;
  }

  /** Paging: glide to the camera position (x, y), leaving at (vx, vy). */
  private glideTo(t: number, x: number, y: number, vx: number, vy: number): void {
    const dx = x - this.tx;
    const dy = y - this.ty;
    this.glide(t, dx, dy, focusDuration(Math.hypot(dx, dy) * this.tz), vx, vy);
  }

  /** Paging: glide to the neighbour of the anchored image in direction (dx, dy), or back if there is none. */
  private pageToward(t: number, dx: number, dy: number, vx: number, vy: number): void {
    const m = Math.hypot(dx, dy);
    const target = m > 0 ? this.snapper!(this.pageAnchorX + (dx / m) * this.pageStep, this.pageAnchorY + (dy / m) * this.pageStep, this.tz) : null;
    if (target) this.glideTo(t, target.x, target.y, vx, vy);
    else this.glideTo(t, this.pageAnchorX, this.pageAnchorY, vx, vy);
  }

  /** Paging, at the end of a drag or scroll: on to the neighbour if it pulled (or flicked) far enough, else back. */
  private settlePage(t: number, vx: number, vy: number): void {
    const px = this.pageRawX + vx * PAGE_FLICK_TIME;
    const py = this.pageRawY + vy * PAGE_FLICK_TIME;
    if (Math.hypot(px, py) >= PAGE_THRESHOLD * this.pageStep) this.pageToward(t, px, py, vx, vy);
    else this.glideTo(t, this.pageAnchorX, this.pageAnchorY, vx, vy);
  }

  /**
   * Scale the target zoom by `factor` (clamped to the limits) so the world point under
   * screen point (ax, ay) stays there, and anchor the eased zoom on that point.
   */
  private zoomAbout(ax: number, ay: number, factor: number): void {
    const wx = this.tx + ax / this.tz;
    const wy = this.ty + ay / this.tz;
    const z = Math.min(this.zoomMax, Math.max(this.zoomMin, this.tz * factor));
    this.tz = z;
    this.tx = wx - ax / z;
    this.ty = wy - ay / z;
    this.anchorX = ax;
    this.anchorY = ay;
    if (this.dragging) {
      // Keep the drag pinned: the pointer at (ax, ay) still holds the same world point.
      this.anchorTx = this.tx + (ax - this.anchorPx) / z;
      this.anchorTy = this.ty + (ay - this.anchorPy) / z;
    }
  }

  private setTaus(pan: number, zoom: number): void {
    this.panTau = pan;
    this.zoomTau = zoom;
    this.panFollow = follow(this.reducedMotion ? 0 : pan);
    this.zoomFollow = follow(this.reducedMotion ? 0 : zoom);
  }

  private sample(t: number, x: number, y: number): void {
    const k = this.sampleHead * 3;
    this.samples[k] = t;
    this.samples[k + 1] = x;
    this.samples[k + 2] = y;
    this.sampleHead = (this.sampleHead + 1) % SAMPLE_SIZE;
    this.sampleCount = Math.min(this.sampleCount + 1, SAMPLE_SIZE);
  }

  /** Pointer velocity over the last VELOCITY_WINDOW before release; the camera moves the other way. */
  private releaseVelocity(t: number): void {
    this.vx = this.vy = 0;
    // A pinch's midpoint drifts as fingers lift one by one; never fling from it.
    if (this.reducedMotion || this.pinched || this.sampleCount < 2) return;
    const at = (n: number) => ((this.sampleHead - 1 - n + SAMPLE_SIZE) % SAMPLE_SIZE) * 3;
    const last = at(0);
    const lastT = this.samples[last]!;
    if (t - lastT > RELEASE_STALE) return;
    let first = last;
    for (let n = 1; n < this.sampleCount; n++) {
      const k = at(n);
      if (lastT - this.samples[k]! > VELOCITY_WINDOW) break;
      first = k;
    }
    const dt = lastT - this.samples[first]!;
    if (dt < 0.008) return;
    // Screen px/s, capped, then into world px/s.
    let vx = -(this.samples[last + 1]! - this.samples[first + 1]!) / dt;
    let vy = -(this.samples[last + 2]! - this.samples[first + 2]!) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_FLING_SPEED) {
      vx *= MAX_FLING_SPEED / speed;
      vy *= MAX_FLING_SPEED / speed;
    }
    this.vx = vx / this.tz;
    this.vy = vy / this.tz;
  }

  private step(t: number): void {
    if (this.zoomToDuration > 0) {
      this.stepZoomTo(t);
      return;
    }
    if (this.scrollPending && !this.dragging && t - this.scrollTime >= SNAP_IDLE) {
      // The scroll has ended. If it never got far enough to page, spring back.
      this.scrollPending = false;
      if (this.pageAbsorb) this.pageAbsorb = false;
      else if (this.paging) this.glideTo(t, this.pageAnchorX, this.pageAnchorY, 0, 0);
    }
    if (this.glideDuration > 0) {
      const u = this.reducedMotion ? 1 : Math.min(1, (t - this.glideStart) / this.glideDuration);
      const along = smoothstep(u);
      const lead = startSlope(u) * this.glideDuration;
      this.tx = this.glideFromX + this.glideDx * along + this.glideVx * lead;
      this.ty = this.glideFromY + this.glideDy * along + this.glideVy * lead;
      if (u >= 1) this.glideDuration = 0;
    }
    if (!this.dragging && (this.vx !== 0 || this.vy !== 0)) {
      // Exact integral of v·e^(−kt) over one step, so the fling distance is v₀/k.
      this.tx += this.vx * FLING_TRAVEL;
      this.ty += this.vy * FLING_TRAVEL;
      this.vx *= FLING_DECAY;
      this.vy *= FLING_DECAY;
      if (Math.hypot(this.vx, this.vy) * this.tz < STOP_SPEED) this.vx = this.vy = 0;
    }

    // Ease the zoom in log space, then move the camera so the world point under the
    // anchor follows its target with the pan smoothing. With no zoom in flight this is
    // just x += (tx − x)·follow.
    const z0 = this.z;
    let z = this.tz;
    if (z0 !== this.tz) {
      z = z0 * Math.exp(Math.log(this.tz / z0) * this.zoomFollow);
      if (Math.abs(Math.log(this.tz / z)) < 1e-7) z = this.tz;
    }
    const fx = this.x + this.anchorX / z0;
    const fy = this.y + this.anchorY / z0;
    const nfx = fx + (this.tx + this.anchorX / this.tz - fx) * this.panFollow;
    const nfy = fy + (this.ty + this.anchorY / this.tz - fy) * this.panFollow;
    this.z = z;
    this.x = nfx - this.anchorX / z;
    this.y = nfy - this.anchorY / z;
    this.zooming = z !== z0;

    if (
      !this.dragging &&
      this.glideDuration === 0 &&
      this.vx === 0 &&
      this.vy === 0 &&
      z === this.tz &&
      Math.abs(this.tx - this.x) * z < SETTLE_DISTANCE &&
      Math.abs(this.ty - this.y) * z < SETTLE_DISTANCE
    ) {
      this.x = this.tx;
      this.y = this.ty;
    }
    this.stepVx = (this.x - this.prevX) / STEP;
    this.stepVy = (this.y - this.prevY) / STEP;
    // After the settle snap, so it accounts for the whole step.
    this.panVx = (this.x + this.anchorX / z - fx) / STEP;
    this.panVy = (this.y + this.anchorY / z - fy) / STEP;
  }

  /**
   * One step of a ZOOM_TO: zoom eases out in log space while the point's screen position
   * eases out from where it was to the view centre, and the camera follows exactly. The
   * point stays under that moving screen position, so trails see a pure zoom about it.
   */
  private stepZoomTo(t: number): void {
    const u = this.reducedMotion ? 1 : Math.min(1, (t - this.zoomToStart) / this.zoomToDuration);
    // Eased out like the glides, so zooming in or out feels like paging.
    const e = easeOutCubic(u);
    const z0 = this.z;
    const z = u >= 1 ? this.zoomToTarget : this.zoomToFrom * Math.pow(this.zoomToTarget / this.zoomToFrom, e);
    const px = this.zoomToPx + (this.centreX - this.zoomToPx) * e;
    const py = this.zoomToPy + (this.centreY - this.zoomToPy) * e;
    this.z = this.tz = z;
    this.x = this.tx = this.zoomToWx - px / z;
    this.y = this.ty = this.zoomToWy - py / z;
    this.anchorX = px;
    this.anchorY = py;
    this.zooming = z !== z0;
    this.stepVx = (this.x - this.prevX) / STEP;
    this.stepVy = (this.y - this.prevY) / STEP;
    this.panVx = this.panVy = 0;
    if (u >= 1) {
      this.zoomToDuration = 0;
      this.setTaus(WHEEL_TAU, ZOOM_TAU);
      if (this.paging) this.setPaging(this.pageStep);
    }
  }
}
