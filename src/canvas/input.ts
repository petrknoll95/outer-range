import { DRAG_THRESHOLD, KEY_PAGE, KEY_STEP, LINE_HEIGHT } from './config';
import type { CameraPhysics } from './physics';
import { DRAG_END, DRAG_MOVE, DRAG_START, NUDGE, WHEEL } from './physics';

export interface InputOptions {
  root: HTMLElement;
  physics: CameraPhysics;
  /** Called after every queued input so the render loop can wake up. */
  wake: () => void;
  /** Current pitch and viewport, px, for keyboard steps. */
  metrics: () => { pitch: number; vw: number; vh: number };
}

const seconds = (e: Event) => e.timeStamp / 1000;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/**
 * Turns DOM events into timestamped physics inputs.
 *
 * - Wheel / trackpad: both axes pan, deltaMode normalised. ctrl+wheel (trackpad pinch,
 *   ctrl+scroll zoom) is left to the browser untouched.
 * - Pointer: mouse, pen and one-finger touch drag with pointer capture. A press stays a
 *   click until it travels DRAG_THRESHOLD px; a click that ends a drag is swallowed.
 * - Arrow keys pan by KEY_STEP pitches, with Shift by KEY_PAGE of the viewport.
 */
export function attachInput({ root, physics, wake, metrics }: InputOptions): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let suppressClick = false;

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return;
    e.preventDefault();
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
    // Windows mice: Shift turns the wheel horizontal, but not every browser swaps the axes.
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    physics.push(WHEEL, seconds(e), dx, dy);
    wake();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
    suppressClick = false;
    root.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      suppressClick = true;
      root.dataset.dragging = '';
      // Anchor at the press point so the threshold distance is not lost.
      physics.push(DRAG_START, seconds(e), startX, startY);
    }
    physics.push(DRAG_MOVE, seconds(e), e.clientX, e.clientY);
    wake();
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    delete root.dataset.dragging;
    physics.push(DRAG_END, seconds(e));
    wake();
  };

  const onClick = (e: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || isEditable(e.target)) return;
    const m = metrics();
    const stepX = e.shiftKey ? m.vw * KEY_PAGE : m.pitch * KEY_STEP;
    const stepY = e.shiftKey ? m.vh * KEY_PAGE : m.pitch * KEY_STEP;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -stepX;
    else if (e.key === 'ArrowRight') dx = stepX;
    else if (e.key === 'ArrowUp') dy = -stepY;
    else if (e.key === 'ArrowDown') dy = stepY;
    else return;
    e.preventDefault();
    physics.push(NUDGE, seconds(e), dx, dy);
    wake();
  };

  const onDragStart = (e: DragEvent) => e.preventDefault();

  window.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('lostpointercapture', onPointerEnd);
  root.addEventListener('click', onClick, true);
  root.addEventListener('dragstart', onDragStart);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('lostpointercapture', onPointerEnd);
    root.removeEventListener('click', onClick, true);
    root.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('keydown', onKeyDown);
  };
}
