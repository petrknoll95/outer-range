import { PIXEL_GRID } from './config';
import type { Aspect } from './world';

/**
 * An image's colour grid: the image pixelated to a few cells, each the average colour of that
 * part of it, as six hex digits a cell run together, left to right and top to bottom (built by
 * scripts/pixels). The intro flies a tile in as one ray per cell; a tile shows it until its
 * image has loaded.
 */

export type Rgb = readonly [number, number, number];

export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Cell n's hex digits. */
export const pixelColor = (pixels: string, n: number): string => pixels.slice(n * 6, n * 6 + 6);

/** Every cell's colour. */
export function pixelColors(pixels: string): Rgb[] {
  return Array.from({ length: pixels.length / 6 }, (_, n) => hexRgb(pixelColor(pixels, n)));
}

/** The grid as an image, one pixel per cell: a data URL, for a tile's background. */
export function pixelImage({ aspect, pixels }: { aspect: Aspect; pixels: string }): string {
  const [cols, rows] = PIXEL_GRID[aspect];
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(cols, rows);
  pixelColors(pixels).forEach(([r, g, b], n) => image.data.set([r * 255, g * 255, b * 255, 255], n * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
