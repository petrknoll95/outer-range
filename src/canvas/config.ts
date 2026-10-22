/**
 * Every tunable number for the canvas lives here.
 *
 * World lengths are in units of S, the short edge every image shares; on screen
 * S becomes a pixel size chosen from the viewport (see layout.ts). Values in pixels
 * or seconds say so.
 */

export const SEED = 0x5eed2026;

// ── World geometry (units of S) ────────────────────────────────────────────

/** Long edge of a 4:3 or 3:4 image. */
export const LONG = 4 / 3;
/** Gap between two facing long edges when neither is jittered. */
export const GAP = 0.14;
/** Lattice pitch, both axes. */
export const PITCH = LONG + GAP;
/** No two images may overlap by more than this fraction of the smaller one's area. */
export const OVERLAP_BUDGET = 0.15;
/**
 * Largest horizontal jitter, derived from the overlap budget. Two landscapes side by
 * side overlap horizontally by at most 2·JITTER_X − GAP, over a shared height of at
 * most S, so the overlap is at most (2·JITTER_X − GAP)/LONG of either image's area.
 * Every other pairing overlaps less (checked in tests/world.test.ts).
 */
export const JITTER_X = (GAP + OVERLAP_BUDGET * LONG) / 2;
/**
 * Largest vertical jitter. Kept under GAP/2 so images in one column never touch: a
 * vertical overlap would sit almost exactly in line and read as one merged image.
 */
export const JITTER_Y = GAP * 0.45;
/**
 * Columns alternate up and down by COLUMN_STAGGER (brick offset), plus a random
 * ±COLUMN_STAGGER_JITTER. Neighbouring columns are therefore always out of line, so a
 * sideways overlap reads as layered, never as one wide image. The offset is shared by
 * the whole column, so it adds no overlap.
 */
export const COLUMN_STAGGER = 0.24;
export const COLUMN_STAGGER_JITTER = 0.12;
/**
 * No-repeat lattice. Cells (i, j) and (i′, j′) can only show the same image when
 * i ≡ i′ (mod REPEAT_COLS) and j ≡ j′ (mod REPEAT_ROWS), so copies are at least this
 * many cells apart. layout.ts sizes S so that span never fits on screen.
 *
 * Each of the COLS×ROWS classes draws from its own slice of the images, so the image
 * count sets the trade-off: a bigger lattice allows smaller images on screen, but leaves
 * fewer images per class and repeats each class's choices more visibly. 6×6 with the
 * 91 Social Tonic images gives every class 2–3 images.
 */
export const REPEAT_COLS = 6;
export const REPEAT_ROWS = 6;

// ── Sizing (pixels) ─────────────────────────────────────────────────────────

/** Lattice cells per viewport area; S scales with the viewport to hold this roughly constant. */
export const CELLS_PER_VIEWPORT = 16;
export const S_MIN_PX = 110;
/** Large enough that a 3440 px ultrawide still gets the no-repeat guarantee. */
export const S_MAX_PX = 500;
/** Corner radius as a fraction of S. */
export const RADIUS = 0.045;

// ── Camera physics ─────────────────────────────────────────────────────────

/** Fixed simulation step, s. Frame rate never changes a trajectory. */
export const STEP = 1 / 240;
/** Simulation backlog dropped after a stall (hidden tab, debugger), s. */
export const MAX_CATCH_UP = 0.25;
/** Time constant of the camera following wheel / trackpad / keyboard input, s. This is the "slight drag". */
export const WHEEL_TAU = 0.08;
/** Time constant while dragging and flinging, s. Small: the canvas stays under the pointer. */
export const DRAG_TAU = 0.03;
/** Fling velocity half-life after release, s. */
export const FLING_HALF_LIFE = 0.3;
/** Window of pointer samples used to estimate release velocity, s. */
export const VELOCITY_WINDOW = 0.08;
/** No fling if the pointer was held still this long before release, s. */
export const RELEASE_STALE = 0.05;
export const MAX_FLING_SPEED = 8000; // px/s
/** Fling ends below this speed, px/s. */
export const STOP_SPEED = 4;
/** Camera snaps onto its target within this distance, screen px. */
export const SETTLE_DISTANCE = 0.05;

// ── Zoom ───────────────────────────────────────────────────────────────────

