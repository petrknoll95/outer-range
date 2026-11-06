// Build the AtomsAI loop without regenerating or removing other project media.
// Source: native 3840px-wide / 60 FPS loop, reframed to 4:3 landscape, the shape every tile had when it was built.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { gridSize, pixelGrid } from '../pixels/pixel-grid.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = `${root}art/atomsai/applications-landscape-4k60.mp4`;
const out = `${root}src/assets/videos/`;
const id = 'atomsai-applications';
const run = args => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', source, ...args], { stdio: 'inherit' });
for (const [suffix, width, height] of [['', 1440, 1080], ['-small', 480, 360]]) {
  const common = ['-vf', `scale=${width}:${height}:flags=lanczos`, '-an', '-r', '60', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709'];
  run([...common, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', `${out}${id}${suffix}.mp4`]);
  run([...common, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '25', '-row-mt', '1', '-cpu-used', '4', `${out}${id}${suffix}.webm`]);
  console.log(`Encoded ${width}×${height} MP4 / WebM at 60 FPS`);
}
const poster = `${id}.jpg`;
run(['-frames:v', '1', '-vf', 'scale=1440:1080:flags=lanczos', '-q:v', '1', `${out}${poster}`]);
const { dominant } = await sharp(`${out}${poster}`).stats();
const entry = {
  file: `${id}.mp4`, webm: `${id}.webm`, small: `${id}-small.mp4`, smallWebm: `${id}-small.webm`, poster,
  grid: gridSize(1440, 1080), width: 1440, height: 1080,
  color: '#' + [dominant.r, dominant.g, dominant.b].map(n => n.toString(16).padStart(2, '0')).join(''),
  pixels: await pixelGrid(`${out}${poster}`, gridSize(1440, 1080)), duration: 20,
  source: 'art/atomsai/applications-landscape-4k60.mp4',
};
const manifestPath = `${out}manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const previous = manifest.findIndex(m => m.file === entry.file);
if (previous < 0) manifest.push(entry); else manifest[previous] = entry;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
