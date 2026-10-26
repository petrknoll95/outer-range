import { FOCUS_FRAME_CONCEAL, FOCUS_FRAME_DURATION, FOCUS_FRAME_PADDING } from './config';
import { Z_LEVELS } from './world';

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
  /** Faded out (see conceal): it moves straight to each image instead of handing over. */
  private concealed = false;
  /** Concealed and fully faded out: moves can happen now. */
  private outOfSight = false;
  /** A move held back until the frame has faded out of sight (undefined: none). */
  private pending: HTMLElement | null | undefined = undefined;
  private pendingTimer = 0;
  private radius = Number.NaN;
  /** Mid hand-over from one image to the next. */
  private handing = false;
  private handingTimer = 0;
  /** Called when a hand-over has finished. */
  onSettle: (() => void) | null = null;

  /** Whether it is moving from one image to the next. */
  get moving(): boolean {
    return this.handing;
  }

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'focus-frame';
    this.el.setAttribute('aria-hidden', 'true');
    // Over every tile, however they stack: a neighbour overlapping the active image (or its
    // project label, above it) never covers it.
    this.el.style.zIndex = String(Z_LEVELS);
    this.el.style.setProperty('--focus-pad', `${FOCUS_FRAME_PADDING}px`);
    this.el.style.setProperty('--focus-duration', `${FOCUS_FRAME_DURATION}s`);
    this.el.style.setProperty('--focus-conceal', `${FOCUS_FRAME_CONCEAL}s`);
    this.el.addEventListener('transitionend', (e) => e.propertyName === 'opacity' && this.gone());
    this.el.hidden = true;
    parent.append(this.el);
  }

  /** Move the frame to `tile` (the active image's tile element), animating from wherever it is now. */
  focus(tile: HTMLElement | null): void {
    if (this.concealed && !this.outOfSight) {
      // Still fading out: never jump while it can be seen; go once it can't.
      this.pending = tile;
      return;
    }
    if (tile === this.to) return;
    if (!tile) {
      this.name(this.from, null);
      this.name(this.to, null);
      this.from = this.to = null;
      this.el.hidden = true;
      return;
    }
    if (!this.to || this.el.hidden || this.concealed) {
      // First image, or out of sight: go straight there, no hand-over. Both names come off
      // the images it was between (mid hand-over they are two): a name left on any other
      // tile would win the anchor whenever that tile comes later in the page.
      this.name(this.from, null);
      this.name(this.to, null);
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
    if (tile === this.pending) this.pending = undefined;
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

  /** Fade out quickly, and once out of sight move straight to each image (nothing to watch hand over). */
  conceal(): void {
    if (this.concealed) return;
    this.concealed = true;
    this.outOfSight = false;
    this.el.dataset.concealed = '';
    // Out of sight when its fade ends (see the constructor), or soon after it should have
    // (there is no fade with reduced motion).
    this.pendingTimer = window.setTimeout(() => this.gone(), FOCUS_FRAME_CONCEAL * 1000 + 100);
  }

  /** The fade out has ended: make the move held back, if any. */
  private gone(): void {
    if (!this.concealed || this.outOfSight) return;
    this.outOfSight = true;
    this.flush();
  }

  /** Fade back in, on whichever image it is on now (making any move held back first). */
  reveal(): void {
    this.outOfSight = true;
    this.flush();
    this.concealed = this.outOfSight = false;
    delete this.el.dataset.concealed;
  }

  /** Make the move held back while fading out. */
  private flush(): void {
    clearTimeout(this.pendingTimer);
    this.pendingTimer = 0;
    const tile = this.pending;
    this.pending = undefined;
    if (tile !== undefined) this.focus(tile);
  }

  /** The corner radius of the image as drawn, px, for the frame's own (it adds its gap). */
  setRadius(px: number): void {
    const r = Math.round(px * 10) / 10;
    if (r === this.radius) return;
    this.radius = r;
    this.el.style.setProperty('--tile-radius', `${r}px`);
  }

  private name(tile: HTMLElement | null, name: string | null): void {
    if (!tile) return;
    if (name) tile.style.setProperty('anchor-name', name);
    else tile.style.removeProperty('anchor-name');
  }

  /** Restart the hand-over from mix `mix` with the given carried-over offsets (px). */
  private restart(mix: number, dt: number, dr: number, db: number, dl: number): void {
    clearTimeout(this.handingTimer);
    this.handing = mix < 1;
    if (this.handing) {
      this.handingTimer = window.setTimeout(() => {
        this.handing = false;
        this.onSettle?.();
      }, FOCUS_FRAME_DURATION * 1000 + 30);
    }
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
