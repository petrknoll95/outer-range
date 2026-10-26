import { gsap } from 'gsap';
import { ZOOM_EASE } from './config';
import { cubicBezier } from './focus';
import type { ClientImage } from './renderer';
import { ringLayout } from './ring';

/** A rectangle on screen, px. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Opening: the whole move, and each next image's head start round the ring, s. */
const OPEN = 0.9;
const OPEN_STAGGER = 0.035;
/** Closing, quicker. */
const CLOSE = 0.65;
const CLOSE_STAGGER = 0.02;
/** With reduced motion nothing moves: it only fades, this long. */
const FADE = 0.25;
/** Where the others start (opening) and end (closing): behind the focused image, this much smaller, unseen. */
const TUCKED = 0.7;
/** Kept clear round the ring: the header band at the top and the info bar at the bottom, px. */
const INSET = 72;

/** The canvas's ease (ZOOM_EASE): it sets off gently and spends most of the move slowing into place. */
const ease = cubicBezier(...ZOOM_EASE);

interface Card {
  el: HTMLDivElement;
  image: number;
}

/**
 * The project view: every image of the focused image's project, together, evenly round a ring
 * (ring.ts), overlapping, over the dimmed canvas, with the project's name at its centre.
 *
 * Opening, the focused image itself moves from where it is drawn into its place at the front
 * of the ring, and the others fan out from behind it, one after another round the ring, coming
 * into view as they go. Closing, they fold back behind it as it returns to where it was. Every
 * move is a tween from wherever things are drawn at that moment, so a change of mind mid-way
 * turns it round from there, never jumping. Images are drawn with transforms only.
 */
