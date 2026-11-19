# Infrastructure

Production on AWS, as code. The decisions behind it are [ADR-007](../docs/adr/007-pilot-on-ec2-compose.md),
[ADR-011](../docs/adr/011-free-tiers.md) and the [P8 plan](../plans/P8_INFRASTRUCTURE.md); where the app runs today
is [DEPLOYMENT.md "Hosted environments"](../docs/DEPLOYMENT.md#hosted-environments).

```text
terraform/
  bootstrap/          run once by the user: state bucket, GitHub OIDC, the three roles, the $35 budget
  envs/production/    production's root: the modules with production's names
  modules/
    network/          VPC, two public subnets, no NAT; free S3 endpoint; the host's security group
    ecr/              khanha/web and khanha/server: immutable tags, scan on push, newest 10 kept
    iam/              the host's instance role, scoped to its own parameters, secret, logs and media bucket
                      (compute, secrets, media, cdn, observability arrive with PRs 04–08)
```

**The security group admits nothing yet.** No SSH, ever (Session Manager replaces it). The one inbound rule,
CloudFront's, comes with PR 05 and the origin form it proves; until then the host only calls out, on 443.

**Module tests.** A module with a `tests/` folder has `terraform test` against a mocked provider, run by `ci.yml`'s
`infra` job; `cd terraform/modules/<name> && terraform init -backend=false && terraform test` locally. `iam`'s
asserts no data-reading grant is on `*` and that a staging role names nothing of production's.

**Who runs what.** The bootstrap is the one thing applied by hand, by the user, with their own administrator
credentials. Everything else is applied by `.github/workflows/infra.yml` through the roles the bootstrap creates, and
only after the user approves the run in GitHub. No agent holds AWS credentials.

## What it costs

About $11.50 a month planned (Mumbai prices, 15 November 2026), about $20 if no free allowance applied, with a
ceiling of $35: [the budget table](../plans/P8_INFRASTRUCTURE.md#the-budget). Each PR that adds something to AWS
states its monthly cost.

**Reading the bill.** Billing and Cost Management → **Bills** for the month so far, **Credits** for what is left
(about $130, expiring 18 February 2027). The budget `khanha-monthly` counts costs **before** credits on purpose:
with credits included the month nets to about $0 and the alert would never fire. So an email at 50% means about $17.50
of real usage this month, even while credits pay for it.

## 1. Bootstrap (once, by the user)

Needs: Terraform 1.11 or newer, the AWS CLI v2 signed in to the account that holds the credits with administrator
rights (`aws sts get-caller-identity` shows the right account).

Before `terraform apply`, check the credits in the console (Billing and Cost Management → Credits, then each credit's
applicable products). They must cover EC2, public IPv4 addresses (VPC), ECR, S3, CloudFront, CloudWatch, Secrets
Manager and Route 53. If one is not covered, stop and say so before applying (`plans/P8_INFRASTRUCTURE.md`, "Ask the
user before starting", keeps this check open).

```bash
cd infra/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # untracked; put the alert address in it
terraform init
terraform plan                                  # 15 additions: bucket and its settings, OIDC, 3 roles, budget
terraform apply
terraform output                                # the values for step 2
```

The bootstrap keeps its own state in a local `terraform.tfstate` (untracked). Keep a copy in the bucket it just
made, so it is not lost with the laptop:

```bash
aws s3 cp terraform.tfstate "s3://$(terraform output -raw state_bucket)/bootstrap/terraform.tfstate"
```

The budget sends its emails straight to the address; there is nothing to confirm.

The roles trust this repository's **immutable OIDC subject** (`owner@id/name@id`, the `github_repository` variable),
not `owner/name`: a workflow failing with "Not authorized to perform sts:AssumeRoleWithWebIdentity" means the two
disagree. `gh api repos/The-KhaNha/KhaNha/actions/oidc/customization/sub` shows the prefix GitHub sends.

## 2. Connect GitHub (once, by the user)

In GitHub → Settings → **Environments**, create:

| Environment        | Protection                                                                                                  | Variable `AWS_ROLE_ARN`                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `infra-plan`       | none (it plans pull requests; its role is read-only)                                                        | `terraform output` → `role_arns.infra-plan` |
| `production-infra` | required reviewer: you; deployment branches: `main` only                                                    | `role_arns.production-infra`                |
| `production`       | required reviewer: you; deployment branches and tags: `main`, `client-v*`, `server-v*` (used from PR 07 on) | `role_arns.production`                      |

Then the repository variables (Settings → Secrets and variables → Actions → **Variables**), or with `gh`:

```bash
gh variable set TF_STATE_BUCKET --body "$(terraform output -raw state_bucket)"
gh variable set AWS_ACCOUNT_ID --body "$(terraform output -raw account_id)"
gh variable set PRODUCTION_DARK --body true
for env in infra-plan production-infra production; do
  gh variable set AWS_ROLE_ARN --env "$env" --body "$(terraform output -json role_arns | jq -r --arg e "$env" '.[$e]')"
done
```

None of these values is secret; they are variables, not secrets, so they show in logs and nothing has to be masked.

## 3. Plan and apply (every change)

1. A pull request that touches `infra/terraform/**` runs `infra.yml`'s **plan**; the plan is in the run's summary.
   `ci.yml`'s `infra` job also checks `terraform fmt` and `validate` for every root, without AWS. Only pull requests
   from branches of this repository are planned. A fork's pull request skips the plan, because its code would run with
   the account's read access; a maintainer re-opens it from a branch here to see a plan.
2. It merges into `dev` and waits there: `dev` applies nothing. When a release reaches `main` (production),
   `infra.yml` plans again, then its **apply** job waits for you (the `production-infra` Environment). Read the plan
   in the summary of that run's plan job, then approve.
3. A second run on an unchanged tree plans "No changes".

Until step 2 is done the plan and apply jobs skip (no `TF_STATE_BUCKET`), so nothing fails while the account is
empty.

**A local plan**, with your own credentials:

```bash
cd infra/terraform/envs/production
terraform init -backend-config="bucket=$(terraform -chdir=../../bootstrap output -raw state_bucket)"
TF_VAR_account_id=<the account ID> terraform plan
```

## Changing a secret

The app's one secret (`khanha/production/app`, from PR 04) is set in the console (Secrets Manager), never in
Terraform or the repository; Terraform creates its container and ignores the value. A changed value reaches the
containers on the next deploy.

## Moving to another account

Everything account-specific is a variable or an output, so the setup can move (after the credits end, if it ever has
to): bootstrap in the new account, connect GitHub to its outputs, apply, re-enter the secret and the parameters, copy
the media bucket, deploy the last release and smoke-test it at the new CloudFront hostname. Then, at cutover, remove
the domain from the old distribution, add it to the new one and move DNS
([P8 plan, Risks](../plans/P8_INFRASTRUCTURE.md#risks-and-gotchas)).
