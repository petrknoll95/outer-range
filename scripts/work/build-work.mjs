// Turns a folder of exported work images (PNG, JPEG or WebP, e.g. Figma exports at 4×) into canvas
// masters and a manifest.
// Usage: node scripts/work/build-work.mjs <source folder>
//
// For each image in the folder:
// 1. Keeps its own shape: the canvas draws every image at its own ratio (src/canvas/world.ts,
//    tileSize). Two kinds are fitted to another ratio: one listed in CROP, cropped to the ratio
//    there wherever it says, however much it cuts; and one longer than MAX_RATIO to a side,
//    fitted to MAX_RATIO. That one, off by a sliver (a crop losing at most CROP_LOSS of it), is
//    cropped about its centre; further off, it is set whole on white, INSET in from the edges at
//    its own size, so nothing of it is cut.
// 2. Saves it as lossless WebP, keeping its colour profile (Figma exports Display P3): the
//    master the page builds every served variant from, so nothing is lost before that step.
// 3. Records size, dominant colour and colour grid (and the grid's size) in src/assets/work/manifest.json.
// Images already in the manifest and not in the folder stay as they are, so a folder of new
// exports adds to the work; one named like an existing image replaces it.
import sharp from 'sharp';
import { gridSize, pixelGrid } from '../pixels/pixel-grid.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

const OUT = fileURLToPath(new URL('../../src/assets/work/', import.meta.url));
/** The longest an image may be, long side over short; a longer one is fitted to it. The canvas draws 3:1 at LONG × 0.44 S. */
const MAX_RATIO = 3;
/**
 * Images cropped to another ratio, however much it cuts, never set on white: [ratio, width over
 * height; where the crop sits, 0 (left or top edge) to 1 (right or bottom)]. These were cropped to
 * the tile shapes the canvas once had; drop one and its next build keeps the whole image.
 */
const CROP = {
  'controltower-activity': [4 / 3, 0.5],
  'controltower-agency': [4 / 3, 0.5],
  'controltower-command-menu': [4 / 3, 0.5],
  'controltower-components': [4 / 3, 0.5],
  'controltower-empty-state': [4 / 3, 0.5],
  'controltower-filters': [4 / 3, 1],
  'controltower-health': [4 / 3, 0.5],
  'controltower-member': [4 / 3, 0.5],
  'controltower-new-project': [4 / 3, 0.5],
  'controltower-task': [4 / 3, 0.5],
  'controltower-team': [4 / 3, 0.5],
  'controltower-timeline': [4 / 3, 0.5],
  'controltower-workload': [4 / 3, 0.5],
  'flex-icons': [1, 0.5],
  'flex-posters': [4 / 3, 0],
  'oxyd-sip': [3 / 4, 0.2],
  'resonant-compliance': [4 / 3, 0.5],
  'resonant-integrations': [4 / 3, 0.5],
  'resonant-invoice-processor': [4 / 3, 0.5],
  'resonant-metrics': [4 / 3, 0.5],
  'resonant-wordmark': [4 / 3, 0.5],
};
/** The most of an image a crop may cut away before it is set on white instead. */
const CROP_LOSS = 0.04;
/** The white round an inset image, each side, as a share of its longer edge. */
const INSET = 0.06;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/work/build-work.mjs <source folder>');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const MANIFEST = join(OUT, 'manifest.json');
const built = [];

for (const name of readdirSync(source).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()) {
  const id = name.slice(0, -extname(name).length);
  const input = sharp(join(source, name));
  const { width, height } = await input.metadata();
  const ratio = width / height;
  const [target, at] = CROP[id] ?? [Math.min(MAX_RATIO, Math.max(1 / MAX_RATIO, ratio)), 0.5];
  const crop = ratio > target ? { w: Math.round(height * target), h: height } : { w: width, h: Math.round(width / target) };
  const loss = 1 - (crop.w * crop.h) / (width * height);
  let image, w, h, fit;
  if (loss === 0) {
    [image, w, h, fit] = [input, width, height, 'whole'];
  } else if (id in CROP || loss <= CROP_LOSS) {
    image = input.extract({ left: Math.round((width - crop.w) * at), top: Math.round((height - crop.h) * at), width: crop.w, height: crop.h });
    [w, h, fit] = [crop.w, crop.h, `cropped ${(loss * 100).toFixed(1)}%`];
  } else {
    // The white round it: INSET of its longer edge across its long sides, the rest of the shape across the others.
    const m = Math.round(INSET * Math.max(width, height));
    if (ratio > target) [w, h] = [width + 2 * m, Math.round((width + 2 * m) / target)];
    else [w, h] = [Math.round((height + 2 * m) * target), height + 2 * m];
    const left = Math.floor((w - width) / 2);
    const top = Math.floor((h - height) / 2);
    image = input.flatten({ background: WHITE }).extend({ left, right: w - width - left, top, bottom: h - height - top, background: WHITE });
    fit = `inset on white at ${ratio > 1 ? `${MAX_RATIO}:1` : `1:${MAX_RATIO}`} (a crop would cut ${(loss * 100).toFixed(0)}%)`;
  }

  const file = `${id}.webp`;
  const { size } = await image.clone().keepIccProfile().webp({ lossless: true, effort: 6 }).toFile(join(OUT, file));
  const { dominant } = await sharp(join(OUT, file)).stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');

  const grid = gridSize(w, h);
  built.push({ file, grid, width: w, height: h, color, source: name, pixels: await pixelGrid(join(OUT, file), grid) });
  console.log(`${file}: ${w}×${h} (${(w / h).toFixed(3)}), ${fit}, ${(size / 1e6).toFixed(2)} MB`);
}

const kept = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).filter((entry) => !built.some((b) => b.file === entry.file)) : [];
const manifest = [...kept, ...built].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
