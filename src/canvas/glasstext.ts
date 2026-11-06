/**
 * The about text as the glass edges see it (glass.ts). Text is elements too, so the glass draws
 * what of it passes under the bands again itself: each word in its own font, size and colour, at
 * exactly where the browser set it. The places are measured once (again when the text reflows or
 * a font comes in), in the text layer's own px; each frame they are drawn wherever the layer is
 * now, scrolled, scaled and faded on the flight, blurred where the 2D canvas can blur.
 */

/** A word (or, broken across lines, a letter) where the layer sets it unscaled, px. */
interface Word {
  text: string;
  left: number;
  top: number;
  bottom: number;
  baseline: number;
  font: string;
  spacing: string;
  /** Whose colour it takes. */
  el: Element;
}

export class GlassText {
  private words: Word[] = [];
  private dirty = true;
  /** The view's mask as last set (see clip). */
  private mask = '';
  private readonly metrics = new Map<string, { ascent: number; descent: number }>();
  /** Called when what it draws changes without the layer moving: it reflowed, or a font came in. */
  onChange: (() => void) | null = null;

  /** The text in `layer` (drawn over by the page as it pleases), clipped in `view` (unmoved, the window's size). */
  constructor(
    private readonly layer: HTMLElement,
    private readonly view: HTMLElement,
  ) {
    const changed = () => {
      this.dirty = true;
      this.onChange?.();
    };
    new ResizeObserver(changed).observe(layer);
    document.fonts.addEventListener('loadingdone', changed);
  }

  /** Mask the bands, `band` px each, out of the view, fading out over the glass's copy through `feather` px before each, as the tiles do (glass.ts, clip); or (0) nothing. */
  clip(band: number, feather: number): void {
    const mask = band > 0 ? `linear-gradient(to bottom, transparent ${band}px, black ${band + feather}px, black calc(100% - ${band + feather}px), transparent calc(100% - ${band}px))` : '';
    if (mask === this.mask) return;
    this.mask = mask;
    this.view.style.setProperty('-webkit-mask-image', mask);
    this.view.style.maskImage = mask;
  }

  private measure(ctx: CanvasRenderingContext2D): void {
    this.dirty = false;
    this.words = [];
    const layer = this.layer;
    // Unscaled: set apart from the flight's scale for the moment.
    const transform = layer.style.transform;
    layer.style.transform = '';
    const origin = layer.getBoundingClientRect();
    const range = document.createRange();
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const styles = new Map<Element, CSSStyleDeclaration>();
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const el = node.parentElement;
      if (!el || !node.data.trim()) continue;
      let style = styles.get(el);
      if (!style) styles.set(el, (style = getComputedStyle(el)));
      if (style.visibility !== 'visible') continue;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const shown = style.textTransform === 'uppercase' ? node.data.toUpperCase() : style.textTransform === 'lowercase' ? node.data.toLowerCase() : node.data;
      for (const match of node.data.matchAll(/\S+/g)) {
        const start = match.index;
        range.setStart(node, start);
        range.setEnd(node, start + match[0].length);
        const rects = range.getClientRects();
        if (rects.length === 0) continue;
        // Broken across lines, letter by letter.
        const pieces =
          rects.length === 1
            ? [{ text: shown.slice(start, start + match[0].length), rect: rects[0]! }]
            : [...match[0]].map((_, n) => {
                range.setStart(node!, start + n);
                range.setEnd(node!, start + n + 1);
                return { text: shown[start + n]!, rect: range.getBoundingClientRect() };
              });
        const m = this.fontMetrics(ctx, font);
        for (const { text, rect } of pieces) {
          if (rect.width === 0) continue;
          const top = rect.top - origin.top;
          // The browser's line box holds the font's ascent and descent: centred in it, the baseline is the ascent down.
          const baseline = top + (rect.height - (m.ascent + m.descent)) / 2 + m.ascent;
          this.words.push({ text, left: rect.left - origin.left, top, bottom: top + rect.height, baseline, font, spacing, el });
        }
      }
    }
    layer.style.transform = transform;
  }

  private fontMetrics(ctx: CanvasRenderingContext2D, font: string): { ascent: number; descent: number } {
    let m = this.metrics.get(font);
    if (!m) {
      ctx.font = font;
      const t = ctx.measureText('Hg');
      m = { ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent };
      this.metrics.set(font, m);
    }
    return m;
  }

  /**
   * Draw the words in each of `regions` (device px rows of the screen, top to bottom) into `ctx`,
   * one under another from its top, `ratio` device px a px: whether any was drawn.
   */
  draw(ctx: CanvasRenderingContext2D, ratio: number, regions: readonly (readonly [number, number])[]): boolean {
    const layer = this.layer;
    const opacity = Number(getComputedStyle(layer).opacity);
    if (opacity < 0.004 || layer.offsetWidth === 0) return false;
    if (this.dirty) {
      // A font that came in changes how its text measures.
      this.metrics.clear();
      this.measure(ctx);
    }
    const r = layer.getBoundingClientRect();
    const scale = r.width / layer.offsetWidth;
    const blur = Number(/blur\(([\d.]+)px\)/.exec(layer.style.filter)?.[1] ?? 0) * scale * ratio;
    const colours = new Map<Element, string>();
    let drew = false;
    let at = 0;
    ctx.save();
    for (const [top, bottom] of regions) {
      const from = top / ratio;
      const to = bottom / ratio;
      // Each region kept to its own rows: a glyph across its edge mustn't reach into the next.
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, at, ctx.canvas.width, bottom - top);
      ctx.clip();
      ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * r.left, ratio * r.top - top + at);
      ctx.globalAlpha = opacity;
      ctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      ctx.textBaseline = 'alphabetic';
      for (const w of this.words) {
        if (r.top + w.bottom * scale < from || r.top + w.top * scale > to) continue;
        let colour = colours.get(w.el);
        if (!colour) colours.set(w.el, (colour = getComputedStyle(w.el).color));
        ctx.font = w.font;
        ctx.letterSpacing = w.spacing;
        ctx.fillStyle = colour;
        ctx.fillText(w.text, w.left, w.baseline);
        drew = true;
      }
      at += bottom - top;
    }
    ctx.restore();
    return drew;
  }
}
