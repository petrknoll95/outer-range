import { gsap } from 'gsap';
import { FLIGHT_DURATION, FLIGHT_EASE, FLIGHT_REDUCED_DURATION, LINE_HEIGHT, MENU_BACK, MENU_BACK_ABOUT, MENU_RETURN_DURATION, MENU_RETURN_EASE, PROJECT_SCROLL_TAU } from './config';
import type { FlightView } from './flight';
import { menuBackView } from './flight';
import type { ClientProject } from './projects';
import type { ClientImage } from './renderer';

/**
 * The project view: one project's images, every one of them, down one column at the centre that
 * scrolls, endlessly: the images run several times over, and the scroll is kept within one run of
 * them, moved by exactly a run's length when it leaves it (loop), so there is always more above
 * and below. It is a page of its own over the canvas (ProjectView.astro), not part of
 * it. Opening, as the menu does, the canvas backs away (main.ts, backAway: each image drawn in
 * towards the centre by its depth, dimming and blurring), all but the active image, which comes
 * forward instead, to exactly where the column has it (fly), as the view fades in, a single
 * opacity, and the rest of the column comes in from in front of the camera, big and soft,
 * settling sharp, as the menu's square does (moveStage). Closing, as the menu does too, the
 * column flies on past the camera, bigger and softer, as the view fades and the canvas comes home.
 *
 * Its images come from the same srcsets as the tiles, asked for at the column's width (sizes),
 * each as it nears the window. It opens with the image it was opened on at the centre of the window, and fades in
 * only once the images in view have decoded (or DECODE_WAIT has passed): an image arriving
 * mid-fade would cost frames, and it would fade in with colour, not images. So the canvas
 * readies the active image's project while it is idle (prepare), and "P" opens straight away.
 * Videos play while on screen, once it has covered the window and until it closes. A click on
 * an image picks it (onPick): the canvas comes back focused on it. Faded right out, it says so
 * (onHidden), once nothing flies either.
 *
 * Over the fading view, the image is a copy, laid out once at the larger of its two sizes from
 * whichever end has it decoded at that size, and moved and scaled by a transform, so it runs on
 * the compositor, on the time and ease of the canvas's leg (main.ts hands them over). The tile and
 * the column's image are hidden while it moves. Turned round mid-way, it sets off back from
 * wherever it has got to.
 */
