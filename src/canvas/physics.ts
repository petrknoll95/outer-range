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
} from './config';

/** Input kinds. Plain numbers so they fit the typed-array queue. */
export const WHEEL = 0; // a, b = camera delta, px
export const DRAG_START = 1; // a, b = pointer position, px
export const DRAG_MOVE = 2; // a, b = pointer position, px
export const DRAG_END = 3;
export const NUDGE = 4; // a, b = camera delta, px (keyboard)

const QUEUE_SIZE = 512;
const SAMPLE_SIZE = 32;
const FLING_K = Math.LN2 / FLING_HALF_LIFE;
const FLING_DECAY = Math.exp(-FLING_K * STEP);
const FLING_TRAVEL = (1 - FLING_DECAY) / FLING_K;
const follow = (tau: number) => (tau > 0 ? 1 - Math.exp(-STEP / tau) : 1);

/**
 * Camera physics on a fixed 240 Hz step.
 *
 * Inputs carry their event timestamps and are applied at the step they happened in,
 * not the frame they were noticed in, so the same input gives the same trajectory at
 * any frame rate. Rendering interpolates between the last two steps.
 *
 * Wheel and keyboard input move a target the camera follows with WHEEL_TAU smoothing.
 * The OS already adds momentum to trackpad scrolls, so wheel input gets no inertia of
 * its own. Dragging moves the target 1:1 with the pointer; on release the target keeps
 * the pointer's velocity and decays exponentially.
 *
 * Positions are world pixels of the viewport's top-left corner.
 */
export class CameraPhysics {
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  vx = 0;
  vy = 0;
  renderX = 0;
  renderY = 0;
  dragging = false;
  reducedMotion = false;

  private prevX = 0;
  private prevY = 0;
  private time = Number.NaN;
  private follow = follow(WHEEL_TAU);

  private anchorTx = 0;
  private anchorTy = 0;
  private anchorPx = 0;
  private anchorPy = 0;
  private readonly samples = new Float64Array(SAMPLE_SIZE * 3);
  private sampleHead = 0;
  private sampleCount = 0;

  private readonly queue = new Float64Array(QUEUE_SIZE * 4);
  private queueHead = 0;
  private queueLength = 0;

  /** Queue an input that happened at time `t` (seconds, same clock as `advance`). */
  push(kind: number, t: number, a = 0, b = 0): void {
    if (this.queueLength === QUEUE_SIZE) this.drain(Number.POSITIVE_INFINITY);
    const k = ((this.queueHead + this.queueLength) % QUEUE_SIZE) * 4;
    this.queue[k] = kind;
    this.queue[k + 1] = t;
    this.queue[k + 2] = a;
    this.queue[k + 3] = b;
    this.queueLength++;
  }

  /** Run the simulation up to time `now` (seconds) and update renderX/renderY. */
  advance(now: number): void {
    if (Number.isNaN(this.time)) this.time = now;
    if (now - this.time > MAX_CATCH_UP) this.time = now - STEP;
    while (this.time + STEP <= now) {
      const t = this.time + STEP;
      this.drain(t);
      this.prevX = this.x;
      this.prevY = this.y;
      this.step();
      this.time = t;
    }
    const alpha = (now - this.time) / STEP;
    this.renderX = this.prevX + (this.x - this.prevX) * alpha;
    this.renderY = this.prevY + (this.y - this.prevY) * alpha;
  }

  /** Forget the clock, e.g. after the loop slept; the next advance starts from its own time. */
  resync(): void {
    this.time = Number.NaN;
  }

  isAtRest(): boolean {
    return !this.dragging && this.queueLength === 0 && this.vx === 0 && this.vy === 0 && this.x === this.tx && this.y === this.ty && this.prevX === this.x && this.prevY === this.y;
  }

  /** Place the camera without motion. */
  jumpTo(x: number, y: number): void {
    this.x = this.tx = this.prevX = this.renderX = x;
    this.y = this.ty = this.prevY = this.renderY = y;
    this.vx = this.vy = 0;
  }

