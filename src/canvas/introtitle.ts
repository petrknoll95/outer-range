import { introLetter, introTitleEnd } from './intro';

/**
 * The line at the centre of the intro, set like the wordmark, the same size and weight. Solid
 * ink, not the wordmark's difference blend, which turns muddy over the lines passing behind,
 * and a soft glow of the background so they fall away around it. Only transforms change, so it costs next to nothing to draw.
 */
const CLASS =
  'pointer-events-none absolute inset-0 flex items-center justify-center text-2xl leading-none font-medium tracking-[-0.02em] whitespace-pre text-ink select-none';
const LETTER = 'inline-block will-change-transform [text-shadow:0_0_6px_var(--color-canvas),0_0_14px_var(--color-canvas),0_0_14px_var(--color-canvas)]';
/** How far below or above its place a letter waits, % of its height: clear of the mask. */
const TRAVEL = 170;

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly letters: HTMLSpanElement[];
  private readonly end: number;

  constructor(parent: HTMLElement, text: string, zIndex: number) {
    this.el.className = CLASS;
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.introTitle = '';
    // A mask with room above and below the letters for their glow.
    const mask = document.createElement('span');
    mask.className = 'overflow-hidden px-[0.5em] py-[0.5em]';
    this.letters = [...text].map((letter) => {
      const span = document.createElement('span');
      span.className = LETTER;
      span.textContent = letter;
      return span;
    });
    mask.append(...this.letters);
    this.el.append(mask);
    parent.append(this.el);
    this.end = introTitleEnd(this.letters.length);
  }

  draw(t: number): void {
    if (t > this.end) return this.remove();
    this.letters.forEach((letter, n) => {
      letter.style.transform = `translateY(${(introLetter(t, n) * TRAVEL).toFixed(2)}%)`;
    });
  }

  remove(): void {
    this.el.remove();
  }
}
