# petrknoll26

One page: an infinite canvas of images you pan by dragging, scrolling or with the arrow keys. Astro 7, Tailwind CSS v4, GSAP (its ticker drives the single animation loop).

Needs Node ≥ 22.22 (`.nvmrc` pins 24).

| Command | |
| :-- | :-- |
| `npm run dev` | Dev server. Add `?debug` to the URL for the lattice, tile labels, frame-time graph and pool stats. |
| `npm run build` / `npm run preview` | Production build (generates every image variant). |
| `npm test` | Property tests for the world model and the camera physics (Vitest + fast-check). |
| `npm run test:e2e` | Playwright against the production build: input, round trip, memory, frame timing. |
| `npm run check` | Type check. |
| `npm run placeholders:collect` / `placeholders:build` | Re-collect candidates from Cosmos / re-crop them and rewrite the manifest. |

## How it works

All tunable numbers are in [`src/canvas/config.ts`](src/canvas/config.ts).

- **The world is a pure function** ([`world.ts`](src/canvas/world.ts)). `cell(i, j)` gives a cell's image, shape, offset and z-order from an integer hash of its coordinates. Nothing is stored and nothing is "respawned". Pan away and back and the same images are in the same places.
- **No repeats, by construction.** Each cell belongs to one of 6×6 lattice classes, and each class draws from its own slice of the images. Two cells can only show the same image if they are at least 6 columns or 6 rows apart. [`layout.ts`](src/canvas/layout.ts) sizes the images so that span never fits on screen (up to 3440 px wide).
- **Overlap budget.** The horizontal jitter is derived from a 15% cap on how much of the smaller image an overlap may cover. Columns are brick-offset, so overlaps always read as layered, never as one merged image. Images in the same column never overlap.
- **Physics** ([`physics.ts`](src/canvas/physics.ts)).
  - Fixed 240 Hz step, with inputs applied at their event timestamps, so the same gesture gives the same motion at 60, 120 or 144 Hz.
  - Wheel and trackpad move a target that the camera follows with an 80 ms time constant (the slight drag). The OS already supplies trackpad momentum, so nothing adds more.
  - Dragging follows the pointer 1:1. On release the canvas glides with a 300 ms velocity half-life.
- **Rendering** ([`renderer.ts`](src/canvas/renderer.ts)). A pool of tiles covers the cells around the viewport, with extra margin in the direction of travel. Tiles sit in one layer relative to a floating origin, so each frame writes a single transform. Each tile loads AVIF/WebP from a `srcset`, shows its dominant colour while loading, and fades in once decoded.

## Placeholder images

`src/assets/placeholders/` holds 91 images from the Cosmos collection [Social Tonic](https://www.cosmos.so/petrknoll/social-tonic): 86 images plus the poster frames of 5 videos. One 360×450 image was too small and was left out.

Each image is cropped to whichever of 4:3, 3:4 or 1:1 loses least, and the shapes are then evened out where that costs at most 30% more of the picture. Most of the collection is 4:5 posts, so it ends up 15 landscape, 38 portrait and 38 square.

The manifest records each image's crop, credit, Cosmos element URL and source file. Run `npm run placeholders:collect && npm run placeholders:build` after the collection changes. If it shrinks below 72 images, reduce `REPEAT_COLS`/`REPEAT_ROWS` in `config.ts` so every class keeps at least two.

**The images belong to their authors. Placeholders only: do not publish them.**
