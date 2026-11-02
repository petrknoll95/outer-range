// A still's colour grid: the image pixelated to a few cells, each cell the average colour of
// that part of it, as hex digits run together, left to right and top to bottom. The canvas
// flies a tile in as one ray per cell and shows the grid until the image itself has loaded.
import sharp from 'sharp';

/** Columns and rows, near square cells, for each aspect; src/canvas/config.ts (PIXEL_GRID) reads them back. */
const GRID = { landscape: [24, 18], portrait: [18, 24], square: [21, 21] };
/** Source pixels averaged per cell, each way. */
const SAMPLES = 8;

export async function pixelGrid(input, aspect) {
  const [cols, rows] = GRID[aspect];
  const { data } = await sharp(input, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .resize(cols * SAMPLES, rows * SAMPLES, { fit: 'cover' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hex = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Averaged as light, so a dark and a bright patch come out as the eye blends them.
      const sum = [0, 0, 0];
      for (let y = 0; y < SAMPLES; y++) {
        for (let x = 0; x < SAMPLES; x++) {
          const at = ((row * SAMPLES + y) * cols * SAMPLES + col * SAMPLES + x) * 3;
          for (let c = 0; c < 3; c++) sum[c] += (data[at + c] / 255) ** 2.2;
        }
      }
      for (const c of sum) hex += Math.round(255 * (c / SAMPLES ** 2) ** (1 / 2.2)).toString(16).padStart(2, '0');
    }
  }
  return hex;
}