export class ProjectView {
  /** The project showing, or null. */
  project: ClientProject | null = null;
  private readonly list: HTMLElement;
  /** The box the column scrolls in, the window's size. */
  private readonly scroller: HTMLElement;
  /**
   * Its scroll, eased after the wheel on GSAP's ticker, as the about view's is (main.ts,
   * ScrollSmoother, of which a page has only one): where the column is drawn, and where the
   * wheel has asked for, and whether it is on its way there.
   */
  private scrollAt = 0;
  private scrollGoal = 0;
  private easing = false;
  private readonly videos = new Set<HTMLVideoElement>();
  /** Which opening is current, so a slow decode from an earlier one doesn't start a fade. */
  private opening = 0;
  /** Closed, but still fading out. */
  private fading = false;
  /** Faded right out after closing. */
  onHidden: () => void = () => {};
  /** The stage: the column, which comes in from in front of the camera and goes past it, and its move under way. */
  private readonly stage: HTMLElement;
  private stageMove: Animation | null = null;
  /** All of it, which backs away under the menu or the project's info (backAway), and its move under way. */
  private readonly depth: HTMLElement;
  private depthMove: Animation | null = null;
  /** Closed, until the canvas is home. */
  private homing = 0;
  /** The image in flight: its copy and the copy's animation, and the two ends, hidden meanwhile. */
  private flight: { copy: HTMLElement; animation: Animation; ends: HTMLElement[] } | null = null;
  /** Where the tile it opened on is drawn with the canvas at home: where closing takes it back to. */
  private home: DOMRect | null = null;
  /** How wide the column draws its images (setColumn), for their srcsets: all of the window on a phone. */
  private sizes = '(min-width: 760px) 58vw, 100vw';
  private readonly onScreen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        video.dataset.visible = entry.isIntersecting ? 'true' : '';
        this.sync(video);
      }
    },
    { rootMargin: '25% 0px' },
  );

  constructor(
    private readonly el: HTMLElement,
    private readonly images: readonly ClientImage[],
    private readonly onPick: (image: number) => void,
  ) {
    this.list = el.querySelector('[data-project-images]')!;
    this.scroller = el.querySelector('[data-project-scroll]')!;
    this.stage = el.querySelector('[data-project-stage]')!;
    this.depth = el.querySelector('[data-project-depth]')!;
    this.list.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('[data-image]');
      if (!item || !this.isOpen) return;
      this.onPick(Number(item.dataset.image));
    });
    this.scroller.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // Any other scroll (touch, keys, scrollTo) is the browser's own, as on the about view: taken as it is.
    this.scroller.addEventListener(
      'scroll',
      () => {
        if (this.easing) return;
        this.loop();
        this.scrollAt = this.scrollGoal = this.scroller.scrollTop;
      },
      { passive: true },
    );
    el.addEventListener('transitionend', (e) => {
      if (e.target !== el || e.propertyName !== 'opacity') return;
      // Covered: its videos start.
      if (this.isOpen) {
        document.documentElement.dataset.project = 'covered';
        for (const video of this.videos) this.sync(video);
      } else if (this.fading) {
        this.fading = false;
        this.settle();
      }
    });
  }

  /** From the moment it is asked to open until it is asked to close. */
  get isOpen(): boolean {
    return this.project !== null;
  }

  /** Open, or still fading out, an image still flying or the canvas not home yet: over the canvas, or moving with it. */
  get isShown(): boolean {
    return this.isOpen || this.fading || this.flight !== null || this.homing !== 0;
  }

  /** The column's width on a wide window, px (main.ts, PROJECT_COLUMN): its images are asked for at it. */
  setColumn(width: number): void {
    this.el.style.setProperty('--project-column', `${width.toFixed(1)}px`);
    this.sizes = `(min-width: 760px) ${Math.round(width)}px, 100vw`;
    for (const el of this.list.querySelectorAll<HTMLImageElement | HTMLSourceElement>('img, source')) el.sizes = this.sizes;
  }

  /** Get `project` ready to open on `image` before it is asked for: built, scrolled there, and the images in view decoded. */
  prepare(project: ClientProject, image: number): void {
    if (this.isShown) return;
    this.build(project);
    void this.decodeInView(this.scrollTo(image));
  }

  /**
   * Show `project`, scrolled to `image`, one of its images, flying it there from `tile`, its tile
   * on the canvas, as the canvas backs away: `start` sets that off when the view starts to fade
   * in, and says on what time and ease.
   */
  open(project: ClientProject, image: number, tile: HTMLElement | null, start: () => Leg): void {
    this.project = project;
    this.fading = false;
    this.build(project);
    this.el.inert = false;
    const item = this.scrollTo(image);
    this.scroller.focus({ preventScroll: true });
    const opening = ++this.opening;
    void Promise.race([this.decodeInView(item), new Promise((resolve) => setTimeout(resolve, DECODE_WAIT))]).then(() => {
      if (opening !== this.opening || !this.isOpen) return;
      this.el.dataset.open = '';
      // Where the tile is drawn now, at home, before the canvas sets off.
      if (!this.flight && tile) this.home = tile.getBoundingClientRect();
      const leg = start();
      // Where the column has it once it is still, before the stage sets off.
      if (tile && item) this.fly(tile, item, image, this.flight ? null : this.home, item.getBoundingClientRect(), leg);
      this.moveStage(HERE, leg.duration, leg.easing, this.stageMove ? null : FAR);
    });
  }

  /**
   * Fade back to the canvas as it comes home over `leg` (or none: at once, nothing moves), the
   * column flying on past the camera, as the menu's square does.
   */
  close(leg: Leg | null): void {
    if (!this.project) return;
    this.project = null;
    this.opening++;
    delete document.documentElement.dataset.project;
    // Closed under the menu (going to the about view from it), it is home again for next time.
    this.depthMove?.cancel();
    this.depthMove = null;
    // (Asked to close before it began to fade in, there is nothing to fade out.)
    const shown = 'open' in this.el.dataset;
    delete this.el.dataset.open;
    this.el.inert = true;
    for (const video of this.videos) this.sync(video);
    this.fading = shown;
    // An image still on its way in shows in its place: the column goes as one.
    this.land();
    clearTimeout(this.homing);
    this.homing = 0;
    if (shown && leg) {
      this.moveStage(FAR, LEAVE_DURATION, LEAVE_EASE);
      this.homing = window.setTimeout(() => {
        this.homing = 0;
        this.settle();
      }, leg.duration * 1000);
    }
    this.settle();
  }

  /**
   * Back all of it away from the camera (`away`) under the menu or the project's info, as the
   * canvas backs away under the menu (main.ts, backAway), or bring it home. It is a page, as the
   * about view's text is, so it backs away as that does, as one plane at MENU_BACK_ABOUT
   * (menuBackView): drawn in towards the centre, dimming and blurring. Away on the flight's time
   * and ease, home on the menu's slower return, from wherever it has got to; home, it is let go
   * of, so nothing stays scaled or blurred. With reduced motion it only dims.
   */
  backAway(away: boolean): void {
    if (!this.isOpen && away) return;
    const still = reducedMotion.matches;
    const view = menuBackView(MENU_BACK_ABOUT, away ? MENU_BACK : 0, { scale: 1, opacity: 1, blur: 0 } as FlightView);
    // The blur is drawn before the scale: ask for the share that comes out at view.blur on screen.
    const to: Keyframe = still
      ? { opacity: view.opacity }
      : { transform: `scale(${view.scale})`, opacity: view.opacity, filter: `blur(${(view.blur / view.scale).toFixed(2)}px)` };
    const css = getComputedStyle(this.depth);
    const from: Keyframe = still
      ? { opacity: Number(css.opacity) }
      : { transform: css.transform === 'none' ? 'scale(1)' : css.transform, opacity: Number(css.opacity), filter: css.filter === 'none' ? 'blur(0px)' : css.filter };
    const duration = still ? FLIGHT_REDUCED_DURATION : away ? FLIGHT_DURATION : MENU_RETURN_DURATION;
    const easing = `cubic-bezier(${(away ? FLIGHT_EASE : MENU_RETURN_EASE).join(', ')})`;
    this.depthMove?.cancel();
    const move = this.depth.animate([from, to], { duration: duration * 1000, easing, fill: 'forwards' });
    this.depthMove = move;
    move.onfinish = () => {
      if (this.depthMove !== move || away) return;
      move.cancel();
      this.depthMove = null;
    };
  }

  /**
   * Move the stage to `to` (HERE or FAR), from `from` or from wherever it has got to, over
   * `duration` s on `easing`; there, it is let go of (HERE is the stage at rest, and FAR is only
   * ever reached faded out), so nothing stays blurred or scaled that need not be.
   */
  private moveStage(to: Keyframe, duration: number, easing: string, from: Keyframe | null = null): void {
    if (reducedMotion.matches || duration <= 0) {
      this.stageMove?.cancel();
      this.stageMove = null;
      return;
    }
    if (!from) {
      const css = getComputedStyle(this.stage);
      from = { transform: css.transform === 'none' ? 'scale(1)' : css.transform, filter: css.filter === 'none' ? 'blur(0px)' : css.filter };
    }
    this.stageMove?.cancel();
    const move = this.stage.animate([from, to], { duration: duration * 1000, easing, fill: 'forwards' });
    this.stageMove = move;
    move.onfinish = () => {
      if (this.stageMove !== move) return;
      move.cancel();
      this.stageMove = null;
    };
  }

  /**
   * Fly a copy of `image` from `start` (or, with none, where the copy in flight has got to, or
   * where `from` is drawn) to `end`, where `to` is drawn once all is still, over `leg`; then `done`.
   */
  private fly(from: HTMLElement, to: HTMLElement, image: number, start: DOMRect | null, end: DOMRect, leg: Leg, done: () => void = () => {}): void {
    start = this.flight ? this.flight.copy.getBoundingClientRect() : (start ?? from.getBoundingClientRect());
    this.land();
    if (reducedMotion.matches || !start.width || !end.width || leg.duration <= 0) return done();
    // Laid out at the larger size, from the end that has it decoded at that size (or the other, if that one hasn't loaded).
    const big = start.width >= end.width ? start : end;
    const [near, other] = start.width >= end.width ? [from, to] : [to, from];
    const src = near.querySelector('img')?.currentSrc || other.querySelector('img')?.currentSrc;
    const copy = document.createElement('div');
    copy.className = 'project-flight';
    copy.style.width = `${big.width}px`;
    copy.style.height = `${big.height}px`;
    copy.style.backgroundColor = this.images[image]!.color;
    if (src) {
      const img = document.createElement('img');
      img.decoding = 'sync';
      img.alt = '';
      img.src = src;
      copy.append(img);
    }
    document.body.append(copy);
    from.dataset.flying = '';
    to.dataset.flying = '';
    // Rounded as each end is, in the copy's own px (it is scaled by the transform).
    const at = (el: HTMLElement, r: DOMRect) => ({
      transform: `translate(${r.left}px, ${r.top}px) scale(${r.width / big.width})`,
      borderRadius: `${(radiusOf(el, r) * big.width) / r.width}px`,
    });
    const animation = copy.animate([at(from, start), at(to, end)], { duration: leg.duration * 1000, easing: leg.easing, fill: 'forwards' });
    this.flight = { copy, animation, ends: [from, to] };
    animation.onfinish = () => {
      if (this.flight?.animation !== animation) return;
      this.land();
      done();
      this.settle();
    };
  }

  /** End the flight, if any, where it is: the copy goes and both ends show again. */
  private land(): void {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    flight.copy.remove();
    for (const el of flight.ends) delete el.dataset.flying;
  }

  /** Closed, faded right out and nothing flying: say so. */
  private settle(): void {
    if (!this.isShown) this.onHidden();
  }

  /** The wheel asks for the column `deltaY` further on: it eases there (ease). Zooming the page is left to the browser. */
  private wheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.scroller.clientHeight : 1;
    this.scrollGoal += e.deltaY * unit;
    if (this.easing) return;
    this.easing = true;
    this.scrollAt = this.scroller.scrollTop;
    gsap.ticker.add(this.ease);
  }

  /** One frame of the column easing after the wheel (PROJECT_SCROLL_TAU), kept within one run as it goes (loop). */
  private readonly ease = (_time: number, deltaMs: number): void => {
    // (The first frame's delta runs from whenever the ticker last ran: no more than a slow frame's.)
    const k = reducedMotion.matches ? 1 : 1 - Math.exp(-Math.min(deltaMs, 34) / 1000 / PROJECT_SCROLL_TAU);
    this.scrollAt += (this.scrollGoal - this.scrollAt) * k;
    if (Math.abs(this.scrollGoal - this.scrollAt) < 0.5) this.scrollAt = this.scrollGoal;
    this.scroller.scrollTop = this.scrollAt;
    // Moved on by whole runs at an end: the goal moves with it.
    const before = this.scroller.scrollTop;
    this.loop();
    const shift = this.scroller.scrollTop - before;
    this.scrollAt += shift;
    this.scrollGoal += shift;
    if (this.scrollAt === this.scrollGoal) this.stopEasing();
  };

  private stopEasing(): void {
    if (!this.easing) return;
    this.easing = false;
    gsap.ticker.remove(this.ease);
  }

  /** Scroll so `image` is at the centre of the window (laid out, though maybe not seen), and return the item showing it there. */
  private scrollTo(image: number): HTMLElement | null {
    const item = this.list.querySelector<HTMLElement>(`[data-run="1"] [data-image="${image}"]`);
    if (!item) return null;
    this.stopEasing();
    const r = item.getBoundingClientRect();
    const view = this.scroller.getBoundingClientRect();
    this.scroller.scrollTop += r.top + r.height / 2 - (view.top + view.height / 2);
    this.loop();
    return this.nearest(image);
  }

  /** Of the items showing `image`, the one nearest the centre of the window. */
  private nearest(image: number): HTMLElement | null {
    const view = this.scroller.getBoundingClientRect();
    const middle = view.top + view.height / 2;
    const off = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return Math.abs(r.top + r.height / 2 - middle);
    };
    let best: HTMLElement | null = null;
    for (const el of this.list.querySelectorAll<HTMLElement>(`[data-image="${image}"]`)) if (!best || off(el) < off(best)) best = el;
    return best;
  }

  /** The length of one run of the images, px: from the first of one run to the first of the next. */
  private period(): number {
    const first = this.list.firstElementChild as HTMLElement | null;
    const next = this.list.querySelector<HTMLElement>('[data-run="1"]');
    return first && next ? next.offsetTop - first.offsetTop : 0;
  }

  /** Keep the scroll within the second run: left by one end, moved on by whole runs, which look the same. */
  private loop(): void {
    const period = this.period();
    if (period <= 0) return;
    const at = this.scroller.scrollTop - (this.list.firstElementChild as HTMLElement).offsetTop;
    if (at < period) this.scroller.scrollTop += period * Math.ceil((period - at) / period);
    else if (at >= 2 * period) this.scroller.scrollTop -= period * Math.floor((at - period) / period);
  }

  /**
   * Load and decode the images in view, from `item` on. (The rest load lazily as they near the
   * window, which, hidden, it never does: so these are asked for now.)
   */
  private decodeInView(item: HTMLElement | null): Promise<unknown> {
    const bottom = this.scroller.getBoundingClientRect().bottom;
    const imgs = [...this.list.querySelectorAll<HTMLElement>('[data-image]')]
      .filter((el) => el === item || (el.getBoundingClientRect().top < bottom && el.getBoundingClientRect().bottom > 0))
      .map((el) => el.querySelector('img')!);
    return Promise.all(
      imgs.map((img) => {
        img.loading = 'eager';
        return img.decode().catch(() => {});
      }),
    );
  }

  private build(project: ClientProject): void {
    if (this.list.dataset.project === project.id) return;
    this.list.dataset.project = project.id;
    for (const video of this.videos) this.onScreen.unobserve(video);
    this.videos.clear();
    this.el.setAttribute('aria-label', project.title);
    const run = (k: number) => project.images.map((n) => this.item(n, k));
    this.list.replaceChildren(...run(0), ...run(1));
    // As many runs as keep a window's height of them below the second run, wherever in it the scroll is.
    const period = this.period();
    const runs = period > 0 ? Math.max(3, 3 + Math.ceil(this.scroller.clientHeight / period)) : 3;
    for (let k = 2; k < runs; k++) this.list.append(...run(k));
  }

  /** The item showing image `n`, in run `k` (only the first run is read out: the rest repeat it). */
  private item(n: number, k: number): HTMLElement {
    const image = this.images[n]!;
    const li = document.createElement('li');
    li.dataset.run = String(k);
    if (k > 0) li.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.image = String(n);
    button.className = 'project-image';
    button.style.setProperty('--ratio', String(image.ratio));
    button.style.backgroundColor = image.color;
    button.setAttribute('aria-label', `${image.title}: show it on the canvas`);
    if (k > 0) button.tabIndex = -1;
    const picture = document.createElement('picture');
    const avif = document.createElement('source');
    avif.type = 'image/avif';
    avif.srcset = image.avif;
    avif.sizes = this.sizes;
    const img = document.createElement('img');
    img.srcset = image.webp;
    img.sizes = this.sizes;
    img.src = image.src;
    img.alt = image.alt;
    img.decoding = 'async';
    img.loading = 'lazy';
    img.draggable = false;
    picture.append(avif, img);
    button.append(picture);
    if (image.video) {
      const video = document.createElement('video');
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'none';
      video.setAttribute('aria-hidden', 'true');
      for (const [src, type] of [
        [image.video.webm, 'video/webm; codecs="vp9"'],
        [image.video.mp4, 'video/mp4'],
      ] as const) {
        const source = document.createElement('source');
        source.src = src;
        source.type = type;
        video.append(source);
      }
      // Over its poster image until it has a frame to show.
      video.addEventListener('playing', () => (video.dataset.playing = ''), { once: true });
      button.append(video);
      this.videos.add(video);
      this.onScreen.observe(video);
    }
    li.append(button);
    return li;
  }

  /** A video plays while it is on screen and the view is open and has covered the window (starting one mid-fade costs frames), and holds still otherwise. */
  private sync(video: HTMLVideoElement): void {
    const play = this.isOpen && document.documentElement.dataset.project === 'covered' && video.dataset.visible === 'true' && !reducedMotion.matches;
    if (play && video.paused) {
      video.preload = 'auto';
      video.play().catch(() => {});
    } else if (!play && !video.paused) {
      video.pause();
    }
  }
}

/** The time (s) and ease of a leg of the canvas backing away or coming home, which the image flies on too. */
export interface Leg {
  duration: number;
  easing: string;
}

/** The stage at rest, and far off in front of the camera, big and soft (the menu's square: Menu.astro). */
const HERE: Keyframe = { transform: 'scale(1)', filter: 'blur(0px)' };
const FAR: Keyframe = { transform: 'scale(1.4)', filter: 'blur(12px)' };
/** Leaving, it lingers a moment, then speeds off past the camera, as the menu's square does, s. */
const LEAVE_DURATION = 0.55;
const LEAVE_EASE = 'cubic-bezier(0.5, 0, 0.75, 0.6)';

/** An element's corner radius as drawn at `rect` (a tile is scaled by its transform), px. */
const radiusOf = (el: HTMLElement, rect: DOMRect) => (parseFloat(getComputedStyle(el).borderRadius) || 0) * (rect.width / (el.offsetWidth || rect.width));

/** How long it waits for the images in view to decode before fading in anyway, ms. */
const DECODE_WAIT = 300;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
