import logo from '../assets/logo.svg?raw';
import { INTRO_LOGO, INTRO_TAGLINE, INTRO_TAGLINE_TEXT } from './config';
import type { IntroZoom } from './intro';
import { introZoom, introZoomEnd } from './intro';

/**
 * What the intro says, flying at the camera down the middle of the tunnel, one after the other
 * (introZoom): the studio logo (src/assets/logo.svg), then the tagline, set like the wordmark.
 * Each comes out of the far end, slows to a drift about its own size to be read, and rushes
 * past. It is decoration: the page says the same to a screen reader. Both are solid ink, so the
 * lines behind them can't eat into them. Only a transform and opacity change, so it costs next
 * to nothing to draw.
 */
const CLASS = 'pointer-events-none absolute inset-0 flex items-center justify-center select-none';
/** The wordmark's type, which the logo is sized by too. */
const TYPE = 'text-xl leading-none font-medium tracking-[-0.02em] text-ink min-[760px]:text-2xl';
/** The logo's width, in em of the wordmark's size: 276 px wide on a wide screen, 230 px on a phone. */
const LOGO_WIDTH = 11.5;

export class IntroTitle {
  private readonly el = document.createElement('div');
  private readonly end: number;
  private readonly at = { scale: 0, opacity: 0 };

  private constructor(
    parent: HTMLElement,
    private readonly content: HTMLElement,
    private readonly zoom: IntroZoom,
    zIndex: number,
    name: 'introLogo' | 'introTagline',
  ) {
    this.el.className = CLASS;
    this.el.dataset[name] = '';
    this.el.style.zIndex = String(zIndex);
    this.el.setAttribute('aria-hidden', 'true');
    content.classList.add('will-change-[transform,opacity]');
    this.el.append(content);
    parent.append(this.el);
    this.end = introZoomEnd(zoom);
  }

  /** The logo. */
  static logo(parent: HTMLElement, zIndex: number): IntroTitle {
    const content = document.createElement('span');
    content.className = `${TYPE} block`;
    content.style.width = `${LOGO_WIDTH}em`;
    // Its own file, drawn in the ink.
    content.innerHTML = logo.replace(/black/g, 'currentColor').replace(/ width="\d+" height="\d+"/, ' class="block h-auto w-full"');
    return new IntroTitle(parent, content, INTRO_LOGO, zIndex, 'introLogo');
  }

  /** The tagline, after it. */
  static tagline(parent: HTMLElement, zIndex: number): IntroTitle {
    const content = document.createElement('span');
    content.className = `${TYPE} whitespace-pre`;
    content.textContent = INTRO_TAGLINE_TEXT;
    return new IntroTitle(parent, content, INTRO_TAGLINE, zIndex, 'introTagline');
  }

  draw(t: number): void {
    if (t > this.end) return this.remove();
    const { scale, opacity } = introZoom(t, this.zoom, this.at);
    this.content.style.transform = `scale(${scale.toFixed(4)})`;
    this.content.style.opacity = opacity.toFixed(3);
  }

  remove(): void {
    this.el.remove();
  }
}
