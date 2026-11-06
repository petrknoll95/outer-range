import { GLASS_BAND, GLASS_CURVE, GLASS_DISPERSION, GLASS_DPR, GLASS_FEATHER, GLASS_STRENGTH } from './config';
import type { GlassText } from './glasstext';
import { program, software } from './introlayer';
import { pixelColor } from './pixels';

/**
 * The glass edges: the top and bottom GLASS_BAND of the window, seen as through the edge of a
 * lens, on the canvas and the about view alike. The tiles and the about text are elements, which
 * no shader can see, so the bands are masked out of both and drawn again here, on a canvas
 * of their own just under the tile layer: the about text in or near a band (glasstext.ts), then
 * over it each tile, as it is drawn on the page (image or video, its colour grid until either is
 * in, faded and rounded alike), into a scene, then onto the canvas through the glass. Between the
 * bands the canvas is clear and the page shows as it is. Not cut at a line: the page fades out
 * over the glass's copy through a strip at each band's inner edge (GLASS_FEATHER), where nothing
 * bends yet, so the two never meet at an edge however slightly they differ.
 *
 * In a band, each row shows the scene from nearer the band's inner edge, the more so towards
 * the screen edge (a circular lens's sag, flat where it meets the page, so there is no seam),
 * and the light splits into a spectrum along the bend: red one way and blue the other, blended
 * over 16 samples rather than three hard copies.
 */

/** A tile as it is drawn on the page now, screen px. */
export interface GlassTile {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
  /** Its blur on the flight, screen px. */
  blur: number;
  /** What it shows: its image or video, or (null) its colour grid until either is in. */
  source: HTMLImageElement | HTMLVideoElement | null;
  /** Its colour grid (pixels.ts), and the grid's columns and rows. */
  pixels: string;
  grid: readonly [number, number];
  /** Whether what it shows can change while it stands still: a video playing, an image still to come in. */
  live: boolean;
}

/** Everything drawn now: the tiles bottom to top, the viewport, and the tile layer's scale about its centre (the intro's glide). */
export interface GlassFrame {
  tiles: readonly GlassTile[];
  vw: number;
  vh: number;
  scale: number;
}

const TILE_VERTEX = `#version 300 es
uniform vec4 rect; // left, top, width, height, device px
uniform vec2 view;
out vec2 local;
void main() {
  // A pixel past each side, for the antialiased edge.
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  local = corner * (rect.zw + 2.0) - 1.0;
  vec2 p = rect.xy + local;
  gl_Position = vec4(p.x / view.x * 2.0 - 1.0, 1.0 - p.y / view.y * 2.0, 0, 1);
}`;
const TILE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec4 rect;
uniform vec4 cover; // the image's window onto the tile (object-fit: cover): size, then corner
uniform float radius, opacity, bias;
in vec2 local;
out vec4 color;
void main() {
  vec2 half_ = rect.zw * 0.5;
  vec2 q = abs(local - half_) - half_ + radius;
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  vec2 uv = clamp(local / rect.zw, 0.0, 1.0) * cover.xy + cover.zw;
  vec4 c = texture(image, uv, bias);
  float a = clamp(0.5 - edge, 0.0, 1.0) * opacity * c.a;
  color = vec4(c.rgb * a, a);
}`;
const GLASS_VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0, 1);
}`;
const GLASS_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D scene;
uniform float band; // each band, a share of the height
uniform float pixel; // one device px, a share of the height
const float STRENGTH = ${GLASS_STRENGTH.toFixed(3)};
const float CURVE = ${GLASS_CURVE.toFixed(3)};
const float DISPERSION = ${GLASS_DISPERSION.toFixed(3)};
in vec2 uv; // y: 0 at the bottom of the screen, 1 at the top
out vec4 color;

// A circular lens's sag: t is 0 at the band's inner edge (flat: no seam), 1 at the screen edge.
float sag(float t) {
  t = clamp(pow(t, CURVE), 0.0, 1.0);
  return 1.0 - sqrt(1.0 - t * t);
}