export class ProjectView {
  readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private cards: Card[] = [];
  private timeline: gsap.core.Timeline | null = null;
  /** Open, or opening. */
  open = false;
  /** Set while the overlay holds cards: open, opening or closing. */
  get shown(): boolean {
    return this.cards.length > 0;
  }
  /** Called when a click asks it to close. */
  onDismiss: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly images: readonly ClientImage[],
    /** A tile's corner radius per px of its short edge. */
    private readonly radius: () => number,
    private readonly reducedMotion: () => boolean,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'project-view';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'false');
    this.el.hidden = true;
    this.title = document.createElement('div');
    this.title.className = 'project-view-title';
    this.el.append(this.title);
    this.el.addEventListener('click', () => this.onDismiss?.());
    parent.append(this.el);
  }

  /**
   * Bring in `members` (image indices, the focused one first) round the ring, the first
   * from `from`, where the focused image is drawn now. `name` heads it.
   */
  show(name: string, members: readonly number[], from: ScreenRect): void {
    this.open = true;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const slots = ringLayout(
      members.map((n) => this.images[n]!.aspect),
      vw,
      vh,
      INSET,
    );
    // Same project as the cards still here (closing, say): keep them and turn round from where they are.
    const same = this.cards.length === members.length && this.cards.every((c, k) => c.image === members[k]);
    if (!same) this.build(members, from, slots);
    this.el.hidden = false;
    this.el.setAttribute('aria-label', `${name}: ${members.length} images`);
    this.title.textContent = name;

    const timeline = this.restart();
    const reduced = this.reducedMotion();
    this.cards.forEach((card, k) => {
      const s = slots[k]!;
      card.el.style.zIndex = String(s.z);
      const to = { x: s.x - s.width / 2, y: s.y - s.height / 2, scale: 1, opacity: 1 };
      if (reduced) {
        gsap.set(card.el, { x: to.x, y: to.y, scale: 1, autoRound: false });
        timeline.to(card.el, { opacity: 1, duration: FADE, ease: 'none' }, 0);
      } else {
        // Round the ring both ways from the front, each a little after the one before.
        const step = Math.min(k, this.cards.length - k);
        timeline.to(card.el, { ...to, duration: OPEN, ease }, step * OPEN_STAGGER);
      }
    });
    timeline.to(this.title, { opacity: 1, y: 0, duration: reduced ? FADE : OPEN * 0.7, ease }, reduced ? 0 : OPEN * 0.3);
  }

  /** Fold them back behind the focused image as it returns to `to`; `done` once they are gone. */
  hide(to: ScreenRect, done: () => void): void {
    this.open = false;
    const timeline = this.restart(() => {
      this.clear();
      done();
    });
    const reduced = this.reducedMotion();
    timeline.to(this.title, { opacity: 0, y: 6, duration: reduced ? FADE : CLOSE * 0.5, ease }, 0);
    this.cards.forEach((card, k) => {
      const w = card.el.offsetWidth;
      const h = card.el.offsetHeight;
      if (reduced) {
        // Nothing moves: they all fade, the canvas tile already back under them.
        timeline.to(card.el, { opacity: 0, duration: FADE, ease: 'none' }, 0);
        return;
      }
      if (k === 0) {
        timeline.to(card.el, { x: to.left, y: to.top, scale: to.width / w, opacity: 1, duration: CLOSE, ease }, 0);
      } else {
        const scale = (TUCKED * to.width) / w;
        const step = this.cards.length - Math.min(k, this.cards.length - k);
        timeline.to(
          card.el,
          { x: to.left + to.width / 2 - (w * scale) / 2, y: to.top + to.height / 2 - (h * scale) / 2, scale, opacity: 0, duration: CLOSE, ease },
          step * CLOSE_STAGGER,
        );
      }
    });
  }

  /** Gone at once (leaving the canvas for the about view, say). */
  dismiss(): void {
    this.open = false;
    this.timeline?.kill();
    this.timeline = null;
    this.clear();
  }

  /** The window changed size: each image straight to its new place. */
  relayout(): void {
    if (!this.open || !this.cards.length) return;
    const slots = ringLayout(
      this.cards.map((c) => this.images[c.image]!.aspect),
      window.innerWidth,
      window.innerHeight,
      INSET,
    );
    this.timeline?.progress(1);
    this.cards.forEach((card, k) => this.size(card.el, slots[k]!.width, slots[k]!.height));
    this.cards.forEach((card, k) => gsap.set(card.el, { x: slots[k]!.x - slots[k]!.width / 2, y: slots[k]!.y - slots[k]!.height / 2, scale: 1, autoRound: false }));
  }

  /** A new timeline in place of the last, which stops where it got to. */
  private restart(onComplete?: () => void): gsap.core.Timeline {
    this.timeline?.kill();
    // Unrounded, so the focused image starts and ends exactly on its tile, which sits at fractions of a pixel.
    this.timeline = gsap.timeline({ onComplete, defaults: { autoRound: false } });
    return this.timeline;
  }

  private build(members: readonly number[], from: ScreenRect, slots: ReturnType<typeof ringLayout>): void {
    this.clear();
    this.cards = members.map((image, k) => {
      const source = this.images[image]!;
      const s = slots[k]!;
      const el = document.createElement('div');
      el.className = 'project-card';
      el.style.backgroundColor = source.color;
      this.size(el, s.width, s.height);
      const picture = document.createElement('picture');
      const avif = document.createElement('source');
      avif.type = 'image/avif';
      avif.srcset = source.avif;
      avif.sizes = `${Math.round(s.width)}px`;
      const img = document.createElement('img');
      img.alt = source.alt;
      img.srcset = source.webp;
      img.sizes = `${Math.round(s.width)}px`;
      img.src = source.src;
      img.decoding = 'async';
      img.draggable = false;
      // Over its placeholder colour until it has loaded, then in, like a tile's.
      img.dataset.loading = '';
      const reveal = () => delete img.dataset.loading;
      img.decode().then(reveal, reveal);
      picture.append(avif, img);
      el.append(picture);
      // Where it starts: the focused image exactly where it is drawn, the others tucked behind it.
      if (k === 0) {
        gsap.set(el, { x: from.left, y: from.top, scale: from.width / s.width, opacity: 1, transformOrigin: '0 0', autoRound: false });
      } else {
        const scale = (TUCKED * from.width) / s.width;
        gsap.set(el, {
          x: from.left + from.width / 2 - (s.width * scale) / 2,
          y: from.top + from.height / 2 - (s.height * scale) / 2,
          scale,
          opacity: 0,
          transformOrigin: '0 0', autoRound: false,
        });
      }
      this.el.append(el);
      return { el, image };
    });
    gsap.set(this.title, { opacity: 0, y: 6 });
  }

  /** Size a card in CSS, its corners rounded like a tile's of that size. */
  private size(el: HTMLElement, width: number, height: number): void {
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.borderRadius = `${this.radius() * Math.min(width, height)}px`;
  }

  private clear(): void {
    for (const card of this.cards) card.el.remove();
    this.cards = [];
    this.el.hidden = true;
  }
}
