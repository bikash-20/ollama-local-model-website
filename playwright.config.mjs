// Playwright config — kept minimal so the test suite stays opt-in.
//
// The app itself ships with zero build step. This config exists *only* to
// let `npm test` drive a real browser against `index.html` served by a
// throwaway static server. The server is created per-run, so tests are
// hermetic and don't depend on the user having `python3 -m http.server`
// already running on a specific port.
//
// Usage:
//   npm install            # one-time
//   npx playwright install chromium   # one-time, downloads ~150MB browser
//   npm test               # run the suite

import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Single worker — these tests are fast and a shared in-memory state across
  // them would only confuse debugging if something fails.
  workers: 1,
  // Don't retry — we want the first failure visible, not a flake-camouflaged retry.
  retries: 0,
  // Slow-mo is off by default; flip on locally if a test flakes and you need
  // to watch what the browser is doing.
  reporter: [['list']],
  use: {
    // App is a single static HTML file; we serve it from a temp server below.
    baseURL: 'http://127.0.0.1:8765',
    trace: 'retain-on-failure',
    // The app renders an empty chat list at boot. Wait for *something* chat-
    // shaped to appear before considering the page interactive.
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  webServer: {
    // Pick whatever Python the user has on PATH. This matches the README's
    // recommended quick-start command (`python3 -m http.server`).
    command: 'python3 -m http.server 8765 --directory .',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  testDir: './tests',
});
