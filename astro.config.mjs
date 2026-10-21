// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // Self-hosted from src/assets/fonts, with a metric-matched fallback so nothing shifts when it loads.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'PP Neue Montreal',
      cssVariable: '--font-neue-montreal',
      fallbacks: ['sans-serif'],
      options: {
        variants: [
          { weight: 400, style: 'normal', src: ['./src/assets/fonts/PPNeueMontreal-Regular.woff2'] },
          { weight: 500, style: 'normal', src: ['./src/assets/fonts/PPNeueMontreal-Medium.woff2'] },
        ],
      },
    },
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});