# ADR-007: Pilot on EC2 with docker compose

## Status

Accepted (2026-09-28).

## Date

2026-09-28

## Context

R18 and R20 ask for hosting on AWS, with Kubernetes after the pilot depending on load. The pilot starts at one or two
small hosts, and no measured load yet justifies a cluster. The processes are `web`, `api`, `worker` and
`reconciler` (ADR-005).

## Options considered

1. **EC2 with docker compose behind ALB and CloudFront, images in ECR, deploys via SSM.** Kubernetes only after a
   measured gate.
2. **Kubernetes (EKS) first.** Rejected: the operational cost arrives before any load justifies it.
3. **ECS on EC2.** An acceptable variant if the team prefers managed deploys ([Decisions needed][decisions-needed],
   item 12).

## Decision

The pilot runs on EC2 with docker compose, behind an ALB and CloudFront, with images in ECR and deploys via SSM Run
Command. Kubernetes (EKS) comes only after a measured gate in P10.1.

- An Auto Scaling group of 1 to 2 hosts, each running `web`, `api`, `worker` and `reconciler`.
- Rolling deploys, one host at a time: deregister, `docker compose pull && up -d`, wait for `/api/ready`, register.
- Rolling back runs the same command with the previous tags; expand/contract migrations mean no database rollback.

## Consequences

- Local development and production share the compose layout built in P0.6.
- **Secrets** ([P8.6][p8.6]). Runtime secrets (`SUPABASE_SECRET_KEY`, later the payment keys, `PICKUP_CODE_SECRET`,
  `VAPID_PRIVATE_KEY`) live in AWS Secrets Manager per environment; non-secret configuration in SSM Parameter Store.
  At deploy, each host's instance role reads its own environment's values and renders them into a tmpfs env file for
  compose. They are never baked into images, committed, or stored in GitHub.
- **GitHub holds no AWS keys.** The deploy workflow assumes an IAM role through GitHub OIDC (short-lived credentials,
  limited to pushing to ECR and `ssm:SendCommand` on the app's hosts). GitHub repository secrets hold only what the
  workflows themselves need: the release App's id and key (`release.yml`). Both work on GitHub Free
  ([ADR-011][adr-011]).
- Cost: Secrets Manager charges per secret per month; SSM Parameter Store standard parameters are free. Keep the
  secret count small, and put everything that is not a secret in Parameter Store.
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
- [ADR-005][adr-005]
- [ADR-011][adr-011] (the free tiers)

[decisions-needed]: ../../plans/ROADMAP.md#decisions-needed
[deployment-on-aws-pilot]: ../../plans/ROADMAP.md#deployment-on-aws-pilot
[p0.6]: ../../plans/ROADMAP.md#p06-docker-images-and-local-compose
[p0.8]: ../../plans/ROADMAP.md#p08-architecture-decision-records
[p8.2]: ../../plans/ROADMAP.md#p82-container-registry-and-image-pipeline
[p8.4]: ../../plans/ROADMAP.md#p84-compute-on-ec2
[p8.5]: ../../plans/ROADMAP.md#p85-continuous-deployment
[p9.1]: ../../plans/ROADMAP.md#p91-load-testing-from-100-to-1000-concurrent
[p10.1]: ../../plans/ROADMAP.md#p101-kubernetes-migration
[adr-005]: 005-modular-monolith-three-processes.md
[adr-011]: 011-free-tiers.md
[p8.6]: ../../plans/ROADMAP.md#p86-secrets-and-configuration
