# ADR-006: Media in S3 behind CloudFront

## Status

Accepted with amendments (2026-10-24), by the user: uploads are presigned; a local-disk store for development,
switched on by a runtime flag, sits alongside minio.

## Date

2026-09-28 (proposed), 2026-10-24 (accepted)

## Context

Menu photos are bundled in `client/public/images/` today, and CLAUDE.md §9 planned future user uploads for Supabase
Storage. R17 moves photos to S3 so restaurants can upload their own, and the CDN and hosting are on AWS anyway.

## Options considered

1. **S3 behind CloudFront, on the app's own origin.** Uploads by presigned POST, variants built by the worker.
2. **Supabase Storage.** Rejected: the roadmap asks for S3, the CDN and hosting are on AWS anyway, and on Supabase
   Free photo traffic would share the database's 5 GB monthly egress ([ADR-011][adr-011]).

## Decision

Media lives in S3 behind CloudFront, served at `/media/*` on the app's own origin. Uploads go by presigned POST, and
the worker builds the variants. This replaces the Supabase Storage plan in CLAUDE.md §9.

- The bucket `food-pickup-media-<env>` is private and served through CloudFront with OAC.
- Keys are content-addressed, and each object is `public, max-age=31536000, immutable`, so a new photo is a new URL.
- The worker re-checks the real type, strips metadata and writes 400w and 900w WebP variants.
- **Presigned uploads** (the roadmap's decision 10): the browser posts straight to the bucket, so upload bytes never
  pass through the API.
- **Local storage for development.** `MEDIA_STORAGE=s3|local` is a runtime env setting, default `s3`. With `local`,
  the API writes media to a folder on its host and serves it at `/media`, and uploads go through the API instead of a
  presigned post. The API refuses to start with `local` when `APP_ENV` is `production`. minio stays the default `s3`
  target in local compose and CI, so the presigned flow is exercised before staging; `local` is the switch for quick
  testing without it.

## Consequences

- `img-src 'self'` still holds, and no new runtime host is needed for viewing.
- Browser uploads straight to S3 add one `connect-src` / `form-action` host (CLAUDE.md §9).
- Two stores sit behind one media port: the S3 adapter (tested against minio) and the local adapter (tested in the
  API suite). The image pipeline above them is shared.
- Bundled photos are migrated per environment by a script, and removed only once every environment has migrated.
- Local development adds a `minio` service to compose, proxied at `/media` by Vite.

## Links

- [P3.3 Images on S3][p3.3]
- [P8.3 Media bucket and CDN][p8.3]
- [Docs and rule changes][docs-and-rule-changes]
- [ADR-011][adr-011] (Supabase Free limits)

[p3.3]: ../../plans/ROADMAP.md#p33-images-on-s3
[p8.3]: ../../plans/ROADMAP.md#p83-media-bucket-and-cdn
[docs-and-rule-changes]: ../../plans/ROADMAP.md#docs-and-rule-changes
[adr-011]: 011-free-tiers.md
