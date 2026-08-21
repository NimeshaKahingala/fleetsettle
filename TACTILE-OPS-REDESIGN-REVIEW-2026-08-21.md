# Independent review — Tactile Ops redesign plan

**Reviewed 21 August 2026.** Subject: `TACTILE-OPS-REDESIGN-2026-08-21.md`, on
`redesign/tactile-ops` (commit `b7b8233`). This review was written by a session that did
not author the plan. Every load-bearing claim I could check, I checked against the real
codebase; the numbers in §3 below are measured, not quoted from the plan.

**Verdict: approve with conditions.** This is an unusually well-grounded design plan —
the best-documented UI pass this repo has seen. Three contrast problems and one
branch-logistics contradiction should be resolved before Phases 1, 4 and 6 land.

---

## 1. What the plan gets right

- **The premise is honest.** §1 names House Style's failure precisely (a token tweak
  mistaken for a redesign) and the whole document is structured to not repeat it. §5A's
  revalidation pass — run *after* the plan was written, *before* any code — found two
  real gaps (form controls, the §13 font-budget falsehood) and changed the plan. That is
  the correct order of operations, and finding the §13 "CI gate" overclaim is a genuine
  catch: `scripts/check-forbidden.mjs` indeed enforces only the `--color-*` prefix rule.
- **Factual grounding checks out.** I spot-verified ten claims against the codebase on
  the redesign branch: `ActionSheetAction.tone?: "in" | "out"` exists
  (`ActionSheet.tsx:12`); `--shadow-card` exists in both dark blocks (`tokens.css:137,
  194, 227`); `Badge`'s `brand` variant is `bg-brand-wash text-brand-ink`;
  `Sheet.tsx:76` is the sole `rounded-t-lg` consumer; `rounded-md` has exactly 8
  consumers; the bare `Truck` at `VehicleListScreen.tsx:59` renders regardless of
  `vehicleType` (so the plan correctly calls that an existing bug, not a restyle);
  `tokens.test.ts:34` does enforce media-query/`data-theme` parity; §13's font row and
  "CI gate" sentence are quoted verbatim and accurately. The plan's evidence section is
  trustworthy.
- **Scope discipline.** Not chasing the mockup's 10px row radius (89–91 live
  `rounded-sm` usages) is the right call and is recorded as a deliberate divergence.
  Reusing `--shadow-card` for rows instead of inventing `--shadow-row` is the single
  best scope-reducer in the plan and the reasoning (all rows already render through
  `Card`) is verified correct. Keeping `--color-direction-payable` and the chart
  palette untouched avoids a pointless re-touch of every report.
- **House Style's bundling mistake is not repeated.** Phase 9 explicitly supersedes only
  M-34's visual token values and leaves its unrelated bug fixes alone, and Phase 3 lands
  the font swap separately so a regression stays attributable.
- **The rules are respected.** Captions are optional (U-2 untouched); 44px targets
  survive (M-1); new tokens follow the `--color-*` prefix so `guard` keeps passing;
  docs travel with the change in Phase 8, including recording the §13 reversal rather
  than editing silently — exactly the convention this repo runs on.

## 2. The mockup palette, measured

I ran the WCAG contrast math on the verbatim CSS in §2.1 (sRGB relative luminance):

| Pair | Ratio | Floor | Verdict |
|---|---|---|---|
| `#5b6472` secondary text on white | 5.98:1 | 4.5 | Pass |
| `#2952a3` brand on white (light mode) | 7.42:1 | 4.5 | Pass |
| `#0F2E63` / `#1E3A6E` navy finalists on white | 13.2 / 11.1:1 | 4.5 | Pass |
| **`#8a93a3` captions/meta on white** | **3.1:1** | 4.5 | **Fail** |
| **`#8a93a3` at 60% opacity (`.acap`)** | **~1.9:1** | 4.5 | **Fail, badly** |
| `#1b8a3f` delta green on white | 4.42:1 | 4.5 | Borderline fail (mockup-only) |
| **`#eef1f6` sunken fill vs `#edeff3` page** | **1.02:1** | n/a | **Invisible** |
| **`#eef1f6` sunken fill vs white surface** | **1.13:1** | n/a | **Barely visible** |
| **`#4E5FC9` dark-mode brand candidate on `#0d0d0c` dark page** | **3.52:1** | 4.5 | **Fail for text** |

## 3. Material concerns, ranked

### 3.1 Dark-mode brand: the M-15 argument is being asked to cure the wrong disease

§4.2's "expected resolution" accepts `#4E5FC9` (ΔE 9.2 vs chart-1, below the 15
solo-swatch floor) on the precedent that "brand and payable never appear without their
own word attached (M-15)". But M-15 settles **hue confusion** — two colors being
mistaken for each other. It says nothing about **luminance contrast**, and 3.52:1
against the dark page fails the 4.5:1 text floor wherever `brand-ink` is used *as text*:
the active bottom-nav tab (`text-brand-ink`, confirmed in `AppShell`), the `.bal .owe`
money figure, badge ink. `--color-focus-ring` also aliases `--d-brandink`
(`tokens.css:173`), so the same candidate becomes the focus indicator. The ΔE tables in
§4 never measure this axis. The plan does defer "the full contrast battery" to Phase 1 —
but §4.2's language pre-commits to acceptance before the test that could fail it.
**Condition: the dark brand-ink must pass 4.5:1 against dark surface/page, or
brand-as-text usages in dark mode need a separate, lighter ink token. If no hue satisfies
both 4.5:1 and ΔE ≥ 8 from chart-1, that is a design decision the user should make
explicitly, not one to absorb via precedent.**

