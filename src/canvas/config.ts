/**
 * Every tunable number for the canvas lives here.
 *
 * World lengths are in units of S, the short edge every image shares; on screen
 * S becomes a pixel size chosen from the viewport (see layout.ts). Values in pixels
 * or seconds say so.
 */

export const SEED = 0x5eed2026;

// ── World geometry (units of S) ────────────────────────────────────────────

/**
 * The most a tile spans either way: the long edge of a 4:3 or 3:4 image. A wider or taller
 * image is fitted inside a LONG × LONG box (tileSize in world.ts), so it never spans more.
 */
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
 * A tile shorter than S (anything wider than 4:3) leaves room above and below it that a 4:3
 * tile fills, and one narrower than S (taller than 3:4) room at its sides. It jitters into this
 * share of that room too, so short tiles don't line up in rows of matching gaps. Never past
 * where a 4:3 or 3:4 tile could reach, so the lattice's reach and the no-repeat sizing hold,
 * and images in one column still never touch; the overlap budget is checked in tests/world.test.ts.
 */
export const SLACK_JITTER = 1;
/**
 * No-repeat lattice. Cells (i, j) and (i′, j′) can only show the same image when
 * i ≡ i′ (mod REPEAT_COLS) and j ≡ j′ (mod REPEAT_ROWS), so copies are at least this
 * many cells apart. layout.ts sizes S so that span never fits on screen.
 *
 * Each of the COLS×ROWS classes draws from its own slice of the images, so the image
 * count sets the trade-off: a bigger lattice allows smaller images on screen, but leaves
 * fewer images per class and repeats each class's choices more visibly. 6×5 with the
 * 67 canvas images gives every class 2–3. Five rows rather than six only matters on a
 * portrait screen, where the rows set S: there tiles come out a little larger.
 */
export const REPEAT_COLS = 6;
export const REPEAT_ROWS = 5;

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
 *
 * Under ZOOM_NARROW px wide, as on a phone, each image has its own zoom instead: it fills
 * ZOOM_NARROW_WIDTH of the viewport's width, unless it would then be over ZOOM_NARROW_HEIGHT of
 * its height, which leaves room for the project's pills above and below.
 */
export const ZOOM_IN_FILL = 0.7;
/**
 * On a wide window the project view's column (ProjectView.astro) is PROJECT_COLUMN times as wide
 * as the focused view's longest image (LONG at the zoomed-in zoom, which is already held where
 * images would go soft), so its images come a little larger than they do focused, and no
 * wider than PROJECT_COLUMN_MAX of the window. A portrait image's width is its short edge, so a
 * wider column would soon ask more of it than its sharpest copy has.
 */
export const PROJECT_COLUMN = 1.1;
export const PROJECT_COLUMN_MAX = 0.58;
export const ZOOM_NARROW = 760;
export const ZOOM_NARROW_WIDTH = 0.9;
export const ZOOM_NARROW_HEIGHT = 0.62;
export const ZOOM_MAX = 2.5;
/** Time to move between the two zoom states, s. */
export const ZOOM_DURATION = 0.7;
/** Time to page to a neighbour that needs another zoom, s. */
export const ZOOM_PAGE_DURATION = 0.5;
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
/** Left mid-move, images relax out of their trails over this time constant as they fly, s, so none is left to snap back on the return. */
export const FLIGHT_TRAIL_TAU = 0.16;
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

/**
 * The menu (Menu.astro) opens with the flight the other way round: the camera backs away from
 * the canvas by MENU_BACK, each image drawn in towards the centre by its depth, the nearer ones
 * faster, over FLIGHT_DURATION s, eased as the flight is. Coming home is gentler: it sets off at once,
 * as the menu goes, and lands slowly, over MENU_RETURN_DURATION s on MENU_RETURN_EASE. Each dims and blurs as
 * it shrinks, all the way back and all the way home again, so the fade never bunches up at one
 * end: drawn s as big, it is s ** MENU_BACK_DIM as opaque and blurred MENU_BACK_BLUR × (1 − s)
 * screen px, far off and faint behind the menu (the farther, the fainter), for its glass to blur.
 * The about view's text backs away as if at depth MENU_BACK_ABOUT.
 */
