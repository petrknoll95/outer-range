// Dev only: a Vite plugin that deletes a canvas image for good, for "X" on the canvas (src/canvas/devdelete.ts).
// It is applied to `astro dev` alone, so the built site has no such endpoint.
//
// POST /__dev/delete-image {"id": "<image id>"} removes, for that image:
// 1. its id from its project in src/content/projects.json (refused if the project would drop
//    below MIN_PROJECT_IMAGES, which would fail the build);
// 2. its entry in src/assets/work/manifest.json or src/assets/videos/manifest.json;
// 3. its content entry, src/content/images/<id>.md;
// 4. its files: the work master, or a video's copies and poster frame.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (path) => join(ROOT, path);
const readJson = (path) => JSON.parse(readFileSync(at(path), 'utf8'));
const writeJson = (path, value) => writeFileSync(at(path), JSON.stringify(value, null, 2) + '\n');

/** @returns {import('vite').Plugin} */
export function deleteImage() {
  return {
    name: 'outer-range:delete-image',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/delete-image', async (req, res) => {
        const reply = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'POST') return reply(405, { error: 'POST only.' });
        try {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          const { id } = JSON.parse(raw);
          const { ID_PATTERN } = await server.ssrLoadModule('/src/canvas/images.ts');
          const { MIN_PROJECT_IMAGES } = await server.ssrLoadModule('/src/canvas/projects.ts');
          if (typeof id !== 'string' || !ID_PATTERN.test(id)) return reply(400, { error: `Not an image id: ${JSON.stringify(id)}.` });

          const entry = `src/content/images/${id}.md`;
          if (!existsSync(at(entry))) return reply(404, { error: `No content entry for "${id}".` });
          const file = readFileSync(at(entry), 'utf8').match(/^file:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
          if (!file) return reply(500, { error: `${entry} names no file.` });

          const projects = readJson('src/content/projects.json');
          const project = projects.find((p) => p.images.includes(id));
          if (project && project.images.length - 1 < MIN_PROJECT_IMAGES) {
            return reply(409, { error: `"${project.title}" would have ${project.images.length - 1} images; it needs at least ${MIN_PROJECT_IMAGES}.` });
          }

          // Data, then files, all at once. The dev server can still catch them half-changed and show
          // an error for a moment; the reload that follows (devdelete.ts) clears it.
          if (project) {
            project.images = project.images.filter((image) => image !== id);
            writeJson('src/content/projects.json', projects);
          }
          const removed = [];
          for (const dir of ['work', 'videos']) {
            const path = `src/assets/${dir}/manifest.json`;
            const manifest = readJson(path);
            const media = manifest.find((m) => m.file === file);
            if (!media) continue;
            writeJson(path, manifest.filter((m) => m !== media));
            const files = dir === 'work' ? [media.file] : [media.file, media.webm, media.small, media.smallWebm, media.poster];
            removed.push(...files.map((f) => `src/assets/${dir}/${f}`));
          }
          rmSync(at(entry));
          for (const path of removed) rmSync(at(path), { force: true });

          console.log(`[delete-image] Deleted "${id}": ${[entry, ...removed].join(', ')}`);
          reply(200, { id, project: project?.id ?? null, removed: [entry, ...removed] });
        } catch (error) {
          reply(500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}
