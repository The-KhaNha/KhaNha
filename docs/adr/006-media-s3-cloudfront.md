# ADR-006: Media in S3 behind CloudFront

## Status

Proposed

## Date

2026-09-28

## Context

Menu photos are bundled in `client/public/images/` today, and CLAUDE.md §9 plans future user uploads for Supabase
Storage. R17 moves photos to S3 so restaurants can upload their own, and the CDN and hosting are on AWS anyway.

## Options considered

1. **S3 behind CloudFront, on the app's own origin.** Uploads by presigned POST, variants built by the worker.
2. **Supabase Storage.** Rejected: the roadmap asks for S3, and the CDN and hosting are on AWS anyway.

## Decision

Media lives in S3 behind CloudFront, served at `/media/*` on the app's own origin. Uploads go by presigned POST, and
the worker builds the variants. This replaces the Supabase Storage plan in CLAUDE.md §9.

- The bucket `food-pickup-media-<env>` is private and served through CloudFront with OAC.
- Keys are content-addressed, and each object is `public, max-age=31536000, immutable`, so a new photo is a new URL.
- The worker re-checks the real type, strips metadata and writes 400w and 900w WebP variants.

## Consequences

- `img-src 'self'` still holds, and no new runtime host is needed for viewing.
- Browser uploads straight to S3 add one `connect-src` / `form-action` host, a CLAUDE.md §9 change. Proxying uploads
  through the API avoids that host but puts upload bandwidth on the API instances; this is open in
  [Decisions needed][decisions-needed] (item 10, default presigned).
- CLAUDE.md §9 must be updated when this is accepted.
- Bundled photos are migrated per environment by a script, and removed only once every environment has migrated.
- Local development adds a `minio` service to compose, proxied at `/media` by Vite.

## Links

- [P3.3 Images on S3][p3.3]
- [P8.3 Media bucket and CDN][p8.3]
- [Docs and rule changes][docs-and-rule-changes]

[decisions-needed]: ../../plans/ROADMAP.md#decisions-needed
[p3.3]: ../../plans/ROADMAP.md#p33-images-on-s3
[p8.3]: ../../plans/ROADMAP.md#p83-media-bucket-and-cdn
[docs-and-rule-changes]: ../../plans/ROADMAP.md#docs-and-rule-changes
