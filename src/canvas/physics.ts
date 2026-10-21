import {
  DRAG_TAU,
  FLING_HALF_LIFE,
  MAX_CATCH_UP,
  MAX_FLING_SPEED,
  RELEASE_STALE,
  SETTLE_DISTANCE,
  STEP,
  STOP_SPEED,
  VELOCITY_WINDOW,
  WHEEL_TAU,
  ZOOM_TAU,
} from './config';

/** Input kinds. Plain numbers so they fit the typed-array queue. */
export const WHEEL = 0; // a, b = screen delta, px
export const DRAG_START = 1; // a, b = pointer, screen px
export const DRAG_MOVE = 2; // a, b = pointer, screen px
export const DRAG_END = 3;
export const NUDGE = 4; // a, b = screen delta, px (keyboard)
export const ZOOM = 5; // a, b = anchor, screen px; c = zoom factor (wheel, keys)
export const ZOOM_RESET = 6; // a, b = anchor, screen px; zooms back to 1
export const PINCH = 7; // a, b = pinch midpoint, screen px; c = factor since the last PINCH (inside a drag)

const QUEUE_SIZE = 512;
const STRIDE = 5;
const SAMPLE_SIZE = 32;
const FLING_K = Math.LN2 / FLING_HALF_LIFE;
const FLING_DECAY = Math.exp(-FLING_K * STEP);
const FLING_TRAVEL = (1 - FLING_DECAY) / FLING_K;
const follow = (tau: number) => (tau > 0 ? 1 - Math.exp(-STEP / tau) : 1);

export type StepListener = (x: number, y: number, z: number) => void;

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
 * your cursor never slides.
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
  renderX = 0;
  renderY = 0;
  renderZ = 1;
  dragging = false;
  reducedMotion = false;
  zoomMin = 1;
  zoomMax = 1;
  /** Called after every simulation step with the new camera. */
  onStep: StepListener | null = null;

  private prevX = 0;
  private prevY = 0;
  private prevZ = 1;
  private time = Number.NaN;
  private panTau = WHEEL_TAU;
  private zoomTau = ZOOM_TAU;
  private panFollow = follow(WHEEL_TAU);
  private zoomFollow = follow(ZOOM_TAU);
  /** Screen point the zoom is anchored on. */
  private anchorX = 0;
  private anchorY = 0;

  private anchorTx = 0;
  private anchorTy = 0;
  private anchorPx = 0;
  private anchorPy = 0;
  private pinched = false;
  private readonly samples = new Float64Array(SAMPLE_SIZE * 3);
  private sampleHead = 0;
  private sampleCount = 0;

  private readonly queue = new Float64Array(QUEUE_SIZE * STRIDE);
  private queueHead = 0;
  private queueLength = 0;

  /** Queue an input that happened at time `t` (seconds, same clock as `advance`). */
  push(kind: number, t: number, a = 0, b = 0, c = 0): void {
    if (this.queueLength === QUEUE_SIZE) this.drain(Number.POSITIVE_INFINITY);
    const k = ((this.queueHead + this.queueLength) % QUEUE_SIZE) * STRIDE;
    this.queue[k] = kind;
    this.queue[k + 1] = t;
    this.queue[k + 2] = a;
    this.queue[k + 3] = b;
    this.queue[k + 4] = c;
    this.queueLength++;
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
      this.step();
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
      this.apply(this.queue[k]!, t, this.queue[k + 2]!, this.queue[k + 3]!, this.queue[k + 4]!);
      this.queueHead = (this.queueHead + 1) % QUEUE_SIZE;
      this.queueLength--;
    }
  }

  private apply(kind: number, t: number, a: number, b: number, c: number): void {
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
        break;
      case DRAG_MOVE:
        if (!this.dragging) break;
        this.tx = this.anchorTx - (a - this.anchorPx) / this.tz;
        this.ty = this.anchorTy - (b - this.anchorPy) / this.tz;
        this.sample(t, a, b);
        break;
      case DRAG_END:
        if (!this.dragging) break;
        this.dragging = false;
        this.releaseVelocity(t);
        break;
    }
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

  private step(): void {
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

    if (
      !this.dragging &&
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
  }
}
