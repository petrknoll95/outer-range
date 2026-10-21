import { describe, expect, it } from 'vitest';
import { FLING_HALF_LIFE, MAX_FLING_SPEED, RELEASE_STALE, STOP_SPEED } from '../src/canvas/config';
import { CameraPhysics, DRAG_END, DRAG_MOVE, DRAG_START, PINCH, WHEEL, ZOOM, ZOOM_RESET } from '../src/canvas/physics';

type Input = [kind: number, t: number, a?: number, b?: number, c?: number];

/** A drag from (600, 400) moving at (vx, vy) px/s, sampled at `hz`, released at `release`. */
function drag(vx: number, vy: number, start: number, release: number, hz = 120): Input[] {
  const out: Input[] = [[DRAG_START, start, 600, 400]];
  for (let t = start + 1 / hz; t <= release + 1e-9; t += 1 / hz) {
    out.push([DRAG_MOVE, t, 600 + vx * (t - start), 400 + vy * (t - start)]);
  }
  out.push([DRAG_END, release + 0.004]);
  return out;
}

/** A trackpad-style scroll: a burst of shrinking deltas, as macOS momentum delivers them. */
function trackpadScroll(start: number, dx: number, dy: number): Input[] {
  const out: Input[] = [];
  for (let n = 0; n < 60; n++) {
    const k = Math.exp(-n / 12);
    out.push([WHEEL, start + n / 60, dx * k, dy * k]);
  }
  return out;
}

/**
 * Feeds inputs as they would arrive between frames of a `fps` display and records the
 * rendered camera position at every frame. Inputs are delivered on the frame after
 * they happen, which is how the browser hands them over.
 */
function run(inputs: Input[], fps: number, duration: number): Map<number, [number, number, number]> {
  const p = new CameraPhysics();
  p.setZoomLimits(0.5, 2.5, 0, 0);
  const frames = new Map<number, [number, number, number]>();
  let next = 0;
  const sorted = [...inputs].sort((a, b) => a[1] - b[1]);
  for (let n = 0; n <= Math.round(duration * fps); n++) {
    const t = n / fps;
    while (next < sorted.length && sorted[next]![1] <= t) {
      const [kind, at, a, b, c] = sorted[next++]!;
      p.push(kind, at, a, b, c);
    }
    p.advance(t);
    // Key frames by time in microseconds so different frame rates line up.
    frames.set(Math.round(t * 1e6), [p.renderX, p.renderY, p.renderZ]);
  }
  return frames;
}

/** Physics with its clock started at t = 0, as the app's loop does on wake. */
function started(): CameraPhysics {
  const p = new CameraPhysics();
  p.advance(0);
  return p;
}

function settle(p: CameraPhysics, from: number, seconds = 10): number {
  let t = from;
  while (t < from + seconds) {
    t += 1 / 60;
    p.advance(t);
    if (p.isAtRest()) break;
  }
  return t;
}

describe('frame-rate independence', () => {
  const scenarios: [string, Input[]][] = [
    ['fling', drag(1800, -700, 0.1, 0.45)],
    ['slow drag, no fling', [...drag(120, 60, 0.1, 0.6), [DRAG_END, 0.7]]],
    ['trackpad scroll', trackpadScroll(0.05, 22, -9)],
    ['notched wheel', [0.1, 0.25, 0.4].map((t): Input => [WHEEL, t, 0, 100])],
    ['trackpad pinch while scrolling', [
      ...Array.from({ length: 40 }, (_, n): Input => [ZOOM, 0.05 + n / 60, 500, 300, Math.exp(-0.03)]),
      ...trackpadScroll(0.2, 12, 6),
    ]],
  ];
  for (const [name, inputs] of scenarios) {
    it(`${name}: identical path at 60, 120 and 144 Hz`, () => {
      const a = run(inputs, 60, 3);
      const b = run(inputs, 120, 3);
      const c = run(inputs, 144, 3);
      let compared = 0;
      for (const [t, [x, y, z]] of a) {
        for (const other of [b, c]) {
          const o = other.get(t);
          if (!o) continue;
          expect(Math.abs(o[0] - x)).toBeLessThan(1e-6);
          expect(Math.abs(o[1] - y)).toBeLessThan(1e-6);
          expect(Math.abs(o[2] - z)).toBeLessThan(1e-9);
          compared++;
        }
      }
      // 60 Hz frames all exist at 120 Hz; every 12th exists at 144 Hz.
      expect(compared).toBeGreaterThan(180);
    });
  }
});