  /**
   * Map every position through p′ = (p + offset)·k − newOffset, per axis. Used on resize to
   * scale the world around the viewport centre.
   */
  rescale(k: number, ox: number, oy: number, nx: number, ny: number): void {
    const mx = (v: number) => (v + ox) * k - nx;
    const my = (v: number) => (v + oy) * k - ny;
    this.x = mx(this.x);
    this.tx = mx(this.tx);
    this.prevX = mx(this.prevX);
    this.renderX = mx(this.renderX);
    this.anchorTx = mx(this.anchorTx);
    this.y = my(this.y);
    this.ty = my(this.ty);
    this.prevY = my(this.prevY);
    this.renderY = my(this.renderY);
    this.anchorTy = my(this.anchorTy);
    this.vx *= k;
    this.vy *= k;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    this.follow = follow(on ? 0 : this.dragging ? DRAG_TAU : WHEEL_TAU);
    if (on) this.vx = this.vy = 0;
  }

  private drain(until: number): void {
    while (this.queueLength > 0) {
      const k = this.queueHead * 4;
      const t = this.queue[k + 1]!;
      if (t > until) return;
      this.apply(this.queue[k]!, t, this.queue[k + 2]!, this.queue[k + 3]!);
      this.queueHead = (this.queueHead + 1) % QUEUE_SIZE;
      this.queueLength--;
    }
  }

  private apply(kind: number, t: number, a: number, b: number): void {
    switch (kind) {
      case WHEEL:
      case NUDGE:
        this.vx = this.vy = 0;
        if (this.dragging) {
          this.anchorTx += a;
          this.anchorTy += b;
        } else {
          this.setTau(WHEEL_TAU);
        }
        this.tx += a;
        this.ty += b;
        break;
      case DRAG_START:
        this.dragging = true;
        this.vx = this.vy = 0;
        this.setTau(DRAG_TAU);
        this.anchorTx = this.tx;
        this.anchorTy = this.ty;
        this.anchorPx = a;
        this.anchorPy = b;
        this.sampleCount = 0;
        this.sample(t, a, b);
        break;
      case DRAG_MOVE:
        if (!this.dragging) break;
        this.tx = this.anchorTx - (a - this.anchorPx);
        this.ty = this.anchorTy - (b - this.anchorPy);
        this.sample(t, a, b);
        break;
      case DRAG_END:
        if (!this.dragging) break;
        this.dragging = false;
        this.releaseVelocity(t);
        break;
    }
  }

  private setTau(tau: number): void {
    this.follow = follow(this.reducedMotion ? 0 : tau);
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
    if (this.reducedMotion || this.sampleCount < 2) return;
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
    let vx = -(this.samples[last + 1]! - this.samples[first + 1]!) / dt;
    let vy = -(this.samples[last + 2]! - this.samples[first + 2]!) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_FLING_SPEED) {
      vx *= MAX_FLING_SPEED / speed;
      vy *= MAX_FLING_SPEED / speed;
    }
    this.vx = vx;
    this.vy = vy;
  }

  private step(): void {
    if (!this.dragging && (this.vx !== 0 || this.vy !== 0)) {
      // Exact integral of v·e^(−kt) over one step, so the fling distance is v₀/k.
      this.tx += this.vx * FLING_TRAVEL;
      this.ty += this.vy * FLING_TRAVEL;
      this.vx *= FLING_DECAY;
      this.vy *= FLING_DECAY;
      if (Math.hypot(this.vx, this.vy) < STOP_SPEED) this.vx = this.vy = 0;
    }
    this.x += (this.tx - this.x) * this.follow;
    this.y += (this.ty - this.y) * this.follow;
    if (!this.dragging && this.vx === 0 && this.vy === 0 && Math.abs(this.tx - this.x) < SETTLE_DISTANCE && Math.abs(this.ty - this.y) < SETTLE_DISTANCE) {
      this.x = this.tx;
      this.y = this.ty;
    }
  }
}
