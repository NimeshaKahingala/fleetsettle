# web — the React client

Root `CLAUDE.md` applies. This file adds only what is true of every file in this directory. The procedure for building a screen is the `add-screen` skill; the screen specs themselves are `docs/design/ui-ux-guidelines.md` §7, mostly down to the wireframe.

## The gate

**360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px. A flow that needs a bigger screen is designed wrong, not a screen that needs a bigger phone.

## Before building a component, check UI §6

The inventory is complete for phase 1 — `DayCard`, `AmountPad`, `MoneyField`, `AllocationPreview`, `TwoBalances`, `NotAvailable`, `Provisional`, `SyncChip`, `OfflineBanner`, `EntityPicker`, `DateField`, `PhotoCapture`, `BorneByPaidBy`, `Timeline`. Needing something new is usually a signal that the flow has drifted past U-2; re-check it before adding to the inventory.

## What goes wrong here specifically

- **Nothing at level 2 or 3 may be required to save.** Every create form saves with level-1 fields only, and there is an automated test over every form for it.
- **Money is a `string` on the wire and `bigint` in the client.** It never becomes a `number`, not even for a chart axis.
- **Zero and unknown look different.** `Rs 0` is a fact; `NotAvailable` is the absence of one. Never `?? 0` on a figure a person will read.
- **Never a signed net balance for a driver.** Two figures, the net muted and non-actionable, an explicit Offset action (W-2).
- **Colour never carries meaning alone**, and never comes from a hex — `--color-*` tokens only. The prefix is required by Tailwind v4's `@theme`, not decoration.
- **`100svh`, never `100vh`**; `dvh` does not account for the keyboard, which is an overlay by spec.
- **Sticky bottom actions need `scroll-padding-bottom`**, or the focused field hides behind them.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive — and destructive is never adjacent to confirm.

## Vocabulary

"Daily lease amount" is what he pays you. "Driver day fee" is what you pay him. They are opposite directions of money and neither one shortens to "rate". No accounting words reach the interface at all — no "accrual", "current account", "allocation", "receivable". One primary action per screen, stating what it does; never "Submit".
