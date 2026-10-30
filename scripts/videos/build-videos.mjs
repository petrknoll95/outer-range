// Turns a folder of source videos into canvas videos, a poster frame for each and a manifest.
// Usage: node scripts/videos/build-videos.mjs <source folder>
//
// For each video (.mp4, .mov or .webm) in the folder:
// 1. Picks its aspect class (4:3, 3:4, 1:1): the one nearest its ratio, unless ASPECT says otherwise.
// 2. Crops it to that ratio about the centre, scales it to at most MAX_SHORT_EDGE, drops the
//    audio and encodes it twice: VP9 WebM, smaller for the same quality, which browsers play
//    where they can, and H.264 MP4 (faststart, so it plays before it has all loaded) for the
//    rest. A second pair, SMALL_SHORT_EDGE, is for tiles drawn small: decoding the full one
//    for a thumbnail costs every frame.
// 3. Takes a poster frame from the encoded video (at POSTER, as a fraction of its length): the
//    tile shows it until the video plays, and it is what the page builds image variants from.
// 4. Records the files, size, dominant colour and length in src/assets/videos/manifest.json.
//
// Needs ffmpeg and ffprobe on the PATH.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../../src/assets/videos/', import.meta.url));
const MAX_SHORT_EDGE = 1080;
const SMALL_SHORT_EDGE = 360;
const RATIOS = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };
/** Videos whose subject the nearest crop would cut. */
const ASPECT = { 'subzero-cans': 'portrait', 'oxyd-drink': 'portrait' };
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
const probe = (file) => {
  const [width, height, duration] = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'default=nw=1:nk=1', file])
    .trim()
    .split('\n')
    .map(Number);
  return { width, height, duration };
};
const even = (n) => Math.round(n / 2) * 2;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const name of readdirSync(source).filter((f) => /\.(mp4|mov|webm)$/i.test(f)).sort()) {
  const id = name.replace(/\.[^.]+$/, '');
  const input = join(source, name);
  const { width, height } = probe(input);
  const ratio = width / height;
  const aspect = ASPECT[id] ?? Object.entries(RATIOS).sort(([, a], [, b]) => Math.abs(Math.log(ratio / a)) - Math.abs(Math.log(ratio / b)))[0][0];
  const target = RATIOS[aspect];
  // The largest centred rectangle of the target ratio, then scaled down to the short-edge cap.
  const crop = ratio > target ? { w: even(height * target), h: height } : { w: width, h: even(width / target) };
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

  manifest.push({ file: video, webm, small, smallWebm, poster, aspect, width: out.w, height: out.h, color, duration: Math.round(duration * 100) / 100, source: name });
  console.log(`${video}: ${aspect} ${out.w}×${out.h}, ${duration.toFixed(1)} s`);
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
