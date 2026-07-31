# Brand Guidelines

**Status:** v1.0
**Date:** 30 July 2026
**Companions:** `UI_UX_GUIDELINES.md` (the design system this sits on) · `vehicle-rental-use-cases-v1.md` (intent) · `user-flows-v1.md` (mechanics)
**Assets:** `docs/brand/src/*.svg` (source) · `docs/brand/png/*` (generated)

This document owns **identity**: the mark, the name, the lockups, and how the product sounds. It does not own colour, type scale or components — `UI_UX_GUIDELINES.md` §5 owns those, and this document deliberately adds **no new hues** (B-4).

Everything here is deliberately small. A three-vehicle business does not need a brand book; it needs an icon that survives 48px, a wordmark that fits an app bar, and a consistent way of writing about money. That is the whole scope.

---

## 1. Decisions

| ID | Decision | Why |
|---|---|---|
| **B-1** | The mark is a **monoline car in side profile**, one uniform stroke weight, rounded caps and joins | Chosen from three explored directions. It says what the product is at a glance, which matters more than abstraction for a tool used by two people who already know what it is |
| **B-2** | **Two mark variants, not one.** The full mark carries a belt line; the compact mark drops it and thickens the stroke | The belt line is what makes it read as a *car* rather than a lozenge, and it is also the first thing to mush below ~40px. Two variants is cheaper than a compromise that is wrong at both ends |
| **B-3** | **The icon is a filled tile, not a bare mark** | A 2.5 : 1 mark alone in a square leaves two empty bands and looks unfinished at every size. The tile also gives the maskable variant something to bleed |
| **B-4** | **No brand palette beyond the system palette.** Brand blue *is* `--brand` from `UI_UX_GUIDELINES.md` §5.1 | A separate marketing palette would be unvalidated, and the first place it would appear is next to a chart that was validated. One system or none |
| **B-5** | **The wordmark is set in the system sans**, `Fleet` at weight 450 and `Settle` at 750 | The weight break gives the compound name a joint without a second colour, so it survives monochrome, print and a 16px favicon. No licensed display face to buy, embed or lose |
| **B-6** | **No letters in the mark.** No monogram, no "FS" | The name is a lockup element. A letter mark plus a car mark is two identities competing at 48px |
| **B-7** | **The mark never appears in a status colour** | Green, amber and red mean specific things in this product (§5.1). A green logo on the day a message failed is a mixed signal |
| **B-8** ⚑ | The product is written **FleetSettle** — one word, two capitals, always | Not "Fleet Settle", not "Fleetsettle", not "FS". Locked here so it is consistent across the app, the WhatsApp templates, the statements and the export |

---

## 2. The mark

### 2.1 Construction

Drawn on a 200 × 91 grid, stroke 8, `stroke-linecap="round"`, `stroke-linejoin="round"`. Every corner radius comes from the join, not from an arc — so the weight can be changed in one place and the geometry stays consistent.

```
body    M 36 64 L 20 64 L 20 46 L 65 33 L 87 15 L 129 15 L 158 34 L 180 43 L 180 64 L 164 64
sill    M 68 64 L 132 64
belt    M 78 35 L 138 35
wheels  ⌀ r 11.5 at (52, 64) and (148, 64)
```

Proportions worth preserving if it is ever redrawn: body height is **29%** of body length; the cabin is **40%** of body height; front and rear overhangs are equal at 32 units; the sill line is broken at the wheels rather than passing behind them.

### 2.2 Variants

| Variant | File | Stroke | Use |
|---|---|---|---|
| **Full** | `mark.svg` | 8 | Everything at or above 40px — app bar, lockups, documents, the 512 and 192 icons |
| **Compact** | `mark-compact.svg` | 11, no belt line | Below 40px — favicon, dense table rows, anywhere the belt line closes up |

The mark uses `stroke="currentColor"`, so it takes the ink of whatever it sits in. That is how the reverse (off-white on brand) and the monochrome (ink on light) variants exist without separate files.

### 2.3 Clear space and minimum size

**Clear space** on all four sides is the height of a wheel — `r + stroke/2`, or 15.5 grid units, which is 9% of the mark's width. Nothing enters it: no text, no rule, no edge of a container.

