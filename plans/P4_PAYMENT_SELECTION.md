# P4 — Payment aggregator research and selection: implementation plan

The step-by-step plan for [ROADMAP.md P4](ROADMAP.md#p4--payment-aggregator-research-and-selection): the payment
provider and the money model are chosen on evidence, and [ADR-003](../docs/adr/003-payment-aggregator-chosen-in-p4.md)
is accepted. The roadmap says what P4 decides and why, and [PAYMENT_OPTIONS.md](PAYMENT_OPTIONS.md) holds the
research; this file says who does each step, in which order, what each one blocks in
[P5](P5_PAYMENTS.md), and the few pull requests the repository needs. When a step is done, tick its box here and in
the roadmap.

> **Status: proposal** (17 November 2026). Nothing in P4 has been answered yet: no provider has replied in writing,
> the CA and the lawyer have not been asked, no merchant application is in, and ADR-003 is still **Proposed**. The
> user decided the plan's shape the same day ([Decided with the plan](#decided-with-the-plan)).

## What P4 is

P4 is mostly not code. Four of its five outputs are letters, calls and forms that only the user can send: written
rates from providers, a CA's and a lawyer's view, and a merchant application. They take weeks and no pull request
shortens them, so **they start now**, while P5's provider-neutral pull requests are built against a fake gateway.

The repository's part is small: the legal pages every provider's KYC asks for, a sandbox spike of three providers
on a real phone, and the write-up that turns the answers into ADR-003.

## Decided with the plan

The user, 17 November 2026:

- **The spike covers three providers: Cashfree, Paytm and Razorpay** (the roadmap said the top two). Razorpay is
  spiked although ADR-003 lists its list price as rejected: the spike measures its checkout on a low-end phone and
  gives the other two a baseline, and its price position stays what PAYMENT_OPTIONS.md records unless its sales
  team writes otherwise.
- **Sandbox webhooks are tested on an AWS staging, brought forward** (P8 plan D12 and D8), not through a tunnel.
  Staging is exactly `dev`, runs continuously, and takes infrastructure changes before production does
  ([below](#the-aws-staging-brought-forward)).
- **The spike's three adapters are merged into `dev`, dark**, one reviewed PR each, and the two that lose are
  deleted after ADR-003. Nothing unreviewed ever runs on staging.
- **The money model stays open until the CA answers.** P5 builds everything that is the same under both models and
  keeps its payout pull requests as an outline ([P5 plan, gates](P5_PAYMENTS.md#gates)).
- **No SMS in the pilot** ([P6 plan](P6_ORDER_EXPERIENCE.md#decisions) D1), so **the DLT registration is dropped
  from P4**. It returns with the phase that adds SMS.

## Where P4 starts

| Roadmap step             | Already there                                                                                                                                                                 | Left for P4                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| P4.1 requirements        | the must-haves and the weights, in the roadmap and in PAYMENT_OPTIONS.md                                                                                                      | nothing: they are the scoring sheet for P4.7                        |
| P4.2–P4.5 research       | PAYMENT_OPTIONS.md, gathered on 28 September 2026: provider rankings, fee models, money models A and B, the fallback ladder, the switching options and the open questions     | written answers to the open questions                               |
| P4.6 sales and contracts | nothing sent                                                                                                                                                                  | all of it (the user)                                                |
| P4.6 CA and lawyer       | nothing asked                                                                                                                                                                 | all of it (the user)                                                |
| P4.6 sandbox spike       | no payment code: `simulatePayment()` always answers `PAID`; `server/src/integrations/` holds only `media/`; `ConfigDto.payment` is always `null`; no webhook route exists     | three sandbox adapters merged into `dev`, dark, measured on a phone |
| P4.6 applications        | no `/legal/*` route; the app has no public address yet (P8 PR 05 brings the domain)                                                                                           | the four legal pages; the merchant application (the user)           |
| A public webhook address | none: staging is the Supabase staging project with the app run locally                                                                                                        | the AWS staging ([below](#the-aws-staging-brought-forward))         |
| P4.7 decision            | ADR-003 **Proposed**; its Decision section says it is completed in P4.7                                                                                                       | the scores, the ADR's final text, the user's acceptance             |
| What the choice changes  | `PAYMENT_PROVIDER` does not exist in `utils/env.ts`; the web image's CSP (Report-Only) names no payment host; README's "What V0 deliberately leaves out" still lists payments | written in by [step 6](#step-6--the-decision-written-in-p47)        |

## The steps and their order

Steps 1 to 3 run in parallel from day one. Steps 4 and 5 need pieces of P5 and P8 first. Step 6 closes the phase.

| #   | Step                                            | Who                              | Needs                                                             | Lead time (a guess) |
| --- | ----------------------------------------------- | -------------------------------- | ----------------------------------------------------------------- | ------------------- |
| 1   | Sales and contracts                             | the user                         | –                                                                 | 2 to 6 weeks        |
| 2   | CA and lawyer                                   | the user                         | –                                                                 | 2 to 4 weeks        |
| 3   | PR 01: the legal pages                          | an implementer; text by the user | the text                                                          | days                |
| 4   | The merchant application                        | the user                         | step 3 public on the production domain (P8 PR 05)                 | 1 to 3 weeks of KYC |
| 5   | PRs 02–04: the sandbox spike, one PR a provider | the main agent; the user's phone | [P5 PRs 01–12](P5_PAYMENTS.md#build-order); the AWS staging; keys | about a week each   |
| 6   | PR 05: the decision written in, and ADR-003     | the main agent; the user accepts | steps 1, 2, 4 and 5                                               | days                |

## Step 1 — Sales and contracts (the user)

- [ ] Send the questions in [PAYMENT_OPTIONS.md, Open questions](PAYMENT_OPTIONS.md#open-questions) to **Cashfree,
      Paytm and Razorpay**, and get the answers **in writing** (an email from a named person is enough; a call is
      not). The ones that decide the phase:
  - the UPI rate for payments up to ₹2,000 after any promotion, its duration and its revision clause;
  - Cashfree's promotion: a cumulative or a monthly ₹20 lakh, an end date of 31 March or 31 May 2027, what the
    Easy Split exclusion covers, and an extension to the pilot's 6 to 12 months;
  - Razorpay's promotion (90 days or ₹5 lakh) and whether Route's ₹40 lakh gate can be waived;
  - Paytm's online UPI rate in writing, and its hold's longest timeout;
  - split fees, turnover gates, and what happens when a hold lapses;
  - refund fees (normal and instant) and payout pricing.
- [ ] PhonePe, Zoho Payments and a bank's UPI merchant API are no longer spiked. Their questions may still be sent,
      at the user's choice: they are rungs of the [fallback ladder](PAYMENT_OPTIONS.md#pilot-strategy-and-fallback-ladder)
      if none of the three gives a workable rate.
- [ ] Each answer goes into PAYMENT_OPTIONS.md under a new **Answers** section (provider, date, who answered, the
      term, a link or file reference outside the repository). The repository is public: **no contract, quote or
      correspondence is committed**, only the term and its date.

## Step 2 — CA and lawyer (the user)

- [ ] **Lawyer:** would a merchant-of-record structure (model B) hold up in substance, and is model C (collecting
      into our own account and returning money by payout) direct payment aggregation?
- [ ] **CA:** GST under s.9(5) against being the seller, 194-O on split flows, GST cascading under model B,
      invoicing to customers and to restaurants, and which FSSAI licence each model needs.
- [ ] The answer names **model A or model B for the pilot**. The answer, with its date, is recorded in
      PAYMENT_OPTIONS.md and confirmed by the user on the pull request that records it. Gate G2 in the P5 plan lifts on
      that day, without waiting for step 6, and its payout outline turns into pull requests. ADR-003's final text
      (step 6) names the model again.
- [ ] Recorded like step 1: the view and its date in PAYMENT_OPTIONS.md, the documents kept outside the repository.

## Step 3 — PR 01: the legal pages

- [ ] Merged

Every provider's KYC reviewer opens the business's website and looks for four pages, so they come before the
application (the roadmap lists them under P5.11; they are needed here).

`/before-write`: reuse-scout, expected EXTEND (the route table in `client/src/App.tsx`, `SHELL_BY_ROUTE`, the page
shell `Profile` uses). An implementer builds it. Skill: `agent-skills:frontend-ui-engineering`.

Client:

- four static, lazy routes: `/legal/terms`, `/legal/privacy`, `/legal/refunds` (refund and cancellation) and
  `/legal/contact`, one `LegalPage` component rendering a document from `client/src/content/legal/<name>.ts`
  (a title, an "effective from" date, headed sections of plain paragraphs and lists). No Markdown parser and no
  new dependency: the content is typed data;
- links to them from the Profile page's footer, the register page and the checkout page ("Refunds and
  cancellation");
- the text is **the user's, reviewed by the lawyer**. Legal text is a versioned document, so it lives in the
  repository and changes by pull request; it is not a site setting. The contact page carries the business's legal
  name, address, email and phone as part of that text;
- no network call, so no loading state; the pages are public, need no sign-in, and are not excluded in
  `robots.txt`.

Tests: `client/src/content/legal/legal.test.ts` fails while any document still holds placeholder text (an empty
section, `TODO`, `lorem`, `<…>`), which is what stops the PR merging before the real text is in; each route renders
its title as the page's `h1`; `e2e/layout.spec.ts` gains the four routes (320px reflow, 200% text).

Docs: `docs/FRONTEND_STRUCTURE.md` (routes), `docs/COMPONENTS.md` (`LegalPage`). Intent: `--client minor`.

Verify: the visual gate at 390px throttled and 1280px; the four URLs open signed out.

## Step 4 — The merchant application (the user)

- [ ] The legal pages are reachable on the production domain: PR 01 released, and the domain live
      ([P8 PR 05](P8_INFRASTRUCTURE.md#build-order), decision D3). A reviewer cannot open `localhost`, and a bare
      CloudFront address looks like no business at all.
- [ ] Submit the platform's merchant KYC to the provider step 1 and the spike point at. If step 1 has two close
      candidates, apply to both: an unused account costs nothing and saves weeks on a switch.
- [ ] Split activation (model A) only if step 2 names model A.

## The AWS staging, brought forward

The user's choice for where sandbox webhooks are tested (17 November 2026). It replaces "one to two months after
the first release" in the [P8 plan](P8_INFRASTRUCTURE.md#later-staging-on-aws), whose three pull requests are
unchanged. They stay P8's: they go straight into `dev`, and the user applies and approves them like every other P8
change. [ADR-007](../docs/adr/007-pilot-on-ec2-compose.md) and [ADR-011](../docs/adr/011-free-tiers.md) were
amended by the user the same day to say all of the following.

- **Needs first:** P8 PRs 02, 04, 05 and 07 merged and applied (the network, the host module, the CDN module and
  the deploy scripts are what staging reuses).
- **Staging is exactly `dev`.** It deploys every merge to `dev` and nothing else: no branch is ever put there by
  name. That is why P5 has no phase branch ([P5 plan](P5_PAYMENTS.md#how-the-team-works-p5)) and why the spike's
  adapters are merged into `dev` ([step 5](#step-5--the-sandbox-spike)).
- **Staging first.** From the day it exists, every infrastructure and pipeline change is applied to staging,
  checked, and only then to production.
- **The webhook address** is staging's CloudFront address (`https://<id>.cloudfront.net/api/webhooks/<provider>`):
  fixed, public, HTTPS, and needing no domain of its own.
- **Cost:** about $11 a month more, about $22 in all, under the $35 ceiling
  ([the budget](P8_INFRASTRUCTURE.md#the-budget)). It runs continuously, on the credits. **In early February
  2027**, before the credits expire on the 18th, the bill is put to the user, who decides whether staging stays
  once it is paid from revenue.

## Step 5 — The sandbox spike

- [ ] PR 02: Cashfree, merged and measured
- [ ] PR 03: Paytm, merged and measured
- [ ] PR 04: Razorpay, merged and measured

A provider that step 1 rules out on price before its spike starts is not spiked: its box is ticked as "ruled out on
price", and the written term that ruled it out is recorded in PAYMENT_OPTIONS.md.

A week per provider, in the order above (Cashfree is the roadmap's first choice, so it is measured first). The
main agent builds each: it is payment code, and each is a money PR, so **the user reviews and merges it**.

**Merged into `dev`, dark** (the user, 17 November 2026). The spike is not a toy checkout and not a throwaway
branch: each adapter is a normal, reviewed PR into `dev`, branching from a fresh `origin/dev` as
`feat/p4-<NN>-<provider>-sandbox` once [P5 PRs 01–12](P5_PAYMENTS.md#build-order) are merged (the gateway port, the
fake, the holds, checkout, confirm, the webhook inbox, the refund job and the client's checkout). It runs the real
flow with one adapter swapped in by a setting. This is the roadmap's "a sandbox spike merged behind the gateway
port". Each PR holds:

- `server/src/integrations/payments/<provider>.ts`, implementing the `PaymentGateway` port: the unit conversion
  (Razorpay takes paise; Cashfree and Paytm take decimal rupees), `fetch` with a 10 s timeout, retries on
  idempotent reads only, every call logged without personal data, failures as `IntegrationError`;
- the provider's value in `PAYMENT_PROVIDER` and its sandbox key names in `utils/env.ts`. **`productionProblems`
  refuses the value in production**, so the adapter can run on staging and nowhere a customer's money is;
- the client's handling of its session (a redirect, or its SDK loaded lazily on the checkout page with a timeout
  and a retry), and its sandbox hosts in the web image's CSP;
- the port's contract suite run against it with recorded responses, and its webhook fixtures (valid, invalid,
  replayed, out of order). No migration: the adapters need no table.

Intent: `--server minor --client patch` each. The provider is switched on staging by its `PAYMENT_PROVIDER`
parameter, a deploy the user approves; between spikes staging goes back to `fake`.

**The two that lose are deleted** by [P5's adapter PR](P5_PAYMENTS.md#after-g1-the-providers-adapter) after
ADR-003, which also completes the winner for production.

**Keys.** The user opens each sandbox account and puts its test keys into the staging secret (and, for a local
run, an untracked `server/.env`). Sandbox keys are still secrets: never in the repository, a PR or a log.

**What each spike does, on staging, from a low-end Android phone on a throttled connection (the user's phone):**

1. create order → open checkout → UPI intent into PhonePe, Google Pay and Paytm → return → server-side status →
   the webhook arrives and its signature verifies;
2. a failed payment and an abandoned one, and what the provider reports for each;
3. a full refund and a partial refund, each looked up again by our own refund id;
4. Razorpay and Cashfree only, and only if step 2 leans to model A: a split after payment.

**What is recorded**, in PAYMENT_OPTIONS.md under a new **Sandbox spike results** section, one column per provider:

| Measure                                                                  | Why                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| time from tapping Pay to the UPI app opening (median of 5)               | P4.1's "mobile-web UPI checkout" criterion, 15%             |
| the SDK's weight, gzip, and whether redirect mode avoids it altogether   | the 170 KB initial-JS budget; the SDK must be lazy          |
| modal or redirect: which one hands off to the UPI app reliably           | decides the client's session mode in P5                     |
| what the customer sees when the payment fails, or the app is closed      | the "Payment not completed" path                            |
| webhook delay after approval, and whether events repeat or reorder       | the inbox's deduplication and the reconciler's sweep window |
| the amount unit, the idempotency of create and refund, the id we can set | what the adapter must convert and guard                     |
| gaps and errors in the documentation                                     | P4.1's "API quality" criterion, 10%                         |

Verify: each spike ends with one real sandbox order visible on staging's staff board, its refund `PROCESSED`, and
the numbers above written down.

## Step 6 — The decision, written in (P4.7)

- [ ] PR 05 merged, and ADR-003 accepted by the user

A docs PR into `dev`, `no-release`, by the main agent; only the user accepts an ADR (`docs/adr/README.md`).

- **The scores.** PAYMENT_OPTIONS.md gains the three finalists scored against P4.1's weights with the written
  numbers from steps 1 and 5.
- **ADR-003's final text**: the provider, the plan and its rate, the money model (A or B), the hold mechanism, the
  pilot's promotion and its end date, and the reasons. Status **Accepted** is set by the user.
- **What follows from the choice**, in the same PR:
  - the [P5 plan](P5_PAYMENTS.md#gates): gate G1 lifted, and G2 if step 2 had not already
    lifted it, the adapter PR and the payout PRs written out in full from their outlines;
  - the roadmap's P4 boxes ticked, and its P5.1 values (`PAYMENT_PROVIDER`) named;
  - the provider's checkout hosts listed for CLAUDE.md §9 (P5's adapter PR removes the two losers' hosts from the
    CSP and keeps the winner's);
  - the secret's names for [P8.6](ROADMAP.md#p86-secrets-and-configuration) (the values are the user's to set);
  - README's "What V0 deliberately leaves out".

## Gates P4 holds over P5

| Gate | Lifted by                                                                                                                           | Until then P5 does not                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| G1   | ADR-003 accepted (step 6)                                                                                                           | let any real provider be selected in production, delete the losing adapters, or name production's payment secrets |
| G2   | the CA's answer on the money model (step 2), recorded in PAYMENT_OPTIONS.md and confirmed by the user; ADR-003 repeats it at step 6 | build payouts, payout accounts or the restaurant's payout view                                                    |
| G3   | the merchant account approved, with live keys (step 4)                                                                              | go live for any store                                                                                             |

Everything else in P5 is the same for every provider and both money models, and does not wait.

## Where P4 differs from the roadmap

| Roadmap says                                                       | P4 does                                                                                                                   | Picked up by                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| P4.6 a spike of the top two providers                              | three: Cashfree, Paytm, Razorpay (the user)                                                                               | –                               |
| P4.6 "a throwaway branch"; output "a spike merged behind the port" | three reviewed PRs into `dev`, each adapter refused in production (the user); the two that lose are deleted after ADR-003 | P5's adapter PR (gate G1)       |
| P4.6 the spike includes a bank's UPI merchant API under model B    | not spiked; a question in step 1 only                                                                                     | the fallback ladder, if reached |
| P4.6 DLT registration for SMS started                              | dropped: the pilot sends no SMS (the user)                                                                                | the phase that adds SMS         |
| P5.11 the `/legal/*` pages as part of go-live                      | built here, because the application needs them                                                                            | –                               |
| P8: an AWS staging one to two months after the first release       | brought forward for the spike and P5's webhooks (the user)                                                                | P8's three staging PRs          |
| P4 "starts now, in parallel with P0"                               | it starts on 17 November 2026, with P5's provider-neutral work running beside it                                          | –                               |

## ADRs this plan touches

Only the user accepts or amends an ADR.

| ADR                  | What P4 does with it                                                                                 | Needs the user                    |
| -------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| 003 aggregator       | completes it (step 6)                                                                                | **yes**: acceptance               |
| 007 EC2 with compose | staging is brought forward, infrastructure changes go to staging first, and staging is exactly `dev` | done (the user, 17 November 2026) |
| 011 free tiers       | staging now, about $22 a month for both environments, reviewed in early February 2027                | done (the user, 17 November 2026) |
| 010 polling and push | nothing: SMS was never in it                                                                         | no                                |

## Decisions

| #   | Decision                                   | Answer or default                                                                                                               | Applies to |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D1  | Which providers are spiked                 | **answered (the user, 17 November 2026):** Cashfree, Paytm and Razorpay                                                         | step 5     |
| D2  | Where sandbox webhooks are tested          | **answered (the user, 17 November 2026):** an AWS staging, brought forward (P8 plan D8 and D12)                                 | step 5     |
| D3  | The money model for the pilot              | **open until the CA answers** (step 2); the roadmap's default is B if split products are gated, A once eligible                 | P5 gate G2 |
| D4  | SMS, and so the DLT registration           | **answered (the user, 17 November 2026):** no SMS in the pilot; no DLT step                                                     | –          |
| D5  | Where the legal text lives                 | in the repository, as typed content, changed by pull request (a default: say so if it should be editable live)                  | PR 01      |
| D6  | Whether to apply to more than one provider | a default: yes, to the top two if step 1 leaves them close                                                                      | step 4     |
| D7  | PhonePe, Zoho and bank UPI                 | a default: questions only, no spike; sent at the user's choice                                                                  | step 1     |
| D8  | Where the spike's code lives               | **answered (the user, 17 November 2026):** merged into `dev`, dark, one reviewed PR a provider; no branch is deployed by name   | step 5     |
| D9  | How long the AWS staging runs              | **answered (the user, 17 November 2026):** continuously; the bill is reviewed in early February 2027, before the credits expire | staging    |
| D10 | Where infrastructure changes go first      | **answered (the user, 17 November 2026):** staging, from the day it exists                                                      | staging    |

## Closing P4

P4 is done when, as the roadmap says: ADR-003 is **Accepted** with a written UPI rate or promotion terms; the CA's
and the lawyer's views are on file; the spike has run on a real low-end Android phone for each of the three
providers not ruled out on price in step 1; and
the merchant application has been submitted. The milestone (M4) adds "the sandbox spike merged behind the gateway
port", which step 5's three PRs are.

## User steps (cannot be done from the repository)

- Send step 1's questions and collect the written answers.
- Ask the CA and the lawyer (step 2).
- Write, or have the lawyer write, the four legal texts and hand them over for PR 01.
- ~~Amend ADR-007 and ADR-011 for the staging brought forward~~ (done 17 November 2026); apply and approve P8's
  staging PRs.
- Open the three sandbox accounts and put their test keys into the staging secret.
- Review and merge the three adapter PRs, and approve the staging deploy that switches the provider for each spike.
- In early February 2027, read the AWS bill and decide whether staging stays after the credits.
- Run each spike's payments from a low-end Android phone and read out what happened.
- Submit the merchant application once the legal pages are public on the production domain.
- Accept ADR-003.

## Risks and gotchas

- **The calendar is the providers', not ours.** Sales and KYC take weeks and may stall. That is why steps 1, 2 and
  the legal text start before any code, and why P5 is planned so that only three of its pull requests wait.
- **The spike needs P5's first twelve PRs and P8's staging.** If either slips, the spike slips; the paperwork does
  not, and it is the longer pole.
- **A promotion has an end date.** Cashfree's ends on 31 March or 31 May 2027. If the pilot launches late, most of
  the promotion is spent before the first order; ask for the extension in step 1, in writing.
- **Model B is only real if the platform really is the seller.** If the lawyer says no, model A's turnover gates
  may block the pilot's first choice; the ladder in PAYMENT_OPTIONS.md is the answer, and step 1 should already
  have asked each provider about its gate.
- **Sandbox is not production.** UPI intent in a sandbox often uses a simulator instead of the real UPI apps. The
  spike records which parts were simulated, and [P5's go-live](P5_PAYMENTS.md#gates) repeats the phone test with
  one small live payment.
- **Three adapters are three weeks.** If step 1 rules a provider out on price before its spike starts, skip its
  spike and say so in PAYMENT_OPTIONS.md.
- **Sandbox adapters live in `dev`, and `dev` is released.** Two of the three will be deleted, and all three reach
  production's image in the meantime. What keeps them inert there: `productionProblems` refuses each value, the
  production secret holds no payment key, and a test fails if either guard is loosened before P5's adapter PR.