describe('fling', () => {
  it('travels v₀·half-life/ln2 after release, then stops', () => {
    const p = started();
    const inputs = drag(1500, 0, 0, 0.3);
    for (const [kind, t, a, b] of inputs) p.push(kind, t, a, b);
    p.advance(0.31);
    const releasedAt = p.tx;
    const v0 = -p.vx;
    expect(v0).toBeGreaterThan(1400);
    settle(p, 0.31);
    const travel = releasedAt - p.x;
    const expected = (v0 * FLING_HALF_LIFE) / Math.LN2;
    // Stopping below STOP_SPEED skips at most STOP_SPEED/k of travel.
    expect(Math.abs(travel - expected)).toBeLessThan((STOP_SPEED * FLING_HALF_LIFE) / Math.LN2 + 1);
    expect(p.isAtRest()).toBe(true);
  });

  it('does not fling when the pointer was held still before release', () => {
    const p = started();
    for (const [kind, t, a, b] of drag(1500, 0, 0, 0.3)) {
      p.push(kind, kind === DRAG_END ? 0.3 + RELEASE_STALE + 0.02 : t, a, b);
    }
    p.advance(0.5);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
  });

  it(`caps release speed at ${MAX_FLING_SPEED} px/s`, () => {
    const p = started();
    for (const [kind, t, a, b] of drag(40_000, 30_000, 0, 0.1)) p.push(kind, t, a, b);
    p.advance(0.11);
    // A step or two of decay has already run since release.
    const speed = Math.hypot(p.vx, p.vy);
    expect(speed).toBeLessThanOrEqual(MAX_FLING_SPEED);
    expect(speed).toBeGreaterThan(MAX_FLING_SPEED * 0.95);
  });

  it('drags 1:1: the camera ends exactly where the pointer moved it', () => {
    const p = started();
    p.push(DRAG_START, 0, 100, 100);
    p.push(DRAG_MOVE, 0.05, 40, 130);
    p.push(DRAG_END, 1);
    p.advance(1.2);
    settle(p, 1.2);
    expect(p.x).toBe(60);
    expect(p.y).toBe(-30);
  });
});

describe('wheel', () => {
  it('adds no inertia of its own: the camera settles exactly on the summed deltas', () => {
    const p = started();
    const inputs = trackpadScroll(0, 20, 5);
    for (const [kind, t, a, b] of inputs) p.push(kind, t, a, b);
    settle(p, 0);
    const sum = inputs.reduce((s, [, , a = 0]) => s + a, 0);
    expect(p.x).toBe(p.tx);
    expect(p.x).toBeCloseTo(sum, 9);
  });

  it('cancels a running fling', () => {
    const p = started();
    for (const [kind, t, a, b] of drag(2000, 0, 0, 0.2)) p.push(kind, t, a, b);
    p.advance(0.3);
    expect(p.vx).not.toBe(0);
    p.push(WHEEL, 0.31, 0, 10);
    p.advance(0.33);
    expect(p.vx).toBe(0);
  });
});

describe('reduced motion', () => {
  it('moves the camera straight to its target and never flings', () => {
    const p = started();
    p.setReducedMotion(true);
    p.push(WHEEL, 0, 300, 0);
    p.advance(0.01);
    expect(p.x).toBe(300);
    for (const [kind, t, a, b] of drag(2000, 0, 0.1, 0.3)) p.push(kind, t, a, b);
    p.advance(0.32);
    expect(p.vx).toBe(0);
    expect(p.x).toBe(p.tx);
  });
});

