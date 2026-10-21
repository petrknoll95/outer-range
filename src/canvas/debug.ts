import { LENS_REPEAT_SHARE } from './config';
import type { Geometry } from './layout';
import type { Lens, LensPoint } from './lens';
import type { CameraPhysics } from './physics';
import type { Renderer } from './renderer';
import type { World } from './world';

interface DebugApi {
  world: World;
  physics: CameraPhysics;
  renderer: Renderer;
  lens: Lens;
  geometry: () => Geometry;
  zoomLimits: () => { min: number; max: number };
  domNodes: () => number;
  onFrame: (fn: () => void) => () => void;
}

const HISTORY = 180;

/**
 * `?debug` overlay: the lattice as the lens draws it, the lens's full-size and edge
 * contours, a frame-time graph and pool stats. Tiles get i,j #image labels from the renderer.
 */
export function attachDebug(api: DebugApi): void {
  const grid = document.createElement('canvas');
  grid.className = 'pointer-events-none fixed inset-0 z-10 size-full';
  const panel = document.createElement('div');
  panel.className =
    'pointer-events-none fixed top-3 left-3 z-20 w-80 rounded-lg bg-black/80 p-3 font-mono text-[11px] leading-4 text-white';
  const stats = document.createElement('pre');
  const graph = document.createElement('canvas');
  graph.width = 232 * 2;
  graph.height = 48 * 2;
  graph.className = 'mt-2 h-12 w-[232px]';
  panel.append(stats, graph);
  document.body.append(grid, panel);

  const frames = new Float32Array(HISTORY);
  let head = 0;
  let last = performance.now();
  const ctx = grid.getContext('2d')!;
  const gctx = graph.getContext('2d')!;
  const point: LensPoint = { x: 0, y: 0, scale: 1 };

  /** Trace the screen contour where the unlensed radius is `rho`. */
  const contour = (rho: number, hx: number, hy: number) => {
    const p = api.lens.params?.roundness ?? 2;
    ctx.beginPath();
    for (let n = 0; n <= 128; n++) {
      const a = (n / 128) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Superellipse point at radius rho, through the lens.
      const u = Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * rho;
      const v = Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * rho;
      api.lens.apply(u * hx, v * hy, hx, hy, point);
      if (n === 0) ctx.moveTo(hx + point.x, hy + point.y);
      else ctx.lineTo(hx + point.x, hy + point.y);
    }
    ctx.stroke();
  };

  api.onFrame(() => {
    const t = performance.now();
    frames[head] = t - last;
    head = (head + 1) % HISTORY;
    last = t;

    const g = api.geometry();
    const { physics: p, renderer: r, world } = api;
    const dpr = window.devicePixelRatio;
    if (grid.width !== g.vw * dpr || grid.height !== g.vh * dpr) {
      grid.width = g.vw * dpr;
      grid.height = g.vh * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.vw, g.vh);
    ctx.strokeStyle = 'rgba(255, 0, 80, 0.35)';
    ctx.fillStyle = 'rgba(255, 0, 80, 0.8)';
    ctx.font = '10px ui-monospace, monospace';
    const z = p.renderZ;
    const hx = g.vw / 2;
    const hy = g.vh / 2;
    // Lattice points (with column stagger) as the lens draws them; dot size follows the lens scale.
    const reach = api.lens.reach;
    const i0 = Math.floor((p.renderX + (hx - hx * reach) / z) / g.pitch) - 1;
    const i1 = Math.ceil((p.renderX + (hx + hx * reach) / z) / g.pitch) + 1;
    for (let i = i0; i <= i1; i++) {
      const st = world.columnStagger(i) * g.s;
      const j0 = Math.floor((p.renderY + (hy - hy * reach) / z - st) / g.pitch) - 1;
      const j1 = Math.ceil((p.renderY + (hy + hy * reach) / z - st) / g.pitch) + 1;
      for (let j = j0; j <= j1; j++) {
        api.lens.apply((i * g.pitch - p.renderX) * z - hx, (j * g.pitch + st - p.renderY) * z - hy, hx, hy, point);
        const d = 2 + 3 * point.scale;
        ctx.fillRect(hx + point.x - d / 2, hy + point.y - d / 2, d, d);
      }
    }
    if (api.lens.params) {
      // Inside the inner contour images are full size; the outer one is where the viewport edge's midpoints come from.
      ctx.setLineDash([6, 6]);
      contour(api.lens.params.inner, hx, hy);
      contour(1, hx, hy);
      ctx.setLineDash([]);
    }

    const sorted = Array.from(frames).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(HISTORY * 0.95)]!;
    const worst = sorted[HISTORY - 1]!;
    stats.textContent = [
      `camera   ${p.renderX.toFixed(0)}, ${p.renderY.toFixed(0)}`,
      `speed    ${Math.hypot(p.vx, p.vy).toFixed(0)} px/s ${p.dragging ? '(drag)' : ''}`,
      `S        ${g.s.toFixed(1)} px  pitch ${g.pitch.toFixed(1)}`,
      `zoom     ${p.renderZ.toFixed(3)} (${api.zoomLimits().min.toFixed(2)}–${api.zoomLimits().max.toFixed(2)}), laid out at ${r.zoomLaidOut.toFixed(3)}`,
      `no-repeat ${!g.noRepeatGuaranteed || p.renderZ < 1 ? `≥ ${world.cols} cells apart (zoomed out)` : api.lens.params && LENS_REPEAT_SHARE < 1 ? 'on screen, bar small edge images' : 'on screen'} (${world.cols}×${world.rows})`,
      `lens     ${api.lens.params ? `reach ${api.lens.reach.toFixed(2)}, edge scale ${api.lens.scaleAt(1).toFixed(2)}` : 'off (?flat)'}`,
      `tiles    ${r.activeCount} active / ${r.poolSize} pool`,
      `dom      ${api.domNodes()} nodes`,
      `frame    p95 ${p95.toFixed(1)} ms  max ${worst.toFixed(1)} ms`,
    ].join('\n');

    const w = graph.width;
    const h = graph.height;
    gctx.clearRect(0, 0, w, h);
    const bar = w / HISTORY;
    for (let n = 0; n < HISTORY; n++) {
      const ms = frames[(head + n) % HISTORY]!;
      gctx.fillStyle = ms > 17.5 ? '#ff4d6d' : ms > 9 ? '#ffd166' : '#06d6a0';
      const bh = Math.min(h, (ms / 33.3) * h);
      gctx.fillRect(n * bar, h - bh, Math.max(1, bar - 1), bh);
    }
    gctx.fillStyle = 'rgba(255,255,255,0.4)';
    gctx.fillRect(0, h - (16.7 / 33.3) * h, w, 1);
    gctx.fillRect(0, h - (8.3 / 33.3) * h, w, 1);
  });
}
