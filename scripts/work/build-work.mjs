// Turns a folder of exported work images (PNG, JPEG or WebP, e.g. Figma exports at 4×) into canvas
// masters and a manifest.
// Usage: node scripts/work/build-work.mjs <source folder>
//
// For each image in the folder:
// 1. Picks its aspect class (4:3, 3:4, 1:1), the one nearest its ratio, and fits it to that if
//    it isn't exact (artboards drawn at the tile shapes need no fitting). Off by a sliver (a crop
//    losing at most CROP_LOSS of it), it is cropped about its centre; further off, it is set
//    whole on white, INSET in from the edges at its own size, so nothing of it is cut. ANCHOR
//    crops one instead, where along the cropped side it says (a photo that bleeds off its edges).
// 2. Saves it as lossless WebP, keeping its colour profile (Figma exports Display P3): the
//    master the page builds every served variant from, so nothing is lost before that step.
// 3. Records size, dominant colour and colour grid in src/assets/work/manifest.json.
// Images already in the manifest and not in the folder stay as they are, so a folder of new
// exports adds to the work; one named like an existing image replaces it.
import sharp from 'sharp';
import { pixelGrid } from '../pixels/pixel-grid.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

const OUT = fileURLToPath(new URL('../../src/assets/work/', import.meta.url));
const RATIOS = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };
/** Images a centred crop would cut into: where the crop sits, 0 (left or top edge) to 1 (right or bottom). */
const ANCHOR = { 'flex-posters': 0, 'oxyd-sip': 0.2 };
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
  const [aspect, target] = Object.entries(RATIOS).sort(([, a], [, b]) => Math.abs(Math.log(ratio / a)) - Math.abs(Math.log(ratio / b)))[0];
  const crop = ratio > target ? { w: Math.round(height * target), h: height } : { w: width, h: Math.round(width / target) };
  const loss = 1 - (crop.w * crop.h) / (width * height);
  let image, w, h, fit;
  if (loss === 0) {
    [image, w, h, fit] = [input, width, height, 'exact'];
  } else if (id in ANCHOR || loss <= CROP_LOSS) {
    const at = ANCHOR[id] ?? 0.5;
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
    fit = `inset on white (a crop would cut ${(loss * 100).toFixed(0)}%)`;
  }

  const file = `${id}.webp`;
  const { size } = await image.clone().keepIccProfile().webp({ lossless: true, effort: 6 }).toFile(join(OUT, file));
  const { dominant } = await sharp(join(OUT, file)).stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');

  built.push({ file, aspect, width: w, height: h, color, pixels: await pixelGrid(join(OUT, file), aspect), source: name });
  console.log(`${file}: ${aspect} ${w}×${h}, ${fit}, ${(size / 1e6).toFixed(2)} MB`);
}

const kept = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).filter((entry) => !built.some((b) => b.file === entry.file)) : [];
const manifest = [...kept, ...built].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