| Context | Minimum |
|---|---|
| Full mark, on screen | 40px wide |
| Compact mark, on screen | 20px wide |
| Full mark, print | 12mm wide |
| Lockup, on screen | 120px wide — below that use the mark alone |

### 2.4 Misuse

Do not: recolour to a status colour (B-7) · add a gradient, shadow or outline · stretch or change the aspect · re-space the wheels · rotate or tilt · place on a photograph or a busy fill · add motion lines, sparkles or a speed effect · set the wordmark in another face · put the mark inside a circle other than the maskable icon's own safe zone.

---

## 3. Wordmark and lockups

| Asset | File | Use |
|---|---|---|
| **Horizontal** | `lockup-horizontal.svg` | App bar, login screen, document headers, e-mail signature |
| **Stacked** | `lockup-stacked.svg` | Splash, square placements, the login screen on a narrow phone |
| **Mark alone** | `mark.svg` | Anywhere the name is already present, and anywhere below 120px |

Wordmark specification:

```
font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
"Fleet"  font-weight 450
"Settle" font-weight 750
letter-spacing: -0.02em
colour: --ink-primary  (or --brand for a single-colour brand treatment)
```

In the React app the app-bar lockup should be **live text next to the SVG mark**, not a flattened image — it themes with the rest of the UI, scales with the user's text size, and is announced correctly by a screen reader. The flattened lockups are for documents, exports and anywhere the font cannot be guaranteed.

*On the system font:* it is a deliberate trade. The wordmark will render in SF Pro on Apple devices and Roboto on Android, so it is not pixel-identical everywhere. In exchange there is no font to license, embed, subset or pay for on first paint — and the same reasoning already governs the UI type stack (§5.2). If exact consistency is ever needed, the fix is to convert the two words to paths once and ship them as an SVG; nothing else changes.

---

## 4. Colour

The identity uses the system palette unchanged (B-4). For reference, the four values that appear in the assets:

| Role | Hex | Where |
|---|---|---|
| Brand | `#256ABF` | Mark, icon tile |
| Off-white | `#FBFBF8` | Reversed mark on the tile |
| Ink | `#14140F` | Wordmark on light |
| Ink reverse | `#F5F5F0` | Wordmark on dark |

Approved combinations, and only these:

| Ground | Mark | Wordmark |
|---|---|---|
| Light page `#F1F1EC` / surface `#FBFBF8` | Brand | Ink |
| Brand `#256ABF` | Off-white | Off-white |
| Ink `#14140F` / dark surface `#141413` | Off-white | Ink reverse |
| Any single-colour context (print, fax, forced-colors) | 100% ink | 100% ink |

---

## 5. Application assets

### 5.1 What exists

| File | Size | Purpose |
|---|---|---|
| `png/icon-512.png` | 512 | Manifest icon, `purpose: any` |
| `png/icon-192.png` | 192 | Manifest icon, `purpose: any` |
| `png/icon-maskable-512.png` | 512 | Manifest icon, `purpose: maskable` — full-bleed, mark inside the 80% safe circle |
| `png/apple-touch-icon-180.png` | 180 | iOS home screen; iOS applies its own mask, so this one is square-cornered |
| `png/favicon-32.png`, `favicon-16.png` | 32, 16 | Browser tab. Compact mark |
| `src/favicon.svg` | vector | Modern browsers prefer this over the PNGs |
| `png/contact-sheet.png` | — | The regression sheet. Re-render it after any change to the mark and look at it |

Copy into `web/public/icons/` when the frontend is scaffolded.

### 5.2 Manifest

