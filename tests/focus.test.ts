import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import manifest from '../src/assets/placeholders/manifest.json';
import { FOCUS_MAX_DURATION, FOCUS_MIN_DURATION, PAGE_REACH } from '../src/canvas/config';
import { centerDelta, focusDuration, nearestImageCentre, smoothstep, startSlope } from '../src/canvas/focus';
import { cellRect, computeGeometry } from '../src/canvas/layout';
import { CameraPhysics, DRAG_END, DRAG_MOVE, DRAG_START, GLIDE, NUDGE, WHEEL, ZOOM, ZOOM_TO } from '../src/canvas/physics';
import type { Aspect } from '../src/canvas/world';
import { createWorld } from '../src/canvas/world';

function started(): CameraPhysics {
  const p = new CameraPhysics();
  p.advance(0);
  p.setZoomLimits(0.5, 2.5, 0, 0);
  return p;
}

function settle(p: CameraPhysics, from: number, seconds = 5): number {
  let t = from;
  while (t < from + seconds) {
    t += 1 / 60;
    p.advance(t);
    if (p.isAtRest()) break;
  }
  return t;
}

describe('glide', () => {
  it('lands exactly on its target and comes to rest', () => {
    const p = started();
    p.push(GLIDE, 0.01, 640, -380, 0.5);
    settle(p, 0.01);
    expect(p.x).toBe(640);
    expect(p.y).toBe(-380);
    expect(p.isAtRest()).toBe(true);
  });

  it('eases out: fastest as it leaves, then slowing smoothly all the way to rest', () => {
    const p = started();
    p.push(GLIDE, 0.01, 1000, 0, 0.6);
    const speeds: number[] = [];
    p.onStep = () => speeds.push(Math.abs(p.stepVx));
    settle(p, 0.01);
    const peak = Math.max(...speeds);
    const at = speeds.indexOf(peak);
    // Up to speed within the camera's smoothing (a few tens of ms), then never speeding up again.
    expect(at / speeds.length).toBeLessThan(0.15);
    // The last moving step is the sub-pixel snap onto the target; leave it out.
    let snap = speeds.length - 1;
    while (speeds[snap] === 0) snap--;
    for (let n = at + 1; n < snap; n++) expect(speeds[n]!).toBeLessThanOrEqual(speeds[n - 1]! + 1e-6);
    expect(speeds[snap - 1]!).toBeLessThan(peak * 0.01);
  });

  it('takes as long as asked', () => {
    const p = started();
    p.push(GLIDE, 0.01, 800, 0, 0.5);
    p.advance(0.01 + 0.25);
    // Halfway through the time, an ease-out cubic is 7/8 of the way (to the last 240 Hz step).
    expect(p.tx).toBeGreaterThan(680);
    expect(p.tx).toBeLessThanOrEqual(700);
    const end = settle(p, 0.26);
    expect(end).toBeGreaterThan(0.5);
    expect(end).toBeLessThan(0.75);
  });

  it('follows the same path at 60, 120 and 144 Hz', () => {
    const run = (fps: number) => {
      const p = started();
      p.push(GLIDE, 0.005, 900, 300, 0.55);
      const out = new Map<number, number>();
      for (let n = 1; n <= fps; n++) {
        p.advance(n / fps);
        out.set(Math.round((n / fps) * 1e6), p.renderX);
      }
      return out;
    };
    const a = run(60);
    for (const other of [run(120), run(144)]) {
      for (const [t, x] of a) if (other.has(t)) expect(Math.abs(other.get(t)! - x)).toBeLessThan(1e-6);
    }
  });

  it('gives way to any other input, from wherever it has got to', () => {
    const p = started();
    p.push(GLIDE, 0.01, 1000, 0, 0.6);
    p.advance(0.3);
    const midway = p.tx;
    expect(midway).toBeGreaterThan(100);
    expect(midway).toBeLessThan(900);
    p.push(WHEEL, 0.3, 0, 50);
    settle(p, 0.3);
    expect(p.x).toBeCloseTo(midway, 9);
    expect(p.y).toBeCloseTo(50, 9);
  });

  it('jumps straight there under reduced motion', () => {
    const p = started();
    p.setReducedMotion(true);
    p.push(GLIDE, 0.01, 500, 200, 0.6);
    p.advance(0.02);
    expect(p.x).toBe(500);
    expect(p.y).toBe(200);
  });
});

