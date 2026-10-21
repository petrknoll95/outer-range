import { DRAG_THRESHOLD, KEY_PAGE, KEY_STEP, KEY_ZOOM, LINE_HEIGHT, WHEEL_ZOOM_MAX_DELTA, WHEEL_ZOOM_SPEED } from './config';
import type { CameraPhysics } from './physics';
import { DRAG_END, DRAG_MOVE, DRAG_START, NUDGE, PINCH, WHEEL, ZOOM, ZOOM_RESET } from './physics';

export interface InputOptions {
  root: HTMLElement;
  physics: CameraPhysics;
  /** Called after every queued input so the render loop can wake up. */
  wake: () => void;
  /** The pointer moved to (x, y), screen px. */
  focus: (x: number, y: number) => void;
  /** Current on-screen pitch and viewport, px, for keyboard steps. */
  metrics: () => { pitch: number; vw: number; vh: number };
  /**
   * Maps a screen point to the canvas point drawn there (undoing the lens), so the image
   * under the pointer is the one that drags, pinches and zooms with it. Identity by default.
   */
  toCanvas?: (x: number, y: number, out: { x: number; y: number }) => void;
}

/** Safari's trackpad pinch events (non-standard, so not in lib.dom). */
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

const seconds = (e: Event) => e.timeStamp / 1000;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Turns DOM events into timestamped physics inputs.
 *
 * - Wheel / trackpad: both axes pan, deltaMode normalised.
 * - Zoom about the cursor: trackpad pinch (ctrl+wheel in Chrome and Firefox, gesture
 *   events in Safari), ctrl/⌘ + mouse wheel, two-finger touch pinch, and + − 0 keys.
 * - Pointer: mouse, pen and one-finger touch drag with pointer capture. A press stays a
 *   click until it travels DRAG_THRESHOLD px; a click that ends a drag is swallowed.
 * - Arrow keys pan by KEY_STEP pitches, with Shift by KEY_PAGE of the viewport.
 */
const identity = (x: number, y: number, out: { x: number; y: number }) => {
  out.x = x;
  out.y = y;
};

