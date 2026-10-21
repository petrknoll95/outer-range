import type { Geometry } from './layout';
import type { CameraPhysics } from './physics';
import type { Renderer } from './renderer';
import type { World } from './world';

interface DebugApi {
  world: World;
  physics: CameraPhysics;
  renderer: Renderer;
  geometry: () => Geometry;
  domNodes: () => number;
  onFrame: (fn: () => void) => () => void;
}

const HISTORY = 180;

/** `?debug` overlay: lattice, frame-time graph and pool stats. Tiles get i,j #image labels from the renderer. */
export function attachDebug(api: DebugApi): void {
  const grid = document.createElement('canvas');
  grid.className = 'pointer-events-none fixed inset-0 z-10 size-full';
  const panel = document.createElement('div');
  panel.className =
    'pointer-events-none fixed top-3 left-3 z-20 w-64 rounded-lg bg-black/80 p-3 font-mono text-[11px] leading-4 text-white';
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
    const i0 = Math.floor(p.renderX / g.pitch) - 1;
    const i1 = Math.ceil((p.renderX + g.vw) / g.pitch) + 1;
    for (let i = i0; i <= i1; i++) {
      const x = i * g.pitch - p.renderX;
      const st = world.columnStagger(i) * g.s;
      const j0 = Math.floor((p.renderY - st) / g.pitch) - 1;
      const j1 = Math.ceil((p.renderY + g.vh - st) / g.pitch) + 1;
      for (let j = j0; j <= j1; j++) {
        const y = j * g.pitch + st - p.renderY;
        ctx.strokeRect(x - g.pitch / 2, y - g.pitch / 2, g.pitch, g.pitch);
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }

    const sorted = Array.from(frames).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(HISTORY * 0.95)]!;
    const worst = sorted[HISTORY - 1]!;
    stats.textContent = [
      `camera   ${p.renderX.toFixed(0)}, ${p.renderY.toFixed(0)}`,
      `speed    ${Math.hypot(p.vx, p.vy).toFixed(0)} px/s ${p.dragging ? '(drag)' : ''}`,
      `S        ${g.s.toFixed(1)} px  pitch ${g.pitch.toFixed(1)}`,
      `no-repeat ${g.noRepeatGuaranteed ? 'guaranteed' : 'NOT guaranteed'} (${world.cols}×${world.rows})`,
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
