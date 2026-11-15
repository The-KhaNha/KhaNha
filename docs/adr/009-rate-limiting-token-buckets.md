# ADR-009: Rate limiting per user in the API, in the database and at the edge

## Status

Accepted with amendments (2026-10-24), by the user: the API layer keeps `express-rate-limit` and env-sized limits;
`rate-limiter-flexible` arrives only with the shared Redis store.

## Date

2026-09-28 (proposed), 2026-10-24 (accepted)

## Context

R33 asks for abuse protection. Campus Wi-Fi puts thousands of students behind a handful of NAT addresses, so limits
keyed only by IP would block everyone at once. Some limits guard correctness (hoarding limited stock with unpaid
holds), not just load.

## Options considered

1. **In-process limits per key with `express-rate-limit` (shipped in P0), moving to a shared Redis store when API
   instances must share counts; database-enforced business limits; WAF rules at the edge.**
2. **`rate-limiter-flexible` token buckets now.** Rejected by the user: it replaces a working limiter that already
   gives the same 429 contract, for no measured need.
3. **IP-only limits.** Rejected: campus Wi-Fi puts thousands of students behind a handful of NAT IPs.

## Decision

Rate limiting has three layers:

- **In the API:** fixed-window limits per key with `express-rate-limit` (`server/src/middleware/rateLimit.ts`), in
  each process's memory. The real limits are per user; per-IP limits are generous. Every limit is deployment env
  (`RATE_LIMIT_*`, [docs/CONFIGURATION.md][configuration]). When more than two API instances run, counts must be
  shared: the API then moves to `rate-limiter-flexible` with a Redis store, chosen by `RATE_LIMIT_STORE=memory|redis`,
  with the same 429 contract.
- **In the database,** where correctness matters more than speed: for example at most N `PENDING_PAYMENT` orders per
  user, checked inside `create_checkout`.
- **At the edge:** AWS WAF managed rules, with rate-based rules only on the sensitive paths and set high.

Once the shared store exists, a request arriving while it is unavailable fails open for reads, and fails closed for
auth and money writes. An in-memory store cannot be unavailable.

## Consequences

- `trust proxy` must be set to the real hop count, so `req.ip` is the client and a spoofed `X-Forwarded-For` is
  ignored (`TRUST_PROXY_HOPS`, shipped in P0).
- A limited request gets 429 `RATE_LIMITED` with `Retry-After` and the draft-7 `RateLimit` headers, and
  `details: { kind: 'rateLimit', retryAfterSeconds }`; the server logs `warn` once per key per window.
- A fixed window can admit up to twice a limit across a window boundary. That is acceptable for abuse limits; the
  move to the shared store can switch to token buckets if a measurement says so.
- In-memory counts are per instance, which loosens every limit by the instance count until the shared store.
- The P9.1 load test must show 1000 simulated users behind one IP staying under the IP limit.

## Links

- [P1.6 Rate limiting and abuse protection v1][p1.6]
- [P9.1 Load testing from 100 to 1000 concurrent][p9.1]
- [P9.3 Edge protection and security review][p9.3]

[p1.6]: ../../plans/ROADMAP.md#p16-rate-limiting-and-abuse-protection-v1
[p9.1]: ../../plans/ROADMAP.md#p91-load-testing-from-100-to-1000-concurrent
[p9.3]: ../../plans/ROADMAP.md#p93-edge-protection-and-security-review
[configuration]: ../CONFIGURATION.md
