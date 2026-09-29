import 'dotenv/config';
import { z } from 'zod';

const seedPassword = (name: string) =>
  z.string().min(12, `${name} must be at least 12 characters.`).optional();

const envSchema = z
  .object({
    /** Which Supabase project this process talks to. `npm run seed` refuses to wipe `production`. */
    APP_ENV: z.enum(['local', 'staging', 'production'], {
      errorMap: () => ({ message: 'APP_ENV must be one of local, staging, production.' }),
    }),
    SUPABASE_URL: z
      .string({
        required_error:
          'SUPABASE_URL is required (Project Settings → API, e.g. https://<ref>.supabase.co).',
      })
      .url('SUPABASE_URL must be a URL such as https://<ref>.supabase.co.'),
    // The server reads and writes every table with the secret key; RLS keeps the publishable key out of all of them.
    SUPABASE_SECRET_KEY: z
      .string({
        required_error:
          'SUPABASE_SECRET_KEY is required (Project Settings → API Keys → Secret keys).',
      })
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
    CLIENT_ORIGIN: z
      .string()
      .url('CLIENT_ORIGIN must be a URL such as http://localhost:5173.')
      .default('http://localhost:5173'),
    /** The commit this build came from (image build arg); reported by GET /api/health. */
    GIT_COMMIT: z.string().min(1).default('unknown'),
    // Must exceed the load balancer's idle timeout (60 s on an ALB), or Node closes a kept-alive connection the
    // balancer is about to reuse and the next request fails with a 502.
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
    /** Minimum level written by utils/logger. Unset: debug on local, info on staging and production. */
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
        errorMap: () => ({
          message: 'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent.',
        }),
      })
      .optional(),
    // The demo accounts' passwords on staging (local uses the ones published in README.md). Only scripts/seed.ts
    // reads them, and it refuses to seed staging without all three; the API server never needs them.
    SEED_STAFF_PASSWORD: seedPassword('SEED_STAFF_PASSWORD'),
    SEED_ADMIN_PASSWORD: seedPassword('SEED_ADMIN_PASSWORD'),
    SEED_CUSTOMER_PASSWORD: seedPassword('SEED_CUSTOMER_PASSWORD'),
  })
  .transform((env) => ({
    ...env,
    LOG_LEVEL: env.LOG_LEVEL ?? (env.APP_ENV === 'local' ? 'debug' : 'info'),
  }));

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
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
