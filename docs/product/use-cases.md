# Use Cases & User Workflows

**Status:** v1.2.16 — **UC-90 states that a write-off can be partial (D2 of the backend accuracy review, 30 Aug 2026)** — the code had always accepted an amount less than the full outstanding balance but silently discarded the remainder with no row recording it (GAP-203/H-1); this records the decision the fix now implements, mirroring how a waiver already accumulates in `waived_minor`. Schema in `data-model.md` §10.1/§10.3.

**v1.2.15** — **W-68 to W-70 and UC-106 to UC-109 added: vehicle loans, and the cash figure you read before paying an owner.** Loans move from phase Third to **First** (§9.1) — not because the table had omitted them, but because **UC-109's distributable cash is arithmetically wrong without them** and UC-75's cash position is already phase one; the release gate moves out by that much, recorded as a trade rather than left to be discovered. A loan is recorded at its flat quoted terms and each payment splits by one fixed ratio (W-68); **principal repayment is never an expense, so a lender's forgiveness is never income** (W-69), and is explicitly not a W-28 waiver. §6.7's borne-by matrix gains the one row that does not flip between arrangements. **UC-03's owners-only capital row is stated as covering *partner-level* facts** (W-70), so a business liability and a cash total sit with a manager's working set — the manager pays the instalment, so he must see what is left. Settles `PENDING-FEATURES-DESIGN-2026-08-23.md` items 3 and 4, with two of that note's premises corrected in `COMBINED-PLAN-2026-08-23.md`. Decided 23 Aug 2026; mechanics in `user-flows.md`, schema in `data-model.md`.

**v1.2.14** — **W-63 to W-67 and UC-102 to UC-105 added: a platform tier above the business, and one identity able to belong to more than one.** New Group L. **W-39/UC-08's "one business" framing is corrected** — an identity may now hold membership in several, never merged, never compared. Settles the platform-admin-and-multi-business design (`PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md`, decisions 1-29, second and third validation passes) into this document, per its own §11/decision 29. Full mechanics in `user-flows.md` INV-38 to INV-42 and new F-0.x/F-11.x flows; schema in `data-model.md` §3. Decided 17-18 Aug 2026.
**v1.2.13** — **two First-phase entries split rather than deferred whole, and two §8 challenges given revisit triggers.** **UC-99** separates into a spreadsheet that ships and a statement *document* that does not: no PDF renderer has a home in this runtime (`tech-stack.md` §8), and neither available answer — a new dependency inside the money-critical runtime, or an outside service that would see every figure — is a decision to take in passing. **UC-57** separates the same way: the printed slip ships, the no-login share link does not, because it would be the first route in the client outside the login and it carries someone's full financial position. Neither clause was weakened — what the driver must be able to see is unchanged, and UC-59 already gives a linked driver those figures. §9.1's First row records both splits so it is not read as promising what it no longer does. **§8's W-4 and W-2** now carry conditions rather than "after real use": W-4 revisits at the first three closed months containing a `did_not_run` day (and is a term in the driver's agreement, so it is cheaper to settle before a second driver signs); W-2 at the first closed month in which an `offset_record` was actually used. Decided 17 Aug 2026; mechanics in `user-flows.md` F-9.3/F-6.6.
**v1.2.12** — **W-62** and **UC-101** added: ending a daily-lease assignment (arrangement B) never refuses on an open driver balance — unlike archiving a party (W-60), ending an assignment hides nothing, so there is no report the debt could silently leave. Closes GAP-25's own open question for Wave 5 Track 5A; full mechanism in `user-flows.md` INV-37 and F-4.8. **UC-13 corrected the same sitting**: the maintenance prompt's own mechanism had never been specified — a vehicle now carries an optional service interval in kilometres, and the prompt appears only once one is set, on the vehicle's own page. Closes GAP-68's open question for Wave 5 Track 5B; full mechanism in `user-flows.md` F-3.5. Both decided 15 Aug 2026, ahead of Wave 5's remaining build.
**v1.2.11** — **W-61** added: correcting a mistake anywhere in the ledger means undoing exactly what the correcting act itself minted, never what a separate, later action entered — cascade into rows the same call created, refuse when an independently-entered record sits beneath and name it, so the manager undoes what he actually did, in the order he did it. Settles the nine remaining void-cascade decisions (`adjustment`, `offset_record`, `deposit_movement`, `advance`, `advance_settlement`, `write_off`, `write_off_recovery`, `incident_recovery`, `obligation`) for Wave 5 Track 5B's GAP-12; full per-table mechanism in `user-flows.md` INV-36 and F-8.5. Decided 14 Aug 2026. **v1.2.10** corrected: archiving a driver or customer requires a reason, not just a confirm. Found building 5B-1 against migration `0023`'s own `CHECK` (`driver`/`customer` refuse `voided_at` set with `voided_reason` null or empty) — the same W-50 audit discipline every money void already carries, which the flow had left unstated. **v1.2.9** added **W-60** and **UC-100** itself: archiving a driver or customer with any open money — a due, an unreconciled advance, a deposit held — is refused, naming the figure, never merely warned. W-58 already promised no party is hard-deleted; this settles the other half it left silent, the condition under which one may be *hidden*. Decided 14 Aug 2026, closing GAP-36 for Wave 5 Track 5B's Step 0; full mechanism in `user-flows.md` INV-35 and F-1.11
**Date:** 17 August 2026
**Companion:** `user-flows.md` holds the executable form of everything here — state machines, invariants, acceptance criteria and the test plan. This document owns *intent*; that one owns *mechanics*. Changes travel together (§10).
**Deliberately excluded:** entity design, data model, functional requirement IDs, architecture. Those follow once these use cases are frozen. The existing requirements spec is unchanged and now partly out of date — it will be revised against whatever this document settles on.

> **What changed in v1.2.** Two contradictions that produced wrong numbers were resolved (§1.2), one word carrying two incompatible meanings was split apart (W-40), eighteen decisions were added, and sixteen use cases were written for behaviour the document already relied on but never specified. Entries marked **⚑ proposed** are my judgement, not yours — §10 lists them together so any can be reversed in one pass.

---

## 1. The reframing your new detail forces

The dividing line is not *car vs bus*. It is **who bears the running cost**. Once framed that way, everything you described collapses into **three arrangements**, and every vehicle can move between them over time.

| | **A. Lease out** | **B. Daily lease to driver** | **C. Operated hire** |
|---|---|---|---|
| Who runs the vehicle | Customer | Driver | Us |
| Who bears fuel | Customer | **Driver** | Us |
| Who bears the driver cost | Customer | n/a — he is the operator | Us (we pay him) |
| Who bears repairs & accidents | **Us** | **Us** — plus tyres, servicing, cleaning, insurance, licence (W-7) | Us |
| Who bears tolls & fines | Customer | **Driver** | Us |
| Money direction | Customer pays us per period | **Driver pays us** per day | Customer pays us per trip; we pay the driver |
| Income shape | Fixed monthly amount | Fixed daily / alternate-day amount | Agreed trip amount |
| What we track | Income, repairs, accident recoveries, **mileage against allowance** | Income, arrears, repairs, distance | Income, all trip costs, driver dues, distance and efficiency |
| Odometer's purpose (W-12) | **Billing** — excess km is chargeable | **Oversight, entirely optional** (W-20) | **Efficiency** — km/l and cost per km |
| Your examples | Car on monthly rent | Bus in its normal arrangement | Bus charter **and short car hire** |

Three consequences worth noting before we go further:

1. **Short car hire is not a small monthly rental — it is a small charter.** You said you add fuel and driver for those. That makes it arrangement C, identical in shape to a bus trip. So it reuses the *same* trip screen. No new workflow to learn, no new screen to build. This is the single biggest usability win available.
2. **The bus's normal arrangement is arrangement B, where the driver is a payer, not a payee.** He keeps the takings, bears the fuel, and pays you a fixed daily amount. That is the opposite money direction from a charter, where you pay him. The same person is therefore sometimes your debtor and sometimes your creditor — which is why driver balances need care (§6.4).
3. **A vehicle-day belongs to exactly one arrangement.** The bus is either on its daily lease or on a charter, never both. That single rule is what stops income being counted twice.

### 1.1 Decisions log

| ID | Decision | Effect |
|---|---|---|
| **W-1** | In the bus's normal arrangement the **driver pays you** out of the fares he collects. It is a lease to the driver. | Daily income is money owed *by the driver*. Fares never enter your books. The daily card is about what he owes and what he handed over. §6.7 |
| **W-2** | Driver balances stay as **two separate figures**, offset only by explicit action. | An offset is a real agreement between two people, recorded as such. UC-56 |
| **W-3** | **Drivers never enter data — the manager records everything.** A driver may optionally get a **view-only** account. | The driver record exists whether or not he has a login; if he makes his own profile it is linked to that record. Entry stays with the manager, so catch-up remains a first-class workflow (U-8). UC-07 |
| **W-4** | **No run means no charge — always.** Reasons are recorded for insight only, never for money. | No chargeable flag, no settings screen for one, no per-day override. Arrears can arise only from a day that ran and was underpaid. UC-06, UC-33 |
| **W-5** | The driver **hands over cash daily**. | Arrears are the exception, not the norm. The daily card's first question is "did he pay?", answerable in one tap. UC-31 |
| **W-6** | The charter driver is **chosen per trip**, defaulting to the lease driver. | The same driver can owe rent for most of a month and be owed a trip fee for part of it — which is exactly why W-2 keeps the two balances apart. UC-41 |
| **W-7** | In the daily lease **you** bear repairs, accidents, tyres, servicing, cleaning, insurance and licence. **He** bears fuel, tolls and fines. | Gives a default owner for every cost, derived from arrangement + category, so the common case needs no extra tap. §6.8 |
| **W-8** | The driver puts up a **deposit**. | His money that you hold — a liability, never income, and never silently netted against his arrears. UC-58 |
| **W-9** | What happens to rent while a car is off the road is **decided per incident**. | Three choices offered at the incident — rent continues, days credited, or the rental extended by the lost days. Default is continue, because doing nothing must be the safe path. UC-12 |
| **W-10** | The customer's contribution after an accident is **negotiated each time**. | No rule to configure. An agreed amount recorded against the incident with a note, payable in parts or from the deposit. UC-12 |
| **W-11** | Insurance is claimed **only for major damage**. | The claim section is optional to fill in and always visible — nothing hides it behind a setting; whether damage is "major" is the manager's judgement at the time, not a switch configured in advance. A claim in progress is money expected, not money earned, and must be visible as pending for the months before it arrives. **⚑ Corrected 11 Aug 2026 — GAP-11**: "off by default" was never backed by a settings field anywhere in the schema, so the claim action was always offered regardless; the decision now matches what was actually built rather than asking for a switch nothing needs. UC-12 |
| **W-12** | **Odometer is tracked in all three arrangements**, always optional per reading. | Three different purposes, one mechanism. §6.9 |
| **W-13** | A driver record is **independent of any login**. If he creates his own profile, the manager links it and he gets view-only access to what concerns him. | Transparency without handing over data entry. UC-07, UC-59 |
| **W-14** | **WhatsApp notifications sent automatically**, opt-in per recipient, each one written to a **dedicated message audit log**. | Nobody is watching at send time, so the controls move into the system: condition re-checked at dispatch, one-send-per-trigger, delivery status tracked, failures surfaced, and a kill switch. §6.10, UC-86, UC-87 |
| **W-15** | Customers are held as proper records — NIC, mobile, address, agreed terms — because they are now notified. | The customer record stops being a name on an agreement. UC-10 |
| **W-16** | Car rentals carry a **mileage limit expressed per day**, plus an excess rate per km, both set per rental. | Mileage is no longer unlimited. Odometer readings in arrangement A become financially significant, not informational. UC-14 |
| **W-17** | Any due can carry a **manual adjustment, plus or minus**, and small excesses can be **auto-waived below a threshold**. | Small amounts get ignored automatically instead of by hand — and every waiver is still counted. Threshold figure still needed. UC-15, §6.11 |
| **W-18** | Odometer readings arrive by **mixed routes** — photo with a reminder, read in person, or only at return. | The reading records *how* it was obtained, since a photo is verifiable and a spoken figure is not. Monthly excess is provisional; the return reading reconciles it. UC-14 |
| **W-19** | The daily limit and excess rate **vary per rental**. | Saved packages plus a custom option, so varying terms do not mean retyping. The confirmation message stating this rental's daily limit and rate becomes the written record that prevents mix-ups. UC-10 |
| **W-20** | On the **bus daily lease the odometer is fully optional** — no prompt, no nag, nothing depends on it. | Over-use detection becomes opportunistic rather than systematic; the lost-days report stays the main protection. UC-34 |
| **W-21** | Automatic is the target, but the **transport is a swappable piece**. The app works from day one on whichever channel is live. | Verification and template approval take days to weeks; the trigger logic and the audit log are identical either way, so nothing waits on Meta. Group I prerequisites |
| **W-22** | Messages in **English plus one local language**, chosen per recipient. | Every template exists as a matched pair with its language code. Adding a third language later means re-approving everything, so the second is fixed now. UC-86 |
| **W-23** | Automatic sending window **08:00–20:00**, with confirmations exempt. | Reminders wait for the window; a confirmation that money just moved goes immediately, because its value is being immediate. UC-86 |
| **W-24** | The limit is **daily; each billing period's allowance is calculated as daily limit × days in that billing period, and resets every billing period.** Unused allowance is forfeited, not carried forward. | One stored number derives every allowance — any frequency, any month length, partial periods and extensions all fall out automatically. §6.12, W-40 |
| **W-25** | **The agreed rent is a fixed amount per billing period**, payable in full whether the mileage is used or not, and regardless of how many days the month has. Mileage is **one-directional** — it can only add an excess charge, never reduce the rent. | Money and kilometres are calculated on *different* bases — the one place in this system where making them consistent would be a bug. §6.12, W-40 |
| **W-26** | A lease can be **closed early at any time**, with the final period's treatment decided at closure and the deposit settled explicitly. | Future dues stop immediately, outstandings are shown before the deposit is released, and the closure produces a final statement. UC-16 |
| **W-27** | Cash held by a person can be **moved to a business account**; the word "deposit" stays reserved for security deposits. | Held-cash balances would otherwise only ever grow. UC-65 |
| **W-28** | A **bad-debt write-off is a separate category from a goodwill waiver** and the two are never pooled. | One is a loss you absorbed, the other a discount you chose. Mixing them makes both numbers useless. UC-90 |
| **W-29** | A charge can be logged **against a closed lease or trip**, creating a standing balance for that party. Security deposits are held for a set window after closure before release. | Fines and tolls arrive weeks late, after your leverage is gone. Policy fix plus system fix. UC-91 |
| **W-30** | **Condition photos at handover and at return**, as a paired set. | A handover set with no return set proves nothing, so the two are treated as one artefact. UC-10, UC-16 |
| **W-31** | **Vehicle paperwork expiry dates** are held per vehicle and warned about ahead of time. | An expired insurance turns an accident claim into an absorbed loss. UC-92, U-4 |
| **W-32** | Costs belonging to **no vehicle** are recordable, and shown as a separate block rather than spread across vehicles. | Otherwise consolidated vehicle profit overstates the business. UC-66 |
| **W-33** | A failed critical message can be **re-sent through another channel**; the written record never depends on WhatsApp. | Meta can suspend a number. The statement and the slip already carry the record. UC-87 |
| **W-34** | Driver payments **not tied to any trip** are supported — a retainer, a bonus, or help during long downtime. | Keeps a good driver through weeks of repair without inventing a fake trip. UC-50 |
| **W-35** | **Facts arrive late, and a closed record can always receive a new one.** A late fact posts to the currently open **accounting period**, carrying a reference to the accounting period it belongs to; it never silently reopens a settled month. | Generalises the review's two best findings into a rule, so the next late-arriving fact needs no new feature. §6.14, W-40, UC-98 |
| **W-36** | A payment recorded as received can be **reversed** if it turns out not to have arrived. | A reversal un-settles the due, restores the arrears, re-arms the reminder, and notes that a receipt may already have gone out. UC-93 |
| **W-37** | Corrections can be **partial**, and **who bears the shortfall is a choice**, not an assumption. | A short count either goes back to his arrears or is absorbed as a cash-handling loss. Also: a shortfall found only at banking often cannot be attributed to any one receipt. UC-93, UC-65 |
| **W-38** | Baseline condition photos are **sent to the customer**, not submitted for his approval. | His possession of the timestamped set, unanswered, is better evidence than a button he can claim he tapped without looking — and needs no reply handling. UC-10, UC-80 |

#### Added in v1.2 — ⚑ proposed, not user-confirmed

These eighteen close gaps the document relied on without stating, or fill values it left open. Each is **⚑ proposed**: reversible, and listed together in §10 so reversing one is a single pass.

