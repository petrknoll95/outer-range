/**
 * The active image's project name, a small translucent pill above the top-left corner of the
 * focus frame, zoomed out and in (zoomed in, the caption adds the image's category).
 *
 * It lives inside the frame element (`.focus-project` in global.css), so it goes wherever the
 * frame goes, handing over from image to image with it, and hides whenever the frame does:
 * stepping aside for a zoom, or fading as the camera flies to the about view.
 */
export class ProjectLabel {
  readonly el: HTMLSpanElement;
  private shown: string | null = null;

  constructor(frame: HTMLElement) {
    this.el = document.createElement('span');
    this.el.className = 'focus-project';
    this.el.dataset.hidden = '';
    frame.append(this.el);
  }

  /** Show `title`, or nothing (null). A new name eases in; the same one again changes nothing. */
  show(title: string | null): void {
    if (title === null) {
      this.el.dataset.hidden = '';
      return;
    }
    const wasHidden = 'hidden' in this.el.dataset;
    delete this.el.dataset.hidden;
    if (title === this.shown) return;
    this.shown = title;
    this.el.textContent = title;
    if (!wasHidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.el.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    }
  }
}