describe('zoom', () => {
  function zoomable(): CameraPhysics {
    const p = started();
    p.setZoomLimits(0.5, 2.5, 0, 0);
    return p;
  }

  it('keeps the world point under the cursor fixed at every step of the eased zoom', () => {
    const p = zoomable();
    p.jumpTo(-1000, 400);
    const ax = 640;
    const ay = 360;
    const wx = p.x + ax / p.z;
    const wy = p.y + ay / p.z;
    let steps = 0;
    p.onStep = (x, y, z) => {
      expect(x + ax / z).toBeCloseTo(wx, 9);
      expect(y + ay / z).toBeCloseTo(wy, 9);
      steps++;
    };
    p.push(ZOOM, 0.01, ax, ay, 2);
    settle(p, 0.01);
    expect(p.z).toBe(2);
    expect(steps).toBeGreaterThan(20);
  });

  it('eases rather than jumps, and lands exactly on the target', () => {
    const p = zoomable();
    p.push(ZOOM, 0.01, 0, 0, 2);
    p.advance(0.05);
    expect(p.z).toBeGreaterThan(1);
    expect(p.z).toBeLessThan(2);
    settle(p, 0.05);
    expect(p.z).toBe(2);
    expect(p.isAtRest()).toBe(true);
  });

  it('stops at the limits, still anchored on the cursor', () => {
    const p = zoomable();
    for (let n = 0; n < 30; n++) p.push(ZOOM, 0.01 + n / 100, 200, 100, 1.5);
    settle(p, 0.01);
    expect(p.z).toBe(2.5);
    for (let n = 0; n < 30; n++) p.push(ZOOM, 2 + n / 100, 200, 100, 0.5);
    settle(p, 2);
    expect(p.z).toBe(0.5);
  });

  it('resets to zoom 1 about the given point', () => {
    const p = zoomable();
    p.push(ZOOM, 0.01, 100, 100, 2);
    settle(p, 0.01);
    const wx = p.x + 400 / p.z;
    p.push(ZOOM_RESET, 1, 400, 300);
    settle(p, 1);
    expect(p.z).toBe(1);
    expect(p.x + 400).toBeCloseTo(wx, 9);
  });

  it('pulls the zoom back in when the limits shrink', () => {
    const p = zoomable();
    p.push(ZOOM, 0.01, 0, 0, 2.5);
    settle(p, 0.01);
    p.setZoomLimits(0.5, 1.6, 0, 0);
    settle(p, 1);
    expect(p.z).toBe(1.6);
  });

  it('keeps wheel and drag 1:1 on screen at any zoom', () => {
    const p = zoomable();
    p.push(ZOOM, 0.01, 0, 0, 2);
    settle(p, 0.01);
    const x0 = p.x;
    p.push(WHEEL, 1, 300, 0);
    let t = settle(p, 1);
    expect((p.x - x0) * p.z).toBeCloseTo(300, 9);
    const x1 = p.x;
    p.push(DRAG_START, t + 0.01, 500, 500);
    p.push(DRAG_MOVE, t + 0.05, 380, 500);
    p.push(DRAG_END, t + 0.5);
    t = settle(p, t + 0.01);
    expect((p.x - x1) * p.z).toBeCloseTo(120, 9);
  });

  it('pinches about the midpoint, follows it, and never flings afterwards', () => {
    const p = zoomable();
    p.push(DRAG_START, 0.01, 400, 300);
    const wx = p.tx + 400 / p.tz;
    for (let n = 1; n <= 20; n++) p.push(PINCH, 0.01 + n / 120, 400, 300, 1.03);
    // The midpoint then drifts right; the world point under it travels with it.
    for (let n = 1; n <= 10; n++) p.push(DRAG_MOVE, 0.2 + n / 120, 400 + n * 10, 300);
    p.push(DRAG_END, 0.29);
    p.advance(0.3);
    expect(p.vx).toBe(0);
    settle(p, 0.3);
    expect(p.z).toBeCloseTo(1.03 ** 20, 9);
    expect(p.x + 500 / p.z).toBeCloseTo(wx, 6);
  });
});
