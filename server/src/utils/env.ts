import 'dotenv/config';
import { z } from 'zod';

const seedPassword = (name: string) =>
  z.string().min(12, `${name} must be at least 12 characters.`).optional();

/**
 * The media store for an environment: the setting, or `local` on a developer's machine and `s3` elsewhere. null:
 * refused (`local` in production, where photos must outlive the container).
 */
export function resolveMediaStorage(
  appEnv: 'local' | 'staging' | 'production',
  setting: 's3' | 'local' | undefined,
): 's3' | 'local' {
  return setting ?? (appEnv === 'local' ? 'local' : 's3');
}

const envSchema = z
  .object({
    /** Which Supabase project this process talks to. `pnpm run seed` refuses to wipe `production`. */
    APP_ENV: z.enum(
      ['local', 'staging', 'production'],
      'APP_ENV must be one of local, staging, production.',
    ),
    // An env value is a string or missing, so the only type failure is a missing one.
    SUPABASE_URL: z
      .string('SUPABASE_URL is required (Project Settings → API, e.g. https://<ref>.supabase.co).')
      .url('SUPABASE_URL must be a URL such as https://<ref>.supabase.co.'),
    // The server reads and writes every table with the secret key; RLS keeps the publishable key out of all of them.
    SUPABASE_SECRET_KEY: z
      .string('SUPABASE_SECRET_KEY is required (Project Settings → API Keys → Secret keys).')
      .startsWith(
        'sb_secret_',
        'SUPABASE_SECRET_KEY must be a new-format secret key (sb_secret_...), not a legacy JWT key.',
      ),
    /** `production` in the API image (Dockerfile), where dev dependencies such as pino-pretty are not installed. */
    NODE_ENV: z.string().optional(),
    // Where to fetch the token signing keys, when SUPABASE_URL cannot be used for it. @supabase/server derives the JWKS
    // URL from SUPABASE_URL but accepts plain http only for localhost, so a container reaching the local stack at
    // http://host.docker.internal:54321 must name it here (compose.yaml does). Unset: derived from SUPABASE_URL.
    SUPABASE_JWKS_URL: z.string().url('SUPABASE_JWKS_URL must be a URL.').optional(),
    // Days a sign-in survives without use. Must equal auth.sessions.inactivity_timeout (168h) in
    // supabase/config.toml (hosted Supabase Free has no such setting: docs/adr/011-free-tiers.md); the client reads it
    // from GET /api/config.
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    PORT: z.coerce.number().int().positive().default(8000),
    /** The worker process's GET /health (src/worker.ts); the API never listens on it. */
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(8001),
    /** How long public reads (menu, store, site settings) stay in the per-process cache. 0 turns it off. */
    PUBLIC_READ_TTL_MS: z.coerce.number().int().min(0).max(600_000).default(10_000),
    // Proxies in front of the API whose X-Forwarded-For Express should trust (compose's nginx: 1). 0 trusts none, so
    // req.ip is the socket peer and a client cannot spoof its address.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    // Rate limits (middleware/rateLimit.ts), per fixed window. The campus Wi-Fi puts many customers behind one
    // address, so the per-address limits are flood guards only; the per-user write limit is the real one. 0 = off.
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    RATE_LIMIT_IP_MAX: z.coerce.number().int().min(0).default(600),
    RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(0).default(30),
    RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(0).default(10),
    RATE_LIMIT_CLIENT_ERRORS_MAX: z.coerce.number().int().min(0).default(30),
    RATE_LIMIT_INVITE_ACCEPT_MAX: z.coerce.number().int().min(0).default(10),
    /** Photo uploads started per signed-in account per window (P3.3). */
    RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().min(0).default(20),
    /**
     * Where uploaded photos live (P3.3): `s3` (S3 behind CloudFront, ADR-006) or `local`, a folder on this machine for
     * development. Unset: `local` when APP_ENV is local, else `s3`. `local` is refused in production.
     */
    MEDIA_STORAGE: z.enum(['s3', 'local'], 'MEDIA_STORAGE must be s3 or local.').optional(),
    /** The folder `local` media lives in (created on first write). */
    MEDIA_LOCAL_DIR: z.string().min(1).default('.media'),
    /** The `s3` store's bucket. Unset: every media call is a 503 (the API still starts). */
    MEDIA_BUCKET: z.string().min(1).optional(),
    /** The bucket's region; ignored by RustFS. */
    AWS_REGION: z.string().min(1).default('ap-south-1'),
    /** An S3-compatible server instead of AWS (RustFS in compose and CI). Unset on AWS. */
    MEDIA_S3_ENDPOINT: z.string().url('MEDIA_S3_ENDPOINT must be a URL.').optional(),
    /** The browser's view of MEDIA_S3_ENDPOINT when it differs from the API's (compose). */
    MEDIA_UPLOAD_ORIGIN: z.string().url('MEDIA_UPLOAD_ORIGIN must be a URL.').optional(),
    /**
     * Which payment provider new checkouts use (P5.1): `fake` (a provider of our own, for local, CI and staging) or
     * `none` (no provider: every checkout is 409 PAYMENTS_NOT_ENABLED). Unset: `none` in production, else `fake`.
     * `fake` is refused in production. P4's winner joins the list with its adapter.
     */
    PAYMENT_PROVIDER: z.enum(['none', 'fake'], 'PAYMENT_PROVIDER must be none or fake.').optional(),
    /** Signs the fake provider's webhooks. Unset outside local: the fake signs nothing and accepts no webhook. */
    FAKE_GATEWAY_SECRET: z
      .string()
      .min(16, 'FAKE_GATEWAY_SECRET must be at least 16 characters.')
      .optional(),
    /**
     * The origins CORS allows, comma-separated (P8 PR 05b): production's three hosts each keep their own sign-in, so
     * each is its own origin. One URL is a list of one.
     */
    CLIENT_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.split(',').map((o) => o.trim()))
      .pipe(
        z
          .array(
            z
              .url(
                'CLIENT_ORIGIN must be a URL such as http://localhost:5173, or a comma-separated list.',
              )
              // cors() compares the browser's Origin exactly, so a path or a trailing slash would never match. (A
              // value that is no URL at all is reported by .url() above.)
              .refine((o) => !URL.canParse(o) || new URL(o).origin === o, {
                message: 'CLIENT_ORIGIN entries must be origins: no path and no trailing slash.',
              }),
          )
          .min(1),
      ),
    /** The commit this build came from (image build arg); reported by GET /api/health. */
    GIT_COMMIT: z.string().min(1).default('unknown'),
    // Must exceed the load balancer's idle timeout (60 s on an ALB), or Node closes a kept-alive connection the
    // balancer is about to reuse and the next request fails with a 502.
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
    /** Minimum level written by utils/logger. Unset: debug on local, info on staging and production. */
    LOG_LEVEL: z
      .enum(
        ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
        'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent.',
      )
      .optional(),
    // The demo accounts' passwords on staging (local uses the ones published in README.md). Only scripts/seed.ts
    // reads them, and it refuses to seed staging without all four; the API server never needs them.
    SEED_STAFF_PASSWORD: seedPassword('SEED_STAFF_PASSWORD'),
    SEED_ADMIN_PASSWORD: seedPassword('SEED_ADMIN_PASSWORD'),
    SEED_CUSTOMER_PASSWORD: seedPassword('SEED_CUSTOMER_PASSWORD'),
    SEED_OWNER_PASSWORD: seedPassword('SEED_OWNER_PASSWORD'),
  })
  .transform((env) => ({
    ...env,
    LOG_LEVEL: env.LOG_LEVEL ?? (env.APP_ENV === 'local' ? 'debug' : 'info'),
    MEDIA_STORAGE: resolveMediaStorage(env.APP_ENV, env.MEDIA_STORAGE),
    PAYMENT_PROVIDER: env.PAYMENT_PROVIDER ?? (env.APP_ENV === 'production' ? 'none' : 'fake'),
    // A published value is safe only where the fake's webhooks cannot reach anything real: a developer's machine.
    FAKE_GATEWAY_SECRET:
      env.FAKE_GATEWAY_SECRET ??
      (env.APP_ENV === 'local' ? 'local-fake-gateway-secret' : undefined),
  }));

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // A blank value (`RATE_LIMIT_IP_MAX=` in .env or a host's settings) means unset. Coerced as is it would be 0, which
  // silently turns a rate limit or the read cache off instead of falling back to its default.
  const set = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value?.trim() !== ''),
  );
  const result = envSchema.safeParse(set);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // The logger is configured from this env, so it cannot report that the env is broken.
  process.stderr.write(
    `Invalid environment configuration. Check server/.env (see .env.example):\n${problems}\n`,
  );
  process.exit(1);
}

