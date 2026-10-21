import { defineConfig, devices } from '@playwright/test';

const PORT = 4400;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    // Tests run against the production build: real image variants, no dev overlay.
    // vite preview (not astro preview, which detaches itself when run by tools) serves dist/ as is.
    command: `npm run build && npx vite preview --outDir dist --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 900_000,
  },
});
