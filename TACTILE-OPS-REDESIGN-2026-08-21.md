# Tactile Ops redesign — design and implementation plan

**Written 21 August 2026, on `redesign/tactile-ops` (branched from `fix/pr93-review-findings` at commit `c8c2884`).**
**Status: planned, nothing built yet.** This document exists so a cold session — a fresh
context window, a different day, a different agent — can pick this up without re-deriving
any of it. `docs/` still decides; nothing here is a specification until it lands there
(Phase 8 of §6 below is exactly that landing). Read this document for *what, why, and
with what evidence*; there is no separate "how" companion the way GAP-12 and the
platform-admin doc split it — the phases in §6 carry both.

---

## 1. History — why this document exists

**House Style (M-34)** shipped first: a terracotta accent, a self-hosted Fraunces
display face on hero figures/screen titles, and one subtle card shadow. Committed as
`8e0eaa0` on `fix/pr93-review-findings`, bundled with unrelated bug fixes found while
re-verifying an earlier UI audit (`Dialog`'s destructive-button spacing, a missing
focus ring copy-pasted into five icon buttons, `--color-ink-faint` used on real text in
five places, `ReportTable` money columns not honoring M-16's per-column cents rule).
Full reasoning is in `docs/design/ui-ux-guidelines.md`'s M-34 entry.

**Tested live, it read as only a token tweak** — because it was. Only `Card.tsx`,
`Screen.tsx`, `StatTile.tsx`, and three money-figure call sites were touched. The
mockup that motivated it (see §2) redesigned the Add sheet, Vehicles list, and People
list — none of that reached real code. Confirmed by direct inspection at the time:
`VehicleListScreen.tsx` renders a bare, un-chipped `Truck` icon regardless of
`vehicle.vehicleType`; `PeopleListScreen.tsx` renders a bare `UserRound`; the real
`ActionSheet` primitive is a left-accent-bar-plus-label row with no icon chip and no
caption. The mockup was aspirational there, not a preview of code that already existed.

**Direction changed at the same time.** Rather than build out House Style's own
Add/Vehicles/People treatment, the decision was to switch to a different mockup option
entirely — "Tactile Ops" (Option B in the mockup, §2 below): cooler neutrals, a navy
accent instead of terracotta, no serif anywhere (Sora, not Fraunces), a bigger card
radius, and — the "depth" half of its name — real box-shadow on cards, rows, stat
tiles, buttons and the bottom sheet, including a colored glow under the primary CTA.

This is a materially bigger, riskier pass than House Style: full palette replacement
(not just the accent), a base-font replacement (not a scoped display face), and two
genuinely new shared components/patterns (`EntityAvatar`, `ActionSheet` icon chips +
captions) that don't exist in the app today. Hence: a written plan, checked against the
real codebase before writing any code, rather than repeating House Style's mistake of
inferring scope from the mockup's picture instead of the mockup's markup.

---

## 2. Source of truth — the mockup

Published artifact: **`FleetSettle Style Wall`**, artifact id `abdb664d-e7da-47d5-9690-aac08967c1c1`
(`https://claude.ai/code/artifact/abdb664d-e7da-47d5-9690-aac08967c1c1`). Four options
side by side (baseline / A "Quiet Ledger" / B "Tactile Ops" / C "combined pass"),
each rendered across four phone-frame mockups (Home, Add popup, Vehicles, People) using
real app copy (Sunil Perera, the bus, 30 Jul, Rs 5,000). Full HTML pulled and saved
locally to
`/Users/chamathwor/.claude/projects/-Users-chamathwor-Desktop-Projects-Nimesha-fleetsettle/7a53aac8-fa1a-4b90-9d62-608dac3c82ee/tool-results/artifact-abdb664d-1787305235-5f2c.html`
on 21 August 2026 — that local copy is the most durable reference if the hosted
artifact ever becomes unavailable. The option's own CSS comment names it: **"OPTION B —
Tactile Ops (depth + iconography, same hue family)."**

### 2.1 Exact CSS — Option B (`.m-b`), verbatim

```css
.m-b {
  background: #edeff3;
  color: #151a22;
  font-family: "Sora", sans-serif;
}
.m-b .app-bar {
  background: #ffffff;
  border-bottom: 1px solid rgba(21, 26, 34, 0.08);
}
.m-b .app-bar .name {
  font-weight: 700;
}
.m-b .biz {
  color: #5b6472;
}
.m-b .card {
  background: #ffffff;
  border: 1px solid rgba(21, 26, 34, 0.06);
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 10px 26px -14px rgba(21, 26, 34, 0.28);
}
.m-b .card .top {
  font-size: 13px;
  color: #5b6472;
  margin-bottom: 2px;
}
.m-b .card .who {
  font-size: 13px;
  color: #8a93a3;
  margin-bottom: 14px;
}
.m-b .card .hero {
  font-variant-numeric: tabular-nums;
  font-size: 34px;
  font-weight: 700;
  margin-bottom: 16px;
}
.m-b .btn.primary {
  background: #2952a3;
  color: #fff;
  box-shadow: 0 8px 16px -6px rgba(41, 82, 163, 0.55);
}
.m-b .btn.outline {
  background: #eef1f6;
  border: 1px solid transparent;
  color: #151a22;
}
.m-b .row {
  background: #ffffff;
  border: 1px solid rgba(21, 26, 34, 0.06);
  box-shadow: 0 6px 16px -12px rgba(21, 26, 34, 0.3);
}
.m-b .row .avatar {
  background: #2952a3;
  color: #fff;
}
.m-b .row .s {
  color: #5b6472;
}
.m-b .stattile {
  background: #ffffff;
  border: 1px solid rgba(21, 26, 34, 0.06);
  box-shadow: 0 6px 16px -12px rgba(21, 26, 34, 0.3);
}
.m-b .stattile .delta {
  color: #1b8a3f;
}
.m-b .bal .owe {
  color: #2952a3;
}
.m-b .bal .owed {
  color: #c1592b;
}
.m-b .list-head {
  background: #ffffff;
  border-bottom: 1px solid rgba(21, 26, 34, 0.08);
}
.m-b .list-head .action {
  color: #2952a3;
}
.m-b .section-head {
  color: #8a93a3;
}
.m-b .vrow {
  background: #ffffff;
  border: 1px solid rgba(21, 26, 34, 0.06);
  box-shadow: 0 6px 16px -13px rgba(21, 26, 34, 0.3);
}
.m-b .vrow .s {
  color: #5b6472;
}
.m-b .vrow .icon.truck,
.m-b .vrow .icon.car {
  background: #2952a3;
  color: #fff;
}
.m-b .vrow .icon.driver {
  background: #2952a3;
  color: #fff;
}
.m-b .vrow .icon.cust {
  background: #eef1f6;
  color: #3a4451;
}
.m-b .badge {
  background: #e3eaf8;
  color: #2952a3;
}
.m-b .badge.trip {
  background: rgba(193, 89, 43, 0.14);
  color: #9a4620;
}
.m-b .sheet-panel {
  background: #ffffff;
  box-shadow: 0 -14px 30px -18px rgba(21, 26, 34, 0.35);
}
.m-b .aicon-chip.in {
  background: #e3eaf8;
  color: #2952a3;
}
.m-b .aicon-chip.out {
  background: rgba(193, 89, 43, 0.15);
  color: #9a4620;
}
.m-b .aicon-chip.neutral {
  background: #eef1f6;
  color: #3a4451;
}
.m-b .acap {
  color: #8a93a3;
}
```

Font import used by the whole style wall (all four options share one `<link>`):
`https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,450;9..144,600;9..144,700&family=Work+Sans:wght@400;500;600;700&family=Sora:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap`
— confirms Sora at weights 400/500/600/700 is the intended range.

### 2.2 Shared skeleton CSS (option-independent — the structure every option restyles)

```css
.card {
  /* per-option override above; base shape only */
}
.row,
.vrow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px; /* vrow */ /* 14px for .row */
  border-radius: 10px;
}
.row .avatar,
.vrow .icon {
  width: 38px; /* row .avatar */ /* 36px for vrow .icon */
  height: 38px;
  border-radius: 999px; /* vrow .icon.circle only; vrow .icon default is 9px radius */
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stattile {
  padding: 16px;
  border-radius: 12px;
}
.btn {
  height: 44px;
  border-radius: 10px;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 10px 6px;
  border-radius: 10px;
  /* no box-shadow anywhere in this class, in any option — confirmed by reading the
     full stylesheet: Add-sheet rows stay flat even under Tactile Ops */
}
.action-row .aicon-chip {
  width: 38px;
  height: 38px;
  border-radius: 999px;
}
.action-row .albl {
  font-size: 14px;
  font-weight: 600;
}
.action-row .acap {
  font-size: 11.5px;
  line-height: 1.3;
  opacity: 0.6;
}
.sheet-panel {
  border-radius: 20px 20px 0 0;
  padding: 12px 12px 20px;
}
.badge {
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 10.5px;
  font-weight: 600;
}
```

Note the exact radii the mockup itself uses, verbatim: `.card` 18px, `.row`/`.vrow`/
`.action-row` 10px, `.stattile` 12px (unchanged from baseline), `.sheet-panel` 20px,
icon chips/avatars/badges `999px` (full circle/pill). §6 Phase 2 deliberately does
**not** chase the row/action-row 10px value — the real app's equivalent token
(`--radius-sm`, 8px) has 89 live usages across buttons/inputs/menus, not just rows, and
moving it is unscoped for what this redesign actually needs. This is a recorded,
deliberate small divergence from the mockup's literal pixel value, not an oversight.

### 2.3 Baseline (`.m-base`) values, for contrast against what's shipping today

```css
.m-base {
  background: #f1f1ec;
  color: #14140f;
}
.m-base .card {
  background: #fbfbf8;
  border: 1px solid rgba(20, 20, 15, 0.1);
  border-radius: 12px;
}
.m-base .btn.primary {
  background: #256abf; /* pre-House-Style blue, now historical */
}
```
(Confirms the mockup's "baseline" already matched the shipped tokens at the time it was
built, before House Style's terracotta swap.)

---

## 3. Research findings — grounding against the real codebase

Two Explore agents ran in parallel on 21 August 2026, plus direct grep/read. Findings
below are what actually informed §6's scope — treat this section as load-bearing, not
appendix.

### 3.1 Icon/avatar inventory (what needs `EntityAvatar`, and what doesn't)

All rows inspected are already built on the shared `Card` primitive
(`web/src/design/primitives/Card.tsx`) — adding a chip means new markup inside each
`Card`'s children, not a `Card` prop change.

**VEHICLE**
- `web/src/features/vehicles/VehicleListScreen.tsx:59` — bare `<Truck className="size-5 shrink-0 text-ink-muted" aria-hidden />`, inside `<Card accent={...} className="flex items-center justify-between gap-4">`. **All** `VehicleType` values (`"Bus" | "Car" | "Van"`, `packages/shared/src/schemas/vehicle.ts:12`) render the same `Truck` glyph today — no type-specific icon switch exists. Fixing this is a genuine, if minor, existing-bug fix, not just a restyle.
- `web/src/features/vehicles/VehicleOverviewScreen.tsx:388` — same bare `Truck` at `size-6`, detail-header context, inside the screen's first `<Card className="flex flex-col gap-3">`. `vehicle.vehicleType` is shown as plain text at line 396 but never drives the icon.

**DRIVER**
- `web/src/features/people/PeopleListScreen.tsx:68` — bare `<UserRound>`, inside `<Card className="flex items-center justify-between gap-4">`. Needs **initials**, not an icon, per the mockup's `.row .avatar` treatment.
- `web/src/features/people/DriverDetailScreen.tsx` — header (`Screen title={driverQuery.data?.name}`, line 263) has **no icon/avatar at all today** — nothing to re-skin; this is net-new markup in the first `<Card className="flex flex-col gap-3">` at line 286.

**CUSTOMER**
- `web/src/features/people/PeopleListScreen.tsx:106-110` — already type-branches: `customer.customerType === "person" ? <UserRound/> : <Building2/>`, both bare, inside the same `Card` row shape. Only the "person" branch becomes initials; "organisation" (`Building2`) becomes an icon chip, not initials.
- `web/src/features/people/CustomerDetailScreen.tsx` — same as driver detail: no icon in the header today (first `<Card className="flex flex-col gap-3">` at line 230).

**EXPLICITLY EXCLUDED**
- `web/src/features/cash/CashScreen.tsx:195` — a cash-holding **partner** row uses `<HandCoins className="size-5 shrink-0 text-ink-secondary" />`, a money-state metaphor icon, not a person icon, and a different muted color (`text-ink-secondary`, not `-muted`). Doesn't cleanly fit either the icon-chip or initials rule. Left out of this pass on purpose — forcing a fit risks inventing meaning the design doesn't actually have. `web/src/features/cash/CashScreen.tsx:218`'s `<Landmark>` ("Banked" destination) is an institution, not a person — same exclusion logic.
- Everything in `AdminHomeScreen.tsx`, `MoreScreen.tsx`, `UsersListScreen.tsx`, `RequestQueueScreen.tsx`, `MembersScreen.tsx`, `ReportsCatalogueScreen.tsx`, `VehicleMonthReportScreen.tsx`, `PartnerSetupScreen.tsx`, `OpeningBalanceScreen.tsx` — either navigation-category icons (not entity identity) or rows with no leading icon at all (only trailing chevron/kebab/delete icons). Confirmed false positives from the original grep, not chip candidates.

### 3.2 `ActionSheet` consumers — who gets a caption, who doesn't

`ActionSheetAction[]` is built in 13 real files (a 14th, `ExpenseCostRow.tsx`, only
*mentions* `ActionSheet` in a comment — not a consumer). Per-file caption verdict,
checked against actual action counts and label content, not assumed:

| File | Actions | Caption? | Why |
|---|---|---|---|
| `QuickAddSheet.tsx` | 5 fixed (Fuel, Expense, Payment received, Payment made, New trip) + dynamic recent-contact tail | **Yes**, fixed 5 only | The exact case the mockup depicts; the only genuinely fixed, always-five menu in the app. Dynamic tail (`Customer - ${name}`) stays label-only — generated text doesn't want a caption. |
| `PartnerDetailScreen.tsx` | 2 (Capital contribution, Partner payout) | Flagged, not built | Same shape as Quick Add's money menu; captions ("Money you put in" / "Money you take out") would add real clarity — left as a documented future add, not built this pass. |
| `PartnerSetupScreen.tsx` | 2 (Set ownership shares, Share vehicle) | No | Maybe-case; labels already adequately clear. |
| `MileagePackagesScreen.tsx` | 1 (Archive package) | No | Single utility action, caption is pure noise. |
| `RequestQueueScreen.tsx` | 2 (Approve, Decline) | No | Binary, self-evident verbs on an already-selected row. |
| `UsersListScreen.tsx` | 1-2 (Set allowance, Grant admin) | No | Small fixed menu, already descriptive. |
| `LeaseHubScreen.tsx` | Two menus, up to 4 each | No | Two stacked menus already; more text risks feeling busy. |
| `PeopleListScreen.tsx` | 2 (Add a driver, Add a customer) | No | Simple trigger menu, self-evident. |
| `DriverDetailScreen.tsx` | Two menus (money ~5, account ~4) | No | Fixed but moderately long; captions plausible for the money half but not built this pass to keep scope to the one confirmed case. |
| `CustomerDetailScreen.tsx` | ~4 (Collect payment, Write off, Archive) | No | Same reasoning as driver detail. |
| `VehicleOverviewScreen.tsx` | 12+, highly conditional | No | Long dynamic/conditional list — a caption on every possible item is real clutter, not clarity. |
| `IncidentScreen.tsx` | ~4 | No | Small fixed menu, already clear. |
| `MembersScreen.tsx` | 2 (Change role, Revoke access) | No | Simple, self-explanatory. |

### 3.3 Token reach — what's safe to redefine, what isn't

From `web/src/design/tokens.css` (as of House Style, before this redesign):

| Token | Value | Real usage count | Consumers |
|---|---|---|---|
| `--radius-sm` | 8px | **89** | Buttons, inputs, menu rows, `ActionSheet`, `Toast`, `NativeSelect` — dominant, do-not-touch |
| `--radius-md` | 12px | 8 | `Card.tsx`, `Dialog.tsx`, `StatTile.tsx` (button variant) — small, precise target for the card-radius bump |
| `--radius-lg` | 16px | 1 (`Sheet.tsx`'s `rounded-t-lg`) | Essentially unclaimed — safe to redefine |
| `shadow-card` | (House Style value) | 3 (`Card.tsx`, `StatTile.tsx`, one comment) | The mechanism to reuse, value to change |
| `shadow-md` (untokenized Tailwind default) | — | 3 (`Card.tsx`'s `elevated` prop, `Card.test.tsx`) | Leave alone — the day card's own stronger tier, unrelated to this pass |
| `shadow-lg` (untokenized) | — | 1 (`Toast.tsx`) | Unclaimed |
| `rounded-full` | — | 13 | Already the established circular-chip radius (`Sheet.tsx` drag handle, `Badge.tsx`) — `EntityAvatar` and the `ActionSheet` icon chip should reuse this, not invent a new token |
| `Checkbox.tsx` | `rounded-[4px]` | 1 | Arbitrary value, no token — out of scope, noted only for completeness |

**Because every row inventoried in §3.1 already renders through `<Card>`, redefining
`--shadow-card`'s value elevates cards *and* rows together — no separate `--shadow-row`
token is needed.** This was the single biggest scope-reducer the research found versus
the naive reading of the mockup CSS (which appears to define `.row`/`.vrow` shadows
separately from `.card`, but that's an artifact of the mockup's own component
duplication, not a signal the real app needs two tokens).

---

## 4. Color validation — numbers already run, `dataviz`'s `validate_palette.js`

Run from `/private/tmp/claude-503/bundled-skills/2.1.238/6d3ef6e4e318009f9ef3d376761bed8d/dataviz`
(bundled `dataviz` skill; re-locate via the skill listing if this path has moved).
Command shape: `node scripts/validate_palette.js "<candidate>,<existing-adjacent-colors>" --mode <light|dark>`.

### 4.1 Light mode — wide open

Existing adjacent colors to stay distinct from: `--l-chart-1` `#2A78D6`,
`--l-payable` `#EB6834`. The mockup's own `#2952A3` fails against `--l-chart-1`
(ΔE 12.3 normal-vision, below the 15 hard floor — too close, both mid-saturated blues).
Deeper navy candidates all clear cleanly:

| Candidate | CVD ΔE (worst adjacent) | Normal-vision ΔE | Verdict |
|---|---|---|---|
| `#2952A3` (mockup's literal value) | 11.8 | 12.3 | FAIL (too close to chart-1) |
| `#1E3A6E` | 22.2 | 22.9 | PASS |
| `#173A75` | 21.7 | 22.3 | PASS |
| `#0F2E63` | — | 27.0 | PASS (widest margin found) |
| `#233E6B` | 21.5 | 22.3 | PASS |

None of these four finalists were run through the full WCAG contrast battery yet
(white-on-fill for buttons, ink-vs-page, ink-vs-surface, brand-wash tint derivation) —
that's Phase 1 work, not done here. This section only establishes that the *hue-family
separation* problem (the thing that actually blocked candidates) is solved; final
selection still needs the same full battery House Style's terracotta got.

### 4.2 Dark mode — same structural ceiling House Style hit

Existing adjacent dark colors: `--d-chart-1` `#3987E5`, `--d-payable` `#D95926`.
Every brand-blue candidate bright enough to read against `#141413` converges toward
`--d-chart-1`'s own hue — the identical shape of problem House Style's dark terracotta
hit against `--d-payable`. Tested:

| Candidate | CVD ΔE | Normal-vision ΔE | Verdict |
|---|---|---|---|
| `#5B7FD9` | 1.9 | 3.6 | FAIL |
| `#7B8FE8` | 3.7 | 7.3 | FAIL (also outside lightness band) |
| `#4A6FE0` | 5.3 | 6.1 | FAIL |
| `#6C63D4` | 5.6 | 9.8 | FAIL |
| `#5A6FE0` | 4.4 | 6.3 | FAIL |
| **`#4E5FC9`** | **9.2** | **10.5** | Best found — clears the CVD-8 floor, not the stricter 15 solo-swatch floor |

**Expected resolution, not yet written into tokens.css:** accept the best-scoring dark
pair (or a further-refined sibling of `#4E5FC9`) on the same basis M-34 already
established precedent for — brand and payable never appear without their own word
attached (M-15), so the two colors never have to carry the distinction alone. This is
not a new argument invented for Tactile Ops; it's the same argument, same doc section,
applied to a new hue. Final dark fill+ink pair still needs the full contrast battery
(white-text-on-fill, brand-ink-vs-surface) before locking, same as light.

---

## 5. Decisions already made

Asked and answered via `AskUserQuestion` on 21 August 2026, before planning began:

1. **Palette scope: full replacement** (not accent-only). Page/surface/ink all move to
   Tactile Ops' cooler neutral family — bigger footprint, every §5.1 contrast row in
   `ui-ux-guidelines.md` needs re-measuring, not just the new accent's row.
2. **Typography: self-host Sora**, replacing `system-ui` everywhere (not scoped to hero
   figures the way Fraunces was) — variable-weight woff2, Latin + Latin-Extended
   subset (broader than Fraunces' fixed-vocabulary subset, since Sora covers arbitrary
   user data).
3. **Icon chips: build now**, not deferred — `EntityAvatar` (new shared primitive) and
   `ActionSheet` icon-chip + caption support both land in this pass, per §3.1/§3.2's
   scoped inventory.
4. **Branch: new branch**, not stacked on `fix/pr93-review-findings`. Created 21 August
   2026: `redesign/tactile-ops`, branched from `fix/pr93-review-findings` at commit
   `c8c2884` ("Let the local web dev server proxy /api to a hosted backend" — an
   unrelated, already-merged-to-that-branch infra change, not part of this redesign).

---

## 5A. Revalidation pass — 21 August 2026, before any code

The plan above was re-checked against the real codebase specifically to avoid repeating
House Style's failure (a plan that looked complete, but whose scope left most screens
visually untouched). Findings below are load-bearing; two of them changed the plan.

### 5A.1 Verified safe — no action needed

- **`web/src/lib/cn.ts` needs no new entries.** Tested empirically against the real
  `extendTailwindMerge` config: `shadow-sheet`, `shadow-btn-primary`,
  `bg-surface-sunken` and `rounded-full` all resolve correctly by prefix
  (`bg-surface bg-surface-sunken` → last wins; `rounded-md rounded-full` → `rounded-full`).
  The known custom-token hazard applies only to custom **text-size** and **spacing**
  names (`text-body`, `min-h-tap`), which this redesign does not add to.
- **`Badge.tsx` inherits for free.** Its `brand` variant is already
  `bg-brand-wash text-brand-ink` — an exact structural match for the mockup's
  `.badge` (`#e3eaf8` on `#2952a3`). No edit needed; it follows the Phase 1 palette.
- **`AppShell.tsx`'s bottom nav inherits for free.** Fully token-driven
  (`bg-surface`, `border-line-hairline`, active tab `text-brand-ink` + brand pill).
  The mockup never showed the tab bar, but it needs no work.
- **Existing tests survive the token-value changes.** `Card.test.tsx` asserts class
  *names* (`rounded-md`, `shadow-md`), not computed values, so changing
  `--radius-md`'s value passes. `CloseMonthScreen.test.tsx` and `MoreScreen.test.tsx`
  use `[class*="rounded-md"]` as a DOM selector to locate cards — still matches.
- **`tokens.test.ts`'s dark-parity test is a help, not an obstacle.** It compares the
  `@media (prefers-color-scheme: dark)` block against the `[data-theme="dark"]` block
  declaration-by-declaration, so every new token (`--shadow-sheet`,
  `--shadow-btn-primary`, `--color-surface-sunken`) **must** be declared in both,
  identically, or the suite fails. Treat it as the guard rail it is.

### 5A.2 Gap found — form controls (this is the repeat-rework risk)

**75 files** render form controls via six shared primitives — `Input.tsx`,
`NativeSelect.tsx`, `Field.tsx`, `MoneyField.tsx`, `EntityPicker.tsx`, `DateField.tsx`.
Every one uses the *outlined* language: `rounded-sm` + `border border-line-strong` +
`bg-surface`.

The original plan changed `Button`'s `outline` variant to filled-recessed
(`bg-surface-sunken`, transparent border) but left every input outlined. Two
consequences, both bad:

1. **Incoherent** — a filled secondary button sits directly beneath an outlined input.
2. **Repeats the exact complaint that started this document.** Of the 15 screens that
   don't use `Card` (§3.3's inheritance path), **11 are report screens and 4 are form
   screens** (`MineScreen`, `StartLeaseScreen`, `StartDailyLeaseScreen`,
   `BookTripScreen`). With form controls untouched, those screens receive *only* colour
   and font — precisely "I only see color and font changes."

The mockup cannot settle this: it never drew a form or a report screen. **Decided 21
August 2026: extend the filled/recessed language to all form controls** (new Phase 4
below).

### 5A.3 Gap found — §13's performance budget

`docs/design/ui-ux-guidelines.md` §13 reads:

> | Fonts | System sans only for `en`; Sinhala subset ≤ 60KB, `swap`, loaded on demand |

**House Style already violated this** by self-hosting Fraunces, and never updated §13
or recorded the reversal — a genuine miss in the previous pass, found here. Tactile Ops
makes the violation structural rather than incidental, since Sora becomes the base
font for all English text. §13 must be updated as part of Phase 8, with the reversal
recorded the same way §5.3's elevation reversal was.

Related, worth correcting while in there: §13 asserts *"The budget is a CI gate, not an
aspiration. A PR that exceeds it fails."* — **it is not.** `scripts/check-forbidden.mjs`
enforces only the `--color-*` prefix rule, and no workflow in `.github/workflows/`
checks bundle size. Documentation-only today; the sentence overclaims.

### 5A.4 Sora — real measured numbers

From the Google Fonts `css2` API (`family=Sora:wght@400..700`), one variable file
covering the whole 400–700 weight range:

| Subset | Bytes | Note |
|---|---|---|
| `latin` | **25,284** | `U+0000-00FF` + common punctuation/symbols |
| `latin-ext` | 12,156 | Accented/extended Latin |
| *(Fraunces, for comparison)* | 9,400 | Being removed in Phase 3 |

**Decision: ship `latin` only (~25KB).** Sri Lankan romanized names and vehicle plate
numbers are ASCII; `latin-ext` adds ~48% weight for glyphs this app is unlikely to
render. Revisit only if real data shows accented characters in names.

### 5A.5 Thin test coverage under the riskiest change

**No test anywhere asserts `font-display`, `--font-display`, or Fraunces.** Removing it
(Phase 3) will fail nothing loudly, under what is simultaneously the
highest-blast-radius change in the plan. This is not a reason to add speculative tests
— it is a reason Phase 8's real-browser QA is mandatory, not optional, and why Phase 3
says to land the font swap separately from the colour/shadow work so a regression stays
attributable.

### 5A.6 Minor pre-existing inaccuracy to fix in passing

`Card.tsx`'s comment claims `elevated`'s `shadow-md` *"stacks on top of `--shadow-card`
rather than replacing it."* It does not. Both classes survive tailwind-merge (verified),
but both set `--tw-shadow`, so CSS source order decides and one simply wins. Correct the
comment when Phase 2 touches the file; the runtime behaviour is fine, only the
explanation is wrong.

---

## 6. Implementation plan — 9 phases

### What's already true (reuse, don't rebuild)
- `--shadow-card` token + mechanism (`tokens.css`, `Card.tsx`) — House Style's real
  contribution. This redesign changes its *value*, not its existence.
- `vehicleTypeSchema = z.enum(["Bus", "Car", "Van"])` (`packages/shared/src/schemas/vehicle.ts:12`)
  — bus-vs-car icon selection needs no new data.
- `customer.customerType === "person" | "organisation"` branch already exists
  (`PeopleListScreen.tsx:106-110`) — the chip wraps an existing correct choice.
- `ActionSheetAction`'s `tone?: "in" | "out"` prop already carries the money-direction
  signal the icon-chip's fill color keys off.
- The Fraunces self-hosting pipeline (Google Fonts `css2` API `text=` subset param →
  downloaded `woff2` → `@font-face` with `unicode-range`) is the template for Sora,
  adjusted per §6 Phase 3 for a broader charset.

### Phase 1 — Palette (full replacement)
`web/src/design/tokens.css`, `:root` palette block + both dark selectors:
- `--l-page`/`--l-surface`/`--l-ink1/2/3`/`--l-faint`/`--l-strong` (+ `--d-*`) move to
  Tactile Ops' cooler neutrals (`#EDEFF3` page family / `#FFFFFF` surface / `#151A22`
  ink family, per §2.1).
- `--l-brand`/`--l-brandink`/`--l-wash` (+ `--d-*`) move to the new navy — final hex
  chosen from §4.1's candidates after the full contrast battery (not just adjacency).
- `--color-direction-payable`: **unchanged**, same reasoning as House Style — no need
  found to move it, moving it means re-touching every report/chart keyed off it.
- New `--color-surface-sunken` token (light + dark) for the button/chip recessed fill
  (§2.1's `#eef1f6` family) — distinct from `--color-page`.
- `--l-chart-*`/`--d-chart-*`: **unchanged**. §11.2's validated categorical order stays.
- Re-validate every `--color-*` row in `ui-ux-guidelines.md` §5.1 — the one place "full
  palette" costs more than House Style's accent-only change did.

### Phase 2 — Elevation and radius
- `--shadow-card`: redefine to Tactile Ops' heavier value, both modes. Elevates cards
  *and* rows together (§3.3 finding) — no new `--shadow-row` token.
- `--radius-md` 12px → 18px (8 consumers: `Card.tsx`, `Dialog.tsx`, `StatTile.tsx`).
- `--radius-lg` 16px → 20px (1 consumer: `Sheet.tsx`'s `rounded-t-lg`).
- New `--shadow-sheet` token (upward-cast) on `Sheet.tsx` — currently has no shadow at
  all, this is net-new.
- New `--shadow-btn-primary` token (brand-colored glow, both modes) on `Button.tsx`'s
  `primary` variant only.
- **Wrap `ReportTable`'s `<div className="overflow-x-auto">` in a `<Card>`** (decided
  21 August 2026, §5A.2's sibling question). §3.3 established that 11 report screens
  don't use `Card` and so inherit no elevation at all; this single change in
  `web/src/features/reports/ReportTable.tsx` gives every report table the new radius
  and elevation, so reports stop being the one flat outlier. Keep the existing
  `overflow-x: auto` behaviour intact — §11.3 requires the *table* to scroll
  sideways, never the page, and nesting it in a `Card` must not break that.
- Fix `Card.tsx`'s inaccurate `elevated`/`shadow-md` "stacks on top" comment while in
  the file (§5A.6).
- Every new token goes in **both** dark blocks identically, or `tokens.test.ts`'s
  parity test fails (§5A.1).
- **Re-run the scroll-performance benchmark** (same method as M-34: scratch HTML +
  chrome-devtools MCP, 100-card list, 360×640, 10× CPU throttle) against the *new*
  heavier multi-surface shadow load — House Style's number covered one subtle
  single-layer shadow; this now shadows rows, stat tiles, buttons and the sheet
  simultaneously and needs its own measurement, not an inherited pass.

### Phase 3 — Typography (Sora, full replacement)
- Self-host Sora as the new `--font-sans`: one variable-weight woff2 covering 400–700,
  **`latin` subset only (~25KB)** per §5A.4's measured numbers — not `latin-ext`. Does
  **not** touch `:lang(si)`/`:lang(ta)`'s existing Noto stacks (`tokens.css` lines
  268-276).
- Remove Fraunces entirely: `@font-face`, `--font-display` token,
  `web/public/fonts/fraunces-600-latin.woff2`, and every `font-display` class usage
  (`Screen.tsx`, `StatTile.tsx`, `DayCard.tsx`, `AmountPad.tsx`, `ConfirmDayCard.tsx`).
  Delete completely, no dormant asset left — Tactile Ops has no serif anywhere.
- Highest-blast-radius change in the plan (every text element in the app). Do it last
  among token-layer changes; screenshot a representative screen spread before/after so
  a regression is traceable to "the font swap" alone.

### Phase 4 — Controls: buttons *and* form fields
Per §5A.2 — this phase was "Button variants" only in the first draft; extending it to
form controls is what stops form-heavy screens from reading as merely recoloured.

`web/src/design/primitives/Button.tsx`:
- `outline`: bordered-transparent → filled `bg-surface-sunken`, `border-transparent`.
- `primary`: add `shadow-btn-primary` alongside existing `bg-brand`.
- `ghost`, `destructive`: unchanged — mockup shows no distinct treatment for either.

Form controls — the same filled/recessed language, applied at the six shared
primitives so all 75 consuming files inherit it without individual edits:
- `web/src/design/primitives/Input.tsx`
- `web/src/design/primitives/NativeSelect.tsx`
- `web/src/design/primitives/Field.tsx` (label/optional/error shell — check whether it
  carries its own border; it may need nothing)
- `web/src/components/MoneyField.tsx` (line 71's `rounded-sm border border-line-strong bg-surface`)
- `web/src/components/EntityPicker.tsx` (line 65, same shape)
- `web/src/components/DateField.tsx`
- `web/src/design/primitives/Checkbox.tsx` — note its `rounded-[4px]` arbitrary value
  (no token); decide whether it joins the language or stays as-is, and record which.

Each moves from `border border-line-strong bg-surface` to
`border-transparent bg-surface-sunken`. **Keep `--radius-sm` (8px) unchanged** — §3.3's
89 usages make it the wrong lever, and the mockup's 10px row/control radius is a 2px
difference not worth that blast radius (recorded divergence, see §2.2).

**Focus and error states must survive the change.** `Input.tsx` currently relies on
`aria-[invalid=true]:border-2 aria-[invalid=true]:border-critical` — with a transparent
resting border, verify the invalid state still reads clearly against the new sunken
fill, and that `focus-visible:ring-focus-ring` still has enough contrast against it.
This is the one place the filled language can regress accessibility if applied
mechanically.

### Phase 5 — `EntityAvatar` (new shared primitive)
New file `web/src/design/primitives/EntityAvatar.tsx`. Circular badge, 36px (list) /
48px (detail header), icon or two-letter initials, solid-filled — full rule table in
§3.1. Vehicles + drivers → brand-tone solid fill, white glyph/initials. Customers
(person or org) → neutral tone (`--color-surface-sunken` fill, dark glyph/initials).
`CashScreen.tsx`'s partner row explicitly excluded (§3.1). New white-on-brand and
dark-on-sunken text pairs need their own WCAG 4.5:1 AA check in Phase 8 — this is real
identifying text (initials), not decoration, so it needs the text floor, not the 3:1
non-text floor House Style's icon-only elements used.

### Phase 6 — `ActionSheet` icon chip + optional caption
`web/src/design/primitives/ActionSheet.tsx`:
- Wrap each action's icon in a circular **wash**-tint chip (not solid fill — keep
  distinct from `EntityAvatar`'s solid fill, matching the mockup's own
  `.aicon-chip`-vs-`.vrow .icon` distinction), colored by existing `tone` prop.
- Add optional `caption?: string` to `ActionSheetAction`. Omitted → today's single-line
  row, unchanged (backward compatible). Caption copy scoped to `QuickAddSheet.tsx`'s 5
  fixed actions only, per §3.2's table.

### Phase 7 — Apply `EntityAvatar` at the confirmed sites
`VehicleListScreen.tsx`, `VehicleOverviewScreen.tsx`, `PeopleListScreen.tsx` (both
branches), `DriverDetailScreen.tsx`, `CustomerDetailScreen.tsx` — mechanical swaps now
that the component and color rule are fixed in Phase 5.

### Phase 8 — Docs and validation
- `docs/design/ui-ux-guidelines.md`: new **M-35** entry, "Tactile Ops supersedes House
  Style (M-34)." States plainly why (seeing House Style live, the actual ask was a
  structural redesign across the component set, not a retheme). M-34's own real-device
  caveat and specific hexes are superseded; its `--shadow-card` mechanism and its
  resolution of §16's open brand-identity item are not (still resolved, different
  palette). M-34's entry **stays in place** with a "superseded by M-35" pointer — not
  deleted, not rewritten. Update every §5.1 contrast row, the §5.2 type table (Sora,
  not Fraunces), §5.3's elevation section (new values + re-run benchmark numbers).
- **`docs/design/ui-ux-guidelines.md` §13 — the performance budget (§5A.3).** Its
  `Fonts | System sans only for en` row is already false as of House Style and becomes
  structurally false here. Update it to state the self-hosted Latin subset and its
  measured size, recording the reversal explicitly — the same treatment §5.3's
  elevation reversal got — rather than editing the number silently. While there, fix
  §13's overclaim that *"The budget is a CI gate, not an aspiration. A PR that exceeds
  it fails."* — no script or workflow enforces it (§5A.3). Either soften it to match
  reality or mark it an unbuilt intent; do not leave it asserting something untrue.
- `docs/design/brand-guidelines.md`: same treatment as the last pass — new "Regenerated"
  note, mark/icon PNG assets need a **second** `rsvg-convert` regeneration once the new
  navy is locked.
- Full `npm run check` (guard/lint/lint:css/format:check/typecheck/test).
- Real browser QA via chrome-devtools MCP — mandatory, not optional (§5A.5: no test
  covers the font swap). Cover **all four surface families**, light and dark, because
  each inherits differently and the whole point is that none is left flat:
  1. `Card`-based screens — Home, Vehicles, People, a detail screen
  2. The Add sheet (`ActionSheet` chips + captions)
  3. A **form** screen — `BookTripScreen` or `StartLeaseScreen` (Phase 4's filled
     controls; this family is what §5A.2 found untouched)
  4. A **report** screen — one with `ReportTable` and one with `StatTile`
     (Phase 2's Card wrap)

### Phase 9 — Git
House Style's commit (`8e0eaa0`) bundled unrelated bug fixes with the visual tokens.
This redesign **supersedes only the visual token values**, via new commits on
`redesign/tactile-ops` — does not revert or touch the bug-fix parts (Dialog spacing,
focus rings, ink-faint contrast, M-16 alignment), which remain correct and unrelated to
style direction.

---

## 7. Status checklist

- [x] Mockup CSS extracted and preserved (§2)
- [x] Real-codebase research done, icon/ActionSheet/token inventories complete (§3)
- [x] Color separation pre-screened, light mode solved, dark mode's structural ceiling
      confirmed and precedented (§4)
- [x] Scope decisions made (§5)
- [x] Branch created: `redesign/tactile-ops`
- [x] **Revalidation pass against the real codebase (§5A)** — two gaps found and folded
      in (form controls, §13's font budget), four assumptions verified safe
- [ ] Phase 1 — palette
- [ ] Phase 2 — elevation/radius + `ReportTable` Card wrap + re-run perf benchmark
- [ ] Phase 3 — Sora self-hosting (latin subset), Fraunces removal
- [ ] Phase 4 — controls: buttons **and** the six form primitives
- [ ] Phase 5 — `EntityAvatar` component
- [ ] Phase 6 — `ActionSheet` icon chip + caption
- [ ] Phase 7 — Apply `EntityAvatar` at the 5 confirmed call sites
- [ ] Phase 8 — Docs (M-35, §13 budget, brand-guidelines, icon regeneration) + full
      check + browser QA across all four surface families
- [ ] Phase 9 — final commit(s) reviewed for scope (visual tokens only, bug fixes untouched)

---

## 8. Companion files

- Plan-mode working file (external to this repo, may not persist across sessions —
  this document is the durable copy): `/Users/chamathwor/.claude/plans/steady-fluttering-lampson.md`
- House Style's own decision record: `docs/design/ui-ux-guidelines.md` M-34 entry
  (§5.1/§5.2/§5.3, and the `## 17`-style decision-log table)
- `docs/design/brand-guidelines.md` — House Style's brand-hex regeneration note, needs
  a second pass once this redesign's navy is locked (Phase 8)
