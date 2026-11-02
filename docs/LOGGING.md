# Logging

There is one logger per package. `console.*` anywhere else fails lint (`no-console` is an error in both ESLint
configs; the client logger file is the only exception, set in `client/eslint.config.js`).

| Package | Logger                       | Library                                  |
| ------- | ---------------------------- | ---------------------------------------- |
| server  | `server/src/utils/logger.ts` | [pino](https://getpino.io) + `pino-http` |
| client  | `client/src/lib/logger.ts`   | a thin wrapper over the browser console  |

## Levels

| Level   | Use it for                                                                 | Examples in this app                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error` | a 5xx, or anything unexpected. Server: always with `err` (gives the stack) | unhandled error in a route, JWKS fetch failure, database unreachable                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `warn`  | expected but worth noticing; a degraded path                               | 401 / 403 responses, and the first 429 per key per window (it adds `limiter` and `keyedBy`: which limit refused, and whether it counted an account or an address; later 429s in that window are `debug`); "Feature flag rules malformed, flag off" (`{ flag }`, at most once per flags cache load); \"Menu truncated\" (`{ storeId, total, shown }`, when the menu passes `MENU_ITEMS_MAX`; at most once per cache load); `Client error` (a browser's report, [below](#client-error-reports)) |
| `info`  | lifecycle and business events                                              | API listening / shutting down, `Order placed`, `Order placement replayed` (a retried `idempotencyKey`), `Order status changed`, `Feature flag changed` (`{ key, enabled?, clientVisible?, rules?: [the rule names that changed], by }`), `Order status repeated` (a transition that had already happened: nothing changed, no event), 4xx such as `INSUFFICIENT_STOCK` or `INVALID_STATUS_TRANSITION`, access lines for writes and failures                                                   |
| `debug` | tracing while developing                                                   | access lines for successful reads (the menu, polled order lists) and for a failure logged at `debug`                                                                                                                                                                                                                                                                                                                                                                                          |

Successful `GET`s are logged at `debug` on purpose: the staff board polls every 4 s and the customer screens every
8 s, so at `info` they would flood production logs. For the same reason, a failure the error handler logs at `debug`
(a stale tab's 426, a 429 after the first in its window) takes its access line down to `debug` with it
(`loggedAtDebug` in `middleware/errorHandler.ts`, read by `accessLevel` in `app.ts`): a client that keeps asking writes
nothing above `debug`.

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
- A write also carries the id into the database, so the log line, the `domain_events` row and the `audit_log` row of one
  request can be matched ([SCHEMA.md](SCHEMA.md#audit_row_change)).
- Every access line also carries `clientVersion`: the request's `X-Client-Version` (`none` when it is missing or
  malformed; `server/src/middleware/clientVersion.ts`). It tells a stale browser tab from a current one.
- Log through `req.log` inside a request (controllers, middleware, the error handler). Every line then carries
  `req.id`. Use the module `logger` only outside requests (startup, shutdown, `scripts/seed.ts`).
- The client logs `requestId` from the response header when an API call fails, so a browser report can be matched to
  the server line.
- Other client events: `warn` "Session activity storage unavailable" (`features/auth/sessionActivity.ts`,
  `{ operation, error }`, once per session when `localStorage` refuses the write, so the client-side 7-day cap is off;
  locally `inactivity_timeout` still applies, on hosted Supabase Free nothing does, see ADR-011); `warn` "Session expired from inactivity" (`features/auth/authStore.ts`, `{ idleDays }`, once when
  an unused device is signed out after 7 days); `error` "Page chunk failed to load" (`components/PageBoundary.tsx`, once per failed lazy
  route); `debug` "Resource cache unavailable" (`lib/useResource.ts`, once per key when `localStorage` is full or
  blocked).

## How to log

- Pass structured fields first and a short constant message second:
  `req.log.info({ orderId, status }, 'Order status changed')`, not string concatenation.
- Log a failure once, at the boundary. `middleware/errorHandler.ts` logs every failed request. Services and
  controllers throw (`AppError` or the raw error) and do not also log it. Never log and rethrow. The level each
  error factory lands on is pinned by the table in `server/test/unit/errors.safe.test.ts`: a new factory gets a row.
- Do not log inside loops or on polling paths above `debug`.

## Error classes

| Error                                                             | Thrown by                                                                                                                             | Answer                                                                      | Logged                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `AppError` (factories in `utils/errors.ts`)                       | services, middleware                                                                                                                  | its status and code                                                         | 401/403 and a first 429 `warn`; a repeat 429 (`AppError.logLevel`) and 426 `debug`; other 4xx `info` |
| `IntegrationError { provider, operation, retryable, cause }`      | `utils/supabase.ts` `asDatabaseUnavailable` (the error handler applies it to every error), `middleware/auth.ts` (`JWKS_FETCH_FAILED`) | 503 `UPSTREAM_UNAVAILABLE`, `Retry-After: 5`                                | once, `error`                                                                                        |
| `RetryableError`, `PermanentError`                                | job handlers (`server/src/jobs/`)                                                                                                     | a retry or a dead letter ([JOBS.md](JOBS.md#handlers-and-the-runner))       | see [Jobs](#jobs)                                                                                    |
| `InvariantError` (a programmer error: a state assumed impossible) | the job runner's impossible states; any code that asserts one                                                                         | a job is dead-lettered; in a request, 500 `INTERNAL` like any unknown error | once, `error`; the job runner and the request log (`Request failed`) add `invariant: true`           |
| anything else                                                     | –                                                                                                                                     | 500 `INTERNAL`                                                              | once, `error`                                                                                        |

The database counts as unreachable when a call fails in transport: with `.throwOnError()`, postgrest-js retries an
idempotent read three times (1, 2, 4 s) and then rethrows undici's own `TypeError: fetch failed`, whose `cause` is the
socket error; a non-throwing call returns an error with an empty `code` and that same message. Timeouts
(`TimeoutError`, `AbortError`) count too. The `error` line carries `err` (serialized with `errWithCause`, so the
whole chain appears: `err.cause.message`, `err.cause.cause.message`), `route`, `status`, `code` and `userId`.
pino-http runs with `wrapSerializers: false` so its own `err` serializer cannot drop the cause.

## Jobs

The job runner (`server/src/jobs/runner.ts`) is the boundary for a job, as the error handler is for a request: it logs
each outcome once. Every line about a message carries `queue`, `jobId`, `eventId`, `eventType` and `attempt` (a child
logger, also handed to the handler); never the payload.

| Line                       | Level   | Fields                            | When                                                                                                         |
| -------------------------- | ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| "Job handled"              | `debug` | `durationMs`                      | the handler resolved and the message was deleted                                                             |
| "Job failed, retrying"     | `warn`  | `err`, `durationMs`, `retryInSec` | a retryable failure with attempts left                                                                       |
| "Job dead-lettered"        | `error` | `err`, `durationMs`, `invariant`  | the failure was recorded in `job_failures`: once, and only when `queue_dead_letter` says it took the message |
| "Job outcome not recorded" | `warn`  | `err`, `durationMs`               | the delete, retry or dead-letter call failed; the message comes back after its visibility timeout            |
| "Queue read failed"        | `warn`  | `err`, `queue`                    | once per outage                                                                                              |
| "Queue reachable again"    | `info`  | `queue`, `failedReads`            | the first good read after an outage                                                                          |

An empty poll logs nothing.

### The worker process

| Line                         | Level   | Fields                                                  | When                                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "Food Pickup worker running" | `info`  | `healthPort`, `queues`, `logLevel`, `version`, `commit` | the health port is listening                                                             |
| "Worker loop crashed"        | `error` | `err`                                                   | a `runQueue` loop threw (it should not); the process then exits 1                        |
| "Shutting down"              | `info`  | `signal`                                                | SIGTERM or SIGINT, once: API and worker alike (`utils/shutdown.ts`); repeats are ignored |
| "Shutdown failed"            | `error` | `err`                                                   | the stop function rejected; exit 1                                                       |

`GET /health` and a failed `queue_metrics` read are deliberately not logged: it is a polling path, and the depth is
`null` in the body when the read fails. A handler's own lines (`notifyHandler`'s `info` "Order event") use the logger it is
given.

## Client error reports

`POST /api/client-errors` ([API.md](API.md#post-client-errors)) writes one `warn` `Client error` line per report with
`{ kind, message, stack, route, at }`, plus the `clientVersion` every request line carries. Never `error`: a browser
cannot be allowed to page anyone. The body schema replaces anything shaped like a JWT, an `sb_…` key, a `Bearer`
value, a token or code in a URL parameter, an email address or a phone number (each matched loosely: a cut-short JWT, `%40`, a bracketed phone) in `message`, `stack` and `route` (cut to its path) with `[Redacted]` before the line is written (redaction below covers keys, not
strings), behind the client's own scrub; `server/test/api/client-errors.safe.test.ts` fails if a token-shaped string
reaches the log, and the same for an email or phone; `test/unit/client-errors-scrub.safe.test.ts` keeps the scrub linear on crafted input. `at` is the client's clock, as sent. At most 5 reports per request and `RATE_LIMIT_CLIENT_ERRORS_MAX` requests per address per window.

## Never logged

The server redacts these paths to `[Redacted]` (`REDACT_PATHS` in `server/src/utils/logger.ts`, tested in
`server/test/logging.safe.test.ts`):

- `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`
- `password`, `token`, `access_token`, `refresh_token`, `email`, `phone`, `SUPABASE_SECRET_KEY`, at the top level
  and one level down (`body.email`, `user.phone`, …)
- payment and pickup secrets, ahead of P5: `signature`, `checksum`, `secret`, `apiKey`, `api_key`, `key_secret`,
  `webhookSecret`, `webhook_secret`, `vpa`, `pickupCode`, `pickup_code`, `customerPhone`, `customer_phone`, and
  `headers.authorization` (an outbound call's headers), each at the top level and one level down

Redaction only covers object keys. Never put a token, password, email or phone number into a message string, and
never log a whole request body. On the client there is no redaction at all: never pass tokens or PII to `logger`.
