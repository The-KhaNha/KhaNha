import { defineConfig, devices } from '@playwright/test';

// The WebKit smoke (e2e/smoke.spec.ts): Safari's engine, which the Playwright MCP passes (Chromium) never exercise.
// The spec mocks every /api call, so only the Vite dev server is needed; a server already on the port is reused.
const PORT = Number(process.env.VITE_DEV_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  // WebKit is the point; Chromium validates the spec itself on a host where WebKit cannot launch (WSL without its
  // system libraries) and in the app-breaker's env group.
  // Both at 360×640, the low-end Android target the budgets are measured at (CLAUDE.md §2b).
  projects: [
    {
      name: 'webkit',
      use: {
        ...devices['iPhone SE'],
        browserName: 'webkit',
        viewport: { width: 360, height: 640 },
      },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 5'],
        browserName: 'chromium',
        viewport: { width: 360, height: 640 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