export const MENU_BACK = 1.5;
export const MENU_BACK_DIM = 3;
export const MENU_BACK_BLUR = 24;
export const MENU_BACK_ABOUT = 2;
export const MENU_RETURN_DURATION = 1;
export const MENU_RETURN_EASE = [0.33, 0, 0.15, 1] as const;
/**
 * The flight goes through the intro's wormhole (flight.ts, drawn by introlayer.ts): each image
 * on screen breaks into its colour grid, one ray per cell, and the rays thin into streaks and
 * rush past the camera, each FLIGHT_RAY_PACE times as fast as its image comes at it, through a
 * tube of lines, FLIGHT_LINES as many as the intro's. A streak's tail is where it was
 * FLIGHT_SHUTTER of the flight ago. Coming back it all runs in reverse, closing up into the images.
 */
export const FLIGHT_RAY_PACE = [1.25, 1.6] as const;
export const FLIGHT_LINES = 0.15;
export const FLIGHT_SHUTTER = 0.05;
/** Calmer than the intro: the lines are at most this solid, and the rays thin only this far towards INTRO_THIN. */
export const FLIGHT_LINE_ALPHA = 0.5;
export const FLIGHT_THINNING = 0.6;
/**
 * The wormhole is drawn as if through a lens with chromatic aberration (introlayer.ts): red
 * pushed out from the centre and blue in, by nothing at the centre to this many CSS px at the
 * corners, growing with the square of the distance so the middle stays sharp. It comes with
 * speed: in the intro, as the camera closes in by a log ratio over a shutter between the two
 * of INTRO_ABERRATION_SPEED (steady through the cruise, peaking at the launch); on the flight,
 * as it travels up to FLIGHT_ABERRATION_SPEED over a shutter.
 */
export const INTRO_ABERRATION = 10;
/** And round the centre, this share of it: the streaks run out from the centre, so that split shows only at their ends, this one along their sides. */
export const ABERRATION_TWIST = 0.4;
export const INTRO_ABERRATION_SPEED = [0.1, 1] as const;
export const FLIGHT_ABERRATION = 12;
export const FLIGHT_ABERRATION_SPEED = 0.25;
/**
 * The flight's images go from under their rays over this span of the flight (flightHandover):
 * once the rays are solid, and not before their cells have come well apart, so the gaps opening
 * between them show the image rather than the page.
 */
export const FLIGHT_HANDOVER = [0.14, 0.34] as const;
/** The flight's grids, and the intro's once the images are in, are this many times finer than its colour grid (scripts/pixels) each way, sampled from the images. */
export const FLIGHT_GRID_FINER = 3;

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
/** Short edge of the small copy of each video (scripts/videos), px: a tile drawn up to 1.25× that plays it instead of the full one. */
export const VIDEO_SMALL_EDGE = 360;
export const VARIANT_SHORT_EDGES = [256, 512, 768, 1024, 1536, 2048, 2880] as const;

// ── The intro ──────────────────────────────────────────────────────────────

