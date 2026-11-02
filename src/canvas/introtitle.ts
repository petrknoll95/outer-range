import { introLetter, introTitleEnd } from './intro';

/**
 * The name, large at the centre of the intro: decoration, as the page's h1 says it already.
 * Solid ink, not the wordmark's difference blend: a blend turns muddy over the bright core of
 * the star field. Only transforms change, so it costs next to nothing to draw.
 */
const CLASS =
  'pointer-events-none absolute inset-0 flex items-center justify-center text-[clamp(2.75rem,9vw,8rem)] leading-none font-medium tracking-[-0.02em] whitespace-pre text-ink select-none';
const LETTER = 'inline-block will-change-transform';

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly letters: HTMLSpanElement[];
  private readonly end: number;

  constructor(parent: HTMLElement, name: string, zIndex: number) {
    this.el.className = CLASS;
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.introTitle = '';
    // A mask with a little room above and below the letters.
    const mask = document.createElement('span');
    mask.className = 'overflow-hidden py-[0.12em]';
    this.letters = [...name].map((letter) => {
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
      letter.style.transform = `translateY(${(introLetter(t, n) * 115).toFixed(2)}%)`;
    });
  }

  remove(): void {
    this.el.remove();
  }
}
