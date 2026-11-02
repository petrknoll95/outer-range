import { describe, expect, it } from 'vitest';
import { LONG, ZOOM_NARROW, ZOOM_NARROW_HEIGHT, ZOOM_NARROW_WIDTH } from '../src/canvas/config';
import type { Geometry } from '../src/canvas/layout';
import { zoomInFor, zoomInLevel } from '../src/canvas/layout';

const geometry = (vw: number, vh: number, s = 170): Geometry => ({ vw, vh, s, pitch: s * 1.5, radius: 8, noRepeatGuaranteed: true });

describe('the focused zoom', () => {
  it('is the same for every image on a wide screen', () => {
    const g = geometry(1440, 900, 300);
    const level = zoomInLevel(g, 2, 1400);
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

  it('holds back on a short screen, to leave room for the caption', () => {
    const g = geometry(375, 560);
    const height = 170 * LONG;
    expect(height * zoomInFor(g, 170, height, 1)).toBeCloseTo(560 * ZOOM_NARROW_HEIGHT);
  });

  it('never zooms out', () => {
    expect(zoomInFor(geometry(390, 844), 500, 500, 1)).toBe(1);
  });

  it('gives the zoom limit as the most any image needs: a portrait one', () => {
    const g = geometry(390, 844);
    const limit = zoomInLevel(g, 3, 1400);
    expect(limit).toBeCloseTo(zoomInFor(g, 170, 170 * LONG, 1));
    expect(zoomInFor(g, 170 * LONG, 170, 1)).toBeLessThan(limit);
  });

  it('counts as narrow up to the width the info bar appears', () => {
    expect(ZOOM_NARROW).toBe(760);
  });
});
