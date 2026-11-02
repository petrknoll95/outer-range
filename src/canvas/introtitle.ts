import { introLetter, introTitleEnd } from './intro';

/**
 * The controls, at the centre of the intro, each rising through a mask: a copy of the info
 * bar (InfoBar.astro), set like it, white with a difference blend. Where the info bar doesn't
 * show, as on a touch screen, there are no keys to press, so only its first item comes, the
 * pictograms. It is decoration: the info bar says the same to a screen reader. Only transforms
 * change, so it costs next to nothing to draw.
 */
const CLASS = 'pointer-events-none absolute inset-0 flex items-center justify-center text-white mix-blend-difference select-none';
/** Where the info bar shows (InfoBar.astro). */
const INFO_BAR = '(hover: hover) and (pointer: fine) and (min-width: 760px)';
/** How far below or above its place an item waits, % of its height: clear of the mask. */
const TRAVEL = 170;

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly items: HTMLElement[];
  private readonly end: number;

  constructor(parent: HTMLElement, zIndex: number) {
    this.el.className = CLASS;
    this.el.dataset.introTitle = '';
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    const row = document.querySelector('[aria-label="Controls"] ul')!.cloneNode(true) as HTMLElement;
    // A mask with room above and below.
    row.classList.add('overflow-hidden', 'py-4');
    this.items = [...row.children] as HTMLElement[];
    if (!matchMedia(INFO_BAR).matches) for (const item of this.items.splice(1)) item.remove();
    for (const item of this.items) item.classList.add('will-change-transform');
    this.el.append(row);
    parent.append(this.el);
    this.end = introTitleEnd(this.items.length);
  }

  draw(t: number): void {
    if (t > this.end) return this.remove();
    this.items.forEach((item, n) => {
      item.style.transform = `translateY(${(introLetter(t, n) * TRAVEL).toFixed(2)}%)`;
    });
  }

  remove(): void {
    this.el.remove();
  }
}
