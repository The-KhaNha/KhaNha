import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

// Separate from vite.config.ts, which refuses to load without a mode's Supabase env; unit tests need none.
export default defineConfig({
  plugins: [react()],
  // Same as vite.config.ts: lib/appVersion.ts reads these.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    // jsdom once per worker instead of once per file: the run went from ~15 s to ~5 s, every file still isolated in
    // its own VM context. In a VM, globals like window.location cannot be redefined: mock a module (lib/reloadPage).
    pool: 'vmThreads',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
