import { runtimeEnv } from './runtimeEnv';

/* The one client logger. Never pass tokens, passwords, emails or phone numbers: browser consoles get screenshotted. */

const LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type LogLevel = (typeof LEVELS)[number];

/** LOG_LEVEL (runtime) or VITE_LOG_LEVEL if it names a level; otherwise debug in dev and warn in staging and production builds. */
export function resolveLevel(configured: string | undefined, dev: boolean): LogLevel {
  const match = LEVELS.find((level) => level === configured);
  return match ?? (dev ? 'debug' : 'warn');
}

const threshold = LEVELS.indexOf(resolveLevel(runtimeEnv.logLevel, import.meta.env.DEV));
const enabled = (level: LogLevel) => LEVELS.indexOf(level) >= threshold;
const noop = () => {};

type Log = (message: string, context?: Record<string, unknown>) => void;
type Level = Exclude<LogLevel, 'silent'>;

const write =
  (level: Level): Log =>
  (message, context) => {
    if (enabled(level)) console[level](message, context ?? '');
  };

// In a production build import.meta.env.PROD is the constant `true`, so debug and info become no-ops.
export const logger: Record<Level, Log> = {
  debug: import.meta.env.PROD ? noop : write('debug'),
  info: import.meta.env.PROD ? noop : write('info'),
  warn: write('warn'),
  error: write('error'),
};
