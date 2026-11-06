import svg from '../assets/logo.svg?raw';

/**
 * The studio logo (src/assets/logo.svg), cut into its glyphs, left to right: O U T E R, the
 * mark, R A N G E. Each glyph is a slice of the logo's full height, from its own left edge to
 * the next one's, so set side by side they make up the logo exactly, and each can move on its
 * own like a letter of a line of text (introtitle.ts).
 */
export interface LogoGlyph {
  /** The slice's viewBox, in the logo's own units. */
  viewBox: [x: number, y: number, width: number, height: number];
  d: string;
  evenOdd: boolean;
}

const [, , WIDTH, HEIGHT] = /viewBox="([^"]+)"/.exec(svg)![1]!.split(/\s+/).map(Number) as [number, number, number, number];

/** Where a path starts on the left: the least x it reaches (its paths use absolute commands only). */
function left(d: string): number {
  let min = Infinity;
  let command = '';
  let n = 0;
  for (const token of d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g)!) {
    if (/[a-zA-Z]/.test(token)) {
      command = token;
      n = 0;
      continue;
    }
    // H takes x alone, V y alone; every other command here takes x,y pairs.
    const isX = command === 'H' ? true : command === 'V' ? false : n % 2 === 0;
    if (isX) min = Math.min(min, Number(token));
    n++;
  }
  return min;
}

const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)]
  .map(([, attrs]) => ({ d: /\bd="([^"]+)"/.exec(attrs!)![1]!, evenOdd: /fill-rule="evenodd"/.test(attrs!) }))
  .map((path) => ({ ...path, x: left(path.d) }))
  .sort((a, b) => a.x - b.x);

export const LOGO_HEIGHT = HEIGHT;

export const LOGO_GLYPHS: readonly LogoGlyph[] = paths.map(({ d, evenOdd, x }, n) => {
  // The first slice takes in the logo's left margin, the last its right one.
  const from = n === 0 ? 0 : x;
  const to = n === paths.length - 1 ? WIDTH : paths[n + 1]!.x;
  return { viewBox: [from, 0, to - from, HEIGHT], d, evenOdd };
});
