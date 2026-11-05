import { ABERRATION_TWIST, FLIGHT_GRID_FINER, INTRO_DPR, INTRO_FADE, INTRO_FOG_CLEAR, INTRO_FOG_DEPTH, INTRO_FOG_FAR, INTRO_HANDOVER, INTRO_MIN_WIDTH } from './config';
import type { IntroFrame } from './intro';
import { INTRO_STRIDE } from './intro';
import type { Rgb } from './pixels';

/**
 * The intro's drawing (see intro.ts): one instanced draw of a box per ray and line, on a
 * canvas of its own over the tiles, which is taken off the page when it has faded. They are
 * drawn off screen first, then onto the canvas with a lens's chromatic aberration: red pushed
 * out from the centre and blue in, more towards the edges and the faster the camera goes.
 *
 * A box is drawn by its near end and its sides, at their true depths: back faces are culled,
 * so each pixel is covered once and a line's fading tail doesn't build up where faces overlap,
 * and the depths give the fade the right perspective along it.
 */

const VERTEX = `#version 300 es
layout(location = 0) in vec3 corner; // x, y up, and 1 at the near end or 0 at the far
layout(location = 1) in vec2 pos;
layout(location = 2) in vec2 offset;
layout(location = 3) in vec2 half_;
layout(location = 4) in vec2 thin; // how thin at speed, and which grid it is drawn for (Detail in intro.ts)
layout(location = 5) in vec3 tile;
layout(location = 6) in vec4 color;
layout(location = 7) in vec3 depth; // at the focal plane, per unit of travel, and pace
uniform vec2 view;
uniform float z, tail, closed, flight, back, handover;
// The fragment shader's fade, rays and lines (a uniform can't be shared at two precisions): what can't be seen isn't drawn.
uniform float shownFade, shownRays, shownLines;
const float HANDOVER = ${INTRO_HANDOVER.toFixed(3)};
const float FINER = ${FLIGHT_GRID_FINER.toFixed(1)};
const float MIN_HALF = ${(INTRO_MIN_WIDTH / 2).toFixed(3)};
const float FOG_CLEAR = ${INTRO_FOG_CLEAR.toFixed(3)};
const float FOG_DEPTH = ${INTRO_FOG_DEPTH.toFixed(3)};
const float FOG_FAR = ${INTRO_FOG_FAR.toFixed(3)};
// Centroid: a side face seen edge on is a sliver under a pixel wide, and multisampled, a pixel only partly
// covered by it is still shaded at its centre, outside it, where these run on past their ends (along past 1
// would make it brighter than its colour can be, a white seam between cells).
centroid out float along;
centroid out float fog;
centroid out vec2 local;
flat out vec3 box;
flat out vec4 paint;
flat out float strength;
// introTravel in intro.ts; on the flight (flight.ts), as it is.
float travelAt(float s) {
  return flight > 0.5 ? s : HANDOVER * pow(s / HANDOVER, mix(depth.z, 1.0, closed));
}
float aheadAt(float s) {
  return depth.x + travelAt(s) * (flight > 0.5 ? depth.y : mix(depth.y, 1.0, closed));
}
void main() {
  float thinness = mix(thin.x, 1.0, closed);
  // Of a coarse ray and its finer ones, which shows: the finer once each would be over a pixel wide where
  // it is now and its streak has shortened to a few px, as they slow to land; the coarse (as good, and a
  // third of the work: one streak where the finer draw one per row) before; across the change, a little of both.
  float detail = 1.0;
  if (thin.y > 0.5) {
    float near = max(aheadAt(z), 0.02);
    float fine = min(half_.x, half_.y) * (thin.y > 1.5 ? 1.0 : 1.0 / FINER) * thinness / max(near, 1.0);
    float streak = length(pos + offset) * abs(1.0 / near - 1.0 / max(aheadAt(tail), 0.02));
    detail = smoothstep(0.4, 0.7, fine) * (1.0 - smoothstep(6.0, 12.0, streak));
    if (thin.y < 1.5) detail = 1.0 - detail;
  }
  // Held back, faded out, the other grid's turn, or flown past at both ends: off the clip volume, so the GPU rasterises nothing of it.
  float shown = shownFade * detail * (tile.x < 5000.0 ? shownRays : shownLines);
  if (shown <= 0.0 || (flight > 0.5 && max(aheadAt(z), aheadAt(tail)) <= 0.1)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float ahead = aheadAt(mix(tail, z, corner.z));
  float w = max(ahead, 0.02);
  // Passing the camera a line keeps its width on screen, rather than flaring.
  vec2 size = max(half_ * thinness * min(w, 1.0), MIN_HALF * w);
  vec2 p = offset + vec2(corner.x, -corner.y) * size;
  local = p;
  // introFog in intro.ts: varies along a streak too, so its far end is the faintest.
  fog = FOG_FAR + (1.0 - FOG_FAR) * exp(-max(w - FOG_CLEAR, 0.0) / FOG_DEPTH);
  // On the flight, gone well before it reaches the camera: no spokes, and nothing stays stuck at the centre, huge.
  fog *= flight > 0.5 ? smoothstep(0.1, 0.55, ahead) : 1.0;
  box = tile;
  // Brightest at its head, where it is now: the far end, flying back.
  along = mix(corner.z, 1.0 - corner.z, back);
  // A ray's alpha is its tile's opacity, a line's its own: apart from its share of the detail, as that closes up solid.
  // Over its image, still the handover share of that opacity on the page, a ray makes up only the rest, so a faded
  // tile is no brighter for having both.
  paint = vec4(color.rgb, detail);
  strength = tile.x < 5000.0 && color.a < 1.0 ? color.a * (1.0 - handover) / (1.0 - color.a * handover) : color.a;
  p += pos;
  gl_Position = vec4(p.x / view.x, -p.y / view.y, 0, w);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform float corners, fade, rays, lines, closing;
centroid in float along;
centroid in float fog;
centroid in vec2 local;
flat in vec3 box;
flat in vec4 paint;
flat in float strength;
out vec4 color;
void main() {
  vec2 q = abs(local) - box.xy + box.z;
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - box.z;
  // A ray's share of the detail is for at speed: closed up into its tile's grid, it is as solid as its tile.
  float a = (box.x < 5000.0 ? mix(paint.a, 1.0, closing) : paint.a) * strength * along * along * fog * fade * (box.x < 5000.0 ? rays : lines) * mix(1.0, clamp(0.5 - edge, 0.0, 1.0), corners);
  a = clamp(a, 0.0, 1.0);
  color = vec4(paint.rgb * a, a);
}`;