| ID | Decision | Effect |
|---|---|---|
| **W-39** ⚑ | A **business** is the scope root. Every record belongs to exactly one business; ownership shares stay per vehicle. | Three things had no parent: costs belonging to no vehicle (UC-66), the cash position (UC-75), and partner current accounts. `business_id` is never blank; the vehicle is what's optional. UC-08 |
| **W-40** ⚑ | **"Period" is two words.** A **billing period** is a lease cycle — the 12th to the 11th, whatever the customer agreed. An **accounting period** is the month you close and settle. | They coincide only by accident. W-35's whole rule is written in terms of "the open period" and was ambiguous about which. Every use of the word now names one. §6.15, UC-98 |
| **W-41** ⚑ | **Trip income recognises on the trip's closing date.** | A charter running 28 Jul – 3 Aug needs one home, not a split. The trip's own P&L (UC-44) is unaffected either way — it was never a monthly figure. §6.12 |
| **W-42** ⚑ | Driver account linking is **manager-initiated**: he issues a code, the driver enters it. | The reverse — a driver searching for his record — lets a stranger attach himself to a balance. Manager-initiated keeps W-3's trust model intact. UC-07 |
| **W-43** ⚑ | A blank auto-waive threshold means **zero — waive nothing**. Never unbounded. | The dangerous default is the one where forgetting to fill in a figure silently writes off every excess charge. §6.11, UC-15 |
| **W-44** ⚑ | **Customer deposits behave like the driver's** (W-8): topped up, partly applied, refunded, each deliberately. | UC-12 lets an accident contribution be taken from the deposit mid-lease, which depletes it while the lease runs on. Nothing refilled it. UC-10, UC-16 |
| **W-45** ⚑ | **Inbound WhatsApp replies are out of scope.** The number carries an auto-reply saying so and pointing at a phone number. | People reply to messages about money. Without this they reply into a void, which reads as being ignored. Cheaper to say so than to build an inbox. UC-86 |
| **W-46** ⚑ | A lease **ends the day before** the next begins. A same-day handover belongs to the **incoming** lease. | §6.3 allows one arrangement per vehicle-day and back-to-back rentals are normal. Without a rule, the changeover day is either double-booked or lost. UC-10, UC-16 |
| **W-47** ⚑ | **One driver per trip** in v1, stated as a limit rather than left ambiguous. | A relief driver on a long charter is real but rare, and supporting it changes how the fee, the advance and the settlement all work. Better named than half-built. UC-41 |
| **W-48** ⚑ | **Who bears a cost and who paid for it are two separate fields.** | The manager buying the driver's fuel out of his own pocket is simultaneously an out-of-pocket cost owed back to him (UC-60) and a cost borne by the driver (§6.1). One field cannot say both. §6.1, §6.7 |
| **W-49** ⚑ | **Four roles with an explicit capability matrix** — owner, owner-manager, manager, linked driver. The driver boundary is a **security requirement**, not a preference. | Nothing said whether a manager can write off a debt or see capital accounts. A linked driver must be unable to reach another driver's data by any route, including a report or an export. UC-03 |
| **W-50** ⚑ | **Money records are append-only.** A correction writes a new record referencing the original, and every money-bearing record carries a readable audit trail. | U-5 promises everything is correctable "with the change recorded" and never says where the record lives or who may read it. Two partners sharing one ledger, one of whom does all the entry, need it from the first month. UC-96, UC-97 |
| **W-51** ⚑ | **Opening balances are a dated go-live batch**, never income and never an expense. | Every real start has a bus already leased, a car already rented and a driver already behind. Without this the first month is fiction and everything downstream inherits it. UC-09 |
| **W-52** ⚑ | The gap between what a partner **paid in** and what he **owns** is a partner current-account balance — not an adjustment to the profit split. | UC-02 already stores the difference "permanently, without nagging". This says what consumes it: he is owed it back, and his share of profit is unaffected. UC-67 |
| **W-53** ⚑ | A **management fee is a vehicle operating cost** to the owner and income to the manager. | So it reduces the owner's vehicle profit before shares, and consolidated business profit nets to zero on it when the manager is also a partner. UC-03, UC-64, UC-67 |
| **W-54** ⚑ | **One currency, one business timezone, integer minor units, half-up rounding, largest-remainder splits, inclusive-start/inclusive-end periods.** | Unstated conventions are where off-by-one bugs live. These are the rules that make §7.3's 31 / 28 / 31 / 30 come out right and its 152 / 148 split add back to 300. UC-08, §6.16 |
| **W-55** ⚑ | A customer is a **person** (NIC) or an **organisation** (registration number). | UC-10 assumes a person with an NIC. Charters are booked by schools, companies and temples, which have neither. UC-10, UC-40 |
| **W-56** ⚑ | **Reports degrade to "not available", never to zero.** | Promoted from prose in §6.9 to a decision, because it now binds every report in Group H and it is the difference between "no data" and a confident wrong number. §6.9, Group H |
| **W-57** ⚑ *(added v1.2.3)* | **Joining a second partner or a manager is code-based, the same shape as W-42's driver linking**: the owner (or owner-manager) generates an **invite code** scoped to a role, hands it over out of band, and the invitee redeems it the first time they sign in. Never a search, never an email the app sends on your behalf. | UC-03 said "pick the user" and never said from where — the only identity this system has before someone signs in at all is whatever Asgardeo hands back, so there is no list to pick from. A solo business never needs a second account, which is exactly why this gap stayed invisible until a real one tried to add its second partner. Reuses W-42's reasoning exactly — the alternative, an invitee searching for and attaching themselves to a business, hands a stranger who guesses a business name the ability to request its books. UC-03 |
| **W-58** ⚑ *(added v1.2.7)* | **No record is ever hard-deleted, not only money records.** Every table — including occupancy rows like a vehicle-day allocation, and child rows like a payment's allocation line — is voided, never removed. | W-50 already made this promise for money; the gap was everything else. A vehicle-day allocation freed when a trip takes over a leased day, or a payment allocation undone during a correction, used to be deleted outright — invisible to any later investigation, because migration `0002`'s audit trigger only fires on insert and update. Widens W-50 rather than replacing it: **why** stays the same (a ledger's whole promise is being believed about money, and a deleted row cannot be explained later); **what** widens from money-bearing records to every record. Found auditing the two rows deleted outright with no audit trail: `vehicle_day_allocation` and `payment_allocation` (DM §4.1, §10.2) |
| **W-59** ⚑ *(added v1.2.8)* | **"Own vehicles" and "shared vehicles" (UC-03's own matrix, UC-70) each name a mechanism this document never specified.** An owner-manager's capital/ownership capability scopes to the vehicles his `ownership_share` names, effective-dated exactly as UC-02 already reads it (a share existing *now*, since the action itself is a present-tense write). A manager's UC-70 visibility scopes to the vehicles whose `management_fee_agreement` **overlapped the reported accounting period** — not the agreement's status today, and not its status at the period's end. | UC-03's matrix has carried "✓ (own vehicles)" and "shared vehicles" since it was written, with no answer to *which record decides that* or, for a manager reading last month's numbers, *as of when*. Two temporal alternatives were considered and declined: **as of period end**, which would match how `UC-64`'s management fee is already computed but would let a manager granted a vehicle on the period's last day see the whole month he took no part in; and **as of today**, which is simplest but means a revoked agreement retroactively hides every month the manager actually worked — the report would lie about history because of a present-day fact. **Period-overlap survives both**: a manager who ran a vehicle for part of July still sees July after an August revoke, and one added on 31 July sees nothing before it. UC-71/72/74/76/78 carry no such qualifier in their own *Sees:* lines and stay whole-business for a manager — not an omission, confirmed while resolving this: a manager runs operations, so receivables, cash, lost days and ageing are his working set; what UC-03's matrix denies him is capital and the two owners-only strategic reports. UC-75 has no vehicle at all to scope by (partner cash is pooled, UC-65). UC-02, UC-03, UC-70 |
| **W-60** ⚑ *(added v1.2.9)* | **Archiving a driver or customer is refused while any money tied to him is still open — a due, an advance, or a deposit held — and the refusal names every open figure.** Not a warning that can be clicked through. | W-58 says a party is never hard-deleted; it never said whether one may be *hidden* from every list while still owed money or still owing it. A receivable (or a driver's unpaid day fee) must never leave a report because someone tidied up the party picker — the same reasoning W-56 already applies to a report going quiet instead of lying. Settling first and archiving second costs one extra step, on an action that is rare by nature (a duplicate entry, a party who is truly gone) — the alternative is a number that only stops being wrong when someone happens to notice the archived name missing from a report it should still be on. Never nets the driver's two balances into one figure (W-2 still applies) — a driver owing an unsettled advance while also being owed unpaid fees is blocked with both named, not the difference. Decided 14 Aug 2026, closing GAP-36 for Wave 5. UC-100 |
| **W-61** ⚑ *(added v1.2.11)* | **Correcting a mistake means undoing exactly what the correcting act minted, and never what a separate, later action entered.** Voiding a record cascades into a row the same call created — nobody ever entered it on its own screen — and refuses, naming the blocking rows, when a genuinely separate entry sits beneath it. | W-50 says money records are voided and replaced; it never said what happens to what a void leaves standing beneath it. Plan.md's own A9b trap already warned that cascading is a second rule that will diverge from the first — this names the one test that keeps it from doing so: *did the same write mint this row, or did a person enter it separately, on its own?* A write-off's recovery is his own entered act and blocks the write-off's void until undone in its own right; the payment a recovery-of-a-write-off mints was never entered separately and voids with it. Found working through the nine remaining void-cascade tables (`adjustment`, `offset_record`, `deposit_movement`, `advance`, `advance_settlement`, `write_off`, `write_off_recovery`, `incident_recovery`, `obligation`) one at a time rather than assuming one shape fit all nine. UC-96 |
| **W-62** ⚑ *(added v1.2.12)* | **Ending a daily-lease assignment never refuses on an open driver balance.** Unlike archiving a driver or customer (W-60), which hides him and so must settle first, ending an assignment hides nothing — his own record, his running balance and every past day's figures stay exactly where they were, on his own page and in every report that already includes him. | The two guards look identical from a distance and are not: W-60 blocks because the *party* is about to disappear from every list; here nothing disappears — only future cards stop generating. Refusing would strand the single most ordinary reason an assignment ends — a driver who leaves still owing money — behind a check built to protect against a risk (a receivable silently leaving a report) that does not exist for this action, since nothing about the driver's visibility changes. Decided 15 Aug 2026, closing GAP-25 for Wave 5 Track 5A. UC-101 |
| **W-63** ⚑ *(added v1.2.14)* | **A platform tier approves *business creation*, never accounts.** Invite redemption (UC-03) is always automatic, whatever the requester's own count of businesses. | An invited member is already vouched for by the owner who invited them — routing them past a platform admin too adds a stranger to a decision the business already made, and buys nothing: an identity with no membership is already inert everywhere except UC-08/UC-102 and invite redemption. UC-08, UC-102, UC-103 |
| **W-64** ⚑ *(added v1.2.14)* | **A per-identity allowance gates approval — five businesses by default, adjustable per identity, never shared.** Below the allowance, a new business is created immediately, exactly as UC-08 always has. At or above it, a request queues instead. | Counts businesses where the identity currently holds an active owner/owner-manager membership — never businesses ever created, so leaving one frees a slot rather than permanently consuming it. A fixed constant would have been simpler; a per-identity figure was chosen so a trusted operator's allowance can be raised without a different design later. UC-102, UC-103 |
| **W-65** ⚑ *(added v1.2.14)* | **A platform admin can never read a business's money — no balance, no report, no export, ever.** Not a permission that could be granted; there is no route by which it is reachable. | The single most important line in the platform tier. Cross-business isolation (W-49) already draws a hard boundary between businesses; this draws the same boundary one level up, between the platform and every business beneath it — the moment an exception exists, the guarantee becomes "isolated, except for one role," which is a different product than the one this document promises. UC-103, UC-105 |
| **W-66** ⚑ *(added v1.2.14)* | **One identity, one login, may hold membership in more than one business — including being a linked driver (W-13) in one while a manager or owner in another.** The two are never merged, compared, or visible to each other by any route. | Two logins for one person means two email addresses, an identity provider rejecting the reuse, and manual account administration forever, for no isolation gain — the boundary that matters is `business_id` scope, not which login was used to reach it. Whichever business is selected behaves exactly as if the other did not exist, the same 404-not-403 discipline W-49 already applies within one business, applied again between businesses. UC-104 |
| **W-67** ⚑ *(added v1.2.14)* | **Self-approval, rejection and revocation are always shown as what they are — never hidden, never silently retried.** An admin approving their own request is allowed and flagged as such to every admin reading the log; a rejected requester sees the reason and may request again, once. | Blocking self-approval was considered and declined as pointless at this business's actual size, where the platform admin and the business owner are frequently the same two people — visibility does the work a block would have, without the friction. A rejected requester queueing unlimited retries was the one thing actually worth stopping. UC-103 |
| **W-68** ⚑ *(added v1.2.15)* | **A vehicle loan is recorded at its flat quoted terms, and the finance cost is split proportionally across every payment — never on a per-instalment schedule, and never as a reducing balance.** Sri Lankan leasing companies quote a flat rate and hand over a level instalment; principal, total repayable and term are all on the document the owner holds. Finance cost is the difference between the two, and each payment carries that same fixed ratio of principal to finance whatever its size or timing. | **Reducing-balance is the accounting-standard allocation and was declined deliberately.** It needs a rate solve and produces monthly figures that reconcile against nothing the owner possesses — and this system's promise is being believed about money, which means every figure has to be checkable against a document or a memory. A per-instalment schedule was declined for a different reason: **arrears here are cumulative**, so a partial, late or catch-up payment has no month to index into, and proportional allocation is the only version that survives them. `amortisation_method` exists in the schema with `'flat'` as its only permitted value, so the assumption is visible rather than buried in a formula, and admitting reducing-balance later is a constraint change rather than a restructure. **Immutable once a payment exists** — the finance portion posts as a real expense and money is append-only, so changing the method afterwards would mean rewriting posted records. UC-106, UC-107 |
| **W-69** ⚑ *(added v1.2.15)* | **Repaying loan principal is not an expense, so a lender forgiving principal is not income.** The instalment splits in two: the finance portion is an ordinary cost borne by the business (§6.7), and the principal portion reduces what is owed without ever touching profit. When a lender settles for less than the principal outstanding, the shortfall is recorded as a fact about the loan and **writes no money record at all**. | The symmetry is the whole argument: if paying principal never cost you anything, being let off principal never earned you anything. The lender forgiving 50 means 50 less cash left the building, and profit is untouched because that 50 was never a cost. Booking the whole instalment as an expense was declined — it understates profit badly and permanently, since principal is most of the instalment, and then profit jumps the month the loan ends, looking like performance that is not. **This is explicitly not a W-28 waiver.** W-28 governs *your receivables* — a discount you chose versus a loss you were handed. A lender forgiving *your* debt is a third thing, on the payable side, and forcing it into either bucket would corrupt the one annual number W-28 exists to produce. Recording it as an `adjustment` was also declined: `adjustment.obligation_id` is `NOT NULL` and obligations are money owed **to** you — wrong direction, and a loan has no obligation row. UC-108 |
| **W-70** ⚑ *(added v1.2.15)* | **UC-03's owners-only capital row covers *partner-level* facts — who owns what, who put in what, who is owed what. A business liability and a cash figure are none of those, and a manager sees both.** A vehicle loan's balance, its arrears, and the distributable-cash report (UC-109) sit with the operating facts W-59 already calls a manager's working set. | **The manager pays the instalment, so he must see what is left to pay** — the owner's own reason, recorded here rather than left to be re-derived. An earlier draft called this a deliberate departure from UC-03; that overstated it, and the correction is worth keeping: the matrix was never reaching this far. Its owners-only row names UC-02 and UC-67, both partner-level, and a debt owed by the business to a leasing company is neither. For UC-109 there is a second, decisive reason: **every input is already visible to him** — the cash position (UC-75, W-59), deposits held (§6.13), and now instalments due — so withholding the total would restrict arithmetic, not information. **Seeing is not acting**: recording a `partner_payout` remains owners-only under `managePartnerCapital`. A linked driver sees none of this by any route (W-49). UC-03, UC-106, UC-109 |

---

### 1.2 Two contradictions resolved in v1.2

Both were present in v1.1, both produced wrong numbers rather than missing features, and neither is visible from a single reading — which is exactly what §8's closing note predicted a coverage review would miss.

**A. A charter day was both paused and losable.** UC-06 listed `on charter` among the reasons a day was lost, while UC-30 said the system *"never shows days when the bus was on a charter — those are paused, not missing"* and UC-41 called them *excused*. §7.1's own metrics then counted `lost 4` out of 31 days while 3 days were on charter — treating charter days as **operated**.

Left as it was, a manager working through a backlog would pick `on charter`, and the same day would be both system-paused and manually lost. The lost-days report — the one UC-06 calls *"your only protection"* — would inflate in exactly the direction that matters.

**Resolved:** `on charter` is removed from the pickable list. Charter days are system-set and never chosen by hand. The month decomposes as:

```
days in month  =  not scheduled  +  paused for a trip  +  ran  +  lost
lease-eligible =  ran + lost          ← the denominator for the lost-days report
```

§7.1 checks out: `31 = 0 + 3 + 24 + 4`, lease-eligible 28, ran 24, lost 4, worth `4 × 5,000 = 20,000`.

**B. A pattern would have manufactured lost days.** UC-05 allows an alternate-day or chosen-weekday pattern; §7.1 assumes every day is expected. Nothing said what an off-pattern day is.

**Resolved:** off-pattern days are **not scheduled** — no card is generated, and they count as neither operated nor lost. Otherwise an alternate-day bus reports around fifteen lost days a month, and the report becomes noise the manager learns to scroll past. See UC-05, UC-33, UC-76.

---

## 2. Actors and what each one actually does

| Actor | Reality | What they need from the app |
|---|---|---|
| **Passive owner** (User A) | Owns 2 cars, does not operate them, does not want to do data entry | To open the app once a month and know: what did my cars earn, what am I owed, is anything wrong |
| **Owner-manager** (User B) | Owns the bus, manages all 3 vehicles, handles all money and all data entry | Fast daily entry, zero ambiguity about what he owes and is owed, no bookkeeping vocabulary |
| **Driver** | Operates the bus. In arrangement B he owes you money; in arrangement C you owe him | Exists as a record whether or not he ever logs in. If he creates a profile and you link it (W-13): **view only** — his balance, his past payments, his statement. Never data entry. Optionally a WhatsApp message when you pay him |
| **Customer** | Rents a car or charters the bus | No login. But now a real record — NIC, mobile, address, agreed terms — and WhatsApp messages: confirmation when the lease starts, a reminder when rent is due (W-15) |
| **Platform admin** (added v1.2.14) | Approves who may create a business above the allowance; grants and revokes the role itself. **Not a business role** — belongs above every business, sees none of their money, and may or may not also be an owner/manager of one (W-65) | To see requests, businesses and people **by name only** — never a balance, a report or an export. Group L |
| **The system** | The only participant that never forgets | To prompt, to default, to warn — and to stay silent otherwise |

**The workload is wildly asymmetric.** One person does 95% of the entry, and another person consumes 95% of the reports. Designing for a mythical average user would give you a system that is tedious for User B and confusing for User A. Two different front doors, one set of numbers.

---

## 3. The usability contract

You asked for a system that is not hard to use but still handles the advanced cases. Those pull in opposite directions unless the following are treated as rules rather than aspirations.

**U-1 The 30-second day.** The entire daily obligation — confirm the bus, log a fuel fill — is done from the home screen without navigating anywhere. If the daily routine ever needs a menu, the app has failed.

**U-2 Three levels of visibility.**

| Level | Contains | Shown |
|---|---|---|
| 1 | Amount, date | Always, pre-filled |
| 2 | Litres, odometer, borne-by, note, photo, trip link | Behind one "More" tap; remembers if you use it |
| 3 | Arrangement type, fee waiver, recognition basis, allocation rules | Settings, per vehicle, set once |

Every advanced capability lives at level 2 or 3. **Nothing at level 2 or 3 is ever required to save a record.** That is what lets the same app serve a 3-tap day and a 40-field audit.

**U-3 Never ask what can be defaulted.** Date defaults to today. Amount defaults to the expected figure. Driver defaults to the assigned driver. Vehicle defaults to the one with something pending. Payer defaults to the person tapping. Rates default from the driver's record. The common case should be *confirmation*, not *entry*.

**U-4 One home screen holds the truth.** Everything outstanding appears there: days to confirm, rent due, driver balances, trips in progress, paperwork expiring soon (W-31), and any message that failed to send. If it is not on the home screen, it is not urgent. If it is not urgent, it should not interrupt.

**U-5 Nothing is a one-shot decision.** Every figure can be corrected later, with the change recorded. People enter data while standing at a pump; the app must not punish approximation. This is also why "update the default going forward" (UC-32) matters more than getting the setup perfect.

**U-6 No accounting vocabulary in the interface.** Not "accrual", not "current account", not "allocation". "What the bus earned", "what you're owed", "who owes you". The bookkeeping happens underneath and stays there.

**U-7 Warn, don't block.** The system objects once, clearly, and then lets the user proceed with a reason recorded — except where proceeding would corrupt the numbers (double-counted income, closing a trip with money unaccounted for).

**U-8 Catch-up is normal, not an exception (W-3).** One person records everything, from memory or from what a driver told him, often days late. So: any record can be entered for a past date; a week of days can be dealt with in one pass; nothing expires or locks until the month is deliberately closed; and no screen ever assumes it is being used on the day the thing happened.

**U-9 Anything you send someone becomes a record.** A WhatsApp message about money is evidence in the argument you have three months later. Every outbound message is stored against the driver, customer or due it concerned, with what was said and when. Notifications are never fire-and-forget.

---

## 4. Workflows by rhythm

### 4.1 Daily — Owner-manager, target 30 seconds

```
Open app
└─ Home: "Bus — today — expected 5,000"   [Confirm] [Adjust] [Didn't run]
   └─ Confirm  → done
   └─ Adjust   → keypad pre-filled 5,000 → change → save
                  □ Make this the new daily amount from today
   └─ Didn't run → pick reason → done
└─ Anything else pending appears below, same pattern
```

Fuel, if there was a fill: one tap on the bus, Add fuel, litres and odometer, borne-by already remembered from last time. Ten seconds.

Messages go out on their own (W-14), so nothing about them appears here — unless one **failed**, which shows as a single card with a retry. Success stays invisible.

### 4.2 Per trip — Owner-manager

```
Before   Create trip → dates, customer, agreed amount, driver, his fee
         → system warns the daily lease will pause for those dates → confirm
         → optionally record customer advance and driver advance
During   Add costs as they happen: fuel (litres, odometer), tolls, food, repairs
After    Enter closing odometer → record balance received → pay driver or leave pending
         → trip closes and shows its own profit
```

### 4.3 Weekly catch-up — Owner-manager, 2 minutes
Days missed while away appear as a stack; bulk-confirm at the expected amount, adjust the odd one. Review driver balances. Log any fuel fills reported to you.

### 4.4 Monthly — Owner-manager, 10 minutes
Collect and record car rents, taking each car's odometer reading and settling any excess mileage as you go. Settle or roll driver balances. Close out any lease that has ended. Review each vehicle's month, close the month, and settle up with the other partner.

### 4.5 Monthly — Passive owner, 60 seconds
Open app → a single screen per vehicle: earned, spent, my share, what I'm owed, anything unusual flagged. No entry, no navigation, nothing to maintain.

### 4.6 Occasional — exception handling
Accident, breakdown, customer default, driver change, rate change, new vehicle. These are the moments the app earns its keep, and each is a use case below.

### 4.7 Yearly
Year P&L per vehicle and consolidated. Which vehicle is worth keeping. Renewals coming up.

---

## 5. Use cases

Format: **actor** — trigger — main flow — variations — *what the system does without being asked*.

### Group A — Setup (rare, one-time)

**UC-01 Add a vehicle**
Owner or manager — got a new vehicle. Enter registration, type, and pick its default arrangement (lease out / daily lease / operated). Everything else is optional and can wait — with one exception worth entering now while the documents are in your hand: the **insurance and registration expiry dates** (UC-92). They are the only fields here that cost you money by being blank.
*System:* the arrangement choice decides which screens the vehicle shows later. A vehicle set to "daily lease" gets the daily confirm card; one set to "lease out" does not.

**UC-02 Record who owns it and who put money in**
Owner — at purchase. Add co-owners with percentage shares; record what each person actually paid toward the purchase.
*System:* refuses shares that don't total 100%. Remembers the difference between what someone paid and their share, permanently, without nagging about it.

**UC-03 Bring in a partner or a manager** *(W-49, W-53, W-57)*
Owner or owner-manager — handing operations to someone, or giving a co-owner his own account. Generate an **invite code** for the role — **owner** (reports only, no data entry), **owner-manager** (a second person entering everything), or **manager** (operational, no ownership/capital) — hand it to them however you'd normally reach them; for a manager, grant manage rights on the specific vehicle once they've joined and optionally set the monthly fee.
*How the invitee joins (W-57):* the same shape as a driver's own linking (UC-07) — they redeem the code the first time they sign in, which is also what creates their account if they've never used the app before. Nobody searches for a business by name and asks to see its books.
*Variation:* revoke later without losing anything they entered — access ends, their records stay attributed to them.
*⚑ Correction, 7 August 2026:* v1.2.3 named only "manager, or a second owner-manager" as the redeemable roles — the plain, passive `owner` this project's own two-partner example runs on (§1, CLAUDE.md) had no invite path at all, the identical shape of bug A0 fixed for the business creator. `owner` and `owner-manager` already carry identical capabilities (§2 below); what a passive owner needs is not a new grant, only a way to *get* the account that reads UC-64's reports instead of entering data into them.

**What a manager may and may not do (W-49).** v1.1 named the role without bounding it, which leaves the sharpest questions unanswered: may a manager forgive a debt? See what the vehicle cost to buy?

| | Owner | Owner-manager | Manager | Linked driver |
|---|---|---|---|---|
| Daily cards, trips, expenses, collections | ✓ | ✓ | ✓ | — |
| Start and close leases, close trips | ✓ | ✓ | ✓ | — |
| Write-off (UC-90), waiver above the threshold | ✓ | ✓ | **✗** | — |
| Reverse a receipt (UC-93) | ✓ | ✓ | **✗** | — |
| Close an accounting period (UC-98) | ✓ | ✓ | ✗ | — |
| Ownership, capital, payouts (UC-02, UC-67) | ✓ | ✓ *(own vehicles)* | **✗** | — |
| Messaging config (UC-86) | ✓ | ✓ | kill switch only | — |
| Another driver's data | ✓ | ✓ | ✓ | **✗** |
| Write anything at all | — | — | — | **✗ (W-3)** |

The three refusals for a manager share one shape: **anything that makes money disappear rather than move.** He runs the operation; he does not decide what stops being owed.

*The driver row is the only one that is a security requirement rather than a preference.* A linked driver must be unable to reach another driver's record by any route — a report, an export, a shared link or a crafted request.

**The fee itself (W-53):** a management fee is a **vehicle operating cost** to the owner and **income** to the manager. So it reduces vehicle profit before the owners' shares are worked out, and where the manager is also a partner, consolidated business profit nets to zero on it. UC-64 shows the two sides; UC-67 holds the balance.

**UC-04 Add a driver**
Manager — new driver. Name, phone, his **driver day fee** and **driver trip fee**, licence expiry.
*Variation:* assign him as the default driver for a vehicle for a date range, so trips and daily records pre-fill him.
*On the naming (W-40 companion):* these two are **money you pay him**. The figure in UC-05 is **money he pays you**. v1.1 called both a "per-day rate", which is the same phrase for opposite directions of money — so the two are now named apart and never abbreviated back to "rate" on a screen where both could appear.

**UC-05 Set up the bus's normal arrangement**
Manager — start of the arrangement. Pick the driver leasing it, the pattern (every day / alternate days / chosen weekdays), and the **daily lease amount** he owes per operating day. The cost boundary is fixed by W-7 and needs no per-vehicle decision: fuel, tolls and fines are his; repairs, accidents, tyres, servicing, cleaning, insurance and licence are yours.
*System:* from the effective date it starts raising a daily amount owed by that driver, generates the daily cards **on pattern days only**, and stops at the end date if one is set.
*Days outside the pattern are **not scheduled** (§1.2 B):* no card is generated, and they count as neither operated nor lost. An alternate-day arrangement must not report fifteen lost days a month.
*Individual days remain skippable* (§8), so an irregular arrangement still works without inventing a new pattern type.

**UC-06 Reasons a day was lost** *(W-4)*
Owner or manager — nothing to configure. A day that didn't run is never charged, so the reason carries no money meaning at all. It is picked purely so lost days can be counted and explained: breakdown, driver's day off, driver ill, public holiday, no passengers, other.
*What this deletes:* the chargeable flag, its settings screen, and the per-day override — three things that can no longer be got wrong.
***On charter* is not in that list, deliberately (§1.2 A).** A charter day is paused by the system, not lost by a person — UC-30 hides it, UC-41 excuses it, and §7.1 counts it as operated. If it were also pickable, one day could be both paused and lost, and the report below would overstate in the one direction that costs you.
*What it makes more important:* because a lost day costs the driver nothing, the **lost-days report is your only protection** (UC-76). Four lost days at 5,000 is 20,000 you did not earn, and a driver quietly not running on Fridays should be visible within a month, per driver, with reasons.
*The denominator that makes it true:* `lease-eligible = ran + lost`, excluding not-scheduled days and charter days alike. Both exclusions matter — one for patterns, one for charters.

**UC-07 Give a driver a window into his own numbers** *(W-13, W-42)*
Manager — optional, any time. The driver record already exists and works without this.

**How the two are joined (W-42).** The manager opens the driver's page and generates a **linking code**; the driver enters it when he signs up. Manager-initiated, and only manager-initiated.
*Why not let the driver find himself:* the obvious alternative — the driver searches by his own phone number and claims the record — hands a stranger who knows a phone number the ability to attach himself to a balance. The code costs one extra step, once, and keeps W-3's trust model whole.
*Unlinking* ends his access and touches neither his record nor his history.

From then on he can open the app and see his balance, his past payments, his statement and his excused days — **read only**.
*What does not change:* he still enters nothing. You remain the only person who records anything (W-3), so the numbers stay yours and the trust model is untouched. He gains sight of them, not control over them.
*If he never makes an account:* nothing breaks. He gets the printed slip instead (UC-57), and optionally WhatsApp messages if he gives you a number (Group I).

**UC-08 Create the business** *(W-39, W-54)*
Owner — once, before anything else. Name the business, confirm its **currency** and its **timezone**.

*Why this exists at all.* v1.1 scoped nearly everything to a vehicle, which left three things homeless: a cost belonging to no vehicle (UC-66), the cash position (UC-75), and the partner current accounts (Group G). All three are business-level facts. So a business sits above vehicles, every record belongs to exactly one, and the vehicle is the part that is allowed to be blank.

*What is fixed here and never asked again (W-54):*

| | |
|---|---|
| **Currency** | One, for everything. Set once, not editable from any operational screen |
| **Timezone** | One for the whole business, not per user and not per device. It decides what "today" means on the daily card, when a billing period rolls, and when the 08:00–20:00 sending window opens (W-23) |
| **Period conventions** | Inclusive start, inclusive end. Money in whole minor units, rounded half-up. Any split of an amount hands out the remainder so the parts always add back to the whole |

*Why the last row is not a technicality:* it is what makes §7.3's periods come out as 31, 28, 31 and 30 days, and its 152 / 148 split add back to exactly 300. Leave the convention unstated and half of those numbers move by one.

*Two records are created with it, neither optional.* The settings above, and the **first accounting period** (W-40), open, covering the month you start in. Every record of money has to belong to an open period, so a business without one cannot record a single expense — the app would appear broken on the first thing anyone tried to do.

*One business or several:* one business holds vehicles with **different ownership splits** — shares live on the vehicle (UC-02), not on the business. A passive owner's two cars and an owner-manager's bus are one business, which is what makes UC-64's owned-versus-managed view possible at all. ⚑ *Corrected v1.2.14* — v1.1 through v1.2.13 assumed a single business per identity throughout; that assumption is gone (W-63 to W-67, Group L). An identity may now hold membership in more than one business, but never inside *this* rule — ownership splits still live on the vehicle, within one business, and UC-64's view is still computed one business at a time. Two businesses are never merged, compared, or shown together on one screen, by anyone, including a platform admin (W-65, W-66).

**UC-09 Go live with what you already have** *(W-51)*
Owner-manager — once, on the day you start using the app.

**Nobody starts on the first of the month with an empty fleet.** You start on a Tuesday with a bus already leased, a car already three weeks into a rental, a driver 12,000 behind, and cash in your pocket. Without a way to say so, the only options are to invent history or to accept that every figure is wrong for the first month — and the second is worse, because it teaches the owner not to trust the numbers before the app has earned anything.

*Flow:* set a **go-live date**, then record what is true on that date:

| | |
|---|---|
| **Per vehicle** | Its current arrangement, its odometer, and the terms of any live lease or daily lease — **with the original start date**, so billing periods land on the right day of the month (a lease that began on the 12th keeps billing on the 12th, per §7.3) |
| **Per driver** | Arrears he already owes, anything already owed to him, deposit you hold, advances outstanding |
| **Per customer** | Unpaid dues **with their real original due dates**, so ageing (UC-78) is truthful from day one rather than showing a year of debt as brand new |
| **Cash** | What each partner is holding |

*System:* writes it as one dated opening batch. **None of it is income and none of it is an expense** — it is a starting position, and a P&L for any month must never include it. A statement that starts before go-live shows a single "brought forward" line rather than fabricated days.
*Corrections:* an opening figure stays editable until the first accounting period is closed (UC-98). After that it is an ordinary adjustment like any other.

---

### Group B — Car on monthly rent (arrangement A)

**UC-10 Start a monthly rental** *(W-15, W-16)*
Manager — customer takes the car. Now a fuller form, because the customer will be notified and the mileage will be billed:

| | |
|---|---|
| Customer *(W-55)* | A **person** — name, NIC, mobile, address — or an **organisation** — name, registration number, contact person, mobile, address. Reused next time they rent. A school or a company chartering the bus has no NIC, so requiring one would force a fake number into the field that identifies people |
| Money | Monthly amount, which day of the month it is due, deposit |
| Term *(W-46)* | Start date, term or open-ended. A lease **ends the day before** the next one begins, so a same-day handover belongs to the incoming lease and the changeover day is neither double-booked nor lost |
| **Mileage (W-16, W-19, W-24)** | **Kilometres per day** and the excess rate per km — picked from a few saved packages or entered custom, since terms vary per rental — plus the **odometer reading at handover**. Each period's allowance is then calculated, never typed |
| Reminders | When to message him before the due date — default 3 days, plus on the day |
| **Condition (W-30, W-38)** | Optional photos of the vehicle as it leaves — exterior faces, interior, existing marks. Skippable, but the pair is what gives it value (UC-16), and the set is **sent to him** with the confirmation (UC-80) |

*System:* creates the payment schedule so each month's rent appears as due without being re-entered; marks the car as out; and sends the customer a confirmation on WhatsApp with the agreed amount, due date, included mileage and excess rate (UC-80). That message doubles as a written record of terms — useful the first time someone misremembers the rate.
*If the mileage allowance is left blank*, the rental is simply unlimited and no odometer is needed. The feature stays out of the way when unused.

**UC-11 Collect the month's rent**
Manager — customer pays. Tap the due, confirm amount and date, record who received the cash.
*Variations:* pays part — the balance stays outstanding and ages; pays late — shows on home screen from the due date; pays two months together — one entry covering both dues.

**UC-12 An accident happens** *(W-9, W-10, W-11)*
Manager — customer reports damage. Open the rental, **Report incident**: date, description, photos. The incident stays open for weeks and gathers everything related to it.

**1. Off-road days and the rent (W-9).** Enter the dates the car is unusable. Then choose, for this incident only:

| Choice | Effect |
|---|---|
| **Rent continues** *(default)* | Nothing changes. Safe path, no action needed |
| **Credit the days** | The affected month's rent is reduced pro-rata, with a note pointing at the incident |
| **Extend the rental** | End date pushed out by the lost days — he gets the days back rather than money back |

Extending is usually the better deal for both sides on a monthly rental, and it keeps the monthly figures clean. The choice is recorded on the incident, so a short month always has a visible reason.

**2. Repairs.** One cost or several, entered as they come in over the following weeks, all attached to the incident.

**3. The customer's contribution (W-10).** Negotiated after the repair cost is known, so this is entered late in the sequence: an agreed amount plus a note on what was agreed. Payable in one go, in instalments, or taken from his deposit.
*If it comes out of the deposit (W-44):* the deposit is now partly spent while the lease runs on, and your leverage at closure has quietly shrunk. So a partial application is a deliberate recorded action like any other, the reduced balance is visible on the lease, and **topping it back up is offered at the same moment** — the only point at which he is demonstrably willing to pay.

**4. Insurance, only if it is worth claiming (W-11).** The section is optional to fill in and always visible — leave it blank if the damage doesn't warrant a claim. When you do use it: amount claimed, the excess you bear, status, and the amount actually received. Until it arrives it is **money expected, not money earned** — visible as a pending recovery, never inside the month's profit.

**5. The bottom line.** The incident shows: total repair cost, total recovered, still expected, and **net cost to you**.

*Why this must be a container:* the costs and the recoveries land in different months, sometimes months apart. Without something holding them together, one crash becomes a catastrophic month, an unrelated windfall a quarter later, and no way to connect them. Same instinct you already had for grouping costs per trip.

*Side benefit:* a count of claims per vehicle per year, which is worth knowing at insurance renewal.

**UC-13 Scheduled maintenance**
Manager — service due or something breaks in normal use. Record as a vehicle cost, not tied to an incident. Optionally record odometer.
*System:* uses service history and odometer to remind you next time. **⚑ Decided 15 Aug 2026, closing GAP-68 for Wave 5 Track 5B — the prompt itself had never been specified.** The vehicle carries an optional **service interval, in kilometres**, set on the vehicle's own page and never required to save the vehicle (§3, U-2). With an interval set, the prompt appears there once the latest odometer reading on file has moved past the last maintenance reading by that interval; with none set, there is **no prompt at all**, not a guessed one — the same reasoning W-56 already applies to a report going quiet instead of lying. **Declined: deriving the interval automatically from the gap between the vehicle's last two same-category services.** It predicts nothing until a vehicle has actually been serviced twice through this system — months of the feature staying silently dark for a business starting at zero rows, worse than asking the one person who already knows the manufacturer's figure to type it in once. **Declined: surfacing the prompt on Home.** A service reminder is not time-critical the way an unconfirmed day is, and Home's own item list is already at documented risk of becoming a wall nobody reads to the bottom of — it stays on the vehicle's page, beside its other informational facts.

**UC-14 Read the odometer and charge the excess** *(W-12, W-16)*
Manager — each month with the rent, and again at return. Enter the reading; the system shows kilometres used, the allowance, and any excess at the agreed rate.

Readings arrive by whichever route works that month (W-18), so all three are supported and the entry records **which one it was**:

| Route | Note |
|---|---|
| Photo, requested with the rent reminder (UC-81) | Verifiable, no extra contact — he is already being messaged about money that day |
| Read in person when he comes to pay | Most reliable of the three |
| At return only | Fine, but the whole excess lands in one final bill |

*Why the source is stored:* a photo can be checked later, a number someone told you cannot. When an excess charge is disputed, the difference between "he said 84,000" and a photo of 84,000 is the whole argument.

**The allowance is per billing period and it resets (W-24, W-40).** Each billing period's allowance is *daily limit × days in that billing period*, so a 31-day cycle gets more than a 28-day one without anyone adjusting anything, and a weekly rental gets seven days' worth. Unused kilometres are forfeited at the period end — they do not roll forward, and they never reduce the rent (W-25). **The agreed amount is payable in full whether he drives the full allowance or leaves the car parked.** Mileage only ever adds.

**When a boundary reading is missing** — and it will be — the periods either side are assessed together against their combined allowance, and the per-period split is shown as estimated, apportioned by days. This is safe for one specific reason worth knowing:

> Assessing two periods together can only ever produce **less** excess than assessing them separately, never more. Unused allowance in a quiet period cushions a busy one only when you lack the reading to separate them. So a missing reading always errs in the customer's favour, and you can never over-bill from thin data.

The cost of a gap is therefore money rather than accuracy — which is the right trade, and the reason readings are requested rather than demanded.

*If the rental is extended* (UC-12, UC-16) the added days each bring their own daily allowance automatically — twelve extra days at 100 km is 1,200 more kilometres, with nothing to recalculate by hand.
*A final period cut short* by early termination is allowed only the days actually used, on the same daily basis as the pro-rated rent.

**UC-15 Adjust or waive an amount** *(W-17)*
Manager — whenever a figure needs a human decision. Any due takes an adjustment, plus or minus, with a short reason: goodwill, rounding, agreed discount, late fee, extra charge.

The case you described — 10 kilometres over, an amount too small to bother with — is handled two ways:
- **Automatically:** an auto-waive threshold, set once. Excess below it never appears at all, so there is nothing to tap.
- **Manually:** on anything above the threshold, one tap to waive it in full or in part.

*System:* a waiver is a recorded adjustment, not a deletion. The excess was 340, you waived it, and the month shows both. This matters because **small waivers are invisible individually and material in aggregate** — a "goodwill given" total for the year is one of the more sobering numbers this app will show you.

**UC-16 Close the lease** *(W-26)*
Manager — the car comes back, at term or early. Since an open-ended lease keeps generating dues until told otherwise, closure is a deliberate act with a running order:

**1. Stop the clock.** Set the closing date. No further dues are generated from that moment — the single most important step on an open-ended lease.

**2. Decide the final period.** It is nearly always a part-period, so choose:

| Choice | When it fits |
|---|---|
| **Charge the full period** | He committed to the month; short notice |
| **Charge the days used** | Goodwill, or he gave proper notice |
| **A figure you agree** | Anything negotiated, recorded with a note |

**3. Final mileage.** Closing odometer, the final period's allowance on the days actually covered, and any excess — billable or waived (UC-15).

**4. Show everything outstanding before releasing anything.** A closure summary lists unpaid dues from earlier billing periods, this billing period's amount, excess mileage, and any open incident (UC-12) still awaiting a repair bill or an insurance recovery.
*Why this order and not any other:* **the deposit is the only leverage you have left.** Once it is returned, an unpaid month becomes a phone call rather than a deduction. So the system will not let the deposit be settled until what is owed has been put on the screen — it does not block you, it just refuses to let you do it blind.

**5. Check the vehicle back in (W-30).** If condition photos were taken at handover, take the matching return set; the two appear side by side. Without the handover set there is nothing to compare, which is the whole reason the pair is treated as one artefact rather than two optional features.
*The failure mode to be honest about:* skip the return set and your only baseline is the *handover* set for the next customer. Damage found then cannot be attributed to whoever caused it, and it becomes yours by default. The return inspection is the half people skip and the half that does the work.

**6. Settle the deposit — or hold it briefly (W-29, W-44).** Refund in full, apply part or all against what is owed, or retain a portion for damage, each with a reason. Refunding is not income leaving; it is returning money that was never yours (§6.13).
*What is left to settle may be less than what was taken*, if an accident contribution was already drawn from it mid-lease (UC-12) and never topped up. The figure shown here is the **current** balance with its history, not the original amount — the customer remembers what he handed over, so the difference has to be on the screen rather than discovered in the conversation.
*The hold window:* fines and tolls routinely arrive weeks after a car goes back, and releasing the deposit on the day surrenders the only leverage you have. So the deposit can be held for a configurable window after closure — a fortnight, a month — with the release date shown to both of you and a reminder when it falls due. If nothing arrives, it refunds; if a fine arrives, it offsets (UC-91).

**7. Close out.** Car marked available, a final statement produced for the customer, and a closing message sent with the final figures (Group I).

*Variations:*
- **Extend instead of close** — the schedule simply continues, and each added period brings its own allowance (W-24).
- **He disappears owing money** — close the lease, apply the deposit against the balance, leave the remainder outstanding against the customer, and mark the vehicle recovered or missing. The debt does not vanish because the lease did.
- **An incident is still open** — closure is allowed, but the incident stays open and the summary says so, since the repair bill or insurance recovery may still be weeks away.

**UC-17 Renew at a new rate**
Manager — term ends and the price changes. Same customer, new agreed amount from a date. Old billing periods keep their old figure.
*The date is a billing-period boundary*, not any day you like. Changing the price mid-period would split one period into two differently-priced halves and break the one thing W-25 guarantees — that a period has a single agreed amount.

**UC-18 Keep the mileage packages** *(W-19, W-16)*
Manager — rarely, when terms settle into shapes. W-19 already says rentals are picked "from a few saved packages or entered custom"; this is where the packages come from.

*Flow:* name a package, set its kilometres per day and its excess rate per km. Pick it at UC-10 and both figures fill in; edit either afterwards and the rental keeps its own copy.
*The copy matters more than the package.* A package is a typing shortcut, nothing more. Editing "Standard 100" next year must not reprice a rental agreed under it last year — the terms belong to the rental from the moment it starts, which is also what the confirmation message (UC-80) states in writing.
*Custom stays first-class:* a rental with terms matching no package is normal, not an exception to work around.

**UC-19 Give the customer his statement**
Manager — on request, at closure, or when a figure is questioned. Every due, every payment, every adjustment and waiver, every mileage assessment, deposit movements, and the closing balance.

*Why this was missing and why it matters:* the driver has both a statement (UC-55) and a slip he can hold (UC-57), on the reasoning in W-3 that a single source of truth only works if the other party can see it. **The customer had neither** — a receipt when he pays (UC-82) and nothing that shows a position. He is the party who disputes an excess-mileage charge months later, so he is exactly the one who needs a page reconciling to the figures he was messaged.
*Same content, three ways out:* on screen, printed, or attached to a message (Group I). §8's "a statement on request" is this, and it stays on request — nothing automatic.

---

### Group C — Short hire with driver and fuel (arrangement C)

**UC-20 Take a short hire**
Manager — customer wants a car for three days with a driver. **This is the trip flow, on a car.** Dates, customer, agreed amount, driver and his fee.
*System:* the car cannot also be on a monthly rental for those dates, and it says so before you can create the conflict.

**UC-21 Add its costs**
Manager — during the hire. Fuel with litres and odometer, driver fee, tolls, anything else. Identical to a bus trip.

**UC-22 Close it and see the profit**
Manager — hire ends. Closing odometer, balance received, driver paid or left pending. The hire shows its own profit, the same way a bus trip does.

---

### Group D — Bus on its normal daily arrangement (arrangement B)

**UC-30 See what's pending**
Manager — opens the app. Today's card, plus any earlier days not yet dealt with, oldest first.
*System:* never shows days when the bus was on a charter — those are paused, not missing. Nor days the pattern never scheduled (UC-05). Both are system-set states, and **neither is ever a reason a person picks** (§1.2).

**UC-31 Confirm the day's amount** *(W-1, W-5)*
Manager — end of day, or whenever. One tap confirms the normal case: the driver owed the expected amount and handed it over.

Underneath, the day holds **two** figures that the interface only separates when it has to:

| | Meaning | When it differs |
|---|---|---|
| **Earned** | What the driver owes you for that day | Rate changed, short day, agreed reduction |
| **Received** | What he actually handed over | He paid part, paid nothing, or pays weekly |

Because he hands over cash daily (W-5), both normally equal the expected figure, so the card leads with the one-tap answer:

```
Bus — Tue 30 Jul
Expected from [driver]: 5,000

   [ Paid in full ]      ← one tap, 90% of days
   [ Something else ]    ← received less / different rate / note
   [ Didn't run ]        ← pick a reason (UC-33)
```

**Something else** opens both figures — what he owed, what he handed over — and any shortfall becomes his arrears automatically (UC-35).
*Why the split matters:* if the day stores only one number, you can never tell a cheap day from an unpaid day. The first is a business problem, the second is a debt, and they need opposite responses.

**UC-32 Adjust the amount — and change it going forward**
Manager — the amount received differs from expected. Adjust it for that day. If the change is permanent, tick **"make this the new daily amount from today"** — future cards use the new figure, past days keep what they had.
*Why it matters:* rates drift. Without this, either you re-edit the setup every time (annoying) or the expected figure becomes meaningless (worse, because variance reporting dies with it).

**UC-33 Didn't run today**
Manager — the bus didn't operate. Pick a reason and move on. The day is worth zero to both of you (W-4), so there is no money question to weigh and nothing to configure.

Two things still follow from it. The day counts as a **lost earning day** in the month's total — four of them at 5,000 is 20,000 that never existed, and because it costs the driver nothing, that total is your only protection (UC-06, UC-76). And repeated reasons build a pattern worth seeing: the difference between a bus that breaks down often and a driver who takes Fridays off.

*What this screen is not for.* A charter day and an off-pattern day are both set by the system and never reach this screen (§1.2). If either could be picked here, the same day would be counted twice and the lost-days total — the only number standing between you and a driver quietly taking Fridays off — would overstate in exactly the direction that costs you money.

**UC-34 Log a fuel fill where the driver pays for it**
Manager — driver reports a fill, or you read the odometer at a check. Enter litres, odometer, amount if known, and **borne by: driver**.
*System:* the cost is excluded from your profit — it is not your money — but litres and odometer still feed distance and fuel efficiency. On the bus's monthly view it appears **below** the profit line as "costs borne by the driver", clearly marked as informational.
*Why this is deliberately minimal (W-3, W-20):* the driver pays for his own fuel and has no reason to report litres to you, and no login through which to do it. Chasing per-fill litres here will produce an empty report. Instead:

| Arrangement | What is realistically measurable | What to build |
|---|---|---|
| **A — car on monthly rent** | Distance, and it is **billable** (W-16) | Odometer at handover, monthly with the rent, and at return. Excess km charged at the agreed rate |
| **B — daily lease** | Distance only — his fuel, his receipts | **Optional, never prompted (W-20).** Record a reading if you happen to take one; if you never do, nothing breaks and no report nags. Over-use detection becomes a bonus rather than a feature |
| **C — charters and short hires** | Full fuel efficiency — you buy the fuel and hold the receipt | Litres + odometer per fill, km/l per trip |

Keep the litres field available for arrangement B in case a driver does report it, but do not design a report that depends on it.

**UC-35 Driver falls behind on the daily payments**
Manager — driver pays less than due, or nothing, for some days. Record what was actually received; the shortfall accumulates as **what the driver owes you**, visible on his page and on the home screen.
*Variations:* he clears it later in a lump; he clears it gradually; you write part off; you offset it against money you owe him for a charter (UC-56).

**UC-36 Change the driver, permanently or for a while**
Manager — new driver takes over from a date. The previous assignment ends, the new one begins, and history stays attached to whoever was actually driving.
*Variation — long downtime.* If the bus is off the road for weeks, its driver earns nothing and owes nothing (W-4), which is fair but does not feed him. Two things are possible without breaking his arrangement: assign him to a spare vehicle for a date range, which is just a second arrangement running while the first sits idle; or pay him a retainer to keep him, which is a driver payment tied to no trip (UC-50, W-34). Neither needs new machinery — both matter only once there is a spare vehicle to move him to.

**UC-37 He settles several days at once**
Manager — the driver hands over a week's worth, or clears part of what he is behind.

W-5 says he pays daily and UC-31 admits he sometimes pays weekly, so this is the ordinary case for some drivers rather than an exception. It gets the same treatment as UC-52 in the other direction, because §6.5 makes it a rule rather than a courtesy:

```
Received 30,000 from [driver]
   Tue 14 Jul   5,000   → settled
   Wed 15 Jul   5,000   → settled
   Thu 16 Jul   5,000   → settled
   Fri 17 Jul   5,000   → settled
   Sat 18 Jul   5,000   → settled
   Mon 20 Jul   5,000   → 5,000 of 5,000, settled
                         [Confirm]  [Change allocation]
```

*Oldest first, previewed before saving.* Surplus is held as credit against his coming days rather than sitting as an unexplained overpayment.
*Why the preview is not optional here:* the driver's arrears figure is the number he is most likely to dispute, and "which days did that 30,000 cover" has to be answerable weeks later.

*One thing the ageing report must not confuse (UC-78):* a driver who settles every Friday by agreement is **not** behind on Thursday. An arrangement records whether he settles daily or weekly, and arrears age from the agreed settlement point — otherwise a perfectly reliable weekly payer shows six days in arrears forever and the report stops meaning anything.

**UC-38 Confirm a week in one pass**
Manager — back from a few days away, or catching up on a Sunday.

§4.3 promises the weekly catch-up takes two minutes: *"days missed while away appear as a stack; bulk-confirm at the expected amount, adjust the odd one."* Confirming one card at a time cannot deliver that, and U-8 makes catch-up the normal case rather than the exception — so the bulk action belongs in the design rather than being added later as a convenience.

*Flow:* the stack lists every open day, oldest first, each showing its expected amount. Adjust the odd one individually; then one action confirms the rest.
*What it will not do:* bulk-confirm a day that did not run. That needs a reason, and a reason is a decision somebody has to make (W-4). Days already adjusted by hand are left exactly as they were.
*What the manager sees before it writes:* the list and the total. The same preview discipline as every other bulk money action here (§6.5), for the same reason — the driver may dispute it next week.

*And if the cards were never generated:* they are created on the spot. The days are derivable from the arrangement, the pattern and the rate in force, so nothing about this workflow depends on a background job having run while nobody was watching.

**UC-101 End a daily lease** *(W-62, new, 15 Aug 2026)*
Manager — the driver leaves, the bus is being reassigned outright, or the arrangement itself is simply done.

**Distinct from UC-36.** UC-36 *replaces* the driver — a new assignment opens the same day the old one closes, so the bus never stops earning. UC-101 is for when nothing replaces it: the vehicle goes idle, moves to a different arrangement (UC-94), or the driver relationship itself has ended.

*Flow:* from the assignment's own page, **End**, an end date, confirm.
*System:* frees every future card and future occupancy day already generated for this assignment past that date — the identical rule UC-36 already follows on its own close-and-reopen, applied here to a close with nothing reopening behind it.
*What does not happen:* refusal on money still owed. Unlike UC-100's archive, ending an assignment hides nothing — the driver's own record, his running balance, and every past day's figures stay exactly where they were, on his page and in every report that already includes him. The debt does not vanish because the arrangement did (W-62).
*The driver's deposit, if any, is untouched* — it belongs to him, independent of any one assignment, and is settled on its own terms (UC-58) whenever that comes up separately.

---

### Group E — Bus charter trip (arrangement C)

**UC-40 Allocate the bus for a charter**
Manager — customer books a trip for a date range. Dates, customer, destination, agreed amount.
*System:* warns that the daily arrangement will be paused for those dates and that the expected daily income disappears for them — you confirm, and it does exactly that. If the trip is later cancelled, the daily cards come back automatically.

**UC-41 Assign the driver and agree his payment** *(W-6, W-47)*
Manager — at booking. The bus's lease driver is pre-selected and his **driver trip fee** fills in from his record (UC-04); change either if this trip needs a different driver.
*One driver per trip (W-47).* A relief driver on a long charter is real but uncommon, and supporting two would change how the fee, the advance and the settlement each work. It is named as a limit rather than left ambiguous — if a second driver is needed, he is paid as a driver payment with no trip attached (UC-50), which records the money correctly even though it does not split the trip.
*System:* records the fee as money you will owe him, whether or not you pay it now. The lease days covered by the trip are excused for the regular driver either way — so if someone else takes the charter, the regular driver simply loses those earning days, and his statement shows them as excused rather than as a debt he has to argue about.

**UC-42 Record trip costs and advances**
Manager — before and during. Fuel with litres and odometer, tolls, permits, crew food, en-route repairs. Money handed to the driver up front is an **advance**, not a cost, and is reconciled against what he actually spends.

**UC-43 Customer money**
Manager — advance at booking, balance at the end, or the whole thing afterwards. Partial payments accumulate as owed by the customer.

**UC-44 Close the trip** *(W-41)*
Manager — trip over. Closing odometer, remaining costs, then the trip shows income, costs by type, profit, distance, fuel efficiency, and profit per kilometre.
*System:* will not let the trip close while a driver advance against it is unaccounted for — that is the one place friction is worth it, because unreconciled advances are how trip profit quietly becomes fiction.

**Which month the trip belongs to (W-41).** A charter running 28 July to 3 August has to land somewhere, and v1.1 set a recognition rule for rent (§6.12) while saying nothing about trips. **It recognises on the closing date** — so that charter is August's.
*Why not split it by days:* a trip is one indivisible piece of work with one agreed amount, unlike rent, which is explicitly a payment for a stretch of time. Splitting it would apportion a single negotiated figure across months on a basis nobody agreed to, and would make the monthly numbers disagree with the trip's own P&L for no gain. The trip's profit (above) is unaffected by this either way — it was never a monthly figure.

**UC-45 Trip cancelled**
Manager — customer cancels. Trip marked cancelled, any advance refunded or retained as income, and the daily arrangement resumes for those dates.

---

### Group F — Driver money (both directions)

**UC-50 Pay the driver**
Manager — at or after the trip. One tap on the trip's driver fee, marked paid, done. No allocation needed.
*Not everything is a trip (W-34).* A retainer during a long repair, a bonus, or a goodwill payment is entered the same way with no trip attached, categorised so it is visible for what it is. Forcing every payment to hang off a trip produces invented trips, which corrupts the one report you most want to trust — trip profitability.

**UC-51 Pay part of it**
Manager — pays some now. Record the amount; the remainder stays pending against that trip and appears in the driver's total.

**UC-52 Pay a lump sum covering several trips**
Manager — hands over a round amount. On the driver's page: pending total, number of trips, oldest date. Enter the amount. The system shows what it intends to settle, **oldest first**:

```
Paying 15,000 to [driver]
   Trip #14  12 Jun   8,000   → settled in full
   Trip #17  28 Jun  10,000   → 7,000 paid, 3,000 still pending
                              [Confirm]  [Change allocation]
```

*Variations:* tap Change allocation to pick trips manually; pay more than is owed and the surplus is held as credit against his next trip; he asks which trips a past payment covered and the history shows it.
*Why a preview rather than silent allocation:* the default is right almost always, but a driver who disputes what was settled needs an answer, and the manager needs to have seen it before confirming.

**UC-53 Advance before a trip, settle after**
Manager — gives the driver money for road expenses. Recorded as an advance. Afterwards: what he spent (with receipts or his word), what he returned, and anything agreed to keep as part of his fee. The advance closes at zero.

**UC-54 The same driver owes you and is owed by you**
Manager — the bus driver is behind on daily payments but has just done a charter. Both balances exist. The app shows both plainly, and offers to offset them if you want — never silently (W-2).

**UC-55 Driver statement**
Manager — driver asks, or before paying. Every trip, every payment, every advance, every daily shortfall, and both balances at the bottom.

**UC-56 Offset what he owes against what you owe him** *(W-2)*
Manager — the driver is behind on daily payments and has just finished a charter. His page shows both figures side by side, plus the net as information only:

```
[Driver]
   He owes you        8,000    (6 days of shortfalls, oldest 14 Jul)
   You owe him       12,000    (Trip #21 fee, unpaid)
   ─────────────────────────
   Net: you owe him   4,000            [ Offset... ]
```

Tap Offset, choose the amount (full or partial), and both balances move together in one recorded action with a date and a note. Nothing nets silently.
*Why not one net figure:* an offset is an agreement between two people. If the app performs it automatically, the first argument you have will be "I never agreed my trip fee went against my arrears" — and you will have no record to point at.

**UC-57 Give the driver something he can hold** *(W-3)*
Manager — at settlement. Because the driver has no login, his only view of his position is what you show him: a one-page slip listing the days he owed, what he paid, trips and fees, advances, and the closing figure. Printable or shareable.
*Why this is not optional:* you have chosen to be the single source of truth. That works only if the other party can see the same thing you see.

*Delivery, decided 17 Aug 2026 — the printed slip ships first; the no-login share link does not.* ⚑ The clause above is unchanged and still not optional: what the driver must be able to see is the same figures you see. **Print satisfies that, and a link is one convenience on top of it.** The link is deferred for a reason worth stating plainly rather than as a scheduling note — every route in the client sits behind the login today, and a share link is the first that would not. That is a security boundary being opened, and it carries someone's full financial position; it earns its own deliberate build with W-49's isolation tests, not a corner of a release. **A linked driver already has his own read-only view of exactly these figures (UC-59), so nothing here is unreachable in the meantime** — a driver without a login is handed paper, which is what this use case has always described first. Tracked as GAP-65/A14; mechanics in `user-flows.md` F-6.6.

---

**UC-58 The driver's deposit** *(W-8)*
Manager — at the start of the arrangement. Record the deposit taken. It appears as cash you hold that is not yours, and never as income.
*Later:* refunded in full when he leaves; or applied against arrears he leaves behind — as a deliberate action with a record, not an automatic netting; or topped up if you increase it.
*The error this prevents:* a deposit booked as income inflates the month it arrives and then has to be reversed out of a month that has already been settled and closed.

---

**UC-59 The driver checks his own position** *(W-13)*
Driver, if linked — opens the app. Sees his current balance both ways, every day he owed and paid, his trips and fees, advances, offsets, his deposit, and his excused days. Read only, no totals he can change, no entry anywhere.
*Why this is worth building:* every question he would otherwise ask you at an awkward moment, he can answer himself — and the two of you are looking at the same figures instead of two memories.

---

### Group G — Partner money

**UC-60 I paid for something out of my own pocket** *(W-48)*
Any partner or manager — spends money. Amount, vehicle, category, photo. Who paid defaults to whoever is entering.
*System:* adds it to what the business owes that person, without them thinking about it.

**Two owner questions, not one (W-48).** Every cost answers both, and they are different answers:

| | Question | Default |
|---|---|---|
| **Paid by** | Whose money left the room | Whoever is entering |
| **Borne by** | Who ultimately carries it | Derived from arrangement + category (§6.7) |

*The case that proves they cannot be one field:* the manager fills the bus with fuel out of his own pocket on a day the driver is leasing it. It is **paid by the manager** — the business owes him for it — and **borne by the driver**, so it stays out of your profit (§6.1) and appears below the line. Collapse the two and you must either make it the manager's expense, which is wrong, or the business's cost, which is also wrong.
*Neither field ever needs a tap in the common case.* One defaults to the person holding the phone, the other to the arrangement.

**UC-61 I collected money**
Any partner or manager — takes cash from a customer or driver. Recorded against what it was for.
*System:* notes that this person is now holding business cash.

**UC-62 What did each vehicle make, and what's my share**
Owner — monthly. Per vehicle: earned, spent, profit, my share of it.

**UC-63 Take a payout, or settle with the other partner**
Owner — money moves between partners. Recorded as a payout or a settlement, never as a cost of the vehicle.

**UC-64 Owned vs managed**
Owner-manager — monthly. Two blocks: profit from vehicles I own, fees earned from vehicles I only manage.

**UC-65 Move cash out of your pocket** *(W-27)*
Manager or partner — after a run of daily collections. Record moving held cash into a business account or safe: amount, date, where it went, reference.
*Why it is needed:* every daily handover from the driver and every rent collection adds to what you are holding on the business's behalf. With no way to move it out, the cash position (UC-75) climbs forever and stops meaning anything, which makes the one report that answers "where is our money" the first one people stop believing.
*What it is not:* not income, not an expense, and not a payout to a partner. It is the same money in a different place — a transfer between two spots where business cash can sit. And deliberately **not** called a deposit: that word already means a customer's or driver's security deposit in this system, and the two must never be confused.

*When the bank counts less than you recorded (W-37).* This is where a shortfall usually surfaces — days later, after a week of handovers has been pooled into one bag. And that timing creates a problem no ledger can solve: **you generally cannot tell which handover was short.** So the discrepancy is recorded against the **banking event**, not guessed onto a receipt, with the same two choices about who bears it (UC-93). Only when you can actually identify the receipt — one payment banked on its own, a cheque that bounced — is it corrected at source. Attributing a pooled shortfall to whichever driver comes to mind is worse than admitting it is unattributable.

**UC-66 Record a cost that belongs to no vehicle** *(W-32)*
Any partner or manager — office rent, accounting fees, the yard where vehicles are parked, messaging charges, legal advice, the app itself.
*Flow:* the same expense screen as UC-60 with the vehicle left blank. Who paid it still matters, so it still lands in that person's balance and gets reimbursed like any other out-of-pocket cost.
*How it reports:* shown as a **separate block below the per-vehicle totals**, not spread across vehicles. Consolidated vehicle profit therefore reads honestly as *vehicle* profit, with business profit stated beneath it after overheads. Allocating overhead across vehicles is available as a reporting option, but off by default — a spread figure looks precise while being arbitrary, and the decisions you make from per-vehicle numbers are better made without it.

**UC-67 What each partner has put in and what he is owed** *(W-52, W-53)*
Owner — monthly, and whenever money moves between partners.

UC-02 already records the gap between what someone **paid toward a vehicle** and what he **owns of it**, and promises to remember it "permanently, without nagging". This is the page that gives that promise a consequence — otherwise the figure is stored and never consumed by anything.

*One page per partner, four lines:*

| | |
|---|---|
| **Put in** | Contributions toward purchases, plus anything spent out of pocket (UC-60) |
| **Taken out** | Payouts and settlements received (UC-63) |
| **Earned** | His share of profit, plus any management fee (W-53) |
| **Holding** | Business cash currently in his pocket (UC-61, UC-75) |

**The rule that keeps this honest (W-52):** paying in more than your share buys you a **claim, not a bigger slice**. If A owns half and paid seventy per cent, he is owed the extra twenty back — his share of profit stays at half. The alternative, quietly adjusting the split to match the money, would silently rewrite last year's profit every time somebody paid an invoice, which is precisely what UC-02's effective-dated shares exist to prevent.

*Why it earns its place:* the passive owner's real question is not "what did the cars make" but "what am I owed, and by whom". §4.5 gives him sixty seconds a month, and this is the line he actually reads.

---

### Group H — Insight

v1.1 held these as six one-line entries while the rest of the document leaned on reports it never defined — the lost-days report is called *"your only protection"* (UC-06), the annual goodwill total *"one of the more sobering numbers this app will show you"* (UC-15), and ageing and utilisation appear only in the phasing table. Four of those had no use case at all.

Each report below states its **purpose**, what it **counts**, how it **degrades**, and **who sees it**. The degradation column is not decoration: W-56 makes "not available" mandatory wherever the data is patchy, because a confident wrong number is worse than an admitted gap.

**UC-70 How was this month**
Per vehicle and combined, against last month. Earned, costs, profit, and each owner's share (UC-62).
*Counts:* everything recognised in the accounting period (W-40) — rent for periods falling in it, daily lease amounts by day, trips by closing date (W-41).
*Excludes:* costs borne by others (§6.1), deposits and advances (§6.13), pending insurance recoveries (W-11), and opening balances (W-51).
*Degrades:* never — always computable.
*Sees:* owner, owner-manager, manager for shared vehicles — a vehicle whose `management_fee_agreement` overlapped the reported period (W-59), never the agreement's status today or at the period's end.

**UC-71 Which trips actually made money**
Trips ranked by profit and by profit per kilometre.
*Degrades:* profit per km shows **not available** for any trip with no closing odometer, and that trip is excluded from the ranking rather than ranked at zero.
*Sees:* owner, owner-manager, manager.

**UC-72 Is the bus drinking fuel**
Kilometres per litre over time.
*Counts:* only fuel **you** bought — arrangement C, and any arrangement A or B fill you paid for. His fuel on a daily lease has no litres you can trust (W-20).
*Degrades:* per §7.1 — "not available" for lease days rather than a misleading zero. A month with no complete fill-to-fill pair shows nothing at all.
*Sees:* owner, owner-manager, manager.

**UC-73 How was the year**
Twelve months per vehicle, consolidated, and which vehicle is worth keeping.
*Counts:* the same basis as UC-70, plus the overhead block (UC-66) stated beneath vehicle profit rather than spread across it.
*Sees:* owner, owner-manager.

**UC-74 Who owes us**
Customers behind on rent, drivers behind on daily payments, trip balances outstanding, post-closure charges (UC-91) — one list, largest or oldest first.
*Excludes:* anything written off (UC-90), which is the point of writing it off.
*Sees:* owner, owner-manager, manager.

**UC-75 Where is our cash**
What each partner is holding, what is in each account, and what is out with drivers as advances.
*What counts as held by a driver — narrower than it sounds (§6.13).* **Advances only.** Arrears he owes are a *receivable*, not cash you are holding, and the fares he collected on a daily lease were never yours in the first place (W-1). Putting either in this report would inflate the one number that answers "where is our money" with money that does not exist.
*Also shown:* deposits held (customer and driver), as a **liability against** the cash — so the report separates *cash we have* from *cash that is ours*.
*Sees:* owner, owner-manager, manager.

**UC-76 Lost days** *(W-4, UC-06)*
Per driver, per month, with reasons. **The report UC-06 calls your only protection**, defined here for the first time.
*Counts:* `lost` days out of `lease-eligible = ran + lost`, valued at the daily lease amount in force on each day.
*Excludes, and this is the whole correctness question (§1.2):* days the pattern never scheduled, and days paused for a charter. Include either and the total overstates.
*Shows:* the count, the money it represents, the reason breakdown, and the **weekday distribution** — because "four days lost" and "four Fridays lost" are different conversations.
*Degrades:* never — it is derived from days that must exist.
*Sees:* owner, owner-manager, manager.

**UC-77 Goodwill given** *(W-17, W-28, §6.11)*
Per year: every waiver and adjustment you chose to give, including the ones auto-waived below the threshold and never seen at the time.
*Why it exists:* §6.11's own reasoning — small waivers are invisible individually and material in aggregate. This is the number that tells you what "not worth chasing" cost over twelve months.
*Never pooled with write-offs (W-28).* A waiver is a discount you chose; a write-off is a loss you were handed. UC-90 reports separately, and the two totals appear side by side without ever being summed.
*Sees:* owner, owner-manager.

**UC-78 Who is overdue, and by how long** *(ageing)*
The UC-74 list, bucketed by age — current, 1–30 days, 31–60, 61–90, over 90.
*Ages from the agreed settlement point, not from the calendar (UC-37).* A driver who settles every Friday by agreement is not overdue on Thursday. Get this wrong and a reliable weekly payer sits permanently in a late bucket, at which point nobody reads the report.
*Counts opening balances from their real original due dates* (UC-09), so day one is truthful rather than showing a year-old debt as new.
*Sees:* owner, owner-manager, manager.

**UC-79 How hard is each vehicle working** *(utilisation)*
Per vehicle, per month: days earning, days idle, days off the road, and revenue per available day.
*Counts:* a day is earning if it was on a lease, ran on its daily lease, or was on a trip. Idle is everything else the vehicle could have been doing.
*The comparison it exists to enable:* revenue per available day across arrangements, which is the only honest way to answer whether the bus should stay on its daily lease or take more charters. Both arrangements look good on their own terms; this is where they meet.
*Degrades:* distance-based figures show **not available** without odometer readings; day-based figures always work.
*Sees:* owner, owner-manager.

**UC-109 How much can we safely take out** *(distributable cash, W-70)*
Owner or manager — before money goes to a partner.

Profit stopped being the right number to read the moment loans existed. Paying down a loan and paying an owner both consume **cash**; neither consumes **profit** (UC-63, W-69). A business can be profitable and unable to pay its instalment in the same month.

```
Cash on hand and in bank
  −  security deposits held        money you hold, never yours (§6.13)
  −  loan instalments due          overdue, plus the next one falling due
  =  Distributable
```

*Why deposits come out:* distributing a customer's security deposit as though it were profit only surfaces when he asks for it back, by which time it has been spent.
*Why "plus the next one falling due":* the two failure modes are not symmetric. Being one instalment too cautious means taking out less than you could this month and more next — recoverable, and it costs only timing. Being one too optimistic means an instalment bounces days after the money left, which brings a penalty and damages the relationship with the lender. On a figure whose whole purpose is that someone acts on it immediately, err toward the recoverable mistake.
*Degrades:* **not available**, never zero (W-56). A distributable figure computed from a partial read is the single most expensive wrong number in this document, because someone acts on it by moving money out of the business.
*Undistributed surplus needs no record at all* — it is the gap between the cash position and what has been paid out, and falls out of the reports that already exist.
*Sees:* owner, owner-manager **and manager** — a cash report, not a capital one, and every input is already his (W-70). **Seeing is not acting:** recording the payout itself stays owners-only (UC-67).

---

### Group I — Notifications (W-14)

All of these are **opt-in and per recipient**. Nothing is sent to anyone who has not given a number for it, and every message sent is stored against the record it concerned (U-9).

**Where a setting actually lives.** v1.1 named three scopes without ranking them — per recipient here, per rental in UC-81, per vehicle or per person in UC-86. One order settles it:

```
business default   →   rental or vehicle override   →   recipient opt-in
        (broadest)                                        (always decisive)
```

Each level narrows the one above it, and **opt-in is never overridden by anything**. A business default of "remind three days before" can be changed for one rental; a person who has not opted in receives nothing regardless of what either says. The kill switch (UC-86) sits outside the chain entirely and stops everything.

**UC-80 Customer gets confirmation when the lease starts**
Triggered by UC-10. Vehicle, amount, due day, **kilometres per day and the excess rate**, deposit held. State the *daily* limit rather than this period's total — the daily figure is stable and always true, whereas a monthly total changes with the length of the month and invites exactly the argument the message exists to prevent. Doubles as the written record of what was agreed.
*And carries the baseline with it (W-38).* If condition photos were taken, they go out attached to this message. This is deliberately **not** an approval step: a tap on a confirm button proves a button was tapped, not that anyone examined the photographs, and it costs a reply-handling flow to collect. What actually defeats "that scratch was already there" is that he has held the timestamped set since day one and said nothing. Silence after receipt is the useful evidence, and it is free.
*Worth being honest about the ceiling:* none of this is proof. It is dispute deterrence, which is a different and more achievable thing.

**UC-81 Customer gets a rent reminder**
Configured per rental — default three days before, again on the due day, and once if it goes overdue. The reminder is also where you ask for the odometer photo (UC-14), because he is already being contacted about money that day.
*Stops automatically* when the rent is recorded as received, so nobody gets chased for money they have already paid. Getting this wrong is worse than sending nothing.

**UC-82 Customer gets a receipt**
Optional, on recording a payment. Amount, period covered, balance if any.

**UC-83 Customer gets the closing figures**
On closing a lease (UC-16). Final period charged, any excess mileage, deposit refunded or applied, and the closing balance either way. The message that ends the relationship cleanly — and the one you will be glad exists if he later remembers the deposit differently.

**UC-84 Driver gets told when he is paid**
Triggered when you record a payment to him, an offset, or a deposit refund. Amount, what it settled, and his remaining balance both ways.
*Why this one matters most:* it is the message that prevents "you never paid me for that trip" — and it arrives at the moment the money does, not weeks later.

**UC-85 Driver gets his settlement summary**
Optional, weekly or monthly. Days run, amount owed, amount paid, arrears, trips and fees. The same content as the printed slip (UC-57), delivered without a meeting.

**UC-86 Manager configures what goes out**
Owner or manager — at whichever level applies, per the precedence above. Which messages are on, how many days before a due date, and the sending window. **Sending is automatic (W-14).** Nothing is queued for you to work through. In exchange, three things move from your judgement into the system's rules, all configurable here:
- **Sending window: 08:00–20:00 (W-23)** — a reminder generated at 23:00 waits until 08:00. But **confirmations are exempt**: when you record a payment to a driver standing in front of you, the message that confirms it is worth nothing an hour later. Reminders wait; acknowledgements of something that just happened do not.
- **Language per recipient (W-22)** — English or the local language, set on the person, defaulting to English. Every template is submitted as a matched pair, so nothing is ever sent in a language someone cannot read.
- **Verification before money** — a number is verified by a first successful delivery before any amount is ever sent to it. Amounts do not go to unconfirmed numbers.
- **The kill switch** — one toggle stops all outbound messaging immediately, globally or for one person. The first time something misfires you need a stop button, not a fix.
- **Replies are not handled (W-45)** — and the number says so. People reply to messages about money; that is not a defect in them. But a reply inbox is a support surface nobody here has time to staff, and an unanswered reply reads as being ignored, which is worse than never having messaged. So the number carries an automatic reply saying replies are not monitored and giving a phone number that is. *One sentence of configuration instead of an inbox.*

*Practical prerequisite:* automatic WhatsApp means a Business API account — a registered business number, approval, **pre-approved message templates**, and a per-message cost. Templates take variables but not free prose, so every notification here must be expressible as a fixed sentence with slots. All of the ones in this group are; anything conversational would not be. Prerequisites and lead time are listed below.

**UC-87 The message log** *(W-14)*
Manager — consulted when something is questioned, and when something fails. Because sending is automatic, the log is the only place the truth lives. Every attempt is written to a **separate audit table, append-only, never edited or deleted**, holding:

| | |
|---|---|
| Who and what | Recipient, their number at the time, the record it concerned (which due, which trip, which payment) |
| Exactly what was sent | The template name, its language code, and the final rendered text — not a reference that could read differently later |
| How it went out | Which transport sent it (W-21), so a rollout period leaves no ambiguity |
| Timing | Queued, sent, and each status change |
| Outcome | Sent, delivered, read, or failed with the reason |
| Why | The trigger that caused it, and who or what configured that trigger |

*Read it two ways:* down the log for "what did we send yesterday", or from any due, driver or trip for "what was this person actually told". A statement or a due shows its own message history inline.

**Failures need a home.** An automatic message that fails is a promise silently broken, so failures — and only failures — surface on the home screen with a retry. Nothing else about messaging appears there; success is invisible by design.

**A failed message can take another road (W-33).** Retry, send by another channel — SMS, email — or mark it handled by hand. This matters because a number can be suspended by Meta with no warning and no appeal you control, and every notification here would stop at once. Worth keeping in proportion, though: the **record** never depended on WhatsApp. The statement, the slip and the message log hold it regardless (UC-57, UC-85). What an outage costs you is timeliness, not evidence — so the fallback is worth having and not worth over-building.

**Withdrawal still applies, checked later than before.** The condition is re-evaluated **at the moment of dispatch**, not when the message was scheduled. If the rent arrives an hour before the reminder is due to go, the reminder is cancelled and the cancellation is logged with its reason. A person sending by hand would notice; an automatic sender only will if it is told to check.

**One send per trigger, enforced.** A retry, a restart, or two overlapping schedules must never produce two messages for the same due at the same stage. Duplicated messages about money erode trust faster than silence does.

### Prerequisites before automatic sending can go live

Checked against current guidance in July 2026; verify against Meta's own rate card and policy pages before committing, since these details move.

| Step | Notes |
|---|---|
| Meta Business Manager account and **business verification** | Required for template-based outbound at volume. You can start *before* verification completes — an unverified number is capped at roughly 250 business-initiated conversations per rolling 24 hours, which is far above what this business will generate |
| **Cloud API**, not on-premise | On-premise is being retired; new onboarding in 2026 goes to Cloud API, either direct or through a Business Solution Provider |
| A **clean phone number** | Must receive an SMS or voice OTP, must not already be active on WhatsApp, and VoIP numbers are generally rejected |
| **Template approval, per message per language** | Approval typically ranges from minutes to about two days each. Record the approved template names and language codes — a variable-count mismatch is a common cause of send failures |
| Correct template **category** | Every message in this design is *utility* — a rent reminder, a payment confirmation, agreed lease terms. Keep them strictly transactional: dressing marketing copy as utility to get the cheaper rate is a known rejection trigger, and there is nothing here that needs to be promotional |
| **Opt-in** | Cold messaging is not permitted, which the design already respects — a number is given, then proven by a first delivery (§6.10) |
| Cost | Charged per message or conversation, varying by country and category, plus any provider fees. Utility volumes here are small: a handful of reminders and confirmations per rental per month |

Realistic lead time is one to two weeks. **Nothing in the build waits for it (W-21)** — the triggers, the conditions, the audit log and the failure handling are all channel-independent, so the messaging layer can be finished and tested while approval is in progress.

Sources: Meta WhatsApp Business Platform onboarding guidance as summarised by wappblaster.com, blueticks.co, ominiflow.com and go4whatsup.com, July 2026.

---

### Group J — Losses, late charges and compliance

**UC-90 Write off what you will not collect** *(W-28)*
Manager — a customer has gone, or a driver has quit deeper in arrears than his deposit covers. Write the balance off: amount, party, reason, date.

**A write-off is not a waiver, and they must never share a bucket.** A waiver is a discount you chose to give (§6.11); a write-off is a loss you were handed. Pooling them makes the goodwill figure meaningless and hides the real cost of bad debt. So they are separate categories, reported separately.

*What it does:* clears the balance off the home screen and the receivables list, records the loss against the vehicle it arose from, and keeps the party's history intact — a written-off customer who comes back next year should arrive with that visible.
*What it does not do:* extinguish the debt in reality. If he pays later, that is a **recovery** against the write-off, not fresh income, and the pair should net out in the reports rather than looking like a windfall.

**A write-off can be partial (decided 30 Aug 2026, D2 of the backend accuracy review).** "He'll never pay the last bit" is a real business act, not always the whole balance — the amount entered can be less than what remains outstanding, and the remainder stays a genuine receivable, chased normally, until it is either collected or written off in a later entry of its own. Two write-offs against the same obligation are legitimate, the same way two waivers already are; the balance is only fully cleared once settled, waived and written-off together reach the amount owed.

**UC-91 Charge something after everything has closed** *(W-29)*
Manager — a traffic camera fine, a toll violation or a parking ticket arrives three weeks after the car went back or the charter ended.

*Flow:* log the charge against the **closed** lease or trip. It creates an outstanding balance for that customer or driver even though no agreement is active, and can be sent to them with a photo of the ticket (Group I).

*Who bears it* follows the arrangement, exactly as any other cost does (§6.7): the customer's on a lease, the driver's on a daily lease, and yours on a charter with the option to deduct it from his fee.

*Two things make this survivable rather than merely recorded:*
- **The deposit hold window (UC-16)** — the reason a fine three weeks late is not automatically a loss.
- **A route to write-off (UC-90)** — because a fine against a customer who has vanished usually ends there, and pretending otherwise leaves a permanent phantom on the receivables list.

**UC-92 Keep the paperwork alive** *(W-31)*
Owner or manager — at setup and at each renewal. Hold the expiry dates that matter per vehicle: insurance, registration, revenue licence, permits, emissions, plus the driver's licence already held on his record (UC-04).

*System:* warns ahead of time — 30 days by default — on the home screen (U-4), and keeps warning until the new date is entered.
*And warns again where it actually matters:* when you start a rental or create a trip on a vehicle whose insurance or registration has lapsed. A home-screen widget is easy to scroll past on the one morning it counts; a warning at the moment you are about to send the vehicle out is not. Consistent with U-7 — it warns, records that you proceeded anyway, and does not block you.
*Why this is not just a convenience:* an expired insurance does not merely risk a fine. It converts the next accident from a claim into an absorbed loss, and the incident container (UC-12) will show exactly how much that oversight cost. This is the cheapest feature in the document relative to what it prevents.

**UC-93 A payment that turned out not to have arrived** *(W-36, W-37)*
Manager — a transfer is reversed, a cheque bounces, or the cash counted short of what was recorded. Correct the receipt: amount, date, reason.

**Corrections are partial far more often than total.** A 50,000 handover that counts out at 48,000 needs 2,000 undone, not 50,000. So the amount is editable rather than the receipt being cancelled, and only the difference moves.

**And the difference has to land somewhere — that is a decision, not arithmetic.** Two answers, both real:

| | When it fits |
|---|---|
| **Back to his arrears** | The count was simply wrong and he still owes it |
| **Absorbed as a cash-handling loss** | A note you accepted turned out to be bad, or you cannot fairly push a weeks-old discrepancy onto him |

Defaulting silently to the first looks tidy and quietly turns every counting error into the driver's debt. Which is exactly the sort of thing that costs you a good driver over 2,000.

*What it must undo, all of it:* the due goes back to unpaid or partly paid, the arrears reappear, the customer or driver balance returns to what it was, and the reminder re-arms so he is chased again — the stateful rule (§6.10) running in reverse, which is the direction nobody remembers to build.

*And one thing it cannot undo.* If a receipt was already sent (UC-82), he has been told in writing that you received money you did not. That message stays in the log because the log is append-only, so the reversal records that a correction is owed, and the closing or next message says so plainly. Silently reversing a payment you have already confirmed in writing is how a small banking failure becomes a dispute about your honesty.

---

### Group K — Vehicle and period administration

Six use cases for behaviour v1.1 relied on without specifying. Two of them — UC-94 and UC-98 — are stated premises elsewhere in the document that nothing implemented.

**UC-94 Move a vehicle to a different arrangement**
Owner or manager — the car stops being rented monthly and starts taking charters; the bus comes off its daily lease.

**§1 opens by saying every vehicle can move between the three arrangements over time.** Nothing in v1.1 did it, which made the document's founding premise unreachable.

*Flow:* pick the new arrangement and an **effective date**. The system lists what ends on that date — daily cards stop generating, an open lease must be closed first (UC-16) — and you confirm.
*What must not happen:* history rewritten. A month reported before the change keeps the arrangement that was in force then, including its cost-ownership defaults (§6.7). Otherwise last July's bus report would suddenly show the fuel as yours because the bus is on charters now.
*Why the effective date is a real field:* like every other date here, this gets entered days after it happened (U-8).

**UC-95 See a vehicle's calendar**
Manager — before booking anything.

§6.3 makes "one earning arrangement per vehicle-day" the rule that stops income being double-counted, and v1.1 gave no way to *see* it. The conflict warning fires at the moment you try to create the clash, which is one step too late to be useful for planning.

*Flow:* open a vehicle, see a month with each day showing its single state — not scheduled, on a lease, on its daily lease, on a trip, lost, off the road. Bookings start here.
*It answers the question the trip form cannot:* "is the bus free the week after next." A tentative charter shows as a hold (UC-40), visually distinct from a confirmed one, so an enquiry never silently suppresses a week of expected daily income.

**UC-96 Fix something entered wrongly** *(W-50, W-61)*
Manager — wrong vehicle, a day confirmed twice, fuel logged against the wrong trip, a day confirmed that never actually ran.

U-5 promises every figure can be corrected later. UC-93 covers one specific correction — a payment that never arrived — and ordinary mistakes had nowhere to go.

*Flow:* open the record, edit it or void it, give a reason. Money records are **voided and replaced rather than overwritten** (W-50), so the original stays visible with its correction attached.
*Voiding a record with something beneath it* (W-61) — a write-off with a recovery, an advance with a settlement, a deposit with movements — cascades into whatever that same record minted and refuses, naming the figure, when a separate act sits beneath it: undo that first, in its own right, with its own reason.
*Distinct from UC-93*, which is not a data-entry error at all: there, the entry was right and the money genuinely did not arrive. Different cause, different consequences, different report.
*A voided record never vanishes.* It is the difference between a ledger and a whiteboard.

**UC-97 See who changed what** *(W-50)*
Owner — when this month looks different from what he saw last week.

*Flow:* from any money record — who created it, who changed it, when, and from what to what.
*Why it is not optional here.* §2 describes a deliberate arrangement: one person does ninety-five per cent of the entry and another consumes ninety-five per cent of the reports. That works exactly as long as the second person can answer a question about a changed figure without having to ask the first. Without it, "why is this different" is a phone call every month, and eventually an accusation.
*It is not a suspicion feature.* Most of what it answers is "did I already fix that", asked by the person who entered it.

**UC-98 Close the month** *(W-35, W-40)*
Owner or owner-manager — monthly, per §4.4.

**W-35 is written entirely in terms of "the currently open period" and "a settled month", and v1.1 never defined either.** This is the use case the whole late-facts rule rests on.

*Running order:*
1. **The checklist** — unconfirmed days, trips still open, unreconciled advances, dues awaiting a decision, incidents with no bill yet. It lists and warns; it does not block (U-7).
2. **Review** each vehicle's month (UC-70).
3. **Close** — the accounting period becomes read-only.
4. **Settle** with the other partner (UC-63, UC-67).

*Closing is one-way.* There is no reopen, because **a month that can change after everyone agreed it is not a settlement** — which is the entire premise of W-35. Anything arriving later posts to the open month carrying a reference to the month it belongs to (§6.14).
*An accounting period cannot close while an earlier one is open*, or "the open period" stops being a single thing and every late fact becomes a question.
*And closing opens the next one in the same breath.* Every record of money belongs to an open month, so a close that leaves none stops the business dead the following morning — nothing can be recorded at all. It is also what gives W-35 somewhere to put a late arrival: **a month cannot be settled without a successor for the facts that arrive after it.**
*Which period this is:* the accounting one (W-40). Billing periods roll on their own cycle — a lease billing the 12th to the 11th spans two of these and always will.

**UC-99 Get the numbers out**
Owner — for an accountant, a tax filing, or a bank.

*Flow:* a year of transactions as a spreadsheet, or any statement as a document.
*Respects who is asking (W-49):* a linked driver can export his own statement and nothing else. An export is one of the easier ways to leak past a permission boundary, so it is checked at the same place every other read is.

*Delivery, decided 17 Aug 2026 — the spreadsheet ships; the document is deferred.* ⚑ The two halves of this use case turned out to be work of completely different kinds. **The spreadsheet is an ordinary data dump** and is built as specified. **The document is not**: nothing in the runtime this product is built on can render a PDF — no filesystem, no Node libraries, and a hard CPU ceiling per request (`tech-stack.md` §8) — so it needs either a new dependency inside the money-critical runtime or an outside service that would see every figure on the statement. Neither is a decision to take in passing, and **neither is needed to get the numbers out**, which is what this use case is for: the spreadsheet does that today, and a statement can be printed from the screen that already shows it. Deferred until there is a real, stated need for a document rather than a page — tracked as GAP-136; mechanics in `user-flows.md` F-9.3.

**UC-106 Record a vehicle loan** *(W-68, W-70)*
Owner — the bus or a car was bought on a lease, and the leasing document is in hand.

Every number this needs is printed on that document: the **lender**, the **amount borrowed**, the **total repayable**, the **term**, and the monthly instalment. Interest and charges are the difference between the amount borrowed and the total repayable — one figure covering everything, which is how it is quoted here.

*Flow:* open the vehicle, add a loan, enter what the document says. **Lender, amount borrowed, total repayable and term are enough to save** (U-2); the down payment, the purchase price, the payment day and who carries the liability are all level 2 and never required.
*The split is never asked for.* No receipt breaks a payment into principal and interest, so asking the manager to would be asking him to invent it. It is derived once, from the loan's own two numbers, and applied to every payment (W-68).
*Down payment:* funded by **one named owner**, never split, and written as a capital contribution at registration (W-52) — so a partner who funded a third of the fleet does not show as having contributed nothing.
*Who carries it:* normally the business. When the loan is in a named owner's name instead, his payments are drawings rather than business costs — see UC-107.
*Stated limitation:* **one loan, one vehicle.** A single lease covering two vehicles is not supported, and is recorded as a limitation rather than worked around.

**UC-107 Record a loan payment** *(W-68, W-69)*
Manager — the instalment went out, or a part payment did.

*Flow:* one amount and one date. Nothing else is asked.
*System:* splits it by the loan's own fixed ratio, in one transaction — the principal share reduces what is left to pay and **never touches profit**; the interest share posts as an ordinary cost against the vehicle, borne by the business in every arrangement (§6.7). Because it is an ordinary cost, it flows into vehicle profit, owner shares and every existing report with no report changes at all.
*What he sees afterwards:* **"Remaining to pay"** — the figure on the lender's letter, starting at the total repayable and falling by the full payment. Interest and principal outstanding are internal.
*Behind by:* instalments due since the loan started, less everything paid. One subtraction, derived on read, no cron and no stored counter (U-8 — this gets entered days late like everything else). A part payment simply leaves a smaller gap. **Not modelled:** which specific month was missed, and penalty interest — a late fee is recorded as another payment or an ordinary cost.
*Refused, and told why:* a payment against a closed loan, and a payment larger than what is left to pay. The second points at UC-108 instead, because an overpayment is either a settlement or a mistake and guessing which one silently is worse than asking.
*When the loan is in an owner's name* (UC-106): the whole payment is a drawing against that owner, landing in his "Taken out" line (UC-67), and **no cost is recorded** — it is not the business's expense. The balance is tracked as a memo.
*Paid from business cash only, in this version.* A partner paying an instalment personally is refused, and the refusal is honest rather than a simplification: reimbursement runs through the cost's own paid-by field, so he would be repaid only the interest share of what he actually handed over — silent, and wrong in the direction that costs him money. The correct treatment is two records, and it is designed but deliberately not built yet.

**UC-108 Settle a loan early and close it** *(W-69)*
Owner or manager — the leasing company quoted a figure to close the loan today.

*Flow:* enter the quoted figure and the date. The loan closes.
*System:* whatever the settlement exceeds the principal still outstanding is this final payment's interest — the normal case. If the settlement is **less** than the principal outstanding, the lender has forgiven the difference: interest is zero, the shortfall is recorded as **waived by the lender**, and **no money record is written at all** (W-69).
*Prior months stand as posted.* A closed month is never rewritten; the closing payment absorbs the truth. Because the full interest is never booked in advance, settling early simply means total interest lands below the quoted figure — there is nothing to unwind.
*Voiding a settlement reopens the loan* and voids its interest cost with it. Otherwise a mistaken settlement leaves a loan permanently closed with a live balance.
*Retiring a vehicle that still has an open loan warns, and never blocks.* The debt outlives the vehicle.

**UC-100 Archive a driver or customer entered by mistake** *(W-58, W-60)*
Manager — a duplicate driver, a test customer, a party who genuinely stopped doing business with you.

W-58 already promises he is never hard-deleted. This is the other half: a way to stop seeing him everywhere without pretending the history he's part of never happened.

*Flow:* open his record, **Archive**, give a reason, confirm — the same reason discipline W-50 already requires of a money void, since this is the one place archiving touches the audit trail.
*Refused if any money is still open* (W-60) — a due he owes, an advance still unreconciled, a deposit still held. The refusal **names the figure**, so the next step is obvious: settle it, then archive.
*What archiving does:* he drops out of every picker and every "add a new record" list. Every past record that already names him — a closed month's expense, last year's rental — keeps rendering exactly as it always did; a closed month's totals never move because someone archived a driver a year later.
*Unarchive* puts him back in every picker. Nothing about his history changed while he was gone, so there is nothing to reconcile on the way back.

---

### Group L — Platform administration (added v1.2.14)

**Not a business role.** Every use case below sits *above* the business, run by an actor who may or may not also be an owner or manager of one (§2). Nothing here ever reads a balance, a report or an export (W-65) — the platform tier's whole job is deciding who may create a business and who may drive for more than one, never what any business is worth.

**UC-102 Request to create a business** *(W-63, W-64)*
Anyone signed in — their first business, or an additional one. Name it, confirm its currency and timezone — the same fields UC-08 has always asked for.
*System:* below the requester's allowance (five active owner/owner-manager memberships, by default — W-64), the business is created immediately, exactly as UC-08 always has, and nothing about the existing flow changes. At or above it, nothing is created yet: a request is held, and the "get started" screen renders it as **"being reviewed"** rather than offering the create form again, which would otherwise collide with the one-request-at-a-time rule below.
*What is never gated:* redeeming an invite (UC-03) — see W-63.

**UC-103 Approve or reject a business-creation request** *(W-63, W-65, W-67)*
Platform admin — when a request is queued. Approve, which runs UC-08 exactly as it would have run unqueued, or reject with a reason the requester will see.
*What decides this:* the requester's name, their email, and how many businesses they already hold — never anything from inside a business (W-65).
*A rejected requester may request again* — the reason stays visible on the retry, and only one request may be outstanding at a time (W-64's own index, `data-model.md` §3).
*Self-approval* (W-67) is allowed and always rendered distinctly from an arms-length decision, to every admin reading the platform log.

**UC-104 Switch between businesses** *(W-66)*
Anyone who belongs to more than one business, or who is a linked driver in one while holding a different role in another. Pick which business is active; from that moment every screen, every report and every write belongs to it alone, until switched again.
*System:* the two are never compared, combined or shown side by side, by anyone. Access revoked from one is invisible the next time that business is opened, exactly as if it had never existed — no notice, no trace, consistent with W-67's disclosure line stopping exactly at "revoked," never "by whom."
*A linked driver in two businesses* (W-66) experiences the same mechanism from underneath: his balance in the business not currently selected is unreachable by any route — a report, an export, or a shared link — the identical boundary W-49 already draws for one business, redrawn between businesses.

**UC-105 Grant or revoke platform admin** *(W-65, W-67)*
Platform admin — rare, ongoing. Grant the role to another signed-in identity, or revoke an existing admin.
*System:* the platform always holds at least one active admin — revoking the last one is refused, never merely warned, the same shape `user-flows.md` INV-31 already takes for a business's last owner, one level down. Every grant and revoke is logged: who did it, to whom, and when.

---

## 6. Cross-cutting behaviours

**6.1 Borne-by is a property of every cost.** Ours, the driver's, or the customer's. Only ours affects profit; the others are recorded for information and shown below the line. This one idea handles the driver's fuel in arrangement B, a customer's contribution after an accident, and anything similar you meet later.

**And it is not the same as who paid (W-48).** Every cost carries **borne by** and **paid by** as two fields, because the manager buying the driver's fuel out of his own pocket is both an out-of-pocket cost owed back to him (UC-60) and a cost borne by the driver (below the line). One field cannot express that, and choosing either answer alone is wrong. Both default — paid-by to whoever is entering, borne-by to the arrangement — so the common case still needs no tap.

**6.2 Expected and actual both persist.** Confirming a day never erases what was expected, which is what makes "you're running 12,000 behind this month" possible. Changing the expectation going forward is a separate, deliberate action (UC-32).

**6.3 One earning arrangement per vehicle-day.** Enforced, with a warning at the moment of conflict rather than a wrong number at month end.

**6.4 Drivers have two balances, never silently merged (W-2).** What he owes you (daily shortfalls) and what you owe him (trip fees, unspent advances). The net is shown as information; moving money between the two is an explicit, recorded action.

**6.5 Oldest-first with a preview.** Any lump payment — to a driver, or from a customer — proposes the oldest outstanding items first and shows what it will settle before saving.

**6.6 Containers for things that generate scattered costs.** A trip is one. An accident is another. Anything that produces several costs over several weeks and needs a single answer at the end deserves the same treatment.

**6.7 Every cost has a default owner, derived not asked (W-7).** The manager should never have to think about who bears a cost — the arrangement and the category already determine it. Defaults, all overridable on the individual record:

| Category | A. Lease out (car monthly) | B. Daily lease (bus) | C. Operated (charter, short hire) |
|---|---|---|---|
| Fuel | Customer | **Driver** | Us |
| Driver cost | Customer | n/a — he is the operator | Us |
| Tolls | Customer | **Driver** | Us |
| Fines | Customer | **Driver** | Ours, with a one-tap option to deduct from his fee |
| Cleaning | Customer's while he has it; ours between rentals | **Us** | Us |
| Tyres, servicing | Us | Us | Us |
| Repairs, accidents | Us | Us | Us |
| Insurance, licence | Us | Us | Us |
| Interest and charges on a vehicle loan | **Us, always** | **Us, always** | **Us, always** |

**One row does not flip, and it is the only one (added v1.2.15, W-68/W-69).** Every other line above answers "who was using the vehicle when this cost arose"; the finance cost on a vehicle loan answers "who borrowed the money", and that is the business in all three arrangements. A customer leasing the car has no relationship with the lender, and the bus driver's daily lease is not a sublease of the debt. Stated as a row rather than left to inference because the table's own shape invites the question, and an override here would be a data-entry error rather than a legitimate variation.

Note how tolls flip between arrangements — his on a daily lease, ours on a charter. That is exactly why borne-by is a property of the cost rather than a property of the category, and why deriving the default from the arrangement removes the taps instead of adding them.

**6.8 Earned and received are different facts (W-1).** Every day the driver operates raises an amount he owes; every handover records what arrived. They coincide most days and the interface collapses them into one tap when they do. They must never be collapsed in storage, or a cheap day and an unpaid day become indistinguishable. The same distinction already applies to car rent (rent due vs rent received) — one rule, two places.

**6.9 One odometer mechanism, three purposes (W-12).** A reading is always the same thing — date, vehicle, kilometres, and how it was obtained (W-18). What differs is what it is *for*: billable excess on a car rental, oversight on a bus lease, efficiency on a charter. Every reading is optional, and the reports degrade to "not available" rather than to zero, so patchy data never produces a confident wrong number. The one reading that carries real weight is at a **period boundary in arrangement A**, because that is where an allowance resets and an excess crystallises.

**6.10 Automatic messaging needs four guarantees (W-14, U-9).** With nobody watching at send time, each of these has to be structural rather than a matter of care:

| Guarantee | Why |
|---|---|
| **Opt-in and verified** | A number is given, never assumed, and proven by a first delivery before any amount is sent to it |
| **Re-checked at dispatch** | The reason for the message must still be true the instant it goes, not merely when it was scheduled |
| **Exactly once per trigger** | Retries and restarts must not duplicate. Duplicate money messages erode trust faster than silence |
| **Fully audited** | Separate append-only log: recipient, rendered text, timings, delivery outcome, and the trigger. Never edited, never deleted |

Plus a kill switch that stops everything immediately, because automation's first bad day should cost you a toggle rather than a deployment.

All four hold regardless of which channel actually carries the message (W-21). The transport is the only replaceable part; the triggers, the conditions and the log are not.

**6.11 Small amounts should disappear by themselves (W-17).** You told me you would ignore 10 kilometres of excess rather than bill it. So the app should ignore it for you: a threshold set once, below which an excess never surfaces. Above it, a one-tap waiver. Either way it is recorded as waived rather than erased — individually trivial, collectively worth seeing once a year.

**6.12 Money is per billing period; kilometres are per day (W-25).** It is tempting to conclude that the whole system prices by the day, because so much of it does. That is wrong for rent, and the distinction is worth stating as a rule, because anyone building this will otherwise make the two consistent and introduce a bug:

| | Basis | February behaviour |
|---|---|---|
| **Rent** | A fixed amount for the period, regardless of its length | The agreed amount, unchanged |
| **Mileage allowance** | Daily limit × days in the period | Smaller, because February is shorter |

So a short month costs the customer the same and allows him less. That looks like an inconsistency and is not one: he is buying a month of access to the vehicle, and separately being allowed a distance that accrues while he has it.

Two corollaries:
- **Mileage is one-directional.** Driving less than the allowance produces no refund, no credit, and no carry-forward. It only ever adds an excess charge.
- **Pro-rating for reporting is a different thing from pro-rating a bill.** Splitting a period's rent across two calendar months for monthly profit reporting (the recognition rule in the requirements spec) does not change what the customer is charged, which stays the whole agreed amount for the whole period.

The bus daily lease is genuinely per-day, and a closed-off final period *may* be pro-rated if you choose (UC-16) — but that is a decision at the time, not the default arithmetic.

**6.13 Money you hold is not money you earned.** Three kinds of it now exist in the system — a customer's rental deposit, the bus driver's deposit, and an advance handed to a driver for road expenses. All three follow one rule: recorded as held, never as income, visible in the cash position (UC-75), and released only by a deliberate action with a reason. Returning any of them is not a cost; it is handing back money that was never yours. Booking any of them as income inflates the month it arrives and then forces a reversal out of a month you have already closed and settled.

**6.14 Facts arrive late (W-35).** The most useful thing an outside review told us was structural rather than specific: the two holes it found — a fine arriving after the deposit was refunded, and damage disputed after the car went back — are the same shape. An obligation surfaces *after* the record it belongs to was closed. That is a class, not two incidents, and naming it is worth more than patching each instance:

| Late-arriving fact | Handled by |
|---|---|
| Traffic fine or toll after closure | UC-91, plus the deposit hold window (UC-16) |
| Repair invoice weeks after the work | The incident container (UC-12) |
| Insurance settlement months later | Pending recovery, never income until received (UC-12) |
| Arrears found after a driver has gone | Write-off, with recovery if he later pays (UC-90) |
| A recorded payment that never actually arrived | UC-93 |
| Damage found at the *next* handover rather than at return | Only attributable if a return set exists (UC-16) — otherwise it is yours |
| An odometer reading corrected after an excess was billed | Provisional-then-final reconciliation (UC-14) |

The general rule: **a late fact posts to the accounting period that is open now, carrying a reference to the accounting period it belongs to.** It never silently reopens a settled month, because a month that can change after everyone agreed it is not a settlement. And a closed lease, trip or driver relationship can always receive a *new* charge — what it can never receive is a quiet edit to what it already said.

*This rule has a precondition that v1.1 left unbuilt:* something has to define which period is open. That is UC-98, and without it the rule above has no subject.

**6.15 "Period" is two words (W-40).** They coincide only by accident, and W-35 is written in terms of one of them:

| | **Billing period** | **Accounting period** |
|---|---|---|
| What it is | One cycle of a lease — 12 Jan to 11 Feb | One month of the business — 1 July to 31 July |
| Set by | The customer's agreement (UC-10) | The calendar |
| Governs | Rent charged, mileage allowance (W-24, W-25) | What is reported, closed and settled (UC-70, UC-98) |
| Ends when | The cycle rolls, automatically | Somebody closes it, deliberately |
| Reopens | n/a — the next one just starts | **Never** (W-35) |

Two consequences fall straight out. A billing period routinely **spans two accounting periods** — a lease billing the 12th always will — which is exactly what §6.12's note about pro-rating for reporting is describing. And "the currently open period" in W-35 always means the **accounting** one; a billing period is never open or closed, it simply passes.

*Read every occurrence of the bare word "period" in an older document as ambiguous until checked.* That is the reason the two are named apart here rather than left to context.

**6.16 The conventions that decide the arithmetic (W-54).** Unstated conventions are where off-by-one bugs live, and three of this document's worked figures depend on them:

| | Rule | What depends on it |
|---|---|---|
| **Period boundaries** | Inclusive start, inclusive end. Days = end − start + 1 | §7.3's periods being 31, 28, 31 and 30 days |
| **Money** | Whole minor units, never a fraction. Rounded half-up | Every total in §7 |
| **Splitting an amount** | The parts always add back to the whole; the remainder goes to the largest fractional shares | §7.3's 152 / 148 adding to exactly 300 |
| **Distance** | Whole kilometres. A reading lower than the last one warns rather than blocks — clusters get replaced and figures get mistyped | UC-14 |
| **Time** | One business timezone. "Today", the billing cycle and the sending window all use it | UC-31, UC-86 |

Only the first three change any number in this document, and all three change §7. Which is the argument for stating them: the walkthroughs are the specification that cannot argue back, and they are only reproducible if these are fixed.

---

## 7. Worked walkthroughs

Three end-to-end narratives, each exercising the rules above against real figures. They exist to prove the model reconciles, and to be the thing you check a future change against.

### 7.1 One month of the bus

A single narrative that exercises every rule above. Bus leased to its regular driver at 5,000 per operating day, July, 31 days. Deposit of 25,000 held (W-8).

| Days | What happened | Owed by driver | Received |
|---|---|---|---|
| 23 | Ran normally, cash handed over each evening | 115,000 | 115,000 |
| 1 | Ran but handed over 3,000 — short | 5,000 | 3,000 → 2,000 arrears |
| 2 | Bus broke down | 0 | 0 |
| 1 | Driver took a day off | 0 | 0 |
| 1 | No passengers | 0 | 0 |
| 3 | Bus on charter — arrangement paused | 0 | 0 |
| **31** | | **120,000** | **118,000** |

Note where the arrears come from now: **a day that ran and was underpaid**, not a day that didn't run (W-4). Lost days cost him nothing.

The charter, over those 3 paused days, driven by the regular driver:

| | |
|---|---|
| Customer agreed amount | 60,000 |
| Fuel — ours on a charter, litres and odometer recorded | 22,000 |
| Tolls and crew food — ours here, his on lease days (W-7) | 3,000 |
| Driver's trip fee | 9,000 |
| **Trip profit** | **26,000** |

Plus a 12,000 repair from the breakdown — a vehicle cost, attached to no trip.

**The bus's July:**

| | |
|---|---|
| Earned | 120,000 lease + 60,000 charter = **180,000** |
| Received | 178,000 — the 2,000 gap is arrears, not a loss |
| Costs | 22,000 + 3,000 + 9,000 + 12,000 = **46,000** |
| **Net profit** | **134,000** |
| Fuel and tolls he paid across his 24 operating days | below the line, informational — never inside the 46,000 |
| His 25,000 deposit | cash you hold, not income, not in any of the above |

**The driver's July**, two balances, unmerged (W-2):

```
He owes you     2,000    (short on 12 Jul)
You owe him     9,000    (charter fee, Trip #21)
────────────────────────
Net: you owe him 7,000              [ Offset... ]
```

One tap on Offset settles the 2,000 against his fee and you hand him 7,000. The deposit stays untouched — it is not a debt-collection tool unless he leaves owing money. His statement (UC-57) shows the lot, including the four lost days, so nothing needs re-explaining next month.

**And the metrics that fall out:** operated 27 days of 31, lost 4 — two to breakdown, one to his day off, one to no passengers. Those four days are **20,000 of lease income that never existed**, and since they cost him nothing, that number is the one thing standing between you and a driver who quietly takes Fridays off.

*The decomposition behind those figures (§1.2):* `31 = 0 not scheduled + 3 paused for the charter + 24 ran + 4 lost`. The lost-days report divides by **lease-eligible days — 28, not 31** — because the three charter days were never his to run. Counting them as lost would have shown 7 lost days and 35,000 of phantom loss, which is precisely the error §1.2 A exists to prevent. Distance for the month from odometer readings at settlement; fuel efficiency for the charter only, because that is the only fuel you bought — the report says "not available" for lease days rather than showing a misleading zero.

That is the whole model working end to end: three arrangements, one earning source per day, two driver balances, borne-by keeping his costs out of your profit, a deposit that is never income, and lost days that cost money without creating debt.

### 7.2 One accident

Car on 70,000 per month. Accident on 8 July, off the road 12 days.

| Event | When | Amount |
|---|---|---|
| Body work | invoiced late July | 70,000 |
| Parts | invoiced early August | 25,000 |
| Insurance claim submitted (major damage, so worth claiming) | July | 75,000 claimed, 15,000 excess ours |
| Insurance settlement received | September | 60,000 |
| Customer contribution, negotiated once the cost was known | agreed August, paid over two months | 20,000 |
| Rent treatment chosen | — | **Extend the rental by 12 days** |

**Incident bottom line:** 95,000 spent, 80,000 recovered, **net cost to you 15,000**. No revenue lost — the 12 days were given back as time rather than money.

**What this looks like month by month, and why the container matters:**

| | July | August | September |
|---|---|---|---|
| Repairs | 70,000 | 25,000 | — |
| Recovered | — | 20,000 (customer) | 60,000 (insurer) |
| Pending recovery shown | 60,000 | 60,000 | — |
| Rent | normal | normal | normal, term now ends 12 days later |

Without the incident, July reads as a disaster, September as an unexplained windfall, and nothing connects them. With it, July's report shows the hit alongside **60,000 pending recovery**, so the month is visibly temporary rather than alarming — and the true cost of the crash, 15,000, is a single number you can find a year later.

### 7.3 Mileage on an open-ended rental

Car let open-ended from 12 January, billed monthly, so **billing periods** (W-40) run the 12th to the 11th — inclusive at both ends, which is what makes the day counts below come out at 31, 28, 31 and 30 (§6.16). Limit **100 km per day**, excess **25 per km**. No end date — periods simply keep rolling.

| Period | Days | Rent | Allowance | Driven | Mileage result |
|---|---|---|---|---|---|
| 12 Jan – 11 Feb | 31 | 70,000 | 3,100 | 3,240 | 140 over → **3,500 charged** |
| 12 Feb – 11 Mar | 28 | 70,000 | 2,800 | 2,650 | Under → **nothing**. The unused 150 km is forfeited and the rent is unchanged |
| 12 Mar – 11 Apr | 31 | 70,000 | 3,100 | *no reading taken* | assessed with the next period |
| 12 Apr – 11 May | 30 | 70,000 | 3,000 | 6,400 across both | Combined 6,100 → 300 over → **7,500 charged**, split ≈152 / ≈148 km and marked estimated |

The rent column never moves (W-25). The allowance column does. That contrast is the whole rule in one picture: he pays for the month, not for the kilometres, and kilometres can only ever cost him extra.

Three things to notice, all of which fall straight out of the daily basis and none of which needed a rule of their own:

- **February is smaller and nobody did anything.** 28 days at 100 is 2,800. No monthly figure to remember, adjust, or argue about.
- **The missing reading cost you money, not accuracy.** Combining the two periods gave 300 km of excess. Had a reading existed and the usage been lumpy, it could only have been the same or more — never less. The gap quietly favours the customer, which is why the reading is requested with the reminder but never blocks anything.
- **An accident extension needs no arithmetic.** Extend the rental twelve days after a repair (UC-12) and the billing period gains 1,200 km on its own.

And the message he received on day one said *"100 km per day, 25 per km beyond"* — stable, true in every month, and the thing you point at when a bill is questioned.

## 8. Confirmed decisions and remaining settings

### Accepted as proposed

You confirmed the proposed defaults, so these are no longer open:

| | Confirmed |
|---|---|
| Fine on a charter | Ours, with a one-tap option to deduct it from the driver's fee |
| Cleaning on a car rental | The customer's while he has it; ours between rentals |
| Alternate-day pattern | A nameable pattern (every second day, or chosen weekdays), with individual days skippable so irregular arrangements still work |
| Deposit mechanics | Fixed amount per driver, refundable in full unless he leaves owing, top-up and reduction both recordable |
| Short-hire drivers | Same driver pool as the bus, paid on the same driver day fee or driver trip fee basis (UC-04) |
| Monthly car rental | No fuel included. Mileage limited per day (W-24), never unlimited unless the limit is left blank. **Rent is the agreed billing-period amount regardless of mileage used (W-25)** |
| Customer **documents** | A receipt when they pay, a statement on request (UC-19). Nothing automatic — this concerns *documents*. **Messages** are a separate thing and are automatic per Group I (W-14), including the receipt at UC-82. v1.1 stated these next to each other without distinguishing them |
| Cover while you are away | Everything waits and is caught up later, per U-8. No second recorder |
| Frequency assumption | Bus confirmed daily, a charter every week or two, car rents monthly, accidents a few times a year, new vehicles rarely. The home screen is ordered accordingly |

### Values to fill in, not decisions to make

| | |
|---|---|
| **Local language** | **Closed 31 Jul 2026 — Sinhala.** The second language templates are submitted in, and the font subset that ships (W-22, UI §5.2) |
| **Excess-mileage waive threshold** | The figure below which an excess never surfaces (§6.11). **A blank now means zero — waive nothing (W-43).** v1.1 left it with no default at all, and the dangerous reading was the other one: a system where forgetting to fill in a number silently forgives every excess charge |

Everything else in this document is settled across the 56 logged decisions — the original 38, plus the 18 added in v1.2 and marked ⚑ proposed (§10).

### Provenance of W-27 to W-36, and what the review could not see

These eight came from an external operational review of this document rather than from our own working through it, and they are marked here so a future reader knows they were bolted on rather than grown. Two were genuine holes: **post-closure charges** (UC-91), which no amount of process discipline covers, and **write-off as distinct from waiver** (UC-90), which would otherwise have quietly poisoned the goodwill figure. Two were absent from *this* document but already decided in the requirements spec — costs with no vehicle (UC-66) and paperwork expiry (UC-92) — so incorporating them removed a discrepancy between the two documents rather than adding anything new. The rest are small and sound. One recommendation was hazardous as written: naming the cash-transfer use case "bank a deposit" would have collided with the one noun this money model cannot afford to blur, since a deposit here is money held and never income (§6.13). The substance was right; the label would have produced exactly the confusion the rule exists to prevent.

**W-35 and W-36 did not come from the review** — they came from generalising its two best findings. Both were about an obligation surfacing after a record was closed, which is a class rather than two incidents (§6.14). Once named, the class produced a hole neither of us had spotted: a payment recorded as received that never actually arrived (UC-93).

**What a coverage review structurally cannot find.** Every item in that review had the same shape — "the document mentions X and Y but not Z, here is Z". That method finds absences, and it found real ones. It cannot find contradictions between two things that are both present, it cannot tell whether an outcome is already achievable by composing existing pieces (it proposed building temporary driver reassignment, which two existing rules already give for free), and it cannot judge whether an existing decision is *wrong* — all eight items were additive, and none questioned a decision already taken. Two of its findings were also absences from *this* document rather than from the design, since the requirements spec already covered them; a reviewer with one document cannot tell those apart, which is worth remembering when commissioning the next review. Treat a coverage pass and a consistency pass as two different jobs, because they are.

### Provenance of W-63 to W-67, and what the platform-admin design declined

These five came from a dedicated design pass (`PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md`, two independent validation passes plus a third against the code graph, decisions 1-29), not from working through this document directly — recorded here for the same reason W-27 to W-36's provenance is recorded above: so a future reader knows this arrived from outside rather than growing from repeated use.

Per this repository's convention, what that pass considered and declined:

| Declined | Why |
|---|---|
| Approval at the *account* level, not business creation | Blocks an invited member the inviting owner already vouched for — routes a decision the business already made past a stranger, for no gain (W-63) |
| A `status` column on `business` | Every existing route would need to check it forever, or risk posting money into an unapproved business — a new invariant threaded through the whole money path, of exactly the kind CLAUDE.md's own history warns drifts. Holding the *request* instead touches no existing route |
| The admin role as an identity-provider claim | Makes authorisation an identity fact rather than a `business_member` fact — the same line TS §2 and W-49 already draw by name |
| A separate audit table column, `audit_log.business_id` made nullable | That column being `NOT NULL` is part of what makes a tenant-scoped audit query trustworthy; platform actions get their own table instead |
| Two logins for one person working in two businesses | Two email addresses, an identity provider rejecting the reuse, manual account administration forever — for no isolation gain the `business_id` boundary doesn't already give for free (W-66) |
| Blocking self-approval | Pointless at this business's actual size, where the platform admin and the business owner are often the same two people. Made visible instead of blocked (W-67) |

### Decisions a future reviewer should push on

Since no review so far has challenged a decision, here are the three I would expect a good one to attack, recorded so nobody mistakes settled for correct:

- **W-4, no run means no charge.** Clean and simple, but it puts every idle day on you and leaves the driver no financial reason to run. The lost-days report detects the problem; it does not create an incentive. A minimum days-per-month floor would. Worth revisiting once a few months of lost-day data exist.
  - *Revisit trigger, set 17 Aug 2026:* **the first three closed months that contain at least one `did_not_run` day.** Named as a condition rather than a date because "after real use" has no moment that ever arrives — and because the argument here is settled by one number nobody has yet: how many idle days there actually are. Note this one is **a term in the driver's agreement, not a display rule** — changing it after a driver has signed means renegotiating with him, so it is cheaper to revisit before a second driver is taken on than after.
- **W-14, fully automatic messaging.** At this volume — a handful of rentals and one bus — automation buys little and brings Business API onboarding, template approval, per-message cost, and a new class of silent failure to monitor. Assisted sending would have delivered nearly the same value at nearly no cost. Worth revisiting if the fleet grows rather than before.
- **W-2, two driver balances never netted.** Right for trust, but it adds a step to every settlement, and with a single driver the argument it prevents may cost less than the friction it adds. Worth revisiting after a month of real use.
  - *Revisit trigger, set 17 Aug 2026:* **the first closed month in which an `offset_record` was actually used** — that is the moment someone has felt the friction and chosen to net two balances deliberately, which is the evidence this argument needs. If a month closes and no offset was ever recorded, the friction is theoretical and the rule costs nothing. Unlike W-4 above, this one is **presentation only and safe to change at any time**, so there is no deadline attached to it.

## 9. What happens next

With the use cases settled, the next phase rebuilds the technical documents against them:

1. **Entity and data model** — rebuilt around arrangements A/B/C rather than car/bus, with the driver as a first-class party who can be both debtor and creditor, incidents and trips as cost containers, capital and current accounts kept separate, the message audit log, and the split pricing bases — rent per period, kilometres per day (§6.12).
2. **Functional requirements** — re-mapped onto these use cases. Much of the earlier requirements spec assumed the car/bus split and needs reworking; the accounting rules in it (recognition basis, allocation, capital treatment, disposal) remain valid and carry across unchanged.
3. **Reports and metrics** — definitions and formulas, including the per-arrangement degradation rules so nothing ever shows a confident wrong number from patchy data.
4. **Phasing** — what ships first. My view: the ledger and the daily card before notifications, because the app has to be trusted before it is allowed to message your customers.

### 9.1 What is deliberately later

Not everything specified here belongs in the first build. My suggested split, for the additions in particular:

| Phase | Includes |
|---|---|
| **First** | The three arrangements, the daily card, expenses with funding source, rent schedules and collection, trips with trip P&L, **incidents (UC-12)**, driver balances both ways, partner capital and current accounts (UC-67), mileage limits and excess, adjustments and waivers, banking cash (UC-65), costs with no vehicle (UC-66), business setup and opening balances (UC-08, UC-09), the vehicle calendar (UC-95), corrections and the audit trail (UC-96, UC-97), **period close (UC-98)**, **paperwork expiry (UC-92)**, **condition photo capture (W-30)**, **joining a second partner, a manager, or a driver's own view (UC-03, UC-07, W-57)**, **write-offs and post-closure charges (UC-90, UC-91)**, **the year, goodwill given, ageing and utilisation reports (UC-73, UC-77, UC-78, UC-79)**, **export (UC-99)**, **vehicle loans and distributable cash (UC-106, UC-107, UC-108, UC-109)** |
| **Second** | Notifications and the message log, side-by-side condition comparison, **UC-99's statement *document* (the spreadsheet half stays First — see UC-99)**, **UC-57's no-login share link (the printed slip stays First — see UC-57)** |
| **Third** | Depreciation and disposal, driver retainers and spare-vehicle reassignment (relevant once there is a spare vehicle), tax if it applies, offline capture |

**Two First-row entries were split rather than moved, 17 Aug 2026.** ⚑ `export (UC-99)` and the shareable half of `UC-57` each turned out to be two pieces of work of different kinds under one name, and only one piece of each is deferred: the spreadsheet ships and the PDF does not; the printed slip ships and the no-login link does not. Recorded as a split here so the First row is not read as promising something it no longer does, and so nobody restores the whole entry from an older draft on the assumption a line went missing. Each use case carries its own reasoning; `user-flows.md` F-9.3 and F-6.6 carry the mechanics.


**Vehicle loans moved from Third to First in v1.2.15, 23 August 2026 — a real phase change, not a correction of an omission.** ⚑ Unlike UC-73/UC-77 and UC-12 below, this table did say where loans belonged and it said Third. Two reasons overrode it. The first is the standing rule the owner set in v1.2.5: **phase one covers every open, buildable gap rather than the subset this document originally scheduled.** The second is specific and is what made it urgent — **UC-109's distributable cash cannot be computed without loan data**, and UC-75's cash position is already phase one. Leaving loans in Third would have shipped a phase-one report that silently overstates by exactly the arrears, on the one figure someone acts on by moving money. A feature that another phase-one feature is arithmetically wrong without is not a later phase.

**What this costs, stated plainly because it is not free.** Loans bring two tables, two constraint changes, a new cost category and a new payout kind, and phase one was otherwise close to done. The release gate moves out by that much. Recorded here so the decision is visible as a trade rather than discovered later as a slip — `Plan.md`'s Wave 9 carries the same note against its own gate.

**WhatsApp dispatch is built last** — decided by the owner, 31 July 2026. Sending (UC-80…UC-87, W-14/W-21) comes after everything else in this table, including the phase-three items. Three consequences, because deferring a feature is not the same as forgetting it:

- **Meta template approval leaves the critical path.** It was the one item with an external lead time — minutes to about two days *per message per language*, and now in English and Sinhala. It still has to happen before the messaging build starts, but it no longer gates anything before it.
- **What messaging depends on must still be captured from phase one.** Condition photos (W-30) and the message ↔ record link (§9.2) stay where they are. A message that cannot cite the day, due or trip it was about is the version that gets built twice.
- **The Queue binding and the kill switch are not needed at bootstrap** (TS §8). Nothing before the messaging build reads them.

The transport stays swappable regardless (W-14). Sequencing it last makes that easier to honour, not harder — nothing upstream will have grown a dependency on WhatsApp's particular shape.

**Four things moved into the first phase in v1.2**, each because something already in phase one depends on it:

| Moved | Depends on it |
|---|---|
| **Period close (UC-98)** | W-35 — the entire late-facts rule — is written in terms of "the currently open period" and "a settled month". Phase one has both concepts and, until now, no mechanism. Without it either everything stays editable forever or the rule is unimplementable |
| **Paperwork expiry (UC-92)** | Nothing, and that is the point — v1.1 already argued this in the note below, then scheduled it second anyway |
| **Condition photo capture (W-30)** | UC-80, in phase two, sends the photos with the confirmation. Shipping the message before the photos exist means either an incomplete message or building it twice. Only the *capture* moves; the side-by-side comparison can wait |
| **The audit trail (UC-97)** | Not a report but a shape. Retrofitting audit onto money tables that already hold live data is materially harder than building it in, and §2's arrangement — one person entering, another consuming — needs it from the first month |

The two originally flagged here still stand. **Paperwork expiry (UC-92)** costs almost nothing and prevents an uninsured accident, which is the largest single unbudgeted loss available to this business. And **banking cash (UC-65)** belongs in the first build despite looking like an afterthought, because without it the cash position report degrades from day one.

**One more moved in v1.2.3, for a different reason than any of the four above:** **the driver's own view (UC-07)** was scheduled second because it looked like a nicety — read access, not a money flow. It is not optional, because **UC-03 and UC-07 turned out to be the same problem.** Neither this document nor `user-flows.md` ever specified how a second person — partner, manager or driver — actually gets an account; UC-03 said "pick the user" without saying from where. A business with one owner never needs the answer, which is exactly why nobody noticed. **W-57** answers it once, the same code-based shape for all three, so UC-07 moves with UC-03 rather than waiting for a phase of its own.

**Six more moved in v1.2.5, 11 August 2026, for a different reason again: not a dependency, an explicit decision to stop deferring.** Write-offs and post-closure charges (UC-90, UC-91), the year / goodwill / ageing / utilisation reports (UC-73, UC-77, UC-78, UC-79) and export (UC-99) move from Second to First. Unlike every move above, nothing about their own mechanics changed — the backends for UC-90/UC-91 have been callable since P10, `user-flows.md`'s F-9.2 catalogue already specified all four reports in full, and `ui-ux-guidelines.md` §11.1 already carries their chart designs. What changed is the build's own scope: the owner set a standing rule that phase one now covers every open, buildable gap rather than the subset this document originally scheduled first, and these six use cases were sitting in Second for no reason stronger than the original phasing guess. **Two, UC-73 and UC-77, were not phased anywhere in this table before this edit** — an omission carried since v1.0, only visible once `user-flows.md`'s own per-report Phase column (which did phase both, at 2) was checked against this document's and found to disagree with a table that was silent rather than one that said something different. **What stays in Second, deliberately, and for the original reasons**: notifications and the message log (WhatsApp, sequenced last by the owner's 31 July decision above) and side-by-side condition comparison (still blocked on the photo pipeline, UC-80's own dependency, not yet built in full).

**Incidents (UC-12) added to First in v1.2.6, 11 August 2026 — the same omission as UC-73/UC-77, not a phase change.** This table named no phase at all for incidents, in any version back to v1.0, while `user-flows.md`'s F-3.4 has carried `*Phase:* 1` throughout and P8 built the container, its treatments and its recoveries as phase-one work from the start. The gap was invisible until TRACKER.md's own build log asked the question directly: **G-2, "one accident", is a golden fixture FL §9.1 requires to reproduce (95,000 spent, 80,000 recovered, net 15,000), and a fixture no scheduled phase can satisfy is a gap in this document, not evidence the fixture is wrong.** Corrected here rather than left as a standing question — incidents were always intended as phase one, `user-flows.md` never disagreed, and the only thing missing was this table saying so.

### 9.2 Links the entity phase must not lose

Several rules in this document are only true if two records stay tied together. They are easy to specify in prose and easy to lose in a schema, so they are listed explicitly:

| Link | Why it has to exist |
|---|---|
| **Recovery ↔ write-off** | A written-off debt later paid is a recovery against that write-off, not fresh income (UC-90). Without the link the two appear as a loss and an unrelated windfall in different months, and both figures mislead |
| **Correction ↔ original receipt** | A partial correction has to reduce a specific receipt and move only the difference (UC-93), or the audit trail shows two unrelated amounts |
| **Discrepancy ↔ banking event** | A pooled shortfall belongs to the banking event, not to a guessed receipt (UC-65) |
| **Message ↔ the record it concerned** | Every message must be readable from the due, driver or trip it was about, not only down the log (UC-87) |
| **Incident ↔ its costs and recoveries** | The net cost of one accident has to remain answerable years later (UC-12) |
| **Ownership share ↔ its effective dates** | Last year's profit split must not change when someone buys in this year (W-1 and the requirements spec) |
| **Reading ↔ how it was obtained** | A photo-backed odometer and a reported one carry different weight in a dispute (W-18) |

Each of these is a rule in this document that quietly becomes false if the link is dropped.

Five more were added in v1.2, on the same test — a rule here that becomes false without them:

| Link | Why it has to exist |
|---|---|
| **Late fact ↔ the accounting period it belongs to** | W-35 collapses. The fact lands in the open month with nothing saying where it came from, and both months are wrong (§6.14, UC-98) |
| **Cost ↔ borne-by *and* paid-by, separately** | The manager buying the driver's fuel becomes either his own expense or the business's, and both are wrong (W-48) |
| **Day ↔ both earned and received** | A cheap day and an unpaid day become indistinguishable forever, which is §6.8's whole point |
| **Every record ↔ its business** | Costs belonging to no vehicle have no home, and the cash position cannot be assembled (W-39) |
| **Rate or terms ↔ their effective dates** | Recomputing any past month gives a different answer than it did at the time — for the daily lease amount (UC-32), the rent (UC-17), the mileage package (UC-18) and the ownership split (UC-02) alike |

---

## 10. What changed in v1.2

### Two contradictions fixed

Both produced wrong numbers rather than missing features. Detail in §1.2.

| | Was | Now |
|---|---|---|
| **Charter days** | `on charter` was a pickable lost-day reason (UC-06) while UC-30 and UC-41 treated those days as system-paused, and §7.1 counted them as operated | Removed from the pickable list. Charter days are system-set only, and the lost-days denominator is `ran + lost` |
| **Pattern days** | UC-05 allowed an alternate-day pattern; nothing said what an off-pattern day was | Off-pattern days are *not scheduled* — no card, neither operated nor lost |

### Seven inconsistencies reconciled

| | Resolution |
|---|---|
| "Period" meant both a lease cycle and a reportable month | Split into **billing period** and **accounting period** (W-40, §6.15) |
| "Per-day rate" meant both money he pays us and money we pay him | **Daily lease amount** vs **driver day fee** (UC-04, UC-05) |
| Messaging configuration had three unranked scopes | One precedence: business default → rental override → recipient opt-in, which always wins (Group I) |
| §8 said customer documents are "nothing automatic"; UC-82 sent a receipt automatically | *Documents* on request, *messages* automatic — they were stated side by side without being distinguished (§8) |
| Borne-by carried two questions in one field | Split into borne-by and paid-by (W-48, §6.1, UC-60) |
| UC-75 counted "cash held by each driver" | Advances only. Arrears are a receivable; his fares were never ours (UC-75) |
| §9.1 scheduled four things after what depends on them | Period close, paperwork expiry, condition photo capture and the audit trail moved to phase one (§9.1) |

### Eighteen decisions added — all ⚑ proposed

**W-39** business as the scope root · **W-40** the two period types · **W-41** trip income recognises on closing · **W-42** manager-initiated driver linking · **W-43** blank waive threshold means zero · **W-44** customer deposits top up and part-apply · **W-45** replies out of scope · **W-46** lease boundary day · **W-47** one driver per trip · **W-48** borne-by ≠ paid-by · **W-49** the permission matrix · **W-50** money records append-only, with an audit trail · **W-51** opening balances · **W-52** contribution-vs-share is a current-account claim · **W-53** management fee treatment · **W-54** the arithmetic conventions · **W-55** person or organisation customers · **W-56** reports degrade, never zero.

**These are my judgement, not yours.** Each is marked ⚑ in §1.1 and each carries its reasoning, so reversing one is a matter of reading the entry and deciding against it. The three most consequential, if you want to look at only three: **W-40** because it changes how every period-bearing rule reads, **W-49** because it decides who can make money disappear, and **W-53** because it decides whose profit a management fee reduces.

### Sixteen use cases added

| Group | Added |
|---|---|
| A — setup | UC-08 create the business · UC-09 go live with opening balances |
| B — monthly rental | UC-18 mileage packages · UC-19 customer statement |
| D — daily lease | UC-37 he settles several days at once |
| G — partner money | UC-67 what each partner put in and is owed |
| H — insight | UC-76 lost days · UC-77 goodwill given · UC-78 ageing · UC-79 utilisation, plus UC-70–75 expanded from one-liners |
| K — administration *(new)* | UC-94 change arrangement · UC-95 vehicle calendar · UC-96 fix a mistake · UC-97 who changed what · UC-98 close the month · UC-99 export · UC-100 archive a driver or customer |
| D — daily lease | UC-38 confirm a week in one pass *(added v1.2.1)* |

UC-03 also gained the permission matrix.

**Two of these were stated premises the document never implemented.** §1 opens by saying vehicles move between arrangements over time — UC-94 is the first thing that does it. And W-35, the rule the entire correction model rests on, is written in terms of an open period that nothing defined — UC-98 defines it.

### What did not change

**Every figure in §7.** The three walkthroughs still reconcile to the same numbers, which is the test that any of this was safe. §7.1 gained a line showing its day decomposition; no total moved.

**W-14, automatic messaging.** §8 lists it among the decisions a future reviewer should push on, and I would push on it — at one bus and a few cars, automation buys little against Business API onboarding, template approval, per-message cost and a new class of silent failure. You reaffirmed it; §8 keeps the entry as the record of the trade-off, and Group I is unchanged apart from the configuration precedence and W-45.

**W-1 through W-38.** None was reversed. The eighteen additions sit alongside them.

### What is needed from you

Nothing, to begin. The entity and data model work in §9 can start against this document as it stands.

Two things are worth your attention when you have it, neither blocking: the **eighteen ⚑ proposed decisions**, which are mine until you say otherwise, and the **two values in §8** — the local language and the waive threshold — which are yours to fill and which nobody else can choose for you.
