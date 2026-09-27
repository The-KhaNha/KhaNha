# Payment options

How Food Pickup should take money: which payment aggregator (PA), which money model, what each costs, and how to
switch later. This file is the reference behind [ROADMAP.md P4](ROADMAP.md#p4--payment-aggregator-research-and-selection)
and the ADR-003 it produces. The ranking tables, the model A vs B requirements and trade-offs, the fallback ladder and
the switching options live here, so they survive when the roadmap's P4 checklist is trimmed.

> **Researched on 28 September 2026 from public sources, listed [at the end](#sources).** Prices, promotions and
> terms change often. Confirm every number in writing before signing, and update this file when a term changes.
> The legal and tax readings are ours, not advice; a CA and a lawyer confirm them
> ([ROADMAP P4.6](ROADMAP.md#p46-validation-steps)). "Unverified" marks
> a claim no primary source confirmed.

## Contents

- [Requirements](#requirements)
- [Regulatory facts](#regulatory-facts)
- [Provider ranking](#provider-ranking)
- [Fees](#fees)
- [Money models A and B](#money-models-a-and-b)
- [Refunds, not payouts](#refunds-not-payouts)
- [Pilot strategy and fallback ladder](#pilot-strategy-and-fallback-ladder)
- [Switching options](#switching-options)
- [Open questions](#open-questions)
- [Sources](#sources)

## Requirements

**Product constraints**, set by the product owner:

- **99% of payments will be UPI, and 99% will be under ₹2,000**, at an average of about ₹200. Cards and netbanking
  must exist so the rare card payer is not turned away, but they do not drive the choice.
- Customers prepay. The restaurant's share is held until pickup, or until the pickup window ends, and is then paid
  out. When the restaurant is at fault (a rejection, lateness, a stock mismatch), the money goes back to the
  customer. The platform keeps a commission.
- The app is mobile web first: a React SPA used on low-end Android phones over slow networks. There is no native app.
- The pilot may run for 6–12 months on a temporary 0% rate and switch provider afterwards.

**Must-haves.** A provider missing any of these is out:

1. RBI authorisation as a payment aggregator, in good standing (or a bank, under model B).
2. UPI by **intent** on mobile web, which opens PhonePe, Google Pay, Paytm or BHIM from the browser, and QR on
   desktop. UPI collect does not count, because NPCI is phasing it out for merchant payments.
3. A server-side status API, and signed webhooks.
4. Full and partial refunds by API, to the original payment method.
5. A sandbox that covers success, failure and refunds.

**Weighted criteria:**

| Criterion                                         | Weight | Measured by                                                                                                                                    |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Effective fee on UPI under ₹2,000                 | 40%    | the written rate, the promotion's terms and what follows them; the [fee model](#fees)                                                          |
| Holding the vendor's share until pickup (model A) | 20%    | a documented split after payment or deferred settlement; the hold limit and what happens when it lapses; refunds after release; turnover gates |
| Mobile-web UPI checkout                           | 15%    | the sandbox spike on a throttled 360px Android phone: tap → UPI app → back, success rate, script weight                                        |
| API quality                                       | 10%    | refunds, status, webhook signatures and retries, reconciliation APIs, a Node SDK or clean REST, documentation                                  |
| Onboarding                                        | 10%    | platform KYC, KYC for small proprietorship cafés as vendors, website-policy requirements, time to go live                                      |
| Regulatory standing                               | 5%     | final authorisation, enforcement history                                                                                                       |

## Regulatory facts

As of September 2026.

- **MDR on UPI.** Merchant (P2M) UPI payments up to ₹2,000 carry **zero MDR**, "even for established commercial
  entities". From 15 October 2026, payments above ₹2,000 carry a 0.4% MDR, capped at ₹300 from ₹75,000.
  - Some categories pay a flat ₹5 (railways, telecom, insurance, fuel, utilities).
  - Micro-merchants taking up to ₹1 lakh a month by QR into their own account are exempt.
  - The MDR may not be passed on to customers.
  - RuPay credit cards on UPI follow credit-card rules.
  - Sources: [R1], [R2], [R4].
- **The PA platform fee is separate from MDR.** Regulation sets MDR only, and nothing found bars a PA from charging
  merchants its own platform fee. That fee is the ~2% every standard plan charges on UPI. The FAQ's ban on "platform
  fees" applies to consumer UPI apps, not to PAs [R1].
- **Incentive scheme.** The government pays banks 0.15% on small merchants' UPI payments up to ₹2,000 (₹2,000 crore
  budgeted for FY27). It does not lower PA fees [R10], [R11].
- **UPI collect.** P2P collect ended on 1 October 2025. P2M collect is being phased out: it is already blocked on
  Android and desktop, and iOS is temporarily exempt. Build on intent (mobile) and QR (desktop) [R7], [R8], [R9].
- **RBI Payment Aggregator Directions** (15 September 2025) [R5]:
  - A PA aggregates funds only for merchants it has a contract with, and must not run a marketplace itself.
  - A marketplace that a PA has onboarded must not take payments for sellers the PA has not onboarded (§13.f).
  - **Refunds go to the original payment method** (§10.f).
  - Settlement timing follows the PA–merchant agreement, so a contractual hold is lawful.
  - The escrow account may pay onboarded merchants, refund payers and pay the PA's commission. It may pay third
    parties on a merchant's instruction only for merchants with turnover above ₹40 lakh. This is the likely origin
    of Razorpay Route's turnover gate.
  - Merchants with turnover up to ₹40 lakh get simplified KYC.
- **Marketplaces.** The 2020 guidelines made marketplaces that offer PA services separate that business and seek
  authorisation [R14]. A 2021 clarification treats marketplaces that **use** a PA as merchants [R13], and
  marketplaces "undertaking direct payment aggregation" as PAs. Whether "the PA settles to the marketplace, and the
  marketplace pays its sellers" counts as direct aggregation is **not defined**, so that needs a lawyer's opinion.
- **Disputes.** Customers raise complaints through NPCI's UDIR. An unanswered "goods or services not received"
  complaint on a merchant payment becomes a chargeback after T+3 [R15], [R16], and NPCI's February 2025
  auto-acceptance rules tighten this [R17]. A refund through the PA is linked to the original transaction; a separate
  transfer is not.
- **Tax** (for the CA to confirm):
  - Under GST section 9(5), the e-commerce operator pays the 5% GST on restaurant services supplied through it (since
    1 January 2022), and GST TCS does not apply to those supplies [X1].
  - Section 194-O TDS of 0.1% (since 1 October 2024) applies to e-commerce participants' gross sales [X2].
  - As merchant of record, the platform is the supplier. Restaurant-service GST is 5% without input credit, so tax may
    cascade.
- **FSSAI.** E-commerce food businesses need a Central Licence whatever their turnover (secondary source; confirm)
  [X3].
- **Consumer Protection (E-Commerce) Rules 2020.** Refunds are to be made "as prescribed by the Reserve Bank of India"
  [R18].

## Provider ranking

### Who offers 0% on online UPI

| Provider (RBI status)                               | Published online UPI fee                                      | Is 0% available? Plan, cap and conditions                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cashfree** (final PA, Dec 2023)                   | 1.95% + GST                                                   | **Promotion only.** 0% platform fee on domestic methods, including UPI, for merchants who sign up on or after 21 Jul 2026, up to a **cumulative ₹20 lakh GMV**, then 1.95%. **Existing merchants, Easy Split and subscriptions are excluded.** The banner says "till 31-Mar-27" but the T&C say 31 May 2027, and a blog post describes a monthly cap. Confirm all three [C1], [C5] |
| **Razorpay** (final PA, Dec 2023)                   | 2% ("Zero MDR — 2% platform fee")                             | **Promotion only.** Accounts activated on or after 1 Jul 2026 get 0% for 90 days or ₹5 lakh cumulative GMV, whichever comes first, including RuPay credit on UPI. GST and a ₹199 + tax KYC fee apply [Z1], [Z2]                                                                                                                                                                    |
| **PhonePe PG** (final online PA, Sep 2025)          | 1.99% (Standard plan)                                         | **Promotion only.** "1.99% FREE*", limited period, for new users; the cap, duration and T&C are not public [P1]–[P3], [P13]                                                                                                                                                                                                                                                        |
| **Paytm PG** (PPSL; final online PA, Nov 2025)      | 1.99% + GST on all transactions [T1]                          | **Not published online.** UPI is 0.00% only on the card-machine (EDC) rate card [T3]. An older article (date unverified) says its all-in-one PG charged 0% on UPI and RuPay [T15]. Ask for it in writing                                                                                                                                                                           |
| **PayU** (final online PA, May 2025)                | "varies by business type and volume"; 2% on domestic methods  | custom pricing only [O1]                                                                                                                                                                                                                                                                                                                                                           |
| **Zoho Payments** (PA, Feb 2024, per press)         | **0.5%** online; 0% in person only                            | **the lowest permanent published online UPI rate found**; no published marketplace split or hold; whether its API suits a custom SPA is unverified [Zo1], [Zo2]                                                                                                                                                                                                                    |
| **CCAvenue**                                        | 2% + GST including UPI, plus ₹1,200 a year (waived in year 1) | no; the "Startup Pro 0% UPI" claims date from 2019 [O12]                                                                                                                                                                                                                                                                                                                           |
| **Easebuzz** (full PA, Nov 2025)                    | not published ("customised after KYC")                        | third-party claims of 0% UPI are unverified [O7]                                                                                                                                                                                                                                                                                                                                   |
| **Direct bank UPI** (for example HDFC SmartGateway) | 0% MDR up to ₹2,000; the bank's API fees are unknown          | a bank, not a PA. The money lands in the platform's own account, so it suits model B only [O10]                                                                                                                                                                                                                                                                                    |
| **Google Pay for Business**                         | not a payment gateway                                         | a UPI app that works through sponsor banks. Its web API runs only in Chrome on Android, and its desktop flow relies on collect. Every PA's UPI intent already reaches Google Pay users [G1]–[G5]                                                                                                                                                                                   |

**No RBI-authorised PA publishes a permanent 0% online UPI rate.** 0% exists as new-merchant promotions, offline QR
pricing or negotiated contracts.

### Capabilities

| Provider     | Hold-then-release (model A)                                                                                                                                                                  | Mobile-web UPI checkout                                                                        | Refunds and webhooks                                                                                                           | Settlement                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Cashfree** | Easy Split: split after payment; vendor settlement deferred up to **45 days, then released to the vendor automatically**; up to 5 vendors a transaction; 0.20–0.25% on the vendor share [C2] | JS SDK in redirect, modal or inline mode; intent on mobile, QR on desktop [C3]                 | refunds API (after a split, recovered from the vendor's next settlement); base64 HMAC over timestamp + raw body [C4]           | T+1 main account; T+2 for vendors by default |
| **Paytm**    | `POST_TXN` split with a timeout in days, then a post-facto split API; `splitRefundInfo`. **A lapsed hold settles 100% to the platform.** The account manager must enable it [T4], [T5]       | JS Checkout; intent on Android and iOS mobile web [T7]                                         | partial refunds (some reject a second partial, error 678); free refunds; checksum-signed webhooks and a status API [T6], [T13] | T+1                                          |
| **PhonePe**  | only on marketing pages ("holding state", clawback); **no public API** [P4], [P5]                                                                                                            | hosted PayPage (iframe or redirect); QR on desktop; Node SDK from a tarball [P7], [P10], [P11] | `/payments/v2/refund` (partial allowed); SHA256 or HMAC webhooks, which may repeat [P7], [P8]                                  | T+1; a reconciliation API [P9]               |
| **Razorpay** | Route `on_hold` / `on_hold_until`; release by `PATCH`; `reverse_all` on refund; +0.1% (0.25% also shown) a transfer; **needs ₹40 lakh domestic turnover** [Z5]–[Z7]                          | Standard Checkout; intent on mobile web; QR on desktop [Z10]                                   | full and partial refunds; HMAC `X-Razorpay-Signature`, event ids [Z8]                                                          | T+2                                          |
| **PayU**     | aggregator workflow: a child merchant's settlement is blocked until `release_settlement` [O2], [O3]                                                                                          | yes                                                                                            | yes                                                                                                                            | T+2                                          |
| **Zoho**     | none published                                                                                                                                                                               | unverified for a custom SPA                                                                    | unverified                                                                                                                     | –                                            |
| **Bank UPI** | none                                                                                                                                                                                         | bank APIs for intent, dynamic QR and status                                                    | bank refund APIs (to confirm)                                                                                                  | same day to your own account                 |

### Ranking for model A (marketplace: split and hold required)

| Rank | Provider                           | Why                                                                                                                                                           | Condition                                                                                        |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1    | Cashfree                           | documented split after payment and deferred settlement; a lapsed hold goes to the **vendor** (safe); vendor onboarding by API; a good SPA SDK; a clean record | a written post-promotion UPI rate (target 0%); split fee at most 0.1%; the ₹40 lakh gate cleared |
| 2    | Paytm                              | a documented hold (`POST_TXN`) and refunds after a split                                                                                                      | 0% online UPI in writing; the reconciler releases holds well before the timeout                  |
| 3    | PayU                               | a documented `release_settlement`                                                                                                                             | a quote; custom pricing                                                                          |
| 4    | Razorpay                           | the most mature hold (Route), and the one already planned                                                                                                     | custom UPI pricing, and the platform past the ₹40 lakh gate                                      |
| 5    | PhonePe                            | the largest UPI app, and a T+1 reconciliation API                                                                                                             | a documented split-and-hold API with a sandbox, and a UPI rate that is not a promotion           |
| –    | Zoho, bank UPI, Easebuzz, CCAvenue | no documented hold, or no fee advantage                                                                                                                       | not suitable for model A                                                                         |

### Ranking for model B (merchant of record: any plain gateway)

| Rank | Option                                                                 | Why                                                  | Trade-offs                                                                                                           |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | A PA with **0% UPI in writing** (Cashfree, Paytm, PhonePe)             | the best checkout and APIs at zero cost              | depends on negotiation                                                                                               |
| 2    | **Direct bank UPI**                                                    | 0% MDR by law, with no PA fee                        | more integration work, a plainer checkout, bank-style reconciliation files, a weaker sandbox; refund APIs to confirm |
| 3    | **Zoho Payments at 0.5%**                                              | the lowest permanent published rate; payouts from ₹3 | no split (not needed under B); SPA and API support unverified                                                        |
| 4    | A **promotion** (Cashfree ₹20 lakh; Razorpay 90 days; PhonePe unknown) | 0% for the pilot                                     | temporary; each switch costs KYC time and an overlap period ([Switching options](#switching-options))                |
| 5    | A list-price PG                                                        | available at once                                    | about 2% (₹4.70–₹5.13 a ₹200 order)                                                                                  |

## Fees

### Fee model

The mix is 99% UPI and 1% other, at an average of ₹200.

- 3,000 orders a month is ₹6 lakh GMV: ₹5.94 lakh by UPI and ₹6,000 by other methods.
- 10,000 orders a month is ₹20 lakh GMV: ₹19.8 lakh by UPI and ₹20,000 by other methods.
- Other methods are charged at about 2%, and split fees apply to a 90% vendor share (a 10% commission).
- Every figure includes 18% GST on fees, which is possibly claimable as input tax credit; the CA confirms.

| Scenario                                                                                         | 3,000 orders a month               | 10,000 orders a month           | % of GMV            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------- | ------------------- |
| Razorpay list: 2% + Route 0.1% (0.25%)                                                           | ₹14,797 (₹15,753)                  | ₹49,324 (₹52,510)               | 2.47% (2.63%)       |
| PhonePe or Paytm published 1.99% (split fee unknown)                                             | ₹14,089 + split                    | ₹46,964 + split                 | 2.35% + split       |
| PayU list 2% (split fee unknown)                                                                 | ₹14,160 + split                    | ₹47,200 + split                 | 2.36% + split       |
| Cashfree list: 1.95% + Easy Split 0.20–0.25%                                                     | ₹15,080–15,399                     | ₹50,268–51,330                  | 2.51–2.57%          |
| Cashfree promotion (0% PG fee; with Easy Split, if the promotion even applies to split accounts) | ₹1,274–1,593, for about 3.3 months | ₹4,248–5,310, for about 1 month | 0.21–0.27%          |
| Zoho Payments (0.5% UPI, 2% other, no split)                                                     | ₹3,646                             | ₹12,154                         | 0.61%               |
| **Target, model A** (0% UPI, 2% other, split 0.1%)                                               | **₹779**                           | **₹2,596**                      | **0.13%**           |
| **Target, model B** (0% UPI, 2% other, no split)                                                 | **₹142 + payouts**                 | **₹472 + payouts**              | **0.02% + payouts** |

- **At list price every option costs 2.35–2.6% of GMV.** A contracted 0% UPI rate brings that down to about 0.1%.
  **Negotiating the UPI rate is the whole game.**
- Each 0.1% of UPI fee costs about ₹700 a month at 3,000 orders, or ₹2,340 at 10,000, including GST.

### How long a promotion lasts

Months until the cap is used up, at a ₹200 average order, before any end date:

| Orders a month | GMV a month | Cashfree (₹20 lakh cumulative) | Razorpay (₹5 lakh or 90 days) |
| -------------- | ----------- | ------------------------------ | ----------------------------- |
| 500            | ₹1 lakh     | 20 months                      | 3 months (the 90-day limit)   |
| 1,000          | ₹2 lakh     | 10 months                      | 2.5 months                    |
| 2,000          | ₹4 lakh     | 5 months                       | about 5 weeks                 |
| 3,000          | ₹6 lakh     | 3.3 months                     | about 25 days                 |
| 10,000         | ₹20 lakh    | 1 month                        | about 1 week                  |

- **Cashfree's end date may bind before its cap does.** It is 31 March or 31 May 2027 (the sources conflict). From an
  October 2026 start, that allows at most about 6–8 months. A 6-month pilot fits up to about 1,650 orders a month, and
  12 months needs an extension, or under about 830 orders a month together with a later end date.
- **Cashfree's T&C exclude Easy Split from the offer.** Under model A the promotion may not apply at all, so a
  promotion pilot most likely runs on model B.
- **PhonePe's cap and duration are not public.** Ask.

### Payout costs (model B)

| Channel                                  | Per transfer (+ GST)                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Cashfree Payouts [C1]                    | up to ₹1,000: NEFT ₹3, IMPS/UPI ₹6; ₹1,000–25,000: ₹5 / ₹8; above ₹25,000: ₹8 / ₹15 (RTGS ₹4 / ₹6 / ₹10)                                       |
| RazorpayX [Z17]                          | plans at ₹1,499–₹9,799 a month plus per-payout charges; an older PDF shows 250 free payouts a month, then from ₹1.5. They conflict, so confirm |
| Zoho Payments [Zo1]                      | ₹3 per NEFT/RTGS/IMPS; IMPS ₹3–10 by amount                                                                                                    |
| Paytm Payouts [T16]                      | exists (IMPS, NEFT, RTGS, UPI); pricing not public                                                                                             |
| The platform's own current account [R19] | NEFT capped at ₹2.50 + GST up to ₹10,000, and ₹5 up to ₹1 lakh; IMPS set by the bank; bulk needs corporate or API banking                      |

Monthly add-on for 10 restaurants (at 3,000 orders) or 20 restaurants (at 10,000):

| Schedule                                | 3,000 orders a month | 10,000 orders a month |
| --------------------------------------- | -------------------- | --------------------- |
| Daily batch through Cashfree Payouts    | ₹1,770–2,832         | ₹3,540–5,664          |
| Weekly batch through Cashfree Payouts   | ₹254–406             | ₹507–812              |
| Daily NEFT from our own current account | up to ₹885           | up to ₹1,770          |

### What a refund costs

- **Through the PA's refund API.** Razorpay's normal refunds are free, but the original fee is kept, which costs
  nothing when UPI is at 0%. Instant refunds cost ₹7.99–₹14.99 [Z1], [Z9]. Paytm charges nothing [T13]. PhonePe,
  Cashfree and PayU do not publish a refund fee (ask).
- **As a separate payout** (model C): about ₹6 + GST each. At 3% of orders that is ₹637 a month at 3,000 orders, or
  ₹2,124 at 10,000, plus the dispute risk ([Refunds, not payouts](#refunds-not-payouts)).

## Money models A and B

The product owner asked whether the platform can simply collect every payment, send the money back when an order
fails, and otherwise pay the restaurant after pickup. That flow is right. What decides the design is **who the seller
is**, because that decides where the money may sit.

### Requirements of each model

| Requirement           | A. Marketplace + PA deferred split                                                                       | B. Merchant of record + scheduled payouts                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal structure       | the restaurant sells; the platform is an e-commerce marketplace taking a commission                      | the platform sells the food; restaurants are suppliers under contract. This has to be true in substance, or it risks being treated as direct aggregation |
| PA product            | a PA with split and hold (a marketplace or vendor feature, activated by the PA)                          | any PG merchant account, or a bank's UPI merchant API                                                                                                    |
| Eligibility           | split products may need **₹40 lakh turnover** (Route does; others to confirm)                            | none beyond the platform's own KYC                                                                                                                       |
| Restaurant onboarding | KYC at the PA as a vendor or sub-merchant (PAN, bank account, penny drop); simplified KYC up to ₹40 lakh | a supplier contract, plus bank details verified by penny drop                                                                                            |
| Where the money sits  | the PA's escrow, until the vendor share is released                                                      | the platform's account, after settlement (T+1/T+2)                                                                                                       |
| Paying restaurants    | the PA settles the vendor after release (T+1), for a split fee                                           | the platform sends transfers, weekly or daily, for per-transfer fees                                                                                     |
| Refunds               | PA refund API. After release, the PA recovers the vendor share from the next settlement                  | PA refund API; the vendor effect is netted into the next payout                                                                                          |
| GST                   | s.9(5): the platform (as e-commerce operator) pays 5% on restaurant services                             | the platform charges GST as the seller; restaurants invoice the platform; possible cascade (5% without input credit)                                     |
| TDS                   | 194-O: 0.1% of the restaurants' gross sales, netted out of the splits                                    | 194-O likely does not apply; other TDS may                                                                                                               |
| FSSAI                 | a Central Licence for the e-commerce food business                                                       | a Central Licence, plus the seller's food-safety liability                                                                                               |
| Consumer liability    | the marketplace duties under the E-Commerce Rules                                                        | the seller's full liability                                                                                                                              |
| Engineering           | a `VendorSplits` adapter, vendor onboarding flows, a hold watchdog                                       | a `PayoutSender` adapter, payout runs and statements                                                                                                     |
| Switching provider    | **heavy**: every restaurant is onboarded again as a vendor, and holds must drain                         | **light**: a new merchant account, with no vendor KYC                                                                                                    |

### Trade-offs

|                                                      | **A. Marketplace + PA deferred split**                                                                      | **B. Merchant of record + scheduled payouts**                                                                                     | **C. Marketplace collecting into its own account** (the proposal read literally)                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Money flow                                           | customer → PA escrow → vendor share released on pickup or no-show; refunds go back to source through the PA | customer → PA → platform (T+1/T+2); refunds through the PA; restaurants paid as suppliers                                         | customer → PA → platform; "refunds" sent as payouts to the customer's VPA; restaurants paid by transfer |
| Feasibility                                          | high, with documented APIs at Cashfree, Paytm, PayU and Razorpay; turnover gates are likely                 | high, with any plain PG                                                                                                           | easy to build, but the refund path is fragile                                                           |
| RBI                                                  | the cleanest shape for a marketplace                                                                        | clean, **if the platform really is the seller**                                                                                   | a grey area that is possibly direct aggregation; get a legal opinion                                    |
| Refunds                                              | to source through the PA (§10.f)                                                                            | the same                                                                                                                          | payouts are not refunds of the original payment                                                         |
| Disputes                                             | linked, so a UPI complaint closes                                                                           | the same                                                                                                                          | unlinked: a complaint can still become a chargeback, which is **a double refund**                       |
| Speed of a return                                    | immediate, from the unsettled PA balance                                                                    | the same                                                                                                                          | only after settlement (T+1/T+2), unless the platform keeps a float                                      |
| Monthly cost at target rates (3,000 / 10,000 orders) | ₹0.8k / ₹2.6k                                                                                               | ₹0.4–3.0k / ₹1.0–6.1k, depending on the payout schedule                                                                           | B's cost, plus ₹0.6k / ₹2.1k in refund payouts, plus working capital                                    |
| Monthly cost at list prices                          | ₹14.8–15.8k / ₹49–53k                                                                                       | ₹14.3–17.0k / ₹47.5–52.9k                                                                                                         | higher than B                                                                                           |
| Verdict                                              | **the long-term model**                                                                                     | **the pilot model**, if the CA and the lawyer agree; it is also the only way to use Cashfree's promotion (Easy Split is excluded) | **not as stated**: keep "pay after pickup" and drop "refund by payout"                                  |

## Refunds, not payouts

|                      | PA refund API (to source)                                                                                                                              | A separate payout to the customer's VPA                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fee                  | free or unpublished (Razorpay normal refunds free; Paytm free); the original fee is kept at list prices; an instant refund is ₹7.99–₹14.99 at Razorpay | ₹3–8 + GST each                                                                                                                                                 |
| Speed                | a normal UPI refund takes 2–7 business days; an instant refund arrives in minutes and is still recorded against the original payment [Z14]             | arrives quickly by IMPS or UPI, **but only once the payout account holds settled money** (T+1/T+2)                                                              |
| Needs settled money? | no: it is paid from the unsettled PA balance [Z9], [Z16]                                                                                               | yes                                                                                                                                                             |
| Disputes             | linked to the original UPI transaction (UDIR `ReqComplaint-Refund`) [R15]                                                                              | **unlinked**: a "not received" complaint still becomes a chargeback after T+3 if not answered [R15], [R16]                                                      |
| Rules                | refunds go to the original method (§10.f) [R5]; the E-Commerce Rules follow RBI [R18]                                                                  | at odds with both (our reading)                                                                                                                                 |
| Customer details     | none needed                                                                                                                                            | the payer's VPA (exposed by Razorpay and PhonePe; unconfirmed at Cashfree and Paytm). Reusing it may conflict with PA terms or DPDP purpose limits (unverified) |

**Rule:** money goes back only as a refund through the PA, to the original payment. Where speed matters, use the PA's
instant refund.

## Pilot strategy and fallback ladder

**Pilot strategy** (the product owner's direction): run the pilot on a temporary 0% for 6–12 months, then pivot.

1. **Pick the promotion by its coverage at the forecast pilot volume** ([How long a promotion lasts](#how-long-a-promotion-lasts)).
   Before signing, ask for the cap and the end date to be extended to the pilot's length.
2. **Run the pilot on model B** if the CA and the lawyer agree. Cashfree's promotion excludes Easy Split, and model B
   makes switching providers cheap.
3. **Build for the switch from day one** ([Switching options](#switching-options);
   [ROADMAP P5.12](ROADMAP.md#p512-switching-providers-after-the-promotion)).
4. **Negotiate 60 days before the promotion ends,** with the pilot's real volume and success rates.

**If a true 0% cannot be had**, take the first rung that works.

**Model B** (merchant of record):

| Rung | Setup                                                                                    | UPI cost                                          | Trade-offs                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| B1   | a PA with 0% UPI in writing; refunds by API; restaurants paid by weekly or daily payouts | 0%                                                | the best checkout and APIs; a payout fee per transfer                                                                       |
| B2   | **direct bank UPI** for UPI, plus a PA only for the 1% of card payers                    | 0% MDR by law up to ₹2,000, plus any bank API fee | the only rung that does not depend on a PA's goodwill; more integration work, a plainer checkout, bank-style reconciliation |
| B3   | **Zoho Payments at 0.5%**                                                                | 0.5% (about ₹3.6k a month at 3,000 orders)        | the lowest permanent published rate; verify that its API suits the SPA                                                      |
| B4   | a promotion as a bridge (Cashfree, then possibly another provider's new-merchant offer)  | 0% for its duration                               | temporary; each switch costs KYC time and a refund overlap                                                                  |

**Model A** (marketplace):

| Rung | Setup                                                                                                                                                                             | UPI cost                             | Trade-offs                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| A1   | Cashfree with Easy Split and 0% UPI in writing, or Paytm with 0% in writing                                                                                                       | 0% plus a 0.1–0.25% split fee        | Paytm's lapsed hold settles to the platform, so it needs the watchdog |
| A2   | the lowest written UPI rate among providers with a documented hold that lapses safely: Cashfree, then PayU, then Paytm, then Razorpay (the ₹40 lakh gate)                         | the quoted rate (list price 1.95–2%) | cost is linear in the rate                                            |
| A3   | if fees stay near 2%: move to model B (B1–B3) once the CA agrees, or add a small flat per-order platform fee (a product decision; the MDR itself may not be charged to customers) | –                                    | changes the business model or the price                               |

**The next best overall**, when no PA will give 0%:

- **Under model B:** B2, direct bank UPI, which keeps UPI at the legal 0%. If its integration is not worth it at
  pilot scale, B3, Zoho at 0.5%, is next.
- **Under model A:** A2 with Cashfree, because its hold lapses safely to the vendor.

## Switching options

The design keeps every switch a configuration change plus operations, never a rewrite. The pieces that make this
possible are in [ROADMAP P5.1](ROADMAP.md#p51-payment-gateway-port-and-adapter),
[P5.6](ROADMAP.md#p56-ledger-and-escrow) and [P5.12](ROADMAP.md#p512-switching-providers-after-the-promotion):

- **One gateway port** (`PaymentGateway`), with an adapter per provider.
- **Every payment records its provider.** Refunds, status checks and reconciliation always use that payment's
  provider, never the current default.
- **`active_payment_provider`** (a site setting) chooses the provider for new checkouts, with a per-store override.
- **One payout port** (`PayoutStrategy`) with model A and model B implementations over the same ledger.

| Switch                                                     | Steps                                                                                                                                                                                                                                                                                              | Effort                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Provider → provider, model B**                           | 1. Open a merchant account and complete KYC. 2. Deploy the adapter and webhook route dark, and test on staging. 3. Move one store with the per-store override, then the rest. 4. Keep the old account active until its refund window closes, then close it                                         | about 2–4 weeks, mostly KYC; no restaurant involvement              |
| **Provider → provider, model A**                           | as above, plus onboarding **every restaurant again** as a vendor at the new PA, activating split, and draining every hold at the old PA (release or refund) before closing it                                                                                                                      | about 4–8 weeks; every restaurant does KYC again                    |
| **B → A** (for example, once the ₹40 lakh gate is cleared) | 1. Legal and tax: restaurants become the sellers, so contracts, invoicing and customer terms change. 2. Onboard restaurants as vendors and activate split. 3. Move stores one at a time: new orders use `SplitHoldPayouts`, and old orders finish their payouts under B. 4. Retire the payout runs | about 4–8 weeks; a CA and a lawyer are involved                     |
| **A → B** (if split is withdrawn, or too costly)           | 1. Legal and tax: the platform becomes the seller. 2. Collect restaurants' bank details (penny drop). 3. New orders settle to the platform, while existing holds release under A. 4. Start the payout runs                                                                                         | about 3–6 weeks; a CA and a lawyer are involved                     |
| **Promotion stacking** (model B)                           | at the end of one provider's promotion, switch to another provider's new-merchant offer (if its T&C allow a business that used another PA) using the model B provider switch above                                                                                                                 | repeatable every few months; each hop costs KYC time and an overlap |

**Triggers to watch:**

- the promotion reaching 80% of its cap;
- 60 days before the promotion's end date;
- payment success dropping below the alarm threshold ([ROADMAP P8.7](ROADMAP.md#p87-observability));
- a rate revision notice from the provider;
- the platform clearing a turnover gate (for B → A).

**What never changes when switching:** the order model, the ledger, carts, order history, the customer's refund path
(back to source, through the provider that took the payment), and the checkout flow's shape. Only the payment screen
the customer sees differs.

## Open questions

- **Every PA:**
  - a written UPI rate for P2M payments up to ₹2,000: its duration, slabs and revision clause;
  - UPI refund fees, normal and instant;
  - the split fee and its basis (the vendor share or the full amount);
  - the ₹40 lakh gate, and whether onboarding restaurants as sub-merchants avoids it;
  - the hold: its maximum length, its granularity, and what happens on expiry;
  - whether the API exposes the payer's VPA;
  - payout pricing;
  - UPI intent on mobile web (Android and iOS), and success rates by UPI app.
- **Cashfree:**
  - is the ₹20 lakh cumulative or monthly;
  - is the end date 31 March or 31 May 2027;
  - does the Easy Split exclusion remove the promotion entirely for split accounts, or only the split fee;
  - the post-promotion rate;
  - an extension to 6–12 months.
- **Paytm:**
  - online 0% UPI in writing, as on its card-machine rate card;
  - the maximum `POST_TXN` timeout;
  - a vendor onboarding API;
  - when error 678 applies.
- **PhonePe:**
  - the split-and-hold API and its sandbox;
  - the promotion's T&C, cap and duration.
- **Zoho Payments:** API support for a custom SPA (server-created orders, UPI intent, webhooks, refunds).
- **Banks (model B):** UPI merchant API fees, the refund API, callbacks and reconciliation files (for example, HDFC
  SmartGateway).
- **Lawyer:**
  - is model C direct payment aggregation?
  - would our merchant-of-record structure hold up under model B?
- **CA:**
  - s.9(5) vs being the seller;
  - 194-O on split flows;
  - GST cascading under model B;
  - invoicing to customers and to restaurants.
- **FSSAI:** which licence the platform needs under each model.

## Sources

All accessed on 28 September 2026. "(s)" means the page was seen only as a search result; "(p)" means paywalled.

**Regulation**

- R1 DFS, FAQs on MDR for select UPI P2M transactions (15 Sep 2026):
  <https://financialservices.gov.in/sites/default/files/2026-09/FAQs---Merchant-Discount-Rate--MDR--on-Select-UPI--P2M--Transactions_0.pdf>
- R2 <https://www.scconline.com/blog/post/2026/09/16/npci-released-upi-mdr-faqs-explained/>
- R4 <https://www.businesstoday.in/latest/economy/story/upi-mdr-gst-npci-says-small-merchants-and-96-of-transactions-remain-unaffected-from-october-15-557039-2026-09-22>
- R5 RBI Master Directions on Payment Aggregators (15 Sep 2025): <https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12896>
- R7 <https://www.cashfree.com/docs/payments/manage/payment-methods/upi-collect>
- R8 (s) <https://www.businessworld.in/article/npci-to-end-upi-collect-request-for-p2p-payments-in-oct-567598>
- R9 (p) <https://theheadandtale.com/explainer/npci-asks-banks-payments-firms-to-discontinue-upi-collect-for-p2m-transactions/>
- R10 (s) <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2112771>
- R11 <https://inc42.com/buzz/budget-2026-centre-allocates-inr-2k-cr-incentives-for-rupay-upi-transactions/>
- R13 <https://www.mondaq.com/india/financial-services/1057334/clarification-on-the-guidelines-on-regulation-of-payment-aggregators-and-payment-gateways>
- R14 (s) <https://psalegal.com/issue-xvii-rbi-guidelines-regulating-payment-aggregators/>
- R15 <https://juspay.io/in/docs/upi-consumer-stack/docs/complaints-udir/p2m-complaint-resolve>
- R16 <https://razorpay.com/blog/all-you-need-to-know-about-npci-led-udir/>
- R17 (s) <https://www.business-standard.com/finance/personal-finance/new-upi-rule-on-automatic-acceptance-rejection-of-chargebacks-from-feb-15-125021200820_1.html>
- R18 (s) <https://consumeraffairs.nic.in/theconsumerprotection/consumer-protection-e-commerce-rules-2020>
- R19 (s) <https://www.business-standard.com/article/current-affairs/rbi-tells-banks-not-to-charge-transaction-fees-for-neft-from-jan-2020-119110801945_1.html>

**Tax and FSSAI**

- X1 (s) <https://cleartax.in/s/gst-on-service-supplied-restaurants-ecommerce-operators>
- X2 (s) <https://cleartax.in/s/section-194o>
- X3 (s) <https://cleartax.in/s/e-commerce-fssai-food-license-registration>

**Cashfree**

- C1 <https://www.cashfree.com/payment-gateway-charges/>
- C2 <https://www.cashfree.com/docs/help/easy-split/faqs/faqs>
- C3 <https://www.cashfree.com/docs/payments/online/web/redirect>
- C4 <https://www.cashfree.com/docs/payments/online/webhooks/signature-verification>
- C5 <https://www.cashfree.com/blog/payment-gateway-charges-india-free-payment-gateway/>

**Paytm**

- T1 <https://www.paytmpayments.com/pricing>
- T3 <https://business.paytm.com/pricing>
- T4 <https://www.paytmpayments.com/docs/split-settlement/>
- T5 <https://www.paytmpayments.com/docs/api/post-facto-split-settlement-api/>
- T6 <https://www.paytmpayments.com/docs/api/refund-api>
- T7 (s) <https://www.paytmpayments.com/docs/jscheckout-verify-payment>
- T13 (s) <https://business.paytm.com/support/will-i-be-charged-to-refund-a-payment>
- T15 (s) <https://www.bwdisrupt.com/article/paytm-all-in-one-payment-gateway-offers-zero-fees-on-upi-payments-to-merchants-366713>
- T16 (s) <https://business.paytm.com/docs/paytm-payouts/introduction-internal>

**PhonePe**

- P1 <https://www.phonepe.com/business-solutions/payment-gateway/pricing/>
- P2 <https://business.phonepe.com/payment-gateway>
- P3 <https://business.phonepe.com/upi-payment-gateway>
- P4 <https://business.phonepe.com/split-settlements>
- P5 <https://business.phonepe.com/marketplace-payment-gateway>
- P7 <https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-integration-website>
- P8 <https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook>
- P9 <https://developer.phonepe.com/docs/settlements>
- P10 <https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/introduction>
- P11 (s) <https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/invoke-iframe-paypage>
- P13 <https://business.phonepe.com/articles/what-are-payment-gateway-charges>

**Razorpay**

- Z1 <https://razorpay.com/pricing/>
- Z2 <https://razorpay.com/blog/razorpay-0-percent-platform-fee-offer-90-days-new-merchants-2026/>
- Z5 <https://razorpay.com/docs/payments/route/>
- Z6 <https://razorpay.com/docs/api/payments/route/modify-settlement-hold/>
- Z7 (s) <https://razorpay.com/docs/api/payments/route/refund-payments-and-reverse-transfer/>
- Z8 <https://razorpay.com/docs/webhooks/validate-test/>
- Z9 <https://razorpay.com/docs/payments/refunds/faqs/>
- Z10 (s) <https://razorpay.com/docs/payments/payment-gateway/web-integration/custom/payment-methods/upi-intent-mweb/>
- Z14 <https://razorpay.com/blog/why-do-refunds-take-time/>
- Z16 (s) <https://razorpay.com/docs/payments/dashboard/account-settings/balances/>
- Z17 <https://razorpay.com/x/pricing/>

**Zoho Payments**

- Zo1 <https://www.zoho.com/in/payments/pricing>
- Zo2 <https://www.zoho.com/in/payments/faq/general/transaction-fee>

**Google Pay**

- G1 <https://developers.google.com/pay/india/api/web/intro>
- G5 <https://support.google.com/pay/business/answer/9054423?hl=en>

**Other providers**

- O1 <http://payu.in/pricing/>
- O2 <https://docs.payu.in/reference/release_settlement_api>
- O3 <https://docs.payu.in/docs/aggregator-or-marketplace-settlement-solution>
- O7 <https://easebuzz.in/pricing/>
- O10 <https://smartgateway.hdfcbank.com/docs/smartgateway-tranportal-integration/docs/tranportal-integration/upi-intent>
- O12 <https://dashboard.ccavenue.com/web/genregistration.do?command=navigateSchemeForm>