/**
 * Two zoom states: out (zoom 1, the size layout.ts picks for the viewport) and in.
 *
 * Zoomed in, the zoom is fixed so a portrait image's long edge fills ZOOM_IN_FILL of the
 * viewport's short side, but never past where images would go soft: the zoom where the
 * on-screen short edge, in device pixels, reaches the source size three quarters of the
 * images have (index.astro passes it in as `sharpEdge`). ZOOM_MAX caps it on low-DPR screens.
 */
export const ZOOM_IN_FILL = 0.7;
export const ZOOM_MAX = 2.5;
/** Time to move between the two zoom states, s. */
export const ZOOM_DURATION = 0.7;
/**
 * The zoom's ease, as a CSS cubic-bezier: it sets off gently (no jolt on the first frame),
 * is quickly up to speed, and spends the rest slowing smoothly into place.
 */
export const ZOOM_EASE = [0.2, 0, 0, 1] as const;
/**
 * A pinch or ctrl/⌘ + scroll switches state once it has zoomed this far (as a ratio)
 * in one direction, and the rest of that gesture is ignored. A gesture ends after
 * ZOOM_GESTURE_IDLE s without zoom input.
 */
export const ZOOM_GESTURE_THRESHOLD = 1.12;
export const ZOOM_GESTURE_IDLE = 0.25;
/**
 * Zoomed in, the view pages between neighbouring images: one gesture moves at most one
 * image, toward whichever neighbour lies in its direction. Fractions are of the lattice
 * pitch (the spacing between neighbours).
 *
 * - While pulling (dragging or scrolling) the view follows freely at first, then stiffens:
 *   it can never travel more than PAGE_REACH from the image it started on.
 * - A drag decides on release: past PAGE_THRESHOLD (counting the release velocity over
 *   PAGE_FLICK_TIME, so a quick flick pages too) it goes to the neighbour, otherwise back.
 * - A wheel or trackpad scroll has no release to wait for (momentum keeps it going for a
 *   second or more), so it commits the moment it has pulled PAGE_THRESHOLD, glides to the
 *   neighbour, and ignores the rest of that scroll until a new swipe starts (see
 *   PAGE_SWIPE_RISE). One that stops short springs back after SNAP_IDLE.
 */
export const PAGE_REACH = 0.9;
export const PAGE_THRESHOLD = 0.18;
export const PAGE_FLICK_TIME = 0.15; // s
/** A scroll ends after this long without input, s. */
export const SNAP_IDLE = 0.14;
/**
 * Trackpads keep sending momentum for a second or more after the fingers lift, and a new
 * swipe arrives in that same stream. Momentum only ever slows down, so once the scroll has
 * slowed to 1/PAGE_SWIPE_RISE of its peak, speeding up again to PAGE_SWIPE_RISE × its
 * slowest since, plus PAGE_SWIPE_MIN_SPEED (px/s, above rounding jitter), or back to that
 * peak, is a new swipe.
 */
export const PAGE_SWIPE_RISE = 2;
export const PAGE_SWIPE_MIN_SPEED = 150;
/** The scroll's speed is averaged over roughly the last this many s, so uneven event timing doesn't read as a change of speed. */
export const PAGE_SWIPE_WINDOW = 0.05;
/** Zoomed in, every image but the active one fades to this opacity. */
export const FADE_OPACITY = 0.15;
/** Time constant of an image fading in or out as the active image changes, s. */
export const FADE_TAU = 0.1;
/** Time constant of the camera following a continuous zoom (physics ZOOM input), s. */
export const ZOOM_TAU = 0.09;
/** Zoom per wheel pixel: factor = e^(−deltaY·WHEEL_ZOOM_SPEED). */
export const WHEEL_ZOOM_SPEED = 0.01;
/** Largest wheel delta one event may contribute, px, so a mouse notch is a step, not a jump. */
export const WHEEL_ZOOM_MAX_DELTA = 25;
/**
 * Tiles are rasterised at the zoom they were last laid out at and scaled from there.
 * They are laid out again when the zoom settles, or when it has drifted this far
 * (as a ratio) mid-gesture, so they never stay blurry or oversized for long.
 */
export const RELAYOUT_RATIO = 1.4;

// ── Image trail ("vector drag") ───────────────────────────────────────────

