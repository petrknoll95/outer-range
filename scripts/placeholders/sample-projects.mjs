// Writes src/content/projects.json: sample projects grouping the placeholder images.
// Usage: node scripts/placeholders/sample-projects.mjs
//
// Every image goes into exactly one project of MIN..MAX images. Images are ordered by
// dominant colour (neutrals by lightness, then colours around the hue wheel) and cut into
// runs, so each sample project reads as one body of work rather than a random handful.
// Names and years are invented. Projects list images by the id of their entry in
// src/content/images, so every image needs one first. Re-run after placeholders:build
// changes the image set; real projects replace this file by hand.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const MANIFEST = here('../../src/assets/placeholders/manifest.json');
const IMAGES = here('../../src/content/images');
const OUT = here('../../src/content/projects.json');

const MIN = 3; // matches MIN_PROJECT_IMAGES in src/canvas/projects.ts
const MAX = 9;
const NAMES = [
  'Low Tide Seltzer',
  'Orchard Tonic',
  'Night Swim',
  'Copper & Clove',
  'Field Notes Kombucha',
  'Paper Moon Soda',
  'Salt & Stone',
  'Greenhouse Elixir',
  'Midnight Garden',
  'Citrus Club',
  'Slow Pour',
  'Quiet Hour',
  'Glasshouse Gin',
  'Sunday Fizz',
  'Wild Hours',
  'Northbound Cider',
  'Tall Grass',
  'Second Bloom',
  'Harbour Light',
  'Morning Market',
];

/** Hex colour → { h (0–360), s, l } in HSL. */
function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

// Each image file's entry id: the entry's file name, from its `file:` frontmatter line.
const idOf = new Map();
for (const name of readdirSync(IMAGES).filter((n) => n.endsWith('.md'))) {
  const value = /^file:\s*(.+)$/m.exec(readFileSync(`${IMAGES}/${name}`, 'utf8'))?.[1]?.trim();
  if (value) idOf.set(value.startsWith('"') ? JSON.parse(value) : value, name.slice(0, -3));
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const missing = manifest.filter((m) => !idOf.has(m.file)).map((m) => m.file);
if (missing.length) throw new Error(`No entry in src/content/images for: ${missing.join(', ')}`);
const ordered = manifest
  .map((m) => ({ file: m.file, ...hsl(m.color) }))
  .map((c) => ({ ...c, neutral: c.s * (1 - Math.abs(2 * c.l - 1)) < 0.12 }))
  .sort((a, b) => (a.neutral !== b.neutral ? (a.neutral ? -1 : 1) : a.neutral ? a.l - b.l : a.h - b.h || a.l - b.l));

// Run lengths from a fixed pseudo-random sequence, so the file is reproducible.
let seed = 0x2026;
const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const sizes = [];
let left = ordered.length;
while (left > 0) {
  let size = MIN + Math.floor(next() * (MAX - MIN + 1));
  if (left - size < MIN) size = left; // never leave a run shorter than MIN
  sizes.push(size);
  left -= size;
}
if (sizes.length > NAMES.length) throw new Error(`Need ${sizes.length} names; add more to NAMES.`);

let at = 0;
const projects = sizes.map((size, n) => {
  const title = NAMES[n];
  const images = ordered.slice(at, at + size).map((c) => idOf.get(c.file));
  at += size;
  return {
    id: title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title,
    year: 2021 + Math.floor(next() * 6),
    images,
  };
});

writeFileSync(OUT, JSON.stringify(projects, null, 2) + '\n');
console.log(`${projects.length} sample projects, ${ordered.length} images: ${projects.map((p) => `${p.title} (${p.images.length})`).join(', ')}`);
