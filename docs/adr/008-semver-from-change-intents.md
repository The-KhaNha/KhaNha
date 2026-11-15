# ADR-008: Semantic versioning from change intents

## Status

Accepted (2026-10-24), by the user.

## Date

2026-09-28

## Context

R8 asks for semantic versions for the frontend and backend, with each change's version increment stored in a
temporary file and applied by a script. `client/package.json` and `server/package.json` are at `0.1.0` today.
Several branches are worked on in parallel.

## Options considered

1. **Committed change-intent files, applied by a bump script inside a release PR into `main`.**
2. **Bumping the version in every PR.** Rejected: version-line merge conflicts between parallel branches.

## Decision

Each package keeps its own semver line, bumped from committed change-intent files by a script inside a release PR
into `main`. `dev` receives the bump by back-merge.

- One file per change in `.changes/`, naming a level per package (`major`, `minor`, `patch`) and a summary. One file
  per change means two branches never conflict on the same lines.
- `release.mjs` takes the highest level per package, writes the versions and changelogs, deletes the consumed intents
  and records the tags to create (`client-vX`, `server-vY`).
- The bump happens only in a release PR, never in a feature PR and never as a bot commit on `main`. The user merging
  that PR is the production approval.

## Consequences

- A `version-intent` CI job fails a PR into `dev` that changes package source without an intent (unless labelled
  `no-release`), and checks release PRs.
- The back-merge from `main` into `dev` is conflict-free by construction, because `dev` never edits the `version`
  lines.
- Production deploys hang off the tags (P8.5). Staging builds are tagged `dev-<sha7>`, and `/api/health` reports the
  commit.
- Before 1.0.0, a `major` needs `--allow-major`: under the backward-compatibility rule it is a red flag.
- Both packages go to `1.0.0` at the pilot launch.

## Links

- [P0.3 Semantic versioning with change intents][p0.3]
- [P8.2 Container registry and image pipeline][p8.2]
- [P8.5 Continuous deployment][p8.5]
- [P9.5 Launch checklist and runbooks][p9.5]

[p0.3]: ../../plans/ROADMAP.md#p03-semantic-versioning-with-change-intents
[p8.2]: ../../plans/ROADMAP.md#p82-container-registry-and-image-pipeline
[p8.5]: ../../plans/ROADMAP.md#p85-continuous-deployment
[p9.5]: ../../plans/ROADMAP.md#p95-launch-checklist-and-runbooks
