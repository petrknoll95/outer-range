import { INTRO_CONTROLS, INTRO_LINE, INTRO_LINE_TEXT } from './config';
import type { IntroReveal } from './intro';
import { introLetter, introTitleEnd } from './intro';

/**
 * What the intro says at its centre, each piece rising through a mask and leaving: a line, set
 * like the wordmark, and then the controls, a copy of the info bar (InfoBar.astro). Where the
 * info bar doesn't show, as on a touch screen, there are no keys to press, so only its first
 * item comes, the pictograms. It is decoration: the page says the same to a screen reader.
 * The controls are white with a difference blend, like the info bar, as their icons are white;
 * the line is solid ink, so the lines behind it can't eat into its letters. Only transforms
 * change, so it costs next to nothing to draw.
 */
const CLASS = 'pointer-events-none absolute inset-0 flex items-center justify-center select-none';
const LINE = 'overflow-hidden px-2 py-4 text-xl leading-none font-medium tracking-[-0.02em] whitespace-pre text-ink min-[760px]:text-2xl';
const CONTROLS = 'text-white mix-blend-difference';
/** Where the info bar shows (InfoBar.astro). */
const INFO_BAR = '(hover: hover) and (pointer: fine) and (min-width: 760px)';
/** How far below or above its place an item waits, % of its height: clear of the mask. */
const TRAVEL = 170;

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly items: HTMLElement[];
  private readonly end: number;

  private constructor(
    parent: HTMLElement,
    row: HTMLElement,
    private readonly reveal: IntroReveal,
    zIndex: number,
    name: 'introLine' | 'introTitle',
    style = '',
  ) {
    this.el.className = `${CLASS} ${style}`;
    this.el.dataset[name] = '';
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    this.items = [...row.children] as HTMLElement[];
    for (const item of this.items) item.classList.add('will-change-transform');
    this.el.append(row);
    parent.append(this.el);
    this.end = introTitleEnd(this.items.length, reveal);
  }

  /** The line, letter by letter. */
  static line(parent: HTMLElement, zIndex: number): IntroTitle {
    const row = document.createElement('span');
    row.className = LINE;
    row.append(
      ...[...INTRO_LINE_TEXT].map((letter) => {
        const span = document.createElement('span');
        span.className = 'inline-block';
        span.textContent = letter;
        return span;
      }),
    );
    return new IntroTitle(parent, row, INTRO_LINE, zIndex, 'introLine');
  }

  /** The controls, item by item. */
  static controls(parent: HTMLElement, zIndex: number): IntroTitle {
    const row = document.querySelector('[aria-label="Controls"] ul')!.cloneNode(true) as HTMLElement;
    // A mask with room above and below.
    row.classList.add('overflow-hidden', 'py-4');
    if (!matchMedia(INFO_BAR).matches) for (const item of [...row.children].slice(1)) item.remove();
    return new IntroTitle(parent, row, INTRO_CONTROLS, zIndex, 'introTitle', CONTROLS);
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
