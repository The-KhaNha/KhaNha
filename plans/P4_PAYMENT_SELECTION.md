# P4 — Payment aggregator research and selection: execution plan

The step-by-step plan for [ROADMAP.md P4](ROADMAP.md#p4--payment-aggregator-research-and-selection). The roadmap
says what P4 decides and why; [PAYMENT_OPTIONS.md](PAYMENT_OPTIONS.md) holds the research; this file says in which
order, who does each step, what to send, and how the decision is scored. When the three disagree, the roadmap's
design wins and this file is fixed. When a step is done, tick its box here and in the roadmap.

> **Status: proposed plan, nothing sent yet** (29 September 2026). P4.1–P4.5 exist as research; P4.6 and P4.7
> remain. P4 is sized **M**. Most of it is the user's: sales, professionals and applications. The repository carries
> two pull requests and one throwaway branch.

## How the team works P4

- **Owners.** _user_: the product owner sends, signs and files. _repo_: a normal PR into `dev` (CLAUDE.md §13, §17,
  §21). _spike_: a throwaway branch that is never merged; only what it teaches reaches the roadmap's P5.1 text.
- **Nothing in P4 changes how money moves.** The legal pages PR is the one customer-visible change and ships as an
  ordinary release. No payment code lands before ADR-003 is accepted (ADR-003, Consequences).
- **Every number a provider gives goes into PAYMENT_OPTIONS.md the day it arrives**, dated, with who said it and in
  what form (email, rate card, contract). That file's rule: confirm every number in writing before signing.
- **Contracts, KYC references, the CA's and the lawyer's notes stay out of the repository.** ADR-003 cites them by
  date and title.
- **Legal and tax readings are ours until step 02 confirms them.** The pages in step 03 and the ADR in step 08 use
  the professionals' words, not ours.

## Build order

| #   | Step                                                                                             | Owner       | Roadmap     | Depends on                                      | Lead time                     |
| --- | ------------------------------------------------------------------------------------------------ | ----------- | ----------- | ----------------------------------------------- | ----------------------------- |
| 01  | Send the questions to the aggregators (Cashfree, Paytm, PhonePe; Zoho and one bank as B backups) | user        | P4.6        | –                                               | 1–3 weeks for written answers |
| 02  | Brief the chartered accountant and the lawyer                                                    | user        | P4.6        | –                                               | 1–2 weeks                     |
| 03  | PR: the `/legal/*` pages (Terms, Privacy, Refund and Cancellation, Contact)                      | repo        | P4.6, P5.11 | the entity facts (Decisions 4–5); a free branch | 1–2 days                      |
| 04  | The platform's merchant KYC at the front-runner                                                  | user        | P4.6        | 02 (the account type), 03 on a public URL       | 1–3 weeks                     |
| 05  | DLT registration for SMS: the entity and the sender id                                           | user        | P4.6, P6.3  | the same document set as 04                     | 2–6 weeks                     |
| 06  | Sandbox spike on the top two providers                                                           | spike       | P4.6        | sandbox credentials from 01; a phone            | 1 week per provider           |
| 07  | Score the finalists with the written numbers                                                     | user + repo | P4.7        | 01, 02, 06                                      | 1 day                         |
| 08  | PR: ADR-003 completed, and everything that depends on the choice                                 | repo        | P4.7        | 07; the user accepts                            | 1 day                         |

Why this order: the written answers (01) and the professionals (02) are the longest lead items and gate everything,
so they go out in the first week; the pages (03) go out the same week because KYC (04) cannot be filed without them;
DLT (05) reuses the KYC documents and takes longest to verify, so it starts as soon as they are gathered; the spike
(06) waits only for credentials; the score (07) and the ADR (08) close the phase.

**Critical path:** 01 → 07 → 08, paced by how fast sales answers. **Second path:** facts → 03 → public URL → 04.
Start 01, 02, 03 and the document gathering for 04–05 in the same week.

## Cross-cutting decisions

- **Model B is the working assumption for the pilot** (P4.5, Decisions needed #3). Every aggregator is asked for
  plain-merchant terms first and split terms second, so the later switch B → A is priced now
  ([Switching options](PAYMENT_OPTIONS.md#switching-options)).
- **Only written numbers score.** A published list price, a verbal quote or a marketing page scores as list price in
  step 07.
- **The spike implements the P5.1 port as the roadmap writes it.** If the shape must change, the roadmap's P5.1 text
  changes; no port code lands before P5.1.
- **The legal pages are model-neutral where they can be.** Prepay, refund to the original payment method through the
  aggregator, the platform as the customer's contracting party: true under A and B. The one clause that differs (who
  the seller is) is worded from step 02's answer. They ship without placeholders, or not at all.
- **Nothing in this phase needs a migration, a setting or an env var.** `PAYMENT_PROVIDER`,
  `active_payment_provider` and the provider's keys arrive in P5.1 and P8.6.

## The steps

### Step 01 — Send the questions to the aggregators (user)

- [ ] Sent: Cashfree · Paytm · PhonePe · Zoho Payments · one bank (model B backup)
- [ ] Written answers filed and copied into PAYMENT_OPTIONS.md
- [ ] Sandbox credentials for the top two

**Who and why.** Cashfree (the front-runner: a documented hold that lapses to the vendor, the ₹20 lakh promotion),
Paytm (a documented hold; 0% online UPI to get in writing), PhonePe (the largest UPI app; promotion terms and the
split API are unpublished). Backups for model B's rungs B2 and B3: Zoho Payments (API fit for a custom SPA) and one
bank's UPI merchant API (for example HDFC SmartGateway). Ask each for a sales contact who can put a rate in writing,
and for sandbox access.

**What we file.** The thread, the rate card or the draft contract, outside the repository. In PAYMENT_OPTIONS.md:
the [Provider ranking](PAYMENT_OPTIONS.md#provider-ranking) row, the [Fees](PAYMENT_OPTIONS.md#fees) tables and the
[Open questions](PAYMENT_OPTIONS.md#open-questions) list, each answer dated.

**Draft: the common email** (fill the ⟨⟩ parts; send one per provider, with its addendum below):

> Subject: Pricing and integration questions — campus food pickup platform, UPI-first
>
> Hello ⟨name⟩,
>
> We run ⟨Food Pickup⟩ (⟨legal entity⟩), a mobile-web ordering app for campus cafés: customers prepay from their
> phone and collect at the counter. We are choosing our payment aggregator now and integrating in the next quarter.
>
> Our profile: a React web app on Android phones (no native app); about 99% UPI, 99% of payments under ₹2,000,
> an average of about ₹200; a forecast of 500–3,000 orders a month in a 6–12 month pilot, growing to 10,000; one to
> twenty partner cafés. We would start as the merchant of record on a plain merchant account, and may later move to a
> marketplace setup where the café's share is held until pickup and released by API.
>
> Could you answer the following in writing (an email or a rate card is fine)?
>
> 1. The UPI rate for merchant payments up to ₹2,000: the rate itself, its duration, any slabs, and the revision
>    clause. Is a 0% rate available beyond a new-merchant promotion, and on what terms?
> 2. Any new-merchant promotion: the cap (cumulative or monthly), the end date, what it excludes, and whether it can
>    be extended to cover a 6–12 month pilot.
> 3. The rate on cards and netbanking, and the platform fee on RuPay credit on UPI.
> 4. Refunds by API: full and partial, the fee for a normal and an instant refund, whether the original transaction
>    fee is retained, and how long a UPI refund takes to reach the customer.
> 5. Webhooks and status: the signing method, retries, event ordering guarantees, and the server-side status API.
> 6. UPI intent on mobile web, on Android and on iOS: which UPI apps it opens, and your success rates by app.
> 7. The split or hold product (marketplace use): its fee and basis (the vendor's share or the full amount), the
>    maximum hold, its granularity, what happens when a hold lapses, refunds after a release, vendor onboarding by
>    API for small proprietorships, and any turnover threshold (for example ₹40 lakh) for activation or for payouts
>    to third parties.
> 8. Payouts (if we pay cafés ourselves): per-transfer pricing for NEFT, IMPS and UPI, batching, and a statement
>    API.
> 9. Whether the API exposes the payer's VPA, and your terms on reusing it.
> 10. Onboarding: the KYC documents for a ⟨private limited / LLP / proprietorship⟩, the website pages you require,
>     the time to go live, and a sandbox account for a two-week evaluation.
> 11. Reconciliation: a settlement report or API with per-transaction fees.
>
> Thank you,
> ⟨name, role, phone⟩

**Addenda, per provider:**

| Provider      | Add                                                                                                                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cashfree      | Is the ₹20 lakh 0% offer cumulative or monthly; is its end date 31 March or 31 May 2027; does the Easy Split exclusion remove the offer for a split-enabled account entirely, or only exclude the split fee; the post-offer UPI rate; an extension to 6–12 months |
| Paytm         | 0% on online UPI in writing, as on the EDC rate card; the maximum `POST_TXN` split timeout; a vendor onboarding API; when refund error 678 (a second partial refund) applies                                                                                      |
| PhonePe       | The split-and-hold API, its docs and sandbox; the "1.99% FREE" offer's cap, duration and T&C; how repeated webhooks are deduplicated                                                                                                                              |
| Zoho Payments | Server-created orders, UPI intent on mobile web, signed webhooks and refunds from a custom React SPA (not a Zoho product); the 0.5% rate's conditions                                                                                                             |
| Bank (B2)     | The UPI merchant API: intent, dynamic QR, status, refunds, callbacks, reconciliation files, fees, sandbox; whether a PA is still needed for cards                                                                                                                 |

**Done when:** written answers on the UPI rate, the hold and refunds from at least two aggregators, and sandbox
credentials for the top two.

### Step 02 — Brief the chartered accountant and the lawyer (user)

- [ ] CA's note on file
- [ ] Lawyer's note on file
- [ ] Their answer to "A or B for the pilot", and the seller wording for the Terms

**The brief to hand over is [P4_CA_LAWYER_BRIEF.md](P4_CA_LAWYER_BRIEF.md)**, self-contained for reading away from the repository. Its outline:

> **What we do.** A mobile-web app where customers prepay for food from partner cafés on campus and collect it at the
> counter. The café's share is meant to be held until pickup, or until the pickup window ends, and paid to the café
> after that. When the café is at fault (it rejects the order, is late, or runs out), the customer is refunded in full
> to the original payment method through the aggregator. The platform keeps a commission. About 99% of payments are
> UPI under ₹2,000, averaging ₹200; the pilot runs 6–12 months at 500–3,000 orders a month with one to twenty cafés.
>
> **The two structures we are choosing between** (our reading is in
> [PAYMENT_OPTIONS.md, Money models A and B](PAYMENT_OPTIONS.md#money-models-a-and-b)):
>
> - **A. Marketplace.** The café sells; we are an e-commerce operator taking a commission. An RBI-authorised
>   payment aggregator (PA) keeps the money in its escrow, holds the café's share, and releases it on our API call
>   (Cashfree Easy Split, Paytm split settlement, PayU, Razorpay Route).
> - **B. Merchant of record.** We sell the food; cafés are suppliers under contract. The PA settles to our account
>   (T+1/T+2); we pay cafés by scheduled transfers. Refunds still go through the PA to the original payment method.
>
> A third reading, **C**, where we collect as a marketplace into our own account and send money back to customers
> by separate transfer, we intend to reject: it may be direct payment aggregation, and a transfer does not close a
> UPI dispute.
>
> **For the lawyer**
>
> 1. Under the RBI Payment Aggregator Directions (15 September 2025), would B be a lawful merchant-of-record
>    structure for us, and what must be true in substance (contracts, invoicing, liability) for it to hold?
> 2. Would C, or B in name only, amount to "direct payment aggregation" requiring authorisation?
> 3. Our obligations under the Consumer Protection (E-Commerce) Rules 2020 as a marketplace (A) versus a seller (B):
>    disclosures, grievance officer, refund timelines.
> 4. Under the DPDP Act: the minimum content of our privacy notice, consent for SMS and push, whether we must name a
>    grievance officer, and the response time for data-principal requests.
> 5. Which FSSAI licence the platform needs under A and under B.
> 6. One sentence, in your words, for our Terms: who the customer buys from under the structure you recommend.
>
> **For the CA**
>
> 1. GST: under A, section 9(5) (the operator pays 5% on restaurant services supplied through it) — confirm, and
>    whether TCS applies; under B, GST as the seller, whether the 5% without input credit cascades, and the net
>    effect on a ₹200 order.
> 2. TDS under section 194-O (0.1% on e-commerce participants' gross sales) under A; what applies under B.
> 3. Invoicing: to customers, and to cafés for commission (A) or from cafés as suppliers (B).
> 4. Is the 18% GST on the aggregator's fees claimable as input tax credit in each model?
> 5. Payouts to cafés under B: any withholding, and the bookkeeping for holds and refunds.
> 6. Your recommendation for the pilot, A or B, and what would make you change it (for example, clearing the
>    ₹40 lakh turnover mark).

**Done when:** both notes on file; the model for the pilot named; the seller sentence received.

### Step 03 — PR: the `/legal/*` pages (repo)

- [ ] Merged
- [ ] Reachable on a public URL (Decisions needed #1)

The four pages every aggregator's KYC asks for, and P9.4's DPDP items that a page can satisfy. Built only when the
entity facts (Decisions needed #4–5) and the seller sentence (step 02) are in hand: **placeholders never ship.**
Run `/before-write` first: a long-text wrapper (a `Prose` atom) may already exist or may be a variant of an atom in
`docs/COMPONENTS.md`.

| File                                             | Purpose                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/src/pages/Legal.tsx` (`LegalPage`)       | one lazy route, `/legal/:doc`, `doc` ∈ `terms`, `privacy`, `refunds`, `contact`; anything else renders `NotFoundPage`; sections are typed data rendered by one component, so the four documents share one chunk and one layout |
| `client/src/config/legal.ts`                     | the entity facts, named once: legal name and type, registered address, support email and phone, support hours, the grievance officer, the governing-law city, GSTIN and FSSAI number when held, the effective date             |
| `client/src/App.tsx`                             | the lazy import, the `<Route>`, and a `SHELL_BY_ROUTE` entry (`column` layout, top bar with the document's title, back to `/profile`, no cart button)                                                                          |
| `client/src/pages/Profile.tsx`, `pages/Home.tsx` | footer links "Terms · Privacy · Refunds · Contact" (a KYC reviewer looks for them from the home page; below the fold, no layout shift)                                                                                         |
| `client/e2e/smoke.spec.ts`                       | the four routes join the 360×640 smoke (200% text, no sideways scroll, 44px targets)                                                                                                                                           |
| `client/src/pages/Legal.test.tsx`                | each document renders its heading and the support email from `legal.ts`; `/legal/x` renders Not found                                                                                                                          |
| `docs/FRONTEND_STRUCTURE.md`                     | the Routes and Pages tables                                                                                                                                                                                                    |
| `docs/CONFIGURATION.md`                          | "What stays in code": the entity facts in `legal.ts`, like `APP_TITLE`                                                                                                                                                         |
| `docs/COMPONENTS.md`                             | only if a `Prose` atom or variant is added                                                                                                                                                                                     |
| `.changes/`                                      | `npm run change -- --client minor "Terms, Privacy, Refund and Cancellation and Contact pages at /legal/*"`                                                                                                                     |

**What each page says** (the outline; the copy is written in the PR, in plain language, from the facts and step 02):

- **Terms.** Who we are (entity, address); what the service is (ordering for pickup from partner cafés); accounts
  and eligibility; ordering and payment (prices in rupees as shown; an order is confirmed when its payment is
  confirmed; today, until online payment launches, how payment is taken — Decisions needed #6); pickup (the ready
  time, collection at the counter); cancellation and refunds (a link to that page); acceptable use; liability;
  governing law and courts (the city); contact; the effective date; and the seller sentence from step 02.
- **Privacy** (DPDP Act). What we collect (name, phone, email, orders, device and log data); why; who receives it
  (the café, for your order; the payment aggregator, once live; our hosting providers); retention (orders kept for
  accounting, personal details removed after the retention period, P9.4); your rights and how to exercise them
  (access, correction, deletion, through the Contact page until `DELETE /api/me` exists); consent for SMS and push
  (opt-in, P6.3); browser storage (the cart and a menu cache in local storage; no advertising trackers); the
  grievance officer; the effective date.
- **Refund and Cancellation.** Orders are prepaid. When the café rejects or cannot fulfil an order, or it is not
  ready within the promised time, the full amount is refunded to the original payment method through the payment
  aggregator; a UPI refund typically reaches the customer in 2–7 business days, depending on the bank. An order not
  collected within its pickup window is not refunded (R4.2). Cancellation by the customer: what V0 allows today, and
  the P5.8 policies when they ship. Money debited but the payment failed: the bank reverses it automatically; contact
  us with the UPI reference if it has not arrived. How to raise a refund request (the order number, the Contact
  page).
- **Contact.** Entity, address, support email, phone and hours; the grievance officer for privacy requests; how to
  report a problem with an order.

**Verify:** the four routes and `/legal/x` at 360px and 1280px, 200% text; the links from Profile and Home; the
initial JS budget unchanged (`npm run check:bundle`: the chunk is lazy); `/post-change`.

**Done when:** merged, and served on the public URL that step 04 will name.

### Step 04 — The platform's merchant KYC (user)

- [ ] Documents gathered
- [ ] Submitted at ⟨provider⟩; the reference number filed

Cashfree first, once step 02 has named the model, because the account type (a plain merchant account for B, a
marketplace or Easy Split account for A) is chosen at sign-up and the promotion excludes Easy Split. Paytm or PhonePe
in parallel only if their written terms compete. Typical documents, to confirm against each provider's checklist:
the entity's PAN; the certificate of incorporation, the partnership deed or the proprietor's PAN and Aadhaar; the GST
registration or a declaration; a cancelled cheque or a bank statement; the authorised signatory's ID; the website
URL with the four pages; a description of the business. Turnover up to ₹40 lakh gets simplified KYC (RBI PA
Directions).

**Done when:** submitted; the reference filed; the go-live date recorded in PAYMENT_OPTIONS.md.

### Step 05 — DLT registration for SMS (user)

- [ ] Principal Entity registered
- [ ] Sender id (header) registered

India's DLT rules apply to every commercial SMS. Register the entity on one telecom operator's DLT portal (a
registration with one operator is recognised by the others), then register a sender id. Templates are registered in
P6.3, once the texts exist (`order.ready`, `order.rejected`, `refund.processed`). Documents: the PAN, the GST or
registration certificate, a letter of authorisation, the signatory's ID; a small registration fee. Verification takes
weeks, which is why the roadmap starts it here.

**Done when:** the entity and the header are approved; their ids go into P8.6's secrets list.

### Step 06 — Sandbox spike (throwaway branch)

- [ ] ⟨provider 1⟩ measured on the phone
- [ ] ⟨provider 2⟩ measured on the phone
- [ ] "Spike results" section added to PAYMENT_OPTIONS.md; the P5.1 port text amended if needed

One week per provider, for the two that lead after step 01 (default: Cashfree and Paytm; PhonePe replaces Paytm if
it puts 0% in writing first). Branch `spike/pa-<provider>`, never merged. It implements the `PaymentGateway`
interface from [P5.1](ROADMAP.md#p51-payment-gateway-port-and-adapter) as written (`createOrder`,
`getOrderStatus`, `verifyWebhook`, `refund`, `getRefund`; `listSettlements` if the sandbox has it), a temporary
checkout route and a webhook route, and the provider's lazy SDK on the client. Sandbox keys only, through `.env`,
never committed; a tunnel to the local API is fine for the webhook.

**Protocol** (the roadmap's, on a real low-end Android phone with PhonePe, Google Pay and Paytm installed, on a
throttled network):

1. create the order → checkout (the SDK loaded on demand) → UPI intent into each app → return to the SPA → status
   check → webhook;
2. a full refund and a partial refund;
3. a split after payment (model A only);
4. the failure paths: the customer backs out of the UPI app, a timeout, pending-then-success, a duplicate webhook,
   an out-of-order webhook.

Under model B, include the bank's UPI API if it is still a candidate.

**Record, per provider:**

| Measure                                           | Cashfree | Paytm | ⟨other⟩ |
| ------------------------------------------------- | -------- | ----- | ------- |
| Tap → UPI app open (ms, median of 5)              |          |       |         |
| Return to the SPA after payment (works / how)     |          |       |         |
| SDK weight (KB gzip) and when it loads            |          |       |         |
| Webhook lag after payment (s)                     |          |       |         |
| Signature verification: documented, correct       |          |       |         |
| Partial refund; refund after release (A)          |          |       |         |
| Failure paths handled (list the gaps)             |          |       |         |
| Sandbox coverage (success, failure, refund, hold) |          |       |         |
| Documentation gaps                                |          |       |         |

**Gotcha:** sandboxes often simulate the UPI app instead of opening it; measure the tap-to-app time with the
provider's test flow on the real phone, and if the sandbox cannot open a real app, note it and measure again with a
₹1 live payment after KYC.

**Done when:** both providers measured and recorded.

### Step 07 — Score the finalists (user, into PAYMENT_OPTIONS.md)

- [ ] Scored; the table added to PAYMENT_OPTIONS.md under "Provider ranking"

P4.1's weights, on written numbers only, each criterion 0–5:

| Criterion (weight)               | 5                                                                                                              | 3                                                                 | 1                                           | 0                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| UPI fee under ₹2,000 (40%)       | 0% in writing beyond the pilot                                                                                 | 0% promotion covering the pilot, then ≤ 0.5%; or ≤ 0.5% permanent | list price (about 2%)                       | worse, or unwritten  |
| Holding the vendor's share (20%) | documented split after payment and deferred settlement; a lapsed hold goes to the vendor; no turnover gate     | documented, but gated, or a lapsed hold goes to the platform      | marketing only                              | none                 |
| Mobile-web UPI checkout (15%)    | from step 06: intent opens all three apps, under 2 s tap-to-app on the phone, SDK ≤ 30 KB gzip, a clean return | one miss                                                          | two misses                                  | intent does not work |
| API quality (10%)                | partial refunds, status, signed webhooks with retries and ids, reconciliation API, clear docs                  | one gap                                                           | several gaps                                | no sandbox           |
| Onboarding (10%)                 | KYC in days, vendor KYC by API for proprietorships (A), no unusual page requirements                           | weeks                                                             | a turnover or category block to work around | refused              |
| Regulatory standing (5%)         | final PA authorisation, no enforcement history                                                                 | in-principle, or a bank                                           | an enforcement action                       | unauthorised         |

Score = Σ weight × points ÷ 5. Highest wins; a tie goes to the safer lapsed hold. Under model B the hold criterion
scores the later switch to A, not the pilot.

| Finalist | UPI fee | Hold | Checkout | API | Onboarding | Standing | Total |
| -------- | ------- | ---- | -------- | --- | ---------- | -------- | ----- |
| Cashfree |         |      |          |     |            |          |       |
| Paytm    |         |      |          |     |            |          |       |
| PhonePe  |         |      |          |     |            |          |       |
| ⟨B2/B3⟩  |         |      |          |     |            |          |       |

**Done when:** the table is filled from the file's dated numbers and the spike results.

### Step 08 — PR: ADR-003 completed and its dependents (repo)

- [ ] Merged; ADR-003 **Accepted** by the user
- [ ] P4 boxes ticked in ROADMAP.md

| File                                              | Change                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/adr/003-payment-aggregator-chosen-in-p4.md` | Decision: the provider, the plan and its written rate, the money model, the hold mechanism, the promotion and its end date, the score, the reasons; Context: the CA's and the lawyer's notes by date; Status `Accepted` (the user's call) |
| `docs/adr/README.md`                              | the index row's status                                                                                                                                                                                                                    |
| `plans/PAYMENT_OPTIONS.md`                        | a "Decision" line at the top pointing at ADR-003; the score table; the spike results                                                                                                                                                      |
| `plans/ROADMAP.md`                                | P5's worked example and `PaymentGateway.provider` name the chosen provider; P5.12's ladder starts from the choice; Decisions needed #1 and #3 resolved                                                                                    |
| `README.md`                                       | "What V0 deliberately leaves out": payment is simulated; the aggregator chosen in ADR-003 arrives in P5                                                                                                                                   |

Env names (P8.6) and CSP hosts (CLAUDE.md §9) change with the P5.1 and P5.3 PRs that use them, not here. Docs only:
label the PR `no-release`.

**Done when:** the roadmap's P4 "Done when" holds: ADR-003 accepted with a written rate or promotion terms; the CA's
and the lawyer's views on file; the spike run on a real phone; the merchant application submitted.

## Decisions needed

| #   | Decision                                                         | Needed by | Default proposed here                                                                                                                                |
| --- | ---------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A public URL for the legal pages before P8 delivers staging      | step 04   | register the domain now (roadmap decision #13) and serve the web image alone on any small host until P8.5 replaces it: `/legal/*` calls no API       |
| 2   | Which two providers get a sandbox week                           | step 06   | Cashfree and Paytm; PhonePe replaces Paytm if it puts 0% in writing first                                                                            |
| 3   | The model for the pilot (roadmap decision #3)                    | step 03   | B, unless step 02 says otherwise                                                                                                                     |
| 4   | The entity facts for `legal.ts`                                  | step 03   | legal name and type, registered address, support email, phone, support hours, governing-law city, GSTIN and FSSAI number if held, the effective date |
| 5   | The grievance officer (DPDP) and the privacy contact             | step 03   | the product owner, at a dedicated address                                                                                                            |
| 6   | How the Terms describe payment while `simulatePayment()` is live | step 03   | "orders are paid at the counter until online payment launches; when it does, the Refund and Cancellation policy applies", amended in P5.3            |

## User steps (cannot be done from the repository)

- Send the step 01 email to each provider with its addendum; send the step 02 brief; file every answer.
- Provide the entity facts and the grievance officer (Decisions #4–5), and the seller sentence from the lawyer.
- Register the domain and approve a host for the legal pages (Decision #1).
- Gather the KYC documents; submit the application; start DLT.
- Provide sandbox credentials for the two spike providers, and a low-end Android phone with PhonePe, Google Pay and
  Paytm installed.
- Accept ADR-003 (only the user moves an ADR to Accepted).

## Risks and gotchas

- **Cashfree's end date binds before its cap** at pilot volume (31 March or 31 May 2027): get the extension in
  writing before signing, or plan the next rung for that date (P5.12).
- **The promotion excludes Easy Split.** Choosing a marketplace account at KYC may forfeit it; decide the account
  type with step 02's answer in hand.
- **Paytm's lapsed hold settles to the platform.** Under model A that turns a watchdog bug into a compliance problem;
  under B it does not matter.
- **KYC is the critical path into P5**, and every later provider switch costs another KYC and an overlap period.
- **The legal pages are read by a KYC reviewer and by customers.** They must describe what the live app does the day
  they ship (Decision #6), and be amended in the P5.3 PR when real payments switch on.
- **Sandboxes simulate UPI apps.** The checkout score needs the real phone (step 06's gotcha).
- **Never commit provider keys**, sandbox or live; the spike branch reads them from `.env` like everything else.
- **Numbers drift.** PAYMENT_OPTIONS.md is dated 28 September 2026; a promotion's terms or a rate may change before
  signing. The written answer, not the file, is the contract.