```json
{
  "name": "FleetSettle",
  "short_name": "FleetSettle",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F1F1EC",
  "theme_color": "#256ABF",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

```html
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<meta name="theme-color" content="#256ABF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141413" media="(prefers-color-scheme: dark)">
```

`background_color` is the **page** colour, not the brand colour — Android generates its splash from it, and a brand-blue splash followed by a light-grey app is a visible flash on every cold start.

### 5.3 iOS splash screens — deliberately not generated

iOS needs an `apple-touch-startup-image` per device resolution, which is twenty-odd files that go stale with each new device. Generate them at build time with a `vite-plugin-pwa` asset generator rather than committing them, or accept the brief blank frame. Committing a hand-made matrix is the worst of the three.

### 5.4 Regenerating

No design tool is required. From `docs/brand`:

```sh
qlmanage -t -s 512 -o png src/icon-any.svg && mv png/icon-any.svg.png png/icon-512.png
```

The sources are hand-authored SVG with integer coordinates. Edit the geometry in `mark.svg`, mirror the change into the icon files, re-render `contact-sheet.svg`, and **look at it** — the sheet exists so that a change is checked at 512, 192, 96, 48, 32 and 16 in one glance, plus under a circular mask.

---

## 6. Voice

The product's job is to be believed about money. Everything below follows from that.

### 6.1 Principles

| | |
|---|---|
| **State the number** | "Sunil owes you Rs 8,000" beats "There is an outstanding balance". The number is the message |
| **Name the person** | Use the name you hold. "The driver" is what you write when you do not know who it is |
| **Second person for the user** | "What you're owed", "you paid", "your share" |
| **No congratulation** | Money arriving is not an achievement. "Received" is the whole message; there is no 🎉 in a ledger |
| **No apology for the data** | "Nothing needs you today" is a fact, not an emptiness to be sorry about |
| **Present tense, active voice** | "Confirm the day", not "The day will be confirmed" |
| **Sentence case everywhere** | Buttons, headings, labels. Title Case On Buttons Reads As Marketing |
| **No exclamation marks.** Ever | |
| **Buttons name the action and its object** | "Close July permanently", "Confirm 4 days", "Pay Sunil Rs 12,000". Never "Submit", "OK", "Continue" |
| **Errors say what to do** | "Enter the amount he handed over", not "Required field" |

### 6.2 The vocabulary lock

The reserved words in `user-flows-v1.md` §1.5 and the banned list in `UI_UX_GUIDELINES.md` §9.6 are **brand rules as much as UI rules**, because they leave the product — they appear in WhatsApp messages, statements and the driver's printed slip, and being inconsistent between the app and the message is exactly how a figure gets disputed.

Short form: say deposit, advance, earned, received, waiver, write-off, lost day, borne by, paid by — each with one meaning. Never say accrual, current account, allocation, recognition, receivable, or abbreviate "daily lease amount" and "driver day fee" to "rate", since they are opposite directions of money (UC-04).

### 6.3 Tone by surface

| Surface | Tone |
|---|---|
| Daily card, quick add | Almost silent. A label and a number |
| Warnings (U-7) | Direct, one sentence, then the action. "Insurance expired 4 days ago. Start the rental anyway?" |
| Irreversible confirms (M-10) | Say the consequence in the button and repeat it above. No cleverness |
| Statements and slips | Formal, complete, no first person. Someone else will read this in an argument |
| Outbound messages | Polite, factual, terms restated. See §7 |

### 6.4 Examples

| Instead of | Write |
|---|---|
| "Oops! Something went wrong." | "That didn't save. It's still queued and will retry." |
| "Payment successful!" | "Received Rs 30,000 from Sunil. 6 days settled." |
| "No records found." | "No trips yet." |
| "Are you sure?" | "Close July permanently? Nothing in July can change after this." |
| "Balance: -8,000" | "He owes you Rs 8,000" |
| "Submit" | "Start the rental" |

---

## 7. What is still to do

The outbound surfaces are the ones your customers actually see, and they are **not** in this document yet:

1. **The six Group I WhatsApp templates** (UC-80…UC-85), English and the second language, each as a fixed sentence with slots — Meta templates take variables, not prose. This is the item with a real lead time: approval runs from minutes to about two days *per message per language*, and W-21 only holds if the phrasing exists before the build needs it.
2. **The document headers** for the customer statement (UC-19), the driver's printed slip (UC-57) and the export (UC-99) — all three use the flattened horizontal lockup and the formal tone from §6.3.
3. **The second language** is still open (§16 of `UI_UX_GUIDELINES.md`). It changes the templates and the font subset, nothing else.

---

## 8. Change control

The mark is versioned with the repository, and the contact sheet is the test. Any change to the geometry requires re-rendering `contact-sheet.svg` and confirming the mark still reads at 48px, at 16px in its compact form, under a circular mask, and in flat single colour. A change that passes only at 512 is not a change that has been checked.
