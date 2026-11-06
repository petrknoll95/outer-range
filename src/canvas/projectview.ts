import type { GlassTile } from './glass';
import { GlassLayer } from './glass';
import type { ClientProject } from './projects';
import type { ClientImage } from './renderer';

/**
 * The project view: one project's images, every one of them, down one column at the centre that
 * scrolls, endlessly: the images run several times over, and the scroll is kept within one run of
 * them, moved by exactly a run's length when it leaves it (loop), so there is always more above
 * and below. It is a page of its own over the canvas (ProjectView.astro), not part of
 * it. Opening, as the menu does, the canvas backs away (main.ts, backAway: each image drawn in
 * towards the centre by its depth, dimming and blurring), all but the active image, which comes
 * forward instead, to exactly where the column has it, as the view fades in around it, a single
 * opacity. Closing, the image goes back to its tile as the canvas comes home and the view fades
 * out (fly).
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
  /** The box the column scrolls in, the window's size: what the glass cuts its bands out of. */
  private readonly scroller: HTMLElement;
  /** Its glass edges (glass.ts), or none where they can't be drawn. */
  private readonly glass: GlassLayer | null;
  private readonly videos = new Set<HTMLVideoElement>();
  /** Which opening is current, so a slow decode from an earlier one doesn't start a fade. */
  private opening = 0;
  /** Closed, but still fading out. */
  private fading = false;
  /** Faded right out after closing. */
  onHidden: () => void = () => {};
  /** The image in flight: its copy and the copy's animation, and the two ends, hidden meanwhile. */
  private flight: { copy: HTMLElement; animation: Animation; ends: HTMLElement[] } | null = null;
  /** Where the tile it opened on is drawn with the canvas at home: where closing takes it back to. */
  private home: DOMRect | null = null;
  /** How wide the column draws its images (setColumn), for their srcsets: all of the window on a phone. */
  private sizes = '(min-width: 760px) 58vw, 100vw';
  /** The image last clicked, which closing flies back from. */
  private picked: HTMLElement | null = null;
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
    /** Glass even on a software renderer (`?glass`, for tests). */
    glassAnyway = false,
  ) {
    this.list = el.querySelector('[data-project-images]')!;
    this.scroller = el.querySelector('[data-project-scroll]')!;
    // Its canvas goes just before the scroller, inside the view: over its background, fading with it.
    this.glass = GlassLayer.create(this.scroller, this.scroller, null, glassAnyway, () => this.glassFrame(), () => false);
    this.list.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('[data-image]');
      if (!item || !this.isOpen) return;
      this.picked = item;
      this.onPick(Number(item.dataset.image));
    });
    this.scroller.addEventListener(
      'scroll',
      () => {
        this.loop();
        this.glass?.request();
      },
      { passive: true },
    );
    addEventListener('resize', () => this.glass?.request());
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

  /** Open, or still fading out or an image still flying: over the canvas, in part at least. */
  get isShown(): boolean {
    return this.isOpen || this.fading || this.flight !== null;
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
    void this.decodeInView(this.scrollTo(image)).then(() => this.glass?.request());
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
      this.glass?.request();
      // Where the tile is drawn now, at home, before the canvas sets off.
      if (!this.flight && tile) this.home = tile.getBoundingClientRect();
      const leg = start();
      if (tile && item) this.fly(tile, item, image, this.flight ? null : this.home, item.getBoundingClientRect(), leg);
    });
  }

  /**
   * Fade back to the canvas, flying `image` (if it is one of the project's) from the column to
   * `tile`, its tile on the canvas, drawn at home at `to` (or, with none, where the tile it opened
   * on was), on the time and ease of the canvas coming home (`leg`, or none: nothing flies);
   * `landed` once it is there (at once, if nothing flies).
   */
  close(image: number | null, tile: HTMLElement | null, to: DOMRect | null, leg: Leg | null, landed: () => void = () => {}): void {
    if (!this.project) return landed();
    this.project = null;
    this.opening++;
    delete document.documentElement.dataset.project;
    // (Asked to close before it began to fade in, there is nothing to fade out.)
    const shown = 'open' in this.el.dataset;
    delete this.el.dataset.open;
    this.el.inert = true;
    for (const video of this.videos) this.sync(video);
    this.fading = shown;
    // The one picked, or else the one of that image nearest the centre of the window.
    const item = image === null ? null : this.picked?.dataset.image === String(image) ? this.picked : this.nearest(image);
    this.picked = null;
    const end = to ?? this.home;
    if (shown && item && tile && end && leg) this.fly(item, tile, image!, null, end, leg, landed);
    else {
      this.land();
      landed();
    }
    this.settle();
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
    this.glass?.request();
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
    this.glass?.request();
  }

  /**
   * What the glass draws: the column's images in or near the window, as the page draws them (the
   * video once it plays, over the image once that is in, over the colour grid), but not the one an
   * image is flying to or from, which isn't seen yet.
   */
  private glassFrame(): { tiles: GlassTile[]; vw: number; vh: number; scale: number } {
    const vw = this.scroller.clientWidth;
    const vh = this.scroller.clientHeight;
    const tiles: GlassTile[] = [];
    let radius = -1;
    for (const item of this.list.querySelectorAll<HTMLElement>('[data-image]')) {
      if ('flying' in item.dataset) continue;
      const r = item.getBoundingClientRect();
      if (r.bottom < -vh / 2 || r.top > vh * 1.5) continue;
      if (radius < 0) radius = parseFloat(getComputedStyle(item).borderRadius) || 0;
      const image = this.images[Number(item.dataset.image)]!;
      const img = item.querySelector('img')!;
      const video = item.querySelector('video');
      const loaded = img.complete && img.naturalWidth > 0;
      const playing = video !== null && 'playing' in video.dataset && !video.paused;
      tiles.push({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        radius,
        opacity: 1,
        blur: 0,
        source: playing ? video : loaded ? img : null,
        pixels: image.pixels,
        grid: image.grid,
        live: !loaded || playing,
      });
    }
    return { tiles, vw, vh, scale: 1 };
  }

  /** Closed, faded right out and nothing flying: say so. */
  private settle(): void {
    if (!this.isShown) this.onHidden();
  }

  /** Scroll so `image` is at the centre of the window (laid out, though maybe not seen), and return the item showing it there. */
  private scrollTo(image: number): HTMLElement | null {
    const item = this.list.querySelector<HTMLElement>(`[data-run="1"] [data-image="${image}"]`);
    if (!item) return null;
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

/** An element's corner radius as drawn at `rect` (a tile is scaled by its transform), px. */
const radiusOf = (el: HTMLElement, rect: DOMRect) => (parseFloat(getComputedStyle(el).borderRadius) || 0) * (rect.width / (el.offsetWidth || rect.width));

/** How long it waits for the images in view to decode before fading in anyway, ms. */
const DECODE_WAIT = 300;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
