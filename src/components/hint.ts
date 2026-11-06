/**
 * A key hint: its key drawn as a 24 px pill with a 1.2 px outline, then what it does. The info bar
 * (InfoBar.astro) is a row of them, and the header's link (Header.astro) is one. All of it is
 * drawn at SCALE of the design's size, so it shrinks together, in proportion.
 */

// The label and key type, trimmed to the cap height so it centres optically in its pill.
const trim = 'leading-none [text-box:trim-both_cap_alphabetic] whitespace-nowrap';
export const label = `${trim} text-[16.8px] tracking-[-0.02em]`;
// Outlined in the text's colour: white, blended (InfoBar.astro, Header.astro), but for the info bar under the open menu.
export const pill = 'flex h-6 shrink-0 items-center justify-center rounded-full border-[1.2px] border-current';
export const glyph = `${trim} text-[12px]`;
export const SCALE = 0.85;
/** The ESC a view's hint adds beside its key while the view is open (KeyHint.astro): its width, and the gap to the key, design px. */
export const ESC_WIDTH = 35;
export const ESC_GAP = 4.8;
/**
 * How a view's hint makes room for its ESC (KeyHint.astro): over half a second, setting off gently
 * (no lurch on the first frame) and easing out long, none of it with reduced motion. Whatever moves
 * with it moves on these too (the wait for its label is each one's own), and so does what its label
 * moves when it changes width (src/canvas/hints.ts): ESC_EASE and ESC_DURATION are the same, for script.
 */
export const ESC_MOVE = 'duration-500 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none';
export const ESC_DURATION = 500;
export const ESC_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
/** Kept on the GPU, each on its own layer, so it is never redrawn as it moves, nor when it stops. */
export const GPU = 'will-change-[transform,translate,scale,opacity]';
