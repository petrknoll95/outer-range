/**
 * The views' key hints (KeyHint.astro): the header's About, the info bar's Start a project and
 * Menu. Open a view and its hint's label slides up out of its mask and the other one in (About to
 * Back, Menu to Close); its key makes room for an ESC beside it in CSS, on `data-active`.
 */
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
      text.textContent = now();
      out.cancel();
      text.animate([{ transform: 'translateY(110%)', opacity: 0 }, { transform: 'none', opacity: 1 }], IN);
    },
    // Cancelled by a newer change.
    () => {},
  );
}
