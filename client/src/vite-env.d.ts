/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The Supabase project the browser signs in to. Must be the same project the API's SUPABASE_URL points at. */
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable key (sb_publishable_...) of that project. Safe to ship: RLS keeps it out of every table. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