void main() {
  vec2 p = uv;
  float bend = 0.0;
  if (p.y > 1.0 - band) {
    bend = sag((p.y - (1.0 - band)) / band) * band * STRENGTH;
    p.y -= bend;
  } else if (p.y < band) {
    bend = sag((band - p.y) / band) * band * STRENGTH;
    p.y += bend;
  }
  if (bend * DISPERSION < pixel) {
    color = texture(scene, p);
    return;
  }
  // The spectrum along the bend: each sample weighted into red, green and blue by where it falls.
  vec3 rgb = vec3(0.0);
  vec3 weights = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = float(i) / 15.0;
    vec3 w = vec3(smoothstep(0.8, 0.2, t), smoothstep(0.0, 0.5, t) * smoothstep(1.0, 0.5, t), smoothstep(0.2, 0.8, t));
    vec4 s = texture(scene, vec2(p.x, clamp(p.y + (t - 0.5) * DISPERSION * bend, 0.0, 1.0)));
    rgb += s.rgb * w;
    weights += w;
    alpha += s.a;
  }
  alpha /= 16.0;
  // Premultiplied: a channel split from a tile's edge can't come out brighter than its cover.
  color = vec4(min(rgb / weights, vec3(alpha)), alpha);
}`;

/** A source's texture, and what was last put in it. */
interface Texture {
  texture: WebGLTexture;
  /** The image's URL (a new size comes in at another), or the video frame's time. */
  key: string | number;
  width: number;
  height: number;
  /** The draw it was last drawn on, to let go of those long unused. */
  used: number;
}

/** Draws without using a texture for this long are let go of. */
const KEEP_DRAWS = 180;

export class GlassLayer {
  private readonly textures = new Map<HTMLImageElement | HTMLVideoElement | string, Texture>();
  private readonly tileUniforms: Record<'rect' | 'view' | 'cover' | 'radius' | 'opacity' | 'bias', WebGLUniformLocation | null>;
  private readonly glassUniforms: Record<'band' | 'pixel', WebGLUniformLocation | null>;
  private readonly sceneTexture: WebGLTexture;
  /** The about text in the bands' reach, the top's over the bottom's (see GlassText.draw). */
  private readonly words = document.createElement('canvas').getContext('2d')!;
  private readonly wordsTexture: WebGLTexture;
  private readonly sceneBuffer: WebGLFramebuffer;
  private readonly empty: WebGLVertexArrayObject;
  private sized: [number, number] = [0, 0];
  private draws = 0;
  private pending = 0;
  /** Drawing on its own until then (performance.now()), whatever it shows: the theme's colours fading. */
  private liveUntil = 0;
  private lost = false;
  /** What the layer's mask was last set for (see clip), so it is only set again when that changes. */
  private masked = '';

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly tiles: WebGLProgram,
    private readonly glass: WebGLProgram,
    private readonly layer: HTMLElement,
    private readonly text: GlassText | null,
    private readonly frame: () => GlassFrame,
    private readonly busy: () => boolean,
  ) {
    const at = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
    this.tileUniforms = { rect: at(tiles, 'rect'), view: at(tiles, 'view'), cover: at(tiles, 'cover'), radius: at(tiles, 'radius'), opacity: at(tiles, 'opacity'), bias: at(tiles, 'bias') };
    this.glassUniforms = { band: at(glass, 'band'), pixel: at(glass, 'pixel') };
    this.sceneTexture = this.texture(gl.LINEAR);
    this.wordsTexture = this.texture(gl.LINEAR);
    if (text) text.onChange = () => this.request();
    this.sceneBuffer = gl.createFramebuffer();
    this.empty = gl.createVertexArray();
    gl.useProgram(tiles);
    gl.uniform1i(at(tiles, 'image'), 0);
    gl.useProgram(glass);
    gl.uniform1i(at(glass, 'scene'), 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      this.canvas.remove();
      this.unmask();
      this.text?.clip(0, 0);
      delete document.documentElement.dataset.glass;
    });
  }

  /**
   * Just under `root` (the canvas, whose tile layer is `layer`) and over `text`; null where it
   * can't be drawn, or (`slowGpu` false) not smoothly: the page just has no glass, and `html` no
   * data-glass. `frame` is what to draw; while `busy`, the page's own loop draws every frame, and
   * otherwise the layer draws itself while what it shows changes (see request).
   */
  static create(root: HTMLElement, layer: HTMLElement, text: GlassText | null, slowGpu: boolean, frame: () => GlassFrame, busy: () => boolean): GlassLayer | null {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.glass = '';
    // At the canvas's own z-index, before it: under every tile, frame and intro layer, over the about view.
    canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;z-index:${getComputedStyle(root).zIndex};pointer-events:none`;
    const gl = canvas.getContext('webgl2', {
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !slowGpu,
    });
    if (gl && !slowGpu && software(gl)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    const tiles = gl && program(gl, TILE_VERTEX, TILE_FRAGMENT);
    const glass = gl && program(gl, GLASS_VERTEX, GLASS_FRAGMENT);
    if (!gl || !tiles || !glass) return null;
    root.before(canvas);
    document.documentElement.dataset.glass = '';
    return new GlassLayer(canvas, gl, tiles, glass, layer, text, frame, busy);
  }

  private texture(filter: number): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** The canvas and the scene behind it, `width` × `height` device px. */
  private size(width: number, height: number): void {
    const { gl } = this;
    if (this.sized[0] === width && this.sized[1] === height) return;
    this.sized = [width, height];
    this.canvas.width = width;
    this.canvas.height = height;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTexture, 0);
    gl.viewport(0, 0, width, height);
  }

  /** What `tile` shows, in a texture brought up to date: its image or video frame, or its colour grid. */
  private sourceTexture(tile: GlassTile): Texture {
    const { gl } = this;
    const source = tile.source;
    if (!source) {
      let t = this.textures.get(tile.pixels);
      if (!t) {
        const [width, height] = tile.grid;
        const data = new Uint8Array(width * height * 4);
        for (let n = 0; n < width * height; n++) {
          const c = Number.parseInt(pixelColor(tile.pixels, n), 16);
          data.set([c >> 16, (c >> 8) & 255, c & 255, 255], n * 4);
        }
        // Drawn pixelated, as the page draws it.
        t = { texture: this.texture(gl.NEAREST), key: '', width, height, used: 0 };
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        this.textures.set(tile.pixels, t);
      }
      t.used = this.draws;
      return t;
    }
    const video = source instanceof HTMLVideoElement ? source : null;
    let t = this.textures.get(source);
    if (!t) {
      // An image is seen at all sizes as the camera zooms and the flight blurs it: mipmapped.
      t = { texture: this.texture(video ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR), key: -1, width: 1, height: 1, used: 0 };
      this.textures.set(source, t);
    }
    t.used = this.draws;
    const key = video ? video.currentTime : (source as HTMLImageElement).currentSrc;
    if (key === t.key) return t;
    t.key = key;
    gl.bindTexture(gl.TEXTURE_2D, t.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    if (!video) gl.generateMipmap(gl.TEXTURE_2D);
    t.width = video ? video.videoWidth : (source as HTMLImageElement).naturalWidth;
    t.height = video ? video.videoHeight : (source as HTMLImageElement).naturalHeight;
    return t;
  }

  /** Draw the bands next frame, unless the page's own loop does. */
  request(): void {
    if (!this.pending && !this.lost) this.pending = requestAnimationFrame(() => !this.busy() && this.draw());
  }

  /** Keep drawing for `seconds`, whatever it shows. */
  liveFor(seconds: number): void {
    this.liveUntil = performance.now() + seconds * 1000;
    this.request();
  }

  /** Draw the bands as the page is now, and keep drawing them while what they show changes and the page's loop is asleep. */
  draw(): void {
    if (this.lost) return;
    cancelAnimationFrame(this.pending);
    this.pending = 0;
    const { gl, tileUniforms: u } = this;
    const { tiles, vw, vh, scale } = this.frame();
    const ratio = Math.min(window.devicePixelRatio, GLASS_DPR);
    const width = Math.round(vw * ratio);
    const height = Math.round(vh * ratio);
    this.size(width, height);
    // Whole device px, so the mask and the bands meet on a pixel edge.
    const band = Math.round(height * GLASS_BAND);
    // The strip at each band's inner edge where the page fades out over the glass's copy, unbent.
    const feather = Math.round(band * GLASS_FEATHER);
    this.clip(band / ratio, feather / ratio, vw, vh, scale);
    this.text?.clip(band / ratio, feather / ratio);
    // How far into the page the glass looks from a band: a bend past the band, and the spectrum either side of it; and the strip past it.
    const reach = Math.min(Math.floor(height / 2), Math.max(band + feather, band + Math.ceil(band * (Math.max(0, GLASS_STRENGTH - 1) + (GLASS_DISPERSION * GLASS_STRENGTH) / 2))) + 2);
    this.draws++;

    // The tiles, into the scene: those in reach of a band, each band on its own.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneBuffer);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.tiles);
    gl.bindVertexArray(this.empty);
    gl.enable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.view, width, height);
    const cx = vw / 2;
    const cy = vh / 2;
    let live = performance.now() < this.liveUntil;
    const regions = [
      [0, reach],
      [height - reach, height],
    ] as const;
    const words = this.drawWords(width, reach, ratio, regions);
    for (const [n, [top, bottom]] of regions.entries()) {
      gl.scissor(0, height - bottom, width, bottom - top);
      // The about text, under the tiles.
      if (words) {
        gl.bindTexture(gl.TEXTURE_2D, this.wordsTexture);
        gl.uniform4f(u.cover, 1, 0.5, 0, n * 0.5);
        gl.uniform4f(u.rect, 0, top, width, reach);
        gl.uniform1f(u.radius, 0);
        gl.uniform1f(u.opacity, 1);
        gl.uniform1f(u.bias, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      for (const tile of tiles) {
        // On the page, with the layer's own scale about the centre.
        const x = (cx + (tile.left - cx) * scale) * ratio;
        const y = (cy + (tile.top - cy) * scale) * ratio;
        const w = tile.width * scale * ratio;
        const h = tile.height * scale * ratio;
        if (y > bottom || y + h < top || x > width || x + w < 0) continue;
        live ||= tile.live;
        const t = this.sourceTexture(tile);
        gl.bindTexture(gl.TEXTURE_2D, t.texture);
        // Object-fit: cover, for an image or video; the colour grid is stretched over the tile.
        const aspect = tile.source ? t.width / t.height / (w / h) : 1;
        const cover = aspect > 1 ? [1 / aspect, 1] : [1, aspect];
        gl.uniform4f(u.cover, cover[0]!, cover[1]!, (1 - cover[0]!) / 2, (1 - cover[1]!) / 2);
        gl.uniform4f(u.rect, x, y, w, h);
        gl.uniform1f(u.radius, Math.min(tile.radius * scale * ratio, w / 2, h / 2));
        gl.uniform1f(u.opacity, tile.opacity);
        gl.uniform1f(u.bias, tile.blur > 0 ? Math.log2(1 + tile.blur * ratio) : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    // Through the glass, onto the canvas: only the bands and the strips past them, the rest left clear.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.glass);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.uniform1f(this.glassUniforms.band, band / height);
    gl.uniform1f(this.glassUniforms.pixel, 1 / height);
    gl.scissor(0, height - band - feather, width, band + feather);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.scissor(0, 0, width, band + feather);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);

    for (const [source, t] of this.textures) {
      if (this.draws - t.used <= KEEP_DRAWS) continue;
      gl.deleteTexture(t.texture);
      this.textures.delete(source);
    }
    if (live) this.request();
  }

  /** The about text in `regions` into its texture, `width` × `reach` device px each: whether there was any. */
  private drawWords(width: number, reach: number, ratio: number, regions: readonly (readonly [number, number])[]): boolean {
    if (!this.text) return false;
    const ctx = this.words;
    const canvas = ctx.canvas;
    if (canvas.width !== width || canvas.height !== reach * 2) {
      canvas.width = width;
      canvas.height = reach * 2;
    } else {
      ctx.clearRect(0, 0, width, reach * 2);
    }
    if (!this.text.draw(ctx, ratio, regions)) return false;
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.wordsTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    return true;
  }

  /**
   * Mask the bands, `band` px each, out of the tile layer, the page fading out over the glass's
   * copy through the `feather` px before each: in the layer's own px, which its `scale` about the
   * centre draws on the page. The mask covers the window (a px over at each side), wherever that
   * is in the layer's px; outside it nothing shows, as nothing is seen there.
   */
  private clip(band: number, feather: number, vw: number, vh: number, scale: number): void {
    const cx = vw / 2;
    const cy = vh / 2;
    const at = (screen: number, centre: number) => centre + (screen - centre) / scale;
    const [x0, x1, y0, y1] = [at(-1, cx), at(vw + 1, cx), at(0, cy), at(vh, cy)];
    // Down the window, as a share of its height (the same in the layer's px as on the page).
    const stop = (screen: number) => `${((screen / vh) * 100).toFixed(4)}%`;
    const key = `${band}:${feather}:${vw}:${vh}:${scale}`;
    if (key === this.masked) return;
    this.masked = key;
    const style = this.layer.style;
    style.clipPath = '';
    const mask = `linear-gradient(to bottom, transparent ${stop(band)}, black ${stop(band + feather)}, black ${stop(vh - band - feather)}, transparent ${stop(vh - band)})`;
    style.setProperty('-webkit-mask-image', mask);
    style.maskImage = mask;
    style.maskRepeat = 'no-repeat';
    style.maskSize = `${(x1 - x0).toFixed(2)}px ${(y1 - y0).toFixed(2)}px`;
    style.maskPosition = `${x0.toFixed(2)}px ${y0.toFixed(2)}px`;
    style.setProperty('mask-clip', 'no-clip');
  }

  /** No mask: the whole layer shows (the glass gone). */
  private unmask(): void {
    for (const property of ['-webkit-mask-image', 'mask-image', 'mask-repeat', 'mask-size', 'mask-position', 'mask-clip']) this.layer.style.removeProperty(property);
    this.masked = '';
  }
}