### 3.2 The sunken-fill language has almost no tonal separation (Phase 4)

The mockup's recessed fill `#eef1f6` is 1.02:1 from the page and 1.13:1 from a white
card. Phase 4 is the phase that exists because form screens must not read as "only
colour and font changed" (§5A.2) — yet the mechanism it picks is *literally
imperceptible* at the mockup's own values. On a white card the field will read as a
1.13:1 tint; on the page background it vanishes entirely. Removing the visible
`border-line-strong` outline also removes the clearest "this is a field" signal the
form has today, and §6 Phase 4 already notes focus/invalid states must survive — with a
transparent resting border, those states end up doing *all* the work. **Condition:
before building Phase 4, pick a sunken value with real separation (roughly ≥ 1.3:1 from
white, more from page) or keep a hairline border on filled fields, and screenshot one
form screen before committing to all six primitives.** The mockup cannot settle this
because it never drew a form — the plan says so itself, then adopts the mockup's exact
fill value anyway.

### 3.3 Caption and meta colors fail WCAG at the mockup's literal values (Phase 6)

`#8a93a3` is 3.1:1 on white — already a failure for 11.5–13px text — and `.acap`
stacks `opacity: 0.6` on top, landing near 1.9:1. Phase 6 adopts captions for
QuickAddSheet's five actions, and Phase 8's WCAG checklist covers `EntityAvatar`
initials but never mentions caption color. The captions are optional (U-2 safe), but
optional text is still text. **Condition: captions and the `.who`/`.section-head`
equivalents must map to an existing compliant ink token (`--color-ink-muted` or
stronger), not the mockup's literal value; add them to Phase 8's check list
explicitly.**

### 3.4 The branch *is* stacked, despite §5 saying it isn't

§5 decision 4 reads "new branch, **not stacked** on `fix/pr93-review-findings`" — and the
very next sentence states it was branched from `fix/pr93-review-findings` at `c8c2884`.
Verified: `redesign/tactile-ops` contains `8e0eaa0` (House Style), `cad5765`, `8e6296b`
and the rest of that branch; **none of House Style / M-34 is on `main` yet**. So the
entire plan — "supersedes M-34", `--shadow-card` as the reuse mechanism, the Fraunces
pipeline as the Sora template — is built on unmerged work, and merging
`redesign/tactile-ops` first would silently ship M-34, the PR-93 fixes, and an unrelated
dev-proxy change alongside it. Phase 9's commit-scope discipline does not address merge
*ordering*. **Condition: state the dependency plainly (this branch requires
`fix/pr93-review-findings` to merge first, or be rebased onto `main` if that PR changes)
and correct the "not stacked" sentence — it currently misdescribes the branch.**

### 3.5 The approved visual will not ship — re-approve it

The mockup's literal accent `#2952A3` fails adjacency against chart-1 and will be
replaced by a materially darker navy (`#0F2E63` family), with a further different value
in dark mode, and the colored CTA glow (`rgba(41,82,163,.55)`) must be re-derived to
match — the mockup shows light mode only. Individually each change is justified;
together they mean the thing that was pointed at and approved ("Option B, that one") is
not the thing that will render. **Condition: once Phase 1 locks the final hexes,
regenerate one mockup frame with the real values and get a fresh visual confirmation
before Phase 5+ builds on top of it.** Cheap now, expensive after 75 files inherit it.

## 4. Smaller observations

- `--radius-sm` usage measured at 91 occurrences vs the plan's 89 — immaterial to the
  (correct) conclusion, noted for accuracy.
- The plan never says what `--shadow-btn-primary` becomes in **dark mode**; colored
  glows on near-black backgrounds read as halos. Include a dark value in the Phase 8
  benchmark/screenshots, or consciously drop the glow in dark mode and record it.
- Fraunces removal deletes every `font-display` usage including `AmountPad` and
  `DayCard` hero figures — with Sora at 400–700 the visual hierarchy those screens had
  from serif-vs-sans collapses to weight alone. Worth one screenshot in Phase 3's
  before/after spread specifically for the amount-entry flow.
- §5A.5 is right that no test covers the font swap; consider one cheap guard anyway —
  a `tokens.css` assertion that `--font-sans` is set and `fraunces` appears nowhere
  would have caught a partial removal. Optional, not a condition.
- The two-letter-initials rule is fine for Sri Lankan names; single-name drivers
  (common) need a defined fallback (first two letters? one letter?) — Phase 5 should
  state it.
- The `ReportTable` Card wrap (Phase 2) is a good equalizer for the 11 flat report
  screens; just confirm the wrap doesn't double-pad against screens that already put
  `StatTile`s in Cards above the table.

## 5. Summary

The plan's research is accurate, its scope discipline is real, and its honest treatment
of House Style's miss sets exactly the right tone. Nothing here is a reason to restart —
but the four conditions (dark-brand luminance, sunken-fill separation, caption contrast,
branch-ordering honesty) are all cheapest to resolve *now*, before the palette and
controls phases make them load-bearing. The fifth (visual re-approval with real hexes)
protects the user from approving one design and receiving another.
