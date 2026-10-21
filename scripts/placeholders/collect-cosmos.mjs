// Collects candidate placeholder images from public Cosmos clusters.
// Usage: node scripts/placeholders/collect-cosmos.mjs <clusterUrl>...
// Writes scripts/placeholders/candidates.json: one entry per image with its
// CDN id, Cosmos element id, native size, cluster and element description.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./candidates.json', import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';

const clusters = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, userAgent: UA });
const candidates = [];

for (const cluster of clusters) {
  await page.goto(cluster, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const seen = new Map();
  let stale = 0;
  for (let i = 0; i < 40 && stale < 4; i++) {
    const batch = await page.$$eval('[data-elt-id]', (tiles) =>
      tiles.map((tile) => {
        const elementId = tile.getAttribute('data-elt-id');
        const img = tile.querySelector('img[data-testid=element-image-img]');
        const m = img && (img.getAttribute('src') || '').match(/cdn\.cosmos\.so\/([0-9a-f-]{36})/);
        if (m) return { cdnId: m[1], elementId, kind: 'image', width: +img.getAttribute('width'), height: +img.getAttribute('height') };
        // Video elements: use the poster frame. Its size comes from the tile's aspect-ratio style.
        const poster = tile.querySelector('video')?.getAttribute('poster') || '';
        const p = poster.match(/cdn\.cosmos\.so\/([0-9a-f-]{36})/);
        const ratio = [...tile.querySelectorAll('[style*="aspect-ratio"]')].pop()?.style.aspectRatio.match(/([\d.]+)\s*\/\s*([\d.]+)/);
        return p && ratio ? { cdnId: p[1], elementId, kind: 'video-poster', width: +ratio[1], height: +ratio[2] } : null;
      }).filter(Boolean));
    const before = seen.size;
    for (const c of batch) if (!seen.has(c.cdnId)) seen.set(c.cdnId, c);
    stale = seen.size === before ? stale + 1 : 0;
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(900);
  }
  for (const c of seen.values()) candidates.push({ ...c, cluster });
  console.log(`${cluster}: ${seen.size}`);
}
await browser.close();

// Element pages carry the uploader's description (often the real credit) in <meta name="description">.
for (const c of candidates) {
  const html = await fetch(`https://www.cosmos.so/e/${c.elementId}`, { headers: { 'user-agent': UA } }).then((r) => r.text());
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  c.description = desc.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  c.elementUrl = `https://www.cosmos.so/e/${c.elementId}`;
}

writeFileSync(OUT, JSON.stringify(candidates, null, 2) + '\n');
console.log(`wrote ${candidates.length} candidates → ${OUT}`);