/**
 * Opening the canvas, the camera is already flying: it cruises down the tunnel for
 * INTRO_CRUISE s, its depth falling by INTRO_CRUISE_RATE (in natural log) a second, the lines
 * streaming past. If the images on screen haven't all loaded by then it cruises on until they
 * have, for up to INTRO_WAIT s more. Meanwhile the studio logo and then INTRO_TAGLINE_TEXT
 * each rise in at the centre and leave again, as INTRO_LINE and INTRO_TAGLINE say: each glyph or
 * letter through a mask, `stagger` s after the last, in from `start` s over `rise` s, out from
 * `leave` s over `fall` s.
 *
 * Then it accelerates from INTRO_DISTANCE focal lengths away (intro.ts) and arrives over
 * INTRO_DURATION s. A zoom is seen in ratios, so INTRO_EASE eases the logarithm of the zoom: it launches hard, peaks a fifth of the way in, and spends the rest easing out. Each
 * tile comes in as its colour grid (pixels.ts), one ray per cell, thinned to INTRO_THIN of the
 * cell and INTRO_SPREAD apart in depth, each at its own pace within INTRO_PACE: below 1 it
 * runs ahead of the camera, above 1 it hangs back and tears through to catch up, part set by
 * its tile (INTRO_TILE_PACE) so tiles arrive in waves. They close up into the grid, a streak
 * drawing in behind each. INTRO_HANDOVER focal lengths out the real tiles take over and glide the rest of
 * the way, as the layer fades to them over INTRO_FADE s. Motion blur draws everything as a
 * streak from where it was INTRO_SHUTTER of the duration ago, so streaks are longest at the
 * peak. One extra line per INTRO_LINE_AREA px² of screen, at most INTRO_LINES, lines the
 * tunnel all the way in, for the camera to fly past, as wide as a ray (half INTRO_LINE_WIDTH across, at pace 1) and as
 * solid, so the tunnel and the images read as one field. However far off, nothing is drawn under INTRO_MIN_WIDTH px across,
 * so the far end of the tunnel stays filled. Depth fog tapers
 * everything with distance: from solid out to INTRO_FOG_CLEAR focal lengths, it falls away
 * smoothly over INTRO_FOG_DEPTH more, towards INTRO_FOG_FAR opacity. Pixels are capped at
 * INTRO_DPR.
 */
export const INTRO_LINE = { start: 0.25, rise: 0.55, leave: 1.3, fall: 0.3, stagger: 0.008 };
export const INTRO_TAGLINE_TEXT = 'Creative partner for the age of AI';
export const INTRO_TAGLINE = { start: 1.8, rise: 0.55, leave: 3.0, fall: 0.3, stagger: 0.008 };
export const INTRO_CRUISE = 3.6;
export const INTRO_WAIT = 1.5;
export const INTRO_CRUISE_RATE = 0.25;
export const INTRO_DURATION = 2;
export const INTRO_DISTANCE = 40;
export const INTRO_EASE = [0.34, 0, 0.06, 1] as const;
export const INTRO_HANDOVER = 0.12;
export const INTRO_THIN = 0.3;
export const INTRO_PACE = [0.72, 1.6] as const;
export const INTRO_TILE_PACE = 0.45;
export const INTRO_SPREAD = 0.6;
export const INTRO_SHUTTER = 0.12;
export const INTRO_LINE_AREA = 220;
export const INTRO_LINES = 6500;
export const INTRO_LINE_WIDTH = [1, 2] as const;
export const INTRO_MIN_WIDTH = 1;
export const INTRO_FOG_CLEAR = 1.5;
export const INTRO_FOG_DEPTH = 14;
export const INTRO_FOG_FAR = 0.07;
export const INTRO_DPR = 1.5;
export const INTRO_FADE = 0.32;

// ── Glass edges ────────────────────────────────────────────────────────────

/**
 * The top and bottom of the canvas are seen through glass (glass.ts): GLASS_BAND of the
 * viewport's height at each, bent like the edge of a lens. Nothing bends at the band's inner
 * edge, and most at the screen edge, by GLASS_STRENGTH of the band; GLASS_CURVE above 1 holds
 * the bend closer to the edge. Light splits as it bends, into a spectrum GLASS_DISPERSION of the
 * bend long per unit (red one way, blue the other). Pixels are capped at GLASS_DPR.
 */
export const GLASS_BAND = 0.08;
export const GLASS_STRENGTH = 1;
export const GLASS_CURVE = 1;
export const GLASS_DISPERSION = 0.3;
export const GLASS_DPR = 2;
