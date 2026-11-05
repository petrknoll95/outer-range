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

let sampler: CanvasRenderingContext2D | null = null;

/**
 * A grid `finer` times finer each way than the image's own: from the image itself as drawn
 * (cropped to fill, as the tile does), or, until it has loaded, its colour grid cell by cell.
 */
export function finerGrid(img: HTMLImageElement, { aspect, pixels }: { aspect: Aspect; pixels: string }, finer: number): { cols: number; rows: number; rgba: Uint8ClampedArray } {
  const [c, r] = PIXEL_GRID[aspect];
  const cols = c * finer;
  const rows = r * finer;
  if (img.complete && img.naturalWidth > 0) {
    try {
      sampler ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const { canvas } = sampler;
      canvas.width = cols;
      canvas.height = rows;
      sampler.imageSmoothingQuality = 'high';
      // The whole image, scaled to fill and centred. (Not cut by a source rectangle: from a srcset its
      // natural size is in CSS px, a source rectangle in the file's own, so that would take a corner.)
      const scale = Math.max(cols / img.naturalWidth, rows / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      sampler.drawImage(img, (cols - w) / 2, (rows - h) / 2, w, h);
      return { cols, rows, rgba: sampler.getImageData(0, 0, cols, rows).data };
    } catch {
      // Can't be read back: its grid will do.
    }
  }
  const rgba = new Uint8ClampedArray(cols * rows * 4);
  for (let n = 0; n < cols * rows; n++) {
    const col = n % cols;
    const row = (n - col) / cols;
    const [red, green, blue] = hexRgb(pixelColor(pixels, Math.floor(row / finer) * c + Math.floor(col / finer)));
    rgba.set([red * 255, green * 255, blue * 255, 255], n * 4);
  }
  return { cols, rows, rgba };
}
