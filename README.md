# Outer Range

The website of Outer Range, a design studio. The studio's work is laid out on an infinite canvas you drag, scroll and zoom through. An about page sits behind it: the camera flies on through the canvas to reach it.

Built with Astro 7, Tailwind CSS v4 and GSAP. GSAP's ticker drives the site's single animation loop. Everything runs at the display's full frame rate, and no transition may give that up.

## Getting started

Needs Node 22.22 or later. `.nvmrc` pins 24.

```bash
nvm use
npm install
npm run dev
```

The dev server runs at http://localhost:4321. To start it in the background, use `astro dev --background`, and stop it with `astro dev stop`.

| Command | What it does |
| :-- | :-- |
| `npm run dev` | Dev server. Add `?debug` to the URL for the lattice, tile labels, a frame-time graph and pool stats. `X` on the canvas deletes the focused image for good (dev only, see [Removing work](#removing-work)). |
| `npm run build` / `npm run preview` | Production build, which generates every image variant, then a preview of it. |
| `npm run check` | Type check. |
| `npm test` | Unit and property tests: world model, camera physics, trail, lens, focus, intro, image content and projects (Vitest + fast-check). |
| `npm run test:e2e` | Playwright against the production build: input, zoom, the project view, the flight to and from the about page, video playback, theme, frame timing and content. |
| `npm run work:build -- <folder>` | Add a folder of work images to the canvas. |
| `npm run videos:build -- <folder>` | Encode a folder of videos for the canvas (needs ffmpeg). |
| `npm run og:build` | Film the link preview: the intro's tunnel as a seamless 4 s loop in the dark theme, with the logo, and its poster, into `src/assets/og/` (needs ffmpeg). |
| `npm run pixels:build` | Refresh the colour grids the intro and loading tiles draw. |

## The site

`/` is the canvas and `/about` is the about page. They are two views of one document: going between them is a flight of the canvas, never a page load, so coming back returns to exactly the view you left.

- **Intro:** a fresh load of `/` opens on a flight down a tunnel of lines in the colours of the work, under the "Outer Range" title and the controls. It speeds up into a wormhole, and each tile comes in as rays that close up into its image. Any input cuts it short. It's skipped coming back with the history buttons, on the about page, with reduced motion, and without a fast WebGL 2.
- **Pan:** drag, scroll (a trackpad in any direction), or the arrow keys (Shift for a bigger step).
- **Zoom:** two states, out and in. Pinch, ctrl/⌘ + scroll, `+` or a click zooms in on an image; `−`, `0` or `Esc` zooms out. `Space` or `Enter` toggles zoom on the image in the focus frame. Zoomed in, each gesture pages to the neighbouring image and the others fade.
- **Project view:** `P` swaps the canvas for the active image's project: all its images in one column at the centre, every one as wide as the column (on a wide window 1.1 times the focused view's longest image, at most 58% of the window, `PROJECT_COLUMN`; the whole width on a phone), which scrolls endlessly either way (the images run over and over, and the scroll is kept within one run), under glass edges of its own, like the canvas's. On the way in it moves like the menu: the rest of the canvas backs away (each image drawn in towards the centre by its depth, dimming and blurring) while the image comes forward to the centre of the window, its place in the column, and the rest of the column comes in from in front of the camera, big and soft, settling sharp, as the menu's square does. The header reads "Outer Range ✕ project name", the cross drawn in SVG turning in and the name rising after it, all three kept centred. `P` or `Esc` leaves as the menu does: the column flies on past the camera as the canvas comes home, exactly as you left it; clicking an image comes home focused on that one. ([`projectview.ts`](src/canvas/projectview.ts), [`ProjectView.astro`](src/components/ProjectView.astro)).
- **Focus frame, project label and caption:** a thin frame marks the image nearest the centre, its project's name in a pill above it. Zoomed in and at rest, the image's category rises in under it.
- **About:** the header link (or `A`) flies on to `/about`, where it reads Back. Back, `Esc` or the browser's back button flies the canvas back in. On a touch screen it is the label alone.
- **Theme:** light or dark, as the system is set, until `L` switches it. The choice is kept for the next visit.
- **Glass edges:** the top and bottom of the window are seen through the edge of a lens, drawn in WebGL 2.
- **Info bar:** the controls at a glance, along the bottom. Start a project and Menu at the right are buttons too (a click or tap does what `S` or `M` does), keys and all, everywhere, phones included; the hints at the left (moving, the theme) only with a fine pointer and at least 760 px of width. Zoomed in on an image, and in the project view, those give way to the project's: `P` Project (Back in the project view) and `I` Project info, which opens from the focused view too, the canvas backing away behind it as for the menu.

## Content

The site is edited in files, with no CMS: change them and commit.

### Work

Every image and video on the canvas has three parts:

1. **The media.** Work images are lossless WebP masters in [`src/assets/work/`](src/assets/work/); videos, their small copies and poster frames are in [`src/assets/videos/`](src/assets/videos/). Each folder's `manifest.json` lists them with their size, shape, dominant colour and colour grid. [`src/assets/media.ts`](src/assets/media.ts) puts the two lists together.
2. **A content entry**, `src/content/images/<id>.md`. Its file name is the image's id.

   ```md
   ---
   file: "tenacity-wordmark.webp"
   title: "Tenacity wordmark"
   category: "Logo"
   alt: "The Tenacity Capital logo in bright mint on a dark green panel."
   caption: "Optional, up to 160 characters."
   notes: "Optional and private: never shipped."
   ---

   An optional write-up, in Markdown. Also private.
   ```

   `title` (80 characters at most), `category` and `alt` (200 at most) are required. Categories are `Brand`, `Logo`, `Website` and `Development` ([`src/canvas/images.ts`](src/canvas/images.ts)). The page ships the title, category and alt text, but never the notes or write-up.
3. **A project listing** in [`src/content/projects.json`](src/content/projects.json). Every image belongs to exactly one project, and each project has at least 3 images, cover first.

The build checks it all. It fails, naming the file, if a manifest image has no entry, an entry names a missing file, an image is in no project or two, or a project has fewer than 3 images.

The canvas needs at least 60 images, so that no image repeats on screen: each of its 6 × 5 lattice classes needs two. With fewer, lower `REPEAT_COLS` and `REPEAT_ROWS` in [`src/canvas/config.ts`](src/canvas/config.ts).

### Adding work

- **Images:** `npm run work:build -- <folder>` takes every PNG, JPEG or WebP in the folder ([`scripts/work/build-work.mjs`](scripts/work/build-work.mjs)). Draw artboards at any shape and export them large: the canvas shows every image at its own ratio, fitted in a box 4/3 of the shared short edge each way, so 4:3 and 3:4 fill it and 16:9 runs its full width a little shorter. Two kinds are fitted to another ratio. One listed in `CROP` is cropped to the ratio given there, at the point given; drop it from the list and its next build keeps the whole image. One longer than 3:1 to a side (`MAX_RATIO`) is cropped about its centre if that loses at most 4%, and otherwise set whole on white, inset by 6% of its longer side, so a page or mockup is never cut. The build adds to the folder: existing images stay, and one with the same name is replaced.
- **Videos:** `npm run videos:build -- <folder>` takes every MP4, MOV or WebM ([`scripts/videos/build-videos.mjs`](scripts/videos/build-videos.mjs)). Each keeps its own ratio, unless `CROP` gives it another or it's longer than 3:1, and is scaled to 1080 px on its short edge and encoded as VP9 WebM and H.264 MP4, each with a 360 px copy for small tiles and a poster frame. The build adds to the folder: existing videos stay, and one with the same name is replaced in its place.

Then write each one's content entry and list it in a project.

### Removing work

Under `npm run dev`, focus an image and press `X`. It removes the image's content entry, project listing, manifest line and files ([`scripts/dev/delete-image.mjs`](scripts/dev/delete-image.mjs)), and refuses if the project would drop below 3. Deleting a file by hand leaves the rest behind, and the build fails until the entry, listing and manifest line go too.

### About page

[`src/content/about.md`](src/content/about.md) holds the about text. It has a statement, a line under it, the services (from its frontmatter, where the text has `<!-- services -->`) and four chapters. After them come the awards, also from the frontmatter.

## How the canvas works

All tunable numbers are in [`src/canvas/config.ts`](src/canvas/config.ts), and each module's comments explain its part.

- **The world is a pure function** ([`world.ts`](src/canvas/world.ts)): a cell's image and offset come from a hash of its coordinates, and its size from the image's ratio. Nothing is stored, so panning away and back finds the same images in the same places. No image repeats within 6 columns or 5 rows, and [`layout.ts`](src/canvas/layout.ts) sizes the tiles so that span never fits on screen.
- **Physics** ([`physics.ts`](src/canvas/physics.ts)) runs at a fixed 240 Hz step, with input applied at its event timestamps, so a gesture moves the same at any refresh rate. Drags follow the pointer and glide on release; zoom keeps the point under the cursor fixed.
- **Trail and lens:** each image hangs from its own damped spring, so the canvas stretches behind a gesture ([`trail.ts`](src/canvas/trail.ts)). Towards the edges, images shrink in a rounded-rectangle lens, as on the watchOS app grid ([`lens.ts`](src/canvas/lens.ts); `?flat` turns it off).
- **Rendering** ([`renderer.ts`](src/canvas/renderer.ts)): a pool of DOM tiles covers the cells around the view, each placed with a transform. Tiles load AVIF or WebP from a `srcset`, showing their colour grid until the image arrives. Videos play over their poster, only while on screen and only on the view that's showing.
- **Flights** ([`flight.ts`](src/canvas/flight.ts), [`intro.ts`](src/canvas/intro.ts)): the about-page flight and the intro both project the tiles through a pinhole camera. [`main.ts`](src/canvas/main.ts) routes between the views with the History API.

## Type

Timeless Sans is the site font (Tailwind's `font-sans`), and Timeless Serif is there as `font-serif`. Both are self-hosted from [`src/assets/fonts/timeless`](src/assets/fonts/timeless) through Astro's Fonts API. Their licence (`LICENSE.pdf` beside them) allows serving them on the site but not publishing them in a public repository.

## Deployment

The production site is hosted on Vercel at https://outerrange.studio, using the Outer Range team’s `outerrange-studio` project. `vercel.json` configures the Astro build and clean URLs for `/about` and `/start`. The default site URL is `https://outerrange.studio`; `SITE_URL` can override it for another host.

Every push to `main` builds the site and deploys it to GitHub Pages ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). The workflow sets `SITE_URL` and `BASE_PATH` from the Pages configuration, so the site works under a subpath as well as on a custom domain.
