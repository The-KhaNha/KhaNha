# Change intents

Every change that ships records how it moves each package's version, as one small file in this folder. The release
script (`npm run release`, run inside the release PR) consumes the files, bumps the versions, writes the CHANGELOGs and
deletes them. One file per change means two branches never conflict on the same lines.

Record one with:

```bash
npm run change -- --client minor --server patch "Store list and per-store menus behind the multi_store_ui flag."
```

which writes `.changes/<yyyymmdd>-<hhmmss>-<4hex>.md`:

```md
---
client: minor
server: patch
---

Store list and per-store menus behind the multi_store_ui flag.
```

Name only the packages the change affects. The summary is one line for the CHANGELOG, written for someone reading
the release notes.

## Which level

| Package | major                                                                                                                                                   | minor                                                                    | patch                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------- |
| server  | a breaking contract change for the deployed client (a field removed or renamed, a changed meaning or error code); should not happen, given CLAUDE.md §2 | a new endpoint, field, error code, setting or migration adding behaviour | a fix, performance, refactor, logging    |
| client  | a removed route, or persisted storage (`fp_cart`, `fp_cache`) reset without a migration                                                                 | a new user-visible feature or screen                                     | a fix, copy, style or performance change |

Before 1.0.0 the release script refuses a `major` without `--allow-major`.

## When an intent is needed

A PR that changes `client/src`, `server/src`, `server/scripts`, `server/supabase/migrations` or a `package.json`
adds one; the `version-intent` CI job checks it. Docs-only, CI and tooling changes need none: label the PR
`no-release` (Dependabot PRs carry it).
