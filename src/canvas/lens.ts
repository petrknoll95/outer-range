import { LENS_INNER, LENS_MIN_SCALE, LENS_OUTER, LENS_ROUNDNESS } from './config';

/** Lens shape; see the LENS_* constants in config.ts. */
export interface LensParams {
  inner: number;
  outer: number;
  minScale: number;
  roundness: number;
}

export const DEFAULT_LENS: LensParams = {
  inner: LENS_INNER,
  outer: LENS_OUTER,
  minScale: LENS_MIN_SCALE,
  roundness: LENS_ROUNDNESS,
};

export interface LensPoint {
  x: number;
  y: number;
  scale: number;
}

/**
 * A fisheye over the viewport, like the watchOS app grid.
 *
 * Positions are measured from the viewport centre in half-extents (u = x/hx, v = y/hy)
 * and their radius ρ is a superellipse norm, so the lens follows the viewport's
 * rounded-rectangle shape rather than a circle.
 *
 * - Scale f(ρ) is 1 inside `inner`, eases (smoothstep) down to `minScale` at `outer`,
 *   and stays there beyond.
 * - Every point moves along its ray to radius M(ρ) = ∫₀^ρ f. Radial spacing therefore
 *   shrinks exactly as fast as the tiles do (dM/dρ = f), and spacing along the ring
 *   shrinks by M(ρ)/ρ ≥ f, so shrunken tiles close up instead of floating apart.
 *
 * With `null` params the lens is the identity.
 */
export class Lens {
  /**
   * How far from the viewport centre, in half-extents per axis, the world reaches that
   * the lens squeezes into the viewport. The renderer loads cells out to here, and the
   * no-repeat sizing counts this much world as visible.
   */
  readonly reach: number;

  private readonly amount: number;
  private readonly width: number;

  constructor(readonly params: LensParams | null) {
    this.amount = params ? 1 - params.minScale : 0;
    this.width = params ? params.outer - params.inner : 1;
    this.reach = params ? this.computeReach() : 1;
  }

  /** Superellipse radius of (u, v), in half-extents. */
  radius(u: number, v: number): number {
    const p = this.params?.roundness ?? 2;
    return Math.pow(Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p), 1 / p);
  }

  /** Tile scale at radius ρ. */
  scaleAt(rho: number): number {
    if (!this.params) return 1;
    const x = Math.min(1, Math.max(0, (rho - this.params.inner) / this.width));
    return 1 - this.amount * x * x * (3 - 2 * x);
  }

  /** M(ρ) = ∫₀^ρ scaleAt: where a point at radius ρ ends up. */
  mapRadius(rho: number): number {
    if (!this.params || rho <= this.params.inner) return rho;
    const x = (rho - this.params.inner) / this.width;
    // ∫₀^x smoothstep = x³ − x⁴/2 up to x = 1, then the scale is flat.
    const area = x <= 1 ? x * x * x - (x * x * x * x) / 2 : 0.5 + (x - 1);
    return rho - this.amount * this.width * area;
  }

  /** Inverse of mapRadius. */
  unmapRadius(r: number): number {
    if (!this.params || r <= this.params.inner) return r;
    const edge = this.mapRadius(this.params.outer);
    if (r >= edge) return this.params.outer + (r - edge) / this.params.minScale;
    let lo = this.params.inner;
    let hi = this.params.outer;
    for (let n = 0; n < 48; n++) {
      const mid = (lo + hi) / 2;
      if (this.mapRadius(mid) < r) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * Maps a tile centred at (qx, qy) px from the viewport centre, with half-size
   * (halfW, halfH) px, on a viewport with half-extents hx, hy: its lensed centre and scale.
   *
   * The scale is taken at the tile's corner farthest from the centre, not at its centre.
   * Along any ray the lensed spacing between two tiles is the integral of a falling
   * scale, which is never less than each tile's half-size times the scale at its far
   * edge, so the lens cannot push two tiles into each other along a ray. Off-axis, where
   * the superellipse bends the rays, the most it makes is a sliver (tests/lens.test.ts).
   */
  apply(qx: number, qy: number, hx: number, hy: number, out: LensPoint, halfW = 0, halfH = 0): LensPoint {
    const rho = this.params ? this.radius(qx / hx, qy / hy) : 0;
    if (!this.params) {
      out.x = qx;
      out.y = qy;
      out.scale = 1;
      return out;
    }
    const k = rho > this.params.inner ? this.mapRadius(rho) / rho : 1;
    out.x = qx * k;
    out.y = qy * k;
    out.scale = this.scaleAt(this.radius((Math.abs(qx) + halfW) / hx, (Math.abs(qy) + halfH) / hy));
    return out;
  }

  /**
   * Inverse of `apply`: the unlensed point that the lens draws at (x, y) px from the
   * viewport centre. Input runs pointer positions through this, so the image under the
   * pointer is the one that drags and zooms with it.
   */
  unapply(x: number, y: number, hx: number, hy: number, out: { x: number; y: number }): { x: number; y: number } {
    const rho = this.params ? this.radius(x / hx, y / hy) : 0;
    if (!this.params || rho <= this.params.inner) {
      out.x = x;
      out.y = y;
      return out;
    }
    const k = this.unmapRadius(rho) / rho;
    out.x = x * k;
    out.y = y * k;
    return out;
  }

  /** Pull every point of the viewport's edge back through the lens; the farthest one sets the reach. */
  private computeReach(): number {
    let reach = 1;
    const samples = 256;
    for (let n = 0; n <= samples; n++) {
      // One quarter of the edge is enough: the lens is symmetric in both axes.
      const t = n / samples;
      for (const [u, v] of [[1, t], [t, 1]] as const) {
        const rho = this.radius(u, v);
        const k = this.unmapRadius(rho) / rho;
        reach = Math.max(reach, u * k, v * k);
      }
    }
    return reach;
  }
}
