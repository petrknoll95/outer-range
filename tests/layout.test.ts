import { describe, expect, it } from 'vitest';
import { LONG, ZOOM_NARROW, ZOOM_NARROW_HEIGHT, ZOOM_NARROW_WIDTH } from '../src/canvas/config';
import type { Geometry } from '../src/canvas/layout';
import { zoomInFor, zoomInLevel } from '../src/canvas/layout';
import { tileSize } from '../src/canvas/world';

const geometry = (vw: number, vh: number, s = 170): Geometry => ({ vw, vh, s, pitch: s * 1.5, radius: 8, noRepeatGuaranteed: true });
/** The shapes the work comes in now. */
const RATIOS = [4 / 3, 3 / 4, 1];
/** The zoom an image of this ratio is focused at on a narrow screen. */
const narrowZoom = (g: Geometry, ratio: number) => {
  const { w, h } = tileSize(ratio);
  return zoomInFor(g, w * g.s, h * g.s, 1);
};

describe('the focused zoom', () => {
  it('is the same for every image on a wide screen', () => {
    const g = geometry(1440, 900, 300);
    const level = zoomInLevel(g, 2, 1400, RATIOS);
    expect(zoomInFor(g, 300, 400, level)).toBe(level);
    expect(zoomInFor(g, 400, 300, level)).toBe(level);
  });

  it('fills 90% of a narrow screen, whatever the shape', () => {
    const g = geometry(390, 844);
    for (const [width, height] of [
      [170, 170 * LONG],
      [170 * LONG, 170],
      [196, 196],
    ] as const) {
      expect(width * zoomInFor(g, width, height, 1)).toBeCloseTo(390 * ZOOM_NARROW_WIDTH);
    }
  });

  it('holds back on a short screen, to leave room for the pills above and below', () => {
    const g = geometry(375, 560);
    const height = 170 * LONG;
    expect(height * zoomInFor(g, 170, height, 1)).toBeCloseTo(560 * ZOOM_NARROW_HEIGHT);
  });

  it('never zooms out', () => {
    expect(zoomInFor(geometry(390, 844), 500, 500, 1)).toBe(1);
  });

  it('gives the zoom limit as the most any image needs', () => {
    for (const g of [geometry(390, 844), geometry(375, 560)]) {
      const limit = zoomInLevel(g, 3, 1400, RATIOS);
      expect(limit).toBeCloseTo(Math.max(...RATIOS.map((r) => narrowZoom(g, r))));
      for (const r of RATIOS) expect(narrowZoom(g, r)).toBeLessThanOrEqual(limit);
    }
    // On a short phone a square, held back less by the height, needs more than a portrait.
    const short = geometry(375, 560);
    expect(zoomInLevel(short, 3, 1400, RATIOS)).toBeCloseTo(narrowZoom(short, 1));
  });

  it('raises the zoom limit for a narrower image than any before', () => {
    const g = geometry(390, 844, 110);
    const before = zoomInLevel(g, 3, 1400, RATIOS);
    const after = zoomInLevel(g, 3, 1400, [...RATIOS, 9 / 16]);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(narrowZoom(g, 9 / 16));
  });

  it('counts as narrow up to the width the info bar appears', () => {
    expect(ZOOM_NARROW).toBe(760);
  });
});
