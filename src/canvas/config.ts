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
/** Camera snaps onto its target within this distance, px. */
export const SETTLE_DISTANCE = 0.05;

// ── Input ──────────────────────────────────────────────────────────────────

/** Pointer travel before a press becomes a drag, px. Below it, a press stays a click. */
export const DRAG_THRESHOLD = 5;
/** Pixels per wheel line (deltaMode 1). */
export const LINE_HEIGHT = 40;
/** Arrow-key step, in lattice pitches. Shift+arrow moves most of a viewport. */
export const KEY_STEP = 0.75;
export const KEY_PAGE = 0.8;

// ── Rendering and loading ───────────────────────────────────────────────────

/** Cells kept loaded around the viewport on every side, in pitches. */
export const MARGIN = 0.5;
/** Extra margin in the direction of travel: speed × LEAD_TIME, capped at LEAD_MAX pitches. */
export const LEAD_TIME = 0.35;
export const LEAD_MAX = 2;
/** Grid the floating origin snaps to, px. Tile transforms stay within ±this of zero. */
export const REBASE_DISTANCE = 4096;
/** Short edges of the build-time image variants, px. */
export const VARIANT_SHORT_EDGES = [256, 512, 768] as const;
