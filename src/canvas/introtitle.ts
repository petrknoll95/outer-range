import { INTRO_LINE, INTRO_TAGLINE, INTRO_TAGLINE_TEXT } from './config';
import type { IntroReveal } from './intro';
import { introLetter, introTitleEnd } from './intro';
import { LOGO_GLYPHS } from './logo';

/**
 * What the intro says at its centre, one after the other, each rising through a mask piece by
 * piece and leaving: the studio logo, glyph by glyph (logo.ts), then the tagline, letter by
 * letter, set like the wordmark. The logo's letters stand as tall as the wordmark's capitals:
 * one of its units is LOGO_UNIT em. It is decoration: the page says the same to a screen reader.
 * Both are solid ink, so the lines behind them can't eat into them. Only transforms change, so
 * it costs next to nothing to draw.
 */
const CLASS = 'pointer-events-none absolute inset-0 flex items-center justify-center select-none';
/** The mask, with room above and below; the type of the wordmark, which the logo is sized by too. */
const ROW = 'overflow-hidden px-2 py-4 text-xl leading-none font-medium tracking-[-0.02em] text-ink min-[760px]:text-2xl';
/** The logo's units in em of the wordmark's size: its capitals, 16.7 units tall, as tall as the wordmark's. */
const LOGO_UNIT = 1 / 24;
/** How far below or above its place a piece waits, % of its height: clear of the mask. */
const TRAVEL = 170;
const SVG = 'http://www.w3.org/2000/svg';

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly end: number;

  private constructor(
    parent: HTMLElement,
    row: HTMLElement,
    private readonly items: readonly (HTMLElement | SVGSVGElement)[],
    private readonly reveal: IntroReveal,
    zIndex: number,
    name: 'introLine' | 'introTagline',
  ) {
    this.el.className = CLASS;
    this.el.dataset[name] = '';
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    row.append(...items);
    this.el.append(row);
    parent.append(this.el);
    this.end = introTitleEnd(items.length, reveal);
  }

  /** The logo. */
  static line(parent: HTMLElement, zIndex: number): IntroTitle {
    const row = document.createElement('span');
    row.className = `${ROW} flex items-center`;
    const glyphs = LOGO_GLYPHS.map(({ viewBox, d, evenOdd }) => {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', viewBox.join(' '));
      svg.setAttribute('class', 'block shrink-0 overflow-visible will-change-transform');
      svg.style.width = `${viewBox[2] * LOGO_UNIT}em`;
      svg.style.height = `${viewBox[3] * LOGO_UNIT}em`;
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'currentColor');
      if (evenOdd) path.setAttribute('fill-rule', 'evenodd');
      svg.append(path);
      return svg;
    });
    return new IntroTitle(parent, row, glyphs, INTRO_LINE, zIndex, 'introLine');
  }

  /** The tagline, after it. */
  static tagline(parent: HTMLElement, zIndex: number): IntroTitle {
    const row = document.createElement('span');
    row.className = `${ROW} whitespace-pre`;
    const letters = [...INTRO_TAGLINE_TEXT].map((letter) => {
      const span = document.createElement('span');
      span.className = 'inline-block will-change-transform';
      span.textContent = letter;
      return span;
    });
    return new IntroTitle(parent, row, letters, INTRO_TAGLINE, zIndex, 'introTagline');
  }

  draw(t: number): void {
    if (t > this.end) return this.remove();
    this.items.forEach((item, n) => {
      item.style.transform = `translateY(${(introLetter(t, n, this.reveal) * TRAVEL).toFixed(2)}%)`;
    });
  }

  remove(): void {
    this.el.remove();
  }
}
