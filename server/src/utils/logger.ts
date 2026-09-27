import pino from 'pino';
import { env } from './env';

/**
 * Paths blanked out of every log line. `*.x` matches one level down (e.g. `body.email`, `user.phone`).
 * pino-http logs request headers, so the auth header and cookies are listed explicitly.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'email',
  'phone',
  'SUPABASE_SECRET_KEY',
  '*.password',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.email',
  '*.phone',
  '*.SUPABASE_SECRET_KEY',
];

// Pretty only in local development: the image (NODE_ENV=production) has no pino-pretty and writes JSON lines even
// when it points at the local stack.
const pretty = env.APP_ENV === 'local' && env.NODE_ENV !== 'production';

/** The one server logger. Level: LOG_LEVEL (see utils/env). Pretty in local dev, JSON lines everywhere else. */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { env: env.APP_ENV },
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  ...(pretty && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,env' },
    },
  }),
});
