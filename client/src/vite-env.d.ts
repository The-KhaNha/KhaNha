/// <reference types="vite/client" />

/** client/package.json version, injected by `define` (lib/appVersion.ts). */
declare const __APP_VERSION__: string;
/** Build commit (GIT_COMMIT at build time, else 'local'), injected by `define` (lib/appVersion.ts). */
declare const __APP_COMMIT__: string;

interface ImportMetaEnv {
  /** The Supabase project the browser signs in to. Must be the same project the API's SUPABASE_URL points at. */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable key (sb_publishable_...) of that project. Safe to ship: RLS keeps it out of every table. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Minimum level for lib/logger: debug, info, warn, error or silent. Unset: debug in dev, warn in builds. */
  readonly VITE_LOG_LEVEL?: string;
  /** Request timeout in ms for services/api.ts. Unset: 15000. */
  readonly VITE_REQUEST_TIMEOUT_MS?: string;
}

interface Window {
  /** Set by /runtime-env.js before the app loads (nginx/runtime-env.sh in the web image); read by lib/runtimeEnv.ts. */
  __RUNTIME_ENV__?: import('./lib/runtimeEnv').RuntimeEnv;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