export function attachInput({ root, physics, wake, focus, metrics, toCanvas = identity }: InputOptions): () => void {
  const point = { x: 0, y: 0 };
  /** Screen → canvas point. Returns a shared object: read it before the next call. */
  const canvas = (x: number, y: number) => {
    toCanvas(x, y, point);
    return point;
  };
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'idle' | 'press' | 'drag' | 'pinch' = 'idle';
  let startX = 0;
  let startY = 0;
  let pinchDistance = 0;
  let midX = 0;
  let midY = 0;
  let suppressClick = false;
  let gestureScale = 1;
  let inGesture = false;

  const measurePinch = () => {
    const [a, b] = [...pointers.values()];
    midX = (a!.x + b!.x) / 2;
    midY = (a!.y + b!.y) / 2;
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const at = canvas(e.clientX, e.clientY);
    focus(at.x, at.y);
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dx *= LINE_HEIGHT;
      dy *= LINE_HEIGHT;
    } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      const m = metrics();
      dx *= m.vw;
      dy *= m.vh;
    }
    if (e.ctrlKey || e.metaKey) {
      // Safari reports its pinch as gesture events; don't count it twice.
      if (inGesture) return;
      const d = Math.max(-WHEEL_ZOOM_MAX_DELTA, Math.min(WHEEL_ZOOM_MAX_DELTA, dy));
      physics.push(ZOOM, seconds(e), at.x, at.y, Math.exp(-d * WHEEL_ZOOM_SPEED));
      wake();
      return;
    }
    // Windows mice: Shift turns the wheel horizontal, but not every browser swaps the axes.
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    physics.push(WHEEL, seconds(e), dx, dy);
    wake();
  };

  const onGestureStart = (e: Event) => {
    e.preventDefault();
    inGesture = true;
    gestureScale = 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const g = e as GestureEvent;
    if (g.scale > 0) {
      const at = canvas(g.clientX, g.clientY);
      physics.push(ZOOM, seconds(e), at.x, at.y, g.scale / gestureScale);
      gestureScale = g.scale;
      focus(at.x, at.y);
      wake();
    }
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
    inGesture = false;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // One mouse/pen pointer, or up to two fingers.
    if (pointers.size >= 2 || (pointers.size === 1 && e.pointerType !== 'touch')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.setPointerCapture(e.pointerId);
    const at = canvas(e.clientX, e.clientY);
    focus(at.x, at.y);
    if (pointers.size === 1) {
      mode = 'press';
      startX = e.clientX;
      startY = e.clientY;
      suppressClick = false;
      return;
    }
    // A second finger: pinch about the midpoint (re-anchoring any drag already running).
    mode = 'pinch';
    suppressClick = true;
    root.dataset.dragging = '';
    pinchDistance = measurePinch();
    const mid = canvas(midX, midY);
    physics.push(DRAG_START, seconds(e), mid.x, mid.y);
    wake();
  };

  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const at = canvas(e.clientX, e.clientY);
        focus(at.x, at.y);
      }
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (mode === 'press') {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      mode = 'drag';
      suppressClick = true;
      root.dataset.dragging = '';
      // Anchor at the press point so the threshold distance is not lost.
      const start = canvas(startX, startY);
      physics.push(DRAG_START, seconds(e), start.x, start.y);
    }
    if (mode === 'drag') {
      const at = canvas(e.clientX, e.clientY);
      focus(at.x, at.y);
      physics.push(DRAG_MOVE, seconds(e), at.x, at.y);
    } else if (mode === 'pinch') {
      const distance = measurePinch();
      const mid = canvas(midX, midY);
      focus(mid.x, mid.y);
      // Pan so the held world point follows the midpoint, then zoom about it.
      physics.push(DRAG_MOVE, seconds(e), mid.x, mid.y);
      if (pinchDistance > 0 && distance > 0) physics.push(PINCH, seconds(e), mid.x, mid.y, distance / pinchDistance);
      pinchDistance = distance;
    }
    wake();
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (mode === 'pinch') {
      // Carry on as a one-finger drag from wherever the remaining finger is.
      const [rest] = [...pointers.values()];
      if (rest) {
        mode = 'drag';
        const at = canvas(rest.x, rest.y);
        physics.push(DRAG_START, seconds(e), at.x, at.y);
        wake();
        return;
      }
    }
    if (mode === 'drag' || mode === 'pinch') {
      delete root.dataset.dragging;
      physics.push(DRAG_END, seconds(e));
      wake();
    }
    mode = 'idle';
  };

  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // ctrl/⌘ +/− stay the browser's page zoom.
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || isEditable(e.target)) return;
    const m = metrics();
    const t = seconds(e);
    switch (e.key) {
      case '+':
      case '=':
        physics.push(ZOOM, t, m.vw / 2, m.vh / 2, KEY_ZOOM);
        break;
      case '-':
      case '_':
        physics.push(ZOOM, t, m.vw / 2, m.vh / 2, 1 / KEY_ZOOM);
        break;
      case '0':
        physics.push(ZOOM_RESET, t, m.vw / 2, m.vh / 2);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const step = e.shiftKey ? (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? m.vw : m.vh) * KEY_PAGE : m.pitch * KEY_STEP;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        physics.push(NUDGE, t, dx, dy);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    wake();
  };

  const onDragStart = (e: DragEvent) => e.preventDefault();

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('gesturestart', onGestureStart);
  window.addEventListener('gesturechange', onGestureChange);
  window.addEventListener('gestureend', onGestureEnd);
  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('lostpointercapture', onPointerEnd);
  root.addEventListener('click', onClick, true);
  root.addEventListener('dragstart', onDragStart);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('gesturestart', onGestureStart);
    window.removeEventListener('gesturechange', onGestureChange);
    window.removeEventListener('gestureend', onGestureEnd);
    root.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('lostpointercapture', onPointerEnd);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('keydown', onKeyDown);
  };
}