/** A box's eight corners. */
const CORNERS = new Float32Array([-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
/** Near end, then the sides, all counter-clockwise from outside. */
const FACES = new Uint8Array([0, 1, 2, 0, 2, 3, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0, 0, 4, 5, 0, 5, 1]);
/** Each instance attribute's location and size, in the order INTRO_STRIDE lays them out. */
const ATTRIBUTES = [2, 2, 2, 2, 3, 4, 3];

/** The drawing, onto the canvas, as through a lens: one triangle over the whole of it. */
const LENS_VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0, 1);
}`;

const LENS_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D scene;
uniform float spread; // the split at the corners, out from the centre, as a share of the half diagonal
uniform float twist; // and round it
uniform vec2 aspect; // the viewport's sides over its half diagonal
in vec2 uv;
out vec4 color;
void main() {
  vec2 d = uv - 0.5;
  // 0 at the centre to 1 at the corners: the split grows with it twice over, so the middle stays sharp.
  vec2 p = d * aspect;
  float r = length(p);
  // Out from the centre, as a lens does, which the streaks run along, so it shows at their ends;
  // and a little round it, which shows along their sides.
  vec2 shift = (d * spread + vec2(-p.y, p.x) / aspect * twist) * r;
  vec4 red = texture(scene, uv - shift);
  vec4 green = texture(scene, uv);
  vec4 blue = texture(scene, uv + shift);
  color = vec4(red.r, green.g, blue.b, max(green.a, max(red.a, blue.a)));
}`;

