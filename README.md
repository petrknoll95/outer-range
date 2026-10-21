# petrknoll26

One page: an infinite canvas of images. Astro 7, Tailwind CSS v4, GSAP (its ticker drives the single animation loop).

- **Pan:** drag, scroll (trackpad in any direction), or arrow keys (Shift for a bigger step).
- **Zoom:** pinch, ctrl/⌘ + scroll, or `+` `−` `0`. Zoom centres on the cursor.

Needs Node ≥ 22.22 (`.nvmrc` pins 24).

| Command | |
| :-- | :-- |
| `npm run dev` | Dev server. Add `?debug` to the URL for the lattice, tile labels, frame-time graph and pool stats. |
| `npm run build` / `npm run preview` | Production build (generates every image variant). |
| `npm test` | Property tests for the world model, camera physics and image trail (Vitest + fast-check). |
| `npm run test:e2e` | Playwright against the production build: input, zoom, trail, round trips, memory, frame timing. |
| `npm run check` | Type check. |
| `npm run placeholders:collect` / `placeholders:build` | Re-collect candidates from Cosmos / re-crop them and rewrite the manifest. |
| `npm run placeholders:projects` | Regenerate the sample projects in `src/content/projects.json`. |

## How it works

All tunable numbers are in [`src/canvas/config.ts`](src/canvas/config.ts).

- **The world is a pure function** ([`world.ts`](src/canvas/world.ts)). `cell(i, j)` gives a cell's image, shape, offset and z-order from an integer hash of its coordinates. Nothing is stored and nothing is "respawned". Pan away and back and the same images are in the same places.
- **No repeats, by construction.** Each cell belongs to one of 6×6 lattice classes, and each class draws from its own slice of the images. Two cells can only show the same image if they are at least 6 columns or 6 rows apart. [`layout.ts`](src/canvas/layout.ts) sizes the images so that span never fits on screen (up to 3440 px wide).
- **Overlap budget.** The horizontal jitter is derived from a 15% cap on how much of the smaller image an overlap may cover. Columns are brick-offset, so overlaps always read as layered, never as one merged image. Images in the same column never overlap.
- **Physics** ([`physics.ts`](src/canvas/physics.ts)).
  - Fixed 240 Hz step, with inputs applied at their event timestamps, so the same gesture gives the same motion at 60, 120 or 144 Hz.
  - Wheel and trackpad move a target that the camera follows with an 80 ms time constant (the slight drag). The OS already supplies trackpad momentum, so nothing adds more.
  - Dragging follows the pointer 1:1. On release the canvas glides with a 300 ms velocity half-life.
  - Zoom eases toward a target with a 90 ms time constant, keeping the world point under the cursor fixed at every step.
- **Zoom limits** ([`layout.ts`](src/canvas/layout.ts)).
  - Zooming in stops where images would go soft: the on-screen short edge in device pixels may not exceed the source size three quarters of the images have. That's 2.5× at most, about 2.5× on a 1440 px retina screen.
  - Zooming out stops at 0.75×. With 91 images, zooming out lets an image appear twice on screen, always at least 6 cells from its twin. That affects about 1 tile in 8 at 0.75× and 43% at 0.5×; more images would let the limit go lower.
- **Image trail** ([`trail.ts`](src/canvas/trail.ts)). Every image hangs on its grid position from its own damped spring with air drag, simulated on the same 240 Hz step.
  - While the canvas moves, each image trails behind by lag × velocity along the velocity vector. Lag runs from 8 ms near the pointer to 32 ms far from it, plus a per-image weight, so the grid stretches like cloth instead of moving as one block.
  - When the canvas stops, images settle back (with a slight overshoot) and snap exactly onto the grid.
  - Zooming moves images radially, so they trail there too. Reduced motion turns the trail off.
- **Rendering** ([`renderer.ts`](src/canvas/renderer.ts)).
  - A pool of tiles covers the cells around the viewport, with extra margin in the direction of travel.
  - Each tile is placed in screen space as (world − camera) × zoom + its trail offset, so the numbers written to CSS stay small however far you travel.
  - During a zoom, tiles are scaled from their last layout. They're laid out again (re-rasterised sharp, with a fitting image variant) once the zoom settles or drifts by 1.4×.
  - Each tile loads AVIF/WebP from a `srcset`, shows its dominant colour while loading, and fades in once decoded.

## Projects

Projects group images: every image belongs to exactly one project, and the images in a project are its associations. Nothing in the UI uses them yet.

- **Authored** in [`src/content/projects.json`](src/content/projects.json), a content collection ([`src/content.config.ts`](src/content.config.ts)). Each project has an `id`, `title`, optional `year`, and `images`: manifest file names, cover first.
- **Validated** when the page builds. The collection schema requires at least 3 images per project. [`resolveProjects`](src/canvas/projects.ts) then fails the build if an id repeats, a file isn't in the manifest, or an image is in two projects or none.
- **Shipped** to the canvas in the page data as `projects`, with images as indices into `images`. `createProjectIndex` turns that into lookups: an image's project, its siblings, a project by id.

The current 17 projects are samples with invented names. They group images by dominant colour into runs of 3–9, so each looks like one body of work. Replace them by hand with real projects; re-run `npm run placeholders:projects` only while they're still samples.

## Placeholder images

`src/assets/placeholders/` holds 91 images from the Cosmos collection [Social Tonic](https://www.cosmos.so/petrknoll/social-tonic): 86 images plus the poster frames of 5 videos. One 360×450 image was too small and was left out.

Each image is cropped to whichever of 4:3, 3:4 or 1:1 loses least, and the shapes are then evened out where that costs at most 30% more of the picture. Most of the collection is 4:5 posts, so it ends up 15 landscape, 38 portrait and 38 square.

The manifest records each image's crop, credit, Cosmos element URL and source file. Run `npm run placeholders:collect && npm run placeholders:build` after the collection changes. If it shrinks below 72 images, reduce `REPEAT_COLS`/`REPEAT_ROWS` in `config.ts` so every class keeps at least two.

**The images belong to their authors. Placeholders only: do not publish them.**
