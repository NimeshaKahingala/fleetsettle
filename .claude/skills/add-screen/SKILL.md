---
name: add-screen
description: Build or change a screen, sheet or component in the FleetSettle React client. Use for any UI work — it carries the mobile-first gate, the U-2 level rule, the token system and the component inventory that must be reused rather than reinvented.
---

# Building a screen

Read two things first: the flow's entry in `docs/product/user-flows.md`, and the screen's own spec in `docs/design/ui-ux-guidelines.md` §7. Most screens are already specified down to the wireframe — check before designing.

## The gate

**360 × 640, one thumb, no horizontal scroll.** A flow that needs a bigger screen is designed wrong. Verify at 320px too (SC 1.4.10).

## Before writing a component, check §6

The inventory is complete for phase 1. `DayCard`, `AmountPad`, `MoneyField`, `AllocationPreview`, `TwoBalances`, `FieldError`, `NotAvailable`, `Provisional`, `SyncChip`, `OfflineBanner`, `EntityPicker`, `DateField`, `PhotoCapture`, `BorneByPaidBy`, `Timeline`. **If you need something new, that is a signal to re-check the flow against U-2 first** — usually the need disappears.

## The rules that get broken

- **Level 1 only, to save.** Nothing at level 2 or 3 may be required. Level 2 lives behind `<Disclosure>`; level 3 lives in Settings. There is an automated test over every form for this.
- **44 × 44 minimum** touch targets, ≥ 8px apart, ≥ 16px when one is destructive. Never place destructive next to confirm.
- **No raw hex.** `--color-*` tokens only — the prefix is required by Tailwind v4's `@theme` namespace, not decoration.
- **Colour never alone.** Every state carries a word, a sign or an icon beside it.
- **Money amounts are `--color-ink-primary`** whichever direction they point. Direction is a marker plus a word.
- **Never render a signed net balance for a driver.** Two figures, the net muted and non-actionable, an explicit Offset action (W-2).
- **Zero and unknown look different.** `Rs 0` and `NotAvailable` are different facts (W-56).
- **Reserved vocabulary, never abbreviated.** "Daily lease amount" and "driver day fee" are opposite directions of money — neither shortens to "rate". No accounting words anywhere (U-6).
- **Sticky bottom actions need `scroll-padding-bottom`**, or a focused field hides behind them (SC 2.4.11).
- **`100svh` for the shell**, not `100vh`. The keyboard is an overlay and `dvh` does not account for it.
- **Sheets register a history entry on mobile** so the Android back button closes them.
- **One primary action per screen**, bottom-anchored, stating what it does. Never "Submit" or "OK".

## Writes

- Money writes are **optimistic + queued**, with a `SyncChip` on the record until confirmed (M-12). Never show a settled state without the chip.
- Any write that allocates across items shows `AllocationPreview` **before** it writes, oldest-first.
- Undo is a 5-second toast only for writes that sent no message and settled no obligation. Anything else is a recorded correction, not an undo.

## Before calling it done

- Renders at 360 × 640 and at 320px, both themes
- Saves with level-1 fields only
- axe-core clean
- Every interactive element ≥ 44px in a mobile-viewport pass
- Copy uses the reserved vocabulary and no banned words