export const env = loadEnv();

/**
 * What a production API or worker must not start without (P8). Checked by the serving processes only, not by the
 * schema: `pnpm run seed --production` runs from a laptop with APP_ENV=production, a localhost origin and no commit.
 */
export function productionProblems(
  e: Pick<
    Env,
    | 'APP_ENV'
    | 'CLIENT_ORIGIN'
    | 'GIT_COMMIT'
    | 'TRUST_PROXY_HOPS'
    | 'MEDIA_STORAGE'
    | 'PAYMENT_PROVIDER'
  >,
): string[] {
  if (e.APP_ENV !== 'production') return [];
  const problems: string[] = [];
  if (!e.CLIENT_ORIGIN.every((o) => o.startsWith('https://')))
    problems.push('CLIENT_ORIGIN must be https in production (every CloudFront host).');
  if (e.GIT_COMMIT === 'unknown')
    problems.push(
      'GIT_COMMIT must be set in production (the image build arg), or /api/health cannot name the release.',
    );
  if (e.TRUST_PROXY_HOPS < 1)
    problems.push(
      "TRUST_PROXY_HOPS must be at least 1 in production, or every request shares the proxy's address in the rate limits.",
    );
  if (e.MEDIA_STORAGE === 'local')
    problems.push('MEDIA_STORAGE=local is for development: production stores photos in S3.');
  if (e.PAYMENT_PROVIDER === 'fake')
    problems.push(
      'PAYMENT_PROVIDER=fake marks orders paid with no money: production uses a real provider or none.',
    );
  return problems;
}

/** Called first by server.ts and worker.ts: a production process with an unsafe environment never starts. */
export function refuseUnsafeProduction(): void {
  const problems = productionProblems(env);
  if (problems.length === 0) return;
  process.stderr.write(
    `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`,
  );
  process.exit(1);
}
