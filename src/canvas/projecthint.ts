import { glyph, label, pill, SCALE } from '../components/hint';

/**
 * In the focused view, a key hint for the project view: "P", Project, just below the focus frame's
 * bottom-right corner, on the row of the project's categories (projectlabel.ts). Set like the info
 * bar's hints and the header's link (hint.ts), but in the ink: inside the frame a difference blend
 * has nothing to blend with. Inside the frame too, it moves and hides with it. Its place and fade
 * are in ProjectView.astro (`.focus-hint`); like the header's key, it shows only where there are keys.
 */
export class ProjectHint {
  readonly el: HTMLSpanElement;
  private shown = false;

  constructor(frame: HTMLElement) {
    this.el = document.createElement('span');
    this.el.className = 'focus-hint';
    this.el.dataset.hidden = '';
    const hint = document.createElement('span');
    hint.className = 'flex items-center gap-[9.6px]';
    hint.style.zoom = String(SCALE);
    const key = document.createElement('span');
    key.className = `${pill.replace('border-white', 'border-current')} w-6`;
    key.setAttribute('aria-hidden', 'true');
    const letter = document.createElement('span');
    letter.className = glyph;
    letter.textContent = 'P';
    key.append(letter);
    const text = document.createElement('span');
    text.className = label;
    text.textContent = 'Project';
    hint.append(key, text);
    this.el.append(hint);
    frame.append(this.el);
  }

  show(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    if (on) delete this.el.dataset.hidden;
    else this.el.dataset.hidden = '';
  }
}
