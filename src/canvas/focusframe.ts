import { FOCUS_FRAME_DURATION, FOCUS_FRAME_PADDING } from './config';

const FROM = '--focus-from';
const TO = '--focus-to';

/**
 * The frame around the active image, drawn FOCUS_FRAME_PADDING px outside it.
 *
 * It is placed with CSS anchor positioning (see `.focus-frame` in global.css): the image
 * it is leaving is anchor --focus-from, the one it is moving to is --focus-to, and each
 * inset is a blend of the two anchors' edges by `--focus-mix`. Only that number animates
 * (0 → 1, a registered custom property with a transition). Because both anchors are live,
 * the frame stays locked to the images while the canvas moves, and only the hand-over
 * from one image to the next is animated. The browser keeps it in step with the tiles'
 * transforms (position, lens scale, trail), so nothing here runs per frame.
 *
 * If the focus moves on before a hand-over finishes, the frame starts the next one from
 * where it is drawn: its offset from the image it was heading for is carried in
 * --focus-dt/-dr/-db/-dl and fades out as the mix reaches 1.
 */
export class FocusFrame {
  readonly el: HTMLDivElement;
  private from: HTMLElement | null = null;
  private to: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'focus-frame';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.setProperty('--focus-pad', `${FOCUS_FRAME_PADDING}px`);
    this.el.style.setProperty('--focus-duration', `${FOCUS_FRAME_DURATION}s`);
    this.el.hidden = true;
    parent.append(this.el);
  }

  /** Move the frame to `tile` (the active image's tile element), animating from wherever it is now. */
  focus(tile: HTMLElement | null): void {
    if (tile === this.to) return;
    if (!tile) {
      this.name(this.from, null);
      this.name(this.to, null);
      this.from = this.to = null;
      this.el.hidden = true;
      return;
    }
    if (!this.to || this.el.hidden) {
      // First image: appear on it, no hand-over.
      this.name(this.from, null);
      this.from = this.to = tile;
      this.name(tile, `${FROM}, ${TO}`);
      this.restart(1, 0, 0, 0, 0);
      this.el.hidden = false;
      return;
    }
    // Where the frame is drawn now, as an offset from the image it was heading for, which
    // becomes the one it leaves from. Each value is that edge's inset minus the anchor's.
    const frame = this.el.getBoundingClientRect();
    const leaving = this.to.getBoundingClientRect();
    const pad = FOCUS_FRAME_PADDING;
    const dt = frame.top + pad - leaving.top;
    const dl = frame.left + pad - leaving.left;
    const dr = leaving.right - (frame.right - pad);
    const db = leaving.bottom - (frame.bottom - pad);
    if (this.from !== this.to) this.name(this.from, null);
    this.from = this.to;
    this.to = tile;
    this.name(this.from, FROM);
    this.name(this.to, TO);
    this.restart(0, dt, dr, db, dl);
  }

  /** A tile is being reused for another image: if the frame is anchored to it, finish there or let go. */
  release(tile: HTMLElement): void {
    if (tile === this.from && tile !== this.to) {
      // The image it was leaving is gone; settle on the one it was moving to.
      this.name(tile, null);
      this.from = this.to;
      this.name(this.to, `${FROM}, ${TO}`);
      this.restart(1, 0, 0, 0, 0);
    } else if (tile === this.to) {
      this.focus(null);
    }
  }

  private name(tile: HTMLElement | null, name: string | null): void {
    if (!tile) return;
    if (name) tile.style.setProperty('anchor-name', name);
    else tile.style.removeProperty('anchor-name');
  }

  /** Restart the hand-over from mix `mix` with the given carried-over offsets (px). */
  private restart(mix: number, dt: number, dr: number, db: number, dl: number): void {
    const s = this.el.style;
    s.transition = 'none';
    s.setProperty('--focus-mix', String(mix));
    s.setProperty('--focus-dt', `${dt}px`);
    s.setProperty('--focus-dr', `${dr}px`);
    s.setProperty('--focus-db', `${db}px`);
    s.setProperty('--focus-dl', `${dl}px`);
    // Commit the starting point before the transition is restored, or there is nothing to animate from.
    void getComputedStyle(this.el).getPropertyValue('--focus-mix');
    s.transition = '';
    s.setProperty('--focus-mix', '1');
  }
}
