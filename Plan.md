# Implementation plan — the remaining build, in two parallel tracks

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every open gap by id; this says what remains, in what order, and who can build it at the same time as whom. Where the three disagree: `docs/` first, then `TRACKER.md`, then this.

**Written 4 August 2026**, from `b2cf367` — backend complete through P13, frontend complete through Web-P8b. Validated route-def by route-def against `api/src/route-defs/` and screen by screen against `web/src/`.

**What changed from the previous edition.** It was a single serial queue of nine phases, each opening with its own backend increment and then building screens against it — so the frontend idled through every read increment and the backend idled through every screen. This splits the same work into **Track A (Worker + shared schemas)** and **Track B (React client)**, which is legal because of one rule the project already runs on, restated below. The old `Web-P8c…P12` numbering is retired; every item here carries a gap id from [TRACKER.md](TRACKER.md) §4 instead.

**Updated 5 August 2026**, `e7efa71` — the CI gap under "One thing that is not code" (below) is resolved; see [TRACKER.md](TRACKER.md) for the full account. Nothing on either track was ever blocked by it, but every PR into `main` is now actually tested for the first time.

**Updated 5 August 2026**, `2822193` — validated A2/A3/B2/B3 against the code rather than against this file, ahead of building them. Three things were wrong and are fixed below: **`/more` does not exist**, so B2 and B3 had no entry point (now **B0**, GAP-37) · **`GET /api/payment` does not exist**, so F-8.2 was unbuildable from any screen (now in A3, GAP-38) · **GAP-13 stopped being expensive when P13 shipped** and is now built in A3 rather than deferred a fifth time. A2's one open decision — F-7.6's host — is also **made**, and it closes GAP-4 by deriving rather than writing.

**Updated 5 August 2026 — A2 done.** Six endpoints, 25 new tests, full suite 31/353. B2's dependency is now only B0. One new gap recorded, **GAP-39** — W-53's management fee has never actually reduced vehicle profit; TRACKER.md §4 has the detail. A2's own write-up is below, under Track A.

**Updated 5 August 2026 — A3 done.** Four endpoints/changes, 13 new tests, full suite 31/366. B3's dependency is now only B0. A3's own write-up is below, under Track A.

**Updated 5 August 2026 — A4 done.** Two endpoints, 8 new tests, full suite 31/374. B6's dependency is now only B0 — every one of A2, A3 and A4's handoffs to Track B has now happened. A4's own write-up is below, under Track A.

**Updated 5 August 2026 — A5 done.** One endpoint, 4 new tests, full suite 31/388. **Track A's read backlog is finished**; everything left on it writes, migrates, or both. A5's own write-up is below, and the section after the Track A table has been re-planned against the code — see "What the A6–A10 validation pass found".

**Updated 5 August 2026 — re-pointed at what is actually left.** Deployment and auth both landed today, and between them they *were* the critical path. With them gone this plan's framing was stale: it still sequenced around unblocking things, when nothing on either track is blocked any more. "Start here" is rewritten around **who still cannot use the product** — one of three roles has a working app — and B0 is now explicitly first. One new gap, **GAP-40**: nothing signs the user out.

**Updated 5 August 2026 — B8 done, and it was mis-sized here.** Real Asgardeo auth is wired (`96301f8`): SDK, PKCE, callback, sign-in gate, 12 new tests. This plan costed B8 at "ten minutes of console work" — that covered the console; **the client half was unbuilt and unscoped**, and until it landed nobody could log in to a deployed build at all. It also surfaced a stale client id in all three Worker environments and a QA build that would have shipped production's. Both fixed. **The lesson worth keeping: "blocked externally" hid an unsized item on the critical path** — B8 was ranked last precisely because the blocker was cheap, which said nothing about the work behind it. Its write-up is under Track B.

**Updated 5 August 2026 — B0 done.** `/more` is real and carries sign-out (GAP-40, GAP-37 both closed); B2, B3 and B6 are no longer waiting on anything. Its own write-up, including the `AuthActionsContext` plumbing sign-out needed and why the confirm is a `Sheet` rather than `Dialog`, is below under Track B.

**Updated 6 August 2026 — GAP-3 fixed out of sequence, ahead of A6.** Not an item this plan had scheduled: an independent UI/UX review of the built client (`UI-UX-REVIEW.md`) found that `confirmDay`'s idempotency check had been silently discarding real confirmations in production since P13 shipped — the daily-confirmation flow, F-4.2, "the flow the product is optimised around." A row's mere *existence* was being read as "already confirmed," and P13's `generate-day-cards` cron has pre-inserted an existence-only `open` placeholder for every scheduled day, on both live environments, since 5 Aug. This outranked "do A6 next" on its own terms — CLAUDE.md's ordering, not this plan's — because it is live data loss on the core loop, not an unbuilt receivable on a secondary flow. Fixed same-day: `confirmOpenDayRecord` turns the placeholder into the real row via a guarded `UPDATE`; `ConfirmDayCard.tsx` stops treating `state: "open"` as settled. Full account, including why this sat mis-filed as "correct to leave" since before P13 existed, in [TRACKER.md](TRACKER.md) §4 (GAP-3) and its dated entry above §1. **A6 is next, unchanged** — this didn't reorder anything behind it, it ran ahead of the queue.

**Updated 5 August 2026 — A9a done, closing GAP-35.** Migration `0008`, exactly as sketched below. Verified on a fresh ephemeral Neon branch rather than the shared dev one — 378/378, one pass, no connection flakiness, which is itself evidence for the process change recorded in the same commit: **stop running the full integration suite locally; push the touched-file-verified commit, open a PR into `develop`, and let `integration.yml`'s own fresh-branch-per-PR run carry that cost instead**, in parallel with the next item rather than blocking it. TRACKER.md §5 has the full account, including that this also caught a stale `388` test count this file and that one had both been carrying. A6 and A10, both gated on this, are unblocked.

**Updated 6 August 2026 — A6 done, closing GAP-23.** Exactly the design sketched below, with one deliberate narrowing found while implementing it: the period requirement is scoped to the `customerId !== undefined && agreedAmountMinor > 0n` guard, not the whole endpoint — an owner-driven charter with no customer touches no period-scoped table, so it stays bookable with no accounting period open at all, per CLAUDE.md's "only validate at system boundaries" rather than this section's broader-sounding "booking a charter becomes refusable" phrasing. Migration `0009` widens `obligation_kind_check`, confirmed against the live branch first (`obligation_kind_check`, exactly as guessed, but looked up rather than assumed). `cancelTrip` voids the receivable through a new source-scoped `voidObligationBySource`, general enough that A9b's remaining void endpoints can likely reuse the same shape rather than each writing their own. **Found while fixing the golden fixture's own test, not the domain code**: G-1's 134,000 test and the §7.1 close-trip test both had an ad-hoc `WHERE source_type = 'trip' AND source_id = tripId` query that implicitly meant "the driver-fee obligation" — A6 gave `trip_fare` the same source, and both queries started summing a receivable into "costs." Production's `sumVehicleCostsForPeriod` was never at risk (it already filters `direction = 'owed_by_us'`); both test queries fixed to match. 7 new tests, `trip.test.ts` 26→33; full account, including the closed-period-on-cancel test proving A9a's own rule, in TRACKER.md (GAP-23). Next: **A10**, the other two silent zeros (GAP-39, GAP-10) — free of any remaining gate.

**Updated 6 August 2026 — `UI-UX-REVIEW.md`'s remaining findings validated against source and triaged into a new item, `B9`.** That review (repo root) is independent of this plan's own accounting — run by driving the built client with Playwright against mocked responses shaped from the real Zod schemas — and it had eight findings beyond the GAP-3 fix already absorbed. Each was re-checked directly against `web/src`/`docs/` rather than taken on trust, this repository's own rule applied to an input as much as to a phase. **Five held up**: no `Dialog` exists anywhere for INV-1 (only `CloseTripSheet.tsx` renders one, for INV-17) · trip detail's app-bar title truncates at 360px (`formatShortDate` sets `year: "numeric"` unconditionally) · the vehicle calendar's occupied-day cells carry no `aria-label`, only free-day cells do · M-26 (landscape) is wholly unbuilt and wasn't on this plan at all — confirmed by `grep`, and it's a deliberate spec requirement, not an aspiration · M-11's undo toast has a host `<div>` with nothing rendering into it. Scheduled as **GAP-44 through GAP-48**, TRACKER.md §4, bundled below as **B9** — independent of both tracks, blocked by nothing, blocking nothing. **Two did not hold up**, corrected rather than scheduled (TRACKER.md §6): `DialogConfirmFooter`'s `confirmLabel` is a required prop with no default, so the claimed "defaults to `Confirm`" footgun doesn't exist in the code as written; and "Excess rate per km" is the specification's own term for a concept M-25 never addresses — the rule bans "rate" as a synonym for two *other*, opposite-direction words, not this one. One finding — a nested-`Sheet`/`AmountPad` interaction — needs the manual browser check the review itself asked for and stays unresolved, noted under B9 rather than guessed at.

**Updated 6 August 2026 — the first real browser round trip, live against `qa.fleetsettle.com`, and the queue re-ordered on what it found.** Chrome DevTools MCP driving a real browser, a human entering real Asgardeo credentials — every prior review, this plan included, had reasoned from source and mocks. Full account in TRACKER.md's dated entry and §5 (four new traps). Three real, previously-unknown items came out of twenty minutes of actual use, and none of them were reachable by any review method used so far:

- **GAP-49** — the sign-in screen and two of three role placeholders render with **no page background anywhere in their DOM**, invisible-by-coincidence in light mode, functionally illegible in dark mode. `Screen.tsx` alone sets no background; only `AppShell.tsx` does, and `AuthGate`/`NotBuiltYetScreen` render outside it. Trivial, structural, huge blast radius (the literal first screen every user sees) — bundled with GAP-50 as **B11**, both promoted ahead of A11.
- **GAP-50** — closing a `Sheet` can leave `aria-hidden` on an ancestor of a still-focused element, a real WCAG violation, reproduced twice (single sheet, nested sheet). This **confirms and generalises** the "low confidence" nested-`Sheet`/`AmountPad` item B9 carried as unresolved — it is `Sheet.tsx`'s vaul-based focus handling itself, not one nested case. **B9's write-up below is corrected accordingly**; the item moves to B11.
- **GAP-51** — F-1.7, "Set up the daily lease," has **no implementation anywhere**, client or spec-wireframe, confirmed three independent ways live and by `grep`. The backend (`startDailyLeaseRoute`, a complete `startDailyLeaseRequestSchema`) has been sitting ready since P2/P5, explicitly labelled for this flow in its own doc comment. This blocks arrangement B — the daily-lease model this project's own running example (the bus) runs on, where the driver pays you (UC §1.2) — from being usable by any real business, and it's what stopped this session short of verifying GAP-3 live. New item **B10**, and it now outranks A11: A11 blocks two roles from existing at all, but B10 blocks the one role that already works from doing its actual job, which is the more urgent gap now that A0 has shipped.

**Process, not just findings — three standing rules added so this doesn't recur, TRACKER.md §5 has the full reasoning:** (1) anything touching `AuthGate`, `FirstRunGate`'s non-operate branches, or a component that can render outside `AppShell` needs one real-browser check, both colour schemes, before being called done — mocked review structurally cannot see this boundary; (2) read the browser console as a standing step of any review, not just screenshots — it found GAP-50 in under a minute; (3) a route-def/screen validation pass cannot notice a flow that was never wireframed *and* never built, which is exactly how GAP-51 went unseen through every prior pass — **a full top-down audit of `user-flows.md`'s phase-1 flow list against both `ui-ux-guidelines.md` and `web/src` hasn't been run yet and should be soon**, since one flow falling through whole is reason to suspect it isn't alone. **Also found, not a code gap:** this QA account was on the stale pre-A0 signup path because `build/p0-foundation` has never been merged into `develop` — fixed for this session with one scoped `UPDATE` on the `qa` Neon branch, but the merge itself is still outstanding and now the first item in the queue below, since every other environment-dependent fix since A0 is equally unverified on QA until it lands.

**Updated 7 August 2026 — the merge from the item above landed, and a second live pass against `qa.fleetsettle.com` confirmed B10/B11 and found one more flow in GAP-51's own shape.** `build/p0-foundation` → `develop` (5 PRs, `deploy-qa` green on each). Live, both colour schemes: GAP-49 and GAP-50 both hold on a real sheet and a stacked one; "Start a daily lease" is live in the vehicle-actions menu; `/more` matches spec. Full account, including a `git fetch`-vs-local-ref trap this session's own first merge check tripped on, in TRACKER.md's dated entry and §5.

**GAP-54, new: F-1.2 ("Change a vehicle's arrangement," UC-94, phase 1) has no implementation on either side — GAP-51's exact shape, found the same way, by `grep` rather than by any diff.** A vehicle's arrangement is therefore fixed at creation for life, and because the client gates hard on it (`canStartLease` needs `A`; `canBookTrip` needs `B`/`C`; `canStartDailyLease` needs `B` or none), **a vehicle created as `A` can never book a charter and one created as `B`/`C` can never start a lease.** UC-94's own motivating example is exactly that transition. **Unsized and unscheduled** — TRACKER.md §4 carries the full account, including a first draft of this finding that was withdrawn: the live QA data cited as evidence turned out to be correct behaviour misread as a defect (`vehicle_arrangement` is a standing configuration, not a live state), and only the `grep` half survives. **GAP-3's live confirmation is still open and is not blocked by this** — QA's bus just has no daily lease yet; starting one through B10's flow and letting `generate-day-cards` run is the whole check, held off here only because it is a real write to a live environment.

**Updated 7 August 2026 — `MUST-FIX-FINDINGS.md` validated finding by finding, in both its editions, and it moved the queue once.** The file existed as a **web edition** (13 findings) and was regenerated in place as a **backend edition** (12 findings) partway through the pass; both were validated, both are cited by edition in TRACKER §4/§6, and the file on disk carries the full verdict table. Same treatment as `UI-UX-REVIEW.md`'s: re-checked against source, not taken on trust.

**Most of it was already tracked and correctly scheduled** — GAP-10/GAP-39 → A10 · Review/Mine → B4/B5/B0b · offline → B7 · photos → A7 · the three a11y/UX items → B9 · and, from the backend edition, GAP-5, GAP-21, GAP-8 and GAP-7, all four already in "correct to leave" with their reasons intact. **An independent review rediscovering this queue twice, from two different angles, is a reasonable signal it is pointed at the right things.** **One does not hold up** — `/more` carrying only sign-out is B0's explicit "rows for what exists only" decision, not an omission (TRACKER §6). **Five are new**: **GAP-56**, **GAP-57**, **GAP-58**, **GAP-59**, **GAP-60**. **And one existing gap changed status without changing content: GAP-1.**

**GAP-56 is the find, and it is a money bug this plan did not have.** An expense's borne-by default resolves as of **now** rather than as of `spent_on` — `resolveBorneByDefault` calls two lookups that take no date at all, while `spentOn` sits in the same request. A fuel fill dated 1 July, entered 10 August after a lease started on 1 August, is borne by that new customer: a real charge on a real person's balance for a cost incurred before they held the vehicle. Reachable today with one lease and **no party change at all**, and U-8 ("entered days after it happened") makes back-dating the ordinary case rather than the edge one. **Scheduled as A12, ahead of everything unbuilt** — small, and on the path every expense takes. **✅ Done 7 Aug 2026** — full account below and in TRACKER.md.

**The same finding's other half is a different item, and separating them is the point.** §1 bundles "arrangement transitions aren't maintained" with the borne-by bug. Only the second is a money defect; the first is GAP-54/**A13**, a missing *flow* (F-1.2), where the single-writer column is by design. Recorded in TRACKER §6 rather than merged, because a review that is right about a symptom can still be wrong about the cause, and the two halves want opposite priorities.

**GAP-1's expiry is the quieter result.** Per-vehicle capability scoping has sat in "correct to leave" since P7 on an unstated premise: no `manager` could exist. A11 shipped the invite that creates one, and `manager` reads every vehicle's reports. **Fourth instance of "a gap's reason is a fact with a date on it"** (GAP-13, GAP-23, GAP-3 are the others). Not scheduled — it needs a design call first — but the operational guard is recorded against B0b: **do not invite a `manager` to a real business yet.**

---

## The rule that makes two tracks legal

> **The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift silently and what drifts is a money field (IG §2). So the schema is always a phase's first task, never its last.
>
> — TRACKER.md §1, rule 2

**The contract between the tracks, stated once:**

1. **Track A lands the Zod schema first**, in `packages/shared/src/schemas/`, in its own commit, before the query or handler exists. That commit is the handoff.
2. **Track B imports that schema object and mocks against it.** Never a hand-written interface mirroring it. The one exception already in the tree is `MeResponse` in `FirstRunGate.tsx`, and it is documented as one.
3. **Neither track edits the other's files.** `packages/shared` is Track A's to write and Track B's to read. If Track B needs a schema change, it asks; it does not add a field.
4. **Money is `string` on the wire in every schema either track writes.** Non-negotiable, and the reason clause 2 exists at all.

**Where the tracks actually contend:** `packages/shared/src/schemas/` (A writes, B reads — serialise via clause 1) and `web/src/app/router.tsx` (B only, but every B item touches it — expect merge conflicts there and nowhere else).

---

## Nobody could use the product at all — 6 August 2026

**Reported from the deployed app: "when I log into the application I actually cannot do anything, I just see *Review — Not built yet*."** That is not one user's misconfiguration. It was every user, and the built product — Web-P1 through Web-P8b, months of screens — was unreachable in production by anyone.

**The chain, verified in code rather than inferred:**

1. `createBusiness` (`api/src/domain/setup.ts`) assigned the creator **`role: "owner"`**, hardcoded.
2. UI §1.1 maps `owner` to the **Review** shell — the passive partner who reads reports monthly — and `owner_manager`/`manager` to **Operate**.
3. Review is unbuilt, so `FirstRunGate` renders `NotBuiltYetScreen`.
4. **There is no endpoint that can add a member or change a role.** `business-member` is GET-only; no `POST`, no `PATCH`.

So the only role obtainable through the product was the one role with no interface, and nothing in the product could change it. **`role: "owner"` was also the single word standing between a working app and a dead end** — the backend never cared: `owner` is in `STAFF` in `auth/policy.ts` and holds *every* capability except `viewOwnData`. The client turned away a user the server would have served.

**Fixed, `A0` below: the creator is now `owner_manager`.** F-0.1 step 3 says the creator lands "on an empty home screen with one action: *Add a vehicle*" — the Operate shell, stated outright — and F-0.2, the next flow over the same business, has **Owner-manager** as its actor. F-0.1's accept clause "a new business has exactly one owner" still holds, because `OWNERS` is `["owner", "owner_manager"]`.

**Two things this leaves open, and neither was on any list before today:**

- **The existing production row still says `owner`.** The code fix only governs new signups. Whoever is already signed up stays stuck until their `business_member.role` is updated — a **live data change on production**, which is a decision, not a deploy step.
- **The second partner, a manager, and any driver still cannot get in.** CLAUDE.md describes *two* partners; only one can ever have an account. And `driver.linked_user_id` is **read** by identity resolution and **written by nothing** — so no driver can ever sign in, which makes B5's Mine shell unreachable for exactly the same reason Review was. That is **A11**, new. **Update, same day: it now has a specified mechanism.** `docs/product/use-cases.md` W-57 (v1.2.3) settles it — an invite code scoped to a role, redeemed at first sign-in, the same shape W-42 already used for a driver — and `user-flows.md` F-1.4/F-1.8 (v1.1.3) carry the steps, with F-1.8 moved from phase 2 to phase 1 alongside it. A11 is a real, sized build now, not a product decision waiting on anyone.

**The lesson, and it is the same one this repository keeps relearning:** the tracker recorded the Operate shell as "Complete" and it was — for a role no real user could hold. *Built* and *reachable* are different claims, and only one of them was ever tested.

---

## Start here

**As of 5 August 2026 the product is deployed and a real person can log in to it.** That was the whole of the critical path a day ago, and it is gone: `fleetsettle.com` and `qa.fleetsettle.com` are live, and B8 replaced an auth stub whose token the Worker was always going to refuse. **Nothing on either track now waits on anyone outside this repository** except P14's Meta approvals.

**So the question stopped being "what unblocks this" and became "who still cannot use it".** Three roles — and until A0 landed on 6 August, the honest answer was *all of them*, because the only role a signup could obtain was the one with no interface (above).

| Role | Today | Can anyone actually be this? |
|---|---|---|
| `owner_manager` / `manager` — the partner who enters everything | **Complete.** Home, vehicles, calendar, leases, trips, incidents, costs, quick-add, people | **Yes, since A0** — the business creator. A *second* one can now join too, since A11 |
| `owner` — the partner who reads the reports | **A real shell, still no reports inside it.** Since B0b (8 Aug), lands in the Review shell — four working tabs, correctly redirected, correctly gated — each rendering `NotBuiltYetScreen`. Nine tested report endpoints, no content yet — **B4** | **Yes, since A11 (7 Aug)** — `POST /api/business-member/invite` (role `owner`) + `POST /api/invite/redeem`. Lands with a real account and a real (empty) shell until B4 ships |
| `driver` — the linked driver | **A real shell, still no content inside it.** Since B0b (8 Aug), lands at `/me` with no tab bar, correctly. `GET /api/driver-view` has been ready since P12 — **B5** | **Yes, since A11 (7 Aug)** — `POST /api/driver/{id}/link-invite` + the same redeem endpoint. Same "nowhere to go yet" as `owner`, until B5 ships |

**A11 is done (7 Aug) — the "can anyone actually be this" column flipped from no to yes for both remaining roles.** What it did not do is give either of them a screen: `owner` and `driver` can now get a real account, backed by a real `business_member`/`driver.linked_user_id` row, and both still land on `NotBuiltYetScreen` today, because B4 and B5 are what render something once they're there. A11 stops being "why can nobody try this" and starts being "why does trying this show nothing" — a smaller, more specific problem, and the reason B4/B5 now rank above everything else Track B has left.

**B0, A9a and A6 are all done** — `/more` is real, sign-out works, GAP-35's void/closed-period hole is fixed and verified (378/378 against a fresh Neon branch), and GAP-23's trip receivable posts and voids correctly (386/386, G-1 unmoved).

**A 6 August validation pass over Track B changed what "ready" means for three of its items.** B4 and B5 were both marked "needs nothing" and neither was buildable: `RootLayout` hardcodes `shell="operate"`, `FirstRunGate` has only a `renderOperate` branch, the role is unreadable outside that one file, and UI §12.4's `capabilities.ts`/`<Can>` do not exist — so B3's "absent for a manager" rule had nothing to gate with either. That plumbing is now **B0b**, and it goes first, exactly as B0 did for the same reason. The pass also found **GAP-41**: §7.8's overheads block has no endpoint that can produce it. Full findings under [Track B](#track-b--the-react-client); a box-by-box build order is in the [Track B implementation checklist](#track-b-implementation-checklist).

**Reachable is not the same as usable, and the first live browser test (6 August) found the gap between them for `owner_manager` itself.** The role table above answers "can anyone sign in as this role" — it does not answer "can they do the thing the role exists for." `owner_manager` can sign in today, land on a real Operate shell, add a vehicle, add a driver — and then hit a wall: **there is no screen anywhere that starts a daily lease (F-1.7, GAP-51)**, so a vehicle configured for arrangement B can never generate a day card, and F-4.2 — "the flow the product is optimised around" — can never fire for it. The backend has been ready since P2/P5. This is now **B10**, and it outranks A11: A11 blocks two roles from existing, B10 blocks the one role that already works from doing its job.

