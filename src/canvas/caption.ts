import { CAPTION_IN, CAPTION_OUT, CAPTION_OUT_STAGGER, CAPTION_STAGGER } from './config';

/** What the caption shows, from the image's content entry. */
export interface CaptionContent {
  category: string;
  title: string;
  alt: string;
}

const LINES = ['category', 'title', 'alt'] as const;

/**
 * The focused image's category, title and alt text, small at the bottom left.
 *
 * Each line sits in its own mask and rises into view, one after another. Switching to
 * another image first sends the lines out upwards, quicker, then brings the new ones in
 * from below; hiding sends them out. The motion is CSS transitions (`.focus-caption` in
 * global.css), so a change that interrupts another carries on from wherever it is.
 */
export class FocusCaption {
  readonly el: HTMLDivElement;
  private readonly lines = new Map<(typeof LINES)[number], HTMLSpanElement>();
  /** What should show, and what the lines hold now. */
  private target: CaptionContent | null = null;
  private shown: CaptionContent | null = null;
  /** Set while the lines are leaving; the next content goes in once they have. */
  private leaving = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'focus-caption';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');
    this.el.style.setProperty('--caption-in', `${CAPTION_IN}s`);
    this.el.style.setProperty('--caption-stagger', `${CAPTION_STAGGER}s`);
    this.el.style.setProperty('--caption-out', `${CAPTION_OUT}s`);
    this.el.style.setProperty('--caption-out-stagger', `${CAPTION_OUT_STAGGER}s`);
    this.el.hidden = true;
    LINES.forEach((name, n) => {
      const line = document.createElement('p');
      line.className = `focus-caption-${name}`;
      line.style.setProperty('--line', String(n));
      const text = document.createElement('span');
      line.append(text);
      this.el.append(line);
      this.lines.set(name, text);
    });
    parent.append(this.el);
  }

  /** Show `content`, or nothing (null). The same object again changes nothing. */
  show(content: CaptionContent | null): void {
    this.target = content;
    this.sync();
  }

  private sync(): void {
    if (this.leaving) return;
    if (this.target === this.shown) {
      // Nothing more to change; with nothing to show, the (empty) caption is hidden.
      this.el.hidden = !this.shown;
      return;
    }
    if (this.shown) {
      // Out first; whatever is wanted by then comes in after.
      this.el.dataset.state = 'out';
      const last = CAPTION_OUT + (LINES.length - 1) * CAPTION_OUT_STAGGER;
      this.leaving = window.setTimeout(() => {
        this.leaving = 0;
        this.shown = null;
        this.sync();
      }, last * 1000);
      return;
    }
    const next = this.target!;
    this.shown = next;
    for (const name of LINES) this.lines.get(name)!.textContent = next[name];
    this.el.hidden = false;
    // Below their masks, without a transition, then rising from there.
    this.el.dataset.state = 'below';
    void this.el.offsetWidth;
    this.el.dataset.state = 'in';
  }
}
