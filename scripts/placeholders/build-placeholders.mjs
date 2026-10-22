// Turns scripts/placeholders/candidates.json into cropped placeholder images and a manifest.
// Usage: node scripts/placeholders/build-placeholders.mjs
//
// 1. Downloads each CDN original (cached in .cache/) and reads its real size.
// 2. Drops images too small to crop to MIN_SHORT_EDGE, and near-duplicates (dHash).
// 3. Puts each image in the aspect class (4:3, 3:4, 1:1) nearest its native ratio,
//    then evens the classes out by moving the images that lose the least extra area
//    to the crop, never moving one that would lose more than MAX_EXTRA_LOSS.
// 4. Crops with sharp's attention strategy and records size, dominant colour and
//    provenance in src/assets/placeholders/manifest.json.
//
// The images come from Cosmos and belong to their authors. Placeholders only; do not publish.
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CANDIDATES = here('./candidates.json');
const CACHE = here('./.cache/');
const OUT = here('../../src/assets/placeholders/');

const MIN_SHORT_EDGE = 400; // after cropping; 2x of the smallest rendered short edge
const MAX_SHORT_EDGE = 1200; // stored master size; zooming in needs up to this, build variants are derived from it
const MAX_EXTRA_LOSS = 0.3; // rebalancing never crops away more than this extra fraction of an image
const DUPLICATE_DISTANCE = 8; // dHash bits; below this two images are the same picture
const RATIOS = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };

/** Largest rectangle of `ratio` that fits inside w×h. */
function cropSize(w, h, ratio) {
  return w / h > ratio ? { w: Math.round(h * ratio), h } : { w, h: Math.round(w / ratio) };
}
/** Fraction of the original area thrown away by cropping to `ratio`. */
function cropLoss(w, h, ratio) {
  const c = cropSize(w, h, ratio);
  return 1 - (c.w * c.h) / (w * h);
}
/** 64-bit difference hash: survives rescaling and recompression, so re-saves of one picture match. */
async function dHash(file) {
  const px = await sharp(file, { failOn: 'none' }).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  return bits;
}
const hamming = (a, b) => [...(a ^ b).toString(2)].filter((c) => c === '1').length;

// Placeholders since replaced by real work (scripts/work): left out so a rebuild doesn't bring them back.
const REPLACED = new Set([
  '229f2c3f-4120-4a41-9dd3-c395617e495d',
  '447bb97a-98da-4907-9d9c-8611c6ee2336',
  'b2d9ac4f-f543-48fa-ad1a-43ceaa8558e2',
  '1d45ceb7-d2bf-4d4a-917e-11943414be7a',
]);
const candidates = JSON.parse(readFileSync(CANDIDATES, 'utf8'))
  .filter((c) => !REPLACED.has(c.cdnId))
  .sort((a, b) => a.cdnId.localeCompare(b.cdnId));

mkdirSync(CACHE, { recursive: true });
const pool = [];
for (const c of candidates) {
  const cached = join(CACHE, `${c.cdnId}.bin`);
  if (!existsSync(cached)) {
    const res = await fetch(`https://cdn.cosmos.so/${c.cdnId}`);
    if (!res.ok) { console.warn(`skip ${c.cdnId}: HTTP ${res.status}`); continue; }
    writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  const meta = await sharp(cached, { failOn: 'none' }).metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  const options = Object.entries(RATIOS)
    .map(([aspect, ratio]) => ({ aspect, loss: cropLoss(width, height, ratio), crop: cropSize(width, height, ratio) }))
    .filter((o) => Math.min(o.crop.w, o.crop.h) >= MIN_SHORT_EDGE)
    .sort((a, b) => a.loss - b.loss);
  if (!options.length) { console.warn(`skip ${c.cdnId}: ${width}×${height} is too small`); continue; }
  const hash = await dHash(cached);
  // The same picture saved twice (e.g. a carousel and a single post) would defeat the
  // no-repeat rule, so keep only the largest copy.
  const twin = pool.find((p) => hamming(p.hash, hash) <= DUPLICATE_DISTANCE);
  if (twin) {
    const keepNew = width * height > twin.width * twin.height;
    console.warn(`duplicate: ${c.elementUrl} ≈ ${twin.elementUrl}; keeping ${keepNew ? 'the first' : 'the second'}`);
    if (!keepNew) continue;
    pool.splice(pool.indexOf(twin), 1);
  }
  pool.push({ ...c, cached, width, height, hash, options, aspect: options[0].aspect });
}

// Rebalance: while one class is larger than another, move the image whose move costs
// the least extra crop loss from the largest class to the smallest.
const count = (a) => pool.filter((p) => p.aspect === a).length;
const native = Object.fromEntries(Object.keys(RATIOS).map((a) => [a, count(a)]));
for (let guard = 0; guard < pool.length; guard++) {
  const sizes = Object.keys(RATIOS).map((a) => [a, count(a)]).sort((x, y) => y[1] - x[1]);
  let moved = false;
  // Try the smallest class first, then the middle one.
  for (const [small, smallN] of [sizes[2], sizes[1]]) {
    const [big, bigN] = sizes[0];
    if (bigN - smallN <= 1) continue;
    let best = null;
    for (const p of pool) {
      if (p.aspect !== big) continue;
      const to = p.options.find((o) => o.aspect === small);
      if (!to) continue;
      const extra = to.loss - p.options.find((o) => o.aspect === big).loss;
      if (extra <= MAX_EXTRA_LOSS && (!best || extra < best.extra)) best = { p, extra };
    }
    if (best) {
      best.p.aspect = small;
      moved = true;
      break;
    }
  }
  if (!moved) break;
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.jpg')) rmSync(join(OUT, f));

const manifest = [];
for (const p of pool) {
  const crop = cropSize(p.width, p.height, RATIOS[p.aspect]);
  const scale = Math.min(1, MAX_SHORT_EDGE / Math.min(crop.w, crop.h));
  const width = Math.round(crop.w * scale);
  const height = Math.round(crop.h * scale);
  const file = `${p.cdnId}.jpg`; // full id: Cosmos ids can be time-ordered, so prefixes collide
  const buffer = await sharp(p.cached, { failOn: 'none' })
    .rotate()
    .resize({ width, height, fit: 'cover', position: sharp.strategy.attention })
    .toColourspace('srgb')
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(OUT, file), buffer);
  const { dominant } = await sharp(buffer).stats();
  const hex = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');
  manifest.push({
    file,
    aspect: p.aspect,
    width,
    height,
    color: hex,
    cropLoss: Number(p.options.find((o) => o.aspect === p.aspect).loss.toFixed(3)),
    credit: p.description,
    elementUrl: p.elementUrl,
    cluster: p.cluster,
    source: `https://cdn.cosmos.so/${p.cdnId}`,
    // The file the uploader saved to Cosmos (or a video's poster frame); not traced further upstream.
    sourceKind: p.kind === 'video-poster' ? 'cosmos-video-poster' : 'cosmos-cdn-original',
  });
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const by = (a) => manifest.filter((m) => m.aspect === a).length;
console.log(`${manifest.length} images: landscape ${by('landscape')}, portrait ${by('portrait')}, square ${by('square')}`);
console.log(`nearest-shape counts before rebalancing: landscape ${native.landscape}, portrait ${native.portrait}, square ${native.square}`);
console.log(`dropped ${candidates.length - pool.length} candidates (too small or duplicate); max crop loss ${Math.max(...manifest.map((m) => m.cropLoss))}`);
