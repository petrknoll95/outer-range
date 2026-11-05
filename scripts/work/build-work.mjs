// Turns a folder of exported work images (PNG, JPEG or WebP, e.g. Figma exports at 4×) into canvas
// masters and a manifest.
// Usage: node scripts/work/build-work.mjs <source folder>
//
// For each image in the folder:
// 1. Picks its aspect class (4:3, 3:4, 1:1), the one nearest its ratio, and crops it to that
//    if it isn't exact (artboards drawn at the tile shapes need no crop): about the centre,
//    unless ANCHOR says where along the cropped side to keep.
// 2. Saves it as lossless WebP, keeping its colour profile (Figma exports Display P3): the
//    master the page builds every served variant from, so nothing is lost before that step.
// 3. Records size, dominant colour and colour grid in src/assets/work/manifest.json.
import sharp from 'sharp';
import { pixelGrid } from '../pixels/pixel-grid.mjs';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

const OUT = fileURLToPath(new URL('../../src/assets/work/', import.meta.url));
const RATIOS = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };
/** Images a centred crop would cut into: where the crop sits, 0 (left or top edge) to 1 (right or bottom). */
const ANCHOR = { 'flex-posters': 0, 'oxyd-sip': 0.2 };

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/work/build-work.mjs <source folder>');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const name of readdirSync(source).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort()) {
  const id = name.slice(0, -extname(name).length);
  const input = sharp(join(source, name));
  const { width, height } = await input.metadata();
  const ratio = width / height;
  const [aspect, target] = Object.entries(RATIOS).sort(([, a], [, b]) => Math.abs(Math.log(ratio / a)) - Math.abs(Math.log(ratio / b)))[0];
  const crop = ratio > target ? { w: Math.round(height * target), h: height } : { w: width, h: Math.round(width / target) };
  const at = ANCHOR[id] ?? 0.5;
  const image =
    crop.w === width && crop.h === height
      ? input
      : input.extract({ left: Math.round((width - crop.w) * at), top: Math.round((height - crop.h) * at), width: crop.w, height: crop.h });

  const file = `${id}.webp`;
  const { size } = await image.clone().keepIccProfile().webp({ lossless: true, effort: 6 }).toFile(join(OUT, file));
  const { dominant } = await image.clone().stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');

  manifest.push({ file, aspect, width: crop.w, height: crop.h, color, pixels: await pixelGrid(join(OUT, file), aspect), source: name });
  console.log(`${file}: ${aspect} ${crop.w}×${crop.h}, ${(size / 1e6).toFixed(2)} MB`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
