# Infrastructure

Production on AWS, as code. The decisions behind it are [ADR-007](../docs/adr/007-pilot-on-ec2-compose.md),
[ADR-011](../docs/adr/011-free-tiers.md) and the [P8 plan](../plans/P8_INFRASTRUCTURE.md); where the app runs today
is [DEPLOYMENT.md "Hosted environments"](../docs/DEPLOYMENT.md#hosted-environments).

```text
terraform/
  bootstrap/          run once by the user: state bucket, GitHub OIDC, the three roles, the $35 budget, the alarm topics
  envs/production/    production's root: the modules with production's names
  modules/
    network/          VPC, two public subnets, no NAT; free S3 endpoint; the host's security group
    ecr/              khanha/web and khanha/server: immutable tags, scan on push, newest 10 kept
    iam/              the host's instance role, scoped to its own parameters, secret, logs, metrics and media bucket
    secrets/          the host's settings in Parameter Store, and the container of its one secret
    compute/          the host (t4g.micro, standard credits), its first boot, the deploy document
    media/            the media bucket: private, versioned, CORS for the upload form, lifecycle rules
    cdn/              CloudFront (VPC origin to the host, the bucket at /media/*), the zone, the certificate
    observability/    log groups, metric filters, 9 alarms, the dashboard, saved log queries
host/                 what the deploy document writes to the host and runs
  compose.prod.yml    web, api, worker from ECR, with memory limits (scripts/ci/compose-parity.test.mjs)
  render-env.sh       parameters and the secret -> env files on tmpfs, root only
  apply-release.sh    candidate tags, else the release parameter's; back to the parameter's if not ready
  host-metrics.sh     the host's used memory and swap -> CloudWatch, every 5 minutes (khanha-host-metrics@.timer)
```

**Only CloudFront reaches the host.** No SSH, ever (Session Manager replaces it). The host is a CloudFront VPC
origin: its one inbound rule admits port 80 from `CloudFront-VPCOrigins-Service-SG`, the group AWS creates for the
VPC origin's interfaces, so no other distribution and nothing on the internet can reach it.

**Module tests.** A module with a `tests/` folder has `terraform test` against a mocked provider, run by `ci.yml`'s
`infra` job; `cd terraform/modules/<name> && terraform init -backend=false && terraform test` locally. `iam`'s
asserts no data-reading grant is on `*`, that metrics go only to the environment's namespace, and that a staging
role names nothing of production's.

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

A scheduled run of `infra.yml` plans production every Monday and fails when the applied infrastructure differs from
`main`, which catches a change made in the console or an apply that never ran; undo the console change or apply the
pending one.

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

**When the bootstrap changes** (a PR edits `bootstrap/`), re-apply it the same way from that directory once the PR is
merged: `terraform plan` should show only the change the PR describes (for example the deploy role's policy updated
in place), then `terraform apply` and copy the state to the bucket again. CI never applies it.

**Verify the budget's address.** A new address receives no budget alerts until it is verified. Open Billing and Cost
Management → Budgets → `khanha-monthly` and read its email recipient's status:

- **Active (legacy)**: what this bootstrap's recipient shows (seen 19 November 2026), although the Alerts panel also
  reads "0/1 email verified". AWS documents it as still receiving notifications; no verification is offered, and
  nothing needs doing.
- **Inactive**: no email was sent. Choose **Send Notification**.
- **Pending**: a verification email went out from an `@aws.com` sender; check spam, or choose **Resend
  verification**.
- **Active**: done. Open the email's link while signed in to this account to get here.

Nothing to change in Terraform: the recipient list stays the same.

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

The one exception is the deploy's migrate step, which needs two **secrets** in the `production` Environment (never
repository secrets, so only the approved deploy job reads them; [DEPLOYMENT.md "Applying migrations"](../docs/DEPLOYMENT.md#applying-migrations)).
`gh secret set` asks for each value, so it never lands in the shell history:

```bash
gh secret set SUPABASE_ACCESS_TOKEN --env production   # an access token that can manage the production project
gh secret set SUPABASE_DB_PASSWORD --env production    # the production database password
```

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

## Alarms

The alarms ([DEPLOYMENT.md "Alarms and the dashboard"](../docs/DEPLOYMENT.md#alarms-and-the-dashboard)) email the
SNS topic `khanha-alerts`, which the **bootstrap** creates in ap-south-1 and in us-east-1, subscribed to
`alert_email`. It lives there so the address stays in the untracked `terraform.tfvars`: production's plans are public.
`modules/observability` finds both topics by name, so **the bootstrap must be re-applied before the first infra
apply that carries PR 08**, or production's plan fails to find them. Then:

- AWS sends one "Subscription Confirmation" email per region (two in all). Open each link; an unconfirmed
  subscription receives nothing. SNS → Subscriptions shows both as **Confirmed** afterwards.
- Seeing one fire is a Closing P8 step (DEPLOYMENT.md, "Seen firing").

## The host

One EC2 `t4g.micro` (about $9.20 a month with its public address and disk), Amazon Linux 2023 on arm64. Its first
boot installs docker, the compose plugin and 2 GB of swap (`modules/compute/user-data.sh`); nothing is built on it.
The app arrives through the SSM document `khanha-deploy`, which writes `infra/host/*` to `/opt/khanha`, enables the
host-metrics timer and runs `apply-release.sh`: with candidate tags from `deploy-production.yml` ([DEPLOYMENT.md "Production releases"](../docs/DEPLOYMENT.md#production-releases)), or with none, the tags in
`/khanha/production/release` (`"<web-tag> <server-tag>"`, the last release that passed). A State Manager association
runs it once on every new host, so a replaced machine comes back on that release by itself; before the first release
it does nothing.

- **A shell on it:** Systems Manager → Session Manager → Start session (no SSH, no key).
- **Replacing it** (a newer AMI or boot script, which plans ignore on a running host): from a local checkout with
  credentials, `terraform apply -replace=module.compute.aws_instance.this`, with the user's explicit approval.
- **Its settings** are Parameter Store's `/khanha/production/*`, one variable each, written by `modules/secrets` from
  `envs/production/main.tf`. A changed setting reaches the containers on the next deploy. Production's
  `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are empty, so not created, until the production Supabase project
  exists; then a one-line PR sets them in `envs/production/variables.tf`.

## The edge and the domain

One CloudFront distribution (`modules/cdn`): the app from the host, `/api/*` never cached, `/media/*` from the
bucket (a CloudFront Function strips `/media`, since the keys are `stores/…`), `www.` answered with a 301 to the apex.
The domain goes live in two applies (the user, 19 November 2026):

1. With `domain_live = false` (`envs/production/variables.tf`) the Route 53 zone exists and the app answers at
   `terraform output cloudfront_domain` (the `d….cloudfront.net` name, also in the plan's summary once applied).
2. **(user)** At the registrar of `khanha.in`, set the four name servers from `terraform output name_servers`.
   `dig NS khanha.in +short` shows them once the change has spread (minutes to hours). Some networks answer port 53
   from their own cache; if `dig` disagrees with the registrar, ask over HTTPS:
   `curl -s 'https://cloudflare-dns.com/dns-query?name=khanha.in&type=NS' -H 'accept: application/dns-json'` must
   list exactly the four from `terraform output name_servers` (another Route 53 zone's would look alike). Done for
   `khanha.in` on 20 November 2026 (Porkbun).
3. A one-line PR sets `domain_live = true`. Its apply requests the certificate (us-east-1), validates it through the
   zone, attaches `khanha.in`, `www.`, `staff.` and `admin.`, and points their A and AAAA records at the distribution.

The certificate is not requested earlier: before the delegation it would fail validation after 72 hours.

**Media.** `khanha-media-production-<account>`: private, read by CloudFront through origin access control, written
by the host's role and by browsers through the API's presigned form (CORS for the three hosts and the CloudFront
name). Old object versions expire after 30 days; an object tagged `stage=original` (an upload never processed or
swept) after a day; the API's presigned form adds the tag.

## Changing a secret

The app's one secret, `khanha/production/app`, is a JSON object of keys, today
`{"SUPABASE_SECRET_KEY": "sb_secret_..."}`. Set it in the console (Secrets Manager → the secret → Retrieve secret
value → Edit), never in Terraform or the repository: Terraform creates only the container. Until it has a value, a
deploy fails at `render-env.sh`. A changed value reaches the containers on the next deploy.

## Moving to another account

Everything account-specific is a variable or an output, so the setup can move (after the credits end, if it ever has
to): bootstrap in the new account, connect GitHub to its outputs, apply with `domain_live = false` (with `true` the
apply would wait on a certificate the old zone cannot validate), re-enter the secret and the parameters, copy the
media bucket, deploy the last release and smoke-test it at the new CloudFront hostname. Then, at cutover, remove the
domain from the old distribution, point the registrar at the new zone's name servers, and apply `domain_live = true`
in the new account ([The edge and the domain](#the-edge-and-the-domain), [P8 plan,
Risks](../plans/P8_INFRASTRUCTURE.md#risks-and-gotchas)).
