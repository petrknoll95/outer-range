// Turns a folder of source videos into canvas videos, a poster frame for each and a manifest.
// Usage: node scripts/videos/build-videos.mjs <source folder>
//
// For each video (.mp4, .mov or .webm) in the folder:
// 1. Keeps its own shape, as the canvas draws every image at its own ratio (src/canvas/world.ts,
//    tileSize), unless CROP gives it another or it is longer than MAX_RATIO to a side.
// 2. Crops it to that about the centre, if it has to, scales it to at most MAX_SHORT_EDGE, drops the
//    audio and encodes it twice: VP9 WebM, smaller for the same quality, which browsers play
//    where they can, and H.264 MP4 (faststart, so it plays before it has all loaded) for the
//    rest. A second pair, SMALL_SHORT_EDGE, is for tiles drawn small: decoding the full one
//    for a thumbnail costs every frame.
// 3. Takes a poster frame from the encoded video (at POSTER, as a fraction of its length): the
//    tile shows it until the video plays, and it is what the page builds image variants from.
// 4. Records the files, size, dominant colour, colour grid and length in src/assets/videos/manifest.json.
// Videos already in the manifest and not in the folder stay as they are, so a folder of new videos
// adds to them; one named like an existing video replaces it, in its place, so no other moves.
//
// Needs ffmpeg and ffprobe on the PATH.
import sharp from 'sharp';
import { gridSize, pixelGrid } from '../pixels/pixel-grid.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../../src/assets/videos/', import.meta.url));
const MAX_SHORT_EDGE = 1080;
const SMALL_SHORT_EDGE = 360;
/** The longest a video may be, long side over short; a longer one is cropped to it. */
const MAX_RATIO = 3;
/** Videos cropped to another ratio, width over height: these keep the portrait tile shape they were framed for. */
const CROP = { 'subzero-cans': 3 / 4, 'oxyd-drink': 3 / 4, 'topset-carousel': 3 / 4 };
/** Where the poster frame comes from, as a fraction of the length; the default is a third of the way. */
const POSTER = { 'subzero-cans': 0, 'experimental-navigation-1': 0, 'offmenu-website': 0.85, 'oxyd-drink': 0 };

const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/videos/build-videos.mjs <source folder>');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
/** VP9 in constant-quality mode (CRF, no bitrate cap), row-threaded so it encodes in reasonable time. */
const vp9 = (crf) => ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf), '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'];
// As JSON: some files list a stream's size twice, which shifts a plain line-by-line reading.
const probe = (file) => {
  const { streams, format } = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]));
  return { width: streams[0].width, height: streams[0].height, duration: Number(format.duration) };
};
const even = (n) => Math.round(n / 2) * 2;
/** The even number of pixels at or below n (to the nearest pixel), so a crop never asks for more than the frame has. */
const evenDown = (n) => Math.floor(Math.round(n) / 2) * 2;

mkdirSync(OUT, { recursive: true });
const MANIFEST = join(OUT, 'manifest.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];

for (const name of readdirSync(source).filter((f) => /\.(mp4|mov|webm)$/i.test(f)).sort()) {
  const id = name.replace(/\.[^.]+$/, '');
  const input = join(source, name);
  const { width, height } = probe(input);
  const ratio = width / height;
  const target = CROP[id] ?? Math.min(MAX_RATIO, Math.max(1 / MAX_RATIO, ratio));
  // The largest centred rectangle of the target ratio (the whole frame, unless it is cropped), then scaled down to the short-edge cap.
  const crop = ratio > target ? { w: evenDown(height * target), h: evenDown(height) } : { w: evenDown(width), h: evenDown(width / target) };
  const scale = Math.min(1, MAX_SHORT_EDGE / Math.min(crop.w, crop.h));
  const out = { w: even(crop.w * scale), h: even(crop.h * scale) };

  const video = `${id}.mp4`;
  run('ffmpeg', [
    '-v', 'error', '-y', '-i', input,
    '-vf', `crop=${crop.w}:${crop.h},scale=${out.w}:${out.h}:flags=lanczos`,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, video),
  ]);
  const { duration } = probe(join(OUT, video));
  const webm = `${id}.webm`;
  run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `crop=${crop.w}:${crop.h},scale=${out.w}:${out.h}:flags=lanczos`, ...vp9(42), join(OUT, webm)]);

  const small = `${id}-small.mp4`;
  const k = SMALL_SHORT_EDGE / Math.min(out.w, out.h);
  run('ffmpeg', [
    '-v', 'error', '-y', '-i', join(OUT, video),
    '-vf', `scale=${even(out.w * k)}:${even(out.h * k)}:flags=lanczos`,
    '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    join(OUT, small),
  ]);
  const smallWebm = `${id}-small.webm`;
  run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', `crop=${crop.w}:${crop.h},scale=${even(out.w * k)}:${even(out.h * k)}:flags=lanczos`, ...vp9(44), join(OUT, smallWebm)]);

  const poster = `${id}.jpg`;
  const at = (POSTER[id] ?? 1 / 3) * duration;
  run('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', join(OUT, video), '-frames:v', '1', '-q:v', '2', join(OUT, poster)]);
  const { dominant } = await sharp(join(OUT, poster)).stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map((n) => n.toString(16).padStart(2, '0')).join('');

  const grid = gridSize(out.w, out.h);
  const entry = { file: video, webm, small, smallWebm, poster, grid, width: out.w, height: out.h, color, duration: Math.round(duration * 100) / 100, source: name, pixels: await pixelGrid(join(OUT, poster), grid) };
  const previous = manifest.findIndex((m) => m.file === video);
  if (previous < 0) manifest.push(entry);
  else manifest[previous] = entry;
  // After each video, so a run stopped part way leaves the manifest true to the files.
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  const cropped = crop.w * crop.h < (width - 1) * (height - 1) ? `, cropped from ${width}×${height}` : '';
  console.log(`${video}: ${out.w}×${out.h} (${(out.w / out.h).toFixed(3)})${cropped}, ${duration.toFixed(1)} s`);
}
