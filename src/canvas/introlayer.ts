import { INTRO_DPR, INTRO_FADE, INTRO_FOG_CLEAR, INTRO_FOG_DEPTH, INTRO_FOG_FAR, INTRO_HANDOVER, INTRO_MIN_WIDTH } from './config';
import type { IntroFrame } from './intro';
import { INTRO_STRIDE } from './intro';
import type { Rgb } from './pixels';

/**
 * The intro's drawing (see intro.ts): one instanced draw of a box per ray and line, on a
 * canvas of its own over the tiles, which is taken off the page when it has faded.
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
layout(location = 4) in float thin;
layout(location = 5) in vec3 tile;
layout(location = 6) in vec4 color;
layout(location = 7) in vec3 depth; // at the focal plane, per unit of travel, and pace
uniform vec2 view;
uniform float z, tail, closed;
const float HANDOVER = ${INTRO_HANDOVER.toFixed(3)};
const float MIN_HALF = ${(INTRO_MIN_WIDTH / 2).toFixed(3)};
const float FOG_CLEAR = ${INTRO_FOG_CLEAR.toFixed(3)};
const float FOG_DEPTH = ${INTRO_FOG_DEPTH.toFixed(3)};
const float FOG_FAR = ${INTRO_FOG_FAR.toFixed(3)};
out float along;
out float fog;
out vec2 local;
flat out vec3 box;
flat out vec4 paint;
void main() {
  // introTravel in intro.ts.
  float travel = HANDOVER * pow(mix(tail, z, corner.z) / HANDOVER, mix(depth.z, 1.0, closed));
  float w = max(depth.x + travel * mix(depth.y, 1.0, closed), 0.02);
  // Passing the camera a line keeps its width on screen, rather than flaring.
  vec2 size = max(half_ * mix(thin, 1.0, closed) * min(w, 1.0), MIN_HALF * w);
  vec2 p = offset + vec2(corner.x, -corner.y) * size;
  local = p;
  // introFog in intro.ts: varies along a streak too, so its far end is the faintest.
  fog = FOG_FAR + (1.0 - FOG_FAR) * exp(-max(w - FOG_CLEAR, 0.0) / FOG_DEPTH);
  box = tile;
  along = corner.z;
  paint = color;
  p += pos;
  gl_Position = vec4(p.x / view.x, -p.y / view.y, 0, w);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform float corners, fade, rays;
in float along;
in float fog;
in vec2 local;
flat in vec3 box;
flat in vec4 paint;
out vec4 color;
void main() {
  vec2 q = abs(local) - box.xy + box.z;
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - box.z;
  float a = paint.a * along * along * fog * fade * (box.x < 5000.0 ? rays : 1.0) * mix(1.0, clamp(0.5 - edge, 0.0, 1.0), corners);
  color = vec4(paint.rgb * a, a);
}`;

/** A box's eight corners. */
const CORNERS = new Float32Array([-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
/** Near end, then the sides, all counter-clockwise from outside. */
const FACES = new Uint8Array([0, 1, 2, 0, 2, 3, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0, 0, 4, 5, 0, 5, 1]);
/** Each instance attribute's location and size, in the order INTRO_STRIDE lays them out. */
const ATTRIBUTES = [2, 2, 2, 1, 3, 4, 3];

function program(gl: WebGL2RenderingContext): WebGLProgram | null {
  const p = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(p, shader);
  }
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

export class IntroLayer {
  private leaving = false;
  private gone = false;
  private readonly uniforms: Record<'z' | 'tail' | 'closed' | 'corners' | 'fade' | 'rays', WebGLUniformLocation | null>;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    p: WebGLProgram,
    private readonly count: number,
  ) {
    const at = (name: string) => gl.getUniformLocation(p, name);
    this.uniforms = { z: at('z'), tail: at('tail'), closed: at('closed'), corners: at('corners'), fade: at('fade'), rays: at('rays') };
  }

  /** Null where it can't be drawn, or (`slowGpu` false) not smoothly: the canvas just opens. */
  static create(root: HTMLElement, instances: Float32Array, background: Rgb, vw: number, vh: number, zIndex: number, slowGpu: boolean): IntroLayer | null {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(window.devicePixelRatio, INTRO_DPR);
    canvas.width = Math.round(vw * ratio);
    canvas.height = Math.round(vh * ratio);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.intro = '';
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${zIndex};pointer-events:none;transition:opacity ${INTRO_FADE}s ease-out`;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: !slowGpu,
    });
    const p = gl && program(gl);
    if (!gl || !p) return null;

    gl.useProgram(p);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
    let offset = 0;
    ATTRIBUTES.forEach((size, n) => {
      gl.enableVertexAttribArray(n + 1);
      gl.vertexAttribPointer(n + 1, size, gl.FLOAT, false, INTRO_STRIDE * 4, offset * 4);
      gl.vertexAttribDivisor(n + 1, 1);
      offset += size;
    });

    gl.uniform2f(gl.getUniformLocation(p, 'view'), vw / 2, vh / 2);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    root.append(canvas);
    return new IntroLayer(canvas, gl, p, instances.length / INTRO_STRIDE);
  }

  draw(frame: IntroFrame): void {
    const { gl, uniforms } = this;
    if (this.gone) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uniforms.z, frame.z);
    gl.uniform1f(uniforms.tail, frame.tail);
    gl.uniform1f(uniforms.closed, frame.closed);
    gl.uniform1f(uniforms.corners, frame.corners);
    gl.uniform1f(uniforms.fade, frame.fade);
    gl.uniform1f(uniforms.rays, frame.rays);
    gl.drawElementsInstanced(gl.TRIANGLES, FACES.length, gl.UNSIGNED_BYTE, 0, this.count);
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
