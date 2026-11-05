import { CAPTION_IN, CAPTION_OUT, CAPTION_OUT_STAGGER, CAPTION_STAGGER } from './config';

/** What the caption shows, from the image's content entry. */
export interface CaptionContent {
  category: string;
}

/** Top to bottom, the order they rise in. */
const LINES = ['category'] as const;

/**
 * The focused image's category, centred below it (above it, the project label names its
 * project: projectlabel.ts). Its alt text stays on the image, for screen readers, not here. Anchored to the focus frame (`.focus-caption` in
 * global.css), so it sits under whichever image the frame frames; leaving, it is pinned where
 * it is drawn first, so it never rides along with the frame as the view moves on.
 *
 * Each line sits in its own mask and rises into view, one after another. Switching to
 * another image first sends the lines out upwards, quicker, then brings the new ones in
 * from below; hiding sends them out. The motion is CSS transitions (`.focus-caption` in
 * global.css), so a change that interrupts another carries on from wherever it is.
 */
export class FocusCaption {
  readonly el: HTMLDivElement;
  private readonly lines = new Map<(typeof LINES)[number], HTMLSpanElement>();
  private readonly groups: HTMLDivElement[];
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
    const below = document.createElement('div');
    below.className = 'focus-caption-below';
    LINES.forEach((name, n) => {
      const line = document.createElement('p');
      line.className = `focus-caption-${name}`;
      line.style.setProperty('--line', String(n));
      const text = document.createElement('span');
      line.append(text);
      below.append(line);
      this.lines.set(name, text);
    });
    this.el.append(below);
    this.groups = [below];
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
      // Out first, where it stands; whatever is wanted by then comes in after.
      this.pin();
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
    this.unpin();
    for (const name of LINES) this.lines.get(name)!.textContent = next[name];
    this.el.hidden = false;
    // Below their masks, without a transition, then rising from there.
    this.el.dataset.state = 'below';
    void this.el.offsetWidth;
    this.el.dataset.state = 'in';
  }

  /** Pin each group where it is drawn now, off the frame's anchor. */
  private pin(): void {
    for (const group of this.groups) {
      const r = group.getBoundingClientRect();
      Object.assign(group.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, bottom: 'auto', justifySelf: 'auto' });
    }
  }

  /** Back on the frame's anchor. */
  private unpin(): void {
    for (const group of this.groups) group.removeAttribute('style');
  }
}