**B11 is done (7 Aug).** GAP-49 and GAP-50 are closed at the cause — a base-layer rule on `html` for the missing page background, `autoFocus` on the sheet primitive for the `aria-hidden` violation — along with three things found while fixing them: `color-scheme` was declared nowhere, `Sheet`'s focus restore had never worked, and `npm run typecheck` had been broken since A0. Details under [B11](#b11--done--structural-render-fixes-and-two-bugs-that-were-not-what-they-looked-like).

**A11 is done (7 Aug).** Migration `0010` (GAP-52's partial unique index, GAP-53's audit trigger, `business_member_invite`, INV-31) plus six endpoints — invite/revoke/change-role for `business_member`, one shared `POST /api/invite/redeem`, link-invite/unlink for a driver's own account. 39 new integration tests, full suite 32 files/406 green against a fresh branch; `FirstRunGate` offers redeeming a code alongside creating a business. Two things caught before shipping, both recorded in [TRACKER.md](TRACKER.md): UC-03 itself named only two of the three invitable roles, and the first draft of INV-31's trigger fired on `INSERT` as well as `UPDATE`, breaking a dozen fixtures for no protective benefit. **What A11 does not include, deliberately** — Plan.md's own checklist scoped it to the entry point only: there is no in-app "invite a member" screen (an owner generating a code from inside the product). That needs B0b's role-aware shells to have somewhere to live, same as before.

