/**
 * The active image's project, in small translucent pills on the focus frame, zoomed out and
 * in: its name above the top-left corner, and its categories (Brand, Website…) in a row below
 * the bottom-left corner.
 *
 * Both live inside the frame element (`.focus-project` and `.focus-categories` in global.css),
 * so they go wherever the frame goes, handing over from image to image with it, and hide
 * whenever the frame does: stepping aside for a zoom, or fading as the camera flies to the
 * about view.
 */
export interface ProjectLabelContent {
  title: string;
  categories: readonly string[];
}

export class ProjectLabel {
  readonly el: HTMLSpanElement;
  readonly categories: HTMLDivElement;
  private shown: ProjectLabelContent | null = null;

  constructor(frame: HTMLElement) {
    this.el = document.createElement('span');
    this.el.className = 'focus-project';
    this.el.dataset.hidden = '';
    this.categories = document.createElement('div');
    this.categories.className = 'focus-categories';
    this.categories.dataset.hidden = '';
    frame.append(this.el, this.categories);
  }

  /** Show `content`, or nothing (null). A new project eases in; the same one again changes nothing. */
  show(content: ProjectLabelContent | null): void {
    if (content === null) {
      this.el.dataset.hidden = '';
      this.categories.dataset.hidden = '';
      return;
    }
    const wasHidden = 'hidden' in this.el.dataset;
    delete this.el.dataset.hidden;
    delete this.categories.dataset.hidden;
    if (content.title === this.shown?.title && content.categories.join() === this.shown.categories.join()) return;
    this.shown = content;
    this.el.textContent = content.title;
    this.categories.replaceChildren(
      ...content.categories.map((category) => {
        const pill = document.createElement('span');
        pill.className = 'focus-category';
        pill.textContent = category;
        return pill;
      }),
    );
    if (!wasHidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const el of [this.el, this.categories]) {
        el.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], {
          duration: 260,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
      }
    }
  }
}