/**
 * Each image hangs on its grid position from a damped spring with air drag, so while
 * the canvas moves it trails behind along the velocity vector by `lag × velocity`, then
 * settles back exactly when the canvas stops.
 *
 * Lag tapers along the direction of motion: least at the viewport edge the images move
 * toward, most at the opposite edge, so the sheet stretches out behind the gesture like
 * cloth pulled from its front edge. While zooming, images move radially, so the taper
 * runs from the zoom anchor outward instead. Each image adds a little weight of its own.
 */
export const TRAIL_LAG_MIN = 0.008; // s
export const TRAIL_LAG_MAX = 0.032; // s
/** Share of the lag that comes from the taper; the rest is each image's own weight. */
export const TRAIL_TAPER_SHARE = 0.85;
/** How quickly an image's lag follows a change of direction, s: the sheet re-tapers smoothly. */
export const TRAIL_LAG_TAU = 0.12;
/** Below this on-screen speed (px/s) the taper keeps its last direction rather than following noise. */
export const TRAIL_DIRECTION_MIN_SPEED = 30;
/** Damping ratio of each image's spring. Below 1 it overshoots a touch when the canvas stops. */
export const TRAIL_DAMPING = 0.72;
/** Largest trail offset shown, in S (soft-limited), so fast flings stretch the grid without scattering it. */
export const TRAIL_MAX_OFFSET = 0.22;
/** An image snaps onto its grid position below this offset (screen px) and speed (px/s). */
export const TRAIL_SETTLE_DISTANCE = 0.02;
export const TRAIL_SETTLE_SPEED = 0.5;

// ── Glides (click to centre, paging) ───────────────────────────────────────

/** Shortest glide to centre a clicked image or page to the next, s. */
export const FOCUS_MIN_DURATION = 0.45;
/** Longest glide, s: even a far move never feels sluggish. */
export const FOCUS_MAX_DURATION = 0.9;
/** Extra glide time per doubling of distance beyond FOCUS_DISTANCE_UNIT, s. */
export const FOCUS_DURATION_PER_DOUBLING = 0.16;
/** Distance, screen px, at which the glide starts taking longer than the minimum. */
export const FOCUS_DISTANCE_UNIT = 300;
/**
 * Glides ease out: they leave at GLIDE_EASE_OUT × their average speed (3 makes the path
 * an ease-out cubic) and slow smoothly to rest, arriving with no jolt. A flick that is
 * already faster keeps its speed and arrives sooner instead of overshooting, but takes
 * at least GLIDE_MIN_DURATION.
 */
export const GLIDE_EASE_OUT = 3;
export const GLIDE_MIN_DURATION = 0.25;

// ── Active image and focus frame ───────────────────────────────────────────

/**
 * The active image is the one whose on-screen centre is nearest the viewport centre.
 * It only changes once another image is closer by this much, screen px, so it never
 * flickers between two near-equal neighbours.
 */
export const ACTIVE_SWITCH_MARGIN = 12;
/** Gap between the active image and the focus frame around it, px. */
export const FOCUS_FRAME_PADDING = 8;
/** Time for the focus frame to move from one image to the next, s. */
export const FOCUS_FRAME_DURATION = 0.45;
/** Zooming onto another image, the frame fades out this fast first, s, and moves only once out of sight. */
export const FOCUS_FRAME_CONCEAL = 0.12;

// ── Leaving the canvas ─────────────────────────────────────────────────────

/**
 * Going to the about view, the camera flies on into the canvas (flight.ts). Each image
 * gets a depth for the flight only, 1 to 1 + FLIGHT_DEPTH_SPREAD (the camera starts at 0),
 * and as the camera travels forward each is drawn 1 / (1 − travel / depth) times bigger,
 * moving outward from the screen centre: nearer images grow and leave first. Each fades
 * out between FLIGHT_FADE_FROM and FLIGHT_FADE_TO of the way to it, and the camera travels
 * until the farthest has faded, over FLIGHT_DURATION s. Nearing the camera, each blurs too,
 * as if leaving the focal plane, up to FLIGHT_BLUR screen px.
 */
export const FLIGHT_DURATION = 0.8;
export const FLIGHT_DEPTH_SPREAD = 2;
export const FLIGHT_FADE_FROM = 0.45;
export const FLIGHT_FADE_TO = 0.8;
/**
 * The camera's travel over the flight's time, as a CSS cubic-bezier: it sets off gently,
 * rushes, and eases off as the last images go. Coming back it runs in reverse, so the
 * images arrive gently from the camera and settle softly into place.
 */
