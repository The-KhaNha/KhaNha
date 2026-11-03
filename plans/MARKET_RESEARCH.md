# KhaNha: market research

Is KhaNha (called food-pickup in the code) solving a problem people will pay for? This is an honest answer in plain words, so you can decide what to do before spending more months building. Prepared 1 October 2026; updated for your decisions of 7 October 2026.

## The answer in short

- **The problem is real but small.** Break-time queues at campus counters are annoying, but nobody in India has ever measured them, and students complain more about food quality and price (§2).
- **Pre-ordering works only where it is the default way to order.** It thrives in company and college cafeterias that make every counter use it. As an option inside Zomato and Swiggy, pickup stayed at 0.5–2.5% of orders even when free (§2).
- **A 10% commission will not work.** Pickup is already free or 1–3% elsewhere, and a canteen's whole profit is 5–12% of sales. Outlets will pay about ₹1,000–3,000 a month or ₹2–5 an order; colleges may pay a yearly campus fee (§4, §7).
- **The market is a niche:** about ₹35–50 crore a year across India at prices outlets accept, and a realistic ₹0.2–1.2 crore a year for a small team in Bengaluru (§6).
- **The realistic good outcome is a small, profitable business** built campus by campus. Everyone who tried this abroad ended up as restaurant software or a vendor to institutions (§5, §9).
- **The code is good; the order of work is wrong.** Run one outlet for four weeks and ask for money before building the roadmap's platform (§11, §14).
- **Two questions need written answers before real money moves:** does KhaNha owe 5% GST on every order, and can a new company use a payment provider's "hold the money until pickup" product (§8).

## How this was researched

Two separate research passes using public sources from 2025–2026, India first and Bengaluru especially. The second pass never saw the first and was asked only "why might this fail?". They agreed on every point above, which is the strongest evidence here. A number with a link is a fact; a number with the sum shown is an estimate; "assumption" marks a guess the pilot must replace.

No field work was done: nobody timed a queue or spoke to an owner. That is what the 30-day plan (§14) is for.

The full version (both passes in detail, about 250 sources) is in git: `git show 3fbe3ea:plans/MARKET_RESEARCH.md`.

## Your decisions (7 October 2026)

| Decision                           | What it means                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Web app first                   | Students scan a QR code or open a link and order; nothing to download. A Play Store or App Store app comes later, only if the pilot shows a need (for example "ready" alerts not reaching iPhones, about 6% of Indian phones). |
| 2. Never a rupee more for students | The KhaNha price is the counter price: no platform, convenience, packaging or queue-skip fee. Every rupee KhaNha earns comes from the outlet or the college.                                                                   |
| 3. Only places with daily regulars | College canteens and counters, and owner-run cafés, tea stalls, bakeries, juice and snack shops near colleges that the same students visit almost every day. Not offices, malls, families, cloud kitchens or restaurants.      |

All three match the evidence: decision 1 removes the install barrier (§3), decision 2 removes the biggest reason students would not switch (§3), and decision 3 targets the only setting where pre-ordering has stuck (§2). The rest of this report follows them.

## Words used

| Word                           | Meaning                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Lakh, crore                    | 1 lakh = 1,00,000. 1 crore = 100 lakh (10 million).                                                                  |
| Outlet                         | Any food counter: canteen, café, tea stall, bakery.                                                                  |
| Pre-order, order ahead, pickup | Order on the phone, collect at the counter. No delivery.                                                             |
| Aggregator                     | An app listing many restaurants: Zomato, Swiggy.                                                                     |
| Captive site                   | A place where the same people eat every day with few other options: a college, a company campus.                     |
| Institution                    | The college or company that owns the site and decides who runs its canteen.                                          |
| Commission                     | The share of each order the platform keeps. 10% of ₹200 is ₹20.                                                      |
| Gross profit                   | Revenue minus the direct cost of each order (payment fees, messages, hosting, support).                              |
| Payment gateway                | A licensed company (Razorpay, Cashfree) that collects online payments for a fee.                                     |
| Split settlement               | The gateway holds the money and pays the outlet later, for example after pickup. Also called escrow.                 |
| POS                            | The counter's billing software. Petpooja is the biggest in India.                                                    |
| Churn, retention               | The share of users or outlets who stop, or stay, each month.                                                         |
| Activation                     | A signed outlet actually starts taking orders.                                                                       |
| Concierge test, fake-door test | Doing the service by hand before building it; a poster for a feature that does not exist yet, to count who tries it. |

## 1. What KhaNha is today

A website that works like an app. A student opens it, sees a campus café's menu, adds items to a cart, "pays", gets an order number, and watches it go Placed → Preparing → Ready, then collects at the counter. Staff move orders along on a phone or tablet board; an admin page holds site settings.

It is built well for its user: fast on cheap Android phones over bad Wi-Fi, a cached menu that reopens instantly, and it never sells the last samosa twice (the database settles that race). Most student-built ordering apps fall over at the first lunch rush; this one should not.

