// Values the web image sets at start (nginx/runtime-env.sh writes window.__RUNTIME_ENV__ in /runtime-env.js), so one
// image serves every environment. Each falls back to the build's VITE_ value (dev, the staging build, tests).

export interface RuntimeEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  LOG_LEVEL?: string;
  REQUEST_TIMEOUT_MS?: string;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Runtime wins over build; an unset or empty runtime value falls back to the build value. */
export function resolveRuntimeEnv(runtime: RuntimeEnv, build: RuntimeEnv) {
  return {
    supabaseUrl: nonEmpty(runtime.SUPABASE_URL) ?? nonEmpty(build.SUPABASE_URL),
    supabasePublishableKey:
      nonEmpty(runtime.SUPABASE_PUBLISHABLE_KEY) ?? nonEmpty(build.SUPABASE_PUBLISHABLE_KEY),
    logLevel: nonEmpty(runtime.LOG_LEVEL) ?? nonEmpty(build.LOG_LEVEL),
    requestTimeoutMs:
      positiveInt(nonEmpty(runtime.REQUEST_TIMEOUT_MS)) ??
      positiveInt(nonEmpty(build.REQUEST_TIMEOUT_MS)) ??
      DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

// Static property access on import.meta.env, so Vite still inlines each build value.
export const runtimeEnv = resolveRuntimeEnv(
  (typeof window === 'undefined' ? undefined : window.__RUNTIME_ENV__) ?? {},
  {
    SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    LOG_LEVEL: import.meta.env.VITE_LOG_LEVEL,
    REQUEST_TIMEOUT_MS: import.meta.env.VITE_REQUEST_TIMEOUT_MS,
  },
);
