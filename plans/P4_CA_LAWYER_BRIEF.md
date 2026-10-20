# Food Pickup — brief for the chartered accountant and the lawyer

Prepared 20 October 2026 by ⟨name, role⟩, ⟨legal entity⟩, ⟨phone / email⟩.

This document stands on its own. It describes what we do, how we want money to move, the two structures we are
choosing between, what we found in public sources (our reading, not advice), and the questions we need answered. We
would like a short written note back that we can keep on file and cite in our decision record.

## 1. What we do

- A **mobile-web app** (a website that works like an app on a phone; no app-store app) where students and staff on a
  campus **order food from partner cafés and collect it at the counter**. No delivery.
- Today the app is live with one café; **payment is simulated**, so no money moves online yet. Customers order on the
  phone and settle at the counter. Online prepayment is the next step and the reason for this brief.
- Scale: a pilot of **6–12 months** at roughly **500–3,000 orders a month**, growing to about 10,000; **1 to 20
  cafés**. The average order is about **₹200**; about **99% of payments will be UPI** and 99% under ₹2,000.
- Entity: ⟨private limited / LLP / proprietorship⟩, registered at ⟨address⟩; GSTIN ⟨number or "to be obtained"⟩;
  FSSAI ⟨number or "none yet"⟩.

## 2. How we want money to move

1. The customer **prepays** the full order amount online (UPI, occasionally a card).
2. The café prepares the order; the customer collects it.
3. **The café's share is paid after pickup** (or after the pickup window closes if the customer never comes). The
   platform keeps a **commission** (about 10%).
4. If the **café is at fault** (it rejects the order, runs out of an item, or is late beyond a buffer), the customer
   gets a **full refund to the original payment method**, through the payment aggregator's refund API, never as a
   separate bank transfer.
5. Cards and netbanking stay available for the rare non-UPI payer.

The payment is taken by an **RBI-authorised payment aggregator** (PA) such as Cashfree, Paytm Payments, PhonePe or
Razorpay. We will not hold card data.

## 3. The two structures we are choosing between

