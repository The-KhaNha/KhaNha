# P8 — Infrastructure and delivery: implementation plan

The PR-by-PR plan for [ROADMAP.md P8](ROADMAP.md#p8--infrastructure-and-delivery): a production environment on AWS
that anyone can rebuild from the repository, with every release deployed to it by a pipeline. The roadmap says what
P8 builds and why; this file says in which order, in which pull requests, with which files, checks and user steps,
and where P8 deliberately builds less than the roadmap describes (each with its reason and what picks it up). When a
PR merges, tick its box here and in the roadmap.

> **Status: proposal, with its shape decided** (the user, 11 November 2026):
>
> - **The budget.** AWS is paid from $140 of credits that must last at least four months: everything on AWS stays
>   under about **$35 a month**.
> - **Production only, to start.** One small host, no load balancer. **There is no staging on AWS at first**:
>   staging stays what it is today, the Supabase staging project with the app run locally against it. An AWS
>   staging follows one to two months after the first release ([Later: staging on AWS](#later-staging-on-aws)).
> - **Scaling comes with funding**: larger instances, replicas, possibly EKS
>   ([When there is funding to scale](#when-there-is-funding-to-scale)).
>
> [ADR-007](../docs/adr/007-pilot-on-ec2-compose.md) and [ADR-011](../docs/adr/011-free-tiers.md) were amended the
> same day to say so. At about $13 a month the credits last roughly ten months. The remaining
> [decisions](#decisions) are open; what must be asked first is in the next section.

## Ask the user before starting

Whoever starts this plan, a person or an agent, **asks the user these questions first**, in one batch, and writes
the answers into the [Decisions](#decisions) table before opening the pull request each one gates. None of them has
a safe default, and none can be found in the repository.

| #   | Ask                                                                                                                                                                                                                                           | Needed before                                    | Decision |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| 1   | Which email address should receive the budget alert and the alarms?                                                                                                                                                                           | PR 01                                            | D10      |
| 2   | In the AWS console: on what date do the credits expire, and does the account stay open when they run out? Do the credits cover EC2, public addresses, ECR, S3, CloudFront, CloudWatch and Secrets Manager?                                    | PR 01                                            | –        |
| 3   | Do the Mumbai (ap-south-1) prices in the AWS pricing calculator match the [budget table](#the-budget)? If the total comes out above $35 a month, stop and say so                                                                              | PR 01                                            | –        |
| 4   | Is one AWS account, the one holding the credits, right? Which account is it?                                                                                                                                                                  | PR 01                                            | D1       |
| 5   | **Create the host now?** Its apply is the day the bill starts (about $11.50 a month). Suggested: about a month before launch                                                                                                                  | PR 04 (PRs 00–03 and 06 cost nothing and can go) | D11      |
| 6   | What is the production domain name? Needed before PR 05 if CloudFront cannot use a private origin onto the host (the origin then needs a hostname and certificate)                                                                            | PR 05                                            | D3       |
| 7   | Has the production Supabase project been created (organisation `KhaNha`, ap-south-1), and is its secret key in the production secret? It is created only shortly before the first release: a free project with no traffic pauses after 7 days | the first production release                     | –        |

An agent asks with one batched question, never by guessing, and never proceeds past a gate on an unanswered row.
If the answer to 2 or 3 changes the budget's picture, the plan is revised before any resource exists.

## How the team works P8

The standing rules apply (CLAUDE.md §13–§21), with these differences from a product phase:

- **Everything P8 builds is production**, so CLAUDE.md §2 governs all of it: the agent writes Terraform, workflows
  and host scripts, and **never applies, deploys, migrates or seeds**. Every apply and every deploy is a pipeline
  run that waits for the user's approval in GitHub. The one thing run outside the pipeline is the bootstrap of the
  account, which the user runs once with their own credentials. The agent holds no AWS credentials at all.
- **Every P8 PR goes straight into `dev`**, with no phase branch: the workflows have to be on `dev` (and reach
  `main` with a release) to run. Each PR is small, branches from a fresh `origin/dev` as `feat/p8-<NN>-<slug>`, and
  then work stops until the user says it is merged.
- **Every PR that adds something to AWS states what it costs a month**, in its description, against the
  [budget](#the-budget). A PR that would take the month past $35 is put to the user before it is opened.
- **Nothing here is tried on a staging first, so each piece is proven before it reaches the host**: host scripts
  under test with a fake `docker`, the compose file held to `compose.yaml` by a parity test, the deploy smoke run
  against the local compose stack in CI, the images smoke-tested on arm64 in CI. Then production runs **dark**
  (deployed, no users) until launch, and the drills in [Closing P8](#closing-p8) happen in that window.
- **Gate.** Infrastructure, workflow and docs PRs use the root gate (`pnpm run format:check && pnpm test`) plus
  `terraform fmt -check` and `terraform validate`, and are labelled `no-release`. A PR that touches `server/src`
  (06, 08) runs that package's full gate and records an intent.
- **Secrets never enter the repository, the Terraform state, an image or a log.** Terraform creates the place a
  secret lives; the user puts the value there.

## Where P8 starts

| Roadmap step       | Already there                                                                                                                                                                                                                                                                                       | Left for P8                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P8.1 foundation    | nothing: no `infra/`, no Terraform, no AWS account in use, no OIDC, no `id-token` permission in any workflow                                                                                                                                                                                        | all of it                                               |
| P8.2 images        | `client/Dockerfile` (nginx, unprivileged, runtime environment written to `/runtime-env.js` at start) and `server/Dockerfile` (one image; the command picks `api` or `worker`); `ci.yml`'s `images` job builds both for amd64, smoke-tests them and checks their size, and pushes nothing            | a registry, arm64 builds, a push on every release       |
| P8.3 media and CDN | nginx serves `/assets/` immutable and `/index.html` uncached, proxies `/api/`, answers `/healthz`; security headers at nginx, CSP Report-Only                                                                                                                                                       | the CDN, the certificate, the media bucket              |
| P8.4 compute       | `compose.yaml` (`web`, `api`, `worker`); `GET /api/health` (version and commit, no database), `GET /api/ready` (503 when the database is slow), the worker's `/health`; `TRUST_PROXY_HOPS`; a 10 s graceful shutdown                                                                                | a host, the deploy mechanism                            |
| P8.5 delivery      | `ci.yml` with `ci-ok`; `release.yml` (the release PR into `main`, the `client-v*` and `server-v*` tags, the back-merge); nothing is deployed anywhere, and `main` still holds only the setup commit                                                                                                 | the production deploy workflow                          |
| P8.6 secrets       | `utils/env.ts` validates every variable and refuses to start on a bad one; it has no production-only refusals; the only GitHub secrets are the release App's                                                                                                                                        | hosted secrets and configuration, the production guards |
| P8.7 observability | pino JSON on stdout with request ids and redaction (`docs/LOGGING.md`); the worker reports queue depth and age on `/health` only; client errors arrive at `POST /api/client-errors`; no metrics, no alarms                                                                                          | log shipping, metrics, alarms, a dashboard              |
| Supabase           | read on 11 November 2026: **staging** is `xkddnlxeeizaqpefhqlv` in the `KhaNha` organisation (free plan), **ap-south-1 (Mumbai)**, healthy, all 19 migrations applied, 12 MB of its 500 MB, 14 of 60 connections. **There is no production project**, and `PRODUCTION_REF` in `db-push.sh` is empty | the production project (a user step, at PR 04)          |

## What gets built

[ADR-007](../docs/adr/007-pilot-on-ec2-compose.md) as amended. **One EC2 host** (`t4g.micro`) running `web`, `api`
and `worker` with docker compose; **CloudFront** in front of it for HTTPS and caching, reaching the host directly,
with nothing else able to; images in **ECR**; media in **S3**; logs, metrics and alarms in CloudWatch; GitHub
Actions planning, applying and deploying through OIDC roles and SSM, each run approved by the user. One AWS account,
where the credits are, in the Supabase projects' region.

There is no load balancer, no Auto Scaling group, no second host and no AWS staging. The Terraform is still cut as
modules used by one small root per environment, so the staging that follows the release is the same modules with
other variables, and a load balancer later replaces one module's inside, not the layout.

```text
infra/
  README.md                      how to bootstrap, plan, apply, deploy, roll back; what each thing costs
  terraform/
    bootstrap/                   run once by the user: state bucket, GitHub OIDC, the roles, the $35 budget alert
    modules/{network,ecr,iam,compute,secrets,media,cdn,observability}/
    envs/production/             the one root, for now (envs/staging follows the release)
  host/
    compose.prod.yml             web, api, worker from ECR tags, each with a memory limit
    render-env.sh                Parameter Store and Secrets Manager -> an env file on tmpfs
    apply-release.sh             take candidate tags (or the parameter's), pull, up, wait for /api/ready, else go back to the parameter's
.github/workflows/
  infra.yml                      plan on a PR; apply after the user's approval
  deploy-production.yml          on a release tag: build, push, wait for the user, deploy, smoke
```

## The budget

Decided by the user on 11 November 2026 and recorded in
[ADR-011](../docs/adr/011-free-tiers.md#aws-paid-from-credits-from-p8): $140 of credits, at least four months, so
**about $35 a month at most**.

| What                                                                  | About, per month | Note                                                                                               |
| --------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| One `t4g.micro` host (2 vCPU, 1 GB), standard CPU credits             | $6               | $0.0084 an hour on AWS's page on 11 November 2026; Mumbai's price may differ a little              |
| Its public address and its 16 GB disk                                 | $5               | from list prices as remembered                                                                     |
| One secret in Secrets Manager                                         | $0.40            |                                                                                                    |
| Images (ECR), buckets (S3), the CDN (CloudFront), parameters, deploys | under $1         | CloudFront's and S3's standing free allowances cover pilot traffic; ECR keeps the newest 10 images |
| Logs, metrics, alarms                                                 | $0 to $1         | inside CloudWatch's free allowances: about ten alarms and ten metrics                              |
| A DNS zone                                                            | $0.50            | the domain's own registration is probably not payable from credits                                 |
| **Production, as planned**                                            | **about $13**    | the credits last roughly ten months; more than twice the four the user asked for                   |
| With a staging on AWS later                                           | about $26        | still under $35                                                                                    |

**It fits with wide room, on these conditions:**

- one host and no load balancer (a load balancer is about $16 to $22 a month plus its addresses: more than the
  whole of today's estimate);
- the host in **standard** CPU-credit mode. T4g hosts default to "unlimited", which bills $0.04 per vCPU-hour for
  sustained bursts; standard mode slows down instead of charging;
- alarms and metrics kept to what CloudWatch gives free.

**Checks before the first resource exists** (user steps, below): the figures in the AWS pricing calculator for
ap-south-1; the date the credits expire, and whether the account stays open when they run out (newer AWS accounts
on a free plan can be closed at that point); and whether credits cover everything used here.

**Room that is there if wanted**, none of it needed by the estimate: `t4g.small` (2 GB) is about $12 instead of $6
and still leaves the total near $19; AWS also lists `t4g.small` as free for 750 hours a month until
31 December 2026.

## Build order

| #   | PR                                              | Step       | Depends on         | Size (files / lines) | Adds, per month            |
| --- | ----------------------------------------------- | ---------- | ------------------ | -------------------- | -------------------------- |
| 00  | The decisions, written down                     | docs       | the user's answers | docs only            | –                          |
| 01  | Terraform skeleton, the bootstrap, and their CI | P8.1       | 00                 | 18 / 520             | cents (state)              |
| 02  | Network, registry and roles                     | P8.1, P8.2 | 01, bootstrap run  | 14 / 480             | cents                      |
| 03  | arm64 images, proven in CI                      | P8.2       | –                  | 6 / 220              | –                          |
| 04  | The host, its configuration and its secret      | P8.4, P8.6 | 02, D11            | 18 / 620             | **about $11.50**           |
| 05  | The edge: CDN, certificate, media bucket        | P8.3       | 04                 | 14 / 520             | about $1 with the DNS zone |
| 06  | Production guards in the server                 | P8.6       | –                  | 5 / 160              | –                          |
| 07  | Deploy to production from a release             | P8.5       | 03, 04, 05, 06     | 12 / 480             | –                          |
| 08  | Logs, metrics, alarms                           | P8.7       | 07                 | 16 / 600             | $0 to $1                   |

Why this order: PRs 00–03 and 06 cost nothing by the hour and can be done any time after
[P1.8](P1_8_PNPM.md). **PR 04 is the day the bill starts**, so it waits for the user's word (D11). From there the
host comes before the edge, because CloudFront needs its origin; the deploy workflow comes when there is somewhere
to deploy to; and observability lands on a running, dark production, where its alarms can be seen firing once.

## Cross-cutting decisions

- **The budget is a design input, not a hope.** Each choice below that differs from the roadmap's picture is there
  because of it, and the bootstrap's budget alert (50%, 80% and 100% of $35) is the guard.
- **Staging is not on AWS.** Until the staging that follows the release, staging is the Supabase staging project,
  with the app run locally against it (`./run.sh staging`), exactly as today. Its migrations are still pushed by
  hand (`pnpm run db:push:staging`). Nothing in P8 changes how a phase is tested.
- **One Terraform root per environment, shared modules, no workspaces.** State lives in one S3 bucket, a key per
  environment, with S3's native lock file; no DynamoDB table.
- **Three GitHub roles, each tied to a GitHub Environment** in its trust policy, never to a branch name or a pull
  request: `plan` (read-only, used on pull requests), `apply` and `deploy` (both in Environments that need the
  user's approval). A workflow run on a fork's code can assume none of them.
- **The repository is public, so plans and logs are public.** Terraform never holds a secret value (only the
  container for it), account-specific values come from GitHub Environment variables, and no workflow prints an
  environment file.
- **One image per commit.** The web image takes its environment at start (P0.6), the server image from its
  environment file. Production runs images built from `main` at the release commit, tagged `<version>-<sha7>`.
  Tags are immutable.
- **arm64 host, arm64 images**, built on GitHub's arm64 runners, which are free for a public repository. Nothing is
  ever built on the host: 1 GB is for running the app.
- **The release is one small parameter.** `/food-pickup/production/release` in Parameter Store holds the two image
  tags of **the last release that passed**, and it is written last. A deploy sends the candidate tags to the host as
  the command's own parameters; the host applies them, and only after the public smoke passes does the workflow write
  them to the parameter. A failed deploy leaves the parameter alone, so a replaced host, which reads it when it
  boots, can never pick up a release that failed. Rolling back is a deploy of the earlier tags. The compose file and
  the host scripts travel inside the deploy document, so changing them updates the document, not the machine.
- **A deploy is a short outage, by decision.** With one host and no load balancer, `docker compose up -d` means a
  few seconds of errors. The smoke test waits for it. This is the first thing a second host removes.
- **Migrations before code, only forwards, and by the user.** The production workflow waits while the user runs
  `pnpm run db:push:production` (CLAUDE.md §2). Expand and contract (the PR template's checkbox) is what makes
  "migrate, then deploy" and "roll back the code, not the database" both safe.
- **Metrics come from the logs the app already writes.** CloudWatch metric filters read the access line and the
  worker's lines; no metrics library, no agent, and one new log line (queue depth and each process's memory, every
  few minutes). The one exception is the host's own memory, which no log line can see: a small timer on the host
  publishes it (PR 08).

## Where P8 builds less than the roadmap

Approved with the plan. The roadmap's P8 section and its deployment diagram are updated to match in PR 00. Rows
marked **decided** follow from the user's decisions of 11 November 2026.

| Roadmap says                                                                                | P8 does                                                                                                                                                                                      | Picked up by                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P8 "reproducible staging and production"; `dev` deploys staging on every merge              | **decided:** production only. Staging stays the Supabase project with a locally run app; no `deploy-staging.yml`                                                                             | one to two months after the first release ([below](#later-staging-on-aws)) |
| P8 staging ready before P5.4, because webhooks need a public HTTPS address                  | not available from P8. P5's plan chooses: a tunnel to a local stack for the provider's sandbox, or the AWS staging brought forward                                                           | the P5 plan                                                                |
| P8.1 separate AWS accounts for staging and production under an Organization                 | **decided:** one account, where the credits are                                                                                                                                              | funding; a second account when staging and real payments share AWS         |
| P8.1 CI runs `tflint` and `checkov`                                                         | `terraform fmt`, `validate`, and the `trivy config` scan `ci.yml` already runs, extended to `infra/`                                                                                         | a class of mistake those two would have caught                             |
| P8.1 remote state "with locking" (implies a lock table)                                     | S3's own lock file                                                                                                                                                                           | –                                                                          |
| P8.1 private subnets reserved for later                                                     | not created (nothing uses them)                                                                                                                                                              | the load balancer, when it returns                                         |
| P8.2 staging images `dev-<sha7>` built on every merge to `dev`                              | **decided:** not built; `ci.yml` builds and smoke-tests arm64 images on pull requests, pushing nothing                                                                                       | the AWS staging                                                            |
| P8.2 keep the last 30 images; every push scanned by Inspector                               | **decided:** keep the newest 10; ECR's basic scan on push, plus `security.yml`'s weekly `trivy image`                                                                                        | P9.3 (security review)                                                     |
| P8.3 a release-assets bucket serving `/assets/*`, old chunks kept 30 days                   | `/assets/*` comes from the web container through CloudFront (immutable, cached a year at the edge); a tab left open across a deploy reloads once (`PageBoundary`, the reload P1 PR 21 added) | client error reports showing chunk failures after deploys                  |
| P8.3 the WAF web ACL                                                                        | not attached (about $5 a month and up)                                                                                                                                                       | P9.3, with its price put to the user                                       |
| P8.4 an Auto Scaling group of 1 to 2 hosts behind a load balancer; rolling deploys          | **decided:** one EC2 host, CloudFront straight to it, a deploy with a few seconds of errors (ADR-007 as amended)                                                                             | funding, or P9.1 showing one host is not enough                            |
| P8.4 `t4g.small` (2 GB)                                                                     | **decided:** `t4g.micro` (1 GB), standard credits, memory limits per container, a swap file                                                                                                  | the memory alarm (PR 08); `t4g.small` still fits                           |
| P8.4 services `web`, `api`, `worker` **and `reconciler`**, with a `leases` table            | three services; no reconciler and no lease                                                                                                                                                   | P5.10                                                                      |
| P8.4 backups: Supabase daily backups and PITR                                               | not in P8: the free tier has neither (ADR-011)                                                                                                                                               | P9.5 (a scheduled dump), roadmap decision 14                               |
| P8.5 smoke: a Playwright golden path and a k6 run after each staging deploy                 | HTTP checks after each production deploy (PR 07); production gets no test orders                                                                                                             | the AWS staging (browser smoke), P9.1 (k6)                                 |
| P8.5 hotfix flow                                                                            | unchanged from P0.3; it deploys through the same production workflow                                                                                                                         | –                                                                          |
| P8.6 secrets for payments, pickup codes, push, SMS and email; their guards                  | one secret holding one key today (`SUPABASE_SECRET_KEY`); each later secret is one more key in it, added by its phase                                                                        | P5, P6                                                                     |
| P8.6 rotation runbooks                                                                      | the "how to change a secret" paragraph in `infra/README.md`                                                                                                                                  | P9.5                                                                       |
| P8.7 metrics as Embedded Metric Format lines; business and pipeline metrics                 | metric filters on existing log lines for HTTP and queues, kept to about ten metrics; business metrics arrive with the features that produce them                                             | P5, P6                                                                     |
| P8.7 tracing through OpenTelemetry                                                          | not built (the roadmap marks it optional)                                                                                                                                                    | P10.4                                                                      |
| P8.7 real-user performance (`web-vitals`, `POST /api/client-metrics`, `rum_sample_percent`) | not built: there are no real users to measure before the pilot                                                                                                                               | P9, with the launch checklist                                              |
| P8.7 alarms on payments, webhooks, reconciliation and failed cron runs                      | the alarms whose signals exist: errors, latency, dead letters, queue age, the host down, memory, CPU credits, the certificate                                                                | P5 (money), P9.5 (cron)                                                    |
| P8.7 the SLOs                                                                               | written into `docs/DEPLOYMENT.md` as targets; measured from the pilot                                                                                                                        | P9                                                                         |

## The pull requests

### PR 00 — The decisions, written down

- [ ] Merged

Docs only (`no-release`). The two ADR amendments P8 needed are **made** (the user, 11 November 2026; see
[ADRs this plan touches](#adrs-this-plan-touches)), so this PR brings the rest into line with them:
`docs/DEPLOYMENT.md` gains a "Hosted environments" section (the account, ap-south-1, the domain, the size, the
budget, and that staging is not hosted); `plans/ROADMAP.md` P8, its deployment diagram, the "P8 before P5.4" note
and the ADR-007 row of its architecture-decisions table match the
[table above](#where-p8-builds-less-than-the-roadmap); roadmap decisions 11, 12 and 13 are marked answered.

### PR 01 — Terraform skeleton, the bootstrap, and their CI (P8.1)

- [ ] Merged

| File                                      | Change                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `infra/terraform/bootstrap/`              | the state bucket (versioned, encrypted, private); the GitHub OIDC provider; the `plan`, `apply` and `deploy` roles, each trusted only for its GitHub Environment of this repository; **the $35 monthly budget with alerts at 50%, 80% and 100%** to the user's address. Applied by the user, once, then left alone |
| `infra/terraform/envs/production/`        | the backend, the pinned Terraform and provider versions, the committed provider lock file, the variables (ap-south-1, account-specific names), no resources yet                                                                                                                                                    |
| `.github/workflows/infra.yml`             | on a PR that touches `infra/terraform/**`: `plan` (Environment `infra-plan`), written to the job summary. `apply` runs only from `dev`, in the Environment `production-infra`, which has the user as required reviewer. Actions pinned by commit, like every other workflow                                        |
| `.github/workflows/ci.yml`                | the `changes` job gains an `infra` output; a new `infra` job (`terraform fmt -check -recursive`, `validate` with no backend) joins `ci-ok`'s list, so a broken configuration cannot merge; `static-analysis`'s `trivy config` also covers `infra/`                                                                 |
| `scripts/ci/workflows.test.mjs` (new)     | the guard: a job asks for `id-token: write` only if it names an `environment`; no workflow that does is triggered by `pull_request_target`, and none checks out a pull request's head with a role that can change anything                                                                                         |
| `infra/README.md` (new), `docs/README.md` | bootstrap, plan and apply, step by step; the budget table and how to read the bill; the ownership row for `infra/`                                                                                                                                                                                                 |
| `.gitignore`                              | `.terraform/`, plan files, `*.tfvars` that are not examples                                                                                                                                                                                                                                                        |

Verify: `terraform fmt -check` and `validate` pass locally and in CI; the guard fails on a fixture workflow with
`id-token: write` and no environment; after the user's bootstrap, the PR's `plan` job prints "No changes" and the
user has the budget's confirmation email.

### PR 02 — Network, registry and roles (P8.1, P8.2)

- [ ] Merged

Modules, each small and used by `envs/production`:

- `network`: a VPC with public subnets in two zones (the host has a public address for outbound traffic only: a
  NAT gateway alone would cost more than the whole budget); an S3 gateway endpoint (free); a security group in
  which the host accepts traffic from CloudFront only and nothing accepts SSH.
- `ecr`: `food-pickup/web` and `food-pickup/server`, immutable tags, scan on push, keep the newest 10 images.
- `iam`: the instance role (pull from ECR, Session Manager, write its own log groups, read its own parameters and
  secret, read and write the media bucket).

Verify: the PR's plan shows only additions and nothing with an hourly price; after the user approves the apply, a
second plan is empty.

### PR 03 — arm64 images, proven in CI (P8.2)

- [ ] Merged

No AWS involved, so it can land before the account exists.

- `scripts/ci/image-smoke.sh`: the checks `ci.yml`'s `images` job makes today (the health endpoints, the commit,
  `/runtime-env.js`, the headers, the size budgets), moved into one script.
- `ci.yml`'s `images` job becomes a matrix of amd64 and arm64 (GitHub's arm64 runner), each building both images
  and running the script. This is the guard that the Alpine runtime stage, and later P3's `sharp`, work on the
  host's architecture, on every pull request that touches an image.

Verify: both matrix legs green; a deliberate break of the runtime stage on a scratch branch fails the arm64 leg.

### PR 04 — The host, its configuration and its secret (P8.4, P8.6)

- [ ] Merged

Waits for D11: the first PR with an hourly price, about $11.50 a month from its apply.

- `infra/host/compose.prod.yml`: `web`, `api` and `worker` from the two tags, the same commands and health checks as
  `compose.yaml`, restart policies, log rotation, and **a memory limit per container** so one process cannot take
  the host down (with Node's own heap limit set below it for `api` and `worker`).
  `scripts/ci/compose-parity.test.mjs` (new) fails when the two compose files disagree on a service's command,
  health check or the ports between services.
- `infra/host/render-env.sh`: reads `/food-pickup/production/*` from Parameter Store and the one secret
  `food-pickup/production/app` from Secrets Manager into an environment file on tmpfs, readable by root only.
  `infra/host/apply-release.sh`: take candidate tags from the command's parameters, or, with none, the release
  parameter's tags; pull, `up -d`, wait for `/api/ready` through nginx; if it does not answer in time, return to the
  tags the release parameter names (the last release that passed) and exit non-zero. It never writes the parameter.
- `modules/compute`: **one EC2 instance** (Amazon Linux 2023, arm64, `t4g.micro`, **CPU credits `standard`**,
  IMDSv2 only, a 16 GB encrypted disk with a 2 GB swap file, automatic recovery on a hardware fault). User data
  installs docker and the compose plugin and nothing else. The module's inputs and outputs are what an Auto Scaling
  group would need, so that swap is contained when it comes.
- `modules/secrets`: the parameters (`APP_ENV`, the Supabase URL and publishable key, `CLIENT_ORIGIN`,
  `TRUST_PROXY_HOPS`, `LOG_LEVEL`, the rate limits, sized for one API instance) from the environment's variables,
  and the secret's container with a placeholder the user replaces; Terraform ignores the value afterwards.
- The SSM document `food-pickup-deploy`, with the three host files rendered into it: write the files, then run
  `apply-release.sh`, with the candidate tags as the command's parameters (none means the parameter's release). A
  State Manager association runs it once on a new host with none, so a replaced machine comes up on the last release
  that passed without anyone deploying.

Tests: `infra/host/*.sh` pass `shellcheck` in the `infra` job; `apply-release.sh` has a test with a fake `docker` on
the path (applies a candidate; applies the parameter's tags when given none; and a candidate that never becomes
ready ends on the parameter's tags with a non-zero exit); a Terraform test asserts the instance's
credit mode is `standard` (the guard against the default that bills). Verify, after the approved apply: a Session
Manager shell on the host shows docker running, `free -m` shows the swap, and the instance's credit mode reads
`standard` in the console.

### PR 05 — The edge: CDN, certificate, media bucket (P8.3)

- [ ] Merged

- `modules/media`: `food-pickup-media-production`, private, encrypted, versioned; CORS for a form post from the
  app's origin; lifecycle rules (unprocessed originals expire after a day, old versions after 30). This is the
  bucket [P3 PR 09](P3_CATALOG_AND_MEDIA.md#pr-09--media-s3-and-minio-p33) points `MEDIA_BUCKET` at in production.
- `modules/cdn`: one distribution with HTTP/3. The default behaviour and `/api/*` go to the host (`/api/*`
  uncached, with `Authorization` and every query string forwarded; everything else obeys the cache headers nginx
  already sends). `/media/*` goes to the bucket through origin access control, cached for a year.
- **How CloudFront reaches the host.** Never over plain HTTP: requests carry `Authorization` headers. Two forms
  only, both free. Preferred: a CloudFront VPC origin onto the instance, so the host takes no traffic from the
  internet at all. If that cannot be expressed for a single instance with a public address for its outbound traffic:
  **HTTPS to the origin**. The host's nginx serves TLS on 443 with a free, automatically renewed certificate for an
  origin hostname (`origin.<domain>`), CloudFront's origin protocol is HTTPS only, the security group admits only
  CloudFront's published address range on 443, and nginx still refuses any request without a header only CloudFront
  knows. The form used is recorded in `infra/README.md`. The second form needs the domain (D3) before this PR.
- The certificate (in `us-east-1`) and the DNS records for the production domain (D3). With the VPC origin, until
  the domain exists the distribution answers on CloudFront's own hostname, which is enough for the dark period.
- `TRUST_PROXY_HOPS` is set for the real chain (CloudFront, nginx) and **checked, not assumed**: a request from a
  phone must show that phone's address in the API's rate-limit key.

Verify: `https://<production host>/healthz` answers through CloudFront; a request straight to the host's address is
refused; nothing on the host answers plain HTTP from outside the VPC; an object put in the bucket is reachable at `/media/…` and not at the bucket's own URL.

### PR 06 — Production guards in the server (P8.6)

- [ ] Merged

`server/src/utils/env.ts`: with `APP_ENV=production` the server refuses to start unless `CLIENT_ORIGIN` is `https`,
`GIT_COMMIT` is set, and `TRUST_PROXY_HOPS` is at least 1. (`staging` is left alone: a local stack pointed at the
staging project uses it with a `localhost` origin.) `server/.env.example` and `docs/DEPLOYMENT.md` gain the rows.

Tests: `test/unit/env-production.safe.test.ts`, one case per refusal, each seen failing without its rule.
Intent: `--server patch`.

### PR 07 — Deploy to production from a release (P8.5)

- [ ] Merged

`.github/workflows/deploy-production.yml`, on the `client-v*` and `server-v*` tags `release.yml` creates on `main`
(the two tags of one release point at the same commit, so they share a `concurrency` group keyed by that commit,
which never cancels a run in progress: the runs go one after the other, and a run stops early only when the release
parameter already names this release, that is, when it is deployed):

1. **build**: both images for arm64 from `main` at the tag's commit (layer cache, provenance and SBOM
   attestations, `GIT_COMMIT` as a build argument), smoke-tested with `image-smoke.sh`, pushed as
   `<version>-<sha7>` through the `deploy` role. An image whose tag already exists is not pushed again (tags are
   immutable) and the run carries on.
2. **wait**: the Environment `production` has the user as its required reviewer. Before approving, the user runs
   `pnpm run db:push:production` (CLAUDE.md §2: never the pipeline, never the agent).
3. **deploy**: read the release parameter (the previous release), send `food-pickup-deploy` to the host with the
   candidate tags as the command's parameters, wait for it, and fail the run if it fails. The host returns to the
   parameter's release by itself when `/api/ready` never comes. The parameter is not written here.
4. **smoke** (`scripts/ci/deploy-smoke.sh`, new): through the public address, waiting out the few seconds a deploy
   takes: `/api/health` reports this commit, `/api/ready` is 200, `/` loads and the script it names loads,
   `/runtime-env.js` names the production project, `index.html` is uncached and an asset is immutable (so a cache
   mistake fails a deploy instead of pinning an old app), and one public read is 200 and then 304. No browser
   order: production gets no test orders.
5. **record or undo**: if the smoke passes, write the candidate tags to the release parameter, last, so it names
   the last release that passed. If it fails, send the document again with no candidate (the host applies the
   parameter's release), wait for it, and fail the run.

Two `workflow_dispatch` paths, both through the same approval: **redeploy a named earlier version** (the rollback:
the same flow, with those tags as the candidate), and **a rehearsal**, which builds a named commit of `dev` and deploys it. The rehearsal is how the pipeline and the
host are exercised before the first release without inventing releases; it refuses to run unless the repository
variable `PRODUCTION_DARK` is `true`, and the launch checklist (P9.5) sets it to `false` for good.

Tests: `deploy-smoke.sh` runs against the local compose stack in `ci.yml`'s `images` job, so the smoke itself is
tested before it guards a deploy; `scripts/ci/workflows.test.mjs` gains three rules: the deploy jobs sit in the
`production` Environment, the rehearsal job checks `PRODUCTION_DARK`, and the deploy workflow has the concurrency
group keyed by the release commit with `cancel-in-progress` off.

Docs: `docs/DEPLOYMENT.md` gains "How a release reaches production", "The first production release" (below) and
"Rolling back"; CLAUDE.md §2 and §21 (what a release now triggers; `dev` still deploys nothing); `infra/README.md`;
`README.md`.

### PR 08 — Logs, metrics, alarms (P8.7)

- [ ] Merged

Built to stay inside CloudWatch's free allowances.

- `compose.prod.yml`: the `awslogs` driver, one log group per service, kept 30 days.
- `modules/observability`: the log groups; metric filters on the access line (requests, 5xx, duration) and on the
  worker's lines (dead letters, queue depth, oldest message age); alarms to an SNS topic with the user's
  address (D10): CloudFront's own 5xx rate (it sees the host being down), the API's 5xx above 2% for 5 minutes,
  p95 above 1 s for 10 minutes, any dead letter, a message older than 5 minutes, the host's status check, the
  host's used memory above 85% (the metric below, not the processes' own), a low CPU-credit balance (in standard mode an empty balance means a slow app), and the certificate
  within 21 days of expiry; one dashboard; four saved log queries (errors by code, slowest routes, one request id
  across `api` and `worker`, dead letters).
- `server/src/worker.ts` and `server/src/server.ts`: one `info` line every `PROCESS_METRICS_LOG_MS` (default five
  minutes, a deployment setting) with the process's memory and, in the worker, each queue's depth and age, which
  `/health` already computes. It is a timer, not a line per poll, and `docs/LOGGING.md` says so. The line tells
  which process grew; it is not the memory alarm's source.
- **Host memory.** A systemd timer on the host (installed with the other host files) runs a few-line script every
  five minutes that reads `/proc/meminfo` and publishes the host's used-memory and used-swap percentages with
  `aws cloudwatch put-metric-data`. The instance role gains `cloudwatch:PutMetricData` for the app's namespace only.
  No CloudWatch agent: it would itself take memory on a 1 GB host. The two extra metrics stay inside CloudWatch's
  free allowance.

Tests: the script against a fixture `meminfo` gives the expected percentages; on the host, the published metric
matches `free -m`; `test/logging.safe.test.ts` asserts the access line and the new lines carry the exact fields the metric
filters read, with a comment naming the Terraform file, so renaming a log field cannot silently blind an alarm;
`test/unit/worker-health.safe.test.ts` covers the timer with an injected clock.

Docs: `docs/LOGGING.md` (shipping, the metrics line), `docs/DEPLOYMENT.md` (alarms, the dashboard, the targets the
roadmap calls SLOs), `docs/CONFIGURATION.md`, `docs/JOBS.md` (the runbook points at the alarms). Intent:
`--server minor`.

## Closing P8

P8 is closed when production is deployed and healthy, **dark** (no announcement, no real users), from a pipeline
run the user approved, and these have been done on it while it is dark, since there is no staging to do them on:

- **A rehearsal deploy** of a `dev` commit, start to finish, with the smoke green.
- **The way back**: a rehearsal of a commit whose API cannot start; the host returns to the previous tags, the run
  fails, and afterwards the release parameter still names the previous release. A second rehearsal whose API starts
  but fails the public smoke ends the same way, through the undo step.
- **An alarm seen firing and recovering**: stop the `api` container from a Session Manager shell, receive the
  email, start it, receive the recovery.
- **`TRUST_PROXY_HOPS` measured**: a request from a phone shows that phone's address in the API's rate-limit key,
  and a forged `X-Forwarded-For` does not change it. `docs/DEPLOYMENT.md` records the value and how it was measured.
- **CSP.** The web image's policy is Report-Only until it has been watched on a hosted app. After a clean week
  (including P3's upload flow, if it has landed), a small PR makes it enforcing.
- **The first month's bill** is where the [budget](#the-budget) said it would be.
- `infra/README.md` lets someone rebuild production from an empty account.

Launch itself is P9.

### The first production release

Everything since P0 reaches `main` for the first time (P1's and later plans' "at P8" notes). In order:

1. **(user)** Create the production Supabase project in the `KhaNha` organisation, in **ap-south-1**, shortly
   before this release and not earlier: a free project with no traffic is paused after seven days. Put its
   reference into `PRODUCTION_REF` (a one-line PR).
2. **(user)** Set the production secret value and parameters; confirm the SNS address.
3. `release.yml` → `prepare` opens the release PR `dev` → `main`; **(user)** merges it. Tags and the back-merge
   follow.
4. **(user)** `pnpm run db:push:production`: every migration since `init`, in order; check that pgmq and pg_cron
   show under the project's Integrations. Then approve the waiting deploy.
5. **(user)** `pnpm run seed -- --production` if the first restaurant's data comes from the seed;
   `migrate-media --production` if P3 is in; the first platform admin's account.
6. The smoke passes; the dashboard shows traffic only from the smoke.

## Later: staging on AWS

Decided by the user (11 November 2026): one to two months after the first release, not before. Until then the
staging Supabase project and a locally run app are staging. When it comes it is three small PRs, about $13 a month
more (about $26 in all, still under the ceiling):

1. **The environment**: `infra/terraform/envs/staging/`, the same modules with staging's variables, in the same
   account, kept apart from production by name, tag and role; its own `apply` Environment.
2. **`deploy-staging.yml`**: when `ci.yml` finishes green for a push to `dev`: build and push `dev-<sha7>`,
   migrate the staging database (the Supabase access token and database password as secrets of the GitHub
   Environment `staging`, which the user approved on 11 November 2026, ADR-007 as amended), deploy, run
   `deploy-smoke.sh`. This is the day "`dev` deploys staging" becomes true, and the day manual staging pushes end.
3. **A browser smoke test** after each staging deploy: one Playwright order on a phone viewport as the seeded
   customer, whose password is the third secret of that Environment.

With a hosted worker polling it, the staging Supabase project also stops pausing after seven idle days.

## When there is funding to scale

The user's stated path (11 November 2026): larger instances, more replicas, possibly EKS and other services. In
the order ADR-007 gives, each step priced and put to the user first:

1. **A larger host** (`t4g.small`, then `t4g.medium`): one variable.
2. **A load balancer and a second host**: `modules/compute` becomes an Auto Scaling group behind a new
   `modules/alb`; deploys roll one host at a time and stop being outages; CloudFront's origin becomes the load
   balancer, over HTTPS. About $30 to $40 a month more.
3. **A second AWS account**, so staging and production stop sharing one, and the WAF (P9.3).
4. **A third API instance** needs the shared rate-limit store first
   ([ADR-009](../docs/adr/009-rate-limiting-token-buckets.md)).
5. **EKS**, only through ADR-007's gate (P10.1).

## ADRs this plan touches

Only the user accepts or amends an ADR, and an accepted decision is never rewritten (`docs/adr/README.md`). **Every
item that needed the user is resolved** (11 November 2026).

| ADR                  | What P8 does with it                                                                                                                                                                                                                                | Status                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 007 EC2 with compose | implements it as amended: production only to start, one host and no load balancer inside the budget; GitHub plans, applies and deploys through OIDC roles; staging's credentials may live in a GitHub Environment, used once the AWS staging exists | **resolved**: amended by the user, 11 November 2026                    |
| 011 free tiers       | AWS is the one paid service, with the $35 monthly ceiling, what it buys, what is left out and the rules; GitHub Environments are listed                                                                                                             | **resolved**: amended by the user, 11 November 2026                    |
| 009 rate limits      | one production host is one API instance, so the limits are exact. A second instance doubles them in effect, which the ADR accepts; a third needs the shared store                                                                                   | nothing needed; noted under [funding](#when-there-is-funding-to-scale) |
| 005 three processes  | `api` and `worker` are hosted; the reconciler and its lease arrive with P5.10, as the ADR links                                                                                                                                                     | nothing needed                                                         |
| 006 media            | the bucket, origin access control and the `/media/*` route, as accepted                                                                                                                                                                             | nothing needed                                                         |
| 008 semver           | production deploys hang off the release tags, as the ADR says; its `dev-<sha7>` staging images wait for the AWS staging                                                                                                                             | nothing needed                                                         |
| 010 polling          | CloudFront leaves `/api/*` uncached and passes the API's ETag and 304 through; the deploy smoke checks it                                                                                                                                           | nothing needed                                                         |
| 003 aggregator       | still **Proposed** (it is decided in P4). Nothing in P8 depends on it: payment secrets and their guards are added after it is accepted                                                                                                              | nothing needed in P8                                                   |

## Decisions

Those marked ★ are still to be asked ([Ask the user before starting](#ask-the-user-before-starting)). The rest are
answered, or have a default the plan follows.

| #     | Decision                                        | Answer or default                                                                                                                                                              | Applies to |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| D1    | AWS accounts (roadmap decision 13)              | **one account**: the credits sit in one, and there is one environment (follows from the user's decisions; say if a second account is wanted anyway)                            | 01         |
| D2    | Region                                          | **ap-south-1 (Mumbai)**: the staging Supabase project's region, read from Supabase on 11 November 2026. The production project is created there too                            | 01         |
| D3 ★  | Domain name                                     | asked before PR 05; required then if the private origin cannot be used (HTTPS to `origin.<domain>`). With the private origin, CloudFront's own hostname serves the dark period | 05         |
| D4    | Host architecture and size                      | **answered (the user, 11 November 2026):** small; `t4g.micro` (2 vCPU, 1 GB, arm64), standard CPU credits                                                                      | 03, 04     |
| D5    | Staging migrations inside a pipeline            | **answered (the user, 11 November 2026): yes**, with staging's credentials in a GitHub Environment; it takes effect with the AWS staging. Until then, by hand                  | later      |
| D6    | Production migrations (roadmap decision 11)     | manual, by the user, while the deploy waits                                                                                                                                    | 07         |
| D7    | Compose on EC2, or ECS (roadmap decision 12)    | compose on EC2 (ADR-007)                                                                                                                                                       | 04         |
| D8    | A staging on AWS                                | **answered (the user, 11 November 2026):** not at first; one to two months after the first release                                                                             | later      |
| D9    | Production hosts                                | **answered (the user, 11 November 2026):** a single host; replicas come with funding                                                                                           | 04         |
| D10 ★ | Where alarms and the budget alert go            | one email address the user names                                                                                                                                               | 01, 08     |
| D11   | When the host is created (PR 04)                | when the user says: that is the day the bill starts. Suggested: about a month before launch, to leave time for the dark-period drills. PRs 00–03 and 06 are free               | 04         |
| D12   | Where webhooks are tested before an AWS staging | for the P5 plan: a tunnel to a local stack for the provider's sandbox, or the AWS staging brought forward                                                                      | P5         |
| D13   | Where the AWS spend is recorded                 | **answered (the user, 11 November 2026):** $140 of credits, at least four months; recorded as an amendment to ADR-011                                                          | 00         |
| D14   | Who applies Terraform                           | **answered (the user, 11 November 2026):** the pipeline, after the user's approval (ADR-007 as amended)                                                                        | 01         |

## User steps (cannot be done from the repository)

- Answer the questions in [Ask the user before starting](#ask-the-user-before-starting).
- **Before anything is created**, in the AWS console: note the date the credits expire and whether the account
  stays open when they run out; confirm they cover EC2, public addresses, ECR, S3, CloudFront, CloudWatch and
  Secrets Manager; and price the [budget table](#the-budget) in the AWS pricing calculator for ap-south-1. If any
  of the three changes the picture, say so before PR 01.
- In the account that holds the credits, run `infra/terraform/bootstrap` once with your own administrator
  credentials (`infra/README.md` has the commands), and confirm the budget alert's email.
- In GitHub → Settings → Environments, create `infra-plan`, `production-infra` and `production`, the last two with
  yourself as required reviewer and restricted to `dev` (applies), `main` and the release tags (deploys). Give each
  the role ARN the bootstrap printed, as a variable. Set the repository variable `PRODUCTION_DARK` to `true`.
- Approve each `apply` and each deploy when its run asks.
- After PR 04's apply: put the real `SUPABASE_SECRET_KEY` into the `food-pickup/production/app` secret (once the
  production Supabase project exists; see [The first production release](#the-first-production-release)).
- Confirm the SNS subscription email (PR 08).
- Buy or delegate the domain when it is chosen (D3); its registration is probably not payable from credits.
- Look at the bill at the end of the first month against the budget table.
- Staging, unchanged: push its migrations and seed it by hand, as today.

## Risks and gotchas

- **No staging to fail on first.** Every infrastructure and pipeline change is first run on production. The
  answers are in [How the team works P8](#how-the-team-works-p8) and [Closing P8](#closing-p8): each piece tested
  before it reaches the host, a dark period, a rehearsal path that only works while dark, and the user approving
  every run. After launch, until the AWS staging exists, a risky infrastructure change waits for it or is made in
  a quiet hour with the rollback ready.
- **1 GB of memory for three containers and Docker.** Enough for today's API and worker with a few hundred MB to
  spare; P3's image pipeline (`sharp`) is the first thing likely to press on it. Each container has a limit, the
  host has swap, and the alarm on the host's own used memory (PR 08, read from `/proc/meminfo`) is the early
  warning. The next size up still fits the budget.
- **Standard CPU credits mean slow, not expensive.** A `t4g.micro` earns enough credits to run both vCPUs at 10%
  around the clock. A burst spends the balance; an empty balance throttles the host. Fine for 0 to 50 users; the
  credit alarm says when it is not.
- **One host is a single point of failure, and a deploy is a short outage.** Accepted by decision (ADR-007 as
  amended). The smoke waits for a deploy; nobody should read those seconds as a failure.
- **Credits end.** When they do, the account either starts billing a card or, on some plans, closes. The first
  user step above settles which, and the budget alert gives the warning.
- **The production Supabase project is on the free tier too** (ADR-011): 500 MB, 60 connections, 0.5 GB of memory
  shared by Postgres and Supabase's own services, paused after seven days without traffic (so it is created just
  before the first release, and the hosted worker's polling then keeps it awake), and no backups until P9.5.
- **A public repository with cloud credentials.** The roles trust a GitHub Environment, not a branch or a PR, the
  Environments that can change anything need the user's approval, and the workflow guard (PR 01) keeps a future
  workflow from loosening that. Fork PRs get no token that can assume a role.
- **The staging database is still migrated by hand**, so it can drift from `dev`. `docs/DEPLOYMENT.md`'s existing
  steps stand; `supabase migration list` against staging is the check before testing a phase on it.
- **Webhooks need a public address** that P8 no longer provides for staging. This is the P5 plan's to solve (D12);
  it must not be solved by pointing a payment sandbox at production.
- **State and drift.** A change made in the AWS console is undone or fought by the next apply. The rule is in
  `infra/README.md`: change the Terraform, or do not change it.
- **Terraform plans are public.** Names and ARNs appear in job summaries. Nothing secret is ever a Terraform input;
  outputs that are merely awkward are marked sensitive.
- **A migration that the old code cannot run against.** Production is migrated before it is deployed, so a contract
  migration released with the code that still needs the old shape breaks production between the two steps. The PR
  template's expand/contract box and `check-migrations` are the guards; P8 adds none.
