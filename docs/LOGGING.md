# Logging

There is one logger per package. `console.*` anywhere else fails lint (`no-console` is an error in both ESLint
configs; the client logger file is the only exception, set in `client/eslint.config.js`).

| Package | Logger                       | Library                                  |
| ------- | ---------------------------- | ---------------------------------------- |
| server  | `server/src/utils/logger.ts` | [pino](https://getpino.io) + `pino-http` |
| client  | `client/src/lib/logger.ts`   | a thin wrapper over the browser console  |

## Levels

| Level   | Use it for                                                                 | Examples in this app                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error` | a 5xx, or anything unexpected. Server: always with `err` (gives the stack) | unhandled error in a route, JWKS fetch failure, database unreachable                                                                                                         |
| `warn`  | expected but worth noticing; a degraded path                               | 401 / 403 responses                                                                                                                                                          |
| `info`  | lifecycle and business events                                              | API listening / shutting down, `Order placed`, `Order status changed`, 4xx such as `INSUFFICIENT_STOCK` or `INVALID_STATUS_TRANSITION`, access lines for writes and failures |
| `debug` | tracing while developing                                                   | access lines for successful reads (the menu, polled order lists)                                                                                                             |

Successful `GET`s are logged at `debug` on purpose: the staff board polls every 4 s and the customer screens every
8 s, so at `info` they would flood production logs.

## Tuning per environment

| Environment           | Server `LOG_LEVEL` default | Server output          | Client `VITE_LOG_LEVEL` default |
| --------------------- | -------------------------- | ---------------------- | ------------------------------- |
| local (`npm run dev`) | `debug`                    | pretty (`pino-pretty`) | `debug`                         |
| staging               | `info`                     | JSON lines             | `warn`                          |
| production            | `info`                     | JSON lines             | `warn`                          |

- Server: set `LOG_LEVEL` in `server/.env` or the host's env: one of `fatal`, `error`, `warn`, `info`, `debug`,
  `trace`, `silent`. `utils/env.ts` validates it and fills in the default. `npm test` runs with `silent` unless
  `LOG_LEVEL` is set (`LOG_LEVEL=debug npm test`).
- Client: set `VITE_LOG_LEVEL` in `client/.env.<mode>`: one of `debug`, `info`, `warn`, `error`, `silent`. It is read
  at build time. In a production build `logger.debug` and `logger.info` are no-ops whatever the level says.

## Request ids

- `pino-http` gives every request an id. It keeps a caller's `x-request-id` if it is 1–64 characters of
  `[A-Za-z0-9_.-]`; otherwise it generates a UUID. The id is echoed in the `x-request-id` response header.
- Log through `req.log` inside a request (controllers, middleware, the error handler). Every line then carries
  `req.id`. Use the module `logger` only outside requests (startup, shutdown, `scripts/seed.ts`).
- The client logs `requestId` from the response header when an API call fails, so a browser report can be matched to
  the server line.
- Other client events: `error` "Page chunk failed to load" (`components/PageBoundary.tsx`, once per failed lazy
  route); `debug` "Resource cache unavailable" (`lib/useResource.ts`, once per key when `localStorage` is full or
  blocked).

## How to log

- Pass structured fields first and a short constant message second:
  `req.log.info({ orderId, status }, 'Order status changed')`, not string concatenation.
- Log a failure once, at the boundary. `middleware/errorHandler.ts` logs every failed request. Services and
  controllers throw (`AppError` or the raw error) and do not also log it. Never log and rethrow.
- Do not log inside loops or on polling paths above `debug`.

## Never logged

The server redacts these paths to `[Redacted]` (`REDACT_PATHS` in `server/src/utils/logger.ts`, tested in
`server/test/logging.safe.test.ts`):

- `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`
- `password`, `token`, `access_token`, `refresh_token`, `email`, `phone`, `SUPABASE_SECRET_KEY`, at the top level
  and one level down (`body.email`, `user.phone`, …)

Redaction only covers object keys. Never put a token, password, email or phone number into a message string, and
never log a whole request body. On the client there is no redaction at all: never pass tokens or PII to `logger`.
