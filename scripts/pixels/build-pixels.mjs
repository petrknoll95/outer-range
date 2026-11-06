// Adds (or refreshes) the colour grid of every image already in the manifests, without
// rebuilding them. The image and video builds record it themselves.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gridSize, pixelGrid } from './pixel-grid.mjs';

const ASSETS = 'src/assets';

for (const [folder, still] of [
  ['work', (entry) => entry.file],
  ['videos', (entry) => entry.poster],
]) {
  const path = join(ASSETS, folder, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const entry of manifest) {
    entry.grid = gridSize(entry.width, entry.height);
    entry.pixels = await pixelGrid(join(ASSETS, folder, still(entry)), entry.grid);
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${folder}: ${manifest.length} grids`);
}
