# Tactile Ops redesign — design and implementation plan

**Written 21 August 2026, on `redesign/tactile-ops` (branched from `fix/pr93-review-findings` at "Let the local web dev server proxy /api to a hosted backend").**
**Amended 21 August 2026** after an independent review — see §5B; commits are cited by subject, not hash (§5B.8).
**Finalised 21 August 2026** after a second independent review and a third verification
pass — see §5C. Every count, hex, file path and git claim below has now been measured
three times by three sessions; where they disagreed, §5C says which number is right and
why the disagreement happened.
**Status: final — Phase 1 built 22 August 2026 (§5D). Phase 2 may start.** This document exists so a cold session — a fresh
context window, a different day, a different agent — can pick this up without re-deriving
any of it. `docs/` still decides; nothing here is a specification until it lands there
(Phase 8 of §6 below is exactly that landing). Read this document for *what, why, and
with what evidence*; there is no separate "how" companion the way GAP-12 and the
platform-admin doc split it — the phases in §6 carry both.

---

## 1. History — why this document exists

**House Style (M-34)** shipped first: a terracotta accent, a self-hosted Fraunces
display face on hero figures/screen titles, and one subtle card shadow. Committed as
"House Style: brand accent, display face, card elevation (M-34)…" on
`fix/pr93-review-findings`, bundled with unrelated bug fixes found while
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
icon chips/avatars/badges `999px` (full circle/pill). **The mockup separates `.card`
(18px) from `.stattile` (12px); the real app does not** — `Card.tsx` and `StatTile.tsx`
both render `rounded-md`, so Phase 2's `--radius-md` bump necessarily moves stat tiles
to 18px too. Recorded as a deliberate divergence (§5C.5), not an oversight: splitting
them would mean a fourth radius token for a 6px difference on one component. §6 Phase 2 deliberately does
**not** chase the row/action-row 10px value — the real app's equivalent token
(`--radius-sm`, 8px) has roughly 90 live usages across buttons/inputs/menus, not just
rows, and moving it is unscoped for what this redesign actually needs. This is a recorded,
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
| `--radius-sm` | 8px | **~90** | Buttons, inputs, menu rows, `ActionSheet`, `Toast`, `NativeSelect` — dominant, do-not-touch |
| `--radius-md` | 12px | **3** (8 occurrences, 5 of them test assertions — corrected §5B.7) | `Card.tsx`, `Dialog.tsx`, `StatTile.tsx` (button variant) — small, precise target for the card-radius bump |
| `--radius-lg` | 16px | 1 (`Sheet.tsx:77`'s `rounded-t-lg`) | Essentially unclaimed — safe to redefine |
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

**Reading the output correctly (§5C.2).** The script returns an overall **FAIL** for
every candidate in the tables below — including the three this plan ships — and that is
expected. The failures come from its `Lightness band` and `Chroma floor` checks, which
exist to stop *chart-legend swatches* reading as interchangeable grays and are
meaningless for a lone UI ink/fill token. The script's own footer says so: *"For a lone
status/text color check WCAG text contrast."* **Only three checks govern here:** `CVD
separation`, `Normal-vision floor`, and WCAG text/fill contrast computed separately. A
cold session re-running these commands to sanity-check the locked hex will see a red
banner on an approved colour — that banner is not a reason to reopen the choice.

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

### 4.2 Dark mode — ~~same structural ceiling House Style hit~~ **SUPERSEDED by §5B.2**

> **This section's conclusion was wrong and is retained only as a record of the error.**
> It searched for a *single* dark brand hex, conflating two tokens with opposite
> requirements (`--d-brand` is a fill and must be dark enough for white text on it;
> `--d-brandink` is text and must be light enough to read against `#141413`). Searching
> the ink role on its own finds hexes clearing **both** 4.5:1 text contrast **and** the
> strict ≥15 normal-vision ΔE — e.g. `#9cbaf7` at 9.46:1 / ΔE 18.1. There is no ceiling
> here. **Read §5B.2 instead; do not apply the "expected resolution" below.**

Existing adjacent dark colors: `--d-chart-1` `#3987E5`, `--d-payable` `#D95926`.
The (mistaken) reasoning was that every brand-blue candidate bright enough to read
against `#141413` converges toward `--d-chart-1`'s own hue — treated as the identical
shape of problem House Style's dark terracotta hit against `--d-payable`. Tested:

| Candidate | CVD ΔE | Normal-vision ΔE | Verdict |
|---|---|---|---|
| `#5B7FD9` | 1.9 | 3.6 | FAIL |
| `#7B8FE8` | 3.7 | 7.3 | FAIL (also outside lightness band) |
| `#4A6FE0` | 5.3 | 6.1 | FAIL |
| `#6C63D4` | 5.6 | 9.8 | FAIL |
| `#5A6FE0` | 4.4 | 6.3 | FAIL |
| **`#4E5FC9`** | **9.2** | **10.5** | Best found — clears the CVD-8 floor, not the stricter 15 solo-swatch floor |

~~**Expected resolution:** accept the best-scoring dark pair on the M-15 precedent…~~
**Withdrawn.** Invoking M-15 here would have excused a failure that has a clean fix, and
`#4E5FC9` fails the text floor outright (3.34:1 against `#141413`) — a defect that would
have reached the focus ring and 46 `text-brand-ink` usages. See **§5B.2** for the
corrected two-token approach and the validated candidates.

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
4. **Branch: a new branch, rather than continuing to commit onto
   `fix/pr93-review-findings`.** Created 21 August 2026: `redesign/tactile-ops`,
   branched *from* `fix/pr93-review-findings` at "Let the local web dev server proxy
   /api to a hosted backend" — an unrelated infra change on that branch, not part of
   this redesign.

   **~~This branch is therefore stacked, and the dependency is real.~~ SUPERSEDED by
   §5C.1 — the stack no longer exists.** This clause has now been wrong twice in
   opposite directions. The original text said "not stacked", which contradicted its own
   next clause; §5B.5 corrected it to "stacked on `fix/pr93-review-findings`, which must
   merge first". Both are now false. A rebase detached the two branches, and **PR #94
   merged `fix/pr93-review-findings` into `develop` on 21 August 2026 without House
   Style** — the two commits that matter here (M-34 and the dev-proxy change) were never
   pushed to that branch's remote. **Read §5C.1 for the real topology and Phase 9 for
   what to do about it.** The one fact that has held throughout: House Style is not on
   any shared branch, and `redesign/tactile-ops` is the only place it exists.

   *Commits are named by subject, not hash, throughout this document — the branch has
   already been rebased once, orphaning every hash both this plan and the review
   originally cited (§5B.8).*

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
- **`tokens.test.ts`'s dark-parity test is a help, not an obstacle — but it is a
  narrower help than first stated (corrected §5C.7).** It compares the
  `@media (prefers-color-scheme: dark)` block against the `[data-theme="dark"]` block
  declaration-by-declaration, so a new token added to *one* dark block and not the other
  fails the suite. It does **not** catch a token added to `@theme` and to *neither* dark
  block — that passes silently, and light-mode values then leak into dark mode. It
  guards against drift, not against omission. So for `--shadow-sheet`,
  `--shadow-btn-primary` and `--color-surface-sunken`, adding both dark declarations is
  a discipline the reviewer has to enforce; the test only keeps the two halves honest
  once one of them exists.

### 5A.2 Gap found — form controls (this is the repeat-rework risk)

**76 files** render form controls via **seven** shared primitives — `Input.tsx`,
`NativeSelect.tsx`, `Field.tsx`, `NoteField.tsx`, `MoneyField.tsx`, `EntityPicker.tsx`,
`DateField.tsx`. Every one uses the *outlined* language: `rounded-sm` +
`border border-line-strong` + `bg-surface`.

**`NoteField.tsx` was missed by the first sweep (found §5C.3).** It is the app's only
`<textarea>`, it appears on essentially every money record (UC §6.5's disputes are
settled by notes), and it carries the identical
`rounded-sm border border-line-strong bg-surface` string. Six was the wrong number.

**And the primitives are not the whole surface.** About 30 further call sites in
`features/` and `components/` hand-roll the same outlined language instead of routing
through a primitive — see §5C.3 for the full breakdown. Phase 4 must sweep those too, or
a filled input will sit beside an outlined choice chip inside the same form.

The original plan changed `Button`'s `outline` variant to filled-recessed
(`bg-surface-sunken`, transparent border) but left every input outlined. Two
consequences, both bad:

1. **Incoherent** — a filled secondary button sits directly beneath an outlined input.
2. **Repeats the exact complaint that started this document.** **17** `*Screen.tsx`
   files never render `<Card>` (corrected from 15 — §5C.4): **11 report screens**, **4
   form screens** (`MineScreen`, `StartLeaseScreen`, `StartDailyLeaseScreen`,
   `BookTripScreen`) and **2 `features/review/` screens**. With form controls untouched,
   those screens receive *only* colour and font — precisely "I only see color and font
   changes."

   *A trap worth naming, since it is easy to reproduce the miscount:*
   `ReviewVehiclesScreen.tsx` appears in a naive screen-level `grep "<Card"` sweep but is
   a false alarm — it renders `Card` indirectly through `VehiclePerformanceCard.tsx:31`
   and inherits the treatment already. `ReviewVehicleDetailScreen.tsx` is the real
   addition, and it matters twice over (see Phase 2's nested-card list).

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
aspiration. A PR that exceeds it fails."* — **it is not.** Of
`scripts/check-forbidden.mjs`'s thirteen `RULES` entries and five further check
functions, **none** checks font weight, font file size or bundle size, and no workflow in
`.github/workflows/` (`checks`, `pr`, `integration`, the three deploy/migrate files) runs
`size-limit`, `bundlesize` or any budget step. Documentation-only today; the sentence
overclaims.

*Phrased carefully on purpose (§5C.6).* An earlier draft of this paragraph said
`check-forbidden.mjs` "enforces only the `--color-*` prefix rule", which is false and
was about to be copied into `ui-ux-guidelines.md` permanently. That script is the
enforcement layer for several of CLAUDE.md's hardest rules — `numeric`/`money` SQL
columns, `serial` primary keys, destructive migration statements, `sql.raw`/interpolated
queries, `business_id` read from a request body or the `X-Business-Id` header (literally
"the whole multi-tenancy bug"), committed connection strings, secrets in `wrangler` vars,
the banned "rate(s)" and accounting vocabulary, generic button labels, and `100vh`. The
non-`--color-*` prefix rule is one line of that array. The claim that survives is
narrow: *nothing there, and nothing in CI, checks a performance budget.*

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

## 5B. Independent review response — 21 August 2026

`TACTILE-OPS-REDESIGN-REVIEW-2026-08-21.md` (written by a session that did not author
this plan) raised five conditions and six smaller observations. Every load-bearing claim
was re-verified here independently — contrast math recomputed from sRGB relative
luminance, ΔE re-run through `validate_palette.js`, code and git claims re-checked.

### 5B.1 Confirmed — all ten contrast figures reproduce exactly

`#5b6472` 5.98:1 · `#2952a3` 7.42:1 · `#0F2E63` 13.20:1 · `#1E3A6E` 11.14:1 ·
`#8a93a3` **3.10:1** · `#1b8a3f` **4.42:1** · `#eef1f6` vs page **1.02:1** · `#eef1f6`
vs white **1.13:1** · `#4E5FC9` on dark page **3.52:1** · `.acap` composited
(`#8a93a3` @60% over white → `#b9bec8`) **1.86:1**. The review's arithmetic is sound.

One figure it *understates*: `#4E5FC9` against the dark **surface** `#141413` is
**3.34:1**, worse than the 3.52:1 it cites against the page.

### 5B.2 §3.1 (dark-mode brand) — condition accepted, and the underlying problem is SOLVED

The review is right that §4.2 pre-committed to accepting `#4E5FC9` via the M-15
precedent, and right that M-15 settles hue confusion, not luminance. Verified: 
`--color-focus-ring: var(--d-brandink)` (`tokens.css:173`), and `text-brand-ink` is used
as real text in **46 places** (`AppShell`'s active tab, `Toast`'s action button,
`Disclosure`, `Badge`, plus body/caption text) — so a failing ink is a real defect, not
a theoretical one.

**But the root cause is narrower than the review diagnosed, and there is no ceiling.**
§4.2's error was searching for *one* dark brand hex, when the architecture has two
tokens with **opposite** requirements:

| Token | Role | Requirement | Therefore |
|---|---|---|---|
| `--d-brand` | fill (button backgrounds) | white text must read *on* it | must be **dark** |
| `--d-brandink` | text on dark surfaces + focus ring | must read *against* `#141413` | must be **light** |

§4.2 conflated the two, picked the hex that scored best on ΔE alone, and inherited a
contrast failure that only applies to the *ink* role. House Style itself never made this
mistake — its shipped pair is `--d-brand: #ab3f2b` (white-on-fill **6.04:1**) and
`--d-brandink: #e08260` (as text **6.61:1** on surface, **6.97:1** on page). Both pass.

Searching the ink role properly — 408 hexes clear 4.5:1 against `#141413`; feeding a
stratified sample through `validate_palette.js` against `--d-chart-1 #3987E5` and
`--d-payable #D95926`:

| Candidate | Text contrast vs `#141413` | CVD ΔE | Normal-vision ΔE | Verdict |
|---|---|---|---|---|
| **`#9cbaf7`** | **9.46:1** | 16.3 / 15.3 | **18.1** | clears *every* floor |
| **`#a7b2ec`** | **8.97:1** | 14.6 / 15.1 | **17.7** | clears every floor |
| **`#94baf0`** | **9.25:1** | 16.1 / 14.4 | **17.5** | clears every floor |
| `#4E5FC9` (§4.2's pick) | 3.34:1 | 9.2 | 10.5 | fails text floor *and* the 15 floor |

So the review's escalation — *"if no hue satisfies both, that is a design decision the
user should make explicitly"* — **does not need to be escalated**: hues satisfy both
comfortably, clearing not merely the CVD-8 floor but the strict ≥15 normal-vision floor
as well.

**Phase 1 is amended:** pick `--d-brand` (dark fill) and `--d-brandink` (light ink)
*separately*, against their own role's requirement. **Delete §4.2's "expected
resolution"** — the M-15 precedent is not needed here and invoking it would have
excused a failure that has a clean fix. §4.2's "structural ceiling" language was a false
generalisation from M-34's genuinely harder brand-vs-payable *orange* collision to a
navy palette where it does not apply.

### 5B.3 §3.2 (sunken fill) — accepted

1.02:1 from page and 1.13:1 from white confirmed. The review's sharpest point stands:
Phase 4 exists *because* form screens must stop reading as "only colour changed", and it
adopted the mockup's literal fill, which is imperceptible. Compounded by removing the
`border-line-strong` outline — the clearest "this is a field" affordance the form has.
**Phase 4 amended:** derive a sunken value with real separation (target ≥ 1.3:1 from
surface) **or** keep a hairline border on filled fields; screenshot one form screen
before propagating to all six primitives. *(Seven primitives, plus ~30 hand-rolled call
sites — corrected §5C.3.)*

### 5B.4 §3.3 (caption/meta contrast) — accepted

`#8a93a3` at 3.10:1, and `.acap`'s stacked 60% opacity at 1.86:1, both confirmed
failures for 11.5–13px text. **Phase 6 amended:** captions map to `--color-ink-muted`
(or stronger), never the mockup's literal value, and **never** with a stacked opacity.
Added to Phase 8's contrast checklist alongside `EntityAvatar`'s initials.

### 5B.5 §3.4 (branch is stacked) — accepted; §5 decision 4 was self-contradictory

Verified: House Style is **not** on `main`, and this branch contains it plus the whole
PR-93 series. §5 decision 4's "not stacked on `fix/pr93-review-findings`" contradicts its
own next clause ("branched from `fix/pr93-review-findings`"). The intent was "not
*continuing to commit onto* that branch"; as written it misdescribes the topology.
Corrected in §5, and the merge-order dependency is now stated in Phase 9.

### 5B.6 §3.5 (re-approve the real visual) — accepted

The approved frame was light-mode `#2952A3`, which fails adjacency and will be replaced
by a darker navy, a separately-chosen dark-mode pair, and a re-derived CTA glow. Folded
into Phase 1 as a gate: regenerate one mockup frame with the locked hexes and get fresh
visual confirmation **before** Phase 5+ builds on it.

### 5B.7 Where the review is itself slightly off (immaterial to its conclusions)

- ~~**`--radius-sm` is 89, not 91.**~~ Re-counted across `web/src/**/*.tsx`, with and
  without test files: 89 both ways. **Superseded by §5C.7** — a third count on the same
  branch gave 90. Three passes, three numbers; stop quoting it precisely. The conclusion
  (dominant, do-not-touch) holds at all three.
- **`Sheet.tsx`'s `rounded-t-lg` is line 77, not 76.**
- **`rounded-md` has 3 production consumers, not 8.** There are 8 *occurrences*, but 5
  are test assertions/selectors (`Card.test.tsx`, `CloseMonthScreen.test.tsx`,
  `MoreScreen.test.tsx`). Real consumers: `Card.tsx`, `Dialog.tsx`, `StatTile.tsx`.
  **This plan made the same error** in §3.3 and is corrected here — the conclusion
  (small, precise blast radius) is strengthened, not weakened.

### 5B.8 New finding neither document caught: every cited commit hash is dangling

The branch was rewritten (rebase) after both documents were written. **All six hashes
cited across the plan and the review are now orphaned** — reachable only until garbage
collection:

| Cited | Now | Subject |
|---|---|---|
| `8e0eaa0` | `3b249cc` | House Style (M-34) |
| `c8c2884` | `ca31a30` | dev-server proxy |
| `c70c2f3` | `52f7b69` | Record the plan |
| `b7b8233` | `8497653` | Revalidate the plan |
| `cad5765` | `8fce5fa` | CI-gate fix |
| `8e6296b` | `0c94a2f` | PR-93 findings |

For a document whose entire purpose is durability for a cold session, dangling refs are
a real defect. **Rule adopted: refer to commits by subject line first, hash second** —
subjects survive a rebase, hashes do not. §1 and §5 updated accordingly.

### 5B.9 Smaller observations — accepted

- **`--shadow-btn-primary` in dark mode is undefined.** A coloured glow on near-black
  reads as a halo. Phase 2 must specify a dark value *or* consciously drop the glow in
  dark mode and record which.
- **Serif→sans hierarchy loss.** Removing Fraunces collapses the hero-figure hierarchy
  on `AmountPad`/`DayCard` to weight alone. Phase 3's before/after spread must include
  the amount-entry flow specifically.
- **Cheap font guard.** A `tokens.css` assertion that `--font-sans` is set and
  `fraunces` appears nowhere would catch a partial removal. Adopted (cheap, and §5A.5
  established there is otherwise no net).
- **Single-character names.** `driver.name` is `z.string().trim().min(1).max(200)` — a
  **one-character** name is schema-valid, so "two-letter initials" needs a defined
  fallback. Phase 5 must state the rule (first two characters of the first word; one
  character if that is all there is; never empty).
- **`ReportTable` double-padding.** Confirmed three screens render `StatTile` *and*
  `ReportTable`: `CashPositionReportScreen`, `GoodwillReportScreen`,
  `VehicleMonthReportScreen`. Phase 2 must check these specifically for nested-card
  padding.

---

## 5C. Second review + final verification — 21 August 2026

Two further passes ran before this document was marked final:
`TACTILE-OPS-REDESIGN-REVIEW-2-2026-08-21.md` (review #2, written by a session that
authored neither the plan nor review #1), and a third verification pass that re-measured
both reviews against the working tree and the **remote** git state. Review #2's findings
all reproduce and are accepted. The third pass found seven more, one of them structural.

**Nothing here reopens a closed decision.** The palette direction, the scope, the
component list and §5B's dark-mode two-token fix all stand.

### 5C.1 The merge story is wrong, and it is wrong about the branch this ships to

This is the one finding that changes what someone does on day one. Measured against
`origin`, not the local refs:

| Claim in the plan | Reality |
|---|---|
| "requires `fix/pr93-review-findings` to merge first" | **It already merged** — PR #94, base `develop`, merged 21 Aug 2026 16:43 UTC |
| "…and merging carries M-34 along" | **It did not.** PR #94 merged only up to "Fix CI gate broken by the skill-pack commit". House Style and the dev-proxy commit were never pushed to that branch's remote |
| "or be rebased onto `main`" | **`main` is not the merge target.** Every feature PR in this repo goes to `develop`; PR #94's own base was `develop`, and `main` is the production-deploy branch (CLAUDE.md: "the pull request is the deploy decision") |
| "this branch is stacked on `fix/pr93-review-findings`" | **It is not, any more.** `git merge-base --is-ancestor fix/pr93-review-findings redesign/tactile-ops` → false. The rebase §5B.8 documented rewrote House Style, the dev-proxy commit and the CI-gate fix into new commits; the local `fix/pr93-review-findings` still points at the originals. §5B.8 spotted the rebase and drew only the "cite by subject" lesson — it missed that the same rebase broke the stack |

**What `origin/develop` actually contains today.** Its `web/src/design/tokens.css` has
`--l-brand: #256abf`, `--l-brandink: #1c5cab`, **no `--shadow-card`, no `--font-display`,
no Fraunces `@font-face`, no `web/public/fonts/`**. That is the pre-House-Style palette —
the same `#256abf` the mockup's own `.m-base` block calls *"pre-House-Style blue, now
historical"* (§2.3).

**Therefore the "reuse, don't rebuild" premise below is true of this branch and false of
the merge target.** `--shadow-card` does not exist on `develop`. Phase 2's *"This
redesign changes its value, not its existence"* holds only because M-34 rides on
`redesign/tactile-ops` and nowhere else. A cold session that starts from `develop`
instead of this branch will not find the token it is told to redefine.

**`git cherry origin/develop redesign/tactile-ops`** — the seven commits genuinely new
relative to the merge target, everything else being patch-equivalent to work already
merged:

1. Independent review of the Tactile Ops redesign plan
2. Apply corrected mobile UI/UX polish recommendations *(verify — may be a rebase-altered copy of work PR #92 already merged)*
3. **House Style: brand accent, display face, card elevation (M-34)…**
4. **Let the local web dev server proxy /api to a hosted backend**
5. Record the Tactile Ops redesign plan before building it
6. Revalidate the Tactile Ops plan against the real codebase
7. Validate the independent review; correct the plan's dark-mode error

**One more piece of drift:** `origin/redesign/tactile-ops` is still at the *pre-rebase*
head ("Revalidate the Tactile Ops plan against the real codebase"), two commits and a
history rewrite behind local. The next push needs `--force-with-lease`, not a plain push.

Phase 9 is rewritten accordingly.

### 5C.2 Read `validate_palette.js`'s verdict correctly (review #2 §2)

Review #2 ran the real script rather than re-deriving by hand and reproduced **every**
ΔE this plan cites, exactly: `#1E3A6E` 22.2/22.9, `#0F2E63` 27.0, `#9cbaf7` 16.3/18.1,
`#a7b2ec` 14.6/17.7, `#94baf0` 16.1/17.5, and the mockup's `#2952A3` failing at 12.3.
§4 and §5B.2's numbers are trustworthy.

But the tool returns an overall **FAIL** on all of them, from `Lightness band` and
`Chroma floor` checks that do not apply to a lone ink/fill token. Folded into §4 above so
a cold session re-running the documented command is not spooked by a red banner on an
approved colour.

### 5C.3 Phase 4's reach was overstated — a seventh primitive and ~30 inline call sites

§5A.2's *"applied at the six shared primitives so all 75 consuming files inherit it
without individual edits"* is the plan's most consequential inaccuracy after §5C.1,
because it is the phase that exists specifically to stop form screens reading as merely
recoloured.

**`NoteField.tsx` is a seventh primitive** — the app's only `<textarea>`, on essentially
every money record, carrying the same
`rounded-sm border border-line-strong bg-surface` string. It was absent from the list.

**And ~30 call sites never route through a primitive at all.** Grepping
`border-line-strong` across `features/` and `components/`:

| Pattern | Count | Examples |
|---|---|---|
| Unselected choice chip — `selected ? "border-brand bg-brand-wash…" : "border-line-strong…"` | ~14 | `StartLeaseScreen`, `StartDailyLeaseScreen`, `CloseLeaseScreen`, `CloseTripSheet`, `CancelTripSheet`, `ReadOdometerSheet`, `CorrectPaymentSheet`, `AddOpeningBalanceEntrySheet`, `AdjustObligationSheet` (×3), `OffRoadSheet`, `SettleInsuranceClaimSheet`, `CreateCustomerForm` (×2), `CreateVehicleForm` |
| Inline picker/secondary button — `min-h-tap rounded-sm border border-line-strong px-3 text-body` | ~10 | `DriverDetailScreen` (×2), `CustomerDetailScreen` (×2), `DriverActivitySections` (×2), `ReviewVehicleDetailScreen`, `VehicleMonthReportScreen`, `MembersScreen`, `CashScreen`, `PartnerDetailScreen`, `SettleAdvanceSheet`, `RecordExpenseSheet`, `FuelFillSheet`, `MarkVehicleUnavailableSheet`, `RenewVehicleDocumentSheet` |
| Photo/receipt thumbnail frame | 6 | `PhotoCapture` (×2, one `border-dashed`), `ReceiptSheet` (×4) |
| Second usage in a file the plan cites once | 1 | `EntityPicker.tsx:115` (the plan names only `:65`) |
| Correctly **not** a field | 1 | `ReportTable.tsx:70` — a table header rule; leave outlined |

Two of those unselected-chip files are `StartLeaseScreen` and `StartDailyLeaseScreen` —
**two of the four form screens §5A.2 named as the reason this phase exists.** Change the
primitives alone and those exact screens still show outlined chips beside filled inputs.

The choice-chip pattern is worth a second look on its own: fourteen copies of an ad-hoc
segmented control is a missing primitive, not a styling job. Extracting one is **out of
scope for this pass** (recorded, not done) — but Phase 4 must at minimum apply the same
filled/recessed decision to all fourteen so they stay coherent, even by find-and-replace.

### 5C.4 Two inventories were short by exactly the same two screens (review #2 §3.2)

- **Four screens render `StatTile` *and* `ReportTable`, not three.** The missing one is
  `web/src/features/review/ReviewVehicleDetailScreen.tsx` (three `StatTile`s at
  lines 110–120, a `ReportTable` at line 123) — structurally identical to the three
  already flagged, missed because the sweep looked inside `features/reports/`. It
  inherits Phase 2's `ReportTable` → `Card` wrap automatically, but nobody would think to
  screenshot it for double padding. Added to Phase 2 and Phase 8.
- **17 screens never render `<Card>`, not 15** — 11 report + 4 form + 2 `features/review/`.
  Corrected in §5A.2, along with the `VehiclePerformanceCard` indirection that makes
  `ReviewVehiclesScreen` a false positive.

### 5C.5 Phase 1 changes the ground under every contrast number already recorded

Every figure §5B recorded was measured against the **current** palette — dark ink
candidates against `--d-surface #141413`, the caption fix against `--l-ink3 #6e6c66` on
`--l-page #f1f1ec`. **Phase 1 replaces all of those.** `--l-page` `#f1f1ec` → `#EDEFF3`,
`--l-surface` `#fbfbf8` → `#FFFFFF`, the whole `--l-ink*` family → the `#151A22` family,
and `--d-*` likewise. Light mode mostly moves in the safe direction (a pure-white surface
raises contrast for every ink on it); dark mode does not necessarily.

So `#9cbaf7`'s 9.46:1 is a promising *starting* number, not a validated one. **Phase 1
now carries an explicit internal order:** lock the neutrals first → choose brand fill and
brand ink against the *new* neutrals → then re-measure ink-muted, ink-secondary, the
status inks, and the sunken fill against them. Measuring in any other order validates
values that no longer exist.

**A related unsourced decision, now surfaced.** The mockup is **light mode only** — §2.1
has no dark block. `--d-page #0d0d0c` / `--d-surface #141413` are warm near-blacks with
no Tactile Ops counterpart to copy. Phase 1 must therefore either derive cool dark
neutrals deliberately and record the derivation, or **leave the dark neutrals alone and
say so**. Silently inventing them is how a dark mode nobody looked at ships.

### 5C.6 One sentence about `check-forbidden.mjs`, on its way into the docs, was false

Review #2 caught that §5A.3's *"enforces only the `--color-*` prefix rule"* badly
mischaracterises a script that carries thirteen `RULES` entries and five further check
functions — including the `business_id`-from-request ban that CLAUDE.md calls the whole
multi-tenancy bug. The conclusion §5A.3 actually needs (no CI checks a performance
budget) is independently true and re-confirmed. Narrowed in place, because Phase 8 copies
that sentence into `ui-ux-guidelines.md` permanently.

### 5C.7 Five smaller corrections

- **`--radius-sm` is ~90, and should stop being quoted precisely.** Three passes on the
  same static grep produced 89, 91 and 90 (today's count: 90 across 51 files, identical
  with and without test files). The conclusion — dominant, do-not-touch — holds at any
  of them. §2.2 and §3.3 now say "roughly 90"; the word "89" should not be cited again.
- **§6 Phase 2 still carried the "8 consumers" error §5B.7 fixed in §3.3** (review #2
  §3.1). The correction reached the research section and not the instructions — the exact
  drift this document exists to prevent. Fixed.
- **`--font-sans` does not exist in `tokens.css` today.** It appears only inside an M-34
  comment; the app runs on Tailwind v4's default sans stack. Phase 3 is *introducing* the
  token in `@theme`, not redefining one — which also means §5B.9's proposed guard is
  asserting something that is currently false and will only pass after Phase 3 lands.
- **`tokens.test.ts` guards drift, not omission** — corrected in §5A.1.
- **§7's checklist contradicted itself.** One line still read "dark mode's structural
  ceiling confirmed and precedented"; the next line said that ceiling was disproved.
  Fixed.

### 5C.8 Two things Phase 6 does not say, and must

- **What happens to the left accent bar.** `ActionSheet` carries money direction today as
  `border-l-[3px]` — `border-l-brand` for `tone: "in"`, `border-l-direction-payable` for
  `"out"`, transparent otherwise. The mockup's `.action-row` has **no left border**; the
  tinted chip replaces it. Keeping both duplicates one signal in two places; dropping the
  bar removes an affordance that ships today. Either is defensible, neither is written
  down. **Decide and record it in Phase 6** — this is a direction-of-money signal, so it
  is not a free choice.
- **What chip a destructive action gets.** `ActionSheetAction.variant?: "destructive"`
  exists and has exactly one consumer (`VehicleOverviewScreen.tsx`); it currently recolours
  label and icon to `text-critical-ink`. The mockup defines three chip tones — `.in`,
  `.out`, `.neutral` — and no destructive one. Phase 6 must say whether destructive gets a
  critical-wash chip or keeps the ink-only treatment.

### 5C.9 The `ReportTable` Card wrap has a padding and corner trap

`Card` is `rounded-md border bg-surface p-4` with **no** `overflow-hidden`. Nesting
`ReportTable`'s `<div className="overflow-x-auto">` inside it means the horizontally
scrolling region is inset 16px on both sides, so a wide table's first and last columns
never reach the card edge, and the scrolling content paints straight over the card's
rounded corners. "Keep the existing `overflow-x: auto` behaviour intact" is necessary but
not sufficient. Phase 2 must pick one: negative-margin bleed (`-mx-4` on the scroller with
matching padding restored inside), or `overflow-hidden` on the wrapping `Card`. UI §11.3's
rule — the *table* scrolls sideways, never the page — must survive whichever is chosen.

---

## 5D. Phase 1 executed — 22 August 2026

The neutrals-first order §5C.5 mandated was followed exactly: `--l-page`/`--l-surface`
locked, `--l-brand`/`--l-brandink` chosen against them, then every dependent ink
re-measured against the *new* ground rather than the old figures §5B recorded. All
numbers below are freshly computed (sRGB relative luminance, WCAG formula), not carried
over from §4/§5B. `tokens.css`, `guard`, `lint:css`, `typecheck` and the full `web` test
suite (851 tests) all pass with these values in place; a real-browser check at 360×640 in
both themes confirms the base layer (page/ink/critical) renders correctly (§5B.6's gate —
full visual re-approval waits for Phase 2–4 to land geometry/type, since colour alone
on old radii isn't the frame worth re-approving).

**Light, locked:**

| Token | Value | Source |
|---|---|---|
| `--l-page` | `#EDEFF3` | §2.1 literal |
| `--l-surface` | `#FFFFFF` | §2.1 literal |
| `--l-ink1` | `#151A22` | §2.1 literal (`.m-b`), 17.46:1 / 15.17:1 |
| `--l-ink2` | `#5B6472` | §2.1 literal (`.biz`/`.card .top`), 5.98:1 / 5.20:1 |
| `--l-ink3` | `#646D7C` | **New, not §2.1's literal** — see below |
| `--l-faint` | `#8A93A3` | §2.1 literal (`.card .who`/`.section-head`/`.acap`), 3.10:1 |
| `--l-strong` | `#DEDFE0` | **New** — §2.1 has no line-strong equivalent |
| `--l-brand` / `--l-brandink` | `#0F2E63` | §4.1 finalist, widest CVD margin (27.0), 13.20:1 vs surface |
| `--l-wash` | `#E2E6EC` | **New** — derived, not in §2.1 |
| `--l-surface-sunken` | `#DDE1E8` | **New value**, not §2.1's literal `#eef1f6` |

**Dark, locked:**

| Token | Value | Source |
|---|---|---|
| `--d-page` | `#0B0E14` | **New — derived**, §2.1 has no dark block |
| `--d-surface` | `#12151C` | **New — derived** |
| `--d-ink1`/`2`/`3` | `#F6F7FA` / `#C2C3C7` / `#94969B` | **New — derived**, 17.05 / 10.36 / 6.16:1 |
| `--d-faint` | `#84868B` | **New — derived**, 5.01:1 |
| `--d-strong` | `#292C32` | **New — derived**, 1.30:1 |
| `--d-brand` | `#1E3A6E` | §5B.2 fill candidate, 11.14:1 white-on-fill |
| `--d-brandink` | `#9CBAF7` | §5B.2's top-scoring ink candidate, re-verified 9.38:1 vs new surface |
| `--d-wash` | `#141C2C` | **New — derived** |
| `--d-surface-sunken` | `#2A2C33` | **New — derived**, 1.31:1 vs new surface |

**Two decisions this section makes that §6 Phase 1 left open:**

1. **Dark neutrals were derived, not left unchanged.** §5C.5 offered both paths. Leaving
   `--d-page #0d0d0c`/`--d-surface #141413` (warm) under a now-cool light family would
   ship two different products depending on OS theme, and §5B.2's own dark brand/ink pair
   already assumes a cool ground. Hue-matched to `--l-ink1`'s blue-lean, same lightness
   band as the values replaced (luminance 0.0044/0.0075 vs the old 0.0040/0.0070) — every
   dark-mode "unchanged" colour (`--d-payable`, `--d-chart-*`, the four status inks) was
   re-verified against the new pair and held within 0.1:1 of its old figure, so §4.2/§5.1's
   "no need found to move it" verdict still stands under the new ground.
2. **`--l-ink3`/`--l-surface-sunken`/`--d-surface-sunken` are not §2.1's literal mockup
   values.** §2.1's `.card .who`/`.section-head` hex (`#8a93a3`) already had a home —
   it became `--l-faint`, matching the old `--l-faint`'s own sub-AA contrast band
   (3.10:1 vs the old 3.46:1). A *second*, darker value was needed for the muted-but-legible
   tier `--l-ink3` fills (captions, secondary reads) — §5B.4 requires that tier to clear
   AA, which `#8a93a3` cannot. Interpolated between `--l-ink2` and `#8a93a3`, landing at
   5.22:1/4.54:1, the same band the old warm `--l-ink3` held (5.06:1/4.63:1). The sunken
   fill is the §5B.3 case restated: the mockup's own `#eef1f6` measured 1.02:1/1.13:1
   against the *old* surface and was rejected for exactly that flatness; `#DDE1E8`/`#2A2C33`
   are fresh derivations clearing the ≥1.3:1 target against the *new* surfaces in both
   modes, not a literal carry-over that would have failed the same way twice.

**A regression found while re-verifying, not papered over: `--d-brand`'s non-text
contrast against the new dark surface is 1.64:1, worse than House Style's own 3.05:1.**
`ui-ux-guidelines.md`'s money-direction table (§5.1) uses `--color-brand` as a literal
3px `border-l` accent bar in six components (`Card.tsx`, `ActionSheet.tsx`,
`ReviewMoneyScreen.tsx`, `ReviewVehicleDetailScreen.tsx`, `VehicleMonthReportScreen.tsx`,
`VehicleYearReportScreen.tsx`), not just a button fill — a use case §5B.2's fill/ink
split didn't cover. `#1E3A6E` was chosen for the fill role (11.14:1 white-on-fill); every
navy light enough to also clear 3:1 against `#12151C` converges toward `--d-chart-1`'s own
hue (ΔE ~11 at `#4269AC`, below the 15 floor), the same collision §4.2 wrongly generalised
about the *ink* role and §5B.2 correctly disproved there — but which is genuinely real for
this *fill* role, used as a thin line against a dark card. Accepted under the same M-15
"paired with a word" basis already governing this exact token's dark-mode history — every
consumer pairs the bar with "owes you"/"owed to you" text — but flagged, not assumed:
**Phase 8's browser QA must confirm the bar is still perceptible at 3px in a real
dark-mode browser** before this is treated as settled, since it's a real degradation from
the 3.05:1 precedent that established the exception in the first place.

`ui-ux-guidelines.md` §5.1's contrast table is updated to these figures in the same pass
(§6 Phase 8 no longer needs a first-pass table rewrite, only the re-validation Phase 8's
own bullet already calls for once Phase 2–4 add geometry).

---

## 5E. Phase 2 executed — 22 August 2026

`--radius-md` 12px→18px, `--radius-lg` 16px→20px, and `--shadow-card` moved to §2.1's
literal heavier value exactly as §6 specified. Two tokens are net-new
(`--shadow-sheet` on `Sheet.tsx`, `--shadow-btn-primary` on `Button.tsx`'s `primary`
variant only) and both went in **both** dark blocks identically — `tokens.test.ts`'s
parity test still passes.

**Three decisions §6 Phase 2 left open, made here:**

1. **`--shadow-btn-primary`'s dark-mode value is tuned down, not dropped** (§5B.9's
   explicit call). Light: `rgb(15 46 99 / 45%)` (the locked `--l-brand`, not the
   mockup's rejected `#2952a3`). Dark: `rgb(30 58 110 / 35%)` — smaller blur, lower
   opacity, the locked `--d-brand`. Confirmed in a real browser (360×640, both themes):
   the light glow reads as a soft lift under the CTA; the dark one reads as a faint
   cool cast, not a halo.
2. **`ReportTable`'s padding/corner trap (§5C.9) is resolved with neither of the two
   options it offered.** Not `-mx-4` bleed-and-restore, not `overflow-hidden` alone on
   an otherwise-default `Card` — `Card`'s own `p-4` is overridden to `p-0` at this one
   call site (`cn()`'s last-class-wins already makes this safe) plus `overflow-hidden`.
   Each cell already carries its own `px-2 py-2`, so the table sits flush with the
   card's border with no bleed math needed, and `overflow-hidden` stops a
   horizontally-scrolled row from painting over the rounded corners during the scroll
   §5C.9 warned about. Simpler than either option on offer, same outcome.
3. **The nested-card check (§5B.9/§5C.4) found exactly one real case, not four.**
   `CashPositionReportScreen`, `GoodwillReportScreen` and `ReviewVehicleDetailScreen`
   render `ReportTable` as a *sibling* of `StatTile`-rendered cards, never nested inside
   one — no code change needed beyond the automatic wrap. `VehicleMonthReportScreen`'s
   shared `VehicleRow` (also reused by `VehicleYearReportScreen`) is the one genuine
   case: its expanded row is itself a `Card`, and `ReportTable` renders inside it. Fixed
   with a new `bare?: boolean` prop on `ReportTable` that skips its own `Card` wrap,
   set only at that one call site — not a general escape hatch, since every other of
   the 9 consumers wants the default.

**Re-benchmarked against the new, heavier multi-surface shadow load** (cards, buttons
and the sheet simultaneously, not House Style's single subtle layer) — same method as
M-34: a scripted `requestAnimationFrame` scroll over a 100-card list, 360×640, Chrome
DevTools' 10× CPU throttle, shadowed vs. an unshadowed control. Mean frame time 7.02 ms
shadowed vs. 6.95 ms unshadowed, p95 7.60 ms vs. 7.70 ms, 1 frame over the 16.7 ms
budget out of 299 shadowed vs. 0 unshadowed, 0 severe drops (>33 ms) in either — no
measurable cost, the same verdict M-34 reached and for the same reason (a static
`box-shadow` rasterizes once per layer rather than repainting every scroll frame).

Fixed `Card.tsx`'s stale comment in passing (§5A.6): `elevated` **replaces**
`shadow-card` with `shadow-md` rather than stacking on top of it — both set the same
CSS property, so only the later class in `cn()`'s output ever applies.

`tokens.css` passes `guard`/`lint:css`/`typecheck`/851 web tests; `ui-ux-guidelines.md`
§5.3 is updated to match.

---

## 6. Implementation plan — 9 phases

### What's already true (reuse, don't rebuild)

> **True of `redesign/tactile-ops`, not of `develop` (§5C.1).** `origin/develop` still
> carries the pre-House-Style palette — `--l-brand: #256abf`, no `--shadow-card`, no
> `--font-display`, no Fraunces. M-34 exists on this branch and nowhere else. Build from
> this branch; do not start from `develop` expecting to find the token below.

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

### Phase 1 — Palette (full replacement) — DONE, see §5D

**Do these in order (§5C.5).** Every contrast figure recorded anywhere in this document
was measured against the *current* palette, which this phase replaces. Measuring in a
different order validates values that no longer exist.

1. Lock the neutrals — `--l-page`/`--l-surface`/`--l-ink*`/`--l-strong` and their `--d-*`
   counterparts.
2. Choose `--brand` (fill) and `--brandink` (text) **against those new neutrals**, per
   role, per mode.
3. Only then re-measure everything that sits on a neutral: `--color-ink-muted`,
   `--color-ink-secondary`, the status inks, and Phase 4's sunken fill.

**The mockup is light mode only.** `--d-page #0d0d0c` / `--d-surface #141413` are warm
near-blacks with no Tactile Ops counterpart in §2.1. Either derive cool dark neutrals
deliberately and record the derivation, or **leave the dark neutrals unchanged and record
that choice.** Do not invent them silently.

`web/src/design/tokens.css`, `:root` palette block + both dark selectors:
- `--l-page`/`--l-surface`/`--l-ink1/2/3`/`--l-faint`/`--l-strong` (+ `--d-*`) move to
  Tactile Ops' cooler neutrals (`#EDEFF3` page family / `#FFFFFF` surface / `#151A22`
  ink family, per §2.1).
- `--l-brand`/`--l-brandink`/`--l-wash` (+ `--d-*`) move to the new navy — final hex
  chosen from §4.1's candidates after the full contrast battery (not just adjacency).
- **Choose the fill and the ink separately, per role (§5B.2).** `--d-brand` is a
  *fill* (white text sits on it → must be dark: `#1E3A6E`/`#233E6B`/`#0F2E63` all give
  10–13:1). `--d-brandink` is *text* and the focus ring (→ must be light enough to read
  against the dark surface: `#9cbaf7` 9.46:1 / ΔE 18.1, `#a7b2ec` 8.97:1 / ΔE 17.7,
  `#94baf0` 9.25:1 / ΔE 17.5 all clear every floor **as measured against today's
  `#141413`** — re-measure against whatever step 1 above settles on (§5C.5). Do the same
  for light mode. **Verify against both `--color-surface` and `--color-page`**, and
  remember `--color-focus-ring` aliases brand-ink, so a failing ink silently degrades the
  focus indicator app-wide.
- **Gate before Phase 5+ (§5B.6):** once the hexes are locked, regenerate one mockup
  frame with the *real* values (light and dark) and get fresh visual confirmation. What
  was approved was light-mode `#2952A3`, which is not what will ship.
- `--color-direction-payable`: **unchanged**, same reasoning as House Style — no need
  found to move it, moving it means re-touching every report/chart keyed off it.
- New `--color-surface-sunken` token (light + dark) for the button/chip recessed fill
  (§2.1's `#eef1f6` family) — distinct from `--color-page`.
- `--l-chart-*`/`--d-chart-*`: **unchanged**. §11.2's validated categorical order stays.
- Re-validate every `--color-*` row in `ui-ux-guidelines.md` §5.1 — the one place "full
  palette" costs more than House Style's accent-only change did.

### Phase 2 — Elevation and radius — DONE, see §5E
- `--shadow-card`: redefine to Tactile Ops' heavier value, both modes. Elevates cards
  *and* rows together (§3.3 finding) — no new `--shadow-row` token.
- `--radius-md` 12px → 18px — **3 production consumers** (`Card.tsx`, `Dialog.tsx`,
  `StatTile.tsx`); 8 occurrences in total, 5 of them test assertions/selectors in
  `Card.test.tsx`, `CloseMonthScreen.test.tsx`, `MoreScreen.test.tsx`, none of which
  assert a computed pixel value (§5B.7 — this line still said "8 consumers" after that
  correction landed elsewhere; §5C.7).
  **Note the divergence this forces:** the mockup keeps `.stattile` at 12px while moving
  `.card` to 18px, but the real app renders both through `--radius-md`, so stat tiles go
  to 18px too. Deliberate — a fourth radius token for a 6px difference on one component
  is not worth it (§2.2).
- `--radius-lg` 16px → 20px (1 consumer: `Sheet.tsx:77`'s `rounded-t-lg`).
- New `--shadow-sheet` token (upward-cast) on `Sheet.tsx` — currently has no shadow at
  all, this is net-new.
- New `--shadow-btn-primary` token (brand-colored glow) on `Button.tsx`'s `primary`
  variant only. **Specify the dark-mode value explicitly (§5B.9)** — a coloured glow on
  a near-black ground reads as a halo; either tune it down or consciously drop the glow
  in dark mode and record which was chosen.
- **Wrap `ReportTable`'s `<div className="overflow-x-auto">` in a `<Card>`** (decided
  21 August 2026, §5A.2's sibling question). §3.3 established that 11 report screens
  don't use `Card` and so inherit no elevation at all; this single change in
  `web/src/features/reports/ReportTable.tsx` gives every report table the new radius
  and elevation, so reports stop being the one flat outlier. Keep the existing
  `overflow-x: auto` behaviour intact — §11.3 requires the *table* to scroll
  sideways, never the page, and nesting it in a `Card` must not break that.

  **Padding and corner trap — pick one, don't discover it (§5C.9).** `Card` is
  `rounded-md border bg-surface p-4` with **no** `overflow-hidden`. Nesting the
  `overflow-x-auto` scroller inside it insets the scroll region 16px on each side, so a
  wide table's first and last columns never reach the card edge, and the scrolling
  content paints over the rounded corners. Either give the scroller a negative-margin
  bleed (`-mx-4`, padding restored inside) or put `overflow-hidden` on the wrapping
  `Card`. Record which.

  **Check these four specifically for nested-card double padding (§5B.9, §5C.4):**
  `CashPositionReportScreen`, `GoodwillReportScreen`, `VehicleMonthReportScreen`, and
  **`ReviewVehicleDetailScreen`** — the four screens rendering both `StatTile` and
  `ReportTable`. The fourth sits in `features/review/`, which is why the original sweep
  of `features/reports/` missed it.
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
- Self-host Sora as `--font-sans`. **This token does not exist in `tokens.css` today**
  (§5C.7) — it appears only inside an M-34 comment, and the app currently runs on
  Tailwind v4's default sans stack. Phase 3 *introduces* it in the `@theme` block,
  overriding that default; it is not a redefinition. One variable-weight woff2 covering 400–700,
  **`latin` subset only (~25KB)** per §5A.4's measured numbers — not `latin-ext`. Does
  **not** touch `:lang(si)`/`:lang(ta)`'s existing Noto stacks (`tokens.css` lines
  268-276).
- Remove Fraunces entirely: `@font-face`, `--font-display` token,
  `web/public/fonts/fraunces-600-latin.woff2`, and every `font-display` class usage
  (`Screen.tsx`, `StatTile.tsx`, `DayCard.tsx`, `AmountPad.tsx`, `ConfirmDayCard.tsx`).
  Delete completely, no dormant asset left — Tactile Ops has no serif anywhere.
- Highest-blast-radius change in the plan (every text element in the app). Do it last
  among token-layer changes; screenshot a representative screen spread before/after so
  a regression is traceable to "the font swap" alone. **Include the amount-entry flow
  specifically (§5B.9)** — `AmountPad`/`DayCard` hero figures lose their serif-vs-sans
  hierarchy and fall back to weight alone; confirm the hero number still dominates.
- **Add the cheap guard (§5B.9):** a `tokens.test.ts` assertion that `--font-sans` is
  set and `fraunces` appears nowhere in `tokens.css`. §5A.5 established there is
  otherwise no automated net under this change, and it would catch a partial removal.
  Note both halves are currently false — `--font-sans` is unset and Fraunces is present —
  so the guard must land **with** this phase, not before it, or it fails on arrival.

### Phase 4 — Controls: buttons *and* form fields
Per §5A.2 — this phase was "Button variants" only in the first draft; extending it to
form controls is what stops form-heavy screens from reading as merely recoloured.

`web/src/design/primitives/Button.tsx`:
- `outline`: bordered-transparent → filled `bg-surface-sunken`, `border-transparent`.
- `primary`: add `shadow-btn-primary` alongside existing `bg-brand`.
- `ghost`, `destructive`: unchanged — mockup shows no distinct treatment for either.

Form controls — the same filled/recessed language. **Two passes, not one (§5C.3).**

**Pass A — the seven shared primitives** (76 consuming files inherit these):
- `web/src/design/primitives/Input.tsx`
- `web/src/design/primitives/NativeSelect.tsx`
- `web/src/design/primitives/Field.tsx` (label/optional/error shell — check whether it
  carries its own border; it may need nothing)
- **`web/src/design/primitives/NoteField.tsx`** — the app's only `<textarea>`, present on
  essentially every money record, same `rounded-sm border border-line-strong bg-surface`
  string. **Missing from the original six-item list (§5C.3).**
- `web/src/components/MoneyField.tsx` (line 71's `rounded-sm border border-line-strong bg-surface`)
- `web/src/components/EntityPicker.tsx` — **two** usages, `:65` and `:115`, not one
- `web/src/components/DateField.tsx`
- `web/src/design/primitives/Checkbox.tsx` — note its `rounded-[4px]` arbitrary value
  (no token); decide whether it joins the language or stays as-is, and record which.

**Pass B — the ~30 call sites that never route through a primitive.** Editing only Pass A
leaves a filled input sitting beside an outlined choice chip *inside the same form*,
which is the incoherence this phase exists to remove, one level down. Two of the affected
files are `StartLeaseScreen` and `StartDailyLeaseScreen` — two of the four form screens
§5A.2 named as the reason for the phase. Sweep `grep -rn "border-line-strong" web/src`
and handle:
- **~14 unselected choice chips** — `selected ? "border-brand bg-brand-wash…" :
  "border-line-strong…"`. Fourteen hand-rolled copies of a segmented control is a missing
  primitive; **extracting one is explicitly out of scope for this pass** (recorded, not
  done), but all fourteen must take the same filled/recessed decision so they stay
  coherent.
- **~10 inline picker/secondary buttons** — `min-h-tap rounded-sm border
  border-line-strong px-3 text-body`.
- **6 photo/receipt thumbnail frames** — `PhotoCapture` (×2, one `border-dashed`),
  `ReceiptSheet` (×4). These are drop targets, not fields; decide whether they follow the
  language or keep their outline, and record it.
- **Leave `ReportTable.tsx:70` alone** — that `border-line-strong` is a table header
  rule, not a control.

Each control moves from `border border-line-strong bg-surface` to a filled/recessed treatment.
**Keep `--radius-sm` (8px) unchanged** — its ~90 usages make it the wrong lever, and
the mockup's 10px row/control radius is a 2px difference not worth that blast radius
(recorded divergence, see §2.2).

**Do not adopt the mockup's literal `#eef1f6` fill (§5B.3).** It is 1.02:1 from the page
and 1.13:1 from a white card — imperceptible, in the very phase that exists to stop form
screens reading as "only colour changed." Either derive a sunken value with real
separation (target ≥ 1.3:1 from surface) **or** keep a hairline border on filled fields.
**Screenshot one form screen and confirm the field is unmistakably a field before
propagating to all seven primitives and the Pass B call sites.**

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

**The initials rule must handle short names (§5B.9).** `driver.name` is
`z.string().trim().min(1).max(200)` — a **one-character** name is schema-valid, and
single-word names are common in Sri Lanka. State it explicitly: first letter of each of
the first two whitespace-separated words; if there is only one word, its first two
characters; if the name is a single character, that character alone. Never render an
empty chip.

### Phase 6 — `ActionSheet` icon chip + optional caption
`web/src/design/primitives/ActionSheet.tsx`:
- Wrap each action's icon in a circular **wash**-tint chip (not solid fill — keep
  distinct from `EntityAvatar`'s solid fill, matching the mockup's own
  `.aicon-chip`-vs-`.vrow .icon` distinction), colored by existing `tone` prop.
- **Decide the fate of the left accent bar (§5C.8).** Money direction is carried today by
  `border-l-[3px]` — `border-l-brand` for `tone: "in"`, `border-l-direction-payable` for
  `"out"`, transparent otherwise. The mockup's `.action-row` has **no** left border; the
  tinted chip replaces it. Keeping both puts one signal in two places; dropping the bar
  removes an affordance that ships today. This is a direction-of-money signal, so it is
  not a free choice — pick one and record the reason.
- **Define the destructive chip (§5C.8).** `variant?: "destructive"` exists, has exactly
  one consumer (`VehicleOverviewScreen.tsx`), and currently recolours label and icon to
  `text-critical-ink`. The mockup defines only `.in`, `.out` and `.neutral`. State whether
  destructive gets a critical-wash chip or keeps the ink-only treatment.
- Add optional `caption?: string` to `ActionSheetAction`. Omitted → today's single-line
  row, unchanged (backward compatible). Caption copy scoped to `QuickAddSheet.tsx`'s 5
  fixed actions only, per §3.2's table.
- **Caption colour: `--color-ink-muted` or stronger — never the mockup's `#8a93a3`
  (3.10:1) and never with a stacked opacity (§5B.4).** The mockup's `.acap` composites
  to 1.86:1, which is unreadable. Optional text is still text; it takes the 4.5:1 floor
  like any other. Add caption colour to Phase 8's contrast checklist.

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
- **Contrast checklist — every new text-bearing pair, at the 4.5:1 AA floor:**
  `EntityAvatar`'s white-on-brand initials and dark-on-sunken initials (Phase 5);
  `ActionSheet` caption colour (Phase 6, §5B.4); `--d-brandink` as text against **both**
  `--color-surface` and `--color-page`, and therefore also as `--color-focus-ring`
  (Phase 1, §5B.2); the sunken fill's separation from surface and page (Phase 4,
  §5B.3). Record the measured numbers in M-35, not just a pass/fail.
- Full `npm run check` (guard/lint/lint:css/format:check/typecheck/test).
- Real browser QA via chrome-devtools MCP — mandatory, not optional (§5A.5: no test
  covers the font swap). Cover **all four surface families**, light and dark, because
  each inherits differently and the whole point is that none is left flat:
  1. `Card`-based screens — Home, Vehicles, People, a detail screen
  2. The Add sheet (`ActionSheet` chips + captions)
  3. A **form** screen — `BookTripScreen` or `StartLeaseScreen` (Phase 4's filled
     controls; this family is what §5A.2 found untouched)
  4. A **report** screen — one with `ReportTable` and one with `StatTile`
     (Phase 2's Card wrap), **plus `ReviewVehicleDetailScreen`**, the fourth
     `StatTile`+`ReportTable` screen and the one outside `features/reports/` (§5C.4)

### Phase 9 — Git
House Style's commit ("House Style: brand accent, display face, card elevation (M-34)…")
bundled unrelated bug fixes with the visual tokens. This redesign **supersedes only the
visual token values**, via new commits on `redesign/tactile-ops` — does not revert or
touch the bug-fix parts (Dialog spacing, focus rings, ink-faint contrast, M-16
alignment), which remain correct and unrelated to style direction.

**The merge story in earlier drafts was wrong twice. This is the measured one (§5C.1).**

`fix/pr93-review-findings` **already merged** — PR #94, base `develop`, 21 August 2026
16:43 UTC — and it merged **without House Style**. Its two most relevant commits (M-34
and the dev-proxy change) were never pushed to that branch's remote, so `origin/develop`
still carries the pre-House-Style palette: `--l-brand: #256abf`, no `--shadow-card`, no
`--font-display`, no Fraunces. The rebase §5B.8 documented also detached this branch from
`fix/pr93-review-findings`, so the two are no longer a stack.

**Therefore:**

1. **The merge target is `develop`, not `main`.** Every feature PR in this repo goes to
   `develop`; PR #94's own base was `develop`; `main` is the production-deploy branch and
   merging there *is* the deploy decision (CLAUDE.md). Nothing in this redesign goes near
   `main` directly.
2. **Rebase `redesign/tactile-ops` onto `origin/develop` before opening the PR.**
   `git cherry origin/develop redesign/tactile-ops` shows only seven commits are genuinely
   new relative to the target; everything else is patch-equivalent to work already merged
   and drops out cleanly. Verify one of the seven while doing it — "Apply corrected mobile
   UI/UX polish recommendations" may be a rebase-altered copy of work PR #92 already
   merged.
3. **Do not merge the local `fix/pr93-review-findings` separately.** It still points at
   the pre-rebase commits and holds the only other copy of House Style; merging it would
   land M-34 twice, under two hashes.
4. **This PR carries House Style with it, and the description must say so.** M-34 has not
   shipped anywhere. The PR is therefore "House Style + the dev-proxy change + Tactile
   Ops", not "Tactile Ops" — three unrelated changes under one review unless they are
   separated deliberately. State which was chosen and why; do not let it pass silently,
   since bundling unrelated work under one review is the specific mistake §1 opens by
   naming.
5. **`origin/redesign/tactile-ops` is at the pre-rebase head** ("Revalidate the Tactile
   Ops plan against the real codebase"), two commits and a history rewrite behind local.
   The next push needs `--force-with-lease`, not a plain push.

**Cite commits by subject, not hash.** The branch has already been rebased once,
orphaning every hash both this plan and the first independent review originally quoted
(§5B.8). Subjects survive a rebase; hashes do not — and §5C.1 is the second finding in a
row to come from someone checking real git state rather than trusting this document's
account of it. **Re-measure the topology before acting on this section.** It has been
stale twice.

---

## 7. Status checklist

- [x] Mockup CSS extracted and preserved (§2)
- [x] Real-codebase research done, icon/ActionSheet/token inventories complete (§3)
- [x] Colour separation pre-screened; light mode solved (§4.1), and dark mode's supposed
      "structural ceiling" **disproved** — §4.2's conclusion was wrong and §5B.2 replaced
      it with a validated two-token fix. *(This line previously asserted the ceiling was
      "confirmed and precedented", contradicting the line below it — corrected §5C.7.)*
- [x] Scope decisions made (§5)
- [x] Branch created: `redesign/tactile-ops`
- [x] **Revalidation pass against the real codebase (§5A)** — two gaps found and folded
      in (form controls, §13's font budget), four assumptions verified safe
- [x] **Independent review received and validated (§5B)** — all five conditions
      accepted; §4.2's dark-mode "structural ceiling" disproved and its M-15 workaround
      withdrawn; three of the review's own figures corrected; a sixth defect neither
      document caught (dangling commit hashes) fixed
- [x] **Second independent review received and validated (§5C)** — review #2's findings
      all reproduce and are folded in; seven further findings from a third verification
      pass, including the merge-topology correction (§5C.1) and Phase 4's understated
      reach (§5C.3)
- [x] **Phase 1 — palette, executed 22 August 2026 (§5D).** Neutrals locked first, brand
      fill/ink chosen against them, every dependent ink re-measured against the new
      ground; dark neutrals derived explicitly, not left warm; `tokens.css` updated,
      `guard`/`lint:css`/`typecheck`/851 web tests pass, base layer confirmed in a real
      browser both themes at 360×640. **Visual re-approval gate for the full look still
      waits on Phase 2–4** (radius/shadow/type/controls) — colour alone on old geometry
      isn't the frame §5B.6 meant to re-approve.
- [x] **Phase 2 — elevation/radius, executed 22 August 2026 (§5E).** `--radius-md`
      12→18px, `--radius-lg` 16→20px; `--shadow-card` heavier + two net-new tokens
      (`--shadow-sheet`, `--shadow-btn-primary`, dark-mode glow tuned down not dropped);
      `ReportTable` wrapped in `Card` (`p-0` + `overflow-hidden`, not either option §5C.9
      offered); the one real nested-card case (`VehicleRow`) fixed with a `bare` prop;
      re-run perf benchmark shows no measurable cost (mean 7.02ms shadowed vs 6.95ms
      unshadowed, 100-card list, 10× throttle); `Card.tsx`'s stale comment fixed.
- [ ] Phase 3 — Sora self-hosting (latin subset), `--font-sans` introduced, Fraunces
      removal, font guard landing with the phase
- [ ] Phase 4 — controls: buttons, **seven** form primitives (Pass A), **and the ~30
      inline call sites** (Pass B, §5C.3)
- [ ] Phase 5 — `EntityAvatar` component (short-name initials rule stated)
- [ ] Phase 6 — `ActionSheet` icon chip + caption; **left accent bar and destructive chip
      both decided and recorded (§5C.8)**
- [ ] Phase 7 — Apply `EntityAvatar` at the 5 confirmed call sites
- [ ] Phase 8 — Docs (M-35, §13 budget, brand-guidelines, icon regeneration) + full
      check + browser QA across all four surface families
- [ ] Phase 9 — **rebase onto `origin/develop` first (§5C.1)**; commit scope reviewed
      (visual tokens only, bug fixes untouched); PR description states that House Style
      rides along

---

## 8. Companion files

- Plan-mode working file (external to this repo, may not persist across sessions —
  this document is the durable copy): `/Users/chamathwor/.claude/plans/steady-fluttering-lampson.md`
- House Style's own decision record: `docs/design/ui-ux-guidelines.md` M-34 entry
  (§5.1/§5.2/§5.3, and the `## 17`-style decision-log table)
- `docs/design/brand-guidelines.md` — House Style's brand-hex regeneration note, needs
  a second pass once this redesign's navy is locked (Phase 8)
- **`docs/design/ui-ux-guidelines.md` M-36/M-36a (added 21 Aug 2026) — related, separate
  scope, not part of this plan.** Reviewing this plan's own mockup surfaced that the
  real app renders `AppShell`'s business-name strip and `Screen`'s title as two stacked
  bars (M-33), where the mockup showed one merged bar. M-36 makes that merge real, on
  the 8 screens `Screen` renders with no `onBack` (checked against every route — see
  the entry for the full list and the named exclusions); M-36a adds a needs-attention
  bell to `HomeScreen`'s own `action` slot, badging §3.2's existing item list, no new
  backend. **This is structural `AppShell`/`Screen`/`HomeScreen` composition, not a
  Tactile Ops visual token** — §5A.1 above still holds ("AppShell inherits for free");
  it inherits the *palette*, not this layout change, which is independent of which
  palette is running underneath it. Sequencing is unordered between the two: M-36 can
  land on the current tokens or the Tactile Ops ones interchangeably. The Home plate in
  the finalized mockup (`https://claude.ai/code/artifact/0b3513c9-5c0e-4c8c-ac31-034a85aaaf0d`)
  reflects M-36/M-36a already, which is why it shows one bar and a bell — that detail
  belongs to this cross-referenced decision, not to anything in §6's nine phases.