**Superseded by the 7 August review pass — the current order is below.** Items (1) and (2) of the list that follows are both **resolved**: the merge landed (five PRs, QA redeployed and live-verified), and the production role fix turned out to be moot — checked directly against Neon `main` and found empty, no stuck account, nothing to write. **A12 is also now done** (GAP-56 + GAP-57, same day it was found — TRACKER.md carries the account). **The order as it now stands is: B0b → B3 → B4/B5 → A10 → A13**, with the reasoning in ["The order, end to end"](#the-order-end-to-end). The paragraph below is kept as the record of what the queue looked like before that pass, and item (2) below is now known to have been based on an unverified assumption.

**Do this next, in this order: (1) merge `build/p0-foundation` → `develop`** — QA is still running the pre-A0 signup path as of the last live check (6 Aug: this session's own test account came up `role: "owner"` on QA), so every environment-dependent fix since A0 — B10, B11, and now A11 — is unverified there until this lands; **(2) update the existing production `business_member` row** — a live data decision, not a deploy step; **(3) B0b** — the three shells and the capability gate, now the only thing standing between A11's newly-reachable `owner`/`driver` accounts and an actual screen; then **(4) B3** (has a real deadline — month end) **and (5) B4/B5** in either order, per the reasoning already below. **If Track A is being worked in parallel, A10** (the other two silent zeros — GAP-39, GAP-10, the same defect class A6 closed) **is free of any gate.** The full reasoning is in ["The order, end to end"](#the-order-end-to-end) below, kept in one place rather than restated here.

**Everything left on Track A writes, migrates, or both.** A6–A10 were re-validated against the code on 5 August; three of the five were wrong in ways that matter and one new item came out of it — the findings are below the Track A table. Track A's read backlog is finished and every handoff to Track B has happened (A2 → B2, A3 → B3, A4 → B6, A5 → B5+), so **the two tracks are now fully independent.** Nothing in Track B waits on Track A at all.

**Updated 8 August 2026 — the merge is done, and the flow-inventory audit this document itself called for on 7 August has run.** `build/p0-foundation` → `develop` landed (PR #10, `3794e93`); every environment-dependent fix through A12 is now verifiable on QA. The audit — every phase-1 flow checked against `ui-ux-guidelines.md` and `web/src` at once, rather than screen by screen — found **nine gaps neither tracker had recorded**, full account in `FLOW-INVENTORY-AUDIT.md` and TRACKER.md §4 (GAP-61 through GAP-69). Two are new items sized large enough to matter on their own: **B12** (F-0.2, opening balances — no screen exists, and it is the flow that makes a real business's first month honest) and **B13** (F-6.1/F-6.3/F-6.7 bundled — pay the driver, record an advance, record a deposit, three write endpoints with no caller, one of them self-documented as missing in the code). Two more are small Track A items pairing with existing ones — **A14** (F-6.6's signed share-link mechanism) and **A15** (F-4.7, changing a daily lease's driver). The rest fold into existing items' checklists (B2 gains a mileage-package screen and a payout screen) or stay correctly unscheduled (GAP-68). **The order below is re-sequenced to carry all of it** — B12 and B13 both queue ahead of B3, reasoned through in "Two orderings worth arguing with."

**0.2 — the B4 scope decision — is resolved (7–8 August).** `B4-REPORTS-DESIGN.md` is now a second edition carrying **eleven decisions**, and B4's entries below are updated to match. The three that change this plan:

- **B4 builds the phase-1 six, not nine** — UC-70, 71, 72, 74, 75, 76. FL §9.2's report catalogue table carries an explicit per-row **Phase** column tagging UC-73/77/78/79 as phase 2, and `use-cases.md` §9.1 and UI §15 both agree. P11 built ahead of the phase gate; this plan's B4 title inherited the endpoint count as if it were a scope. **Backend existence is not phase ownership** — and two of the three excluded reports (UC-77, UC-79) cannot satisfy their own use case today at any phase.
- **Four new gaps, GAP-70…73**, all report-contract findings and all in TRACKER §4. Two are **phase-1** reports whose backends are incomplete against their own spec (GAP-70 cash position, GAP-71 lost-day reasons) and gate B4's Wave 2. **GAP-72 is a live wrong number in deployed code** and waits on nothing.
- **B4 sequences in two waves, cut by contract completeness rather than by surface.** The review proposed a Review-core / catalogue split; that puts the blocked work first, because the Review shell's headline tab is the part gated on GAP-41 while two catalogue reports are unblocked today. Wave 1 ships everything that is true now; Wave 2 follows the Track A increments.

**Updated 8 August 2026 — B14, B0b, B12, B13 and B3's core all shipped in one session.** Six commits (`853c916` B14, `cd14d5d` B0b, `6736e62` B13, `12eefa3` B12, `5ddadad` B3, `d0e3e82` the router/`/more` wiring), full accounts in each item's own section below. **The queue's next item is B4** — B0b's shell now exists to build into, and nothing else outranks it. One thing worth restating because it's easy to lose in six items landing together: **B13 needed a real backend fix, not just a screen.** `POST /api/payment` had only ever accepted `direction: "received"` — "pay the driver" had no backend path to a driver's `owed_by_us` balance at all, not merely no caller, the same one-layer-deeper shape GAP-51/54 already established for a missing flow. **B3 shipped its core only** — `WriteOffSheet`/`PostClosureChargeSheet` need a specific obligation/lease/trip as an entry point the close screen never had; recorded as item **10a** in the queue below rather than a checked box that wasn't true.

---

## The order, end to end

Every remaining item on both tracks, sequenced. **Sizes are relative to each other, not calendar estimates** — S is a sitting, XL is the largest thing left on either track.

### The two tracks are independent

There are **no Track A → Track B handoffs left**. A2 → B2, A3 → B3, A4 → B6 and A5 → B5+ have all happened, and every schema Track B needs is already in `packages/shared`. So if two people are working, they never block each other:

| | Order | Note |
|---|---|---|
| **Track A** | ~~A9a~~ → ~~A6~~ → **GAP-74 → GAP-41 → GAP-72** → A10 → A13 → A15 → A16 → A8 → A14 → A7 → A9b | A9a done 5 Aug, A6 done 6 Aug. **The three report-query gaps go first and go together** — one file (`queries/reports.ts`), and GAP-74 gates B4 Wave 1. A10/A13/A15/A16/A8/A14/A7 are all free after them, A9b last |
| **Track B** | ~~B0~~ → ~~B11~~ → ~~B10~~ → ~~B14~~ → ~~B0b~~ → ~~B12~~ → ~~B13~~ → ~~B3 (core)~~ → **V1 → GAP-81** → B4 → B5 → B6 → B2 → B9 → B15 → B7 | **B14, B0b, B12, B13 and B3's core all done 8 Aug** — see the "One person, one queue" table below for each. **V1 (a live pass on QA) is first and is not code**; GAP-81 is F-8.5's client half, promoted out of B9. B4 and B5 are the substance. B6, B2, B9 and B15 need neither B4/B5 nor anything on Track A, so they can go any time; B7 last. **B3's remainder is withdrawn, not queued** — both its sheets are phase 2 |

### One person, one queue

If it is one person, this is the order, and the reasoning is *what breaks first in real use* rather than what is most interesting to build.

| # | Item | Size | Why here |
|---|---|---|---|
| 1 | ~~**B0** · `/more` hub~~ | S | ✅ **Done 5 Aug 2026.** Unblocked B2, B3 and B6; sign-out (GAP-40) shipped with it |
| 2 | ~~**A9a** · the void/period trigger~~ | S | ✅ **Done 5 Aug 2026.** Unblocked A6 and A10 |
| 3 | ~~**A6** · trip receivable~~ | M | ✅ **Done 6 Aug 2026.** The first real-money hole a user will hit, closed — a charter with a customer now raises a real `trip_fare` receivable instead of floating as `unallocatedMinor` |
| 3a | ~~**A0** · the creator's role~~ | **XS** | ✅ **Done 6 Aug 2026.** One word. Every signup landed in an unbuilt shell with no way out; the whole Operate product was unreachable in production |
| 4 | ~~**Merge `build/p0-foundation` → `develop`**~~ | **XS** | ✅ **Done, twice — 7 Aug (PRs #5–#9) and 8 Aug (PR #11, `acce227`).** Both merges deployed QA green. Originally: QA was running the pre-A0 signup path, so every environment-dependent fix since A0 was unverified there. **This row stays as the standing rule it became**: nothing is verifiable on QA until it is merged, and `main` deploys production on merge with nothing pausing after |
| 5 | ~~**Production data fix**~~ | — | ✅ **Checked 7 Aug 2026, and moot.** A direct read-only query against Neon `main` found `business_member`, `app_user` and `business` all at zero rows — nobody has ever signed up in production. There was no stuck account to fix; the original claim was written as fact and never actually verified. Full account in TRACKER.md §1 |
| 6 | ~~**B11** · structural render fixes~~ | **S** | ✅ **Done 7 Aug 2026.** Closed GAP-49 and GAP-50 — plus `color-scheme`, a never-working focus restore, and a typecheck broken since A0. Originally: GAP-49 (sign-in and two of three role placeholders render with **no page background anywhere**, illegible in dark mode — the literal first screen every user sees) + GAP-50 (`Sheet` close can leave `aria-hidden` on a focused ancestor, a real WCAG violation, reproduced twice). Both trivial-to-moderate, both already shipped and broken, neither waits on anything |
| 7 | ~~**B10** · Set up the daily lease (F-1.7)~~ | **M** | ✅ **Done 7 Aug 2026.** Closed GAP-51. Originally: **GAP-51.** No screen anywhere creates a `daily_lease` — confirmed live and by `grep`; never even wireframed in `ui-ux-guidelines.md`. Blocks arrangement B, the daily-lease model this project's own running example (the bus) runs on, where the driver pays you (UC §1.2), from being usable by anyone. Backend's been ready since P2/P5 (`startDailyLeaseRoute`, a complete request schema). **Outranks A11**: A11 blocks two roles from existing, this blocks the one role that already works from doing its job |
| 8 | ~~**A11** · member and driver access~~ | **L** | ✅ **Done 7 Aug 2026.** Migration `0010` (GAP-52, GAP-53, `business_member_invite`, INV-31) + six endpoints (invite/revoke/change-role, one shared redeem, driver link-invite/unlink). 39 new integration tests, 32 files/406 green. `FirstRunGate` offers redeeming a code. Originally: no second partner, no manager, no linked driver could exist — `business-member` was GET-only and `driver.linked_user_id` was never written. **B4 and B5 still build the shells those roles land on** — A11 only got them an account, not a screen |
| 8a | ~~**A12** · the borne-by date bug (GAP-56) + the trip-receivable UI (GAP-57)~~ | **S–M** | ✅ **Done 7 Aug 2026.** `resolveBorneByDefault` now resolves arrangement, active lease and active daily lease as of `spentOn`; `TripDetailScreen`'s "Received" row shows the real `trip_fare` state and opens the same `CollectPaymentSheet` a lease's dues use (generalised off `leaseId` to `onCollected`, since the write was always party-level). 4 + 5 new integration tests, 4 new/updated web tests, `npm run check` clean — full account in TRACKER.md. Originally: GAP-56 was the one genuinely new *money* defect either review produced — a back-dated cost landed on whoever holds the vehicle today, reachable with one lease and no party change; GAP-57 rode along because A6 left `TripDetailScreen` actively denying a receivable the ledger already carried |
| 8b | ~~**B14** · fix the trip receivable's wrong field (GAP-75)~~ | **XS** | ✅ **Done 8 Aug 2026.** `TripDetailScreen`'s receivable row now renders `amountMinor`, matching `LeaseHubScreen`'s own pattern for the identical schema. Both tests that pinned the bug (asserting "Due · Rs 0" as correct) inverted to assert the real figure |
| 9 | ~~**B0b** · three shells + capability gate~~ | S | ✅ **Done 8 Aug 2026.** `meResponseSchema` + `GET /api/me` promoted to a real route-def; `useMe()`, `lib/capabilities.ts`, `<Can>` (fail-closed on a cleared cache, not throw — found wiring B3's sign-out interaction); `FirstRunGate` gained `renderReview`/`renderMine`, each a redirect-to-default-tab shell over `NotBuiltYetScreen` placeholders. The four tab screens themselves stay B4/B5's job |
| 9a | ~~**B12** · opening balances (F-0.2, GAP-61)~~ | **L** | ✅ **Done 8 Aug 2026.** `OpeningBalanceScreen` + `AddOpeningBalanceEntrySheet`, reached from a new `/more` row gated `<Can cap="manageOpeningBalances">`. Deliberately excludes per-vehicle setup — the request schema has no such fields; F-1.1/F-2.1/F-1.7 already carry an original-start-date for that. A full replace on every save, matching `domain/opening-balance.ts`'s own shape |
| 9b | ~~**B13** · driver money actions — pay, advance, deposit (F-6.1/F-6.3/F-6.7, GAP-63/64/66)~~ | M | ✅ **Done 8 Aug 2026.** Found deeper than scoped: `POST /api/payment` was hardcoded to `direction: "received"`, so "pay the driver" had no backend path at all, not just no screen — `createOffset` can't substitute, since it requires the driver already owing something too. `recordPayment` generalised to accept `direction`, defaulting to `"received"` for every existing caller; two new integration tests prove a `"paid"` payment settles a trip fee and never touches arrears. `PayDriverSheet`/`AdvanceSheet`/`DepositSheet` reached via a new "Driver money" `ActionSheet` on `DriverDetailScreen` |
| 10 | ~~**B3** · close the month~~ | M | ✅ **Done (core) 8 Aug 2026.** `CloseMonthScreen`: all five checklist counts, `Dialog`-confirmed close (M-10's stated-consequence label), the successor period surfaced by name, gated `<Can cap="closePeriod">`. `CorrectPaymentSheet` + `Timeline` off a recent-payments list, gated separately on `reverseReceipt` (narrower than reading the list) — a gap found and fixed mid-build, not shipped. **`WriteOffSheet`/`PostClosureChargeSheet` deliberately deferred, see 10a** |
| 9c | **V1** · the live-test queue — [LIVE-TEST-PLAN.md](LIVE-TEST-PLAN.md) | **S** | **New, 8 Aug — not code, and first in line because it is now unblocked for the first time.** PR #11 put B0b, B12, B13 and B3-core on `qa.fleetsettle.com` at 15:03. **Eight checks, written up as their own document** rather than left as prose here, because they need a browser and an environment rather than an editor, and because they have a running order: read-only first, then reversible writes, then the two one-way ones, with **B3's close last — it is irreversible and contaminates every test before it**. The two oldest debts are **GAP-3's confirm loop** (6 Aug; a two-visit test, since `generate-day-cards` runs 20:30 UTC and confirming before it exercises the wrong path) and **B0b's Review/Mine shells**, which sit exactly on the `FirstRunGate` boundary TRACKER §5's standing rule covers — the rule that exists because mocked review shipped GAP-49 and GAP-50 on this same code. **Every live pass so far has found something no source read did** — GAP-49/50/51, GAP-54, GAP-75 — so budget for findings, not confirmation |
| 10a | ~~**B3 remainder** · `WriteOffSheet` + `PostClosureChargeSheet`~~ | — | **Withdrawn 8 Aug — both are phase 2, and this queue is phase 1.** `user-flows.md` marks **F-8.3 write-off** and **F-8.4 post-closure charge** *Phase: 2* on their own headers, and `use-cases.md` §9.1 lists **UC-90 and UC-91 under Second**, by name. B3's checklist in this document asked for both sheets anyway — **the same mistake the 8 Aug B4 pass caught one item earlier**: P10 built the backend ahead of the phase gate, and a plan checklist inherited the endpoint's existence as if it were phase ownership. `docs/` outranks this file. Deferred with its own reason rather than left as an unchecked box; GAP-15 moves out of §4's scheduled table with it |
| 10b | **GAP-81** · void an expense from the client (F-8.5) | **S** | **Promoted out of B9, 8 Aug — it was the phase-1 flow buried in a phase-2-adjacent bucket.** F-8.5 ("correct an ordinary data-entry mistake") is *Phase: 1*, UC-96 is phase **First** by name, and the backend has been live since A9a — `voidExpense` with its `PERIOD_CLOSED` mapping and its own regression test. **Nothing in the client calls it**, so a manager who mis-enters an expense can only fix it through the API. This is the correction path the two withdrawn sheets above were sitting in front of, and unlike them it is genuinely due now. Entry point is the expense's own record, per F-8.5's "open the record → edit or void → reason (required for money)" |
| 11 | **GAP-74** · the partner's all-time balance | **M** | **Promoted into the queue, 8 Aug — it was a hard prerequisite of item 12 with no row of its own.** B4 Wave 1's "What I'm owed" row is UC-67's *"the line he actually reads"*, and `GET /api/partner/{userId}` explicitly declined to compute it in its own schema comment. `earned` is derived from the **open period only**, so an all-time figure means replaying every closed period. Naive fix is a bounded loop over a function that already exists; **a snapshot at period close is the better eventual shape** and must not gate the row. **Do this before B4 starts**, not when B4 reaches the row |
| 11a | **GAP-41** · overheads with no vehicle | S | Track A, but it belongs here: **B4's §7.8 overheads block cannot be built without it**, and W-32 makes that block load-bearing. **Shape decided (8 Aug): a dedicated `GET /api/reports/overheads?periodId=`**, not a tri-state expense filter — "overheads for a period" is report-shaped, and it reuses `sumVehicleCostsForPeriod`'s filter set with `vehicle_id IS NULL`. Needed for B4 **Wave 2**, not Wave 1 |
| 11b | **GAP-72** · the goodwill window's dropped last day | **XS** | **Given a row at last, 8 Aug.** It has sat "outside both orderings" since it was found, which in practice has meant unscheduled: one predicate, a live wrong number in deployed callable code, windowing a business-date question on a UTC `timestamptz` so a June report omits all of 30 June and a Colombo morning waiver can land in the wrong **year**. It rides here because 11/11a/11b are all `queries/reports.ts` — **one trip into that file instead of three** — not because a report nothing renders outranks anything |
| 12 | **B4** · Review shell + phase-1 reports | **L** | The entire product for the partner who reads rather than enters — a real role now, since A11. **Scope settled 8 Aug (0.2): the phase-1 six, not nine** — UC-73/77/78/79 are phase 2 in FL §9.2's own per-row column. Two waves: Wave 1 is the shell, four tabs, the catalogue and the six reports (two of them honestly short); Wave 2 follows GAP-41/70/71. Design and full reasoning in `B4-REPORTS-DESIGN.md`. Still the largest Track B item, but smaller than the XL it was scoped at |
| 13 | **B5** · Mine shell | M | The entire product for the linked driver — a real role now, since A11. `GET /api/driver-view` has been ready since P12 |
| 14 | **A10** · the other two silent zeros | M | Management fee (GAP-39) and incident contribution (GAP-10). Wrong numbers, but only for businesses with a managed vehicle or an open incident |
| 14a | **A13** · change a vehicle's arrangement (F-1.2, GAP-54) | **S–M** | **New, 7 Aug.** A vehicle's arrangement is fixed at creation for life, and the client gates hard on it — a vehicle created as `A` can never book a charter, one created as `B`/`C` can never start a lease. UC-94's own motivating example is exactly that transition, and `use-cases.md` calls it a founding premise §1 relied on and nothing implemented. **Smaller than F-1.2's accept criteria read**: "history keeps its old arrangement" and "a past month's report uses the arrangement in force then" both come free, because **nothing historical reads `vehicle_arrangement`** — reports read `vehicle_day_allocation`, borne-by reads active leases, and the only two queries touching the table are the current badge and gating. **One real dependency: moving *off* arrangement B needs GAP-25 first** (nothing ever ends a `daily_lease`), so B→A/C is blocked until that exists; A→anything is fine, since F-2.6 closes leases. Sits here rather than higher because it is a wall you meet the first time a vehicle changes purpose, not one you are standing at today |
| 14b | **A15** · change a daily lease's driver (F-4.7, GAP-62) | S–M | **New, 8 Aug — flow-inventory audit.** No backend endpoint exists at all — `dailyLease.ts` has only list/start/get — so this is a real Track A item, not a client gap. Paired here with A13: same shape (a fixed-at-creation field with no update path), same severity (a wall met on the first driver swap, not one anyone is standing at yet). **Long downtime already has a workaround per F-4.7's own accept criteria** (assign a spare vehicle, or pay a retainer with no trip attached, F-6.1) — this closes the direct path, not a blocked one |
| 14c | **A16** · a vehicle's trip history (F-5, GAP-77) | S–M | **New, 8 Aug — live QA browser pass.** Neither the read endpoint (`vehicle.ts`'s route-defs have calendar/document/expense/lease/incident/daily-lease, no trip) nor a client section exists — an arrangement-C vehicle's booked/closed/cancelled trips are unreachable from its own detail screen. Paired here with A13/A15: a real gap found live, not urgent, no dependency |
| 15 | **B9** · `UI-UX-REVIEW.md` fixes | M | GAP-44–48: no blocking `Dialog` for INV-1, trip-title truncation, calendar cells fail a screen reader, M-26 landscape wholly unbuilt, M-11's undo toast has no host. Plus **GAP-55** (7 Aug, live): the "Add a driver" form's Name field has no `autocomplete` attribute. **Grew by six, 8 Aug — live QA browser pass**: GAP-76 (generic validation copy), GAP-78 (driver name rendered twice), GAP-79 (vague incident label), GAP-80 (three places leak internal phase references as user copy). Independent — no blockers, blocks nothing — but two of the original five are real WCAG obligations (§10), not polish. **GAP-81 left this bucket 8 Aug** — promoted to 10b, because a phase-1 correction flow with a live backend is not a UI nit |
| 15a | **B15** · quick-add's two payment actions (GAP-82) | **S–M** | **New, 8 Aug.** `QuickAddSheet` ships **3 of M-4's 5 actions** — fuel, expense, new trip. Both payment directions are absent, and M-4 ⚑ names all five. Received has never had a caller here (it needs a party picker; `CollectPaymentSheet` is reached from a lease's own hub, where the party is already known); **made now exists** — B13 built `PayDriverSheet`, reachable only from `DriverDetailScreen`. So the gap is one picker, not two forms, and `EntityPicker` already exists. **This is the half of GAP-63 that B13 did not close**, and the 8 Aug QA triage filed it as "already covered" on the assumption that it would |
| 16 | **B6** · customer detail | S | A4 shipped both reads; this is the party-scoped twin of a screen that already exists. Needs no B0b |
| 17 | **B2** · partners, banking, cash | M | **Checklist grew by two, 8 Aug — flow-inventory audit**: a mileage-package create screen (GAP-67 — the write endpoints exist, nothing has ever called them) and a partner-payout screen (GAP-69 — same shape). Otherwise unchanged: six original screens, all backed by A2. Needs no B0b |
| 17a | **A14** · the printed slip's share link (F-6.6, GAP-65) | M | **New, 8 Aug — flow-inventory audit.** The spec's own "not optional" clause — a signed, expiring, no-login link — has no backend mechanism and no client button anywhere. Ranked below B2 deliberately: it's the larger of the two new Track A items (a signing/expiry scheme is a real security surface, not a form), and F-6.5/F-6.6's read-only content already renders inside `DriverDetailScreen`/B5 — this only adds the *unauthenticated share* half |
| 18 | **A8** · odometer + borne-by preview | S | Completes a shipped form. Blocks nothing |
| 19 | **A7** · R2 upload | M | Unblocks five photo gaps at once — but **no Track B item currently claims the screens** that would use them, so it buys surface rather than product |
| 20 | **A9b** · the rest of soft delete | L | ~15 near-identical void endpoints. A batch to grind, not a design problem |
| 21 | **B7** · offline and the PWA | L | Cross-cutting: it wraps every screen, so building it before the screens exist means rebuilding it per screen |
| — | **In-app "invite a member" screen** — **new, 7 Aug** | S | Not yet its own item. A11 built and tested `POST /api/business-member/invite`/`POST /api/driver/{id}/link-invite` with no caller, the same "endpoint ahead of screen" shape A1/GET-expense already established — deliberately, since it needs B0b's role-aware shell to live in. Size it and give it a letter once B0b lands |

### Two orderings worth arguing with

**10 before 12 (B3 before B4).** B3 has a hard date and B4 does not — but B4 is far larger, so starting B4 first risks month end arriving mid-item. If the business is not yet running real months, swap them: B4's value compounds with every day of data it can show. **Both now sit behind B0b either way**, which is small and shared.

**11, 11a and 11b are Track A items inside the Track B queue, deliberately — and they are now one visit to one file.** Each is small report-query work whose only consumer is B4; scheduling them on Track A's own list would put them behind A10/A8/A7, and B4 would arrive at three separate blocks with nothing to call. They are listed where their consumer needs them, not where their code lives. **The grouping is new (8 Aug) and is the point**: GAP-74, GAP-41 and GAP-72 all live in `queries/reports.ts`, so one context load covers all three instead of three. **GAP-70 and GAP-71 sit the same way but stay in Wave 2**, because both need a `doc-change` (DM §15, UI §11.1) before their query moves — the owning document is where each requirement went missing, not the code.

**GAP-72's row corrects a scheduling failure in this document, not a change of severity.** It was written as belonging "to neither queue's ordering… whenever someone is next in `queries/reports.ts`" — which sounds like flexibility and functions as *never*, and did, for two days. **A one-predicate fix with no owner is not scheduled; it is deferred without saying so.** Nothing renders the goodwill report today (UC-77 is phase 2), so it does not outrank anything on the live-wrong-money rule — it is here because the neighbouring rows make it free.

**10a is withdrawn, and 10b takes its slot, on the owning documents rather than on judgment.** `user-flows.md` marks F-8.3 and F-8.4 *Phase: 2* in their own headers; `use-cases.md` §9.1 names UC-90 and UC-91 under **Second**. B3's checklist in this file asked for both sheets regardless — the third time this document has treated a shipped backend as evidence of phase ownership (P10's write-off endpoints here, P11's nine report endpoints in the B4 scope decision, P2's `opening-balance` in B12's own step list). **The tell is the same every time: the endpoint exists, so the screen feels due.** Meanwhile F-8.5 — *Phase: 1*, UC-96 under **First** — had its client half sitting in B9's small-fixes bucket at rank 15. Correcting the phase reading swaps them, and the swap is the whole refinement: **the correction path a manager needs in week one now outranks two sheets for a phase nobody has started.**

**19 low (A7).** It is the highest ratio of unblocked surface to effort on either track, and it stays low anyway, because unblocked surface is not shipped product while no screen calls it. Promote it the moment a photo screen is scheduled — not before.

**6 and 7 (B11, B10) jumped ahead of A11, which itself was the top of the queue as of yesterday.** The reasoning is a straight severity comparison, not a change of philosophy: A11's absence means two roles have no possible user, which is severe but static — it has been true since before A0 and nothing makes it worse by waiting a few more items. GAP-49/50/51's absence means the **one role that already works is actively broken today**, in production-adjacent QA, for anyone who opens the app in dark mode or tries to run a bus on a daily-fee driver — both ordinary, not edge cases. A live bug in shipped surface outranks a missing plumbing layer for surface that doesn't exist yet, which is the same reasoning that put GAP-3 ahead of A6 on 6 August. **This is now the second time a live/production signal has reordered this queue on arrival** (GAP-3 was the first) — worth noticing as a pattern: nothing about reading source or mocks surfaced either one.

**8a jumps almost everything, and it is the only money defect either external review has produced that this plan did not already have.** The rule this queue has run on since GAP-3 is that live, wrong money on a real person's balance outranks missing surface — GAP-56 is exactly that, it is small, and it is on the path *every* expense takes. It sits behind the two non-code items and B10/B11/A11 only because those are already done; against everything unbuilt it goes first. **A13 (GAP-54) deliberately does not join it**, despite arriving in the same review and the same paragraph of it: a wall you meet when a vehicle changes purpose is a real limitation, but nothing about waiting makes it worse, and no number is wrong while you wait.

**8b (B14) jumps to right behind 8a, on the identical rule, one day later.** GAP-75 is the same shape as GAP-56: live, wrong money on shipped surface, found by a live pass rather than a source read. It is smaller than 8a — one field name in one file — so there's no real case for ranking it anywhere but immediately next in line. Worth naming as a pattern now that it's happened twice from two different live-testing passes on two consecutive days: **a source-only validation pass reliably misses exactly this class of bug**, because the code that's wrong (a display field, not a computation) looks locally correct in isolation and only reads as wrong next to real data.

**9a/9b (B12, B13) ahead of B3, and it's the least settled call in this pass.** The reasoning is that B3 closing a month is only meaningful once a business's *starting point* is honestly on record, and nothing today can enter one — so a real two-partner business going live mid-stream (the running example CLAUDE.md opens with) hits B12's absence before it ever reaches B3's deadline. B13 rides along because it has the identical shape (no dependency, a core Operate-role gap, self-documented missing in one case) and is smaller. **The counter-argument, stated plainly: B3 has an external deadline and B12/B13 don't** — nothing about waiting makes either one worse, the same test that kept A13 out of 8a's jump. Production currently has zero signups (checked 7 Aug), so there is no live month at risk of closing without opening balances *yet* — but the first one that does sign up needs this before their first month, not after. Swap 9a/9b behind 10 if a live business is closer to month-end than to onboarding when this is next picked up.

**GAP-1 is now the sharpest thing in "correct to leave", and it should probably not stay there.** A11 made a `manager` invitable for the first time, and a manager holds `viewReports` across the whole business against UC-70/71/72's "only shared vehicles". The gap itself has not changed — it is still real design work (which table decides "his" vehicles) — but its *reason for being unscheduled* was reachability, and that expired on 7 August. **It is not scheduled here** because it needs a design decision before it needs a queue slot, and this document should not pretend otherwise; the operational guard in the meantime is one line, recorded against B0b: **do not invite a `manager` to a real business yet.**

**A full flow-inventory audit is recommended but not yet sized or scheduled.** GAP-51 (F-1.7) fell through every prior validation pass because those passes compare what's built against what's specced *for the same flow* — they can't notice a flow with nothing on either side. The natural moment to run this is alongside B10, since building it means reading `user-flows.md`'s F-1.x block closely anyway: while there, check every phase-1 flow id (F-0.1 through F-9.x) against both `ui-ux-guidelines.md` (wireframed?) and `web/src` (built?) and file anything else that's missing on both sides the way F-1.7 was. Cheap relative to what it might find; TRACKER.md §5 has the reasoning for why this is now a standing practice, not a one-off.

### What is deliberately not in this list

- **P14 messaging** — twelve Meta approvals outstanding. Fire them now regardless; they queue, and `dispatch-messages` plus six templates are unsized work behind a label that says "external" ([TRACKER.md](TRACKER.md) → Blocked).
- **`WriteOffSheet` and `PostClosureChargeSheet`, and GAP-15 with them** — **withdrawn 8 Aug**, F-8.3/F-8.4 and UC-90/UC-91 are all phase 2 in their own owning documents. The backends shipped at P10 and stay callable; no screen is due. Revisit with the rest of phase 2, or sooner if a real business needs to write off a debt before then — that is a product call, not a build one.
- **The 18 gaps in [TRACKER.md](TRACKER.md) §4's "recorded, unowned, and correct to leave"** (corrected from a stale 19, 8 Aug — a plain miscount, not a dropped item) — each unreachable, unbacked by the schema, or out of scope. Three worth re-reading before a real user arrives: **GAP-25** (nothing ever ends a daily lease — the closing half of the same arrangement B10 starts), **GAP-1** (per-vehicle capability scoping is a business-wide stand-in — do not build UI implying it exists), and **GAP-68** (F-3.5's predictive maintenance prompt — the base recording action already works; only the "prompt next time" half is missing).

---

## Track A — the Worker and shared schemas

| id | Item | Gaps | Endpoints | Blocks |
|---|---|---|---|---|
| **A0** | ✅ **The creator's role** — `owner` → `owner_manager` | GAP-42 | 0 | **everything** |
| **A11** | ✅ **Member and driver access** — done 7 Aug | GAP-43 ✅, GAP-52 ✅, GAP-53 ✅ | 6 + a migration | B4, B5 (get an audience; still need their own screens) |
| **A1** | ✅ Web-P8b's `GET /api/expense` | GAP-33 | 1 | — |
| **A2** | ✅ Partner, banking and cash reads | GAP-9, GAP-4, GAP-31 | 6 | B2 |
| **A3** | ✅ Period, write-off and payment reads | GAP-13, GAP-38 | 4 | B3 |
| **A4** | ✅ Customer-scoped reads | GAP-22 | 2 | B6 |
| **A5** | ✅ Driver history reads | GAP-24, GAP-29 | 1 | B5 (partly) |
| **A9a** | ✅ The void/closed-period hole | GAP-35 | 0 + a migration | — |
| **A6** | ✅ The trip receivable | GAP-23 | 0 + a migration | — |
| **A12** | ✅ **Borne-by by date + the trip receivable's UI** — done 7 Aug | GAP-56 ✅, GAP-57 ✅ | 0 new + 2 changed | — |
| **A13** | **Change a vehicle's arrangement (F-1.2)** — **new 7 Aug** | GAP-54 | 1 | — |
| **A15** | **Change a daily lease's driver (F-4.7)** — **new 8 Aug, flow-inventory audit** | GAP-62 | 1 + client action | — |
| **A16** | **A vehicle's trip history** — **new 8 Aug, live QA browser pass** | GAP-77 | 1 + client section | — |
| **A10** | The other two silent zeros — **new** | GAP-39, GAP-10 | 0–1 + a generator | — |
| **A14** | **The printed slip's signed share link (F-6.6)** — **new 8 Aug, flow-inventory audit** | GAP-65 | 1–2 + client | — |
| **A7** | R2 upload — unblocks five gaps, independent | GAP-16 | 1–2 | B-photos |
| **A8** | Odometer wiring + borne-by preview, independent | GAP-30, GAP-32 | 1 | — |
| **A9b** | The rest of soft delete | GAP-12, GAP-36 | ~15 + a migration | — |

**Endpoint counts are lower than the previous edition's** because validation moved work out of handlers: A6 and A10 add **no new endpoints at all** — they change what existing writes do inside their existing transactions — and A9a is a migration with no endpoint. What is left on this track is mostly domain-layer and SQL, which is also why it is the half that needs the golden fixtures re-run rather than a new screen.

### A0 · Done — the creator's role, and why one word hid the whole product

`createBusiness` assigned `role: "owner"`; it now assigns `owner_manager`. Full chain and reasoning at the top of this document. One word, one test assertion inverted (`business.test.ts` had *pinned* `owner`, so the suite was green while the product was unreachable — the same shape as A9a's own regression test asserting the bug it was meant to catch), and `npm run check` clean.

**Why this was invisible for so long:** every integration test mints its users with `mintUser(db, ctx, businessId, "owner")` — an explicit role argument — so no test ever exercised the role `POST /api/business` actually assigns. The one that did assert it asserted the wrong value. And the web test covering `FirstRunGate`'s `owner` → Review branch was *correct*: the routing was never the bug.

**It does not fix the deployed account.** A0 governs new signups; an existing `business_member` row still reads `owner`. That is a live-data decision (queue item 3b), and it is the difference between "the code is right" and "the user can work."

### A11 · Done — member and driver access

**Shipped 7 August 2026, everything below built as specified except two corrections found along the way** (recorded where they land, further down): migration `0010` (the partial unique index, the audit trigger, `business_member_invite`, INV-31 — `AFTER UPDATE` only, not `INSERT OR UPDATE` as first drafted), six endpoints, `FirstRunGate`'s redeem option. 39 new integration tests; full suite 32 files / 406 tests, 406/406 green against a fresh ephemeral Neon branch; web 81 files / 306 tests. `npm run check` clean. The rest of this section is the plan as it stood going in, kept as the record of what was decided and why — TRACKER.md carries the finished item as one row.

**No second person could exist in a business.** `business-member` was GET-only — no `POST`, no `PATCH`, no revoke. `driver.linked_user_id` was read by `queries/identity.ts` and written by nothing at all. So:

- The passive owner partner — the second of CLAUDE.md's *two* partners, and B4's entire audience — **could not get an account**.
- A `manager` could not be added, so W-49's manager column and every `<Can>` gate B0b builds would have been untestable against a real user.
- No driver could ever sign in, so **B5's Mine shell would have shipped with no possible user**, exactly as Review did until A0.

All three are fixed now — see the "done" summary above.

**The mechanism is now settled — `docs/product/use-cases.md` W-57, `user-flows.md` F-1.4/F-1.8 (v1.2.3/v1.1.3), done the same day this gap was found.** It reuses W-42's driver-linking shape rather than inventing a second one: the owner/owner-manager generates an **invite code** scoped to a role and this business, hands it over out of band, the invitee redeems it at their first sign-in — creating their `app_user` if they've never signed in before, exactly the just-in-time provisioning `createBusiness` already does for the first user. One mechanism, three destinations (`owner_manager`/`manager` via `business_member`, `driver` via `driver.linked_user_id`), which is also why F-1.8 moved to phase one alongside F-1.4 rather than staying a phase-two nicety.

#### What was proposed for this, and settled — 7 August 2026

A design pass asked whether users should hold **multiple roles**, with a **role switcher**, a **super-admin** role that assigns roles, and a **"no role yet"** empty state. **Settled: one role per user per business, no switcher, no fourth role — but yes to the empty state, and yes to real member administration**, which is the need underneath "super admin". Three facts in the code decided it, each checked against the source rather than against this plan's own account:

1. **`owner` and `owner_manager` have identical capabilities.** Every entry in `MATRIX` (`auth/policy.ts`) resolves to `STAFF`, `OWNERS` or `LINKED_DRIVER`, and both owner variants sit in both `STAFF` and `OWNERS`. Nothing separates them but which shell UI §1.1 renders — which is exactly what made A0/GAP-42 a production outage.
2. **`driver` is not a membership role.** `business_member.role`'s CHECK admits only `owner`/`owner_manager`/`manager` (`0001:34`); the driver role is synthesised in `queries/identity.ts` by which row matched. **A partner who also drives is already representable** — a membership row plus `driver.linked_user_id` — with no multi-role machinery at all.
3. **One user belongs to at most one business.** `one_active_business_per_user` (`0003`) is a partial unique index on `user_id`, and `resolveMembership` runs one `LIMIT 1` query per request on that assumption.

**Recorded as declined, per this repository's convention:**

- **Multiple roles per user.** The capability lattice is a total order — `OWNERS ⊃ manager`, staff strictly dominates driver — so the union of any two staff roles collapses to the higher one: `{manager, owner}` *is* `owner`. The one non-degenerate pair, staff + driver, is worse than useless: a staff token already reads every driver's data through A5's `GET /api/driver/{id}/view`, so `viewOwnData` is a **restriction, not a grant**, and unioning it in would make W-49's one hard security boundary depend on which roles happen to be attached. Additive later if a real case appears (a `business_member_role` child table seeded from today's column), so waiting costs nothing.
- **A role switcher.** If the selection reaches the server it is a client-supplied privilege claim — the exact bug class CLAUDE.md bans by name for `business_id`. And `audit_log.changed_by` comes from the token's `sub` via `withActor`: either the audit row is identical whichever role was picked, so the switch is cosmetic and must not gate anything, or it differs and **"who did this" becomes something the client asserted.** In a ledger whose whole promise is being believed about money, that is the last field to make ambiguous.
- **A super-admin role.** `owner` already is one. A fourth staff role above owner, in a two-partner business, has one holder and nobody to administer. What is genuinely missing is not a role but **revoke and re-grant**.
- **Collapsing `owner` into `owner_manager`.** Correct in principle — identical capabilities, and the split has already cost one outage — but it changes UI §1.1, W-49 and DM §3's CHECK, so it is its own `doc-change` pass, not something smuggled into A11. **If a switcher is ever genuinely wanted, this is where it lives honestly: one role, two views, never an authorization input.**

#### What building it needed — done, checked off against what actually shipped

**Migration `0010` — four things, one file** (a fourth, `business_member_invite`, was always implied by "Worker" below but is worth listing with its prerequisites):
- ✅ **Replaced `UNIQUE (business_id, user_id)` with a partial unique index `WHERE revoked_at IS NULL`.** **GAP-52** — without it F-1.4's own alternate (revoke, then re-invite the same person) failed on a unique violation. Proven both ways against a real branch: same role and a different role.
- ✅ **`CREATE TRIGGER business_member_audit` explicitly.** **GAP-53** — `write_audit_log()` reads `NEW.business_id` and `NEW.id`, both present, so nothing else changed. Verified rows land in `audit_log` for both an insert and a revoke.
- ✅ **A deferred constraint trigger, INV-31: every business retains at least one active `owner`/`owner_manager`.** **Shipped narrower than first drafted** — `AFTER UPDATE` only, not `AFTER INSERT OR UPDATE` the way `assert_shares_total`'s shape was copied at first. An `INSERT` can only ever add a row, so it can never by itself zero out the active-owner count; every real removal path (`revokeBusinessMember`, and `changeBusinessMemberRole`'s revoke half) is an `UPDATE`. The `INSERT OR UPDATE` draft broke roughly a dozen existing test fixtures that mint a manager as a business's sole member — TRACKER.md §5 carries the general lesson (don't copy a trigger's statement-type list without re-deriving which statements can actually violate the *new* invariant).
- ✅ **`business_member_invite`** — the F-1.4 counterpart to the pre-existing, previously-unused `driver_link_invite`. Same shape: a hashed code, the plaintext returned once.

**No change to the role CHECK** — all three roles were already admitted, which mattered more than planned: see the UC-03 correction below.

**Worker — six endpoints, one new capability:**
- ✅ `manageMembers: OWNERS` — not `managePartnerCapital`. `W-49` gained the member-administration row this needed (`user-flows.md` v1.1.4).
- ✅ `POST /api/business-member/invite` — reissuing invalidates the prior unredeemed code for the same (business, role).
- ✅ `POST /api/business-member/{id}/revoke` — sets `revoked_at`, guarded in the `WHERE` clause, not read-then-write.
- ✅ `POST /api/business-member/{id}/change-role` — revoke-and-grant, two rows, one call. Never an in-place `UPDATE`.
- ✅ `POST /api/invite/redeem` — no capability gate, one mechanism for both `business_member` and `driver_link` destinations, decided by the code alone. Creates `app_user` just-in-time. The role/driver never comes from the request.
- ✅ `POST /api/driver/{id}/link-invite` + `.../unlink` — **`manageEntities`, not `manageMembers`**, corrected before shipping: F-1.8's own actor is "Manager" (the same as F-1.6, add a driver), and neither ever touches `business_member`. The original plan's assumption that this shared F-1.4's gate didn't survive re-reading the flow doc it cited.
- ✅ Both writes open a transaction (`c.get("writer")` is already wrapped in `withActor`, so this fell out of using it rather than needing a separate reminder).
- ✅ Cross-tenant 404, never 403, proven for every endpoint.

**Client** — `FirstRunGate` gained a second action alongside `CreateBusinessForm`: `RedeemInviteForm`, one field (the code), never a role or business picker. Not distinguishing "brand new" from "revoked", as planned. Copy carries no "admin", no "role". **The `["me"]`-on-403 invalidation landed globally**, not per-screen — a `QueryCache.onError` in `main.tsx`, so every mutation gets it for free rather than each one remembering.

**The one open question this pass didn't resolve got resolved in the docs pass that came first:** F-1.8's steps read *"Match by phone number, confirm identity"* against OQ-2's own resolution rejecting phone matching — `user-flows.md` v1.1.4 rewrote F-1.8's steps to the code mechanism before any code was written, so the endpoint was never built against the stale text.

**A third correction, found reading UC-03 itself while writing the migration:** v1.2.3's invite-role list named only "manager, or a second owner-manager" — the plain, passive `owner` role this project's own two-partner example is built around had no invite path at all, the identical shape of bug A0 fixed for the creator. Fixed in `use-cases.md` v1.2.4 and `user-flows.md` v1.1.4 (F-1.4) before the endpoint shipped — `business_member_invite.role` and `business_member.role` both already admitted `owner`, so this cost no schema change, only the flow text and confirming the endpoint's accepted values matched.

**Do the `doc-change` skill's remaining half — data-model.md — before the migration**, since W-57/F-1.4/F-1.8 are now real enough to need the invite-code table in DM §16's own DDL, not just a description here. The full list of documents this owes is in the [A11 checklist](#a11--member-and-driver-access).

### A1 · Done

`GET /api/expense` shipped in `b2cf367` — every filter optional, newest first, voided rows included, `dailyOperations`. `expense.test.ts` at 20/20.

**It has no caller** (GAP-33), and that is deliberate: §3.3's route map has no business-wide costs route, so the plan's `ExpenseListScreen` was withdrawn rather than built. The endpoint keeps real value — report-adjacent, and every other list endpoint here has shipped ahead of its screen at some point. **Do not add a screen for it without a spec change.**

### A2 · Done

Six endpoints, all shipped: `GET /api/business-member` (GAP-31, `dailyOperations`) · `GET /api/ownership-share`/`capital-contribution`/`management-fee-agreement`/`banking-event`/`partner-payout` (`managePartnerCapital`, except banking-event which shares the write's `dailyOperations` gate) · the composed `GET /api/partner/{userId}` (F-7.6/F-7.3), closing GAP-9 and GAP-4 by derivation, never a write. 25 new integration tests (business-member 4, partner +16, partner-summary 5) in two new files; full suite 31/353, all green. TRACKER.md §2 carries the row.

**One design correction worth carrying forward:** `listOwnershipShares` filters `effective_to IS NULL` alone, not a "latest set per vehicle" grouping — `assert_shares_total`'s deferred trigger structurally forbids two open sets ever coexisting for one vehicle, so the simple filter is provably sufficient. A first draft over-built this; TRACKER §5 has the reasoning.

**One new gap, recorded rather than fixed: GAP-39.** `sumVehicleCostsForPeriod` already reads `obligation WHERE kind = 'management_fee'`, but nothing has ever written one — W-53's "management fee reduces vehicle profit" has been silently a no-op since P7. `GET /api/partner/{userId}` works around it correctly (reading `management_fee_agreement` directly), but UC-70's vehicle-profit figure is still wrong wherever a management fee applies. Unowned; needs a generator, not a read-side fix.

### A3 · Done

Four endpoints/changes, all shipped: `GET /api/accounting-period` (list, newest first, `viewReports`) · `GET /api/write-off` (list, every filter optional, `writeOffOrWaiveAboveThreshold` — the same gate as recording one) · **`GET /api/payment`** (GAP-38, `dailyOperations` — the same gate as recording one; carries the W-49 linked-driver 403 class since a payment names the driver it moved against) · the close checklist's **`unconfirmedDays`** row (GAP-13 — one `COUNT(*)` on `day_record.state = 'open'` scoped to the open period, the same scoping `pendingObligations` already used, cheap and exact since P13). No new table, no new write, no domain layer — four straight filtered reads. 13 new integration tests across the three existing files; full suite 31/366, all green. TRACKER.md §2 carries the row.

**Explicitly out of scope, unchanged: GAP-12.** Void-and-replace stays `expense`-only — that is A9's job, not this one's.

### A4 · Done

Two endpoints, both shipped: `GET /api/customer/{id}/obligation` (outstanding dues only, oldest due first — reuses `findOutstandingObligationsForParty` rather than a second party-scoped query, exactly the trap this item was written to avoid, so this screen can never disagree with what `recordPayment` actually allocates against) and `GET /api/customer/{id}/payment` (reuses `listPaymentsForBusiness` scoped by `partyCustomerId`). Both `dailyOperations`, 404 cross-tenant, both proven against the W-49 linked-driver 403 class. No new table, no new write, no domain layer. 8 new integration tests in the existing `customer.test.ts`; full suite 31/374, all green. TRACKER.md §2 carries the row.

**GAP-22 closes on its backend half only.** `/people/customers/:id` itself still renders `NotBuiltYetScreen` — that placeholder is B6's own item, not a backend gap, and B6 is now ready (B0 done).

**One shortcut this item confirmed rather than avoided:** `obligation` carries `party_customer_id` directly (set at insert, even for a rent due whose `source_type` is `billing_period`), so a customer's dues never needed the lease hub's three-way source reassembly — one direct filter was enough, as the plan predicted.

### A5 · Done

One endpoint: `GET /api/driver/{id}/view`, gated `dailyOperations`, returning both balances, days (excused ones included), closed trips and fees, advances, offsets and the held deposit. 4 new integration tests in the existing `driver.test.ts` (10 total). TRACKER.md §2 carries the row.

**The previous edition said the driver's own view "cannot be reused." That was half right, and the half it got wrong saved the work.** What cannot be reused is the *route* — its gate, and `requireDriverId` as the only source of the id. The **domain function** reuses perfectly: `getDriverOwnView(db, businessId, driverId, from, to)` never read the caller's identity, it took a `driverId` argument all along. So A5 is a new route-def, a new handler and a shared wire mapper (`toDriverViewResponse`, lifted out of the driver-view handler) over an unchanged domain function — which is also what guarantees the manager's screen and the driver's own screen can never print different numbers for the same driver.

**INV-25 is untouched, and worth restating because it reads like a contradiction.** INV-25 forbids a caller-supplied `driverId` on *the linked driver's own* route — and that route still has no such slot. This is a different route with a different gate, and the boundary is proven in both directions: a linked-driver token 403s it for **any** id, including their own.

**GAP-29 closed without building `GET /api/advance`.** The composed read already returns the driver's advances, so a separate advance list would have been a second way to reach the same rows with no screen asking for it — the same reasoning that withdrew B1. Revisit only if a screen ever needs advances *without* the rest of a driver's history.

### What the A6–A10 validation pass found — 5 August 2026

Re-validated against the code, not against this file, the same way the A2/A3 pass was. **Three of the four remaining items were wrong in ways that change the work**, one whole item was missing, and the ordering changed as a result.

1. **A6 makes `bookTrip` period-dependent for the first time.** `bookTrip` never calls `resolvePeriodLinkage` today — booking a charter works regardless of whether an accounting period covers the date. Posting an obligation inside that transaction requires `posted_period_id`, so **booking starts being refusable with `PERIOD_CLOSED` where it currently always succeeds.** That is a behaviour change to a shipped endpoint, not an addition, and it needs its own test.
2. **A trip need not have a customer.** `trip.customer_id` is nullable and `BookTripInput.customerId` is optional, but `obligation` has a CHECK forcing exactly one party. A trip fare therefore cannot always be posted — the branch is real and the plan never mentioned it.
3. **A8's "real decision" is already decided, four times over.** Whether a fuel fill writes its own `odometer_reading` row transactionally is settled by precedent: `lease.ts`, `mileage.ts` and `trip.ts` (twice) all insert one inside their own transaction, and **there is no standalone odometer endpoint at all.** A8 follows the convention rather than opening the question.
4. **A8's borne-by lookup already exists.** `resolveBorneByDefault` already calls `findActiveLeaseForVehicle`/`findCurrentDailyLeaseForVehicle`. What is missing is not a lookup but a way for the form to *show* what the server would decide — a preview read, which is why the client currently has to omit `borne_by` entirely rather than display a default it is forbidden to compute.
5. **GAP-35's fix cannot be a straight revert of `0006`, and cannot reference `NEW.voided_at` unguarded.** `assert_period_open()` is one function shared by **19** tables; only **13** of them have a `voided_at` column. A function reading `NEW.voided_at` raises `record "new" has no field` on the other six. The fix is a column-presence-safe test — ✅ shipped as migration `0008`, A9a below.
6. **GAP-23 is not the only silent zero — it is one of three, and the other two are unowned.** GAP-39 (management fee) is marked `—`, and GAP-10 (an incident's customer contribution) is filed under "correct to leave." All three are the same defect: **an amount somebody has agreed to owe never becomes an obligation, so it reads as zero everywhere.** `incident_recovery.obligation_id` even carries the comment `-- customer contributions become receivable`. They are now **A10**, and A6 is the first of the family rather than a one-off.

---

### A9a · Done — closed GAP-35

Migration `0008` is exactly what was sketched above: `0006`'s exception narrowed to exclude the `voided_at` `NULL → NOT NULL` transition, tested via `to_jsonb(OLD/NEW) ->> 'voided_at'` rather than a direct field reference so the six trigger tables with no such column (`payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim`, `trip`) stay legal. `voidExpense` gained the same `isPeriodClosedViolation` → `PeriodClosedError` mapping every other write already had — it was the one gap the sketch called out and the only place it could be observed today, since GAP-12/A9b's other twelve void-and-replace paths don't exist yet.

**Its own regression test previously asserted the bug.** `expense.test.ts` had "succeeds even after the expense's own period has closed (migration 0006)" — written correctly against `0006`'s actual behaviour at the time, which is exactly the problem: the behaviour it was pinning was wrong. Inverted to assert 409 `PERIOD_CLOSED`, named for GAP-35/migration `0008` instead.

**Two stale comments corrected in the same commit.** Both `domain/expense.ts`'s and `queries/expense.ts`'s doc comments described voiding-after-close as the intended design ("which is what lets this land even after the expense's own period has closed") — accurate when written, wrong now, and exactly the kind of comment that outlives the code it described if nobody reads it against the fix.

**Verified on a fresh ephemeral Neon branch, not the shared dev one** — created via the Neon MCP tools, migrated from `0001` through `0008`, DM §13 drift check clean, then the full suite: **378/378, one pass, no connection flakiness.** That absence is itself informative: every documented flaky run this project has had was on the long-lived shared branch multiple sessions contend for; a branch nobody else touches had none of that. Also surfaced that TRACKER's `api` integration count had drifted to a stale `388` before this item touched anything — corrected there, not a regression here.

**Done means, all met:** voiding an expense posted into a closed period returns `PERIOD_CLOSED`; voiding one in the open period still works; settling a closed-period obligation with a current-period payment still works (the existing `0006` regression tests, unaffected — they never touch `voided_at`); the golden fixtures still land on 134,000 / 15,000 / 7,500 (their own integration tests are part of the 378, all green).

### A6 · The trip receivable — ✅ Done 6 Aug 2026, closed GAP-23

**The design is settled** (post at booking, `kind: 'trip_fare'`, `source_type: 'trip'`, `source_id: tripId`, `due_on`/`effective_due_on` = the trip's end date, void on cancel). The reasoning is recorded in TRACKER §4 and is not reopened here. What follows is only what validating it against the code changed.

**It is a behaviour change to `bookTrip`, not an addition.** `bookTrip` has never touched `accounting_period` — no `resolvePeriodLinkage`, no `posted_period_id`. An obligation needs one, so **booking a charter becomes refusable with `PERIOD_CLOSED` when no period is open**, exactly as `closeTrip` and `recordPayment` already are. Say so in the route-def's responses and test it; a shipped endpoint quietly gaining a new failure mode is how a screen ends up with an unhandled error path.

**`resolvePeriodLinkage` takes a date, but `postedPeriodId` is always the currently open period** — the date only decides `belongs_to_period_id` (W-35). Pass the **booking date**, not the trip's start or end: booking is the fact being posted. `BookTripInput` has no date field today, so it gains one, supplied by the handler from `businessToday()` (never `new Date()`, never `CURRENT_DATE`).

**Only post the obligation when there is a customer and an amount.** `trip.customer_id` is nullable, `BookTripInput.customerId` is optional, and `obligation`'s CHECK demands exactly one party — so an owner-driven charter with no customer row simply raises no receivable. Mirror `closeTrip`'s own guard on the driver-fee side, which already writes nothing when `driverFeeMinor` is 0:

```ts
if (input.customerId !== undefined && input.agreedAmountMinor > 0n) { … }
```

**The migration widens a CHECK, which the guard treats as destructive.**

- The constraint is **unnamed in `0001`** (`kind text NOT NULL CHECK (kind IN (…))`), so Postgres generated the name. **Look it up on the live branch before writing the migration** (`SELECT conname FROM pg_constraint WHERE conrelid = 'obligation'::regclass AND contype = 'c'`) rather than assuming `obligation_kind_check` — `0006`'s header records that this project confirms against the live branch instead of reading the schema, and that is why it was right.
- `DROP CONSTRAINT` matches the `migration/destructive` guard pattern. It needs an inline `-- allow: widening a CHECK is additive; the old set stays valid` — the exemption is the point, so it shows up in the diff.
- Number it after whatever A9a takes. Forward-only, hand-written, one number per migration.

**On cancel, void the obligation — and mind the idempotent path.** `cancelTrip` returns early when `trip.status === 'cancelled'`; that early return must not re-void. Voiding is an `UPDATE` setting `voided_at`, so **it is subject to A9a's new rule** — cancelling a trip booked in a now-closed month will return `PERIOD_CLOSED`. That is correct (it changes a closed month's receivables) and it is exactly why A9a comes first.

**Done means** — booking a charter for a customer raises a `trip_fare` receivable that `listReceivables` shows and `POST /api/payment` allocates against; cancelling voids it; a charter with no customer raises nothing; income still recognises only at close, off `trip.posted_period_id`, and **G-1 still lands on 134,000**.

**What shipped, and the one place it narrowed the sketch above:** everything here landed as written, except the period requirement is scoped to the `customerId !== undefined && agreedAmountMinor > 0n` guard rather than the top of the transaction — an owner-driven charter with no customer touches no period-scoped table at all (the allocation and day-record pause carry no `posted_period_id`), so it stays bookable with no accounting period open, which this section's "booking a charter becomes refusable" line reads more broadly than the actual behaviour turned out to need. `voidObligationBySource` (`queries/obligation.ts`) is source-scoped rather than `trip`-specific, so A9b's remaining void endpoints can likely reuse it. **The one thing this section didn't anticipate:** fixing it broke two *tests*, not the code under test — `accounting-period.test.ts`'s G-1 fixture and `trip.test.ts`'s §7.1 close test both had an ad-hoc `WHERE source_type = 'trip' AND source_id = tripId` query that implicitly meant "the driver-fee obligation" only because nothing else ever shared that source; `trip_fare` now does, and both queries needed the same `direction`/`kind` scoping `sumVehicleCostsForPeriod` (the real report query) already used. Full account in TRACKER.md (GAP-23); 7 new tests, `trip.test.ts` 26→33, G-1 unmoved at 134,000.

### A10 · The other two silent zeros — closes GAP-39 and GAP-10

**New item, and it exists because A6 turned out to have siblings.** Three places in this system take an amount somebody has agreed to owe and never turn it into an obligation. A6 fixes the first. These are the other two, and they fail the same way: a real receivable reads as zero, in a report, forever, with nothing on screen to suggest anything is missing.

**GAP-39 — the management fee that has never reduced anything.** `sumVehicleCostsForPeriod` reads `obligation WHERE kind = 'management_fee'`. The enum value exists; the query is written; **nothing has ever inserted one.** W-53's "a management fee reduces that vehicle's profit" has been a no-op since P7, so every managed vehicle's profit has been overstated by exactly the fee. Needs a **generator**, not a read-side fix — the same shape as `generate-billing-periods`, turning a live `management_fee_agreement` into one obligation per period. Decide deliberately whether it runs on the existing billing-period cron or at period close, and record which; A2's `GET /api/partner/{userId}` reads `monthly_amount_minor` directly and must keep agreeing with whatever this writes.

**GAP-10 — the incident contribution nobody can pay.** `recordCustomerContribution` inserts an `incident_recovery` row with `source: 'customer'` and an `agreedAmountMinor`, and leaves `obligation_id` NULL. The customer has agreed to pay toward the damage and it appears in no receivable, no ageing bucket, and no payment allocation. **`0001` even documents the intent on the column** — `obligation_id uuid, -- customer contributions become receivable`. Post an obligation in the same transaction (`kind: 'customer_contribution'`, which already exists in the CHECK — no migration), set `obligation_id`, and mind that `incident_recovery` separates `posted_period_id` from `received_period_id` deliberately: agreeing and receiving are different months and §7.2 reports both.

**Trap shared by both, and by A6:** these each add a place a void can now happen against a closed period, which is why all three sit behind A9a.

**Done means** — a managed vehicle's profit drops by its management fee in UC-70, an agreed customer contribution shows up as a receivable a payment can settle, and G-2 still lands on 15,000.

### A7 · R2 upload — closes GAP-16, independent of everything else

**One endpoint unblocks five recorded gaps**: condition photos at lease start and close, incident damage photos, expense receipts, and the side-by-side comparison. `attachment` (DM §12) is already generic and polymorphic, its `kind` CHECK already lists every value the five need (**no migration**), and `PhotoCapture` + the tested `photo-pipeline.ts` are built with **0 real callers**.

**Decide the upload path before writing anything, and record it.** IG §10 requires objects be *served* through presigned expiring URLs, never a public bucket — that is about reads, and it is not negotiable (condition photos are dispute evidence and show number plates). It does **not** dictate how bytes get in. Two options, and the plan's title has been quietly assuming the first:

- **Presigned PUT** — the client uploads straight to R2. Needs the S3 API and real credentials signed with `aws4fetch`, i.e. two new secrets, because **a bucket binding cannot presign**. Keeps large bodies out of the Worker entirely.
- **Upload through the Worker** using the `R2` binding (`env.R2.put()`) — no new secrets, no signing library, and the Worker is already the only thing that can authorise the write and insert the `attachment` row in the same breath. The client pipeline compresses before upload, so the bodies are small.

**Recommendation: upload through the binding, presign only for reads.** It is fewer moving parts, needs no credential rotation story, and keeps the `attachment` row and the object from ever disagreeing. Write the reason down either way — this is the kind of choice that gets silently reversed later.

**The bucket exists now.** `api/wrangler.jsonc` gained real `fleetsettle-attachments` / `-qa` buckets in the uncommitted deployment work; before A7 that binding was a `todo-provision-before-deploy` placeholder. A7 depends on that work landing, which is the one external dependency on this track.

**Traps:**
- **`business_id` on the `attachment` row comes from the token**, and reading an object must re-check it. An `r2_key` is guessable if it encodes anything predictable; make it opaque and still verify.
- **`attachment` has no `voided_at` and no `archived_at`** — there is currently no way to remove a wrongly-uploaded photo, and A9 does not cover it because it is not a money table. Decide whether that is a gap or intended, and record it. Do not add a hard delete without deciding.
- **GAP-17 stays open** — the pipeline still runs on the main thread with no Worker + 3s timeout. Unchanged by this item; do not let it look closed.

### A8 · Expense odometer wiring and the borne-by preview — independent

Two small gaps Web-P8b surfaced and recorded rather than guessed at. **Neither blocks anything**, both make a shipped form more complete, and validation shrank both.

**GAP-30 — wire `expense.odometer_reading_id`.** A DB column since P3, never referenced by any schema, query or domain function. The plan called "does a fuel fill create its own `odometer_reading` row transactionally?" the real decision; **the codebase has answered it four times** — `lease.ts`, `mileage.ts` and `trip.ts` (opening and closing) each insert one inside their own transaction, and no standalone odometer endpoint exists at all. Follow the convention: `createExpense` inserts the reading and the expense in one transaction and links them. Its doc comment currently says "a single insert" — update it, since that stops being true. Note the `0005` unique index is partial (`WHERE lease_id IS NOT NULL`), so a fuel-fill reading carries no one-per-day constraint; two fills in a day are two readings, which is correct.

**GAP-32 — a borne-by *preview*, not a second lookup.** The lookup already exists: `resolveBorneByDefault` calls `findActiveLeaseForVehicle` and `findCurrentDailyLeaseForVehicle` today. What the form cannot do is **show** the user what the server will decide, because the client is forbidden from computing §6.7's matrix itself — which is why it omits `borne_by` unless overriding to "Us". One small read (`GET /api/expense/borne-by-preview?vehicleId=&category=`, or the same shape folded onto the vehicle read) returns the resolved default and the party's name, and the form can then display it and offer a real override. **Do not copy the matrix into the client** — Web-P8b's trap list forbids exactly that, and it is the reason this gap exists rather than having been quietly closed.

### A9b · The rest of soft delete — closes GAP-12 and GAP-36

**With A9a's hole fixed, this is ordinary breadth-first work:** ~15 endpoints and one migration. **Nothing in this system is ever hard-deleted, and that must not change** — but a record created by mistake (a test expense, a duplicate driver, a vehicle typed twice) currently has no way out of most tables.

**The rule, stated once:** soft delete only. A money record is **voided** (`voided_at`/`voided_reason`/`voided_by`, with a reason always required — W-50). An entity is **archived** (hidden from pickers and lists, still resolvable by id so historical records that reference it keep rendering). `audit_log` stays undeletable by its own `DO INSTEAD NOTHING` rule, and `accounting_period` is not soft-deletable at all — closing is a structural transition, not a record.

**Where things actually stand, verified table by table:**

| Layer | Mechanism | State |
|---|---|---|
| 13 money tables | the `voided_*` trio | structural on all 13; only `expense` has a domain function and endpoint (GAP-12) |
| the other 6 period-guarded tables | — | `payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim`, `trip` have **no `voided_at`**; `payment`'s undo is `POST /api/payment/{id}/correct` (P9) and `trip`/`lease`/`incident` use `status` transitions. Not gaps — do not add the column |
| `mileage_package` | `archived_at` + endpoint | built — the reference implementation for an entity |
| `business_member` | `revoked_at` | built |
| `vehicle` | `lifecycle` column exists | **no endpoint ever sets it** — hardcoded `"active"` at creation, read-only thereafter |
| `driver`, `customer` | — | **no column at all** (GAP-36); a test row is permanent |
| `attachment` | — | no column either, and **not covered by this item** — see A7 |
| `audit_log` | `DO INSTEAD NOTHING` | correct as-is; never make this deletable |

**In order:**
1. **`archived_at` on `driver` and `customer`** (GAP-36), plus archive/unarchive endpoints. `mileage_package`'s "archive, never delete" is the pattern — copy it rather than inventing a second one.
2. **A `POST /api/vehicle/{id}/archive`** driving the `lifecycle` column that has existed since `0001` and never moved.
3. **Void endpoints for the remaining twelve money tables** (GAP-12), each mirroring `voidExpense`'s proven shape: find-scoped-to-business → 404, already-voided → its own error, then a `writer.transaction` (never a bare update, or `changed_by` records `NULL`).

**Traps:**
- **A void is a money write.** It must open a transaction even though nothing needs atomicity, or `withActor` cannot attribute it (TRACKER.md §5).
- **Voiding a parent does not void its children.** Voiding a `payment` leaves its `payment_allocation` rows, and the obligations they settled, exactly as they were — cascading is a second rule that will diverge from the first. Decide per table whether the domain function unwinds, and record the decision; `correctPayment` (P9) already solved this shape for payments and should be reused rather than duplicated.
- **A voided row stays visible, struck through, with its reason** (W-50) — `VehicleOverviewScreen`'s costs section and the vehicle/trip/incident expense lists already do exactly this. Reuse the treatment.
- **An archived entity must still resolve by id.** A voided expense that references an archived driver has to keep rendering his name; archiving hides him from pickers, it does not orphan history.
- **Never offer this as "Delete."** U-6's reserved vocabulary applies — the interface says "Void" for a money record and "Archive" for an entity, and says which one it means.

**Done means** — a test expense, driver, customer and vehicle each created by mistake can all be reversed out of every list they appear in, none of them leaves the database, a void into a closed period is refused by the trigger, and every one of those reversals names who did it in `audit_log`.

**Track B's half** is small and can follow whenever: a void/archive action on the existing detail screens, using the struck-through treatment that already exists. Not a separate B item — it belongs to whichever screen owns the record.

---

## Track B — the React client

| id | Item | Needs | Status |
|---|---|---|---|
| **B0** | ✅ **The `/more` hub** (GAP-37, GAP-40) | — | done 5 Aug 2026 |
| ~~**B11**~~ | **Structural render fixes** — live-tested 6 Aug, GAP-49/50 | — | ✅ **done 7 Aug 2026** — both closed, plus `color-scheme`, focus restore, and A0's broken typecheck |
| ~~**B10**~~ | **Set up the daily lease (F-1.7)** — GAP-51 | — | ✅ **done 7 Aug 2026** — arrangement B can be started at last; live confirmation pending the `develop` merge |
| ~~**B14**~~ | **Fix the trip receivable's wrong field** — GAP-75 | — | ✅ **done 8 Aug 2026** |
| ~~**B0b**~~ | **The three shells and the capability gate** | — | ✅ **done 8 Aug 2026** — Review/Mine still render placeholders inside the real shells; B4/B5 fill them in |
| ~~**B12**~~ | **Opening balances (F-0.2)** — GAP-61 | — | ✅ **done 8 Aug 2026** |
| ~~**B13**~~ | **Driver money actions — pay, advance, deposit** — GAP-63/64/66 | — | ✅ **done 8 Aug 2026** — needed a backend fix (`recordPayment`'s missing `direction`), not just a screen |
| **B3** | Close the month, corrections | — | ✅ **core done 8 Aug 2026** — `WriteOffSheet`/`PostClosureChargeSheet` deferred, see the "one queue" table's 10a |
| **B4** | Review shell + phase-1 reports | — | the largest item left; scope settled 8 Aug, B0b's shell now exists to build into |
| **B5** | Mine shell | — | ▶ ready now — B0b's shell exists to build into |
| **B6** | Customer detail | — (A4 ✅, B0 ✅) | ▶ ready now, no B0b needed |
| **B2** | Partners, banking, cash | — (A2 ✅, B0 ✅) | ▶ ready now, no B0b needed |
| **B9** | `UI-UX-REVIEW.md` fixes, GAP-44–48 + GAP-55 (GAP-49/50 moved to B11), + GAP-76/78/79/80/81 (8 Aug, live QA browser pass) | — | ▶ ready now, no B0b needed |
| **B7** | Offline and the PWA | **nothing** | ▶ startable, sequence last |
| **B8** | ✅ Real Asgardeo | — | done 5 Aug 2026 |
| ~~B1~~ | ~~`ExpenseListScreen`~~ | — | **withdrawn** — see below |

### What the Track B validation pass found — 6 August 2026

Read screen by screen and route-def by route-def against `web/src/` and `api/src/route-defs/`, the same kind of pass that preceded A2/A3 and A6–A10. **The headline finding is structural and it is the same shape as GAP-37**: three items depend on plumbing that does not exist and none of them owns it.

1. **There is no way to render anything but the Operate shell.** `RootLayout` (`router.tsx`) hardcodes `shell="operate"`, and `FirstRunGate` takes exactly one render prop, `renderOperate` — `owner` and `driver` both fall through to `NotBuiltYetScreen` with no branch to fill. `AppShell` itself is ready (`shell="review"` renders `REVIEW_TABS`, `shell="mine"` renders no tab bar, both tested), but nothing can reach either. **B4 and B5 are each blocked on the same missing branch**, and the Review shell additionally needs its four tabs wired to routes that do not exist yet.
2. **The role is not available anywhere outside `FirstRunGate`'s own local query.** `MeResponse` is a local interface in that file (documented as the one deliberate exception to the shared-schema rule). B3's close action must be **absent for a `manager`** (M-22/W-49) and B4's catalogue must not offer a card the role cannot fetch — neither can be built without reading the role somewhere else.
3. **`lib/capabilities.ts` and `<Can>` do not exist**, though UI §12.4 specifies both concretely, down to the signature. B3 and B4 are their first two callers. This is the third leg of the same prerequisite.
4. **§7.8's "Overheads (no vehicle)" block cannot be built from any endpoint that exists.** `GET /api/reports/vehicle-month` returns `{ period, vehicles[] }` — per-vehicle only, no overheads row. `GET /api/expense`'s `vehicleId` filter is *optional-means-unfiltered* (`filters.vehicleId !== undefined ? eq(…) : undefined`, `queries/expense.ts`), so there is no way to ask it for "expenses with **no** vehicle" — omitting the filter returns every expense including the vehicle-attributed ones. W-32 makes this block load-bearing (overheads are never spread across vehicles), so it is not droppable. **New gap, GAP-41**, and it needs a small Track A increment, not a client workaround — summing a full expense list client-side to derive a report figure is aggregation outside SQL.
5. **The chart palette in UI §11.2 is eight raw hex pairs, and raw hex is forbidden.** CLAUDE.md is unambiguous ("No raw hex anywhere… colour comes from `--color-*` tokens"), and §11.2's values are validated for CVD contrast against this project's own surfaces, so they are correct values in a form the rules refuse. They become `--color-chart-1…8` tokens in `tokens.css` with both light and dark values, **and each one must also be added to `cn.ts`** or tailwind-merge silently drops it. Not a gap — a conversion step B4 must not skip.
6. **`GET /api/audit-log/{tableName}/{recordId}` is per-record, not a feed.** B3's line "`Timeline` finally wired to real `audit_log` data" is buildable for *one record's* history (a corrected payment's trail, which is what F-8.6/UC-97 actually asks for) but not for a "what happened this month" list on the close screen. Wire it to the record, not the month.
7. **Two of the nine reports are owner-only and three need parameters the catalogue must collect before it can fetch.** Detail in B4 below — this is the one place where "nine tested endpoints, no interface" understates the work, because a catalogue of nine links is not sufficient for four of them.

### B11 · Done — structural render fixes, and two bugs that were not what they looked like

**✅ Done 7 August 2026.** Both closed, and both turned out to be one layer deeper than the write-up below said — the original text is kept as-is underneath, because the difference between what a live session *observes* and what is actually *causing it* is the point.

**What actually shipped:**
- **GAP-49** — a `@layer base` block in `tokens.css` paints `--color-page` and `--color-ink-primary` on `html` itself. `AppShell`'s own `bg-page` is now redundant and was left alone. It also surfaced that **`color-scheme` was declared nowhere in the client**, so the UA canvas, scrollbars and native controls stayed light under a dark theme — the same bug one layer down, fixed in the same block, with the two-selector shape that lets the in-app toggle beat OS dark. Verified in a real browser both ways: dark `#0d0d0c`/`#f5f5f0`, light `#f1f1ec`/`#14140f`. `tokens.test.ts` asserts the rule stays.
- **GAP-50** — **the violation fires on open, not close.** `vaul` ships `autoFocus: false` and preventDefaults Radix's open-auto-focus (so a drawer does not summon a phone keyboard), which leaves focus on the trigger — inside the background Radix has just marked `aria-hidden`. `autoFocus` on `Drawer.Root` closes it. Testing that then exposed **a second bug nobody had reported: focus restore had never worked at all.** Radix's modal `DialogContent` always redirects close-focus to its own `triggerRef`, set only by a `Dialog.Trigger`; every sheet here is driven by an external button, so closing one dropped a keyboard user at `<body>`. Fixed with an `onCloseAutoFocus` restoring to the opener, tracked via a `focusin` listener because React runs a child's effects before its parent's. `ActionSheet` is built on `Sheet`, so the nested case came free.
- **Three tests in `e2e/sheet-a11y.spec.ts`, each verified to fail without the fix.** The first version of that spec was a **false green** — headless Chromium computes the a11y tree lazily, so without `Accessibility.enable` over CDP the warning is never emitted and the assertion has nothing to see. TRACKER §5 carries this as a standing trap; it is the kind of test failure that hides in the passing direction.
- **Not in scope, fixed in passing: `npm run typecheck` had been broken since A0.** `NewBusinessMember.role` was typed as the literal `"owner"`, so A0's one-word change did not compile. Now `BusinessMemberRole` from `packages/shared`.

---

**Two bugs, found the same way, twenty minutes apart, on 6 August: driving a real browser against `qa.fleetsettle.com` instead of reasoning from source or mocks.** Both are already shipped and already broken; neither needs anything else to land first.

**GAP-49 — `AuthGate` and `FirstRunGate`'s fallback screens render with no page background anywhere in their DOM.** Confirmed by walking computed styles from `<h1>` to `<html>`: every ancestor is `background-color: rgba(0,0,0,0)`. `Screen.tsx` sets no background of its own — only `AppShell.tsx`'s root div carries `bg-page` — and `AuthGate`'s loading/sign-in states plus `NotBuiltYetScreen` (`FirstRunGate`'s `owner`/`driver` fallback) all render `Screen` directly, never nested in `AppShell`. Invisible by coincidence in light mode; in dark mode `--color-ink-primary` (`#f5f5f0`) renders straight onto the browser's default white canvas — the sign-in screen's own heading and body text are functionally illegible. **Fix structurally, not per call site** — this project's own established pattern (TRACKER §5's three form bug classes: fixed once each, not per-form). A baseline rule on `html`/`body` (or on whatever wraps the router at its very root) setting `background: var(--color-page)` closes the whole defect class, including any future screen that forgets to nest in `AppShell` the same way these two did. Verify both colour schemes after.

**GAP-50 — closing a `Sheet` can leave `aria-hidden` on an ancestor of a still-focused element.** Reproduced twice live: closing "Add a vehicle" (single sheet) and closing "Add a driver" from within the "Add" chooser (nested sheet, the second case naming a Radix-generated dialog-content div as the offending ancestor). `Sheet.tsx` is built on `vaul`'s `Drawer`, credited in its own doc comment for "focus trap, `aria-modal` and focus restore" — this is that mechanism's inert/`aria-hidden` background technique racing focus return, worse when sheets stack. **This supersedes B9's own "low confidence" nested-`Sheet`/`AmountPad` note** (below) — it is not one nested interaction, it is the primitive itself. Needs investigating `Sheet.tsx`'s close sequencing (does `aria-hidden` get applied before or after focus is confirmed to have left the subtree) rather than a per-screen workaround, since every sheet in the product shares this one component.

**Traps:**
- **Don't patch this per screen.** Both bugs are one-line-of-cause, many-screens-of-symptom — `NotBuiltYetScreen`/`AuthGate` today, any future screen built outside `AppShell` tomorrow for GAP-49; every `Sheet` caller for GAP-50. Fix where the cause is.
- **Re-verify GAP-49 in both colour schemes** — the bug is invisible in light mode by coincidence, so a light-mode-only check will pass and ship it again.
- **GAP-50's fix should be verified against a stacked-sheet close specifically**, not just a single sheet — that's the case that named the Radix content div rather than a plain button, suggesting the depth of nesting matters to when the warning fires.

**Done means** — the sign-in screen and both `NotBuiltYetScreen` placeholders are legible in a dark-mode browser; closing any single or nested sheet produces no `aria-hidden`/focus console warning.

### B10 · Done — set up the daily lease (F-1.7)

**✅ Done 7 August 2026, closing GAP-51.** `StartDailyLeaseScreen.tsx` + a `/vehicles/$vehicleId/daily-lease/new` route + a "Start a daily lease" row in the vehicle-actions menu, offered for arrangement B or no active arrangement and hidden for A and C. Built to F-1.7's four steps with **no vehicle field** — the flow is entered from a vehicle, so `vehicleId` comes from the route exactly as `StartLeaseScreen` takes it. The amount starts empty and is **never pre-filled from `driverDayFeeMinor`**, for the reason recorded at length below. 409 `DAILY_LEASE_OVERLAPS` surfaces as an ordinary outcome. 4 unit tests, 5 gating tests, and a full-flow e2e in a real Chromium at 360×640 and 320px.

**One checklist item is deliberately still open: the live-environment confirmation.** Creating a daily lease and watching `generate-day-cards` produce a real day-record placeholder, confirmable through F-4.2, is the check **GAP-3's own fix has been waiting on** — and it needs `build/p0-foundation` merged to `develop` first, which is queue item 4 and a deploy decision rather than a build step.

---

**The backend has been ready since P2/P5 and nothing has ever called it.** `api/src/route-defs/dailyLease.ts`'s own doc comment names the flow outright — *"F-1.7 / UC-05 — starting arrangement B"* — and `startDailyLeaseRequestSchema` (`packages/shared/src/schemas/arrangement.ts:46-56`) is a complete, validated shape: `vehicleId`, `driverId`, `patternType` (`every_day` / `alternate` / `weekdays`), `patternWeekdays` (required exactly when `patternType` is `weekdays`), `effectiveFrom`, `effectiveTo` (optional), `dailyLeaseAmountMinor`. `POST /api/daily-lease` returns 201 with the lease and its first rate, 404 for a vehicle/driver outside the business, 409 for an overlapping daily lease on the same vehicle (`DM §7`'s exclusion constraint — catch it, don't pre-check).

**Confirmed missing three independent ways, live on 6 August**, so this isn't a guess about where the gap is: the vehicle-actions menu offers only View calendar / Record expense / Report incident; the calendar's free-day tap-through is correctly scoped to F-2.1/F-5.1 only (arrangement A/C — F-1.5's own spec says exactly this, so the calendar was never supposed to host F-1.7 and isn't a candidate fix location); "Add a driver"'s only level-2 section is "Fees and mobile" (day/trip fee defaults for prefill, not an assignment). `docs/design/ui-ux-guidelines.md` has zero mentions of F-1.7 — it was never wireframed, which is almost certainly why it was never built; there's nothing in §7's screen-by-screen inventory to build against.

**No wireframe exists in §7, but F-1.7 itself specifies the steps and they are fewer than a first read suggests — four, not five, and *no vehicle step at all*:**

> **Steps** 1. Driver. 2. Pattern (every day / alternate / chosen weekdays), with individual days skippable. 3. Amount owed per operating day. 4. Effective date, optional end date. — `user-flows.md` F-1.7

1. **Driver** — `EntityPicker` over `GET /api/driver`, already in the inventory and already used by `StartLeaseScreen` for customers.
2. **Pattern** — `every_day` / `alternate` / `weekdays` as `aria-pressed` chips (`chipClass`, the pattern `StartLeaseScreen` uses for term and mileage), the last revealing a weekday multi-select (`patternWeekdays`) exactly when chosen.
3. **Daily lease amount** (`dailyLeaseAmountMinor`) — a `MoneyField`, **with no prefill** (see below).
4. **Effective date**, optional end date — `DateField`s, `effectiveFrom` defaulting to today.

**The vehicle is context, not a field** — F-1.7 has no vehicle step because the flow is entered *from a vehicle*, exactly as F-2.1 is. `StartLeaseScreen` already models this precisely: `vehicleId` is a prop from the route, never a picker. Mirror it (`/vehicles/$vehicleId/daily-lease/new`) rather than inventing a picker the spec does not ask for and the entry point makes redundant.

**U-2 applies as always**, and with only four steps the split is nearly forced: driver, pattern and amount are level 1; an effective date defaulting to today with the end date behind a `More` disclosure matches how `StartLeaseScreen` already splits this exact kind of field list.

**One copy decision to make deliberately, not by default.** F-1.7's own step 3 reads "Amount owed per operating day", but §9.6's vocabulary lock reserves **"Daily lease amount"** for this exact figure ("Never say: rate, daily rate") and says the UI uses the reserved words "and only them". The two do not conflict — one is the flow doc describing a step, the other is the on-screen label — but the label should be **"Daily lease amount"** and the descriptive phrase, if wanted, belongs in helper text beneath it.

**And a correction this plan's previous edition got wrong, which is worth stating plainly because it is the exact bug the vocabulary rule exists to prevent.** That edition said the amount should be "prefilled from the driver's own default per-day rate if F-1.6 set one (U-3)". **It must not be.** The field F-1.6 writes is `driverDayFeeMinor` (`packages/shared/src/schemas/driver.ts:23`) — the **driver day fee**, money *you pay him* on a charter. `dailyLeaseAmountMinor` is money *he pays you*. They are the two opposite directions CLAUDE.md names outright as the pair that must never both shorten to "rate", and prefilling one from the other would seed a plausible, wrong, unnoticed figure into every daily lease created — a number that is wrong in the direction that costs money and that nothing downstream would flag. **The driver record carries no default for the daily lease amount and should not be made to; this field starts empty.** If a prefill is wanted later, the only defensible source is the same vehicle's previous daily lease, not anything on the driver.

**Traps:**
- **GAP-20 is already-recorded, correct-to-leave, and this item doesn't need to fix it**: `isPatternDay`'s "alternate" reference point is a judgment call, and F-1.7's own "individual days skippable" has no column to hold an exception yet. Build against `patternType`/`patternWeekdays` as specified; don't invent a skip-days field the schema doesn't have.
- **A 409 on overlap is expected, not exceptional** — a vehicle already mid-daily-lease refuses a second one over the same dates. Surface it, don't pre-check by fetching the vehicle's existing leases client-side first.
- **This is the create half only.** GAP-25 (nothing ever ends a daily lease) is the close half, already recorded, unowned, and explicitly out of scope here — don't scope-creep this item into building that too.
- **Where this screen is entered from is itself a decision** — a vehicle's own "Vehicle actions" menu (alongside View calendar / Record expense / Report incident, where this session went looking for it and found nothing) is the most discoverable candidate, but confirm against whatever a design pass produces rather than assuming.

**Done means — F-1.7's own three Accept criteria, which are all testable:** cards generate from the effective date forward **on pattern days only** (§4.2 — days outside the pattern are `not_scheduled`, generating no card and counting as neither operated nor lost, `user-flows.md:260`); borne-by defaults come from W-7 with no per-vehicle configuration; **setting an end date stops generation without deleting past cards.** Practically: a manager opens a vehicle, starts a daily lease, and from that point forward `generate-day-cards` produces real day-record placeholders for it, confirmable through F-4.2 exactly as GAP-3's fix expects. **This is also the item that unblocks verifying GAP-3 against a live environment** — which this session set out to do and could not, because no daily lease could be created to test it with.

### B14 · Done — fix the trip receivable's wrong field, GAP-75

**✅ Done 8 Aug 2026.** Fixed exactly as scoped below: `receivableRow` now renders `amountMinor`. Both tests that had pinned the bug (asserting `/Due.*Rs 0/` as correct) inverted to assert the real figure (`/Due.*Rs 60,000/` in the fixture's own numbers) — the same "regression test pins the bug" shape this repo has hit twice before. `commit 853c916`.

---

**Found by the live QA browser pass, not by any source read.** [TripDetailScreen.tsx:132-138](web/src/features/trips/TripDetailScreen.tsx#L132-L138) renders `Money value={parse(receivable.settledMinor)}` next to the obligation's status label. `settledMinor` is the amount **collected so far** — for a `pending` receivable that is `0` by construction, so every unpaid trip with a real customer and a real agreed amount shows "Due · Rs 0", indistinguishable from nothing being owed at all.

**The fix is one field, and the correct pattern already ships elsewhere in the same codebase.** [LeaseHubScreen.tsx:247](web/src/features/leases/LeaseHubScreen.tsx#L247) renders `due.amountMinor` for the identical `leaseObligationRowSchema` shape — the full agreed amount beside the status label, so "Due · Rs 555" reads correctly. Change `TripDetailScreen`'s `receivableRow` to the same field.

**Why this is 8b and not further down: it is a regression inside A12's own work, found the day after A12 shipped.** A12 (GAP-57) fixed the *status* logic — before it, this row was a hardcoded `NotAvailable`. The amount next to that status was never right; A12's own tests asserted the row rendered *something*, not that the something was the correct figure. Add a regression test for a booked trip with a customer, an agreed amount and nothing yet collected, asserting the rendered amount is the agreed amount, not `0`.

**Done means** — a trip with `Rs 555` agreed and `Rs 0` collected shows `Due · Rs 555`; a part-paid trip shows the full agreed amount beside `Part paid`, matching `LeaseHubScreen`'s own convention exactly.

### B0b · Done — the three shells and the capability gate

**✅ Done 8 Aug 2026.** Shipped close to plan, three corrections worth recording:

- **`/api/me` is a real route-def now** (`route-defs/me.ts` + `handlers/me.ts`), and `meResponseSchema` lives in `packages/shared`. `requireRole()` added to `auth/context.ts` alongside the existing `requireBusinessId`/`requireUserId`, rather than a non-null assertion in the handler.
- **`<Can>` reads the `["me"]` cache directly, not through `useMe()`.** `useMe()` throws if called before the cache is populated (a real bug signal everywhere else it's used) — but sign-out (GAP-40) clears the query cache *before* the real navigation completes, and in that narrow window a still-mounted `<Can>` must degrade to "hide," not crash the screen it's gating. Found live, testing the interaction, not planned.
- **Review's four tabs are four flat routes** (`/review`, `/review/vehicles`, `/review/money`, `/reports`), each redirecting a mismatched URL to `/review` via an effect — not a nested tab-route tree. Mine is one route, `/me`. Both render `NotBuiltYetScreen` placeholders; B4/B5 fill in real content.
- **"Owner-manager reaches Review through More → My share" was not built here** — no such row exists yet. That's B4's own entry point to build when it lands, not B0b's plumbing.

`commit cd14d5d`. The original plan below is kept as the record of what was scoped going in.

---

**Small, and it unblocks three items.** Exactly the B0 situation: two or more items need it, none owns it, and each would otherwise build its own half-version. Nothing here is a screen; it is the plumbing every role-aware screen after it assumes.

**What lands:**

1. **`meResponseSchema` in `packages/shared`**, replacing `FirstRunGate`'s local `MeResponse` interface. That interface is documented as the one exception to clause 2 of the two-track contract, and the exception only held while exactly one screen read it — B3 and B4 make it three. `/api/me` is a plain Hono route with no route-def; giving it one is a Track A commit, and it is the only backend work B0b needs.
2. **A `useMe()` hook over the existing `["me"]` query key**, so role is read the same way from anywhere without a second fetch. `FirstRunGate` already populates that cache entry.
3. **`lib/capabilities.ts` — the W-49 matrix, client-side**, exactly as UI §12.4 specifies: `can(role, cap)`, one entry per row. Copy the rows from `api/src/auth/policy.ts` and say in the file that it is convenience only and the Worker re-checks every one.
4. **`<Can cap="…">`** — renders nothing when the role lacks it. **Absent, never disabled** (M-22): a disabled control tells a manager the feature exists and he is untrusted, which is a different message from the one the product intends.
5. **`FirstRunGate` gains `renderReview` and `renderMine`**, and `RootLayout` stops hardcoding `shell="operate"`. Review renders `AppShell shell="review"` with its four tabs (`This month · Vehicles · My money · Reports`) wired to real routes; Mine renders `shell="mine"` with no tab bar at all.
6. **The Mine shell is a different component tree, not a filtered Operate** (§7.9: "not disabled, not hidden behind a role check in a shared component"). B0b establishes that boundary; B5 fills it in.

**Traps:**

- **`REVIEW_TABS` already exists and is already tested** — do not add a fifth or reorder it. `AppShell` takes `activeTab`/`onTabChange`; the work is routes and a `tabForPathname` equivalent, not a new shell component.
- **The owner-manager is not a fourth shell** (§3.1, M-3). He gets Operate, and reaches the Review screens through **More → My share** as the same components rendered read-only. Do not branch him into `shell="review"`.
- **`can()` is never the security boundary.** Every capability is re-checked in the Worker and the driver boundary is `driver_id` scoping in the data layer (§12.4, TS §2). A test asserting the client matrix must not read as if it were proving access control.

**Done means** — an `owner` token lands in the Review shell with four working tabs, a `driver` token lands in a tab-less Mine shell, a `manager` sees no close-month affordance anywhere, and `can()` has a unit test per W-49 row.

### B0 · Done — closed GAP-37 and GAP-40, and three B items no longer wait on anything

`/more` is a real screen now (`MoreScreen.tsx`), not `NotBuiltYetScreen` — the door §3.3 gives `/cash`, `/partners/:id`, `/reports` and `/period/close` exists, even though none of them has anything on the other side of it yet. **Rows for what exists only**, as planned: today it is one row, sign-out; Reports arrives with B4, Cash with B2, Close the month with B3, each adding its own row rather than the hub pointing at a placeholder.

**Sign-out (GAP-40) needed a second piece of plumbing, not just a button.** `useAuthContext().signOut` is a hook value, and B8 had already solved the same problem once for `getAccessToken` — a module-level slot in `auth-asgardeo.ts` that `AuthGate` fills on mount, read by code built before React exists. `registerAsgardeoSignOutSource`/`createAsgardeoSignOutGetter` is the same shape, added alongside it. A new `AuthActionsContext` (mirrors `ApiContext` exactly — same `createContext`/`useX`/"throws if called outside its provider" shape) is what lets `MoreScreen` reach `signOut()` without importing the SDK, and it is the layer that owns the trap below: `useAuthActions().signOut()` calls `queryClient.clear()` **before** the raw sign-out, never after, because the raw call is a real navigation in real auth mode and nothing queued behind it would run.

**The confirm is a `Sheet`, not `Dialog`.** `Dialog.tsx`'s own docstring reserves it to INV-1, INV-17 and M-10 — three call sites, never a general "are you sure" — and sign-out is reversible (sign back in) and not one of them. Worth recording since this plan's own earlier wording ("one row, one call, one confirm") could have been read as calling for the reserved component.

**The close-month row trap (M-22/W-49: absent for a `manager`, not disabled) doesn't apply yet** — there is no close-month row until B3 lands. Carried forward to B3's own section rather than dropped.

20 new tests across 5 files (2 new: `AuthActionsContext.test.tsx`, `MoreScreen.test.tsx`); web 79 files / 290 tests, `npm run check` clean.

### B1 · Withdrawn, and why

The previous edition named an `ExpenseListScreen` for Web-P8b. **It was not built, correctly.** UI §3.3's route map has no business-wide costs route at all: `/vehicles/:id` already covers costs per-vehicle (Web-P5, read-only), and §3.1 puts F-3.1/F-3.3 under the **`＋` Add** tab — "not a destination, no route change" — never under a list screen. `docs/` outranks the plan.

Recorded rather than quietly dropped, so the same screen is not proposed a third time. `GET /api/expense` keeps its own value and its own gap id (GAP-33).

### B4 · The Review shell and phase-1 reports — B0b done, ready

**Nine tested endpoints and no interface. The partner whose entire use of this product is reading reports has nothing until this ships** — `FirstRunGate` sends the `owner` role to `NotBuiltYetScreen` today.

**Scope settled 8 August (0.2). B4 builds the phase-1 six: UC-70, 71, 72, 74, 75, 76.** FL §9.2's report catalogue carries an explicit per-row **Phase** column tagging UC-73, UC-77, UC-78 and UC-79 as phase 2; `use-cases.md` §9.1 and UI §15 agree. P11 shipped nine endpoints ahead of that gate and this plan's title took the endpoint count for a scope. Two of the three excluded reports cannot satisfy their use case today regardless of phase (UC-77 → GAP-73, UC-79 → GAP-19). **Full design, all eleven decisions and the report-by-report evidence: `B4-REPORTS-DESIGN.md`.**

**Backend increments: five, not one.** §7.8's overheads block still has none (**GAP-41**), and the verification pass found four more — **GAP-70** (cash position loses banked money), **GAP-71** (lost-day reasons, phase 1, and UI §11.1 dropped it too), **GAP-72/73** (goodwill), and **GAP-74**.

**GAP-74 is the one that is in Wave 1, and it is worth reading before scoping this item.** §7.8's "What I'm owed" row is **UC-67's partner balance, all-time** — confirmed by the owner 8 Aug. UC-67's own closing line: *"the passive owner's real question is not 'what did the cars make' but 'what am I owed, and by whom'. §4.5 gives him sixty seconds a month, and **this is the line he actually reads**"* — and §4.5 is §7.8. But `earned.profitShareMinor` is *derived from the open period only* and nothing stores a closed period's share, so `GET /api/partner/{userId}` **cannot produce it**; its own schema comment declines the work as "a different, larger feature". Wave 1 cannot ship §7.8 without its most important row, so the loop over closed periods goes in. A snapshot at period close is the better eventual shape and must not gate it.

**Two waves, cut by contract completeness — not by shell-versus-catalogue.** The design review proposed a Review-core slice then a catalogue slice; that ordering puts the blocked work first, because the Review shell's `This month` tab is what GAP-41 gates while the catalogue's UC-71 and UC-74 are unblocked today.

| Wave | What | Gated on |
|---|---|---|
| **1** | Shell routing, four tabs, catalogue, all shared infrastructure, **all six reports** (UC-75 retitled, UC-76 without reasons), `My money`, read-only vehicle screen, `This month` minus overheads, **owner-manager's More → My share** | B0b + **GAP-74** |
| **2** | Overheads block (GAP-41) · UC-75 completed and retitled back (GAP-70) · UC-76's reason chart (GAP-71) | three Track A increments, two needing a `doc-change` first |

**Two Wave 1 screens ship honestly short, and one of them needs a defensive title.** **UC-75** is titled **"Cash partners are holding"** until GAP-70 lands — `heldMinor = received − banked − advanced` is arithmetically right but the response has no field for either subtrahend, so banked cash leaves the partner figure and appears nowhere; calling that "Where is our cash" is the confident-wrong-number failure W-56 exists to prevent. **UC-76** needs no qualifier — every figure it shows is complete, and the missing piece is a second chart.

**Screens** — `web/src/features/reports/` and `web/src/features/review/`: the Review shell's four tabs, a report catalogue, one screen per report. New routes `/reports`, `/reports/:key`, and whatever the three non-Reports tabs resolve to.

**The nine, with what each one actually needs from the caller** — the three phase-2 rows kept for reference, marked, because whichever item picks them up needs the same table. **Six of the nine, not four, need parameters the catalogue must collect first** (UC-70, 72, 76, 77, 78, 79); the earlier "four" contradicted this table's own rows. Of B4's six, only three need any.

| Report | Endpoint | Caller must supply | Gate | Form (§11.1) |
|---|---|---|---|---|
| UC-70 this month | `/reports/vehicle-month` | **`periodId`** (+ optional `vehicleId`) | `viewReports` | KPI row + horizontal bar per vehicle |
| UC-71 trips that made money | `/reports/trips` | — | `viewReports` | Ranked horizontal bar, direct-labelled |
| UC-72 fuel efficiency | `/reports/fuel-efficiency` | **`vehicleId` + `from` + `to`** | `viewReports` | Line, single series |
| UC-74 who owes us | `/reports/receivables` | — | `viewReports` | **Table**, not a chart |
| UC-75 **cash partners are holding** | `/reports/cash-position` | — | `viewReports` | Stat tiles + stacked bar (held vs ours) — **retitled until GAP-70** |
| UC-76 lost days | `/reports/lost-days` | **`from` + `to`** | `viewReports` | Column per month + weekday distribution — **reasons missing, GAP-71** |
| ~~UC-77 goodwill given~~ *(phase 2)* | `/reports/goodwill` | **`from` + `to`** — a **year**, per UC-77's own first line | **`viewOwnerOnlyReports`** | Single number + table by reason — **not buildable, GAP-73** |
| ~~UC-78 ageing~~ *(phase 2)* | `/reports/ageing` | **`asOfDate`** | `viewReports` | Stacked bar of buckets + table — the only phase-2 report whose contract is complete |
| ~~UC-79 utilisation~~ *(phase 2)* | `/reports/utilisation` | **`vehicleId` + `from` + `to`** | **`viewOwnerOnlyReports`** | Stacked bar per vehicle — **endpoint is one vehicle per call**; GAP-19 still open |

**`periodId` comes from `GET /api/accounting-period`** (A3), which is also §7.8's own `July 2026 ▾` picker — one query serving both. **A vehicle picker is needed for one report in B4** (UC-72; UC-79 would be the second) and `EntityPicker` already exists. **UC-73 (the year) is not in this list and must not be built** — it is GAP-18, product-phase Second, even though §11.1's table has a row for it.

**Parameters live in the URL** (`/reports/:key?…`), not only in component state — a report someone is looking at should survive a refresh and be sendable to the other partner, which is the exact situation this product exists for. `/reports/:key` validates its search params and renders the parameter form when they are missing, so the route is never dead.

**Both owner-only reports are phase 2, so `viewOwnerOnlyReports` has no caller in B4.** Every card in the catalogue is gated by `viewReports` alone. The trap below is still the right rule and still how the catalogue is built, but in B4 nothing exercises it — it is dormant, not wrong, and it re-arms the moment either report lands. **Replace the planned "a `manager` never sees the owner-only cards" test with the one that has teeth: a `driver` cannot reach `/reports` at all** (route-level, a W-49 boundary rather than a convenience).

**§7.8's hero comparison is two fetches, and the delta is a percentage of money.** `▲ 12% vs June` needs `vehicle-month` for the current period *and* the one before it, then a ratio. That ratio is a `number` derived from two `bigint`s — legitimate, and it needs the same treatment `profitPerKm`/`kmPerLitre` already carry: an explicit lint disable with the reason recorded, computed in one place, never a `Number()` on either operand independently.

**The one hard problem, and it needs deciding before any chart is drawn:** money is `bigint` in the client and **must never become a `number`, "not even for a chart axis"** ([web/CLAUDE.md](web/CLAUDE.md)). Recharts wants numbers. Resolve it deliberately — scale to a display unit at the very edge, in one place, isolated and tested exactly as the money codec is. Do not let a `Number(minor)` leak into a component. The backend already solved this twice for *ratios*; follow that precedent rather than inventing a third convention.

**Traps:**
- **The catalogue must not render a card the role cannot fetch** — a 403 the user could have been spared is a bug. `<Can>` from B0b is how, not an inline role check. **Dormant in B4** (both owner-only reports are phase 2, so all six cards share one gate) but the pattern goes in now rather than being retrofitted around a special-cased card later.
- **The §11.2 palette becomes tokens before any chart uses it** (finding 5). Eight `--color-chart-*` pairs in `tokens.css`, light and dark, **and every one added to `cn.ts`** or tailwind-merge drops it silently. Three light-mode slots sit below 3:1 on the surface, which **obligates direct labels or a table view** on any chart using them — §11.2 states that as a requirement, not a preference.
- **Every chart has a table view, one tap away** (§11.3). It is also the accessibility relief for those three slots, so it is not optional polish.
- **Degrade to "not available", never zero** (W-56). `profitPerKm`, `kmPerLitre` and `litres` all come back `null` **by design**; §11.4 makes this a *visual* rule — `NotAvailable` in place of the mark, reason in the caption. A zero-height bar and a missing bar must never look the same.
- **The lost-day denominator is `leaseEligible`** — the endpoint returns `ran`, `lost` and `leaseEligible` as separate counts. Display what it computed; never recompute a percentage client-side.
- **No accounting vocabulary reaches the interface** (U-6) — no "accrual", "receivable", "allocation" in any title or axis label. UC-74's own screen title cannot be the word the use case is named after.
- **W-52: paying in *creates* what a partner is owed** — `putIn` is a positive term in UC-67's balance, never excluded from it. *"Paying in more than your share buys you a claim, not a bigger slice… he is owed the extra twenty back."* An earlier draft of the B4 design had this exactly backwards and would have understated the row by every rupee a partner ever contributed.
- **`partyName`, `displayName` and `driverName` are all `.nullable()`** across these schemas. **Decided:** one shared `<PartyName>` falling back to the party type — "Unnamed driver" / "Unnamed customer" / "Unnamed partner", muted, row always rendered. Type-derived rather than a bare dash because the same component is a chart direct-label, where no adjacent type column carries the meaning.
- **Empty is not the same as unknown, and the codebase has already ruled on it.** `queries/reports.ts`'s own lint exemption says it: *"a real zero cost, not a missing figure (W-56 governs an unknown, not an absent one)"*. So no receivables is **"No one owes us anything"**, no closed trips is **"No closed trips yet"** — and only no fill-to-fill pair is `NotAvailable`. The checklist line below is corrected for this.
- **Enum values never render raw** — a label map per enum (`partyType`, `lostReason`, ageing bucket, `docType`, arrangement), colocated with the feature. U-6 already forbids accounting vocabulary; `over-90` or `auto_waiver` on screen is that rule broken sideways.
- **The `This month` warning strip is `GET /api/home/paperwork-warnings`, one business-wide call** — not N+1 per-vehicle document fetches, and not a client-side selector. It already applies F-10.1's 30-day window, already keeps warning past expiry (`isExpired` is a field), and already computes `today` from the business timezone. Filter to `subjectType === "vehicle"`; **driver licences do not appear in the Review shell** (§7.8 attaches a warning to the vehicle it concerns, and the passive owner cannot act on a licence anyway).
- **On a business's first accounting period, omit the delta line entirely** — not `0%`, and not `NotAvailable`. No prior period is a fact, not patchy data; `NotAvailable` would imply something failed.
- **No pie charts, never a dual axis, one chart per viewport** (§11.3).

**Done means** — **Wave 1:** an `owner` lands in the Review shell with four working tabs; the `owner_manager` reaches the same screens through **More → My share**; the catalogue renders **six** cards and no phase-2 route resolves; all six reports render from real data in both themes at 360×640, each with a table view; a `driver` cannot reach `/reports`; UC-75 is titled "Cash partners are holding"; and **no `Number()` touches a money value anywhere in the feature** outside the one axis codec. **Wave 2:** the overheads block is real, UC-75 carries its title back, and UC-76 has its reason chart.

**Two acceptance constraints, carried not resolved:**
- **Until GAP-1 lands, nothing in B4 claims or implies per-vehicle manager scoping** — `viewReports` is a flat business-wide check and the UI cannot fix that by hiding cards. The standing operational guard holds: do not invite a `manager` to a real business.
- **Desktop is out.** Responsive where it is free (max-widths, grid reflow); nothing from UI §14 — no sortable columns, no small multiples, no side-by-side comparison. §15 puts that dashboard in phase Third, and §14's baseline changes being undated is not a licence to pull them into the largest item on the board. Reports must be *usable* at `lg`, not optimised for it.

### B5 · The Mine shell — B0b's `renderMine` branch done, ready

**Backend increment: none.** `GET /api/driver-view` has been ready since P12, and `driverViewResponseSchema` already carries days, trips, advances, offsets and the deposit in one response.

**Screens** — `web/src/features/mine/`: `MineScreen` on `/me` — `TwoBalances`, his days including excused ones, closed trips and fees, advances, offsets, the held deposit, a Statement link. `AppShell` already accepts `shell="mine"` and renders no tabs for it; B0b supplies the branch that reaches it.

**Traps:**
- **There is no `driverId` anywhere in this route, by construction** (INV-25). The client must never introduce one — not as a prop, not as a query param, not "for testing". The endpoint has no slot for it; keep it that way on this side too.
- **A different component tree, not a filtered Operate** (§7.9): "no write affordance exists in this shell at all — not disabled, not hidden behind a role check in a shared component." Reusing an Operate screen with actions conditionally hidden is the one implementation this explicitly forbids.
- **`TwoBalances` never nets** (W-2), and this is the screen where a driver would most want it to.
- **Excused days are included** (§7.9) — they are the thing he would otherwise argue about. Do not filter them out to tidy the list.

**Note the overlap with A5, which has now landed.** This screen and `DriverDetailScreen` render nearly the same facts from two endpoints under two gates — and A5 deliberately made them one domain function and one wire mapper server-side, so the *figures* already cannot disagree. Factor the shared presentation only if it falls out naturally; the two screens have different affordances (Mine has none) and forcing one component to serve both reintroduces exactly the shared-tree risk §7.9 forbids.

**Done means** — a linked driver's token renders exactly his own data, and no request shape exists that could return anyone else's.

### B2 · Partners, banking and cash — A2 done, B0 done, ready

**Screens** — `web/src/features/partners/`: `PartnerDetailScreen`, `OwnershipSharesForm`, `CapitalContributionSheet`, `ShareVehicleForm` (F-1.4), `BankingEventForm`, `CashPositionScreen`. New routes `/cash` and `/partners/:id`.

**`PartnerListScreen` is a section on `/cash`, not a route.** §3.3 has `/partners/:id` and deliberately no `/partners` — and `GET /api/reports/cash-position` already returns every partner with a name and a held figure, which *is* the list. A separate list route would be a second way to reach the same rows, and the route map is the document that decides.

**Traps:**
- **The shares form submits the whole set at once, never row by row**, and surfaces `OWNERSHIP_SHARES_INVALID` as a 400 rather than pre-checking the sum client-side. The trigger is deferred and fires once at commit — a client-side sum check is a second implementation of it.
- **Capital is not ownership** (W-52). Never render one as the other; never show a derived gap.
- **An overlapping management agreement is a 409** from an `EXCLUDE` constraint. Catch it; do not pre-check.
- **The banking discrepancy's bearer is required exactly when recorded ≠ counted**, and the form must **only ever offer `absorbed` / `unattributed`**. The third enum value means the shortfall was traced to a receipt and corrected there instead (F-8.2) — it can never arrive through this form, and the request schema already refuses it.
- **GAP-1 again: do not build UI that implies per-vehicle scoping exists.**

**Done means** — a 60/40 split saves in one write and reads back; a shared vehicle with a monthly fee grants and revokes.

### B3 · Done (core) — close the month, and correct a payment

**✅ Core done 8 Aug 2026: `CloseMonthScreen` + `CorrectPaymentSheet` + `Timeline`.** `WriteOffSheet` and `PostClosureChargeSheet` deliberately not built here — both need a specific obligation/lease/trip as their entry point, which this screen has no context for; see the "one queue" table's **10a**. `commit 5ddadad` (plus `d0e3e82` for the `/more` row and router wiring).

**One gap found and fixed before it shipped, not after:** `CorrectPaymentSheet`'s trigger wasn't originally gated — `POST /api/payment/{id}/correct` requires `reverseReceipt` (owners only), narrower than the `dailyOperations` that gates reading the payments list, so a `manager` who reached `/period/close` by direct URL could have opened the sheet and hit a 403 on submit instead of never seeing the option. Fixed: the row renders as plain (non-tappable) information for a role without `reverseReceipt`, a button for one with it — M-22 applied to the affordance, not the information it sits on top of.

**`auditEntryToTimeline.ts` is the one translation this needed and the plan below didn't anticipate.** `Timeline`'s own contract is a pre-composed `description`; `auditLogEntrySchema` gives raw `before`/`after` row snapshots and a bare `changedBy` user id instead. Scoped to `payment`'s own two fields (`amountMinor`, `status`) rather than a generic before/after differ across all eighteen `assert_period_open()` tables — real, separate work if a second table ever needs its own `Timeline`.

The plan below is kept as the record of what was scoped going in.

---

**Screens** — `web/src/features/period/`: `CloseMonthScreen` on `/period/close`, `CorrectPaymentSheet`, `WriteOffSheet`, `PostClosureChargeSheet`, plus **`Timeline` wired to real `audit_log` data** — it has one caller today and was built for exactly this.

**`CorrectPaymentSheet` needs a payment row to open from**, which is `GET /api/payment` (GAP-38, shipped in A3). Where that row lives is this item's own decision — the lease hub's dues section and the driver/customer detail screens are all candidates; §7.10 only says "open the receipt."

**`Timeline` attaches to a record, not to the month** (finding 6). The endpoint is `GET /api/audit-log/{tableName}/{recordId}` — per-record by design, which is exactly what F-8.6/UC-97 asks for ("readable from the record itself, not only down a global log"). A corrected payment's own trail is the caller. There is no month-wide feed endpoint and the close screen must not imply one.

**The checklist is five counts and they are all live now** — `unconfirmedDays`, `openTrips`, `unreconciledAdvances`, `pendingObligations`, `openIncidents` (`closeChecklistSchema`). Each is a row with a count and a link that goes and fixes it (§7.7).

**Traps:**
- **The checklist warns and lists; it never blocks** (U-7). The close button stays enabled.
- **The close action is absent for a `manager`, not disabled** (M-22/W-49) — `<Can>` from B0b, and the same gate on `MoreScreen`'s row pointing here. This is B3's single hardest dependency and the reason B0b exists.
- **The primary action states the consequence** — `Close July permanently`, never `Confirm` (M-10). `DialogConfirmFooter`'s `confirmLabel` **defaults to the forbidden word**, so it must be passed explicitly here; this is one of the three call sites `Dialog` is actually reserved for.
- **`unconfirmedDays` is the checklist's first row** (§7.7) and is now in the response (A3). Render all five rows — none is missing any longer, so there is no "state plainly which is missing" fallback to reach for.
- **Closing opens the successor period in the same transaction.** The screen must make clear that this happened, since every later write depends on it.
- **A correction's `bearer` is the whole decision.** `back_to_arrears` puts the party back in arrears (INV-22); `absorbed_loss` leaves their due settled and the business eats it. Two outcomes from one form, and the copy must say which is which **without using the word "allocation"** (U-6).
- **A waiver and a write-off never share a bucket** (W-28). Separate entry points, separate reporting, never one combined "reduce this due" control.
- **`PERIOD_CLOSED` comes from the trigger**, never a client pre-check. Catch it and explain it.
- **GAP-15**: "deduct it from his fee" is `POST /api/offset` applied afterward. Either wire it as two explicit steps or leave it out — do not imply a combined endpoint exists.
- **B0's trap, carried forward:** once `MoreScreen` gains a close-month row pointing here, that row is **absent for a `manager` role, not disabled** (M-22/W-49 — the same rule this screen's own close action must already honour). Gate the row the same way the action itself is gated, not by hiding the destination and leaving the door open.

**Done means** — a month closes end to end with its successor open; a correction moves a party back into arrears and the audit trail shows who did it.

### B6 · Customer detail — A4 done, B0 done, ready, closes GAP-22

`/people/customers/:id` replaces `PlaceholderDetailRoute`. §3.3: dues, payments, statement.

**Reuse `LeaseHubScreen`'s dues section wholesale** — same rows, same "tappable only while `pending`/`part_paid`" rule, same `ActionSheet` into `CollectPaymentSheet`/`AdjustObligationSheet`. This screen is the party-scoped twin of one that already exists; building it a second way would be the drift.

### B9 · `UI-UX-REVIEW.md` fixes — independent, ready now

**Four small, unrelated fixes on screens that already ship**, found by an independent Playwright-driven review of the built client and each confirmed against source before being scheduled here (TRACKER.md §6 records the two claims from the same review that did *not* hold up, so they aren't repeated below). None blocks another item and nothing blocks these; pick them up in any order, together or split.

**GAP-44 — INV-1 has no blocking `Dialog` anywhere.** `Dialog.tsx`'s own doc comment reserves it to three call sites (INV-1, INV-17, M-10); only `CloseTripSheet.tsx` actually renders one, for INV-17. A double-booking conflict in `StartLeaseScreen.tsx` or `BookTripScreen.tsx` today surfaces as a bare `mutation.error.message` line, not the modal-plus-inline-fix §9.3 requires. **This needs a product decision before it needs code**: §9.3 requires "the fix offered inline," but doesn't wireframe what that fix says for a double-booked vehicle-day the way INV-17's confirm is wireframed in §7.5. Write that copy first, catching `VEHICLE_DOUBLE_BOOKED` specifically rather than rendering the raw error message.

**GAP-45 — trip detail's title truncates at 360px.** `formatShortDate` (`TripDetailScreen.tsx`) sets `year: "numeric"` unconditionally on both dates in the title; at 360px it clips mid-digit next to the cancel icon. Fix: show the year only where the range crosses one (§8.3's own rule), and consider leading with an identifier the way §7.5's wireframe does ("Trip #21 · Bus · 28–30 Jul") rather than two dates alone.

**GAP-46 — vehicle calendar's occupied-day cells fail a screen reader.** The occupied-day branch (`VehicleCalendarScreen.tsx`) renders a plain `<div>` with the state glyph inside `aria-hidden` and no `aria-label` — colour and glyph are the only channel, which §10 forbids. The free-day branch already does this correctly (`aria-label="Start a rental from …"` etc.); mirror that pattern with a label naming the state ("On a lease", "Ran", "Lost", "On a trip").

**GAP-47 — M-26 (landscape) is wholly unbuilt, and it's the one genuinely new scope in this batch.** `AppShell.tsx`'s tab bar and `Screen.tsx`'s app bar are hardcoded to the 56px portrait height with no orientation variant at all, against a deliberate, specified requirement (WCAG 2.1 SC 1.3.4 forbids locking orientation instead — the spec's own §16.4 records that option being rejected). At 640×360, Home's day-card action buttons sit below the fold. **The largest item here**: it touches two shared primitives every screen sits on top of, so size and test it like a small feature, not a one-line fix. Collapse the app bar to 44px and the tab bar to icon-only at 44px below `md` in landscape; verify against Home first, since that's the screen the spec's own 192px budget was sized around.

**GAP-48 — M-11's undo toast has no host.** `AppShell.tsx`'s `<div id="toast-root" />` has a comment stating nothing renders into it yet. M-11 requires a 5-second undo toast for any write that "sent no message and settled no obligation." Needs a `Toast` primitive plus a deliberate, recorded decision about which existing mutations qualify — likely a short list (an entity created with no downstream money effect yet), not "every write."

**Moved out, not left unresolved:** the review also flagged a nested-`Sheet`/`AmountPad` interaction as "low confidence, needs a human." Live testing on 6 August found something closely related and confirmed it hard — closing a nested sheet can leave `aria-hidden` on an ancestor of a focused element, reproducibly, via console warning rather than guesswork. That's **GAP-50**, now in **B11**, since it turned out to be `Sheet.tsx`'s own focus/inert handling rather than one specific nested interaction. Worth re-checking the original `AmountPad`-in-`MoneyField` case specifically once B11 lands, in case it's a distinct third issue rather than the same root cause.

**GAP-55 — 7 August, live: the "Add a driver" form's Name field has no `autocomplete` attribute.** Flagged by Chrome's own accessibility check. Add `autoComplete="name"`.

**Six more, 8 August — a live QA browser pass against `qa.fleetsettle.com`, each confirmed against source before being scheduled here** (`QA-BROWSER-TEST-FINDINGS-2026-08-08.md`, itself validated the way this repo validates every external review — its P0 finding turned out to be serious enough to become its own item, **B14**, not folded in here):

- **GAP-76 — generic `Invalid input` on required fields.** [CreateDriverForm.tsx:30](web/src/features/people/CreateDriverForm.tsx#L30) and [CreateVehicleForm.tsx:41-42](web/src/features/vehicles/CreateVehicleForm.tsx#L41-L42) give `name`/`registration`/`vehicleType` no custom Zod message. `CreateCustomerForm`'s contact validation is the pattern to match — specific, field-named copy.
- **GAP-78 — driver detail shows the driver's name twice.** `Screen title` and `TwoBalances`'s own `<h2>` both render it. Use the second slot for something else, or drop it.
- **GAP-79 — a blank incident description gives no other context**, just "No description recorded." Add type/cost/recovery status where available, or a more operationally useful fallback.
- **GAP-80 — three places show internal phase references as end-user copy**, all via `NotAvailable`'s `reason` prop: `"no advance list read exists yet (Web-P8b)"` (`TripDetailScreen.tsx`) and `"photo capture needs upload support, not built yet"` (`RecordExpenseSheet.tsx`, `FuelFillSheet.tsx`, twice). Rewrite as product copy — the reason a figure is unavailable is legitimate to state; which internal phase will build it is not.
- **GAP-81 — `voidExpense` has a working backend endpoint (since A9a) and no client caller anywhere.** A manager who mis-enters an expense cannot correct it from the product — only the API. Add a void action to the expense rows already rendered on `VehicleOverviewScreen`/`TripDetailScreen`/`IncidentScreen` (reason required, W-50), reusing the existing struck-through display convention those screens already use for a voided row. This is the client half of the one money table (of thirteen) that already has a backend void path — the other twelve wait on A9b.

**Done means** — each of the eleven, independently: a double-booking shows a `Dialog` with copy that says what to do next; the trip-detail title never clips at 360px; every calendar cell (occupied or free) is nameable by a screen reader; the app bar and tab bar both collapse correctly below `md` in landscape with no content below the fold on Home; at least one qualifying write offers a working 5-second undo; the driver/vehicle forms' required-field errors are field-specific, not generic; driver detail shows the name once; a blank incident description reads as operationally useful, not just absent; no `NotAvailable` reason names an internal phase; and a manager can void a mis-entered expense from the screen that shows it, with a reason, still visible struck through afterward.

### B7 · Offline and the PWA — startable, sequence last

Cross-cutting: it wraps every screen, so building it before the screens exist means rebuilding it per screen. **Startable at any time, correct to finish last.**

**What lands** — TanStack Query persistence; the paused-mutation queue (M-12) replaying with a **fresh token per attempt**; a 401 on replay pausing and re-authenticating rather than discarding; the eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint; runtime caching (stale-while-revalidate reads), deferred from P0's shell-precache-only PWA.

**Traps:**
- **A discarded mutation is a lost money record.** Pause and re-authenticate; never drop.
- **`HomeScreen`'s skeleton branch becomes reachable for the first time.** Web-P3 built it correctly and recorded that its one trigger condition — a warm cache — could not occur before this item exists. **Verify it now rather than assuming it works.**
- **`Provisional` has 0 real callers** and is the one inventory component no item claims. If it belongs anywhere it is here; if it doesn't, say so and record it.
- Side-by-side condition comparison needs photos, which need A7.

**Done means** — four days confirmed on a Sunday with no signal replay silently on Monday, and the money lands once.

### B8 · Done

**Shipped 5 August 2026** (`96301f8`), and it was larger than this plan said. The previous edition costed B8 at "about ten minutes of console work" — true of the console half only. The client half was **unbuilt and unscoped**: no SDK in `web/package.json`, no PKCE flow, no login screen, no real `TokenGetter`. `auth-stub.ts` issues an unsigned token that `verifyAccessToken` was always going to refuse, so until this landed **nobody could log in to a deployed build at all.**

What shipped: `@asgardeo/auth-react` ^5.6.2 (the SDK UI § settled on in July) · `lib/auth-asgardeo.ts` — config from `VITE_*`, PKCE on, redirect derived from the serving origin · `app/AuthGate.tsx` — completes the code exchange on `/auth/callback`, offers sign-in otherwise, blocks until there is a session. 12 new tests.

**§12.1's contract paid for itself.** Because the token getter is *injected* into `createApiClient` rather than imported, swapping the stub for the real thing changed `main.tsx` and nothing else — no screen, no query, no test of either.

**Three defects it surfaced, none of which were auth code:**
- **The client id in `api/wrangler.jsonc` was stale in all three environments.** It is checked as `aud`, so every token from the real apps would have 401'd with nothing in the message to say why (IG §10.6's undifferentiated 401, working exactly as designed and costing an afternoon to diagnose if it had reached QA).
- **`deploy:qa` ran plain `vite build`**, whose default mode is `production` — QA would have silently shipped production's client id. Now `--mode qa`, proven by building both and grepping each bundle for the other's id.
- **The callback cannot use `history.replaceState`.** The router is built once at module scope over browser history, so rewriting the URL underneath it leaves it resolving the callback path it captured at creation.

**Verified against the live tenant, not assumed:** the OIDC discovery document's `issuer` and `jwks_uri` match `ASGARDEO_ISSUER`/`ASGARDEO_JWKS_URL` exactly, `authorization_code` + S256 PKCE are supported, and the JWKS serves one RS256 key. The console now has JWT token type, PKCE mandatory, hybrid flow off, and all four redirect URLs — both `/auth/callback` paths and both bare origins, the latter because `signOutRedirectURL` is the origin.

**Not yet done: one real browser round trip.** Everything either side of it is verified; the flow itself needs a human with a password.

---

## Step 0 — the two things that were not code — both resolved 7 August 2026

**Queue items 4 and 5. Neither was a build, both gated believing anything that came after.** They lived here rather than in the Track B checklist because no diff proves them — one was a merge, the other was believed to be a row in a live money database.

### 0a · Merge `build/p0-foundation` → `develop` — done

- [x] Five PRs (#5–#9), `deploy-qa` green on each, `origin/develop` at `ba389ff`. This session's own first check of it was wrong — it diffed against a stale *local* `develop` ref instead of `origin/develop`; corrected by fast-forwarding local `develop` to match (TRACKER §5 carries the trap)
- [x] Live-verified against `qa.fleetsettle.com` in a real browser, both colour schemes: GAP-49, GAP-50, GAP-51 all hold; `role: "owner_manager"` lands on Operate correctly for the account this fix governs
- [x] Every environment-dependent fix since A0 is now verifiable on QA

### 0b · The existing production `business_member` row — checked, and moot

- [x] **Checked directly against Neon `main` (`br-odd-cherry-afx5394i`), 7 Aug 2026, read-only:** `business_member`, `app_user` and `business` are all at **zero rows**. Confirmed as the live production branch by its own `_migrations` table — `0001` through `0007`, applied 5 Aug 2026, timestamps matching `DEPLOYMENT.md` exactly.
- [x] **Nobody has ever signed up in production.** The premise this item was written under — "the account already stuck on `owner`" — was stated as fact and never actually verified against the database. It does not hold.
- [x] **No `UPDATE` was written.** There is no row to correct, and this item's own rule (scope to one row by `id`, never a bare `WHERE role = 'owner'`) forbids guessing at one that doesn't exist.
- Nothing further to do here unless and until a real production signup happens and gets stuck the way A0 describes — at which point this item's original checklist (read the row, scope by `id` and `business_id`, verify by sign-in) is still the right procedure.

---

## A11 · Member and driver access — done 7 August 2026

Written 7 August 2026 from the access design pass above; built the same day. **The migration came first, as planned.** Two boxes shipped differently from how they were written here — both noted inline, both already recorded in TRACKER.md and in the A11 section above.

*Documents, before the code*
- [x] `docs/product/user-flows.md` — W-49 gained a **member administration** row (owner ✓, owner-manager ✓, manager ✗) — v1.1.4
- [x] `docs/product/user-flows.md` — F-1.8's steps reconciled with its own OQ-2 resolution (code, never phone matching) — v1.1.4
- [x] `docs/engineering/data-model.md` — DM §3 (partial index, `business_member_invite`), §12 (audit trigger), §13/§13.1 (INV-31), §14 (enforcement map), §16 (flow table) — v1.1
- [x] **Not originally boxed, found reading UC-03 while doing the above:** `use-cases.md` v1.2.4 — UC-03's invite-role list corrected to include the passive `owner`, not just manager/owner-manager

*Migration `0010` — one file*
- [x] `UNIQUE (business_id, user_id)` dropped, replaced by a partial unique index `WHERE revoked_at IS NULL` (**GAP-52**)
- [x] `CREATE TRIGGER business_member_audit … AFTER INSERT OR UPDATE ON business_member` written **explicitly** (**GAP-53**)
- [x] A `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` asserting at least one active `owner`/`owner_manager` per business (INV-31) — **shipped as `AFTER UPDATE` only, not `AFTER INSERT OR UPDATE` as written here.** `assert_shares_total`'s shape was copied without re-deriving which statement type can actually violate *this* invariant; an `INSERT` can only add a row, so it can never by itself zero the owner count, and the `INSERT`-covering draft broke a dozen test fixtures that mint a manager as a business's sole member for reasons unrelated to A11. TRACKER.md §5 carries this as a general rule for the next trigger
- [x] `business_member_invite` — the F-1.4 counterpart to the pre-existing, previously-unused `driver_link_invite`; same shape (hashed code, plaintext returned once), not the standalone "invite-code table" this section first sketched
- [x] No change to the role CHECK
- [x] DM §13's drift assertion re-run clean against the migrated branch

*Worker — six endpoints*
- [x] `manageMembers: OWNERS` added to `MATRIX` — gates `business-member`'s three endpoints only
- [x] `POST /api/business-member/invite` — reissuing invalidates the prior unredeemed code for the same role
- [x] `POST /api/business-member/{id}/revoke`
- [x] `POST /api/business-member/{id}/change-role` — revoke-and-grant, two rows, never an in-place `UPDATE`
- [x] `POST /api/invite/redeem` — no capability gate; `app_user` created just-in-time; the role/driver comes from the code, never the request body
- [x] `POST /api/driver/{id}/link-invite` + `.../unlink` — **gated `manageEntities`, not `manageMembers` as this section first assumed.** F-1.8's own actor is "Manager", the same as F-1.6 (add a driver), and neither endpoint touches `business_member` — corrected before shipping, not after
- [x] Both writes open a transaction (free: `c.get("writer")` is already `withActor`-wrapped)
- [x] Full per-endpoint matrix: happy · 401 · 403 · 404 for another business · 409 · a test that the last remaining owner cannot revoke or demote themselves (both endpoints) · a test that a revoked member's records stay attributed (redeem-twice → second gets `INVITE_CODE_INVALID`, first redemption's row is untouched)

*Client*
- [x] `FirstRunGate`'s `/api/me` 404 branch offers **create a business** *or* **redeem a code** (`RedeemInviteForm`) — one screen, deliberately not distinguishing never-had-access from revoked
- [x] Copy carries no "admin" and no "role" (U-6)
- [x] `["me"]` invalidated on a 403 — shipped as a global `QueryCache.onError` in `main.tsx` rather than per-screen, so it covers every future mutation for free
- [x] `npm run check` clean; integration suite 32 files / 406 tests green against a fresh ephemeral Neon branch

## Track B implementation checklist

Written 6 August 2026 from the validation pass above. **Order matters within an item; items are in build order.** Every box is something a reviewer can check by reading a diff or running a test — "understand the spec" is not a box.

**B11 and B10 name their files.** The two newest items were sized from a live session and then a source pass, so unlike the older items below they can say exactly which file changes and what the surrounding precedent is — that detail is deliberate, not inconsistency.

### B11 · Structural render fixes

**GAP-49 — the missing page background.** The whole defect is that `web/src/design/primitives/AppShell.tsx:50` is the *only* place in the client that paints `bg-page`, and three screens render outside it.

- [x] A base rule in `web/src/design/tokens.css` — `html { background: var(--color-page); color: var(--color-ink-primary); }` — set **once**, not patched into `AuthGate` and `NotBuiltYetScreen` individually. It lands on `:root`, which is where both dark selectors already redefine `--color-page`, so **the OS media query and the in-app `[data-theme="dark"]` toggle are both covered with no second rule**
- [x] `color-scheme: light dark` declared alongside it — **currently declared nowhere** (grepped: only `prefers-color-scheme` media queries exist). Without it the UA canvas, scrollbars and native form controls stay light under a dark theme, which is the same bug one layer down
- [x] `AppShell.tsx:50`'s own `bg-page` left alone — it becomes redundant, not wrong, and removing it is churn on the one file that has always been correct
- [x] A case added to `web/src/design/tokens.test.ts` asserting the base rule is present. That file already reads `tokens.css` as text via `readFileSync` for the dark-parity check, so this is one more regex against a string it already has — no new mechanism
- [x] Verified **in a real browser in dark mode** on `AuthGate`'s loading state, `AuthGate`'s sign-in state, and `NotBuiltYetScreen`. jsdom has no rendering, so no unit test can prove this one; the previous verification pass is exactly what missed it

**GAP-50 — `aria-hidden` on an ancestor of a focused element.** One primitive, `web/src/design/primitives/Sheet.tsx`, so one fix.

- [x] Cause confirmed before the fix: `Sheet` renders `vaul`'s `Drawer.Content`, which wraps Radix Dialog, whose background-`aria-hidden` is cleared on close **after** focus returns to the trigger. The likely lever is `onCloseAutoFocus` on `Drawer.Content` — prevent the default restore, then return focus explicitly once the attribute is gone
- [x] **Focus restore must survive the fix.** `Sheet.tsx`'s own doc comment credits vaul for "focus trap, `aria-modal` and focus restore" (M-23); a fix that silences the warning by dropping focus to `<body>` trades a console message for a real keyboard-navigation regression
- [x] A test asserting focus returns to the triggering control after close — this is the part jsdom *can* prove, and it is the part most at risk from the fix
- [x] Verified in a real browser against a **stacked** sheet close (Add → Add a driver), not only a single one — the stacked case is what named a Radix content div rather than a plain button, so nesting depth appears to matter to when it fires
- [x] Zero `aria-hidden`/focus console warnings across a pass of every sheet-opening screen
- [x] `npm run check` clean; axe-core clean, **both themes**

### B10 · Set up the daily lease (F-1.7)

**Four files, one of them new. `StartLeaseScreen.tsx` is the working precedent for every structural decision here** — same folder, same entry shape, same `Screen`-with-`primaryAction` skeleton — so this is closer to following a pattern than designing one.

*The screen*
- [x] `web/src/features/vehicles/StartDailyLeaseScreen.tsx` — takes `vehicleId`, `today`, `onBack`, `onCreated` as props, exactly as `StartLeaseScreen` does. **`vehicleId` is a prop from the route, never a picker** (F-1.7 has no vehicle step)
- [x] Driver — `EntityPicker` over `GET /api/driver`, `onAddNew` opening `CreateDriverForm` in a `Sheet`, mirroring how `StartLeaseScreen` handles a missing customer. A daily lease for a driver who isn't in the system yet is the ordinary case, not the edge one
- [x] Pattern — `every_day` / `alternate` / `weekdays` as `aria-pressed` chips; the weekday multi-select renders **only** when `weekdays` is chosen, and `patternWeekdays` is sent only then (the schema's `superRefine` requires exactly that pairing)
- [x] **"Daily lease amount"** — `MoneyField`, **no prefill from `driverDayFeeMinor`** (that is the opposite direction of money; the write-up above records why at length). Label is the reserved §9.6 word, not F-1.7's descriptive phrase
- [x] `effectiveFrom` defaults to `today`; `effectiveTo` behind a `More` disclosure
- [x] Money crosses the wire through `toWire(...)`, and the request is typed `satisfies` `z.input<typeof startDailyLeaseRequestSchema>` — `z.input`, not the inferred output type, the same fix `StartLeaseScreen` and `OffsetSheet` both carry in their own comments

*Wiring*
- [x] `web/src/app/router.tsx` — a `StartDailyLeaseRoute` component beside `StartLeaseRoute`, and a route at **`/vehicles/$vehicleId/daily-lease/new`**, parallel to `startLeaseRoute`'s `/vehicles/$vehicleId/lease/new`. Added to the route-tree array (nothing resolves if that step is missed)
- [x] `web/src/features/vehicles/VehicleOverviewScreen.tsx` — a fourth entry in the `vehicleActions` array, alongside View calendar / Record expense / Report incident, plus the `onStartDailyLease` prop it needs. **This is the menu this session opened looking for the flow and found nothing in**
- [x] The action is offered when `vehicle.arrangement` is `"B"` **or `undefined`**, and hidden for `"A"`/`"C"` — a vehicle with no active arrangement is precisely the one you'd start a daily lease on. `VehicleCalendarScreen.tsx:166-171`'s `canStartLease`/`canBookTrip` is the existing precedent for gating on arrangement this way; match its shape
- [x] `POST /api/daily-lease` wired; **409 (overlapping daily lease) caught and shown as an ordinary outcome**, never pre-checked by fetching existing leases first — DM §7's exclusion constraint is the authority, and a client pre-check is a second implementation of one rule
- [x] 404 handled, though it should be structurally unreachable — the vehicle comes from the route and the driver list is already business-scoped

*Proving it*
- [x] `StartDailyLeaseScreen.test.tsx` — U-2 test worded to match the others ("saves with driver, pattern and amount alone"); a test that `patternWeekdays` is absent from the request unless `weekdays` is chosen; a test that the 409 surfaces rather than throwing
- [x] `VehicleOverviewScreen.test.tsx` gains the arrangement gating both ways — shown for `B`/absent arrangement, **not offered** for `A` and `C`
- [x] **Confirmed against a real environment, not only jsdom:** create a daily lease, let `generate-day-cards` run, confirm a real day-record placeholder appears and is confirmable through F-4.2. **This is the verification GAP-3's fix has been waiting on since 6 Aug** and the reason that fix is still technically unproven in a live environment
- [x] `npm run check` clean

### B0b · Done — the three shells and the capability gate

- [x] `meResponseSchema` in `packages/shared/src/schemas/me.ts`, exported from `index.ts` — role, `userId`, `businessId`, optional `driverId`
- [x] `api/src/route-defs/me.ts` + handler validating against it — the only Track A commit B0b needed
- [x] Delete `FirstRunGate`'s local `MeResponse` interface and its "one documented exception" comment; import the shared type
- [x] `web/src/lib/useMe.ts` — reads the existing `["me"]` query key, no second fetch
- [x] `web/src/lib/capabilities.ts` — `can(role, cap)` over a `MATRIX` copied row-for-row from `api/src/auth/policy.ts`, with the "convenience only, the Worker re-checks" comment §12.4 requires
- [x] `web/src/components/Can.tsx` — renders `null` when the role lacks the capability. **Never renders a disabled child.** Reads `["me"]` directly rather than through `useMe()`'s throw — found necessary testing the sign-out race (queryClient cleared before navigation completes)
- [x] `capabilities.test.ts` — one assertion per W-49 row, and one asserting a `driver` has no STAFF capability
- [x] `FirstRunGate` gains `renderReview` / `renderMine`; `RootLayout` stops hardcoding `shell="operate"`
- [x] Review shell renders `AppShell shell="review"` — as four flat routes with a redirect-to-default effect, not a nested tab-route tree, but the same `REVIEW_TABS`/`AppShell` underneath, unreordered
- [x] Mine shell renders `shell="mine"` (no tab bar) over its own component tree
- [x] `owner_manager` still routes to **Operate**, not Review (M-3) — asserted in `App.test.tsx`
- [x] Tests: one per role → correct shell; `<Can>` absent-not-disabled; `npm run check` clean

### B12 · Done — opening balances (F-0.2)

**✅ Done 8 Aug 2026, closing GAP-61.** `commit 12eefa3`.

- [x] An entry point reachable by `owner_manager` — a new `/more` row, gated `<Can cap="manageOpeningBalances">`
- [x] Multi-step form: go-live date · six entry kinds via `AddOpeningBalanceEntrySheet` (customer due, driver arrears, owed to driver, deposit held, advance outstanding, cash held) · confirm. **Per-vehicle setup (arrangement, odometer, lease terms) deliberately not built** — the request schema has no such fields; F-1.1/F-2.1/F-1.7 already carry an original start date and are where that belongs, mid-stream or not. The original plan's own six-step reading of F-0.2 conflated the flow's *narrative* with the endpoint's actual *schema*; the schema is narrower and correctly so
- [x] **Save as a draft and resume** — every save is a full `PUT` replace of the accumulated entry list, matching `domain/opening-balance.ts`'s own shape; an existing batch's entries are re-hydrated with real party/vehicle names on load, not raw ids
- [x] `POST .../commit` writes the batch; a `409 OPENING_BALANCE_LOCKED` after the first period closes is caught and explained, not pre-checked
- [ ] **Never posts as income or expense** — not yet verified against a real report, since B4 doesn't exist yet. The write path itself only ever touches `opening_balance_entry`, never `obligation`/`payment`, so this holds structurally; a P&L cross-check is B4's to make once it can
- [ ] A driver statement showing a "brought forward" line — depends on B5, unbuilt
- [x] U-2: saves with just a go-live date and zero entries, asserted directly in a test

**Done means** — a business with a bus already leased, a car already rented, and a driver already in arrears can have all three entered honestly in one sitting or several, and the first month it closes reflects a true starting point.

### B13 · Done — driver money actions: pay, advance, deposit (F-6.1/F-6.3/F-6.7)

**✅ Done 8 Aug 2026, closing GAP-63/64/66.** `commit 6736e62`. **One correction to what this checklist assumed going in: `POST /api/payment` was not "the same endpoint in the paying direction" — it had no paying direction at all.** `recordPayment` was hardcoded to `direction: "received"`/`owed_to_us`; "pay the driver" needed `owed_by_us`, which nothing wrote. `createOffset` can't substitute — it requires the driver already owing something on both sides, and fails outright for a clean bonus or retainer with nothing to net against. Generalised `RecordPaymentInput`/`recordPaymentRequestSchema` to carry `direction`, defaulting to `"received"` so every existing caller is unaffected; two new integration tests prove a `"paid"` payment settles `owed_by_us` only and a no-trip payment is held entirely as unallocated credit.

- [x] Reached from `DriverDetailScreen` via a new "Driver money" `ActionSheet` — not folded into `TwoBalances`, whose own doc comment reserves it to the one action (`Offset…`) it already has
- [x] **Pay the driver (F-6.1, GAP-63)** — `PayDriverSheet`, a straight amount+date form, not a `CollectPaymentSheet` reuse: no allocation preview, since F-6.2's multi-trip breakdown-and-choose is separate, larger scope F-6.1's own single-tap shape doesn't need
- [x] **Advance before a trip (F-6.3, GAP-64)** — `AdvanceSheet`; no trip picker, since F-6.3's own text doesn't require one and `tripId` is optional on the schema
- [x] **The driver's deposit (F-6.7, GAP-66)** — `DepositSheet`, take only; no movement (refund/apply/top-up) action, matching "never automatic"
- [x] **INV-4** — a deposit write never touches `obligation`/`payment`, only `deposit`
- [x] `PERIOD_CLOSED` caught and explained for all three, never pre-checked
- [x] U-2 on each: saves with amount + date alone, asserted directly in tests

**Done means** — a manager can pay a driver, record an advance, and take a deposit, all from the driver's own page, with none of the three requiring the other two.

### B3 · Done (core) — close the month and correct a payment

**✅ Core done 8 Aug 2026.** `commit 5ddadad` + `d0e3e82`. Two naming corrections against the real implementation: the checklist endpoint is `GET /api/accounting-period/checklist`, not `.../close-checklist`; the capability is `closePeriod`, not `closeAccountingPeriod`.

- [x] Route `/period/close` + `CloseMonthScreen` in `web/src/features/period/`
- [x] `GET /api/accounting-period/checklist` wired; **all five counts rendered** as rows with a count — no per-row link to "go and fix it" yet, since each count's own fix lives on a screen (a trip, an incident, a day) this item doesn't otherwise touch
- [x] Close action wrapped in `<Can cap="closePeriod">` — **absent for `manager`**, asserted in a test
- [x] `MoreScreen` gains a close-month row under the **same** `<Can>` — not a hidden destination behind a visible door
- [x] Confirm is `Dialog` (one of its three reserved call sites) with `confirmLabel="Close August permanently"` (the open period's own month) — never the default `"Confirm"` (M-10)
- [x] Confirm states that closing cannot be undone **and** that the next period opens in the same action (§7.7) — one combined `description`, not a second confirm step
- [x] Success surfaces the newly opened successor period — every later write depends on it
- [x] The close button stays **enabled** regardless of checklist counts (U-7)
- [x] `CorrectPaymentSheet` over `GET /api/payment` + `POST /api/payment/{id}/correct`; `bearer` is an explicit two-outcome choice, worded without "allocation" (U-6) — **and gated separately on `reverseReceipt`** (narrower than the `dailyOperations` that gates reading the list), found and fixed before this shipped
- [ ] `WriteOffSheet` and `PostClosureChargeSheet` — **deliberately not built**, not merely deferred. Both need a specific obligation/lease/trip as their entry point; "opened from the close screen with no context" was never the right shape. See the plan's "one queue" table, item 10a
- [x] `Timeline` wired to `GET /api/audit-log/{tableName}/{recordId}` for a corrected payment — **per record, not per month**
- [x] `PERIOD_CLOSED` caught and explained; no client-side pre-check anywhere
- [x] U-2 test on every new form: saves with level-1 fields alone

### B4 · Review shell + phase-1 reports

**Do the palette, the money-to-axis codec and the table primitive before the first chart, not after.**

**Wave 1 — infrastructure**
- [ ] `--color-chart-1…8` in `tokens.css`, light **and** dark, from §11.2's validated values — no raw hex in any component
- [ ] Every new token added to `theme` in `cn.ts` (tailwind-merge drops unknown tokens silently) + a `cn.test.ts` case
- [ ] One isolated money→axis scaling module, unit-tested like the money codec; **no `Number(minor)` outside it**. Tests cover positive, **zero, negative profit, mixed-sign domains**, and a value past `MAX_SAFE_INTEGER` (scale as `bigint` or throw — never a silent lossy convert)
- [ ] A lint-visible reason on the one legitimate ratio (§7.8's `▲ 12% vs June`), following `profitPerKm`'s precedent
- [ ] **Normalised report view-model + shared table primitive first, charts second** — each report defines response → view model → table columns → chart marks, in that order. This is what makes the table view nearly free instead of nine bespoke tables
- [ ] One shared `<PartyName>` — falls back to the party type ("Unnamed driver"), row always rendered
- [ ] A label map per enum (`partyType`, `lostReason`, ageing bucket, `docType`, arrangement) — no raw enum text on screen

**Wave 1 — screens**
- [ ] `/reports` catalogue — **six** cards, gated by `<Can>`, **no phase-2 route registered**
- [ ] Parameter collection before fetch, **URL-backed**: `/reports/:key?…` validates its search params and renders the parameter form when they are missing, so the route is never dead and a report is linkable between partners. `from > to` caught at parse, before any fetch
- [ ] Parameters needed: **`periodId`** (from `GET /api/accounting-period`, defaulting to the open period), **vehicle picker** (`EntityPicker`, UC-72), **date window** (UC-72 → last 90 days; UC-76 → the open period)
- [ ] `/reports/:key` — **six** screens, each in §11.1's specified form
- [ ] UC-75 titled **"Cash partners are holding"** until GAP-70 lands (a test asserts the narrow title while the response has no `banked` field)
- [ ] Review shell's other three tabs — `This month` (§7.8's layout, minus overheads), `Vehicles` (**one vehicle × all periods**, sharing `VehiclePerformanceCard` with `This month`), `My money` (`GET /api/partner/{userId}`, read-only)
- [ ] `This month`'s **"What I'm owed"** row — UC-67's all-time balance, `putIn + earned − takenOut`, **`holdingMinor` never netted in** (W-2's shape). **Needs GAP-74 first** — all-time `earned` does not exist. Keep the label: U-6 names "what you're owed" as the approved wording
- [ ] Warning strip from `GET /api/home/paperwork-warnings`, filtered to `subjectType === "vehicle"` — one call, not N+1, and no client-side threshold logic
- [ ] Read-only `ReviewVehicleScreen` — **not `VehicleOverviewScreen` with actions gated off** (§7.8: no entry affordance anywhere)
- [ ] **Owner-manager's `More → My share`** — one row, one route, the same components read-only (UI line 148)

**Wave 1 — rules and tests**
- [ ] **Every chart has a table view one tap away** (§11.3) — required, not polish
- [ ] Direct labels on any chart using the three low-contrast light slots (§11.2)
- [ ] `NotAvailable` **in place of the mark** with the reason in the caption wherever a value is `null` (§11.4) — never a zero-height bar
- [ ] A test per report against an **empty** and a **partial** fixture asserting **the right thing**: `NotAvailable` only where the metric cannot be computed (UC-72's missing fill pair), and a true-zero message where it can ("No one owes us anything", "No closed trips yet"). **Not `NotAvailable` for every empty response** — W-56 governs an unknown, not an absent one
- [ ] A `driver` cannot reach `/reports` at all (route-level). *`viewOwnerOnlyReports` has no caller in B4 — both owner-only reports are phase 2*
- [ ] First accounting period: **omit the delta line**, not `0%` and not `NotAvailable`
- [ ] Negative profit renders correctly in a bar **and** a table
- [ ] Golden fixture: the per-vehicle card reads **134,000** (`180,000 − 46,000`) — that is the vehicle's *profit*, not the hero's *share*
- [ ] No pie charts, no dual axis, one chart per viewport, charts scroll in their own container (§11.3)
- [ ] No accounting vocabulary in any title, axis label or caption (U-6)

**Wave 2 — after three Track A increments**
- [ ] **GAP-41** — `GET /api/reports/overheads?periodId=`, then the overheads block as **its own block** beneath vehicle totals (W-32)
- [ ] **GAP-70** — cash position gains `banked` + `driverAdvances`; UC-75's title reverts. **`doc-change` on DM §15 first**
- [ ] **GAP-71** — lost-day reasons; UC-76 gains its reason chart. **`doc-change` on UI §11.1 first**

**Not in B4** — UC-73 (GAP-18), UC-77, UC-78, UC-79: all phase 2 per FL §9.2's own per-row column. **GAP-72 is the exception and does not wait for its screen** — a live wrong number in `sumGoodwillGiven`, one predicate, unblocked by anything here.

### B5 · Mine shell

- [ ] Route `/me` + `MineScreen` in `web/src/features/mine/` — **its own component tree**, sharing no screen with Operate (§7.9)
- [ ] `GET /api/driver-view` wired; `TwoBalances` at the top, never netted (W-2)
- [ ] Days rendered **including excused ones** (§7.9)
- [ ] Trips and fees, advances, offsets, held deposit
- [ ] Statement link producing the same content as the printed slip (UC-57)
- [ ] **Zero write affordances** — asserted by a test that fails if any `button` with a mutation appears in the tree
- [ ] **No `driverId` anywhere** — not a prop, not a param, not in a test helper (INV-25)

### B6 · Customer detail

- [ ] `/people/customers/:id` replaces `PlaceholderDetailRoute`
- [ ] `GET /api/customer/{id}/obligation` + `/payment` wired (both A4)
- [ ] **Reuse `LeaseHubScreen`'s dues section wholesale** — same rows, same "tappable only while `pending`/`part_paid`", same `ActionSheet` → `CollectPaymentSheet` / `AdjustObligationSheet`
- [ ] Statement view

### B2 · Partners, banking, cash

- [ ] Routes `/cash` and `/partners/:id`; **no `/partners` list route** — the partner list is a section on `/cash`, fed by `cash-position`
- [ ] `PartnerDetailScreen` over `GET /api/partner/{userId}` (A2)
- [ ] `OwnershipSharesForm` — submits the **whole set in one write**, surfaces `OWNERSHIP_SHARES_INVALID` as a 400, **no client-side sum pre-check**
- [ ] `CapitalContributionSheet` — capital rendered as capital, never as ownership (W-52)
- [ ] `ShareVehicleForm` (F-1.4) — overlap is a 409 from the `EXCLUDE` constraint, caught not pre-checked
- [ ] `BankingEventForm` — bearer required exactly when recorded ≠ counted, offering **only** `absorbed` / `unattributed`
- [ ] `CashPositionScreen` — deposits held shown **beside** partner cash, never netted into it
- [ ] `BorneByPaidBy`'s paid-by picker wired to `GET /api/business-member` (GAP-31's remaining half)
- [ ] **No UI implying per-vehicle capability scoping exists** (GAP-1)
- [ ] **`MileagePackageForm` (F-1.9, GAP-67)** — new 8 Aug: create/list/archive all exist server-side, nothing calls them. Editing a package **never reprices an existing lease** — terms are copied onto `Lease.mileage_terms` at selection, independent thereafter
- [ ] **`RecordPayoutSheet` (F-7.2, GAP-69)** — new 8 Aug: `POST /api/partner-payout` exists, nothing calls it. Never a vehicle cost; lives beside `CashPositionScreen`/`PartnerDetailScreen`, the same screens that read it back (A2)

### B9 · `UI-UX-REVIEW.md` fixes

- [ ] GAP-44 — copy decided for the double-booking inline fix, then `Dialog` wired to `VEHICLE_DOUBLE_BOOKED` in both `StartLeaseScreen` and `BookTripScreen` (not the raw error message)
- [ ] GAP-45 — `formatShortDate`/trip-detail title show the year only when the range crosses one; verified not to clip at 360px
- [ ] GAP-46 — occupied calendar cells get an `aria-label` naming the state, matching the free-day cells' existing pattern
- [ ] GAP-47 — app bar collapses to 44px and tab bar goes icon-only at 44px below `md` in landscape; verified on Home that all three day-card actions clear the fold at 640×360
- [ ] GAP-48 — `Toast` primitive built, wired into `#toast-root`; the qualifying-writes list is decided and recorded, not "every write"
- [ ] GAP-55 — `autoComplete="name"` on the "Add a driver" form's Name field
- [ ] GAP-76 — field-specific Zod messages on `CreateDriverForm`'s `name` and `CreateVehicleForm`'s `registration`/`vehicleType`, matching `CreateCustomerForm`'s existing pattern
- [ ] GAP-78 — `DriverDetailScreen`/`TwoBalances` render the driver's name once, not as both `Screen` title and body `<h2>`
- [ ] GAP-79 — incident row fallback copy carries more than "No description recorded" where type/cost/recovery status is available
- [ ] GAP-80 — the three `NotAvailable reason=` strings naming "Web-P8b" or "not built yet" rewritten as product copy, in `TripDetailScreen.tsx`, `RecordExpenseSheet.tsx`, `FuelFillSheet.tsx`
- [ ] GAP-81 — a "Void expense" action (reason required) added to the expense rows on `VehicleOverviewScreen`, `TripDetailScreen`, `IncidentScreen`, calling the existing `POST /api/expense/{id}/void`; voided row stays visible, struck through, with its reason
- [ ] The nested-`Sheet`/`AmountPad` question manually verified on a real browser before this item is called done — filed as a new gap only if it reproduces
- [ ] `npm run check` clean; axe-core clean on the calendar and any new Dialog, both themes

### B7 · Offline and the PWA — last

- [ ] TanStack Query persistence + the paused-mutation queue (M-12)
- [ ] Replay with a **fresh token per attempt**; a 401 on replay pauses and re-authenticates, **never discards** — a discarded mutation is a lost money record
- [ ] Eviction warning while the queue is non-empty
- [ ] `OfflineBanner` finally given a caller (it has zero today)
- [ ] Runtime caching, stale-while-revalidate reads, short TTL on money reads (§12.5)
- [ ] iOS "Add to Home Screen" hint, dismissible forever
- [ ] **Verify `HomeScreen`'s skeleton branch**, reachable for the first time once a warm cache exists
- [ ] Decide `Provisional`'s fate — 0 callers, and this is the only item that could claim it. Record either way

### The gate every one of these clears

- [ ] 360 × 640, one thumb, no horizontal scroll; reflows at 320px
- [ ] 44 × 44 minimum, ≥ 8px apart, ≥ 16px when one is destructive
- [ ] Money `string` on the wire, `bigint` in the client, **never `number`**
- [ ] `Rs 0` and `NotAvailable` visibly different
- [ ] `--color-*` tokens only; colour never carries meaning alone
- [ ] Reserved vocabulary, never abbreviated; no accounting words
- [ ] New token → `cn.ts`; new form → the three structural fixes (TRACKER §5)
- [ ] `npm run check` clean; axe-core clean, both themes
- [ ] TRACKER.md updated: the item becomes a **row**, its leftovers become **gap rows with a track**

---

## How the tracks run

```
        Track A (Worker + shared schemas)          Track B (React client)
        ─────────────────────────────────          ──────────────────────
done    A1  GET /api/expense ✅                     ~~B1 ExpenseListScreen~~ withdrawn
        A2  partner/banking/cash + members ✅        B0  the /more hub + sign-out ✅
        A3  period/write-off/payment ✅              B8  real Asgardeo ✅
        A4  customer reads ✅                        B2  partners, banking, cash — ready (A2 ✅, B0 ✅)
        A5  driver history ✅                        B3  close the month, corrections — ready (A3 ✅, B0 ✅)
        A9a the void/period trigger ✅                B6  customer detail — ready (A4 ✅, B0 ✅)
        A6  trip receivable ✅                        B2  partners, banking, cash — ready (A2 ✅, B0 ✅)
        A11 member and driver access ✅               ~~B11 structural render fixes~~ ✅ done 7 Aug
        A12 borne-by by date + trip receivable ✅     ~~B10 set up the daily lease~~ ✅ done 7 Aug
now     A10 the other two silent zeros                 B0b three shells + capability gate  ← first
        A13 change arrangement (GAP-54, F-1.2)
        GAP-41 overheads filter (B4 needs it)
        A7  R2 upload (unblocks 5 gaps; independent)   B3  close the month  (needs B0b)
        A8  odometer wiring, borne-by preview          B4  Review shell + 9 reports (needs B0b, GAP-41)
        A9b the rest of soft delete                    B5  Mine shell      (needs B0b)
        —   in-app "invite a member" screen             B9  UI-UX-REVIEW fixes — ready (GAP-44–48, GAP-55)
            (unsized, needs B0b — A11 built the API)
        —   GAP-1 per-vehicle scoping — reachable
            since A11; needs a design call, not a slot
        —   GAP-58 test manifest: 178 cases, 0 run
last                                                B7  offline and the PWA
```

**Track B's "first" item changed three times now, each time because of a live or build-time signal, not a design read.** B0b held that slot from the 6 August validation pass until a live browser session the same day found two shipped bugs (B11) and one wholly unbuilt core flow (B10) that outranked it. Both are done (7 Aug), and **A11 shipping the same day hands the slot back to B0b** — the newly-reachable `owner`/`driver` accounts have nowhere to land without it. **B3, B4 and B5 still queue behind B0b**, which is small; B6, B2 and **B9** need neither B0b nor anything on Track A, so they are the items a second person can start on immediately without waiting on B0b either.

**Track A's remaining items are now all independent again.** A9a (the GAP-35 trigger fix) gated A6 and A10, because both add new places the defect could have fired — it shipped 5 August, so A6, A10, A7 and A8 can all be picked up in any order.

**One Track A → Track B handoff reopened, briefly: A11 → B0b.** Every other handoff (A2 → B2, A3 → B3, A4 → B6, A5 → B5+) has happened, and B0 shipped 5 August — every other item in Track B's column above is buildable right now. A10, A7, A8 and A9b change what *existing* endpoints return or add a batch of near-identical writes, rather than unblocking a new screen — A7 is the closest to an exception, and its dependent screens are photo work no B item currently claims.

---

## The bar every item clears

Unchanged, restated so no session goes looking:

- **360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px.
- **Every create form saves with level-1 fields only** (U-2) — an automated test, not an intention. Every existing form has one; match the wording ("saves with X alone") so they stay greppable.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive.
- **Money is `string` on the wire, `bigint` in the client, never `number`.**
- **`Rs 0` and `NotAvailable` are visibly different things.**
- **No raw hex** — `--color-*` tokens only, and colour never carries meaning alone.
- **Reserved vocabulary, never abbreviated**, and no accounting words at all.
- **New token → add it to `theme.text`/`theme.spacing` in `cn.ts`**, or tailwind-merge silently drops it (TRACKER.md §5).
- **New form → inherit the three structural fixes** (TRACKER.md §5): domain-typed form state with `toWire()` only in `mutationFn`, `blankToUndefined` on optional text, `Disclosure forceOpen` on a level-2 error.
- **A new money table is not finished until it is in the `assert_period_open()` array** (Track A only).
- **A new write to a `posted_period_id`-carrying table must open a transaction**, or its audit row records `changed_by` as `NULL` (Track A only).
- `npm run check` clean across all three workspaces — **and, for Track A, the touched integration file re-run locally** (`check` does not include the integration suite at all, by design). **Do not chase the full local suite past that.** It runs against the long-lived shared branch every session contends for and has produced repeated, undiagnosable flakiness (TRACKER.md §5); `integration.yml` provisions a fresh ephemeral branch per PR and has none of that contention — A9a's own verification (5 Aug) ran 378/378 clean in one pass on a throwaway branch, no flakes, where the shared branch has needed re-runs before. Push the touched-file-verified commit, open the PR into `develop`, and let CI carry the full-suite cost while the next item starts — don't block on a local run CI is about to do anyway.
- **a11y is axe-core in Playwright**, not `eslint-plugin-jsx-a11y` — its peer range caps at ESLint 8/9 and this repo is on 10.
- [TRACKER.md](TRACKER.md) updated: the item becomes a **row**, its leftovers become **gap rows with a track**.

---

## Skipped by decision

**R2 presigned uploads** — carried as **A7** rather than dropped, because the previous edition skipped it and the cost has compounded: five recorded gaps, a built-and-tested `photo-pipeline.ts`, and a `PhotoCapture` component with 0 callers, all waiting on one endpoint against an already-polymorphic `attachment` table.

**Per-vehicle capability scoping (GAP-1)** — backend hardening, out of scope on both tracks. Until it lands, an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. It blocks no screen and closing it later forces no rework, since endpoint shapes do not change — **but B2 must not imply the scoping exists.**

**Error monitoring (GAP-28)** — deferred deliberately, not forgotten. Workers Logs stays the only observability until there is an on-call person and a channel to page.

**Also out, and recorded in [TRACKER.md](TRACKER.md) §4:** UC-73 (yearly) and UC-99 (export), both product-phase Second · UC-79's `revenuePerAvailableDayMinor` (GAP-19) · F-8.4's deposit-apply (GAP-6) · void-and-replace for the other twelve W-50 tables (GAP-12) · everything under "Not in this tracker".

---

## The things that were not code — all of them now done

This section listed the external work that gated something real. **It is empty.** Kept as a record, because two of the three cost far more than their entry said they would.

1. ✅ **Asgardeo's console change** — 5 August 2026. JWT token type, PKCE mandatory, hybrid flow off, four redirect URLs. **This entry read "ten minutes, blocks nothing else" and both halves were wrong**: it blocked every deployed login, and the client work behind it was unbuilt and unsized. See B8.
2. ✅ **Deployment** — 5 August 2026. Both environments live, both Neon branches migrated, deploy-on-merge for each. It needed **no application code at all**, because every route already sat under `/api/*` and the client already defaulted its base URL to `""`.
3. ✅ **CI's integration workflow** — below.

**The one still outstanding is P14's twelve Meta template approvals**, and it is the only thing on either track waiting on anybody else. Worth firing now regardless of when P14 runs — each approval is minutes to two days, and they queue.

**Done, 5 August 2026: CI's integration workflow.** Was blocked on `secrets.NEON_API_KEY`/`vars.NEON_PROJECT_ID`, absent from the repo — no endpoint had ever been tested by CI at all. Configured via the Neon GitHub App and verified with a real PR run: all seven migrations applied from scratch, the DM §13 drift check, and all 328 integration tests, green, in 12m49s. One live bug surfaced and fixed along the way — Neon's Free plan rejects an explicit `suspend_timeout` on branch creation outright, even at the value it already defaults to — recorded in [TRACKER.md](TRACKER.md) §5 so it isn't rediscovered. Nothing on either track depended on this, but it was the single highest-value non-code fix available, and it's done.

---

## When an item here is finished

Write it up in [TRACKER.md](TRACKER.md) as **one row**, not a section — what it delivers, its proof with real test counts, and a gap id for anything it did not build. Tick the row off here and move on. This file is a plan and goes stale; that one is the record.
