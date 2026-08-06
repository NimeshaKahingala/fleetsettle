# UI/UX review

**Date:** 5–6 August 2026
**Scope:** the built React client (`web/src`) against `docs/design/ui-ux-guidelines.md`, independent of TRACKER.md/Plan.md's own accounting of what's finished.
**Not a specification.** Where this disagrees with `docs/`, `docs/` is right. Where this finds a gap TRACKER.md doesn't list, that's a correction to TRACKER.md, not to this document.

## Method

This was not a read-through of the components in isolation. The app was actually run (`VITE_AUTH_MODE=stub npm run dev`) and driven with Playwright at 360×640 against realistic mocked API responses shaped from the real Zod schemas in `packages/shared/src/schemas`, screenshotting each screen in light and dark mode. Every finding below that claims a screen renders a certain way was seen rendering that way, not inferred. Every finding about *why* traces to the source line(s) cited. Two rounds: an initial pass across the main screens, then a targeted second pass chasing the pattern the first pass's headline finding revealed (see §1) and closing out components/screens the first pass hadn't reached.

**What this review did *not* do**, listed so the absence is a decision and not an oversight:
- No real backend — every screenshot is against mocked `page.route()` responses, not a live Neon-backed Worker. The bug in §1 is verified by reading the actual backend source (`api/src/domain/confirmDay.ts`), not by observing it against a real database.
- No `axe-core` run (the project's own a11y gate, `web/e2e`) and no full `npm run test:e2e`. Time-boxed manual review instead; §6 below flags this as worth doing before signing off on any fix.
- No real device — Chromium via Playwright only. iOS Safari-specific behaviour (keyboard accessory bar, PWA install, camera permission) is unverified.
- No screenshot of every sheet/screen in the app — coverage below is broad but not literally 100%. `CloseLeaseScreen`'s stepper and `ReasonPicker`'s reason-list sheet weren't independently screenshotted; both were read only.

---

## 1. Critical — the day-confirmation flow silently fails once a day has been pre-generated

This is F-4.2, "the flow the product is optimised around" (UI §7.1), and it is broken in the condition that is true for nearly every scheduled day today.

### The chain

1. **`generate-day-cards` runs daily in production.** A live Cron Trigger, `"30 20 * * *"`, on both environments ([api/wrangler.jsonc:56](api/wrangler.jsonc#L56), repeated at [:96](api/wrangler.jsonc#L96) and [:125](api/wrangler.jsonc#L125) for QA/production). It pre-inserts a `day_record` row in `state: 'open'` for every scheduled daily-lease day up to 90 days out ([day-card-generation.ts:75-114](api/src/domain/day-card-generation.ts#L75-L114)), always `state: "open"` by construction ([scheduled.ts:149-158](api/src/queries/scheduled.ts#L149-L158)). Both `fleetsettle.com` and `qa.fleetsettle.com` have been live since 5 Aug — this cron has run.

2. **The frontend can't tell `open` apart from confirmed.** [ConfirmDayCard.tsx:122-124](web/src/features/daily/ConfirmDayCard.tsx#L122-L124):
   ```ts
   const settled = dayQuery.data ?? optimistic;
   if (settled) { /* render the settled summary, no buttons */ }
   ```
   Any non-null GET response is treated as "already settled" — there is no check on `state`. [`stateLabel`](web/src/features/daily/ConfirmDayCard.tsx#L45-L59) maps `open` (line 55-57) to the string `"Confirmed"`, identical to a genuinely fully-paid day. The rendered card shows **"Confirmed / Rs 0"** with no buttons — not disabled, absent — for a day nobody has touched. Reproduced live, both themes, at 360×640 and 320×640.

3. **Even a fixed frontend would hit a backend bug.** [confirmDay.ts:52-70](api/src/domain/confirmDay.ts#L52-L70):
   ```ts
   const existing = await findDayRecordByLeaseAndDate(tx, input.dailyLeaseId, input.businessDate);
   if (existing) {
     return { dayRecord: existing, receivedMinor: obligationRow?.settledMinor ?? 0n, created: false };
   }
   ```
   *Any* existing row — confirmed or still `open` — short-circuits the write and returns the row **unmodified**. The user's actual tap (`paid_in_full` / `something_else` / `did_not_run`) is silently discarded: no obligation, no payment, no allocation gets written. The function's own doc comment states the premise this relied on: *"a day already confirmed — any state but the pre-generated-card `open`, which **nothing in this phase produces yet** (that's P13's `generate-day-cards`) — is a no-op"* ([confirmDay.ts:47-50](api/src/domain/confirmDay.ts#L47-L50)). That was true when written, at P3. **P13 shipped and made it false, and nothing re-checked it.**

### Why this is the same trap TRACKER.md already named twice

TRACKER.md §6 records two cases where "a gap's reason is a fact with a date on it" — GAP-13 and GAP-23, both re-examined and found stale on a later validation pass. This is a third instance of exactly that pattern, filed under **GAP-3** ("`confirmDay`'s pre-generated-open-card branch is dead code today, documented as such") and currently sitting in TRACKER.md's "Recorded, unowned, and correct to leave" table — i.e. nobody is watching it, and the "correct to leave" judgment was made before P13 existed. It should move to the scheduled table immediately.

### Confirmed not a mock-data artifact

Screenshotted side by side, same mocked data, only the day-record's existence differs:

| Row pre-generated (`state: "open"`, the live case) | Row never generated (404, the case every test exercises) |
|---|---|
| "Confirmed / Rs 0", zero buttons, dead end | Rs 5,000, all three buttons live |

No test in `api/tests/integration/day-record.test.ts` seeds an existing `open` row before calling confirm — every test starts from a clean slate, so this path has never been exercised by CI.

### Fix needs both layers, not just the visible one

- `ConfirmDayCard.tsx`: only treat a fetched row as settled when `state` is a terminal state (not `open`/`paused_for_trip`); otherwise render `DayCard`, seeded from that row's own `expectedMinor`.
- `confirmDay.ts`: the idempotency check at line 63 needs to distinguish "genuinely already confirmed" (safe no-op) from "pre-generated placeholder, still open" (should proceed to update that row rather than insert a new one, without violating the `(daily_lease_id, business_date)` unique index).
- Add the missing regression test: confirm a day where an `open` row already exists.

**Fixing only the frontend half would make the app *look* right and still lose the money.** This is the one thing in this whole review that should block everything else.

---

## 2. High priority

### 2.1 INV-1 (double-booked vehicle-day) has no `Dialog` anywhere in the client

UI §9.3 names exactly two blocking dialogs in the whole product: INV-1 and INV-17. `Dialog`'s own doc comment agrees — *"three call sites in the whole app"* ([Dialog.tsx:16-19](web/src/design/primitives/Dialog.tsx#L16-L19)). Grepping for actual `<Dialog>` usage (not comments referencing it) turns up exactly **one** real caller: `CloseTripSheet.tsx` for INV-17. Nothing renders `Dialog` for INV-1.

What actually happens on a double-booking conflict today: both `StartLeaseScreen` and `BookTripScreen` catch the mutation failure and render it as a bare line of red text — `mutation.error.message` ([StartLeaseScreen.tsx:447-449](web/src/features/vehicles/StartLeaseScreen.tsx#L447-L449), [BookTripScreen.tsx:306-308](web/src/features/trips/BookTripScreen.tsx#L306-L308)) — not a modal, and no "fix offered inline" the way §9.3 specifies.

This is lower-frequency than §1 (the calendar's own free-day-only tap targets prevent most accidental double-bookings; this is a race-condition / stale-calendar / direct-URL path), but it's a confirmed, unambiguous spec gap on the one other case the whole product treats as a hard stop.

### 2.2 Trip detail's app-bar title truncates

[TripDetailScreen.tsx:45-51](web/src/features/trips/TripDetailScreen.tsx#L45-L51) formats both trip dates with `year: "numeric"` unconditionally, producing `"1 Aug 2026 – 4 Aug 2026"`. At 360px, next to the Cancel-trip icon, this clips mid-digit to **"1 Aug 2026 – 4 Aug 2…"** (reproduced live). §8.3's own rule is being skipped: show the year only where it's ambiguous. The wireframe in §7.5 also leads with an identifier ("Trip #21 · Bus · 28–30 Jul") — today's title has neither a trip number nor a vehicle registration, only the one thing that doesn't fit.

### 2.3 Vehicle calendar's occupied-day cells are invisible to a screen reader

[VehicleCalendarScreen.tsx:172-207](web/src/features/vehicles/VehicleCalendarScreen.tsx#L172-L207): an occupied day (on a lease, ran, lost, on a trip) renders as a plain `<div>` — the state glyph is inside a `<span aria-hidden>` ([line 175](web/src/features/vehicles/VehicleCalendarScreen.tsx#L175)) and the container carries no `aria-label`. A sighted user reads state from colour + glyph; a screen-reader user gets only the bare day-of-month number, with no equivalent of "lost" or "on a trip" announced at all. This directly contradicts §10's own non-negotiable — *"a leading colour rule is `aria-hidden`, and the row reads 'He owes you, 8,000 rupees'"* — a rule `TwoBalances` follows correctly and the calendar doesn't. (Free days that *are* tappable do have a correct `aria-label`; this is specifically the occupied-cell case.)

### 2.4 M-26 (landscape) is entirely unimplemented, and it's not tracked anywhere

`grep -rn "landscape" web/src` returns nothing. `AppShell.tsx`'s tab bar (`h-14`, [AppShell.tsx:54](web/src/design/primitives/AppShell.tsx#L54)) and `Screen.tsx`'s app bar (`h-14`, [Screen.tsx:50](web/src/design/primitives/Screen.tsx#L50)) are hardcoded to the portrait 56px height with no orientation variant, contrary to M-26's explicit "below `md` in landscape the app bar collapses to 44px, the tab bar becomes icon-only at 44px."

Screenshotted at 640×360 (Home, the day card the whole app is themed around): the app bar and tab bar together consume enough of the 360px height that the day card's amount is visible but **all three action buttons sit below the fold**, reachable only by an extra scroll the spec explicitly tried to design away ("~192px of content between the chrome is enough for the day card once the chrome gives back 24px" — the chrome currently gives back nothing).

`TRACKER.md`/`Plan.md` have zero mentions of "landscape" or "M-26" — this genuinely isn't on anyone's list, unlike almost everything else in this codebase.

---

## 3. Medium — real, but already has a name and a place in the plan

### 3.1 M-12's offline mutation queue doesn't exist yet, and the UI overstates readiness for it in the meantime

This *is* correctly tracked — Plan.md's **B7** ("Offline and the PWA") names exactly what's missing: TanStack Query persistence, the paused-mutation queue replaying with a fresh token per attempt, the eviction warning. Confirmed absent: `grep -rn "persistQueryClient|PersistedClient|pausedMutations" web/src` — nothing. [main.tsx:31](web/src/main.tsx#L31) constructs a bare `new QueryClient()` with no persister and no mutation-pause configuration.

Two consequences worth being explicit about before B7 lands:
- **`OfflineBanner` has zero callers anywhere in the app** (`grep -rn "OfflineBanner" web/src` finds only its own definition and the `Screen.tsx` doc-comment mentioning where it *would* go). It's fully built, correctly matches its spec, and is wired to nothing.
- `SyncChip`'s only real caller reflects `!confirmMutation.isPending` ([ConfirmDayCard.tsx:131](web/src/features/daily/ConfirmDayCard.tsx#L131)) — i.e. "this specific request is currently in flight," not "this write is sitting in a durable queue." A real network drop today surfaces as a bare `confirmMutation.error.message` line, with no retry-on-reconnect and nothing that survives a reload. Given §1.3 opens the entire design document with *"the app must be usable while the network is not"*, this is the single biggest gap between the document's stated premise and the current build — but it's B7's gap to close, not a new one to file.

---

## 4. Low confidence — flagged, not confirmed

**Opening `AmountPad` from a `MoneyField` nested inside an already-open `Sheet`.** `SomethingElseSheet` opens a `MoneyField`, which itself opens `AmountPad` inside a second, nested `Sheet`. Driving this specific path in Playwright, the trigger button's click was repeatedly intercepted by the outer sheet's own overlay (`vaul`'s `data-vaul-overlay`), even with a forced click. The *same* component (`MoneyField` → `AmountPad`), reached directly and not nested inside another open sheet (`CollectPaymentSheet`), opened correctly on the first try and rendered exactly to spec. This could be a real `vaul` stacking-order issue specific to two drawers open at once, or it could be a headless-Chromium/automation artifact (a transitioning backdrop with a stale hit-test). **Recommend a two-minute manual check** — open "Something else" on a day card, tap "Earned today," confirm the keypad actually opens — before trusting this path in production.

---

## 5. What's solid

Worth stating plainly, since the brief was "seems not that good": the defect surface here is narrow and concentrated, not broad. Everything below was checked directly, not assumed:

- **Design tokens and primitives.** `Button` matches §4.3/§5.3 exactly — 44px floor, 56px CTA, `:active`-only feedback (no JS press handlers), correct variants. Dark mode is a genuine remap (not an invert) and held up cleanly across every screen captured.
- **The load-bearing five.** `DayCard`, `AmountPad`, `TwoBalances`, `AllocationPreview` (verified live via `CollectPaymentSheet` — date chips, keypad, all working) all match their wireframes closely, including the details (never-truncated money, "held as credit" language, the net line correctly muted and non-actionable in `TwoBalances`).
- **U-2 discipline.** `CreateVehicleForm` and the F-2.1 lease-start stepper both save on level-1 fields alone with everything else behind a `Disclosure`, matching the automated-test guarantee the spec calls for.
- **W-56 in practice, not just in the rule.** Trip detail's "Received" row correctly renders `NotAvailable` with a real, honest reason ("no receivable is raised yet for a trip's agreed amount") rather than a silent zero — and the same pattern repeats consistently across `CloseLeaseScreen`, `StartLeaseScreen`, `FuelFillSheet`, `RecordExpenseSheet` for the photo-upload gap (GAP-16). Nothing pretends to be more finished than it is.
- **`IncidentScreen`'s container pattern** works exactly as designed — every section (off-road, customer contribution, insurance claim, repair costs, bottom line) renders regardless of `status`, and "Close incident" is always reachable, matching TRACKER's own description of it as "a container, not a wizard."
- **`Timeline`, `PhotoCapture`, `EntityPicker`, `Provisional`** all read as careful, faithful implementations with correct `aria-label`s and no unimplemented edge cases found.
- **`Money.tsx`/W-56 discipline held under grep**, too — no stray `?? 0` on a rendered money value was found outside the one confirmed mock-data mistake in this review's own test script (see below).

One false lead worth recording so it isn't rediscovered: an expense category rendered as the lower-case string `"repair"` in an early incident-screen screenshot, looking like a missing label mapping. It wasn't — `EXPENSE_CATEGORY_LABEL` correctly maps `"repairs"` (the real enum value, confirmed against `packages/shared/src/schemas/expense.ts`) to `"Repairs"`; the mismatch was this review's own mocked test data using the wrong (singular) string. Recorded per this repository's own convention of writing down what didn't hold up, not just what did.

---

## 6. Before finalizing any modification — needs a second look

In priority order:

1. **Confirm §1 against a real deployment before writing a fix.** Everything here is verified against source and a mocked client — not against `fleetsettle.com`'s actual database. Before changing `confirmDay.ts`, check whether any `day_record` rows created since the 5 Aug deploy are already sitting in `state: 'open'` with a business date in the past (i.e., days that were silently never confirmable) — those need a decision about backfill, not just a forward fix. This is a **data question**, not just a code question, and it's the kind of thing this repository's own rules insist go through `docs/` deliberately rather than being patched around.
2. **The `confirmDay.ts` fix needs someone who owns the domain layer to design the update path**, not just gate on `state`. Turning the pre-generated `open` row into a real confirmed row means an `UPDATE`, not the existing `INSERT`-shaped function — and it has to stay inside the same one-transaction guarantee F-4.2 requires (day_record + obligation + payment + allocation), still respect `assert_period_open()`, and still be safe under the same concurrent-tap race the current unique-violation catch handles. This is real design work, sized closer to a small feature than a one-line fix.
3. **Decide where GAP-3 belongs before scheduling it** — it isn't a UI task alone; the fix spans `api/src/domain/confirmDay.ts` and `web/src/features/daily/ConfirmDayCard.tsx`, and per this repository's own layering rule the domain-layer contract should be settled first, with the client change following it, not the other way round.
4. **Manually verify §4 (low confidence)** — the nested-sheet `AmountPad` question — on a real browser before assuming either way.
5. **Run the project's own gates that this review didn't**: `npm run test:e2e` (Playwright + the 320/360px reflow assertions already written) and an `axe-core` pass on every route, both themes, per §10. This review found the calendar accessibility gap (§2.3) by hand; an automated pass may find more of the same class faster than manual review will.
6. **§2.1 (INV-1's missing Dialog) needs a product decision, not just a component swap**: what should the "fix offered inline" actually say for a double-booked vehicle-day? UI §9.3 requires it but doesn't wireframe it the way INV-17's dialog is wireframed in §7.5 — that copy needs writing, not just wiring.
7. **§2.4 (landscape)** is real but is the one finding here that's genuinely new scope, not a bug in something already built. It needs to be sized and placed in Plan.md rather than picked up ad hoc — M-26 touches `AppShell`, `Screen`, and potentially every screen built on top of them.

---

## 7. Additional Gaps Found on Further Validation

The following items were found on a subsequent pass against `docs/design/ui-ux-guidelines.md` and are appended here for completeness:

### 7.1 M-11: Undo functionality is completely unbuilt
UI §6.5/M-11 requires: *"Undo is a 5-second toast, and only for writes that sent no message and settled no obligation"*. 
However, in `web/src/design/primitives/AppShell.tsx`, the toast host is a bare `<div id="toast-root" />` with a comment explicitly stating no component renders into it yet. Any action qualifying for M-11's undo window currently has no way to be undone in the UI.

### 7.2 M-25: Vocabulary slip ("Rate" used in forms)
M-25 mandates: *"The interface has no accounting vocabulary... 'Daily lease amount' is never shortened to 'rate' on a screen where 'driver day fee' could also appear"*.
While the primary lease amount correctly avoids the word "rate", it still slipped into `StartLeaseScreen.tsx` and `RenewLeaseSheet.tsx`. Both components render an input with `label="Excess rate per km"`. To strictly adhere to M-25, this should be labelled "Excess fee per km" or "Excess charge per km".

### 7.3 M-10: `DialogConfirmFooter` defaults to a forbidden label
M-10 states: *"Irreversible actions get a two-step confirm with the consequence stated in the button — 'Close July permanently', not 'Confirm'"*. 
In `web/src/design/primitives/Dialog.tsx`, the `DialogConfirmFooter` component defaults its primary button text to exactly the forbidden word (`"Confirm"`) if a `confirmLabel` isn't provided. While existing usages (like sign out) override this correctly, having the default fall back to `"Confirm"` creates a trap for future irreversible actions to violate the guideline by omission.
