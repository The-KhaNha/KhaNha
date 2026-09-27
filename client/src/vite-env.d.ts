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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