describe('glide timing', () => {
  it('grows with distance but stays within its bounds', () => {
    expect(focusDuration(0)).toBe(FOCUS_MIN_DURATION);
    expect(focusDuration(1e6)).toBe(FOCUS_MAX_DURATION);
    expect(focusDuration(1200)).toBeGreaterThan(focusDuration(300));
  });

  it('eases from 0 to 1 symmetrically, flat at both ends', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(0.25) + smoothstep(0.75)).toBeCloseTo(1, 12);
    expect(startSlope(0)).toBe(0);
    expect(startSlope(1)).toBe(0);
    // Slope 1 at the start, 0 at the end.
    expect(startSlope(1e-6) / 1e-6).toBeCloseTo(1, 4);
    expect(startSlope(1 - 1e-6) / 1e-6).toBeCloseTo(0, 4);
  });
});

describe('centring a clicked image', () => {
  const world = createWorld(manifest.map((m) => ({ aspect: m.aspect as Aspect })));
  const [vw, vh] = [1440, 900];
  const g = computeGeometry(vw, vh, world);

  it('brings any tile exactly to the viewport centre, at any zoom', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.double({ min: 0.6, max: 2.4, noNaN: true }),
        (i, j, zoom) => {
          const p = started();
          // An off-centre zoom first, so the camera has moved to keep its anchor.
          p.push(ZOOM, 0.01, 1100, 120, zoom);
          let t = settle(p, 0.01);
          const rect = cellRect(world.cell(i, j), g, { left: 0, top: 0, width: 0, height: 0 });
          const { dx, dy } = centerDelta(rect, p.tx, p.ty, p.tz, vw, vh);
          p.push(GLIDE, t + 0.01, dx, dy, focusDuration(Math.hypot(dx, dy)));
          t = settle(p, t + 0.01);
          expect(p.isAtRest()).toBe(true);
          expect((rect.left + rect.width / 2 - p.x) * p.z).toBeCloseTo(vw / 2, 6);
          expect((rect.top + rect.height / 2 - p.y) * p.z).toBeCloseTo(vh / 2, 6);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('glide from a moving start', () => {
  /** The glide target's path, one sample per 240 Hz step. */
  function path(vx: number, vy: number): { xs: number[]; ys: number[]; p: CameraPhysics } {
    const p = started();
    p.push(GLIDE, 0.01, 600, 0, 0.5, vx, vy);
    const xs: number[] = [];
    const ys: number[] = [];
    p.onStep = () => {
      xs.push(p.tx);
      ys.push(p.ty);
    };
    settle(p, 0.01);
    return { xs, ys, p };
  }

  it('leaves at least as fast as it was moving, and still lands exactly at rest', () => {
    const { xs, p } = path(4000, 0);
    const moving = xs.findIndex((x) => x !== 0);
    expect((xs[moving + 2]! - xs[moving + 1]!) * 240).toBeGreaterThan(3800);
    expect(p.x).toBe(600);
    expect(p.isAtRest()).toBe(true);
  });

  it('a flick faster than the ease-out arrives sooner instead of overshooting', () => {
    const { xs } = path(5000, 0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(600);
    // 3 × 600 px at 5000 px/s: there in 0.36 s rather than the 0.5 asked.
    expect(xs.findIndex((x) => x === 600) / 240).toBeLessThan(0.4);
  });

  it('carries sideways motion on, fading out, and still lands exactly', () => {
    const { ys, p } = path(0, 1500);
    expect(Math.max(...ys)).toBeGreaterThan(20);
    expect(p.x).toBe(600);
    expect(p.y).toBe(0);
  });
});

describe('zoom to a point', () => {
  const centre = { x: 720, y: 450 };
  function zoomable(): CameraPhysics {
    const p = started();
    p.setZoomLimits(1, 2.4, 0, 0);
    p.centreX = centre.x;
    p.centreY = centre.y;
    return p;
  }

  it('lands the point exactly at the view centre at the target zoom', () => {
    fc.assert(
      fc.property(fc.double({ min: -3000, max: 3000, noNaN: true }), fc.double({ min: -3000, max: 3000, noNaN: true }), (wx, wy) => {
        const p = zoomable();
        p.push(ZOOM_TO, 0.01, wx, wy, 2.4, 0.5);
        settle(p, 0.01);
        expect(p.z).toBe(2.4);
        expect((wx - p.x) * p.z).toBeCloseTo(centre.x, 6);
        expect((wy - p.y) * p.z).toBeCloseTo(centre.y, 6);
        expect(p.isAtRest()).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('zooms and travels together, easing out: fastest at the start, slowing smoothly to rest', () => {
    const p = zoomable();
    p.jumpTo(0, 0, 1);
    p.push(ZOOM_TO, 0.01, 1300, 800, 2.4, 0.6);
    const zs: number[] = [];
    const xs: number[] = [];
    p.onStep = () => {
      zs.push(p.z);
      xs.push(p.x);
    };
    settle(p, 0.01);
    const growth = zs.slice(1).map((z, n) => z / zs[n]! - 1);
    const start = growth.findIndex((g) => g > 0);
    const peak = growth.indexOf(Math.max(...growth));
    const moved = zs.findIndex((z) => z === 2.4);
    // Fastest from the start (its first step only covers part of a 240 Hz step), never
    // speeding up after, and almost still by the end.
    expect(peak - start).toBeLessThanOrEqual(1);
    for (let n = peak + 1; n < moved - 1; n++) expect(growth[n]!).toBeLessThanOrEqual(growth[n - 1]! + 1e-12);
    expect(growth[moved - 2]!).toBeLessThan(growth[peak]! * 0.01);
    // Halfway through the time, an ease-out cubic is 7/8 of the way, in log zoom.
    expect(Math.log(zs[Math.round(0.3 * 240) - 2]!) / Math.log(2.4)).toBeCloseTo(0.875, 1);
    expect(xs.at(-1)).toBe(p.x);
  });

  it('gives way to the user from wherever it has got to, but still reaches its zoom level', () => {
    const p = zoomable();
    p.push(ZOOM_TO, 0.01, 500, 300, 2.4, 0.6);
    p.advance(0.3);
    const z = p.z;
    expect(z).toBeGreaterThan(1);
    expect(z).toBeLessThan(2.4);
    // The world point at the view centre, then a scroll: the zoom carries on about the centre while the scroll pans.
    const cx = p.x + p.centreX / p.z;
    p.push(WHEEL, 0.3, 50, 0);
    settle(p, 0.3);
    expect(p.z).toBe(2.4);
    expect(p.x + p.centreX / p.z).toBeCloseTo(cx + 50 / 2.4, 6);
  });
});

describe('paging (zoomed in)', () => {
  // A grid of "images" every 400 px: the snapper finds the grid point nearest a camera position.
  const STEP_PX = 400;
  const grid = (v: number) => Math.round(v / STEP_PX) * STEP_PX;
  function paging(): CameraPhysics {
    const p = started();
    p.snapper = (x, y) => ({ x: grid(x), y: grid(y) });
    p.setPaging(STEP_PX);
    return p;
  }
  /** A scroll of `total` px along (ux, uy) in events 16 ms apart, starting at t0. */
  function scroll(p: CameraPhysics, t0: number, ux: number, uy: number, total: number, events = 40): number {
    for (let n = 0; n < events; n++) p.push(WHEEL, t0 + n * 0.016, (ux * total) / events, (uy * total) / events);
    return t0 + events * 0.016;
  }

  it('a short scroll springs back to the image it started on', () => {
    const p = paging();
    p.push(WHEEL, 0.01, 50, 0);
    settle(p, 0.01);
    expect(p.x).toBe(0);
  });

  it('a scroll pages as soon as it passes the threshold', () => {
    const p = paging();
    p.push(WHEEL, 0.01, 0.3 * STEP_PX, 0);
    settle(p, 0.01);
    expect(p.x).toBe(STEP_PX);
  });

  it('a long scroll moves exactly one image, however far it goes, and so does a reversed one', () => {
    const p = paging();
    let t = scroll(p, 0.01, 1, 0, 3000);
    t = settle(p, t);
    expect(p.x).toBe(STEP_PX);
    expect(p.isAtRest()).toBe(true);
    t = scroll(p, t + 0.5, -1, 0, 3000);
    settle(p, t);
    expect(p.x).toBe(0);
  });

  it('pulling never gets further than PAGE_REACH from the image, and letting go pages one', () => {
    const p = paging();
    p.push(DRAG_START, 0.01, 1000, 400);
    let furthest = 0;
    p.onStep = () => {
      if (p.dragging) furthest = Math.max(furthest, Math.abs(p.tx));
    };
    for (let n = 1; n <= 100; n++) p.push(DRAG_MOVE, 0.01 + n / 120, 1000 - n * 20, 400);
    // Hold still, then let go: no flick, just the pull.
    p.push(DRAG_END, 0.01 + 100 / 120 + 0.3);
    settle(p, 0.01);
    expect(furthest).toBeLessThanOrEqual(PAGE_REACH * STEP_PX + 1e-9);
    expect(p.x).toBe(STEP_PX);
  });

  it('a quick short flick pages too, and the camera never jolts after letting go', () => {
    const p = paging();
    p.push(DRAG_START, 0.01, 800, 400);
    for (let n = 1; n <= 6; n++) p.push(DRAG_MOVE, 0.01 + n / 120, 800 - n * 10, 400);
    p.push(DRAG_END, 0.01 + 6 / 120 + 0.002);
    const xs: number[] = [];
    let dragged = false;
    p.onStep = () => {
      if (p.dragging) dragged = true;
      else if (dragged) xs.push(p.x);
    };
    settle(p, 0.01);
    expect(p.x).toBe(STEP_PX);
    const v = xs.slice(1).map((x, n) => (x - xs[n]!) * 240);
    for (let n = 2; n < v.length; n++) expect(Math.abs(v[n]! - v[n - 1]!)).toBeLessThan(200);
  });

  it('a diagonal scroll goes to the diagonal neighbour', () => {
    const p = paging();
    const t = scroll(p, 0.01, Math.SQRT1_2, Math.SQRT1_2, 600);
    settle(p, t);
    expect([p.x, p.y]).toEqual([STEP_PX, STEP_PX]);
  });

  it('arrow keys page one image per press', () => {
    const p = paging();
    p.push(NUDGE, 0.01, 300, 0);
    p.push(NUDGE, 0.05, 300, 0);
    settle(p, 0.01);
    expect(p.x).toBe(2 * STEP_PX);
  });

  /**
   * A trackpad swipe as browsers on macOS report it: the fingers' part (speed rising to
   * `peak` px/s and still moving at lift-off, 120 events/s), then momentum from the lift-off
   * speed, fading with a 0.5 s time constant until under 0.3 px per event.
   */
  function swipe(t0: number, peak: number, dir = 1): { events: [number, number][]; lift: number } {
    const events: [number, number][] = [];
    const dt = 1 / 120;
    let t = t0;
    for (; t < t0 + 0.15; t += dt) events.push([t, dir * peak * Math.sin(Math.PI * (((t - t0) / 0.15) * 0.75 + 0.05)) * dt]);
    const lift = t;
    for (let d = peak * Math.sin(Math.PI * 0.8) * dt; d >= 0.3; d *= Math.exp(-dt / 0.5), t += dt) events.push([t, dir * d]);
    return { events, lift };
  }
  /** Feed scroll events in time, with the simulation running alongside at 60 fps, then let it settle. */
  function feed(p: CameraPhysics, events: [number, number][]): void {
    let now = 0;
    for (const [t, d] of events) {
      while (now + 1 / 60 <= t) p.advance((now += 1 / 60));
      p.push(WHEEL, t, d, 0);
    }
    settle(p, now);
  }
  /** Swipes one after another; each new one stops the last one's momentum as the fingers land. */
  function swipes(starts: number[], peak: number): [number, number][] {
    const all = starts.map((t) => swipe(t, peak).events);
    return all.flatMap((events, n) => events.filter(([t]) => t < (starts[n + 1] ?? Infinity) - 0.03));
  }

  it('a trackpad swipe pages straight away, without waiting for its momentum to die out', () => {
    const p = paging();
    const { events, lift } = swipe(0.01, 400);
    // The clock starts at 0 and steps at 240 Hz.
    let steps = 0;
    let paged = Number.POSITIVE_INFINITY;
    p.onStep = () => {
      steps++;
      if (paged === Number.POSITIVE_INFINITY && Math.abs(p.tx) > STEP_PX / 2) paged = steps / 240;
    };
    feed(p, events);
    expect(p.x).toBe(STEP_PX);
    // Momentum keeps coming for over a second; the page is well under way long before.
    expect(paged - lift).toBeLessThan(0.4);
  });

  it('each trackpad swipe pages once, even one that starts while the last one is still coasting', () => {
    for (const gap of [0.15, 0.3, 0.6, 1]) {
      for (const peak of [600, 1500, 4000]) {
        const p = paging();
        const a = swipe(0.01, peak).lift + gap;
        const b = swipe(a, peak).lift + gap;
        feed(p, swipes([0.01, a, b], peak));
        expect([gap, peak, p.x]).toEqual([gap, peak, 3 * STEP_PX]);
      }
    }
  });

  it('a trackpad swipe pages only once however its events arrive: rounded, unevenly timed or merged', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let run = 0; run < 60; run++) {
      const p = paging();
      const out: [number, number][] = [];
      let carry = 0;
      let merged = 0;
      for (const [t, d] of swipe(0.01, [600, 1500, 4000][run % 3]!).events) {
        carry += d;
        // A busy frame merges up to three events into one.
        if (merged < 2 && random() < 0.3) {
          merged++;
          continue;
        }
        merged = 0;
        const whole = Math.round(carry);
        if (whole === 0) continue;
        carry -= whole;
        out.push([Math.max(out.at(-1)?.[0] ?? 0, t + (random() - 0.5) * 0.004), whole]);
      }
      feed(p, out);
      expect(p.x).toBe(STEP_PX);
    }
  });

  it('a mouse wheel pages once per spin', () => {
    const p = paging();
    const events: [number, number][] = [];
    for (const start of [0.01, 0.8]) for (let n = 0; n < 15; n++) events.push([start + n * 0.04, 100]);
    feed(p, events);
    expect(p.x).toBe(2 * STEP_PX);
  });

  it('a scroll during the zoom-in still lands at the zoomed-in level', () => {
    const p = paging();
    p.centreX = 720;
    p.centreY = 450;
    p.push(ZOOM_TO, 0.01, 1000, 600, 2, 0.55);
    p.advance(0.25);
    for (let n = 0; n < 10; n++) p.push(WHEEL, 0.25 + n / 120, 4, 0);
    settle(p, 0.25);
    expect(p.z).toBe(2);
  });
});

describe('nearest image', () => {
  const world = createWorld(manifest.map((m) => ({ aspect: m.aspect as Aspect })));
  const g = computeGeometry(1440, 900, world);

  it('finds the closest image centre to any point', () => {
    const out = { x: 0, y: 0 };
    fc.assert(
      fc.property(fc.double({ min: -1e5, max: 1e5, noNaN: true }), fc.double({ min: -1e5, max: 1e5, noNaN: true }), (x, y) => {
        nearestImageCentre(world, g, x, y, out);
        const d = Math.hypot(out.x - x, out.y - y);
        // Brute force over a wide neighbourhood finds nothing closer.
        const i0 = Math.round(x / g.pitch);
        const j0 = Math.round(y / g.pitch);
        for (let i = i0 - 4; i <= i0 + 4; i++) {
          for (let j = j0 - 4; j <= j0 + 4; j++) {
            const r = cellRect(world.cell(i, j), g, { left: 0, top: 0, width: 0, height: 0 });
            expect(Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y)).toBeGreaterThanOrEqual(d - 1e-9);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
