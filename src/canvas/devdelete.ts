import type { ActiveImage, ClientImage } from './renderer';

interface DevDeleteApi {
  images: readonly ClientImage[];
  activeImage: () => ActiveImage | null;
  /** Whether the canvas is the view showing. */
  onCanvas: () => boolean;
  /** Keep the view for the reload, so it comes back to it with no intro; or don't. */
  holdView: (hold: boolean) => void;
}

/**
 * Dev only (main.ts loads it under `astro dev`): "X" deletes the active image for good, its
 * content entry, project listing, manifest entry and files (scripts/dev/delete-image.mjs), then
 * reloads, back in the same view. Not listed anywhere; a note in the corner says what happened.
 */
export function attachDevDelete(api: DevDeleteApi): void {
  const note = document.createElement('div');
  note.className =
    'pointer-events-none fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-2 font-mono text-[11px] leading-4 text-white opacity-0 transition-opacity';
  document.body.append(note);
  let hide = 0;
  const say = (text: string, error = false) => {
    note.textContent = text;
    note.style.color = error ? '#ff4d6d' : '';
    note.style.opacity = '1';
    clearTimeout(hide);
    hide = window.setTimeout(() => (note.style.opacity = '0'), error ? 6000 : 3000);
  };

  let busy = false;
  window.addEventListener('keydown', async (e) => {
    if (e.key.toLowerCase() !== 'x' || e.repeat || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || busy) return;
    if (!api.onCanvas()) return;
    const active = api.activeImage();
    const id = active && api.images[active.image]?.id;
    if (!id) return;
    e.preventDefault();
    busy = true;
    say(`Deleting ${id}…`);
    // Before the request: the dev server may reload as soon as it sees the files go.
    api.holdView(true);
    try {
      const res = await fetch('/__dev/delete-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      say(`Deleted ${id}. Reloading…`);
      // The dev server may reload on its own once it sees the files go; this makes sure.
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      busy = false;
      api.holdView(false);
      say(`Couldn't delete ${id}: ${error instanceof Error ? error.message : error}`, true);
    }
  });
}
