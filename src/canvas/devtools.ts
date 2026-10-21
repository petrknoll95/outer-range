import type { FocusFrame } from './focusframe';
import type { ActiveImage, Renderer } from './renderer';

const STORAGE_KEY = 'canvas:dev-layer';

export interface Devtools {
  devLayer: () => boolean;
  setDevLayer: (on: boolean) => void;
  isOpen: () => boolean;
}

function storedDevLayer(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDevLayer(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the setting just won't persist.
  }
}

const SLIDERS_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
  <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
  <circle cx="10" cy="4.5" r="1.5" /><circle cx="6" cy="11.5" r="1.5" />
</svg>`;

/**
 * A tweak pane behind a dark translucent button at the top right, and the dev layer it
 * toggles: the focus frame turns accent-coloured and labels the active image (the
 * centremost one). Tweakpane itself loads the first time the pane opens, so the page
 * never pays for it otherwise. The dev layer setting is remembered in this browser.
 */
export function attachDevtools({ renderer, frame }: { renderer: Renderer; frame: FocusFrame }): Devtools {
  const state = { devLayer: storedDevLayer(), active: '—' };

  let lastImage = -1;
  const mark = (a: ActiveImage | null) => {
    state.active = a ? `#${a.image}  (${a.i}, ${a.j})` : '—';
    const image = a ? a.image : -1;
    if (image === lastImage) return;
    lastImage = image;
    frame.setDev(state.devLayer, a ? `active #${a.image}` : '');
  };
  renderer.onDraw = mark;

  const setDevLayer = (on: boolean) => {
    state.devLayer = on;
    storeDevLayer(on);
    // The canvas may be asleep; label the active image right now.
    lastImage = -2;
    mark(renderer.activeImage());
  };

  // The button and the pane under it. `data-ui` keeps the canvas from taking their wheel events.
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.ui = '';
  button.setAttribute('aria-label', 'Tweaks');
  button.setAttribute('aria-expanded', 'false');
  button.className =
    'fixed top-4 right-4 z-30 grid size-9 cursor-pointer place-items-center rounded-full bg-black/45 text-white/90 shadow-sm backdrop-blur-md transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 aria-expanded:bg-black/70';
  button.innerHTML = SLIDERS_ICON;
  const panel = document.createElement('div');
  panel.dataset.ui = '';
  panel.id = 'canvas-tweaks';
  panel.className = 'fixed top-15 right-4 z-30 w-64';
  panel.hidden = true;
  button.setAttribute('aria-controls', panel.id);

  let pane: Promise<unknown> | null = null;
  const build = async () => {
    const { Pane } = await import('tweakpane');
    const p = new Pane({ container: panel, title: 'Canvas' });
    p.addBinding(state, 'devLayer', { label: 'Dev layer' }).on('change', (e) => setDevLayer(Boolean(e.value)));
    p.addBinding(state, 'active', { label: 'Active', readonly: true, interval: 100 });
    return p;
  };
  const open = (on: boolean) => {
    if (on) pane ??= build();
    panel.hidden = !on;
    button.setAttribute('aria-expanded', String(on));
  };
  // `hidden` may also be 'until-found' in the DOM types; only `false` means shown.
  const isOpen = () => panel.hidden === false;
  button.addEventListener('click', () => open(!isOpen()));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) open(false);
  });

  document.body.append(panel, button);
  mark(renderer.activeImage());

  return {
    devLayer: () => state.devLayer,
    setDevLayer,
    isOpen,
  };
}
