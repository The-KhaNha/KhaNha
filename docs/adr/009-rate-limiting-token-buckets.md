# ADR-009: Rate limiting with token buckets, database limits and WAF rules

## Status

Proposed

## Date

2026-09-28

## Context

R33 asks for abuse protection. Campus Wi-Fi puts thousands of students behind a handful of NAT addresses, so limits
keyed only by IP would block everyone at once. Some limits guard correctness (hoarding limited stock with unpaid
holds), not just load.

## Options considered

1. **In-process token buckets (switchable to Redis), plus database-enforced business limits, with WAF rules at the
   edge.**
2. **IP-only limits.** Rejected: campus Wi-Fi puts thousands of students behind a handful of NAT IPs.

## Decision

Rate limiting has three layers:

- **In the API:** token buckets per key with `rate-limiter-flexible`, in memory now and in Redis later, chosen by
  `RATE_LIMIT_STORE=memory|redis`. The real limits are per user; per-IP limits are generous. Every limit is a setting.
- **In the database,** where correctness matters more than speed: for example at most N `PENDING_PAYMENT` orders per
  user, checked inside `create_checkout`.
- **At the edge:** AWS WAF managed rules, with rate-based rules only on the sensitive paths and set high.

When the limiter's store is unavailable, reads fail open, and auth and money writes fail closed.

## Consequences

- `trust proxy` must be set to the real hop count, so `req.ip` is the client and a spoofed `X-Forwarded-For` is
  ignored.
- A limited request gets 429 `RATE_LIMITED` with `Retry-After`, `RateLimit-Policy` and `RateLimit` headers; the
  server logs `warn` once per key per window.
- In-memory buckets are per instance. The Redis store is needed once more than 2 API instances run.
- The P9.1 load test must show 1000 simulated users behind one IP staying under the IP bucket.

## Links

- [P1.6 Rate limiting and abuse protection v1][p1.6]
- [P9.1 Load testing from 100 to 1000 concurrent][p9.1]
- [P9.3 Edge protection and security review][p9.3]

[p1.6]: ../../plans/ROADMAP.md#p16-rate-limiting-and-abuse-protection-v1
[p9.1]: ../../plans/ROADMAP.md#p91-load-testing-from-100-to-1000-concurrent
[p9.3]: ../../plans/ROADMAP.md#p93-edge-protection-and-security-review