|                      | **A. Marketplace**                                                                                   | **B. Merchant of record**                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Who sells            | the **café** sells to the customer; we are an e-commerce operator taking a commission                | **we** sell the food; cafés are our suppliers under contract                                                                            |
| Where the money sits | in the **PA's escrow** until we release the café's share (the PA's "split" or "deferred settlement") | in **our bank account** after the PA settles (T+1 / T+2)                                                                                |
| Paying the café      | the PA settles the café directly after our release, for a split fee (about 0.1–0.25%)                | we send transfers (daily or weekly) from our account                                                                                    |
| Café onboarding      | each café completes KYC at the PA as a "vendor" (PAN, bank account)                                  | a supplier contract plus verified bank details                                                                                          |
| Refunds              | through the PA, to the original payment method                                                       | the same                                                                                                                                |
| GST (our reading)    | s.9(5): we, as e-commerce operator, pay the 5% GST on restaurant services supplied through us        | we charge GST as the seller; cafés invoice us; possible cascading (5% restaurant rate without input credit)                             |
| TDS (our reading)    | s.194-O: 0.1% on the cafés' gross sales through us                                                   | 194-O probably does not apply; other TDS may                                                                                            |
| Consumer liability   | marketplace duties under the E-Commerce Rules 2020                                                   | the seller's full liability                                                                                                             |
| FSSAI (our reading)  | a Central Licence for an e-commerce food business                                                    | the same, plus the seller's food-safety liability                                                                                       |
| Switching PA later   | heavy: every café does KYC again at the new PA                                                       | light: a new merchant account only                                                                                                      |
| Commercial note      | the long-term model; split products are often gated by turnover (Razorpay needs ₹40 lakh)            | the pilot model: it works with any PA, and it is the only way to use Cashfree's 0% new-merchant offer, which excludes its split product |

**A third reading we intend to reject, "C":** act as a marketplace but collect every payment into our own account and
send money back to customers by a separate transfer when an order fails. Two concerns: it may amount to "direct
payment aggregation" under the RBI directions, and a transfer is not linked to the original UPI transaction, so a
customer complaint can still become a chargeback and we refund twice.

**Our working assumption:** run the pilot on **B**, if you agree it holds up, and move to **A** once the business is
eligible for the PA's split products.

## 4. What we found in public sources (our reading, please correct)

- **MDR on UPI.** Merchant UPI payments up to ₹2,000 carry zero MDR. From 15 October 2026 payments above ₹2,000
  carry 0.4% MDR. MDR may not be passed on to customers. (DFS FAQs, September 2026.)
- **PA platform fees are separate from MDR.** Every standard PA plan charges about 2% on UPI as its own fee.
  New-merchant promotions give 0% for a limited volume or time (Cashfree: first ₹20 lakh, with its split product
  excluded; Razorpay: 90 days or ₹5 lakh). We will negotiate a written rate.
- **RBI Master Directions on Payment Aggregators (15 September 2025).** A PA aggregates funds only for merchants it
  has a contract with; a marketplace onboarded by a PA must not take payments for sellers the PA has not onboarded;
  refunds go to the original payment method; the escrow may pay third parties on a merchant's instruction only for
  merchants with turnover above ₹40 lakh; merchants up to ₹40 lakh get simplified KYC.
- **Marketplaces.** A 2021 RBI clarification treats a marketplace that _uses_ a PA as a merchant, and one
  "undertaking direct payment aggregation" as a PA. Whether "the PA settles to the marketplace and the marketplace
  pays its sellers" is direct aggregation is not defined.
- **Disputes.** UPI complaints go through NPCI's UDIR; an unanswered "not received" complaint on a merchant payment
  becomes a chargeback after about T+3. A refund through the PA is linked to the original transaction; a separate
  transfer is not.
- **Tax.** GST s.9(5): since 1 January 2022 the e-commerce operator pays the 5% GST on restaurant services supplied
  through it, and GST TCS does not apply to those supplies. Income-tax s.194-O: 0.1% TDS on e-commerce
  participants' gross sales. As merchant of record, the platform is the supplier; the 5% restaurant rate carries no
  input credit, so tax may cascade.
- **FSSAI.** E-commerce food businesses appear to need a Central Licence regardless of turnover (secondary source).
- **Consumer Protection (E-Commerce) Rules 2020.** Refunds are to be made as prescribed by the RBI.
- **Data protection.** The DPDP Act applies: we hold names, phone numbers, emails and order history, and want to
  send SMS and push notifications with consent.

Sources: DFS "FAQs on MDR for select UPI P2M transactions" (financialservices.gov.in, Sep 2026); RBI Master Directions
on Payment Aggregators, 15 Sep 2025 (rbi.org.in, id 12896); RBI clarification on PA/PG guidelines, 2021; NPCI UDIR
documentation; Consumer Protection (E-Commerce) Rules 2020; ClearTax notes on GST s.9(5), s.194-O and FSSAI
e-commerce licensing.

## 5. Monthly cost at stake (why the structure matters commercially)

Fees including 18% GST, 99% UPI, ₹200 average order:

| Case                                        | 3,000 orders a month | 10,000 orders a month |
| ------------------------------------------- | -------------------- | --------------------- |
| PA list prices (about 2% UPI + split fee)   | ₹14–16k              | ₹47–53k               |
| 0% UPI in writing, model A (0.1% split fee) | about ₹780           | about ₹2,600          |
| 0% UPI in writing, model B                  | about ₹140 + payouts | about ₹470 + payouts  |
| Payout transfers under B (weekly batches)   | ₹250–400             | ₹500–800              |

## 6. Questions for the chartered accountant

1. **GST under A.** Confirm s.9(5) applies: we pay 5% GST on restaurant services supplied through the platform. Does
   GST TCS (s.52) apply to anything we collect? How is our commission to the café invoiced and taxed (18%)?
2. **GST under B.** We sell the food: at what rate, and can we claim input credit on the cafés' invoices to us? Does
   the 5% restaurant rate without input credit cascade, and what is the net effect on a ₹200 order compared with A?
3. **TDS.** s.194-O (0.1% on the cafés' gross sales) under A: confirm, and the mechanics when money sits in the PA's
   escrow and the café is paid by the PA. Under B, what TDS applies to our payments to cafés as suppliers, if any?
4. **Invoicing.** Who invoices the customer under A and under B; what the café invoices us or we invoice the café;
   whether the PA's settlement statements suffice as records.
5. **Input credit on PA fees.** Is the 18% GST on the aggregator's fees claimable in each model?
6. **Holds and refunds.** Under A, money held in the PA's escrow for a café: is it our turnover? Under B, the
   accounting for the café's share pending payout, and for refunds issued after we were settled.
7. **Turnover thresholds.** Which thresholds matter for us (GST registration, the ₹40 lakh PA simplified-KYC line,
   audit) in each model, given that under B the full order value is our revenue and under A only the commission.
8. **Your recommendation** for the pilot, A or B, and what would change it.

## 7. Questions for the lawyer

1. **Is B a lawful merchant-of-record structure** under the RBI PA Directions, and what must be true in substance
   (contracts with cafés, invoicing, consumer-facing terms, liability) for it to hold?
2. **Would C** (collect as a marketplace, pay cafés and send customer "refunds" ourselves) **amount to direct payment
   aggregation** requiring authorisation? Does B in name only carry the same risk?
3. **Consumer Protection (E-Commerce) Rules 2020:** our obligations as a marketplace (A) versus a seller (B):
   disclosures, grievance officer, refund timelines, and what must appear on the website.
4. **DPDP Act:** the minimum content of our privacy notice; consent wording for SMS and push; whether we must name a
   grievance officer and the response time for data-principal requests; retention of order records after a customer
   deletes their account.
5. **FSSAI:** which licence the platform needs under A and under B, and whether each café's licence number must be
   displayed.
6. **Contracts:** what the café agreement must contain under each model (supplier vs marketplace seller), and what
   the customer Terms must say.
7. **One sentence, in your words, for our Terms:** who the customer buys from under the structure you recommend.

## 8. What we need back

- A short written note (one or two pages) answering sections 6 and 7, dated, that we can keep on file.
- Your answer to **A or B for the pilot**.
- The seller sentence (7.7) for the Terms, Privacy, Refund and Contact pages we must publish before the PA's KYC.
