# ADR-010: Live updates through polling plus Web Push

## Status

Proposed

## Date

2026-09-28

## Context

Customers track their order and staff watch the order board through polling today (`useResource`'s
`pollInterval`: staff 4 s, customer 8 s), paused while the tab is hidden, with ETags so an unchanged body is a
bodiless 304. The target users are on low-end Android phones on slow, flaky and metered connections. Some moments
(the order is ready, it was rejected, it is running late) matter even when the app is not open.

## Options considered

1. **Keep polling with ETags, and add Web Push for the moments that matter. SSE only if load tests show polling
   cost.**
2. **WebSockets now.** Rejected: a new stateful component for a need polling already meets.

## Decision

Keep polling with ETags, and add Web Push for the moments that matter. Add SSE (or Supabase Realtime) only if the
load tests show that polling drives database load or cost.

## Consequences

- No stateful connection layer for the pilot; the API stays stateless and horizontally scalable.
- Web Push is opt-in, with VAPID keys, a minimal service worker that handles push and notification clicks only and
  caches nothing, and the permission asked at a moment of intent. On iOS it needs the app installed to the home screen.
- Polling cost is watched: ETags, server-driven intervals (`pollAfterMs`) and delta polling for the staff board.
  A 304 still runs the query, so polling is the expected hot spot in P9.1.
- If realtime is added later, ETag polling stays as the fallback for flaky networks, and CLAUDE.md §2b/§2c change in
  the same change.

## Links

- [P6.3 Notifications][p6.3]
- [P6.4 Staff dashboard v2][p6.4], [P6.5 Customer order page v2][p6.5]
- [P9.1 Load testing from 100 to 1000 concurrent][p9.1]
- [P10.3 Realtime updates, if polling costs too much][p10.3]

[p6.3]: ../../plans/ROADMAP.md#p63-notifications
[p6.4]: ../../plans/ROADMAP.md#p64-staff-dashboard-v2
[p6.5]: ../../plans/ROADMAP.md#p65-customer-order-page-v2
[p9.1]: ../../plans/ROADMAP.md#p91-load-testing-from-100-to-1000-concurrent
[p10.3]: ../../plans/ROADMAP.md#p103-realtime-updates-if-polling-costs-too-much