/** Whether `gl` is drawn on the CPU (SwiftShader, llvmpipe, Microsoft's Basic Render Driver and the like). */
export function software(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

export function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram | null {
  const p = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(p, shader);
  }
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Where the rays are drawn before the lens: multisampled, as the canvas would be, and resolved into a texture. */
interface Scene {
  samples: WebGLFramebuffer;
  colour: WebGLRenderbuffer;
  resolved: WebGLFramebuffer;
  texture: WebGLTexture;
  count: number;
}

export class IntroLayer {
  private leaving = false;
  private gone = false;
  private readonly uniforms: Record<
    'z' | 'tail' | 'closed' | 'closing' | 'corners' | 'fade' | 'rays' | 'lines' | 'shownFade' | 'shownRays' | 'shownLines' | 'flight' | 'back' | 'handover' | 'view',
    WebGLUniformLocation | null
  >;
  private readonly lensUniforms: Record<'spread' | 'twist' | 'aspect', WebGLUniformLocation | null>;
  private halfDiagonal = 1;
  /** The scene's size, device px: none yet. */
  private sized: [number, number] = [0, 0];

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly rays: WebGLProgram,
    private readonly lens: WebGLProgram,
    private readonly vertices: { rays: WebGLVertexArrayObject; lens: WebGLVertexArrayObject },
    private readonly buffer: WebGLBuffer,
    private readonly scene: Scene,
    private count: number,
  ) {
    const at = (name: string) => gl.getUniformLocation(rays, name);
    this.uniforms = {
      z: at('z'),
      tail: at('tail'),
      closed: at('closed'),
      closing: at('closing'),
      corners: at('corners'),
      fade: at('fade'),
      rays: at('rays'),
      lines: at('lines'),
      shownFade: at('shownFade'),
      shownRays: at('shownRays'),
      shownLines: at('shownLines'),
      flight: at('flight'),
      back: at('back'),
      handover: at('handover'),
      view: at('view'),
    };
    this.lensUniforms = { spread: gl.getUniformLocation(lens, 'spread'), twist: gl.getUniformLocation(lens, 'twist'), aspect: gl.getUniformLocation(lens, 'aspect') };
  }

  /**
   * Null where it can't be drawn, or (`slowGpu` false) not smoothly: the canvas just opens.
   * Over `background`, or with none, over what is under it (the flight's, kept for the next: see load()).
   */
  static create(root: HTMLElement, instances: Float32Array, background: Rgb | null, vw: number, vh: number, zIndex: number, slowGpu: boolean): IntroLayer | null {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    if (background) canvas.dataset.intro = '';
    else canvas.dataset.flightRays = '';
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${zIndex};pointer-events:none;transition:opacity ${INTRO_FADE}s ease-out`;
    // Not antialiased itself: the scene is, and the lens draws it over every pixel.
    const gl = canvas.getContext('webgl2', {
      alpha: !background,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !slowGpu,
    });
    // A software renderer can't draw this smoothly, and isn't always reported as a caveat: told by name.
    if (gl && !slowGpu && software(gl)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
    const rays = gl && program(gl, VERTEX, FRAGMENT);
    const lens = gl && program(gl, LENS_VERTEX, LENS_FRAGMENT);
    if (!gl || !rays || !lens) return null;

    const raysVertices = gl.createVertexArray();
    gl.bindVertexArray(raysVertices);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACES, gl.STATIC_DRAW);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let offset = 0;
    ATTRIBUTES.forEach((size, n) => {
      gl.enableVertexAttribArray(n + 1);
      gl.vertexAttribPointer(n + 1, size, gl.FLOAT, false, INTRO_STRIDE * 4, offset * 4);
      gl.vertexAttribDivisor(n + 1, 1);
      offset += size;
    });

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const scene: Scene = {
      samples: gl.createFramebuffer(),
      colour: gl.createRenderbuffer(),
      resolved: gl.createFramebuffer(),
      texture,
      count: Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number),
    };

    gl.useProgram(lens);
    gl.uniform1i(gl.getUniformLocation(lens, 'scene'), 0);
    gl.enable(gl.CULL_FACE);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (background) gl.clearColor(background[0], background[1], background[2], 1);
    else gl.clearColor(0, 0, 0, 0);

    const layer = new IntroLayer(canvas, gl, rays, lens, { rays: raysVertices, lens: gl.createVertexArray() }, buffer, scene, 0);
    layer.load(instances, vw, vh);
    root.append(canvas);
    return layer;
  }

  /** Draw `instances` from now on, on a viewport `vw` × `vh`, and show it. */
  load(instances: Float32Array, vw: number, vh: number): void {
    const { gl, canvas } = this;
    const ratio = Math.min(window.devicePixelRatio, INTRO_DPR);
    this.size(Math.round(vw * ratio), Math.round(vh * ratio));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
    this.count = instances.length / INTRO_STRIDE;
    gl.useProgram(this.rays);
    gl.uniform2f(this.uniforms.view, vw / 2, vh / 2);
    this.halfDiagonal = Math.hypot(vw, vh) / 2;
    gl.useProgram(this.lens);
    gl.uniform2f(this.lensUniforms.aspect, vw / this.halfDiagonal, vh / this.halfDiagonal);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    canvas.style.display = '';
  }

  /** The canvas and the scene behind it, `width` × `height` device px. */
  private size(width: number, height: number): void {
    const { gl, canvas, scene } = this;
    if (this.sized[0] === width && this.sized[1] === height) return;
    this.sized = [width, height];
    canvas.width = width;
    canvas.height = height;
    gl.bindRenderbuffer(gl.RENDERBUFFER, scene.colour);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, scene.count, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.samples);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, scene.colour);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.resolved);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene.texture, 0);
    gl.viewport(0, 0, width, height);
  }

  /** Off the page until load() again, holding as little as it can. */
  hide(): void {
    this.canvas.style.display = 'none';
    this.size(1, 1);
  }

  draw(frame: IntroFrame): void {
    const { gl, uniforms, scene } = this;
    if (this.gone) return;
    // The rays, into the scene.
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.samples);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.rays);
    gl.bindVertexArray(this.vertices.rays);
    gl.enable(gl.BLEND);
    gl.uniform1f(uniforms.z, frame.z);
    gl.uniform1f(uniforms.tail, frame.tail);
    gl.uniform1f(uniforms.closed, frame.closed);
    // (The fragment shader's copy: a vertex shader's uniform isn't the fragment's.)
    gl.uniform1f(uniforms.closing, frame.closed);
    gl.uniform1f(uniforms.corners, frame.corners);
    gl.uniform1f(uniforms.fade, frame.fade);
    gl.uniform1f(uniforms.rays, frame.rays);
    gl.uniform1f(uniforms.lines, frame.lines);
    gl.uniform1f(uniforms.shownFade, frame.fade);
    gl.uniform1f(uniforms.shownRays, frame.rays);
    gl.uniform1f(uniforms.shownLines, frame.lines);
    gl.uniform1f(uniforms.flight, frame.flight);
    gl.uniform1f(uniforms.back, frame.back);
    gl.uniform1f(uniforms.handover, frame.handover);
    gl.drawElementsInstanced(gl.TRIANGLES, FACES.length, gl.UNSIGNED_BYTE, 0, this.count);
    // Resolved, and through the lens onto the canvas.
    const { width, height } = this.canvas;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.samples);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.resolved);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.lens);
    gl.bindVertexArray(this.vertices.lens);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.texture);
    gl.uniform1f(this.lensUniforms.spread, frame.aberration / this.halfDiagonal);
    gl.uniform1f(this.lensUniforms.twist, (frame.aberration * ABERRATION_TWIST) / this.halfDiagonal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Fade to the canvas underneath, still drawing as it goes, then leave nothing behind. */
  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.canvas.style.opacity = '0';
    window.setTimeout(() => {
      this.gone = true;
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
      this.canvas.remove();
    }, INTRO_FADE * 1000 + 50);
  }
}
