import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];

const APP_VERSION_DEFINE = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_COMMIT__: JSON.stringify(process.env.GIT_COMMIT ?? 'local'),
};

// The dev server proxies /api to the Express server so the client can use relative URLs.
export default defineConfig(({ mode }) => {
  // Fail the build (not the page in the browser) when the mode's Supabase project is not configured.
  // Mode "container" builds with placeholders: the web image sets the real values at start (lib/runtimeEnv.ts).
  const env = loadEnv(mode, process.cwd());
  const missing = mode === 'container' ? [] : REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} for mode "${mode}". Create client/.env.${mode} (see client/.env.example).`,
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    // lib/appVersion.ts; vitest.config.ts defines the same, or api.ts throws a ReferenceError in unit tests.
    define: APP_VERSION_DEFINE,
    // scripts/ci/check-bundle.mjs reads the manifest to size the initial chunk graph.
    build: { manifest: true },
    // Ports from client/.env.<mode> (VITE_DEV_PORT, VITE_API_PROXY_TARGET), so start.sh and the API can move together.
    // strictPort: a busy port is an error, not a silent move to the next one start.sh would not probe.
    server: {
      port: Number(env.VITE_DEV_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
          changeOrigin: true,
        },
        // Photos in local media mode (MEDIA_STORAGE=local) are served by the API.
        '/media': {
          target: env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
