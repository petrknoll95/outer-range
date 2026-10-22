# petrknoll26

One page: an infinite canvas of images. Astro 7, Tailwind CSS v4, GSAP (its ticker drives the single animation loop).

- **Pan:** drag, scroll (trackpad in any direction), or arrow keys (Shift for a bigger step).
- **Zoom:** two states, out and in. Pinch, ctrl/⌘ + scroll or `+` zooms in on the image under the cursor; pinching back, `−` or `0` zooms out. `Space` or `Enter` zooms in on the active image (the one in the focus frame), and pressing it again zooms back out. Zoomed in, the view pages between neighbouring images: each scroll, swipe or drag moves one image in its direction (diagonals included), always settling with that image exactly centred, and every other image fades.
- **Click an image** to open the focused view on it (it zooms in, centred). Zoomed in, clicking another glides it to the centre.
- **Caption:** zoomed in, the focused image's title sits centred above it, and its category with the alt text just below centred under it ([`caption.ts`](src/canvas/caption.ts)). They're anchored to the focus frame (CSS anchor positioning). It shows only while the view rests on an image (zoomed in, landed, nothing moving, the frame done handing over), rising in slowly line by line (0.9 s each, 0.1 s apart). The moment anything moves, a drag, a scroll, a key, a zoom or a flight, it is pinned where it stands and leaves fast (0.14 s), so it never rides along with the frame; it comes back once all is still. Title and category come from the image's Markdown entry, along with the alt text the tiles already use. Without anchor positioning it sits in the bottom left corner instead.
- **About / Back:** a plain-text link at the top right, set like the wordmark ([`Header.astro`](src/components/Header.astro)). About (click or Enter, zoomed out or in) flies the camera on into the canvas, leaving `/about`: under the same header, where the link reads Back, the about text rises in, a narrow column centred in the window. Back, or the browser's back button, flies the canvas back in to the exact view you left; forward flies out again. Modified clicks open the link in a new tab as usual.
- **Wordmark:** "Petr Knoll" at the top centre. It is white with a difference blend, so it reads on either theme and over images. It ignores the pointer, so the canvas drags and scrolls under it.
- **Type:** Timeless Sans is the site font (Tailwind's `--font-sans`) and Timeless Serif is there as `font-serif`, each in every weight with italics, from `src/assets/fonts/timeless`, self-hosted through Astro's Fonts API (`astro.config.mjs`) with a metric-matched fallback. A browser only downloads the weights the page uses; only Sans Medium, the wordmark's weight, is preloaded. Their licence (`LICENSE.pdf` beside them) allows serving them on the site but not putting them in a public repository, so this repository must stay private.

Needs Node ≥ 22.22 (`.nvmrc` pins 24).

| Command | |
| :-- | :-- |
| `npm run dev` | Dev server. Add `?debug` to the URL for the lattice, tile labels, frame-time graph and pool stats. |
| `npm run build` / `npm run preview` | Production build (generates every image variant). |
| `npm test` | Property tests for the world model, camera physics, image trail, click glide, lens, image content and projects (Vitest + fast-check). |
| `npm run test:e2e` | Playwright against the production build: input, zoom, click-to-centre, trail, lens, focus frame, caption, the flight to and from /about (motion sampled per frame, a screencast checking the clear canvas stays pixel-identical, Back and the history buttons returning the exact view, turning round mid-flight, opening and reloading /about), round trips, memory, frame timing, alt text. |
| `npm run check` | Type check. |
| `npm run placeholders:collect` / `placeholders:build` | Re-collect candidates from Cosmos / re-crop them and rewrite the manifest. |
| `npm run placeholders:projects` | Regenerate the sample projects in `src/content/projects.json`. |

## How it works

All tunable numbers are in [`src/canvas/config.ts`](src/canvas/config.ts).

- **The world is a pure function** ([`world.ts`](src/canvas/world.ts)). `cell(i, j)` gives a cell's image, shape, offset and z-order from an integer hash of its coordinates. Nothing is stored and nothing is "respawned". Pan away and back and the same images are in the same places.
- **No repeats, by construction.** Each cell belongs to one of 6×6 lattice classes, and each class draws from its own slice of the images. Two cells can only show the same image if they are at least 6 columns or 6 rows apart. [`layout.ts`](src/canvas/layout.ts) sizes the images so that span never fits on screen (up to 3440 px wide). With the lens on, its edge ring is the one exception; see Lens below.
- **Overlap budget.** The horizontal jitter is derived from a 15% cap on how much of the smaller image an overlap may cover. Columns are brick-offset, so overlaps always read as layered, never as one merged image. Images in the same column never overlap.
- **Physics** ([`physics.ts`](src/canvas/physics.ts)).
  - Fixed 240 Hz step, with inputs applied at their event timestamps, so the same gesture gives the same motion at 60, 120 or 144 Hz.
  - Wheel and trackpad move a target that the camera follows with an 80 ms time constant (the slight drag). The OS already supplies trackpad momentum, so nothing adds more.
  - Dragging follows the pointer 1:1. On release the canvas glides with a 300 ms velocity half-life.
  - Zoom eases toward a target with a 90 ms time constant, keeping the world point under the cursor fixed at every step.
  - Zoomed in, clicking an image glides the camera until that image's grid centre is in the middle of the screen (zoomed out, a click zooms into it instead) ([`focus.ts`](src/canvas/focus.ts)). Glides (this one and paging) ease out: an ease-out cubic that leaves at once and slows smoothly to rest. They take 0.45–0.9 s, longer for longer moves. A glide that starts from a flick keeps the flick's speed and arrives sooner rather than overshooting. Any pan, drag or zoom takes over mid-glide.
- **Zoom states** ([`main.ts`](src/canvas/main.ts), [`physics.ts`](src/canvas/physics.ts)).
  - Out is zoom 1. In is fixed per viewport: a portrait image's long edge fills 70% of the screen's short side, but never so far that images go soft (`zoomInLevel` in [`layout.ts`](src/canvas/layout.ts)).
  - One pinch or ctrl/⌘ + scroll gesture switches state once it has zoomed 12% one way; more in the same direction does nothing, and swinging back the other way switches back.
  - Zooming in grows the image under the cursor and glides it to the centre in one move (physics `ZOOM_TO`) over 0.7 s, eased by `ZOOM_EASE`, cubic-bezier(0.2, 0, 0, 1): it sets off gently (no jolt on the first frame), is quickly up to speed and spends the rest slowing smoothly into place. Zooming out keeps whatever is centred in place. Input during either move takes over the panning, but the zoom still finishes at its level.
  - Zooming onto another image than the framed one, the focus frame steps aside: it fades out in 0.12 s, moves to the new image only once out of sight, and fades back in round it with the caption.
  - Zoomed in, the physics pages (`setPaging`): the view is anchored on the centred image, and one gesture moves at most one image, to the neighbour nearest one pitch away in its direction.
    - Pulling stiffens and can never get further than 90% of a pitch from the anchor.
    - A scroll commits the moment it has pulled 18% (it has no release to wait for: trackpad momentum keeps it going for a second or more), glides to the neighbour, and ignores the rest of itself.
    - A new trackpad swipe arrives in the same event stream as the last one's momentum. Momentum only ever slows down, so the scroll's speed (averaged over ~50 ms, each event weighted by the time it covers, so merged or unevenly timed events don't fake a change) slowing to half its peak and then speeding up again (to twice its slowest plus 150 px/s, or back to the peak) is a new swipe. It is credited with everything it has moved since that slowest point.
    - A drag decides on release: past 18% (counting 0.15 s of release velocity, so a quick flick counts) it moves on, otherwise it springs back, starting at the release speed either way.
    - Arrow keys page one image per press; clicking an image goes straight to it.
  - Zoomed in, every image except the active one fades to 15% opacity, easing as the active image changes. The lens and the image trail work as they do zoomed out.
- **Image trail** ([`trail.ts`](src/canvas/trail.ts)). Every image hangs on its grid position from its own damped spring with air drag, simulated on the same 240 Hz step.
  - While the canvas moves, each image trails behind by lag × velocity along the velocity vector.
  - Lag tapers along the direction of motion, from 8 ms at the viewport edge the images move toward to 32 ms at the opposite edge, plus a small per-image weight. The sheet stretches out behind the gesture like cloth pulled from its front edge.
  - When the direction changes, each image's lag eases to its new value.
  - When the canvas stops, images settle back (with a slight overshoot) and snap exactly onto the grid.
  - Zooming moves images radially, so the taper runs from the zoom anchor outward instead. Reduced motion turns the trail off.
- **Lens** ([`lens.ts`](src/canvas/lens.ts)), like the watchOS app grid. `?flat` turns it off.
  - Images inside the middle ~45% of the screen are full size. Toward every edge they shrink smoothly to 45%, smallest in the corners, in a rounded-rectangle (squircle) shape.
  - The grid is pulled toward the centre by the integral of that scale, so spacing tightens as fast as the images shrink. Each image's scale is taken at its corner farthest from the centre, so the lens can't push images into each other. The most it adds is a sliver, under 2% of an image.
  - Drag, pinch and zoom map the pointer back through the lens, so they act on the image actually under it.
  - The edge ring squeezes in more of the canvas, so `LENS_REPEAT_SHARE` sets how much of it the no-repeat sizing counts. At 1440×900: 1 means no repeats ever (18 images on screen); the default 0.55 gives 22 images, with a repeat between two small edge images on about 3% of screens; 0 gives 30 images, with repeats on 75%.
- **Active image** ([`renderer.ts`](src/canvas/renderer.ts)). After every frame the renderer picks the image whose drawn centre (lens and trail included) is nearest the viewport centre. It only switches once another image is closer by `ACTIVE_SWITCH_MARGIN` (12 px), so two near-equal neighbours never flicker. `renderer.activeImage()` returns it, and `onActiveChange` reports each switch.
- **The about view** ([`flight.ts`](src/canvas/flight.ts), routing in [`main.ts`](src/canvas/main.ts), [`Site.astro`](src/components/Site.astro)). `/` and `/about` are two views of one document: both pages render the same site, and going between them is a flight of the canvas, never a page load.
  - The route lives in the URL (History API, any query carried over). About pushes `/about`; Back goes back in history when you came from the canvas (so Forward returns), or pushes `/` when `/about` was opened directly. The browser's back and forward buttons run the same flights, and a change of mind mid-flight turns it round from wherever it has got to.
  - Leaving, the camera holds where it is drawn and input locks. The caption sends its lines out and the focus frame fades; the header stays, its link label sliding from About to Back through its mask.
  - Each on-screen image gets a depth for the flight only (1 to 3, from a hash of its cell; browsing stays flat), and the camera dollies forward through a pinhole projection: an image is drawn depth / (depth − travel) times bigger, moving outward from the screen centre by the same factor. Nearer images grow and leave first. Each blurs (up to 16 px, like leaving the focal plane) and fades out as it nears the camera, gone at 80% of the way to it, and the camera travels until the farthest has faded, over 0.8 s, eased by `FLIGHT_EASE`, cubic-bezier(0.5, 0, 0.25, 1): setting off gently, rushing, and easing off as the last images go. Only the header is left, and the about text, which has come towards the camera from behind the canvas.
  - Coming back, the flight runs in reverse over 0.75 s, the images arriving gently from the camera, sharpening, and settling softly into place, to exactly the view it left: same camera, zoom state and focused image. It then settles into the zoom state if the flight interrupted it.
  - The about text is Markdown, [`src/content/about.md`](src/content/about.md), set centred in a 34 rem column: a statement (`##`, large, in the serif and 65% wider than the column; the wordmark is the page's `h1`), a line under it, then chapters over 16 px text. Each chapter's `###` is a row: "Chapter", its numeral dead centre in the statement's serif and size (`<span class="numeral">`), and its title (`<span class="title">`). Where the text has `<!-- services -->` (before the chapters), the services listed in its frontmatter, unlabelled on the page (a region named Services): a column per group (its name over its items), wrapping on narrow screens. After the chapters, the awards from its frontmatter: a small Awards title over the list, set in the serif; then the social links, listed the same way. Taller than the window, it scrolls on its own and fades out under the header. It is a layer behind the canvas, a far plane one depth unit beyond where the camera stops (`flightFar` in [`flight.ts`](src/canvas/flight.ts)): flying in, it comes towards the camera through the images, growing by perspective from about 30% to its own size, fading in from a third of the way and sharpening from an 8 px blur as it reaches the focal plane; flying back, it recedes and fades the same way while the images return in front of it. Whichever of the canvas and the text isn't showing is inert, so neither takes the other's clicks or scrolls; on the about view the wheel is the browser's, so a long text scrolls on its own.
  - The view is also kept in sessionStorage (its centre in units of S, and the zoom state), so opening or reloading `/about`, or a reloaded tab going back to `/`, starts flown past from that view and flies back into it.
  - With reduced motion nothing moves: the images fade out over 0.3 s.
- **Focus frame** ([`focusframe.ts`](src/canvas/focusframe.ts), `.focus-frame` in [`global.css`](src/styles/global.css)). A thin ink-coloured outline (a 1px inset box shadow) `FOCUS_FRAME_PADDING` (8 px) outside the active image, with its corners following the image's. It is placed with CSS anchor positioning: the tile it is leaving is anchor `--focus-from`, the one it is moving to is `--focus-to`, and each inset is a blend of the two anchors' edges by `--focus-mix`, a registered custom property that transitions from 0 to 1 over `FOCUS_FRAME_DURATION` (0.45 s). Both anchors stay live, so the frame stays locked to the images while the canvas pans, zooms, lenses and trails; only the hand-over animates. If the focus moves on mid-hand-over, the next one starts from where the frame is drawn. No script runs per frame. With reduced motion it jumps, and browsers without anchor positioning don't show it.
- **Rendering** ([`renderer.ts`](src/canvas/renderer.ts)).
  - A pool of tiles covers the cells around the viewport, with extra margin in the direction of travel.
  - Each tile is placed in screen space as (world − camera) × zoom + its trail offset, so the numbers written to CSS stay small however far you travel.
  - Each tile is laid out (sized in CSS, so rasterised, with an image variant to fit) at its own zoom and scaled from there. Tiles are laid out again once the zoom settles, or drifts by 1.4×, but never while a zoom-to is in flight: re-laying out every tile mid-zoom costs frames and swaps images for sharper ones mid-move. Instead the image being zoomed into is laid out for where it lands before it sets off, so it is sharp all the way (drawn smaller until it arrives) and its full-size variant loads on the way. The e2e test checks every frame of a zoom in and out: no long frames, a gentle start, no lurch, nothing re-laid out mid-zoom.
  - Each tile loads AVIF/WebP from a `srcset`, shows its dominant colour while loading, and fades in once decoded.

## Image content

Each image's text lives in a Markdown file in [`src/content/images/`](src/content/images/), a content collection ([`src/content.config.ts`](src/content.config.ts)). There is no editor or admin: edit the files and commit them.

```md
---
file: "01a1066c-6146-7010-bfa2-519a378861b9.jpg"
title: "Mango can mockup"
category: "Development"
alt: "Silver cans printed with an orange mango script, stacked on a diagonal…"
caption: "Early mockup used to test the script at shelf distance."
notes: "Third-party mockup template; don’t publish."
---

Optional write-up, in Markdown.
```

- **The file name is the image's id** (lowercase words joined by hyphens). Projects refer to images by id, so re-cropping or replacing an image file only changes `file`.
- **Fields.** `file` is the image's name in the manifest. `title` (up to 80 characters), `category` and `alt` are required. `caption` (up to 160) and `notes` are optional. `alt` (up to 200) says what the image shows. `notes` are private and the body is a write-up; neither is shipped to the page.
- **Categories** are `Brand` (product and campaign photography), `Logo` (the mark or wordmark is the subject), `Website` (layouts for screens: heroes, banners, product grids) and `Development` (mockups, renders, spec views, packshots). They're listed in [`src/canvas/images.ts`](src/canvas/images.ts).
- **Validated** when the page builds. The collection schema checks each file, and the error names the file and the field. [`resolveImages`](src/canvas/images.ts) then fails the build if a manifest image has no entry, an entry names a file that isn't in the manifest, or two entries describe the same image.
- **Shipped:** only `alt` reaches the page. It is in the page data and set on every tile. Everything else is available at build time through `getCollection('images')` for whatever UI needs it.

Adding an image: add it to the manifest, then create `src/content/images/<id>.md` with its `file`, `title`, `category` and `alt`, and list the id in a project.

The current 91 entries are samples: the alt text describes each placeholder, but titles, captions, notes and write-ups are invented.

## Projects

Projects group images: every image belongs to exactly one project, and the images in a project are its associations. Nothing in the UI uses them yet.

- **Authored** in [`src/content/projects.json`](src/content/projects.json), a content collection ([`src/content.config.ts`](src/content.config.ts)). Each project has an `id`, `title`, optional `year`, and `images`: image ids (entry file names in `src/content/images/`), cover first.
- **Validated** when the page builds. The collection schema requires at least 3 images per project. [`resolveProjects`](src/canvas/projects.ts) then fails the build if an id repeats, an image id doesn't exist, or an image is in two projects or none.
- **Shipped** to the canvas in the page data as `projects`, with images as indices into `images`. `createProjectIndex` turns that into lookups: an image's project, its siblings, a project by id.

The current 17 projects are samples with invented names. They group images by dominant colour into runs of 3–9, so each looks like one body of work. Replace them by hand with real projects; re-run `npm run placeholders:projects` only while they're still samples.

## Placeholder images

`src/assets/placeholders/` holds 91 images from the Cosmos collection [Social Tonic](https://www.cosmos.so/petrknoll/social-tonic): 86 images plus the poster frames of 5 videos. One 360×450 image was too small and was left out.

Each image is cropped to whichever of 4:3, 3:4 or 1:1 loses least, and the shapes are then evened out where that costs at most 30% more of the picture. Most of the collection is 4:5 posts, so it ends up 15 landscape, 38 portrait and 38 square.

The manifest records each image's crop, credit, Cosmos element URL and source file. Run `npm run placeholders:collect && npm run placeholders:build` after the collection changes. If it shrinks below 72 images, reduce `REPEAT_COLS`/`REPEAT_ROWS` in `config.ts` so every class keeps at least two.

**The images belong to their authors. Placeholders only: do not publish them.**
