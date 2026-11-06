/**
 * The views' key hints (KeyHint.astro): the header's About, the info bar's Start a project and
 * Menu. Open a view and its hint's label slides up out of its mask and the other one in (About to
 * Back, Menu to Close); its key makes room for an ESC beside it in CSS, on `data-active`.
 */
import { ESC_DURATION, ESC_EASE } from '../components/hint';

const OUT = { duration: 140, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' } as const;
const IN = { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' } as const;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Show `name`'s view as open, or not, on every hint for it. */
export function setHint(name: string, active: boolean): void {
  for (const hint of document.querySelectorAll<HTMLElement>(`[data-hint="${name}"]`)) {
    if ('active' in hint.dataset === active) continue;
    hint.toggleAttribute('data-active', active);
    slide(hint);
  }
}

/** The hint's label to what it says now, sliding the old one out and the new one in. */
function slide(hint: HTMLElement): void {
  const text = hint.querySelector<HTMLElement>('[data-hint-label]')!;
  const now = () => ('active' in hint.dataset ? hint.dataset.activeLabel! : hint.dataset.label!);
  for (const a of text.getAnimations()) a.cancel();
  if (reducedMotion.matches) {
    text.textContent = now();
    return;
  }
  const out = text.animate([{ transform: 'translateY(-110%)', opacity: 0 }], { ...OUT, fill: 'forwards' });
  out.finished.then(
    () => {
      // Whatever it says by now.
      settle(() => (text.textContent = now()), hint);
      out.cancel();
      text.animate([{ transform: 'translateY(110%)', opacity: 0 }, { transform: 'none', opacity: 1 }], IN);
    },
    // Cancelled by a newer change.
    () => {},
  );
}

/**
 * Change the page (`change`: a label's text) without anything it moves jumping: a label of another
 * width moves its hint's key, and the ESC by it, and any hint after it in the row. Each is put
 * back where it was drawn and eases from there to its new place, on the ESC's own move (ESC_EASE),
 * over whatever it is doing already (a transform added to its own). The label that changed isn't
 * moved: it is coming in anew.
 */
function settle(change: () => void, changed: HTMLElement): void {
  const parts = [...document.querySelectorAll<HTMLElement>('[data-hint]')].flatMap((h) => [
    h.querySelector<HTMLElement>('[data-hint-key]')!.parentElement!,
    ...(h === changed ? [] : [h.querySelector<HTMLElement>('[data-hint-label]')!.parentElement!]),
  ]);
  const was = parts.map((el) => el.getBoundingClientRect().left);
  change();
  parts.forEach((el, n) => {
    const dx = was[n]! - el.getBoundingClientRect().left;
    if (Math.abs(dx) < 0.01) return;
    el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: ESC_DURATION, easing: ESC_EASE, composite: 'add' });
  });
}