export const FLIGHT_EASE = [0.5, 0, 0.25, 1] as const;
export const FLIGHT_BLUR = 16;
/** Coming back to the canvas, the flight plays in reverse over this long, s: images rush in from the camera and settle. */
export const FLIGHT_RETURN_DURATION = 0.75;
/**
 * The about view's text is a plane behind the canvas, FLIGHT_FAR beyond where the camera
 * stops (in the same depth units as the images). Flying in, it comes towards the camera from
 * far off: growing to its own size as the camera arrives, fading in from FLIGHT_FAR_FADE of
 * the way, and sharpening from FLIGHT_FAR_BLUR screen px. Flying back, the opposite.
 */
export const FLIGHT_FAR = 1;
export const FLIGHT_FAR_FADE = 0.35;
export const FLIGHT_FAR_BLUR = 8;
/** With reduced motion there is no flight, just a fade this long, s. */
export const FLIGHT_REDUCED_DURATION = 0.3;

// ── Caption (zoomed in) ────────────────────────────────────────────────────

/**
 * The focused image's caption rises in slowly, line by line, each over CAPTION_IN s and
 * CAPTION_STAGGER s after the one before, once the view is still; it leaves upwards fast,
 * CAPTION_OUT s, CAPTION_OUT_STAGGER s apart, the moment anything moves.
 */
export const CAPTION_IN = 0.9;
export const CAPTION_STAGGER = 0.1;
export const CAPTION_OUT = 0.14;
export const CAPTION_OUT_STAGGER = 0.02;
/** Zooming onto another image, the frame that stepped aside comes back this far through the zoom. */
export const FOCUS_FRAME_RETURN = 0.4;

// ── Input ──────────────────────────────────────────────────────────────────

/** Pointer travel before a press becomes a drag, px. Below it, a press stays a click. */
export const DRAG_THRESHOLD = 5;
/** Pixels per wheel line (deltaMode 1). */
export const LINE_HEIGHT = 40;
/** Arrow-key step, in on-screen lattice pitches. Shift+arrow moves most of a viewport. */
export const KEY_STEP = 0.75;
export const KEY_PAGE = 0.8;

// ── Lens (watchOS-style edge scaling) ───────────────────────────────────────

/**
 * Images keep full size near the centre of the viewport and shrink towards every edge,
 * and the grid is pulled inwards so smaller images also sit closer together (lens.ts).
 * Radii are in viewport half-extents: 1 is an edge midpoint, a corner is
 * 2^(1/LENS_ROUNDNESS) ≈ 1.19. `?flat` in the URL turns the lens off.
 */
/** Full size inside this radius. */
export const LENS_INNER = 0.45;
/** Smallest from this radius on. */
export const LENS_OUTER = 1.2;
export const LENS_MIN_SCALE = 0.45;
/** Superellipse exponent of the radius: 2 is an ellipse, higher is squarer; 4 is close to the Watch's squircle. */
export const LENS_ROUNDNESS = 4;
/**
 * The lens squeezes extra world into the edge ring, so more cells are on screen than the
 * no-repeat sizing in layout.ts assumes. This is how much of that extra world the sizing
 * counts: 1 sizes images so no image can ever appear twice on screen; lower keeps images
 * smaller and the grid denser, at the cost of the odd repeat between two small images on
 * opposite edges (never one larger than about half size). Measured at 1440×900:
 *   1    → S 282 px, 18 images on screen, no repeats (guaranteed)
 *   0.55 → S 246 px, 22 images, a repeat on ~3% of screens
 *   0    → S 205 px, 30 images, a repeat on ~75% of screens
 */
export const LENS_REPEAT_SHARE = 0.55;

// ── Rendering and loading ───────────────────────────────────────────────────

/** Cells kept loaded around the viewport on every side, in pitches. */
export const MARGIN = 0.5;
/** Extra margin in the direction of travel: speed × LEAD_TIME, capped at LEAD_MAX pitches. */
export const LEAD_TIME = 0.35;
export const LEAD_MAX = 2;
/**
 * Short edges of the build-time image variants, px. The master's own size is added on top, up
 * to the last of these: no tile is ever drawn larger than that, even zoomed in on a 4K screen.
 */
export const VARIANT_SHORT_EDGES = [256, 512, 768, 1024, 1536, 2048, 2880] as const;
