import 'dotenv/config';
import { z } from 'zod';

/** The value shipped in .env.example. It must be replaced before the server will start. */
const JWT_SECRET_PLACEHOLDER = 'change-me-to-a-long-random-string';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (PostgreSQL connection string).'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters long.')
    .refine((secret) => secret !== JWT_SECRET_PLACEHOLDER, {
      message:
        'JWT_SECRET is still the placeholder from .env.example. Set a real secret, e.g. the output of `openssl rand -hex 32`.',
    }),
  PORT: z.coerce.number().int().positive().default(8000),
  CLIENT_ORIGIN: z
    .string()
    .url('CLIENT_ORIGIN must be a URL such as http://localhost:5173.')
    .default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration. Check server/.env (see .env.example):\n${problems}`);
  process.exit(1);
}

export const env = loadEnv();
