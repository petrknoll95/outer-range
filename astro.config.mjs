// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

/**
 * The local variants of one Timeless family, from `src/assets/fonts/timeless/<prefix><Name>[Italic].woff2`:
 * each named weight upright and in italic, but for the weights the family has no italic of.
 * @param {string} prefix
 * @param {Record<string, number>} weights
 * @param {string[]} [uprightOnly]
 */
function timeless(prefix, weights, uprightOnly = []) {
  /** @typedef {{ weight: number; style: 'normal' | 'italic'; src: [string] }} Variant */
  /** @type {(name: string, weight: number, style: Variant['style']) => Variant} */
  const variant = (name, weight, style) => ({ weight, style, src: [`./src/assets/fonts/timeless/${prefix}${name}.woff2`] });
  const variants = Object.entries(weights).flatMap(([name, weight]) => [
    variant(name, weight, 'normal'),
    ...(uprightOnly.includes(name) ? [] : [variant(`${name}Italic`, weight, 'italic')]),
  ]);
  return /** @type {[Variant, ...Variant[]]} */ (variants);
}

// https://astro.build/config
export default defineConfig({
  // GitHub Pages serves it from a subpath (the deploy workflow sets both); everywhere else it's at the root.
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH || '/',
  devToolbar: { enabled: false },
  // Self-hosted from src/assets/fonts/timeless, each with a metric-matched fallback so nothing shifts when it loads.
  // Every weight is declared; a browser only downloads the ones the page uses.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Timeless Sans',
      cssVariable: '--font-timeless-sans',
      fallbacks: ['sans-serif'],
      options: {
        variants: timeless('TimelessSans-Sans', { Light: 300, Regular: 400, Medium: 500, Semibold: 600, Bold: 700, Black: 800 }),
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Timeless Serif',
      cssVariable: '--font-timeless-serif',
      fallbacks: ['serif'],
      options: {
        variants: timeless('TimelessSerif-', { Thin: 100, Light: 200, Book: 300, Regular: 400, Medium: 500, Semibold: 600, Bold: 700 }, ['Thin']),
      },
    },
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});