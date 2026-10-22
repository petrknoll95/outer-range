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

// Placeholders since replaced by real work (scripts/work, scripts/videos) or dropped to make room for it:
// left out so a rebuild doesn't bring them back.
const REPLACED = new Set([
  '229f2c3f-4120-4a41-9dd3-c395617e495d',
  '447bb97a-98da-4907-9d9c-8611c6ee2336',
  'b2d9ac4f-f543-48fa-ad1a-43ceaa8558e2',
  '1d45ceb7-d2bf-4d4a-917e-11943414be7a',
  '54152d80-a001-4b83-9e8f-154344242929',
  'fb58c8f2-33e2-4aaf-9b48-c89cc2b75f69',
  'd7778fb1-016a-455d-8b79-b216c7ca2eb6',
  '01a071f9-a918-783b-99b3-c61102d56ab9',
  '235d9b27-79f5-4fdf-b423-a616c92ac8f4',
  'bb02abf1-73db-4e64-ac1f-695176f43e79',
  '9023b51a-a70c-4aa4-a003-254c2fdda043',
  'fa84364b-3d54-4a4a-931f-e5dbf8d7dcfd',
  '1e6a49b8-9e51-40e9-a1cd-55af68beb915',
  '7506d29c-94e8-44cd-84f5-ffe101d5d3b3',
  'c6d5a27e-3e26-4cd6-b66a-5ca4d37d4d42',
  'f6b6838f-43dd-478a-ae41-a92330899a1f',
  '0bcb4860-2fb9-4e73-bbef-bcbb2d15d8e3',
  '2ffaf6c7-1a7e-4bb8-b3b3-fa038d7a234d',
  '01a11c45-d5c6-7e47-bf47-9b4962a1f4f9',
  '7434a1db-49a1-4769-a7ca-9021568b6149',
  '86780b69-12d7-48c2-baa4-8b77d8811fc2',
  'ab91aa74-ecc5-4671-917c-6798f36e49ee',
  '5552a2d9-744b-4c8e-b7be-f25002f41dde',
  '2a1ad221-d956-4019-8b1a-08994bd755c4',
  '01a11c45-d66c-715c-9322-bec91c470d16',
  'f9d4b7a5-607d-4e1d-a7af-c3ecd38fc2a4',
  'ce1f62ef-1712-4523-a320-d9ddc5ddefc8',
  'e9cea093-f4a4-4fad-9262-037ec671c271',
  'f945658b-9ad4-4867-8cc8-6dd854b9cb67',
  '825ceb00-d141-43c3-9589-24952ff72c80',
  'fae1a5d5-1c6f-4400-8e8c-b9cdd01f822f',
  'c75327ca-1de4-418f-a515-bf3d387f69b8',
  '4d267767-dbf2-4605-bdf0-11253e4f0a75',
  '1ef40c60-b7bc-44a7-8d7e-814244ec5cab',
  'ffc27b71-4f4c-47ac-bd47-ae51afe059e2',
  '092daf3a-33ac-4379-aba1-b5e5c186d3ac',
  '1a4fdb0d-32db-4844-8730-d2c578483e1c',
  '774ac344-964b-441f-9c3b-be87cc624eb8',
  'fce07ba2-32b7-480b-89d9-9fda1ce45a02',
  '58a51dba-8178-4f7a-880c-bf03a5abf833',
  '69c2e0dd-b9c5-492b-bf7a-1c3c9c3e0cb3',
  '01a1066c-6146-7010-bfa2-519a378861b9',
  '01a11b53-f0bf-70a5-a0e7-43060306ad35',
  '2d17828d-41ed-47dd-808f-77fff263410e',
  '7f110282-bf91-478e-8ac5-815d66da8128',
  '98c20287-623b-47ee-9eaa-718dfdaf7bb4',
  '99f540ce-05af-4c07-9734-1cc399f5de7d',
  'd2b8f20f-a6e1-4d30-97fc-fb2793c75390',
  'd977ad56-3e71-476d-aac1-66bd7a8991c8',
  'e37ca3e7-04fe-4eba-a25b-debf220731d5',
  '09f2240b-20d2-42b7-bc94-28c5fc0684db',
  '01a11b53-6dcb-742f-ae61-cbd91cc43bd8',
  '97b4dd2f-52ad-487d-bc7e-fde96d84e9ec',
  'f0a894cc-3725-4327-93dc-71e7bb3c7630',
  '3f088709-3840-4748-ad0b-453e805416cb',
  '91c46724-27e0-4197-9210-83518907ea16',
  '243bfa04-9fe4-41b7-91d3-d72a6b8bb4c4',
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