Not built yet: real payments (pretend today), more than one café, "your order is ready" alerts, menu editing by the outlet, analytics, chosen pickup times. No outlet is live, nobody has paid, and no price is set (the roadmap's working example is a 10% commission).

The roadmap plans ten phases of platform work (multi-store, payment escrow, event queues, AWS, Kubernetes) before any café has paid for a coffee through it, and nothing in the repository records a talk with an owner, a queue count or an agreed price. §11 reorders this.

## 2. The problem: is it real?

**What KhaNha can fix.** It removes one step at the counter: ordering and paying. It does not cook faster. If a canteen's real bottleneck is the kitchen (one tawa, one coffee machine), an order sent from class still waits for the same tawa, and the queue just moves to the "Ready" screen. So the first thing to find out, with a stopwatch, is which bottleneck your target counters have. For the outlet, KhaNha also removes shouted orders and cash/UPI mix-ups at the rush, and (with prepayment) food made for people who never come.

**The evidence that the pain exists is thin.** No Indian study, survey or news report measures canteen queues; every source that says "long queues" sells a fix or proposes a student app. Real complaints point elsewhere: an [Azim Premji University survey](https://gfm.akshayakalpa.org/read/feature-article/mess-on-my-plate-indias-students-are-fixing-their-college-diets) of 800+ students is about nutrition, portions and cost, and [Bengaluru office workers](https://www.teamblind.com/post/bangalore-office-food-is-actual-scam-and-feedback-process-doesnt-exist-cl196krz) complain about food quality, not waiting.

**What people actually do is stronger evidence:**

1. **Pre-ordering works inside captive cafeterias.** [HungerBox](https://www.hungerbox.ai/) (Bengaluru) handles about 10 million orders a month across 735 Indian cafeterias, about 7.5 orders per registered user a month. [SmartQ](https://www.thesmartq.com/smartq-tech-products) (owned by Compass Group since 2021) does the same in 264 food courts, including a web app like KhaNha's. Both sell to the employer or college, and every counter on the site uses it.
2. **Pickup as an option inside a food app did not catch on.** Zomato [launched pickup](https://www.thenewsminute.com/atom/zomato-launches-option-pick-orders-restaurants-89756) in October 2018; Swiggy copied it 50 days later. In November 2020 Zomato [made takeaway free](https://www.restaurantindia.in/news/zomato-to-offer-takeaway-service-to-restaurants-at-zero-commission.n19543) for restaurants, and it still reached only "tens of thousands" of orders a week against about 3.8 million deliveries: roughly 0.5–2.5%. Neither company has mentioned pickup to investors since.
3. **Money is moving to delivery.** At Domino's India, delivery rose from 68.9% to 72.9% of sales in a year ([Jubilant deck](https://www.jubilantfoodworks.com/Uploads/Files/1221foodfile-EarningsPresentationandPR.pdf)). Zomato's food delivery grew 20% and Swiggy's 17% in the quarter to June 2026.

**So:** pre-ordering succeeds when the venue makes it the default, and fails when it is one option among many. The problem is worth solving in one setting only: a counter with daily regulars, a visible peak queue and a kitchen that can prepare ahead (tea, coffee, sandwiches, idli-vada, bakery, pre-plated meals). KhaNha's campus pilot fits that; the roadmap's "many restaurants, discovery by area" drifts away from it. §10 turns this into a checklist for picking outlets.

## 3. Students: will they use it?

**Phones, data and payments are not the obstacle.** Android is [94% of Indian phones](https://gs.statcounter.com/os-market-share/mobile/india), mobile data is among the cheapest in the world, and UPI handled [24.5 billion payments](https://entrackr.com/news/upi-hits-new-record-with-2451-bn-transactions-in-august-12478578) in August 2026, with no fee under ₹2,000. Building for cheap Android phones is the right choice, not over-engineering.

**Habit is the obstacle.** [46% of installed apps](https://www.appsflyer.com/resources/reports/app-uninstall-benchmarks-report/) are deleted within 30 days. Pre-ordering lives on a daily routine: when commuting stopped in 2020, the office pre-order app Ritual lost 70% of its traffic and [never recovered](https://www.theglobeandmail.com/business/article-ritual-cofounders-join-shopify/), despite 10,000 restaurants. A canteen visited every college day gives that routine; a café across town does not. Hostel students, who eat in the mess, have it less.

**Price is the other obstacle.** Swiggy's budget app Toing promises "zero platform fees, no packaging charges, prices that match or beat dine-in menus", is aimed at college students, and has been in Bengaluru since March 2026 ([Fortune India](https://www.fortuneindia.com/business-news/swiggys-toing-enters-delhi-ncr-bets-on-zero-fee-model-to-disrupt-food-delivery-market/130700)). An analyst estimate puts it at [about 33 million weekly users](https://www.moneycontrol.com/news/business/startup/swiggy-s-toing-user-base-now-almost-as-large-as-zomato-s-clsa-14025987.html) within a year (unverified). Students now expect app prices at or below the counter, so KhaNha can never be dearer, tax included.

**A student switches** when the first order makes the saving obvious: walk past the queue, say the token number, food already packed, same price. **A student stops** when a prepaid order is late even once (they are trapped, where a walk-up customer could just leave), a refund drags, or staff serve the walk-up line first.

**How many are needed.** Bengaluru Urban has 1,148 colleges, the most of any district in India ([AISHE 2023-24](https://www.dohe-education.gov.in/static/uploads/2026/07/8616f33dfee644ab6b87a2bd0658b18d.pdf)), and an estimated 7–11 lakh students. The roadmap's pilot of 3,000–10,000 orders a month needs only 300–1,000 students ordering about 10 times a month: 3–20% of a 5,000-student campus.

## 4. Outlets: will they pay?

### What they pay today, and why they stay

On Zomato and Swiggy a restaurant pays 18–30% commission (chains 10–22%), 18% GST on that, about 2% in payment fees, plus discounts and ads it funds. It keeps 40–55% of the bill; in the Bengaluru hotel association's example, a ₹400 dish nets about ₹220 ([The Week](https://www.theweek.in/news/biz-tech/2026/07/30/wont-take-orders-anymore-why-bengaluru-restaurants-are-threatening-to-boycott-zomato-swiggy.html)).

In July 2026 more than 1,000 Bengaluru owners [threatened to leave](https://www.business-standard.com/industry/news/bengaluru-restaurants-threaten-swiggy-zomato-boycott-what-s-the-dispute-126073000471_1.html) both apps. Every demand was about delivery (itemised deductions, no unapproved discounts, a 22% commission cap); none asked for a pickup channel. The apps [agreed terms](https://www.financialexpress.com/business/news/food-delivery-platforms-agree-terms-with-bengaluru-hotel-bodies-to-avert-boycott/4313276/) within a week. Owners stay even at 40–45% total deductions [because "that's where the customers are"](https://www.livemint.com/industry/restaurants-food-delivery-apps-margins-swiggy-zomato-bulk-orders-aggregator-platforms-11758455461794.html). **Restaurants pay for new customers, not for low fees**, and KhaNha mostly serves customers who were already in the building.

### What pickup already costs them

| Option                                                                                                                                             | What the outlet pays                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Zomato takeaway                                                                                                                                    | 0%, payment fee absorbed (2020 terms; whether it is live today is unverified) |
| [Rapido Ownly](https://www.livemint.com/companies/news/why-your-100-meal-costs-250-online-and-how-rapido-wants-to-change-that-11790418590126.html) | 0% commission; about 25,000 Bengaluru restaurants                             |
| magicpin on ONDC                                                                                                                                   | 0% promotional, 2–5% typical                                                  |
| [DotPe](https://dotpe.in/)                                                                                                                         | 1–3% per order                                                                |
| [Thrive](https://razorpay.com/app-store/thrive/)                                                                                                   | about 3% per order                                                            |
| [Petpooja](https://www.petpooja.com/pricing) POS with QR ordering and tokens                                                                       | about ₹12,000–20,000 a year                                                   |
| SlickPOS with QR ordering                                                                                                                          | ₹999 a month                                                                  |

KhaNha's planned 10% is above every one of these.

### Why 10% breaks a campus canteen

College canteens are usually run by a contractor chosen by tender, selling at prices the college fixes. A real tender ([Deshbandhu College, Delhi, 2024-25](https://www.deshbandhucollege.ac.in/uploads/pdf/1722328816_canteentender.pdf)): about 5,900 students and staff, a licence fee of ₹10,000 a month, tea ₹8, samosa ₹8, and a fine of up to ₹5,000 for changing prices.

If 30% of those 5,900 people spend ₹40 a day, the canteen sells about ₹17 lakh a month. A 10% commission on that is ₹1.7 lakh a month: roughly the contractor's entire profit at a 10% margin, and the contractor is not allowed to raise prices to cover it.

Independent outlets are similar. Typical net margins are [5–12%](https://www.restaurantindia.in/article/how-profitable-is-restaurant-business-in-india.14000); at 8%, a ₹200 order makes ₹16 of profit and a 10% commission takes ₹20. A commission only makes sense on orders the outlet would not otherwise get.

### Who decides, and who says yes first

In a college canteen the college or its canteen committee is the buyer; the contractor is only the user. Colleges also care about cash leakage (cafeteria pilferage runs 8–10% of revenue), which counter staff may resist.

Likely order of yeses:

1. **Owner-run cafés, tea and snack shops at or near a college gate**, with their own prices, daily rushes and regulars. They feel the rush, decide in an afternoon, and no institution contract covers them.
2. **Colleges** buying a "cashless, queue-free canteen" as an amenity, written into the next canteen tender.
3. **Canteen contractors on fixed prices:** only if the college pays, because they have no margin to give.
4. **Not worth chasing:** campuses already on HungerBox, SmartQ or SpaceBasic, and outlets already using Petpooja's QR ordering.

## 5. Competitors, and what happened to others

### Who is already there

| Player                     | What it does                                                                                                                                                                                                                                                                                                                                 | What it means for KhaNha                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Zomato, Swiggy             | Built pickup in 2018, then sidelined it (§2)                                                                                                                                                                                                                                                                                                 | Could copy KhaNha in weeks, but have shown no interest in the counter                                |
| Swiggy Toing               | No-fee budget app at counter prices, aimed at students (§3)                                                                                                                                                                                                                                                                                  | Sets the price students expect                                                                       |
| Rapido Ownly               | 0% commission delivery in Bengaluru, about 50,000 orders a day                                                                                                                                                                                                                                                                               | Owns the "cheaper channel" pitch to Bengaluru restaurants                                            |
| HungerBox, SmartQ, GoKhana | Run pre-ordering for company and college cafeterias, sold to the institution with management services. HungerBox took about ten years, $23–44M of funding and 831 cafeterias to reach [₹9 crore of operating profit](https://yourstory.com/2025/11/hungerbox-posts-33-rise-in-gross-transaction-value-for-fy25), earning about ₹5.9 an order | Hold the big, well-funded campuses; will not sell to one small canteen                               |
| SpaceBasic                 | Bengaluru campus software with a canteen module, priced per student per year; [₹2.2 crore revenue](https://inc42.com/company/spacebasic/) across 100+ institutions                                                                                                                                                                           | Holds PES, Reva, Manipal and NITTE; campus software is a small-ticket business                       |
| MealPe, SkipQ, Biiite      | "Skip the canteen queue" startups                                                                                                                                                                                                                                                                                                            | No visible traction after up to three years ([MealPe](https://mealpe.app/)'s own counters read zero) |
| Petpooja, DotPe, Thrive    | Counter software with QR ordering and tokens                                                                                                                                                                                                                                                                                                 | Could add prepaid pickup in one release; already reach about 1 lakh outlets                          |

### What happened to everyone who tried this

| Company                                                                                                                                                | What happened                                                                                                                                                                                                                       | Lesson                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Tapingo](https://www.sec.gov/Archives/edgar/data/1594109/000156459019005487/grub-10k_20181231.htm) (US)                                               | Exactly this idea on 150+ campuses from 2012; bought by Grubhub for about $150M in 2018; app shut in 2019                                                                                                                           | The buyer paid for campus contracts and integrations, not the app     |
| Grubhub Campus (US)                                                                                                                                    | The successor, sold to universities; [DoorDash agreed to buy it](https://ir.doordash.com/news/news-details/2026/DoorDash-and-Wonder-Announce-Strategic-Partnership/default.aspx) for $300M in September 2026, live at 450+ colleges | Campus ordering has real value, as infrastructure for institutions    |
| [Snackpass](https://research.contrary.com/company/snackpass) (US)                                                                                      | Won 80% of Yale in one semester with flyers and gifting; later pivoted to selling POS and kiosks to restaurants                                                                                                                     | A campus can be won fast, but the money came from restaurant software |
| Ritual, Allset, Yoyo (US, UK)                                                                                                                          | Collapsed, closed or absorbed                                                                                                                                                                                                       | Stand-alone pickup apps do not survive                                |
| [Owner.com](https://www.owner.com/pricing), Toast (US)                                                                                                 | Sell ordering to restaurants as software (Owner.com: $249 a month plus 5%, or $499 flat). Toast began as a consumer ordering app and became a POS                                                                                   | The money is in owning the counter                                    |
| [TinyOwl](https://www.business-standard.com/article/companies/six-mistakes-of-tinyowl-the-blue-eyed-start-up-child-116031400038_1.html), Dunzo (India) | Expanded to many cities before the numbers worked; collapsed                                                                                                                                                                        | Do not expand before one campus works                                 |

**The pattern:** no stand-alone pickup app stayed independent. The survivors became the restaurant's software or the institution's vendor, and nobody made 10% of a ₹200 pickup order work.

### The gap KhaNha can fill

Campus canteens and nearby cafés **that no institution contract covers.** They are too small for HungerBox or SmartQ, delivery does not reach their counter, and at most they have a POS with a QR menu that does not handle collection. KhaNha's edge there is token calling, a pickup board, a pause switch for the rush and stock-safe ordering, later with clear rules for prepayment, refunds and no-shows, all on a cheap phone. The gap is real but small, which is why it is still empty.

### Why now, and why not

- **Better than in 2021:** zero-fee UPI under ₹2,000 is law; aggregator orders now carry visible extras (Zomato's platform fee went from ₹2 in 2023 to [₹14.90 in 2026](https://www.business-standard.com/companies/news/swiggy-platform-fee-hike-zomato-price-increase-food-delivery-india-costs-126032400608_1.html)); restaurants are organised against commissions; cheap phones run web apps well.
- **Worse:** Zomato and Swiggy are profitable and chasing cheap student orders; Ownly holds the cheaper-channel slot in Bengaluru; Indian restaurant software raised only [$0.5M in 2026](https://tracxn.com/d/explore/restaurant-saas-startups-in-india/__aEoQyNayDOyz6h41CEe6tPRpjv1YtPV-0geHSnIPaK4) so far; compliance is heavier (§8).
- **Net:** 2026 favours a cheap, narrow tool for canteens and colleges, not a consumer marketplace.

## 6. How big is the market?

India has no statistic for pickup, so this is built from student numbers, campuses only (decision 3). Both research passes did this sum separately and landed within 5% of each other.

Assumptions: about 9,300 campuses have more than 1,000 students (only 18% of India's colleges, [AISHE 2022-23](https://cdnbbsr.s3waas.gov.in/s392049debbe566ca5782a3045cf300a3c/uploads/2026/07/20260708401535366.pdf)), holding about 2.7 crore students; 40% buy food on a given day; 200 college days a year; ₹80 a day; 10% of that spend moves to pre-ordering.

|                                                 | India                | Bengaluru (about 9 lakh students) |
| ----------------------------------------------- | -------------------- | --------------------------------- |
| Campus food spend a year                        | about ₹17,000 crore  | about ₹580 crore                  |
| Spend that could be pre-ordered (10%)           | about ₹1,700 crore   | about ₹58 crore                   |
| Platform revenue at a 10% commission            | about ₹160–170 crore | about ₹4–6 crore                  |
| Platform revenue at the 2–3% outlets really pay | about ₹35–50 crore   | about ₹1–2 crore                  |
| What a small team could realistically win       |                      | ₹0.2–1.2 crore a year             |

These pools are shared by every campus platform. For scale, the roadmap's own pilot (3,000–10,000 orders a month at ₹200 and 10%) is ₹7–24 lakh of revenue a year. Bigger headline figures (up to ₹1,200 crore for India) appear only when offices and cafés are counted, which are out of scope and already contested. Markets abroad were not sized: there, order-ahead is already a feature inside POS and delivery apps, and KhaNha's edge (cheap Android, UPI) is Indian.

## 7. Money: how KhaNha can earn

### What is allowed

After decision 2, money can come only from:

- a flat monthly fee from the outlet (₹1,000–3,000);
- a small fee per order from the outlet (₹2–5, or 2–3%);
- a yearly campus fee from the college (assumption: ₹1–3 lakh, anchored on SpaceBasic's roughly ₹2.2 lakh per institution);
- or a mix of these.

Payments cannot earn money: UPI under ₹2,000 has no fee to share, and a gateway charges KhaNha about 2.3% including GST at list price ([Razorpay](https://razorpay.com/pricing/), [Cashfree](https://www.cashfree.com/docs/help/account/pricing)).

### The 10% commission, worked through

On a ₹200 order: ₹20 commission − ₹4.60 gateway − ₹0.47 split settlement − ₹0.29 for two WhatsApp messages leaves **about ₹14.60**. After support, hosting and refunds, that falls to about ₹8 an order at 10,000 orders a month, and below zero at 3,000. A team of two or three (about ₹2 lakh a month) breaks even only at **about 19,000 orders a month**. At 3% there is no break-even at all while KhaNha handles the money.

Gateway offers do not change this for long: Cashfree's 0% offer is capped at ₹20 lakh of orders (10,000 orders at ₹200) and ends 31 March 2027.

### The models side by side, per outlet

One outlet doing 500 orders a month at ₹180 (₹90,000 of food):

| Model                                                                      | Revenue a month | Direct costs | Gross profit a month |
| -------------------------------------------------------------------------- | --------------- | ------------ | -------------------- |
| 8% commission; KhaNha collects the money                                   | ₹7,200          | ₹3,585       | ₹3,615               |
| ₹499 a month + 3%; KhaNha collects                                         | ₹3,199          | ₹3,585       | loss of ₹386         |
| ₹1,499 flat; the outlet collects on its own UPI QR                         | ₹1,499          | ₹1,245       | ₹254                 |
| Campus fee (about ₹1,700 per counter) + ₹2–3 an order; the outlet collects | ₹2,700–3,200    | ₹1,245       | ₹1,400–1,900         |

What this shows:

- If KhaNha handles the money, each outlet costs about ₹3,600 a month to serve at this volume, so small fees cannot cover it.
- If the outlet collects its own money, costs collapse, and so does the need for a payment contract, escrow and possibly GST (§8).
- **Orders per outlet decide everything.** At 2,000 orders a month the ₹499 + 3% model earns about ₹6,000. Measure this in the pilot before choosing a price.

**Recommended:** a campus fee from the college plus a small per-order fee from the outlet, with the outlet collecting payment itself. Sold to colleges at about ₹2 lakh a year each, against a team costing ₹30–40 lakh a year, this roughly breaks even at 20–30 colleges and is clearly profitable at about 100. A flat outlet fee alone needs about 300 paying outlets for a small profit, and at 4% monthly churn that means 12 new signings a month, forever.

### The cost of winning outlets and students

A field salesperson (about ₹38,000 a month with costs) signs about 5 outlets a month: about ₹10,600 per signed outlet. If one in three signed outlets actually starts using it (an assumption from similar companies), that is about ₹32,000 per active outlet, paid back in about 9 months under the 8% model. Winning a student is cheap (about ₹40: a free item, posters, ambassadors); keeping them through exams and holidays is the hard part.

### Three years, three stories

These are illustrations, not forecasts. They were computed on commissions of 7–10%, which §4 shows outlets resist, but the lesson holds at any price.

| Story | Assumptions                                                                     | Year 3                          | After 3 years                                                |
| ----- | ------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| Slow  | 250 orders per outlet a month; 2–5 new outlets a month                          | 60 outlets, ₹12 lakh revenue    | ₹70 lakh lost                                                |
| Base  | 500 orders per outlet a month; 3–10 new outlets a month                         | 143 outlets, ₹78 lakh revenue   | ₹76 lakh lost; break-even in year 4 at about 180–200 outlets |
| Fast  | 1,000 orders per outlet a month (a big canteen); 6–30 new a month; 10% accepted | 442 outlets, ₹6.3 crore revenue | ₹2 crore profit, on assumptions that contradict §4           |

The money per order is fine once an outlet is active. What decides the story is **orders per outlet per month** (250, 500 or 1,000), which a four-week pilot can measure. Salaries are the biggest cost every year, so the base story needs ₹75–80 lakh of outside money once the team hires.

## 8. Rules and payments

| Rule                                                                                                                                                     | What it means for KhaNha                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RBI payment-aggregator rules](https://www.fidcindia.org.in/wp-content/uploads/2025/09/RBI-PAYMENT-AGGREGATORS-DIRECTIONS-15-09-25.pdf) (September 2025) | KhaNha cannot hold students' money. "Hold the outlet's money until pickup" must run through a licensed gateway's split-settlement product, with every outlet KYC-checked. Razorpay's version [now needs ₹40 lakh of past turnover](https://razorpay.com/docs/payments/route/), and Cashfree's 0% offer does not cover its split product. A new company may not qualify.      |
| GST section 9(5)                                                                                                                                         | Since 2022, an app selling restaurant food (explicitly including canteens) pays the 5% GST instead of the outlet. Whether this applies when the outlet collects payment itself, or when the canteen is not GST-registered, is unresolved. If it applies, a ₹200 order costs the student ₹210 (breaking decision 2), or the outlet pays it and a 10% commission costs it 15%. |
| [UPI fees](https://www.scconline.com/blog/post/2026/09/16/npci-released-upi-mdr-faqs-explained/) (from 15 October 2026)                                  | Free under ₹2,000, 0.4% above. No fee may be passed to the customer.                                                                                                                                                                                                                                                                                                         |
| [Data protection (DPDP)](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)                                  | Full compliance by 13 May 2027, including parental consent for under-18s. First-year students can be 17, so an age check is needed.                                                                                                                                                                                                                                          |
| FSSAI                                                                                                                                                    | Collect each outlet's food licence number at sign-up. The platform needs its own correct licence: Swiggy's Toing was [briefly stopped](https://www.livemint.com/companies/news/swiggy-fssai-prohibition-order-toing-app-licence-11783688463770.html) over this in July 2026.                                                                                                 |
| Consumer protection                                                                                                                                      | Publish a refund policy and name a grievance officer.                                                                                                                                                                                                                                                                                                                        |
| Karnataka gig-worker levy                                                                                                                                | Does not apply: there are no delivery riders. A small cost advantage over delivery apps.                                                                                                                                                                                                                                                                                     |

**The safe pilot:** the outlet collects money on its own UPI QR (a UPI payment link from the web page, or pay at the counter). That means no payment contract, no escrow, no RBI question and possibly no GST. Before any real-money launch, get two written answers: from a chartered accountant on GST 9(5), and from Razorpay and Cashfree on whether a new company can use split settlement.

## 9. Can it grow, and can it be defended?

**Network effects are local.** Inside one campus they are strong: once most counters are on KhaNha it becomes the habit, and the habit brings the next counter. Across a city there are none: a canteen in Yelahanka does nothing for a student in Jayanagar, and each new campus starts from zero.

**What slows growth:**

- **Signing outlets is field sales.** Someone has to walk in, and the cost per active outlet is high (§7).
- **Holidays.** Campuses empty for 3–4 months a year.
- **Support grows with orders.** Prepaid orders bring refunds and disputes that walk-up orders never had.
- **Copying.** The software can be copied in weeks (§5).

**What could make it hard to copy.** None of this exists today, and the software alone never will be:

- default status on a campus, written into a college agreement ("orders go through KhaNha; tokens are called from the board");
- most counters on each campus on one app;
- integrations that are slow to replace: the POS (Petpooja), the campus ID or wallet;
- prepayment, refund and no-show rules that QR menus skip.

All of these are built by selling to colleges, one campus at a time, over years. **KhaNha is a slow, sales-led, campus-by-campus business, not a viral app**, and should be staffed and funded that way.

## 10. Where to start, and how to grow

**City: Bengaluru**, which has the most colleges of any district (§3). HungerBox, SmartQ, GoKhana and SpaceBasic are based there, so the big campuses are taken and the long tail is open.

**Neighbourhood:** one cluster of 3–5 mid-size colleges within walking distance, with cafés at the gates and none on a HungerBox, SmartQ or SpaceBasic client list (so avoid PES, Reva, Manipal, NITTE and IIM Bangalore). Malleshwaram–Seshadripuram and Basavanagudi–Jayanagar are worth checking on foot (an assumption; verify each college). Choose by measured queue, not prestige.

**Sign an outlet only if all three are true:**

1. most peak-hour customers are regulars, the same faces most days;
2. the peak wait is 8 minutes or more, timed by you;
3. the kitchen can prepare ahead (not everything cooked to order on one tawa).

**First 10 outlets: you, in person.** Walk in at 3 pm after the rush with your own count ("22 people in line at 12:40 yesterday; 6 walked away"). Offer two months free, a printed QR stand, and you at the counter for the first week of rushes. Ask for one thing in return: staff call tokens from the board and keep a pickup corner. Expect 30–40 visits for 10 yeses, and about ₹5,000 of printing.

**First 100:** only after the first 10 keep using it. Per cluster, one paid student ambassador (₹3,000–15,000 a month) and one field executive (₹25,000–35,000). Grow through owner referrals, Petpooja integration (orders appear on the screen they already have) and real before-and-after numbers from the pilot. Expect about 300 signings for 100 active outlets: 12–18 months for one executive.

**1,000 outlets:** nobody has reached this by walking into shops one by one. It needs college contracts (one signature, every counter) or a POS company reselling KhaNha, plus outside money for a small sales team.

**Reaching students:**

- **Cheap and effective:** QR at the counter (it catches people while they queue), ambassadors, department WhatsApp groups, orientation-week stalls, a free item on the first order (₹20–40), web push alerts (free), WhatsApp status messages (about ₹0.14 each).
- **Too expensive for the margin:** paid app installs, WhatsApp marketing messages (about ₹1 each), discounts above ₹15 an order. Influencers are the wrong tool for one campus.
- **Scale:** 10,000 students is one or two campuses; 100,000 needs 15–25 campuses, which only college contracts can deliver.

## 11. What to build, and what not to

The software is not the risky part. The risk is whether students at one outlet order ahead again and again, and whether the outlet pays. Build only what tests that.

|                       | Features                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Already built         | Menu with photos and prices, cart, "sold out", order number, staff board, stock-safe ordering                                                                                                                                                                                     |
| Build now             | A "pause orders" switch for the rush; a pickup time the student picks ("ready at 1:15"); a "ready" alert that reaches a locked phone (web push, or a WhatsApp message typed by hand during the pilot); payment at the counter or to the outlet's own UPI                          |
| After the pilot works | Cancel and refund rules a 19-year-old understands in one line; a free-text note ("less spicy"); an end-of-day screen for the owner (orders, money, busiest hour)                                                                                                                  |
| Later                 | Order again, favourites, ratings, surplus deals (these only pay off when no-shows are common, which means the core experience is failing)                                                                                                                                         |
| Do not build yet      | Multi-brand and multi-branch catalogues, store memberships, escrow ledger and reconciliation, ETA engine, QR pickup verification, recommender, analytics pipelines, cost tracking, AWS migration, Kubernetes, load tests to 1,000 users, store apps, city-wide "discover by area" |

Multi-store support is still needed, but for every counter on one campus rather than across a city: a student should see all the nearby counters in one list.

**The moments that win people:**

- **Student:** walking past a 15-person queue, saying the token number and picking up packed food. It has to happen on the first or second order, at peak, with no mistake.
- **Owner:** a rush where the board shows orders in sequence, nobody shouts and the counter clears faster; then an end-of-day screen showing money that came in before anyone reached the counter.

## 12. Biggest risks

| Risk                                                             | Likelihood                    | What to do                                                                                       |
| ---------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| The queue is short, or the kitchen is the bottleneck             | High                          | Time queues before building anything; pilot only at outlets that pass the §10 checklist          |
| Outlets will not pay                                             | High                          | A flat or campus fee instead of 10%; ask for money in week 4 of the pilot                        |
| Students try it, then stop (exams, holidays, one late order)     | High                          | Make it the campus default, with tokens called from the board; never be late on a prepaid order  |
| Building the platform before anyone pays                         | High (it is the current plan) | Follow §11 and §14                                                                               |
| Outlets do not want another screen                               | High                          | Run the board on the staff's own phone; integrate with Petpooja rather than add a tablet         |
| A GST line makes KhaNha dearer than the counter                  | Medium-high                   | Get the accountant's answer first; let the outlet collect payment in the pilot                   |
| The "hold money until pickup" product is closed to a new company | Medium-high                   | Ask Razorpay and Cashfree in writing before writing any escrow code                              |
| Signing outlets is slow and expensive                            | Medium-high                   | Sell to colleges (one signature, ten counters); track cost per active outlet, not per signed one |
| Refunds, no-shows and disputes overload a small team             | Medium-high                   | Pay at the counter first; add prepayment only where no-shows are measured                        |
| Petpooja, DotPe or HungerBox add the same feature                | Medium                        | Win on campus agreements and counter workflow, not on the app                                    |
| Holidays empty the campus for 3–4 months                         | Certain                       | Price colleges by the year; keep cash for the empty months                                       |
| Winning students costs too much                                  | Low                           | It is cheap on campus: QR, ambassadors, WhatsApp groups                                          |

## 13. How to know if it is working

Targets are starting points; the pilot will refine them.

| Measure                                                                     | Target                        |
| --------------------------------------------------------------------------- | ----------------------------- |
| Share of the outlet's peak-hour orders through KhaNha                       | 15% by week 4; 30% by month 3 |
| Students ordering every week without any discount, as a share of the campus | 3% or more                    |
| Week-1 users still ordering in week 4                                       | 30% or more                   |
| Orders per active student per week                                          | 2 or more                     |
| No-shows on prepaid orders                                                  | under 3%                      |
| Orders ready within the promised time                                       | 97%                           |
| Signed outlets doing 20+ orders in their first week                         | 70%                           |
| Pilot outlets still live after 3 months                                     | 80%                           |
| Revenue per outlet                                                          | ₹2,000 or more a month        |
| Active users who would be "very disappointed" if it went away               | 40% or more                   |

The first two targets measure the same thing from two sides: on a 3,000-student campus with one busy counter, 3–6% of students ordering every week is roughly 20–50% of that counter's peak orders.

### Three possible futures

| Future                       | What it looks like                                                                                                                                                             | Early signal                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Small and profitable**  | 100–300 counters on 15–40 Bengaluru campuses, mostly sold to colleges; a team of 4–6; ₹1–3 crore revenue a year; little or no outside money                                    | 15–30% of peak orders; outlets pay a flat fee after the free month; orders per outlet level off at 300–600 a month                                       |
| **B. Large campus platform** | The ordering and payment layer for about 1,000 campuses in several cities; ₹50–100 crore revenue (HungerBox's size today); likely sold to a caterer, POS company or aggregator | Over 50% of a campus ordering within a semester; 800+ orders per counter a month; colleges signing multi-year contracts; a POS company asks to integrate |
| **C. No fit**                | A polished app, two or three outlets using it lightly, students ordering once, owners not paying; over within 12–18 months                                                     | Peak waits under 4 minutes; under 5% of peak orders after two weeks; nobody pays after the free month; still writing ledger code with no outlet live     |

Future B also needs ₹5–15 crore of patient capital, a campus price above ₹5,000 per counter a month, and a founder willing to run a field-sales company for three years. Raise money and build the roadmap's platform only if the pilot points to B.

## 14. The next 30 days

The goal is not to build. It is to find out, with numbers you can show anyone, whether one outlet and its students use this every day and pay for it. Write each pass and fail number down before the test, so you cannot talk yourself into a "maybe".

### Week 1: measure the pain

- **Queue study** at 3–5 counters (a canteen, a college café, a tea or snack shop at a gate), with a stopwatch at lunch: people in line every 5 minutes, wait from joining to food, walk-aways, and the share of the day's orders in the busiest hour.
- **Start the interviews** (Appendix A). Do not mention KhaNha.
- **Landing page**, shared in one campus's WhatsApp groups and Instagram.
- **Payments and GST:** send the two written questions (§8). Open Zomato and Swiggy at the campus to see whether pickup is offered.
- **Build** the pause switch and the chosen pickup time. Nothing else.

**Pass:** average peak wait of 8+ minutes at most counters, 30%+ of daily orders in one hour, and 10%+ of landing-page visitors signing up (150+ from one campus).
**Fail:** waits under 3 minutes at most counters, and fewer than 1 in 3 owners or students bring up the rush or a wasted break without being asked. Stop and rethink the problem.

### Week 2: run it by hand

- **WhatsApp test** at the outlet with the worst queue and a friendly owner: students text their order, you type it into the staff board, they pay at the counter.
- **Fake-door poster** at two other counters ("Skip the queue: order from your phone"), leading to a "not live yet, tap if you want this" page.
- **Pitch 15 outlets:** free for a month; on day 15 show the real price options (10%, 5% or 3% per order, or ₹2,000 a month flat) and record which each picks; at the end of the month, actually ask for the money.
- **Finish the interviews.**

**Pass:** 10% of the outlet's peak orders come by WhatsApp, 40% of users order again, 5%+ of customers scan the poster, and 4 or more of the 15 outlets say yes including a fee.
**Fail:** under 3% of peak orders by day 14, under 1% scanning the poster, or no outlet willing to pay even a token fee.

### Week 3: run it with the real app

- Move the WhatsApp outlet onto the app: QR on the counter and tables, payment at the counter or to the outlet's UPI, the staff board on a phone or cheap tablet, and a hand-sent "ready" message if web push is not ready.
- Charge exactly the counter price. If the accountant says a GST line is unavoidable, show it, so the test measures the real gap.
- Recruit 3 student ambassadors; give a small free item on first orders, paid by you.
- Log every complaint, every mistake and every minute the board was ignored.

**Pass:** orders ready on time (§13) and no more than 1 support message per 20 orders.
**Fail:** staff abandon the board during the rush. The product is not usable yet, whatever the demand.

### Week 4: ask for money and decide

Ask the pilot outlet to pay for next month, and record the answer and the reason. Then compare your numbers with §13:

- **Go** (looks like future A or B, the outlet pays or commits in writing, and 3+ other outlets want in): launch on one campus with 3–5 outlets for 8 weeks (₹30,000–60,000). That passes if 2+ outlets pay, 35% of sign-ups order weekly and each orders twice a week. Start the payment paperwork now; it takes weeks.
- **Change** (students love it but nobody pays, or outlets like it but students do not return): change the model, for example a campus package sold to the college (never a student fee), and re-run week 3.
- **Stop** (looks like future C at the worst-queue outlet you could find): the problem is not painful enough here. Keep the code; change the problem.

## Appendix A: Interview questions

Never mention KhaNha or describe the idea, and never ask "would you use…?" (people say yes to be polite). Ask what happened last week, what it cost and what they already tried.

**Owners and managers (15–20, across at least 3 campuses)**

1. Walk me through your busiest hour yesterday, minute by minute.
2. How many orders on a normal weekday, and in the busiest hour? How do you know?
3. When the queue gets long, what do customers do? What do you do?
4. How do orders and payments come in today (counter, Zomato or Swiggy, WhatsApp, phone), and roughly what share each?
5. What did you pay last month in commissions, software and payment fees? (Ask to see the statement.)
6. Have you tried pickup ordering before (an app, Zomato takeaway, a WhatsApp menu, a QR)? What happened?
7. Who decides on new software here (you, the owner, the college, the contractor)? What was the last such decision?
8. What part of running orders would you pay to make go away? What monthly amount is "obviously worth it", and what is "too much"?

**Students (30–40 interviews, plus a short survey of 200 or more)**

1. Tell me about the last time you bought food on campus: where, what, how you paid, how long it took.
2. How many times last week did you skip a meal, go elsewhere or eat late because of a queue?
3. When you want food fast, what do you actually do today?
4. Which food apps did you use last month, and why that one most?
5. Have you ever ordered ahead and picked up yourself? Why, or why not?
6. How do you feel about paying before you get the food? What would make you nervous?
7. What makes you delete or stop opening an app? Give me the last example.

**Counter and kitchen staff (8–10)**

1. What happens at the counter in the busiest 15 minutes? Who does what?
2. How do you keep track of which order is whose today?
3. What are the most common mistakes, and when do they happen?
4. When an item runs out mid-rush, how do customers find out?
5. If orders arrived from phones before the customer reached the counter, what would change for you? What would worry you?
6. What one change would make your shift easier?

## Appendix B: Still unknown

- How long the queue really is at your target counters, and whether the kitchen is the bottleneck.
- How many orders one outlet actually moves to pre-ordering, and what an owner pays when asked.
- Whether KhaNha owes 5% GST as a pickup-only platform, especially when the outlet collects payment.
- Whether a new company can use Razorpay's or Cashfree's split settlement.
- Whether Zomato or Swiggy still offer pickup at your campus.
- How many people really use Toing (the 33 million is an unverified analyst estimate).
- What HungerBox and SmartQ charge colleges, and how often pre-orders go uncollected anywhere in India.
