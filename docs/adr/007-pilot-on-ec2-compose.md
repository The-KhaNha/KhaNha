# ADR-007: Pilot on EC2 with docker compose

## Status

Accepted (2026-09-28).

Amended (2026-11-11), by the user:

- **A budget shapes the start.** AWS is paid from $140 of credits that must last at least four months, about $35 a
  month for everything ([ADR-011][adr-011]). The pilot therefore starts with **production only, on one small host
  with no load balancer**; the load balancer, the second host and rolling deploys this ADR first decided return
  when there is funding to scale.
- **No staging on AWS at first.** Staging stays the Supabase staging project with the app run locally against it.
  A staging environment on AWS follows one to two months after the first release.
- **The pipeline applies the infrastructure.** GitHub Actions plans and applies Terraform through OIDC roles, as
  well as deploying; every run that changes production waits for the user's approval.
- **Staging's credentials may live in GitHub**, once staging is hosted on AWS: the staging database credentials and
  the staging smoke test's password as secrets of a GitHub Environment. Production's never are.

## Date

2026-09-28 (accepted), 2026-11-11 (amended)

## Context

R18 and R20 ask for hosting on AWS, with Kubernetes after the pilot depending on load. The pilot starts at one or two
small hosts, and no measured load yet justifies a cluster. The processes are `web`, `api`, `worker` and
`reconciler` (ADR-005).

At the amendment (2026-11-11): the first users are 0 to 50, the database is hosted separately (Supabase), and the
money available is $140 of AWS credits. A load balancer alone would take about half of a $35 month.

## Options considered

1. **EC2 with docker compose behind ALB and CloudFront, images in ECR, deploys via SSM.** Kubernetes only after a
   measured gate.
2. **Kubernetes (EKS) first.** Rejected: the operational cost arrives before any load justifies it.
3. **ECS on EC2.** An acceptable variant if the team prefers managed deploys ([Decisions needed][decisions-needed],
   item 12).

## Decision

The pilot runs on EC2 with docker compose behind CloudFront, with images in ECR and deploys via SSM Run Command.
Kubernetes (EKS) comes only after a measured gate in P10.1.

**To start, inside the budget (amended 2026-11-11):**

- Production runs on one EC2 host (`t4g.micro`, standard CPU credits so a burst can never add to the bill), running
  `web`, `api` and `worker`; the `reconciler` joins with P5.10. No Auto Scaling group and no load balancer:
  CloudFront reaches the host directly, and nothing else can.
- Staging is not hosted on AWS at first. One to two months after the first release it gets the same shape: one small
  host of its own, in the same account, deployed on every merge to `dev`.
- A deploy runs on that host: `docker compose pull && up -d`, then a wait for `/api/ready`; if it never answers, the
  host returns to the tags that last worked. A deploy is a few seconds of errors, accepted at this size.
- Rolling back runs the same command with the previous tags; expand/contract migrations mean no database rollback.

**When there is funding to scale** (the user's word, or P9.1's load test showing one host is not enough), the
original shape returns, in this order: a larger host; then a load balancer in front of an Auto Scaling group of two
or more hosts, with rolling deploys one host at a time (deregister, deploy, wait for `/api/ready`, register); then
the EKS gate below.

## Consequences

- Local development and production share the compose layout built in P0.6.
- **Secrets** ([P8.6][p8.6]). Runtime secrets (`SUPABASE_SECRET_KEY`, later the payment keys, `PICKUP_CODE_SECRET`,
  `VAPID_PRIVATE_KEY`) live in AWS Secrets Manager per environment, as keys of one secret; non-secret configuration
  in SSM Parameter Store. At deploy, each host's instance role reads its own environment's values and renders them
  into a tmpfs env file for compose. They are never baked into images, committed, or stored in GitHub.
- **GitHub holds no AWS keys.** Workflows assume IAM roles through GitHub OIDC (short-lived credentials), and each
  role trusts exactly one GitHub Environment of this repository, never a branch name or a pull request (amended
  2026-11-11):
  - `plan`: read-only, for the Terraform plan shown on a pull request;
  - `apply`: may change the app's infrastructure. Production is applied only after the user approves the run; the
    later AWS staging is applied when a change merges into `dev`;
  - `deploy`: push to ECR, write the release parameter, and `ssm:SendCommand` on the app's hosts.
- **GitHub secrets** (amended 2026-11-11). The release App's id and key (`release.yml`). From the day staging is
  hosted on AWS, and in the `staging` Environment only: the staging Supabase access token and database password
  (so staging migrates itself on every merge) and the staging smoke test's customer password. Production's database
  credentials never enter GitHub: production migrations stay a step the user runs. All of this works on GitHub Free
  ([ADR-011][adr-011]).
- **With no hosted staging, infrastructure and pipeline changes are first run on production.** They are tested
  before they reach the host (scripts under test, the image and deploy smoke tests in CI), production runs dark
  until launch, and a rehearsal deploy that only works while it is dark exercises the pipeline before the first
  release ([P8 plan][p8-plan]).
- **One host is a single point of failure.** A failed host means an outage until it is replaced, and every deploy is
  a short one. That is accepted for 0 to 50 users and is the first thing funding removes.
- **1 GB of memory** holds today's three containers with little to spare. Memory is watched from the first day; the
  next size up (`t4g.small`) still fits the budget.
- Cost: Secrets Manager charges per secret per month; SSM Parameter Store standard parameters are free. Keep the
  secret count at one per environment, and put everything that is not a secret in Parameter Store. The whole budget
  is in [ADR-011][adr-011] and the [P8 plan][p8-plan].
- P9.1 sets the real instance size and count.
- Migrating to EKS happens when any two gate conditions are true (more than 4 hosts at peak or independent scaling
  several times a day; compose-over-SSM a bottleneck; a second region; the operational capacity). If the gate fails,
  stay on EC2 or take the smaller step to ECS/Fargate.
- This ADR must be accepted before P0.6 commits to compose.

## Links

- [Deployment on AWS (pilot)][deployment-on-aws-pilot]
- [P0.6 Docker images and local compose][p0.6]
- [P0.8 Architecture decision records][p0.8]
- [P8.2 Container registry and image pipeline][p8.2]
- [P8.4 Compute on EC2][p8.4], [P8.5 Continuous deployment][p8.5]
- [P9.1 Load testing from 100 to 1000 concurrent][p9.1]
- [P10.1 Kubernetes migration][p10.1]
- [P8 plan][p8-plan] (how it is built, and the budget)
- [ADR-005][adr-005]
- [ADR-011][adr-011] (the free tiers, and the AWS budget)

[decisions-needed]: ../../plans/ROADMAP.md#decisions-needed
[deployment-on-aws-pilot]: ../../plans/ROADMAP.md#deployment-on-aws-pilot
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p0.8]: ../../plans/ROADMAP.md#p08-architecture-decision-records
[p8.2]: ../../plans/ROADMAP.md#p82-container-registry-and-image-pipeline
[p8.4]: ../../plans/ROADMAP.md#p84-compute-on-ec2
[p8.5]: ../../plans/ROADMAP.md#p85-continuous-deployment
[p9.1]: ../../plans/ROADMAP.md#p91-load-testing-from-100-to-1000-concurrent
[p10.1]: ../../plans/ROADMAP.md#p101-kubernetes-migration
[p8-plan]: ../../plans/P8_INFRASTRUCTURE.md
[adr-005]: 005-modular-monolith-three-processes.md
[adr-011]: 011-free-tiers.md
[p8.6]: ../../plans/ROADMAP.md#p86-secrets-and-configuration
