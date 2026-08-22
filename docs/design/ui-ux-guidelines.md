# UI/UX Guidelines

**Status:** v1.8 — **§5.1's colour table updated to Tactile Ops Phase 1** (`TACTILE-OPS-REDESIGN-2026-08-21.md` §5D) — full cool-neutral/navy palette replacing House Style's warm/terracotta pair, built and passing `guard`/`lint:css`/`typecheck`/tests. Not yet a numbered `M-35` decision — that lands once Phase 8 closes the whole 9-phase redesign; this bump only keeps the token table from lying about what `tokens.css` ships today. Updated 22 Aug 2026.
**v1.7** — **M-36 added: the app bar merges business name and screen title on true top-level screens, and Home gains a needs-attention bell.** M-33's two-bar chrome (business-name strip above `Screen`'s own title bar) stays exactly as specified on any screen reached with a back button; on the 8 screens that are never reached with one, the two collapse into a single two-line bar, saving the vertical space CLAUDE.md's 360×640 constraint makes scarce. The bell is `Home`'s own `Screen.action` — the one top-level screen where that slot is free — badging the same reads §3.2 already specifies, items 1/2/4–7, never item 3's hero card. No new backend: it aggregates data `HomeScreen.tsx` already fetches. Decided 21 Aug 2026.
**v1.6** — **M-34 added: House Style, the first brand-identity revision since §16 left it open.** The owner-manager found the shipped system generic — a fair read, since §5.1's brand blue and §5.2's system-only type stack were both cost trade-offs, not taste. §5.1's palette, §5.2's typography and §5.3's elevation rule all change; the reasoning and the measured numbers behind each are in M-34's own decisions-log entry rather than repeated at each section. Decided 21 Aug 2026.
**v1.5** — **M-32/M-33 added: the admin panel and the business switcher, neither a fourth shell.** §1.1 and §3.1 gain the explicit sentence the platform-admin design's own §11 flagged as necessary — M-3 (three shells, never a fourth) is not being quietly reversed; the admin panel is a platform surface reached from within whichever shell an identity already has, and the switcher changes which business a shell's numbers describe, never the shell itself. The business name moves into `AppShell`'s app bar (§6.1), separate from `Screen`'s own `title`. Mechanises `PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md` §8. Decided 18 Aug 2026.
**v1.4.1** — GAP-134: `Sheet`'s mobile back-button/gesture mechanism changed from a hand-rolled `history.pushState`/`.back()` scheme to the platform `CloseWatcher` API (§3.3, §6.1, M-27's Why column); no conclusion changes, only how it's answered. M-31: the whole-app visual refresh is now a planned, route-wide design-system pass rather than a Home-only polish item. It keeps the mobile-first contract, uses semantic colour/icon/word pairings, and folds the live QA findings on login, Home and desktop stretch into §7.11, §14 and §15. M-30 still stands for `PhotoCapture`.
**Date:** 21 August 2026
**Companions:** `use-cases.md` (intent) · `user-flows.md` (mechanics) · `data-model.md` (schema) · `tech-stack.md` (platform) · `brand-guidelines.md` (identity)

This document owns **surface**: what the user sees, touches and reads. It does not re-decide behaviour — the use-case document owns intent, the flows document owns mechanics, and every rule below is downstream of one of them. Where a rule here contradicts either, they win and this document is wrong.

It exists because the flows document ends with a screen-to-flow map (FL §7) and a single sentence that the map cannot deliver on its own: *"the source document's usability contract is about **where** things live, not just what they do."* U-1 through U-9 are a contract with no implementation. This is the implementation.

**One constraint reframes all of it.** The app is used on a phone, standing next to a bus, at a fuel pump, in the dark, one-handed, often on a mid-range Android on 4G. The desktop browser is where the passive owner reads a dashboard once a month. So: **every phase-1 flow must complete on a 360 × 640 viewport with one thumb, and desktop is a widening of that same code — never a second application.**

---

## 0. How to use this document

| If you are | Read |
|---|---|
| Building a screen | §3 navigation, §6 components, §7 the flow's own spec |
| Choosing a library | §12 the React stack |
| Writing copy | §8 money and numbers, §9.6 the vocabulary lock |
| Reviewing a PR | §2 decisions, §10 accessibility, §13 performance budget — all testable |
| Designing a report | §11 data visualisation |

**Every rule carries an ID.** `M-n` is a mobile/design decision made here; `U-n`, `W-n`, `UC-n`, `F-n` and `INV-n` are references into the companion documents and are never redefined here. If you disagree with an `M-n`, §2 is one table and reversing one entry is one pass — the same discipline the use-case document uses for `W-n`.

**Section references are prefixed, always.** Four documents number their sections from 1, and three of them have a §6 about different things. So:

| Prefix | Means | Example |
|---|---|---|
| `§n` | **This document** | §5.1 is the colour tokens |
| `UC §n` | `use-cases.md` | UC §6.8 is earned-vs-received |
| `FL §n` | `user-flows.md` | FL §1.5 is the reserved vocabulary |
| `DM §n` | `data-model.md` | DM §15 is the report queries |
| `TS §n` | `tech-stack.md` | TS §6 is money in TypeScript |

A bare `§` always means this document. This matters more than it looks: UC §6.7 (who bears a cost) and UC §6.8 (earned vs received) drive two of the most-used mobile interactions in the product, and an unprefixed `§6.7` sends the reader to §6 here, which is the component inventory.

*The rules those references point at are not restated here.* Copying UC §6.7's cost-owner table into this document would create a second copy to keep in sync, and the whole repository is built on single-sourcing with traceability instead.

---

## 1. The design premise

### 1.1 Two front doors, one set of numbers

UC §2 states the fact that decides the whole information architecture:

> **The workload is wildly asymmetric.** One person does 95% of the entry, and another consumes 95% of the reports.

A single interface serving both is tedious for the owner-manager and bewildering for the passive owner. So there are **three shells over one codebase** (M-2), differing in their home screen, their navigation and their default density — never in their numbers.

| Shell | Who | Opens it | Wants |
|---|---|---|---|
| **Operate** | Owner-manager, manager | Daily, 30 seconds | To confirm the bus and log a fill without navigating (U-1) |
| **Review** | Passive owner | Monthly, 60 seconds | One screen per vehicle: earned, spent, my share, anything odd (UC §4.5) |
| **Mine** | Linked driver | Occasionally | His two balances and his statement. Read-only, no writes anywhere (W-3, W-13) |

An owner-manager is both an owner and a manager, and gets **Operate** with the Review screens reachable as a tab — not a mode switch. Nobody chooses a shell; the role does (W-49).

**Added 18 Aug 2026 — two things sit beside the three shells without becoming a fourth one (M-32, M-33).** An identity holding membership in more than one business switches which business's numbers the current shell shows (`user-flows.md` §2.4) — the *shell* is still chosen by role, exactly as above, only now once per selected business rather than once ever. A platform admin's panel is not a business shell at all: it is reached from within whichever shell the identity already has, or stands alone when they hold none — never a fourth tab, never a mode toggle.

### 1.2 The device and the moment

Designing for the *device* is half the job. The other half is the *moment*, and the moments in this product are unusually hostile:

| Moment | What it forces |
|---|---|
| End of the day, driver standing there with cash | One tap must finish it (U-1). No keyboard, no navigation, no waiting on the network |
| At a pump, phone in one hand, nozzle in the other | Two fields maximum at level 1. Big targets. Camera for the receipt, not typing |
| Sunday morning, catching up on five days from memory | Bulk actions and past-dated entry are the normal path, not a recovery path (U-8) |
| Month end, reconciling with a partner | Density and precision matter more than delight. Tables, tabular figures, no truncation of money |
| Once a month, the owner on a laptop | The only place a wide analytical layout earns its keep |

### 1.3 The hardware and network reality

The primary users are in Sri Lanka. 4G is the practical standard, 5G is limited to parts of Colombo, and mid-range Android — the LKR 30,000–80,000 band — is the device to design against, not an iPhone Pro. ([Sri Lanka device/network context](https://blog.ikman.lk/en/mobile-phone-buying-guide-sri-lanka/), [2026 buying guide](https://lankawebsites.com/blog/mobile-gadgets/best-phone-in-sri-lanka-under-50000-2026))

That produces §13's performance budget, and it produces one design decision earlier than that: **the app must be usable while the network is not** (M-12). Not a full offline-first CRDT — the flows are single-writer and the schema already enforces idempotency (TS §4) — but reads cached and writes queued, with the queue visible.

---

## 2. Decisions log

Each is reversible on its own. Entries marked ⚑ are my judgement rather than something the companion documents already implied.

| ID | Decision | Effect |
|---|---|---|
| **M-1** | **Mobile-first is a hard gate, not a preference.** Every phase-1 flow completes on 360 × 640, one thumb, no horizontal scroll. Desktop is the same routes at wider breakpoints | A flow that "needs a bigger screen" is a flow that is designed wrong. The one exception is §14's analytical dashboard, which is *additive* — it shows more, never differently |
| **M-2** | **Three shells, one codebase** — Operate, Review, Mine — selected by role (W-49), never by a toggle | §1.1. The passive owner never sees a data-entry affordance; the driver's shell has no write path to hide in the first place |
| **M-3** | **Bottom tab bar is the only primary navigation.** No hamburger, no top-level drawer | ~75% of phone touches are the thumb and the reachable arc is the bottom two-thirds ([thumb-zone research](https://parachutedesign.ca/blog/thumb-zone-ux/), [one-handed UX](https://upslidedesignstudio.com/blogs/one-handed-mobile-ux-design-best-practices-for-better-mobile-apps)). A top-left menu is the least reachable pixel on a 6.5″ screen |
| **M-4** ⚑ | **A centre `＋` in the tab bar opens a quick-add sheet** — fuel, expense, payment received, payment made, new trip | §4.1 promises fuel is ten seconds. Ten seconds does not survive Home → Vehicle → tab → Add |
| **M-5** | **Sheets for anything under one screenful; routes for anything multi-step.** Bottom sheets, never centre modals, except for the two hard blocks | The sheet's controls land in the thumb zone; a centre modal's do not. Bottom sheets are the established fintech quick-action pattern ([fintech UX 2026](https://procreator.design/blog/best-fintech-ux-practices-for-mobile-apps/)) |
| **M-6** | **U-2's three levels are a component, not a convention.** `<Disclosure level={2}>` wraps every advanced field; level 3 lives only in Settings | The flows document already demands the test — *"nothing at level 2 or 3 is ever required to save a record… make it an automated test over every form"* (FL §7). §12.6 is that test |
| **M-7** | **Amounts are entered on an in-app keypad, not the OS keyboard.** Other numerics (litres, odometer, km) use the native keyboard with `inputmode` | UC-32 already describes it: *"keypad pre-filled 5,000"*. A custom pad gives 56px digits in the thumb zone, no keyboard-overlap bug, and can carry the expected amount, a `+/−` adjust and "make this the new daily amount" in the same surface |
| **M-8** | **Any write that moves money shows a preview before it writes** | UC §6.5 is a product rule; this makes it a component (`<AllocationPreview>`), so oldest-first allocation looks identical in F-4.5, F-4.6 and F-6.2 |
| **M-9** | **Warnings are inline strips above the primary action; only INV-1 and INV-17 are blocking dialogs** | U-7 says warn, don't block. A modal for a non-blocking warning teaches people to dismiss modals, which is exactly how the two real blocks get dismissed |
| **M-10** | **Irreversible actions get a two-step confirm with the consequence stated in the button** — "Close July permanently", not "Confirm" | UC-98 is one-way by design. A button labelled "Confirm" is a button nobody read |
| **M-11** | **Undo is a 5-second toast, and only for writes that sent no message and settled no obligation** | Anything outside that is UC-96 (void and replace) — a recorded correction, not an undo. W-50 means the ledger never silently forgets |
| **M-12** | **Reads cached, writes queued, queue visible.** A pending write shows a "not yet saved" chip on the exact record | iOS evicts PWA storage after ~7 days of disuse and offers no background sync ([iOS PWA limits](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)). So the queue is a convenience, never a store of record — the UI nags until it is empty |
| **M-13** | **"Not available" is a component with its own styling**, never a dash, never a zero, never an empty cell | W-56 is the one report rule that a UI can silently break. Making it a component makes it greppable and testable |
| **M-14** | **Two balances are never rendered as one signed number** (UC §6.4, W-2). The net is muted, secondary, and adjacent to an explicit **Offset** action | A single signed figure *is* a silent netting, whatever the storage does |
| **M-15** | **Money amounts are always ink-coloured. Direction and status are carried by a word, a sign and a marker — never by hue alone** | Red/green is non-functional for ~5% of users and identical in greyscale ([colour-blind guidance](https://www.tableau.com/blog/examining-data-viz-rules-dont-use-red-green-together)). It also matches the data-viz rule that text wears text tokens |
| **M-16** ⚑ | **Cents are stored always and displayed only when non-zero.** `Rs 5,000` and `Rs 5,000.50`, never `Rs 5,000.00` | INV-20 keeps minor units; a column of `.00` costs six characters of width on a 360px screen and communicates nothing |
| **M-17** | **Every date field defaults to today and renders one native date picker with a weekday display.** No Today/Yesterday shortcut chips | U-8 makes past-dating normal, but two shortcut buttons beside every field create duplicate date-setting affordances and become confusing once several date fields are on screen. Native date input stays the most accessible and lightest option on mobile ([native vs custom](https://blog.openreplay.com/custom-date-picker/)); a custom calendar earns its place only in the vehicle calendar (F-1.5) and range pickers |
| **M-18** ⚑ | **Photos are captured with `<input capture>`, not `getUserMedia`** | Camera permission is not reliably persisted for iOS home-screen PWAs ([known WebKit issue](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa)). The file-input path uses the OS camera app, works everywhere, and needs no permission plumbing. Compress client-side before R2 |
| **M-19** | **Body text is 16px minimum and never smaller than 12px anywhere** | Anything under 16px on an input triggers iOS auto-zoom, which breaks a fixed bottom bar and re-lays out the form mid-entry |
| **M-20** | **Dark mode is authored, not inverted**, and both modes ship from day one | Managers work at dusk and in vehicles. An inverted palette breaks the validated chart colours (§11.2) |
| **M-21** ⚑ | **No infinite scroll on any money list.** Date-grouped pages with an explicit "Show older" | A ledger is consulted to find one item and be able to find it again. Infinite scroll makes position unstable, and it fights the "which days did that 30,000 cover" question UC §6.5 exists to answer |
| **M-22** | **Capabilities hide, states disable.** A capability the role can never have (W-49) is absent; an action blocked by state is present, disabled, with the reason next to it | A disabled "Write off" teaches a manager to keep asking. An absent one is honest. The driver boundary is server-enforced regardless — the UI never *relies* on hiding (FL §2.3) |
| **M-23** ⚑ | **Swipe gestures are always a shortcut for something also reachable by tap**, and no horizontal swipe originates within **24dp of either screen edge** | Swipe-only actions are unusable with switch control and screen readers ([gesture accessibility](https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers/)), and WCAG 2.5.7 covers the dragging case. The edge exclusion is Android's: those strips are the system back gesture, so a swipe starting there is either swallowed or navigates away — and a gesture that works in the middle of a row but not at its edge reads as a broken feature rather than a boundary |
| **M-24** ⚑ | **One primary action per screen**, bottom-anchored, full-width, and it states what it does | Two equally-weighted primary buttons is how the wrong one gets tapped at the end of a long day |
| **M-26** ⚑ | **Landscape is supported, not locked.** Below `md` in landscape the app bar collapses to 44px, the tab bar becomes icon-only at 44px, and the sticky action stays | Locking orientation is the obvious answer and it is not available: **WCAG 2.1 SC 1.3.4 Orientation** forbids restricting content to one orientation unless it is essential, and a ledger is not essential in that sense. The manifest's `orientation` field is also ignored outside standalone mode and on iOS, so a lock would be a lock in name only. That leaves making landscape work: ~192px of content between the chrome is enough for the day card once the chrome gives back 24px |
| **M-25** ⚑ | **The interface has no accounting vocabulary and no abbreviations of the reserved words** (FL §1.5, U-6). "Daily lease amount" is never shortened to "rate" on a screen where "driver day fee" could also appear | The two words mean opposite directions of money. UC-04 already had to split them once |
| **M-27** ⚑ | **F-2.1 is a route (`/vehicles/:id/lease/new`), the one create flow that is not a sheet.** M-5's own rule already says why — "sheets for anything under one screenful; routes for anything multi-step" — but F-2.1 is also the first *create* flow long enough to hit that line: every other create (vehicle, driver, customer) is short enough to fit M-5's sheet half | A sheet here fails on mechanics, not taste: `Sheet` answers a hardware-back close request by closing outright (§3.3's `CloseWatcher`), so it would discard a multi-step, high-commitment write instead of stepping back one field, which only a route's own history can do; its `max-h-[90svh]` scroll region nests inside `Screen`'s own (§6.1: "the only scrolling element"); and F-10.1's `AlertStrip` warning, specified as sitting "above the primary action," would often sit below the fold of that nested scroll on exactly the screen where missing it costs money. Vehicle-scoped rather than `/leases/new` because F-2.1's own **Pre** is a vehicle precondition (INV-1) and F-1.5's Accept already names the calendar as an entry point with the date pre-filled |
| **M-28** ⚑ | **Every read has three visible outcomes: data, a real nothing, or a stated failure.** A screen that can render only "loading" and "data" is unfinished, whether or not it looks finished | Found 10 August 2026 (GAP-101): §9.5 specified the first two and was silent on the third, so nothing in the client could render a failed read as anything but an eternal spinner — or worse, a fallback (`?? []`, `?? 0`) that renders it as a confident wrong answer. W-56 already forbids the second half on reports specifically; this makes it a rule for every read, and gives it a component (`QueryState`, §6.4) rather than 32 hand-rolled branches |
| **M-29** ⚑ | **`PhotoCapture`'s upload goes through the Worker's own `R2` binding (`env.R2.put()`), never a presigned PUT the browser sends straight to the bucket** — reversing this table's own prior wording | A presigned PUT needs the S3 API and real credentials signed with `aws4fetch` (a bucket binding cannot presign) — two new secrets with no rotation story in a codebase that has never needed one, and it moves authorisation off the write entirely: the URL is a bearer capability, valid for its whole lifetime, where the binding gets the same per-request `business_id` and capability check every other write already gets. It is also structurally prone to exactly the failure this page already names as the one that matters: sign → PUT → confirm is three steps, and a confirm that never arrives — the manager who taps Save, sees a spinner, and closes the app — leaves an object in R2 with no record of it anywhere, since the row is the only index of what the bucket holds. The binding closes that window: the put and the insert happen in one Worker request, with a compensating delete if the insert fails. The one real cost is byte-level upload progress, since `fetch` gives none — accepted, because `PhotoCapture`'s own status is three states, not a percentage, and nothing here promised more than that. Reads move the same way: IG §10.10 is amended to serve them through the Worker too, re-authorised per request, rather than a presigned GET |
| **M-30** ⚑ | **`PhotoCapture`'s file input drops `capture="environment"`, keeping `accept="image/*"`** | Found 12 August 2026, investigating GAP-112 (a broken-thumbnail bug, unrelated in cause but same component family): `capture` was chosen for M-18's one stated reason — avoiding `getUserMedia`'s iOS PWA permission unreliability — but carries a second, un-discussed effect. On many mobile browsers it skips the OS picker's own choice between "Camera" and "Photo Library", jumping straight to the camera app and leaving no way to attach a photo that already exists (one taken minutes earlier, forwarded on WhatsApp, or scanned by another app). No product document requires a photo be captured live rather than picked from an existing one — W-18, W-30 and W-38's evidentiary language is about a photo outweighing a verbal claim, and about retention once a photo exists, never about how it entered the app. Dropping the attribute restores the OS's native choice; `<input type="file">` still satisfies M-18 since no `getUserMedia` call is added |
| **M-31** ⚑ | **The visual refresh is a system pass, not decoration.** Every phase-1 route gets the same hierarchy model: one focal job, semantic status/action treatment, icon + word for meaning, responsive panes at `lg`, and no new raw palette | Found by the 14 August 2026 QA/code audit prompted by the login and Home review. The live app is structurally usable, but several routes read as one flat stack: Home's work queues use quiet section labels, `Rs 0` lacks enough context, critical alerts are heavy without structure, and desktop stretches mobile rows to 1280px despite §14. The correction is not "add colour everywhere." Material 3's current theming guidance maps colour through roles and hierarchy, Apple HIG warns against reusing a colour for several meanings, and WCAG 2.2 adds mobile-relevant focus/target criteria; those all match rules this document already had. So this decision tightens usage: brand colour is for the primary action/active destination, status tokens are for status with icons and words, surfaces remain mostly neutral, and every route is reviewed against the route inventory in §7.11 before any code refresh is called done |
| **M-32** ⚑ *(added 18 Aug 2026)* | **The admin panel reuses `Screen`, `Card`, `Sheet` and the existing primitives — no parallel design system.** Every phase-1 rule applies unchanged: 360×640 no horizontal scroll (M-1), 44×44 targets, no raw hex. Rejecting a request and revoking an admin are both re-grantable, therefore reversible, therefore `Sheet` — never `Dialog` (M-5, W-67) | Decision 14/15 (`PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md`): mobile-first like everything else, and a hand-run-SQL interim was explicitly declined. A self-approved request renders **visibly distinct** from an arms-length one (W-67) — the kind of thing that cannot be added credibly after the fact, so it is specified here rather than left to whoever builds the screen |
| **M-33** ⚑ *(added 18 Aug 2026)* | **The business switcher is a `Sheet`, not a `Dialog`** — switching is neither destructive nor one-way, the same test M-5 already applies everywhere else. `MoreScreen`'s sign-out confirm is the pattern to copy. **On switch: a full `queryClient.clear()` and hard remount, never `invalidateQueries`** | No react-query key in this client contains a business id — every key is business-implicit (`["vehicles"]`, `["partner", userId]`). Without a full clear, business A's money can render under business B's name after a switch — **the highest-severity failure mode this decisions log contains**: a confident, plausible, wrong number, on the exact promise CLAUDE.md opens with. `BUSINESS_NOT_SELECTED` (`user-flows.md` §2.4) shows the switcher itself, never a bare error screen |
| **M-34** ⚑ *(added 21 Aug 2026)* | **House Style — a new brand accent, a display face on hero figures and screen titles, and a cheap shadow on every card, not only the day card.** §5.1's `--l-brand`/`--l-brandink`/`--l-wash` (and the dark trio) move from the chart-palette blue to `#9c3f2e` light / `#ab3f2b` fill + `#e08260` ink dark — `--color-direction-payable` and chart slot 2 are untouched. §5.2 adds `--font-display` (self-hosted Fraunces 600, subset to the fixed English vocabulary it actually renders — screen titles and hero money figures, never a name). §5.3's "hairlines, not shadows" default is reversed for the ordinary `Card`, via one new token, `--shadow-card` | Resolves §16's open brand-identity item — the owner-manager's own read that the shipped system was generic, not a rules violation. Every new hex ran through `dataviz`'s `validate_palette.js`, not eyeballed: light brand clears CVD ΔE 18.7 / normal-vision ΔE 18.7 against `--l-payable`, cleanly. Dark cannot clear the strict ≥15 normal-vision floor against `--d-payable` at the lightness dark mode needs — every rust bright enough to read against `#141413` converges on orange — so dark ships the best-scoring pair found (ΔE 11.2/9.2, still clearing the CVD target of 8), accepted on the same basis this document already uses for the sub-3:1 light-mode `warning`/`serious` fills: brand and payable never appear without their own word (M-15), so two colours never have to carry the distinction alone. The elevation reversal is a deliberate, recorded trade-off against §5.3's original cheap-GPU reasoning, not a quiet one — benchmarked (100-card list, 360×640, Chrome's 10× CPU throttle) against an unshadowed control: mean frame time 8.32 ms shadowed vs 8.35 ms unshadowed, p95 9.2 ms both, 1 dropped frame (>16.7 ms) out of 300 in both runs, 0 severe drops (>33 ms) in either — a static single-layer `box-shadow` costs nothing measurable to composite because it rasterizes once per card layer rather than repainting every scroll frame. This is throttled-Chrome emulation, not the physical mid-range-Android hardware the original reasoning named; it substantially de-risks the reversal but a real-device pass before the next release is still the more trustworthy confirmation |
| **M-36** ⚑ *(added 21 Aug 2026 — M-35 is reserved, not skipped: `TACTILE-OPS-REDESIGN-2026-08-21.md` §6 Phase 8 commits to landing House Style's successor as M-35 once that plan is built, and this decision was made before that phase ran)* | **The app bar merges business name and screen title into one two-line block on any screen `Screen` renders with no `onBack` — every other screen keeps M-33's two-bar layout unchanged.** Line 1 stays exactly what M-33 specified: the business name, unstyled for a single membership, or with the same `ChevronsUpDown` affordance opening the same switcher `Sheet` for more than one — only its position moves, from its own full-height strip to the top line of the merged block. Line 2 is `Screen`'s own `title`, at its existing weight. **Qualifying screens, checked against every route in the router, not assumed:** `HomeScreen`, `VehicleListScreen`, `PeopleListScreen`, `MoreScreen` (Operate's four tab roots), `ReviewVehiclesScreen` (Review's `vehicles` tab), `MineScreen` (Mine's sole screen, no tab bar to speak of), and — because their `onBack` is already role-conditional today, exactly the same signal — `ReviewThisMonthScreen`, `ReviewMoneyScreen`, `ReportsCatalogueScreen` get the merged bar for an `owner` and keep the two-bar layout for `owner_manager`/`manager`, with no new conditional to write: the rule reads the same `onBack` presence these three already compute. **Named exclusion:** `CloseLeaseScreen` drops `onBack` past wizard step 0, but that signals "mid-flow," not "this is a hub" — it keeps the two-bar layout throughout regardless of which step is showing. The admin shell has no qualifying screens at all — every one of its six, including its own hub `AdminHomeScreen`, carries `onBack` on purpose (§3.1: "an explicit back affordance to the business shell" where no tab bar exists), so M-36 does not reach it, and no exception needs writing for it. **A related latent inconsistency, surfaced by this change rather than caused by it:** `ReviewVehiclesScreen` has no `onBack` prop at all, unconditional or otherwise, unlike its three `useOperateReviewBack()` siblings above — harmless today only because `MoreScreen` never links to `/review/vehicles` directly. Fix it to use the same hook while touching this area, so a future link from Operate doesn't put a business-name line on a screen an `owner_manager` reached by drilling down. **Confirmed 22 Aug 2026:** `MineScreen` does have a `businessName` to show — `MineLayout` calls the same `useSelectedBusiness()` hook `OperateLayout` and `ReviewLayout` do and passes `businessName={selected.name}` to `AppShell` on the identical path, so a linked driver's single membership renders the name unstyled exactly as M-33 already specifies for one membership; nothing about `MineScreen` is a special case. | Merging saves real vertical space — M-33's two bars cost a strip plus a 56px header, roughly 100px of a 640px screen, entirely on chrome, on exactly the eight screens where `Screen`'s title is otherwise least informative (it already restates the active tab's own label). The rule is "no `onBack`," not a hand-maintained screen list, because that is already the exact signal this codebase uses to distinguish a hub from a drill-down (`Screen.tsx`'s own doc comment: "absent on a tab's own top-level screen") — a second, parallel list would drift from the first the way `assert_period_open()`'s array already proved a hand-maintained list does. M-33's actual requirements — shell ownership of the name, the same switcher mechanism, "nothing to tap" for one membership — are about *ownership and behaviour*, not about occupying a dedicated full-height bar, so collapsing the layout doesn't reopen that decision; it refines where its output renders. Preserving the strip on every screen that *does* have a back button keeps M-33's stated guarantee — the name reachable "whichever screen is open" — intact for the screens where collapsing it would have quietly narrowed that to "only from a tab root," which is not what M-33 decided. |
| **M-36a** ⚑ *(added 21 Aug 2026, alongside M-36)* | **`HomeScreen` gains a bell in its now-free `Screen.action` slot, badging §3.2's items 1, 2 and 4–7 — never item 3.** The count is a sum across reads `HomeScreen.tsx` already performs today: failed messages (0 until P14 ships a read endpoint — see IG's own note on that), expired/expiring paperwork, earlier unconfirmed days, rent due and overdue, expired deposit holds, and trips in progress. Item 3, today's elevated day card, is excluded on purpose — it is already the single most prominent thing on the screen; counting it in a badge would double-announce the one interaction §3.2 already built the whole layout around. Tapping the bell opens a sheet grouping the same items §3.2's own "section groups with counts" already describes, each row using whatever navigation that item's own Home rendering already performs today (a paperwork row already calls `onSelectVehicle`; where a section currently has no tap-through of its own, its bell row is count-only for this pass rather than inventing a new destination). No new read, no new endpoint — this is a second rendering of data already on the screen, valuable mainly as a during-the-day glance that doesn't require scrolling past the hero card, not a general notification centre. It is deliberately **not** wired to message-delivery status: P14 (WhatsApp messaging) is Phase 2 and was deliberately deferred whole by the owner on 17 Aug 2026 (`TRACKER.md`, Blocked) — once it ships a read endpoint, item 1 stops being permanently zero and needs no change here to start counting, which is the point of keying the badge to §3.2's list rather than to WhatsApp specifically. **Scope, stated so it isn't accidentally widened:** the bell exists only on `HomeScreen`. `VehicleListScreen` and `PeopleListScreen` already spend their one `Screen.action` slot on their own "Add" buttons (§6.1's "never more than one contextual action" is `Screen`'s rule, unchanged), and the underlying reads are Operate/Home-specific — extending the bell to `MoreScreen`, `ReviewVehiclesScreen` or `MineScreen` is a separate decision this entry does not make. | The action slot was free on exactly one qualifying screen (`Screen.action` is used today by `VehicleListScreen`'s "Add a vehicle" and `PeopleListScreen`'s "Add", both unconditional), so the placement question answers itself rather than needing a new shell-level convention invented for it. Keying the count to §3.2's already-fixed, already-argued item order (rather than re-deriving "what counts as needing attention") means this decision adds no new judgement call about priority — it reuses one already made and recorded. |

---

## 3. Information architecture and navigation

### 3.1 The tab bars

Five tabs maximum, labels always visible, 56px tall plus `env(safe-area-inset-bottom)`.

**Operate** (owner-manager, manager)

```
┌──────────────────────────────────────┐
│                                      │
│              (content)               │
│                                      │
├──────────────────────────────────────┤
│  ⌂       🚐       ＋      👥      ⋯   │
│ Home  Vehicles  Add   People   More  │
└──────────────────────────────────────┘
```

| Tab | Holds | Flows |
|---|---|---|
| **Home** | The outstanding stack, in the fixed order of §3.2 | F-4.1, F-4.2, F-4.4, F-2.2, F-2.7, F-10.1, message failures |
| **Vehicles** | List → vehicle → calendar, costs, leases, trips, paperwork, month | F-1.1, F-1.2, F-1.5, F-3.x, F-7.1 |
| **＋ Add** | Quick-add sheet (M-4) — not a destination, no route change | F-3.1, F-3.3, F-2.2, F-5.1, F-6.1 |
| **People** | Drivers and customers. A driver's page is the two-balance screen | F-1.6…F-1.8, F-6.x, F-2.8 |
| **More** | Cash, vehicle sharing, reports, period close, members, mileage packages, settings, message log, business | F-1.4, F-1.8, F-1.9, F-7.x, F-9.x, F-10.2, F-10.4 |

**The `＋` at other sizes.** On `base`–`sm` it is a full-width bottom sheet. On `md` it is the same action list in a centred sheet at 420px rather than edge-to-edge. On `lg`+ the tab bar has become a left rail (§14) and `＋` sits at its top as a labelled button, opening the identical list. One component, three placements — the actions and their order never change, because muscle memory for "fuel is the first one" is the point.

*Why cash and reports sit under More for a manager:* he opens the app to record, not to read. §4.4's monthly rhythm is ten minutes once a month; it does not deserve a permanent 20% of the thumb zone that the daily rhythm needs.

**The owner-manager is not a fourth shell.** He gets **Operate** exactly as above — the tab bar does not grow to six (M-3) and there is no mode switch. The Review screens (§7.8) live under **More → My share**, as the same components rendered read-only. He opens the app daily to record and monthly to review; the navigation reflects that ratio rather than splitting it down the middle.

**Review** (passive owner) — four tabs, no `＋`, no write affordance anywhere.

`This month · Vehicles · My money · Reports`

**Mine** (linked driver) — no tab bar. One scrolling screen with a "Statement" link. A shell with nothing to navigate to should not render navigation.

**The admin panel is not a fourth shell** (added 18 Aug 2026, mirrors the owner-manager note above). It has no tab bar of its own and grows no sixth tab (M-3) anywhere else's — reached from **More** when `isPlatformAdmin` is true, or, for an admin holding no business membership at all, standing alone as the only thing `/api/session` gives them anything to open. Same reasoning as the owner-manager: a role held by very few identities, at this business's scale, does not earn permanent navigation real estate.

**Business name lives in the app bar, not in `Screen`'s title.** `Screen`'s `title` prop names the *screen* ("Vehicles", "Close July"); the business name is shell-level chrome, owned by `AppShell` (§6) alongside the tab bar and the offline banner, and it is the same one line whichever screen is open. An identity with only one membership sees the name, unstyled as an affordance — nothing to tap, nothing to switch. An identity with more than one sees the name **with a switcher affordance**, opening the business-selection `Sheet` (M-33 below). **On a screen with no back button, that line and `Screen`'s own title now render as one merged two-line bar rather than two stacked ones — M-36 has the full rule and the exact screen list; nothing about the switcher's mechanism changes, only where its trigger sits.**

### 3.2 The home screen is an ordered stack, not a dashboard

The order is already fixed by the flows document (FL §7) and is not a design choice:

1. **Failed messages** — someone was told nothing when they should have been told something
2. **Expired or expiring paperwork** — an uninsured day is the largest unbudgeted loss available
3. **Today's day card** — the reason the app was opened (U-1)
4. **Earlier unconfirmed days**, oldest first
5. **Rent due and overdue**
6. **Deposits whose hold window has expired**
7. **Trips in progress**

> Ordering principle: *things that are silently getting worse* come before *things that are merely waiting.*

**Mobile rules on top of that order:**

- Items 1 and 2 render as **alert strips** (full-bleed, warning/critical tokens, icon + text + action). They are not cards; they must not be mistaken for work.
- Item 3 renders as the **only elevated card on the screen**, sized so its three buttons land between 55% and 90% of viewport height on a 640px screen. This is the thumb's natural arc, and it is the one interaction the whole product is optimised around.
- Items 4–7 are **section groups with counts** (`Earlier days · 5`), collapsed to three rows each with "Show all".
- **Nothing about successful messaging appears.** Success is invisible by design (UC-87).
- **Empty is a real state and it is a good one.** Show "Nothing needs you today" with the date only after the Home reads have answered with real nothing, not during the initial loading window and not as a nudge to go find work.
- **A bell in the app bar badges the count across items 1, 2 and 4–7 — never item 3** (M-36a has the mechanics: which slot, why it excludes the elevated card, why it isn't wired to message status yet). It answers with real nothing exactly like the page body does — no badge, not a badge reading zero, while any of those reads is still loading, matching the same distinction M-28 already requires everywhere else.

**When more than one vehicle has a card today.** The worked examples describe one bus, but the model allows any number of daily leases, and five stacked cards at ~200px each is a 1,000px home screen before anything else appears — which turns U-4's "the home screen holds the truth" into a wall nobody reads to the bottom of.

| Today-cards | Treatment |
|---|---|
| 1 | The elevated card, as specified |
| 2–3 | Stacked. The most-recently-used vehicle is elevated; the rest are ordinary cards |
| 4+ | Collapses to one summary row — `3 buses to confirm · 15,000` — expanding to the stack, exactly like items 4–7 |

Earlier unconfirmed days stay in their own section below (item 4) and never interleave with today's cards. "What do I owe today" and "what did I miss" are different questions and mixing them makes both harder to answer.

### 3.3 Route map

Routes are shared across shells; the shell decides which are reachable and the server decides which are permitted.

```
/                         home (shell-dependent)
/vehicles                 list
/vehicles/:id             overview · calendar · costs · history
/vehicles/:id/calendar    F-1.5
/vehicles/:id/lease/new   F-2.1 (M-27) — the one create flow that is a route, not a sheet
/leases/:id               F-2.2 → F-2.8
/trips/:id                F-5.1 → F-5.5
/incidents/:id            F-3.4 container
/people                   drivers + customers
/people/drivers/:id       two balances, days, trips, advances, deposit
/people/customers/:id     dues, payments, statement
/cash                     F-7.4, F-7.5
/partners/:id             F-7.6
/reports                  catalogue
/reports/:key             one report
/period/close             F-9.1
/settings/*               level-3 configuration only
/me                       driver shell
```

**Back must always mean back.** A sheet dismisses; a route pops. Sheets never react to the hardware back button/gesture on desktop but do answer it on mobile, via a `CloseWatcher` (GAP-134) — this is the single most-missed Android behaviour in web apps.

---

## 4. Layout system

### 4.1 Breakpoints

| Token | Min width | Design target | Layout |
|---|---|---|---|
| `base` | 320px | 360 × 640 | Single column. **All phase-1 flows must work here** |
| `sm` | 480px | large phones | Same, wider gutters |
| `md` | 768px | tablet, split phone | Two columns for lists with detail; forms stay one column |
| `lg` | 1024px | laptop | Persistent left rail replaces the tab bar; list/detail two-pane |
| `xl` | 1280px | desktop | §14's analytical layout |

Layout responds to **container** width, not viewport, wherever a component appears in more than one place (cards, tables, stat tiles). Container queries are the current baseline for exactly this ([responsive tables 2026](https://www.setproduct.com/blog/data-table-ui-design)).

### 4.2 The screen frame

```
┌─────────────────────────────┐  ← env(safe-area-inset-top)
│ App bar (56px)              │     title + one contextual action
├─────────────────────────────┤
│                             │
│ Scroll region               │  ← the only scrolling element
│   gutter 16px               │
│   scroll-padding-bottom     │     = CTA height + tab bar + inset
│                             │
├─────────────────────────────┤
│ Sticky primary action (M-24)│  56px, full width minus gutters
├─────────────────────────────┤
│ Tab bar (56px)              │
└─────────────────────────────┘  ← env(safe-area-inset-bottom)
```

**Rules that follow from that frame:**

- Height uses `100svh` for the shell, never `100vh`. `dvh` is reserved for elements that should genuinely resize as browser chrome moves, because it triggers reflow ([viewport units](https://blog.openreplay.com/fix-100vh-mobile-viewport/)).
- The keyboard is an overlay and **`dvh` does not account for it by specification**. Sticky bottom actions use `bottom: env(keyboard-inset-height, 0px)` where supported, with a `visualViewport` resize listener as the fallback ([virtual keyboard handling](https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/)).
- `scroll-padding-bottom` on the scroll region is **mandatory**, not polish: without it a focused field at the bottom of a form sits behind the sticky CTA, which fails WCAG 2.4.11 Focus Not Obscured.
- Safe-area insets are applied on all four sides. Landscape on a notched phone puts the inset on the left or right.

### 4.3 Touch targets and spacing

| Rule | Value | Source |
|---|---|---|
| Minimum interactive target | **44 × 44 CSS px** | Exceeds WCAG 2.5.8's 24px AA floor and meets 2.5.5 AAA ([SC 2.5.8](https://www.wcag.com/developers/2-5-8-target-size-minimum-level-aa/)) |
| Primary actions | **56px tall**, full width | Thumb arc, gloves, motion |
| List rows | 56px minimum; 64px when they carry a secondary line | |
| Gap between adjacent targets | **≥ 8px**, and ≥ 16px when one is destructive | Mis-tap cost is money here |
| Icon-only buttons | 44 × 44 hit area even at a 20px glyph | Pad, don't grow the icon |
| Destructive next to confirm | **Never adjacent.** Separate row, or a sheet | |

### 4.4 Density

Two densities, chosen by context rather than by a user setting:

- **Comfortable** (default, all of Operate and Mine): 16px gutters, 56px rows, generous vertical rhythm.
- **Compact** (report tables, the desktop dashboard, statements): 12px gutters, 40px rows, tabular figures. Never used for anything with a tap target that writes.

---

## 5. Design tokens

All tokens are CSS custom properties consumed through Tailwind v4's `@theme`. Nothing in the app uses a raw hex.

### 5.1 Colour

**Tactile Ops (Phase 1 built 22 Aug 2026, `TACTILE-OPS-REDESIGN-2026-08-21.md` §5D) is replacing this palette in flight.** The table below is what `tokens.css` ships *today* — cool neutrals and a navy brand, not House Style's warm/terracotta pair, which this same phase retired. The redesign is 9 phases; only Phase 1 (palette) has landed, so the values are final but the *look* (radius, elevation, type) is not — a formal `M-35` decision-log entry lands once Phase 8 closes the whole thing out, superseding M-34 the way M-34 superseded the chart-palette blue before it. Cite the plan doc, not M-34, for anything below.

**Surfaces and ink** — cool neutrals (Tactile Ops); House Style's warm family (`#F1F1EC`/`#FBFBF8`/`#14140F`…) is retired.

**Every colour token is named `--color-*`, and that prefix is not a style choice.** Tailwind v4's `@theme` is namespaced: only a variable in the `--color-*` namespace generates colour utilities, so `--color-ink-primary` yields `text-ink-primary` / `bg-ink-primary` / `border-ink-primary`, while a token named `--color-ink-primary` generates nothing and fails silently. The tokens below are therefore written exactly as they appear in §12.3 — one name, one place, no translation step.

| Token | Utility | Light | Dark | Contrast (light / dark) |
|---|---|---|---|---|
| `--color-page` | `bg-page` | `#EDEFF3` | `#0B0E14` | — |
| `--color-surface` (cards, sheets, charts) | `bg-surface` | `#FFFFFF` | `#12151C` | — |
| `--color-ink-primary` | `text-ink-primary` | `#151A22` | `#F6F7FA` | 17.5 / 17.1 |
| `--color-ink-secondary` | `text-ink-secondary` | `#5B6472` | `#C2C3C7` | 5.98 / 10.4 |
| `--color-ink-muted` (supporting text) | `text-ink-muted` | `#646D7C` | `#94969B` | 5.22 / 6.16 |
| `--color-ink-faint` (axis, hairlines — **non-text only**) | `text-ink-faint` | `#8A93A3` | `#84868B` | **3.10 / 5.01** |
| `--color-line-hairline` | `border-line-hairline` | `rgba(21,26,34,0.10)` | `rgba(255,255,255,0.10)` | — |
| `--color-line-strong` (baselines, header dividers) | `border-line-strong` | `#DEDFE0` | `#292C32` | — |
| `--color-surface-sunken` (recessed fill, filled form controls — §6 Phase 4) | `bg-surface-sunken` | `#DDE1E8` | `#2A2C33` | 1.31 / 1.31 vs surface |

**Brand and interactive** (Tactile Ops Phase 1, 22 Aug 2026 — supersedes M-34's terracotta pair)

| Token | Light | Dark | Note |
|---|---|---|---|
| `--color-brand` (filled buttons) | `#0F2E63` | `#1E3A6E` | White on light brand = 13.20:1; white on dark brand = 11.14:1 |
| `--color-brand-ink` (links, brand-coloured text) | `#0F2E63` | `#9CBAF7` | Light mode: one hex serves fill and ink both, same as House Style's own pattern. Dark ink is a separate, much lighter hex from the fill (§5B.2 — the two tokens have opposite requirements) — 9.38:1 against the dark surface |
| `--color-brand-wash` (selected rows, chips) | `#E2E6EC` | `#141C2C` | Brand-ink text on wash: 10.53:1 light / 8.71:1 dark |
| `--color-focus-ring` | `#0F2E63` | `#9CBAF7` | 3px, 2px offset, never removed |

Light mode: `#0F2E63` was the widest-margin survivor of a four-candidate battery run against the new neutrals (CVD/normal-vision ΔE 27.0 vs `--color-chart-1`/`--color-direction-payable`, the next-best candidate at 22–23). Dark mode uses `dataviz`'s `validate_palette.js` on the *ink* role alone, corrected from an earlier single-hex search that conflated fill and ink requirements (`TACTILE-OPS-REDESIGN-2026-08-21.md` §5B.2): `#9CBAF7` clears the strict ≥15 normal-vision floor outright (ΔE 18.1) rather than needing the M-15 "always paired with a word" exception House Style's dark rust pair required.

**Status** — fixed, never themed, never reused as a series colour.

| Token | Fill (light / dark) | Text (light / dark) | Used for |
|---|---|---|---|
| `--color-good` | `#0CA30C` / `#3FBF57` | `#006300` (7.3) / `#3FBF57` (7.7) | Settled, paid in full, synced |
| `--color-warning` | `#FAB219` / `#FAB219` | `#7A4A00` (7.2) / `#FAB219` (10.1) | Expiring paperwork, unsent queue, provisional figures |
| `--color-serious` | `#EC835A` / `#EC835A` | `#8A3B12` / `#EC835A` | Overdue, arrears, lost days on the calendar |
| `--color-critical` | `#D03B3B` / `#F0736F` | `#B3231F` (6.4) / `#F0736F` (6.5) | Failed message, expired insurance, field errors, blocked action |

Status colours **always ship with an icon and a word** — the light-mode warning and serious fills are deliberately sub-3:1 and the pairing is what makes them legal, on top of M-15.

**Money direction** is *identity*, not polarity (UC §6.4, W-2), so it is not a status colour and it is not a raw hex:

| Token | Light | Dark | Contrast (light / dark, vs `--color-surface`) | Meaning |
|---|---|---|---|---|
| `--color-brand` | `#0F2E63` | `#1E3A6E` | 13.20 / **1.64** ⚑ | **He owes you** — 3px leading rule + the words "owes you" |
| `--color-direction-payable` | `#EB6834` | `#D95926` | 3.20 / 4.70 | **You owe him** — 3px leading rule + the words "you owe" |
| `--color-ink-faint` hatched | `#8A93A3` | `#84868B` | 3.10 / 5.01 | **Held, not yours** (deposits, advances) + the word "held" |

The amount itself is always `--color-ink-primary`, whichever direction it points (M-15). `--color-direction-payable` is deliberately the same hex as chart slot 2 in both modes (§11.2), so the marker beside a driver's balance and the series in a chart about that driver are the same orange rather than two oranges.

⚑ **`--color-brand`'s dark-mode accent bar is below the 3:1 non-text floor, and worse than House Style's own 3.05:1 it replaces.** Found while re-verifying Tactile Ops' Phase 1 palette (22 Aug 2026) — `#1E3A6E` was chosen for its *fill* role (white-on-fill 11.14:1, §5B.2), and every navy light enough to also clear 3:1 against the new dark surface (`#12151C`) converges toward `--color-chart-1`'s own hue (ΔE drops to ~11, below the 15 floor `#4269AC` and lighter candidates were tested at) — the same structural collision §4.2 wrongly generalised from and §5B.2 correctly scoped to the *ink* role only. For the *fill* role used as a thin non-text accent bar, the collision is real: no hex serves "dark enough for white text" and "light enough to read as a line against a dark card" at once. Accepted under the same M-15 "always paired with a word" basis House Style's own dark pair already used at 3.05:1 — every consumer (`Card.tsx`, `ActionSheet.tsx`, `ReviewMoneyScreen.tsx`, `ReviewVehicleDetailScreen.tsx`, `VehicleMonthReportScreen.tsx`, `VehicleYearReportScreen.tsx`) pairs the bar with "owes you"/"owed to you" text, so the direction is never conveyed by colour alone even at 1.64:1. **Flagged for Phase 8's browser QA pass**, not silently shipped: confirm in a real dark-mode browser that the bar is still perceptible at 3px next to its paired text before treating this as settled, since 1.64:1 is materially worse than the 3.05:1 precedent that established the exception.

### 5.2 Typography

```
--font-sans: "Sora", ui-sans-serif, system-ui, sans-serif;
--font-sinhala: "Noto Sans Sinhala", var(--font-sans);
```

**Tactile Ops Phase 3 (22 Aug 2026, `TACTILE-OPS-REDESIGN-2026-08-21.md` §5F) replaces House Style's display serif with self-hosted Sora — as `--font-sans`, app-wide, not scoped to a handful of hero elements the way the serif was.** `--font-sans` did not exist in `tokens.css` before this phase; the app ran on Tailwind v4's own default sans stack. Setting it here overrides that default *and* becomes the whole app's body font in one declaration, because Tailwind v4's `preflight.css` reads its own `--default-font-family` from `--font-sans`. One self-hosted variable-weight `woff2` covers the full 400–700 range, `latin` subset only (25,284 bytes measured, §5A.4) — Sri Lankan romanized names and vehicle plates are ASCII, and `latin-ext` adds ~48% weight for glyphs this app is unlikely to render. There is no display face any more: every element that used to carry the serif (`Screen`'s title, `StatTile`'s hero value, `AmountPad`/`DayCard`/`ConfirmDayCard`'s hero figures) now carries `font-semibold` instead — Sora is a true variable font, so an explicit weight utility reproduces the same 600-weight hierarchy the serif's single-static-weight file used to provide as a side effect, rather than losing it to "weight alone" at the browser default.

Noto Sans Sinhala is *specified* as self-hosted, subset, and `font-display: swap` — this was never actually implemented (`tokens.css` carries neither the token nor an `@font-face`; the Sinhala UI silently falls back to `--font-sans` today, unaffected by the Phase 3 swap since `:lang(si)`/`:lang(ta)` are untouched). Left as a known gap rather than fixed in passing, since real subsetting needs the Sinhala glyph set sourced, which is separate work. South-Asian scripts need extra line height for their glyph extents ([Material language support](https://m2.material.io/design/typography/language-support.html)) — hence the `si` row below.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `hero` | 36 / 40 (desktop 48 / 52) | 600, `font-semibold` (Tactile Ops Phase 3) | The one number a screen leads with |
| `title-lg` | 22 / 28 | 600, `font-semibold` (Tactile Ops Phase 3) | Screen titles |
| `title` | 18 / 24 | 600 | Card headings, amounts in list rows |
| `body` | **16 / 24** | 400 | Everything. Minimum for inputs (M-19) |
| `body-sm` | 14 / 20 | 400 | Secondary lines in rows |
| `label` | 13 / 16 | 500 | Field labels, table headers |
| `caption` | 12 / 16 | 400 | Timestamps, provenance, "estimated" markers |
| `:lang(si)` | line-height × 1.15 | | Applied to every token above |
| `:lang(ta)` | line-height × 1.15 | | Same rule, same reason — Tamil's glyph extents need the same headroom Sinhala does |

**Truncation.** Names truncate to one line with an ellipsis; **amounts never truncate** (§8.2). Where a name and an amount share a row, the amount is laid out first and the name takes what is left — a registration is recognisable from its first characters, a rupee figure is not. `White Toyota HiAce 2019` and `Rs 1,240,000` do not both fit in 328px, and it is always the name that gives way.

**Figures.** `font-variant-numeric: tabular-nums` on every column that aligns vertically — list amounts, tables, axis ticks, statements. Proportional figures for the hero number only.

### 5.3 Space, radius, elevation, motion

```
space:   4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64
radius:  sm 8 (controls) · md 18 (cards) · lg 20 (sheets) · full (chips, avatars)
```

**Tactile Ops Phase 2 (22 Aug 2026, `TACTILE-OPS-REDESIGN-2026-08-21.md` §5E) moves `--radius-md` 12→18px and `--radius-lg` 16→20px, and replaces `--shadow-card` with a heavier single layer.** `--radius-md`'s bump reaches `StatTile` too, not just `Card`/`Dialog` — the real app renders both through the one token, and the mockup's own 12px-vs-18px split between `.stattile` and `.card` was judged not worth a fourth radius token for a 6px difference. Cards are still `--color-surface` on `--color-page` with a 1px `--color-line-hairline`, now plus the heavier `--shadow-card`, tuned separately per mode (light: `rgb(21 26 34 / 28%)`, ink-tinted, matching §2.1's mockup literally; dark: pure black at 55% — a black shadow reads as a smudge on `#12151C` at the light value's opacity, the same reasoning M-34 established). Two further tokens are net-new: `--shadow-sheet` (upward-cast, `Sheet.tsx` had no shadow at all before this) and `--shadow-btn-primary` (a brand-coloured glow on `Button.tsx`'s `primary` variant only, tuned down rather than dropped in dark mode — a coloured glow at the light value's opacity reads as a halo on a near-black ground).

Re-benchmarked against this heavier, multi-surface load (cards, buttons and the sheet simultaneously, not House Style's one subtle layer) with the same method M-34 established — a scripted scroll, 100-card list, 360×640, Chrome's 10× CPU throttle: mean frame time 7.02 ms shadowed vs 6.95 ms unshadowed, p95 7.60 ms vs 7.70 ms, 1 frame over the 16.7 ms budget out of 299 shadowed vs 0 unshadowed, 0 severe drops (>33 ms) in either — no measurable cost, for the same reason M-34 found none: a static `box-shadow` rasterizes once per layer rather than repainting every scroll frame. That's throttled desktop-Chrome emulation, not physical mid-range-Android hardware — real enough to ship on, not a substitute for an on-device pass. The stronger tier is unchanged in kind, changed in mechanism: shadow beyond `--shadow-card` is still reserved for things that genuinely float — sheets (now `--shadow-sheet`), popovers, the sticky action bar once content scrolls under it, and the day card's own `elevated` prop, which **replaces** `--shadow-card` with `shadow-md` rather than stacking on top of it (both set the same CSS property; `elevated` is a two-tier switch, not an additive one — corrected from this document's own prior description).

**Motion**

| Token | Duration | Curve | Use |
|---|---|---|---|
| `micro` | 120ms | ease-out | Press, check, chip |
| `enter` | 200ms | ease-out | Sheet up, toast in |
| `exit` | 160ms | ease-in | Dismiss |

Everything respects `prefers-reduced-motion: reduce` by collapsing to opacity-only. No parallax, no scroll-linked animation, no skeleton shimmer (a static skeleton reads the same and costs nothing).

**Touch feedback is not optional, because the thumb covers the target.** On a phone the user cannot see what they just tapped — their own finger is on it — so the only confirmation available is what happens at the edges of the press, and it has to be immediate rather than waiting on the network.

| Element | `:active` |
|---|---|
| Primary button | `scale(0.98)` + fill darkened 10%, `micro` |
| Secondary / outline button | Fill becomes `--color-brand-wash`, `micro` |
| List row, calendar cell | Background `--color-brand-wash` for the duration of the press |
| Keypad digit (`AmountPad`) | Fill darkened 10% — no scale, because a shrinking key under a stationary thumb reads as a miss |

Use `:active`, not a JS press handler: it survives scroll cancellation and costs nothing. Haptics are Android-only (`navigator.vibrate(10)`) and fire **only** on a write that moves money, never on navigation — iOS Safari has no equivalent, so nothing may depend on it.

**And one performance caveat on `Provisional`.** Its striped edge is a `repeating-linear-gradient` at 45° confined to a 4px pseudo-element on the leading edge — never a full-element overlay. A list where several rows are provisional would otherwise repaint a large gradient on every scroll frame, which is exactly the jank a mid-range GPU shows first.

---

## 6. Component inventory

The set below is complete for phase 1. Anything not here is a composition of these; if a screen needs a new one, that is a signal to check the flow against U-2 first.

### 6.1 Structural

| Component | Spec |
|---|---|
| `AppShell` | Safe areas, tab bar, offline banner, toast host. Owns the single scroll region. **Added 18 Aug 2026:** the business name in the app bar, with a switcher affordance only when more than one membership exists (M-33). **Added 21 Aug 2026:** on a screen `Screen` renders with no `onBack`, that name merges with `Screen`'s own title into one bar instead of two (M-36) |
| `Screen` | App bar + scroll region + optional sticky action. Enforces `scroll-padding-bottom`. **Added 21 Aug 2026:** `HomeScreen` uses its one `action` slot for the needs-attention bell (M-36a) — every other screen's use of that slot is unaffected |
| `Sheet` | Bottom sheet. Drag-to-dismiss **plus** a visible close button (M-23). Focus trapped, `aria-modal`, restores focus, answers the hardware back button/gesture on mobile via a `CloseWatcher` |
| `ActionSheet` | List of actions in a sheet. The quick-add target |
| `Dialog` | Centre modal. **Only** for INV-1, INV-17 and M-10 confirms. Three per app |
| `Card` | Hairline surface. One elevated variant, used only by the day card |
| `Section` | Heading + count + collapsible body + "Show all" |
| `Badge` | Small semantic label — `brand`/`good`/`warning`/`serious`/`critical`/`neutral`, always paired with the same word the screen already shows (M-15) |
| `EntityAvatar` | **Added 22 Aug 2026, Tactile Ops Phase 5** (`TACTILE-OPS-REDESIGN-2026-08-21.md` §5H — not yet a numbered `M-35` decision, same in-flight status as §5.1's palette). Circular identity chip, 36px (list) / 48px (detail header). Vehicles + drivers: brand-tone fill, white icon/initials. Customers (person or organisation): neutral fill, dark icon/initials — a customer isn't "ours" the way a vehicle or driver is. Always `aria-hidden`; the caller's own text carries the accessible name. Not yet applied anywhere (Phase 7) |

### 6.2 The load-bearing five

These carry the product. Get them right and most screens assemble themselves.

**`DayCard`** — the 30-second obligation (F-4.2). One card, three buttons, no navigation.

```
┌────────────────────────────────────┐
│ Bus  ·  Tue 30 Jul                 │
│ Expected from Sunil                │
│                                    │
│   5,000                            │  hero, tabular
│                                    │
│  ┌──────────────────────────────┐  │
│  │       Paid in full           │  │  56px, brand fill
│  └──────────────────────────────┘  │
│  ┌─────────────┐ ┌──────────────┐  │
│  │Something else│ │  Didn't run  │  │  44px, outline
│  └─────────────┘ └──────────────┘  │
└────────────────────────────────────┘
```

- One tap writes the day record, the obligation, the payment and the allocation **in one transaction** (F-4.2). The UI reflects it optimistically and shows a sync chip until confirmed (M-12).
- If the card does not exist, tapping creates it. The scheduled job is an optimisation, never a prerequisite — a manager must never find the app's most-used screen dark for a reason he cannot see.
- "Something else" opens a sheet with **both** figures — earned and received (UC §6.8) — because a cheap day and an unpaid day must stay distinguishable forever.
- "Didn't run" opens a reason list. `On charter` is **not** in it, ever (FL §4.1).

**`AmountPad`** — the money keypad (M-7).

```
┌────────────────────────────────────┐
│  Amount received                   │
│                                    │
│              5,000                 │  hero, tabular, editable
│  expected 5,000                    │  caption
│                                    │
│    1      2      3                 │  56px targets
│    4      5      6                 │
│    7      8      9                 │
│    .      0      ⌫                 │
│                                    │
│  ☐ Make this the new daily amount  │  U-2 level 2
│    from  [ 30 Jul ▾ ]              │  editable date, not "today" (F-4.3)
│  ┌──────────────────────────────┐  │
│  │           Save               │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

Digits build minor units from the right, so there is no decimal-point state machine to get wrong. The value never passes through `Number` (§8.1).

*How the OS keyboard is kept away.* The display is a **non-focusable `<div role="textbox" aria-readonly="true">`**, never an `<input>` — an `<input readonly>` still summons the keyboard on some Android builds and always draws the iOS accessory bar. `user-select: none` suppresses the long-press magnifier and paste bubble. `env(keyboard-inset-height)` does not apply here and must not be used: the pad *is* the keyboard, and treating it as one produces a double offset.

*The "make this the new daily amount" checkbox* (UC-32) persists the figure from the **selected date forward** and never touches earlier days. The Save button is the confirmation — there is no second confirm, because the change is reversible by the same control and F-4.3 already requires the effective date to be editable rather than pinned to today.

**`MoneyField`** — the inline variant for forms, opening `AmountPad` on tap. Where a native keyboard is genuinely better (a long expense form already using the keyboard), it degrades to `type="text" inputmode="decimal"` — never `type="number"`, which rejects locale separators and behaves inconsistently for decimals ([why not type=number](https://css-tricks.com/finger-friendly-numerical-inputs-with-inputmode/)). Format on blur, never per keystroke.

**`AllocationPreview`** — the oldest-first preview (M-8, UC §6.5).

```
┌────────────────────────────────────┐
│ Received 30,000 from Sunil         │
├────────────────────────────────────┤
│ Tue 14 Jul     5,000   ✓ settled   │
│ Wed 15 Jul     5,000   ✓ settled   │
│ Thu 16 Jul     5,000   ✓ settled   │
│ Fri 17 Jul     5,000   ✓ settled   │
│ Sat 18 Jul     5,000   ✓ settled   │
│ Mon 20 Jul     5,000   ✓ settled   │
├────────────────────────────────────┤
│ Allocated 30,000 · nothing left    │
│ ┌────────────┐ ┌─────────────────┐ │
│ │Change      │ │    Confirm      │ │
│ │allocation  │ │                 │ │
│ └────────────┘ └─────────────────┘ │
└────────────────────────────────────┘
```

Identical in F-4.5 (driver settles several days), F-4.6 (bulk confirm a week), F-6.2 (lump sum across trips) and rent paid across two dues. Surplus is shown as "held as credit", never as an unexplained overpayment.

**`TwoBalances`** — the driver's position (M-14, F-6.4).

```
┌────────────────────────────────────┐
│ Sunil Perera                       │
│                                    │
│ ▌ He owes you            8,000     │  brand rule
│   6 short days, oldest 14 Jul      │
│                                    │
│ ▌ You owe him           12,000     │  orange rule
│   Trip #21 fee, unpaid             │
│ ─────────────────────────────────  │
│   Net: you owe him       4,000     │  ink-muted, information only
│                                    │
│  ┌──────────────────────────────┐  │
│  │          Offset…             │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

The net line is never styled as a total, never bold, and never the thing a tap acts on. Offset opens a sheet asking how much, and writes one recorded action with a date and a note.

### 6.3 Input

| Component | Rules |
|---|---|
| `Field` | Top-aligned visible label, always. Placeholder is never the label — it disappears on the first keystroke ([form UX](https://www.designstudiouiux.com/blog/form-ux-design-best-practices/)). Optional fields are marked "optional"; required fields are not asterisked, because at level 1 everything is required and nothing is |
| `Disclosure` | The U-2 level-2 container (M-6). Labelled "More" on first use, then the section name once opened; **remembers per form** (U-2) |
| `EntityPicker` | Vehicle / driver / customer. Pre-filled by U-3, opens a searchable sheet, recent-first, with "Add new" at the bottom |
| `DateField` | M-17. One native picker with a weekday display, because "Tue 30 Jul" is checkable and "30/07" is not |
| `ReasonPicker` | Single-select list in a sheet. Used by lost-day reasons, adjustment reasons, write-off reasons |
| `PhotoCapture` | M-18, M-30, plus the pipeline below — a condition set is six photos and the naive version stalls on 4G |
**`PhotoCapture`** — named slots for condition sets (front, back, left, right, interior, existing marks); a free grid for receipts and odometer photos.

| Stage | Spec |
|---|---|
| Capture | `<input type="file" accept="image/*">` (M-18, M-30) — deliberately no `capture` attribute, so the OS picker offers both the camera and the existing photo library |
| Downscale | Longest edge 1600px |
| Encode | **JPEG at quality 0.75.** Universally encodable from a canvas on every target browser; a 12MP camera photo of a car panel gains nothing from a newer format at this size |
| Cap | **200KB hard.** If the first encode exceeds it, re-encode at 0.6, then 0.45, then accept whatever the third pass gives and flag it |
| Where | In a Web Worker where available, with a 3s timeout. A 12MP decode on a 2GB device can block the main thread for seconds; on timeout, upload the original and let the Worker resize it |
| Upload | **M-29.** Through the Worker's `R2` binding, one request per photo, per-photo progress (`"uploading"`/`"uploaded"`/`"error"`, not a byte-level percentage) and retry — **not** the mutation queue, which is for JSON writes, and **not** a presigned PUT: see M-29 below |
| Budget | A six-photo condition set is ≈1.2MB. It uploads in the background and the lease is savable before it finishes; a half-uploaded set shows which photos are still going |

The failure that matters is not a slow upload — it is a manager who taps Save, sees a spinner, and closes the app. So the record saves first and the photos follow it.

| `BorneByPaidBy` | The one control that must never collapse two fields (W-48). Renders as two rows, both pre-filled, both at level 2 — "Paid by *you*" and "Borne by *the driver*" — with the derivation shown as caption text so the default is auditable at a glance |
| `NoteField` | Level 2, one line, expands. Present on every money record, because UC §6.5's disputes are settled by notes |
| `FieldError` | See below — every form in the product depends on it |

**`FieldError`** — the visual half of §9.2's timing rules.

| | |
|---|---|
| Field border | `--color-critical` at 2px, replacing the 1px hairline. The 1px→2px change is a layout shift unless the field reserves 2px from the start — reserve it |
| Message | `body-sm` in `--color-critical-ink`, with a 16px icon, directly below the field |
| Space | The message slot is **reserved at 20px whether or not there is an error**, so validating on blur never reflows the form under the user's thumb |
| Announcement | `aria-describedby` on the field; the summary count announces via a live region (SC 4.1.3) |
| Colour | Never alone — the icon and the message carry it (M-15) |

*The mobile-specific part.* Focusing the first error must scroll it clear of **both** the sticky action bar and the message that is about to appear beneath it, so the scroll target is `field height + 20px message + scroll-padding-bottom`. Get this wrong and the field the user must fix sits behind the button they are trying to reach, which is SC 2.4.11 and also just infuriating. One line per error on mobile; wrapping is allowed from `md` up.

### 6.4 Display

| Component | Rules |
|---|---|
| `Money` | Tabular, `Rs` prefix, thousands grouped, cents only when non-zero (M-16). Never truncated, never abbreviated to "5k" on a money screen |
| `StatTile` | Label, value (hero or title), optional delta with arrow **and** sign **and** word, optional sparkline. §11. *Sparkline:* single 1.5px `--color-ink-muted` stroke, last 30 points, no axes, no dots, no fill, no interaction — it is a shape, not a chart. Below 6 points it renders nothing rather than a misleading near-straight line (M-13). Tapping the tile opens the full report; the sparkline itself is `aria-hidden` |
| `NotAvailable` | M-13. Renders the em-dash with a caption saying *why* — "no closing odometer" — and an info affordance. Never zero. **Means the number does not exist** — never means "the read failed"; those are different facts and stay visually distinct (§11.4) |
| `QueryState` | M-28. Wraps one read (or, via `combineQueryStates`, several) in four states — `idle`, `pending`, `error`, `ready` — never three. **`idle` (a disabled query, `enabled: false`) is not `pending`**: a query that was never asked must not render a spinner, or it spins forever. `error` renders `EmptyState`'s sibling — icon, a status-mapped sentence built from the failed request's own `ApiError.status` (never a raw error string, never a status number, and inside the §9.6 vocabulary lock), and **Try again** wired to `refetch`. Combining several reads resolves `error` over `pending` over `idle`, because a screen with one failed read has already failed regardless of what else is still in flight |
| `Toast` / `ToastViewport` | M-11. A 5-second, dismissible status surface hosted by `AppShell` above the tab bar, with optional action. `ToastProvider` is app-wide. Undo is only wired where the write qualifies under M-11; money writes, sent messages and settled obligations use recorded correction flows instead |
| `Provisional` | The striped-edge treatment for estimated figures: an apportioned mileage split (UC-14), a pending insurance recovery (W-11), an unsynced write (M-12). One visual language for "this number is not final" |
| `AlertStrip` | Home items 1–2, and inline warnings (M-9). Icon + text + one action |
| `SyncChip` | "Not yet saved" on the record itself, not in a global banner |
| `OfflineBanner` | **32px**, `caption`, below the app bar and above the scroll region — never overlaying content, because the scroll region's height must account for it or the day card's buttons move. Reads "Working offline" alone, or "Working offline · 3 waiting" when the queue is non-empty. Not dismissible; it leaves when connectivity returns. It is the only global offline signal — per-record state is the `SyncChip` (M-12) |
| `Timeline` | Append-only history on any money record (W-50, UC-97): who, when, from what to what. A **voided** record (DM `voided_at`) renders struck through with its replacement linked directly beneath — never hidden and never silently swapped, because F-8.5's whole point is that the original stays visible with its correction attached |
| `EmptyState` | A sentence in `--color-ink-secondary` and, only where an action is genuinely the answer, one button. No illustrations |

### 6.5 What is deliberately absent

- **No carousel.** Nothing here is browsable.
- **No pull-to-refresh as the only refresh.** It is a shortcut; a visible refresh exists in the app bar.
- **No badge counts on the tab bar except Home.** Everything urgent is on Home by U-4; a badge elsewhere contradicts it.
- **No toast for success on money writes.** The record itself changes state visibly. A toast that disappears is not a receipt.

---

## 7. Flow-by-flow mobile specification

Each entry gives the target interaction cost, the level-1 fields, and the traps. Flows not listed follow the same construction.

### 7.1 F-4.2 · Confirm the day — the flow the product is optimised for

| | |
|---|---|
| **Target** | 1 tap, no navigation, no keyboard, works offline |
| **Level 1** | Nothing. The card *is* the form |
| **Level 2** | Earned vs received, note, odometer (optional, never prompted — W-20) |

*First run, empty cache.* The home screen shows a neutral loading state until the Home reads answer. It shows the real empty state — "Nothing needs you today" with the business date — only after those reads have answered with no waiting work. A skeleton appears **only** if the app already knows a daily-lease vehicle exists and its card has not arrived within 300ms. A skeleton before that is a promise of content that may not exist, and on a business with no daily lease it would never resolve.

Traps: the card must be tappable before data loads (render from cache, confirm optimistically); the three buttons must never reflow after load; "Didn't run" must not be reachable by mis-tapping "Paid in full" — hence the two-row layout with the primary alone on its row.

### 7.2 F-4.6 · Confirm a week in one pass

```
┌────────────────────────────────────┐
│ ← 5 days to confirm                │
├────────────────────────────────────┤
│ ☑ Mon 21 Jul   Bus   5,000    ⋯   │
│ ☑ Tue 22 Jul   Bus   5,000    ⋯   │
│ ☐ Wed 23 Jul   Bus   —   Didn't run│  excluded, needs a reason
│ ☑ Thu 24 Jul   Bus   5,000    ⋯   │
│ ☑ Fri 25 Jul   Bus   4,000  edited │  kept as edited
├────────────────────────────────────┤
│ 4 days · 19,000                    │
│ ┌──────────────────────────────┐   │
│ │      Confirm 4 days          │   │
│ └──────────────────────────────┘   │
└────────────────────────────────────┘
```

*Layout.* The day list scrolls on its own; the summary line and the confirm button are **sticky at the bottom**, so the total and the action stay visible whether the stack is five days or fifteen — a two-week catch-up is 784px of rows and is entirely normal under U-8. Tapping `⋯` on a row opens a sheet rather than expanding inline, because an inline expansion pushes every row below it and loses the reader's place mid-review.

Two minutes is the promise (UC §4.3). Rules: a `did_not_run` day can never be bulk-confirmed; an edited day is never overwritten by the bulk action; the total is shown before the write; one transaction, partial failure confirms nothing.

### 7.3 F-3.3 · Log a fuel fill — the ten-second flow

Reached from `＋` → Fuel. Level 1 is **vehicle** (pre-filled with the one that has something pending, U-3) and **amount**. Litres, odometer, borne-by, photo and trip link are all level 2, and borne-by is already correct from the arrangement (UC §6.7) — the manager confirms rather than enters.

The trap is the temptation to require litres because UC-72 wants them. It must stay optional: on a daily lease the driver buys his own fuel and has no reason to report litres, and a report built on a field nobody fills is an empty report (W-20).

### 7.4 F-2.1 · Start a monthly rental — the longest form in the product

This is where U-2 earns its place. The form has upwards of twenty fields; **six** are level 1:

customer · start date · monthly amount · due day · deposit · vehicle (pre-filled)

Everything else — mileage package, excess rate, handover odometer, reminder schedule, condition photos, term — sits at level 2 behind named sections, each savable and each editable later (U-5). Multi-step, one column, with a progress indicator, because a long high-commitment form does better in stages than on one page.

Two specifics:

- **Mileage** is picked from saved packages as chips (`Standard 100` · `Long 150` · `Custom`), and the rental takes its own copy (UC-18). Editing the package next year must not reprice this rental.
- **Paperwork warning fires here** (F-10.1): an expired insurance shows an `AlertStrip` above the primary action, records that you proceeded, and does not block (U-7).

### 7.5 F-5.1 → F-5.4 · The trip, and the screen that serves two arrangements

UC-20 is the highest-leverage decision in the source document — **a short car hire is a trip**. One screen, one mental model, one thing to learn.

The live trip screen is a container (UC §6.6):

```
┌────────────────────────────────────┐
│ ← Trip #21 · Bus · 28–30 Jul       │
│   Kandy · Ruwan Traders            │
├────────────────────────────────────┤
│ Agreed          60,000             │
│ Received        30,000  advance    │
│ Costs so far    25,000             │
│ Driver          Sunil · fee 9,000  │
│ Advance to him   5,000  unreconciled│  ← INV-17 will block close
├────────────────────────────────────┤
│  ＋ Add cost        ＋ Add payment  │
├────────────────────────────────────┤
│ Fuel      28 Jul   22,000  ⛽ 60ℓ  │
│ Tolls     29 Jul    3,000          │
├────────────────────────────────────┤
│ ┌──────────────────────────────┐   │
│ │        Close trip            │   │
│ └──────────────────────────────┘   │
└────────────────────────────────────┘
```

Closing is the one place friction is correct: an unreconciled advance blocks with a `Dialog`, because unreconciled advances are how trip profit quietly becomes fiction. The dialog names the amount and offers the reconciliation inline — a block that does not offer the fix is just a wall.

Booking warns what the dates cost — the daily lease pauses and its expected income disappears — before the conflict can be created (INV-1).

### 7.6 F-1.5 · The vehicle calendar

The one screen that justifies a custom date component. A month grid, one state per day (UC §6.3), colour + **glyph** so it survives colour blindness and greyscale printing:

| State | Cell |
|---|---|
| Not scheduled | empty, `--color-page` |
| On a lease | brand wash, `L` |
| Daily lease, ran | brand wash, `✓` |
| Daily lease, lost | serious wash, `!` |
| On a trip | orange wash, `T` |
| Hold (tentative) | orange **outline**, `T?` — visually distinct, and it does *not* suppress daily cards |
| Off the road | hatched, `✕` |

On a 360px screen the grid is 7 × ~44px cells, which is exactly at the target minimum — so the tap target is the cell and the legend is below, never a tooltip.

### 7.7 F-9.1 · Close the month

A checklist screen, not a button (M-10). It lists unconfirmed days, open trips, unreconciled advances, dues awaiting a decision and incidents with no bill — each a link that goes and fixes it, each with a count. It **warns and does not block** (U-7), then the primary action reads **"Close July permanently"** and requires a second confirm stating that closing cannot be undone and that the next period opens in the same action.

Manager role: the action is **absent**, not disabled (M-22, W-49).

### 7.8 Review shell · the passive owner's 60 seconds

```
┌────────────────────────────────────┐
│ July 2026                     ▾    │
├────────────────────────────────────┤
│ My share this month                │
│         86,500                     │  hero
│         ▲ 12% vs June              │  good token + arrow + word
├────────────────────────────────────┤
│ CAR · KL-4521                      │
│ Earned 70,000 · Spent 8,200        │
│ My share 30,900         ›          │
│ ⚠ Insurance expires in 21 days     │
├────────────────────────────────────┤
│ CAR · KP-8890                      │
│ Earned 70,000 · Spent 0            │
│ My share 35,000         ›          │
├────────────────────────────────────┤
│ What I'm owed          124,000  ›  │
├────────────────────────────────────┤
│ Overheads (no vehicle)   9,400  ›  │  never spread across vehicles
└────────────────────────────────────┘
```

No entry affordance anywhere. "Anything unusual" is surfaced as a strip on the vehicle it concerns, not as a separate feed. Overheads appear as their own block beneath vehicle totals (W-32) — the layout is carrying an accounting rule, so it must not be tidied into the vehicle cards.

### 7.9 Mine shell · the driver's own view

One screen, read-only, and the security boundary is server-side (§2.3). `TwoBalances` at the top, then his days with their states (including excused days, which is the thing he would otherwise argue about), his trips and fees, advances, deposit, and a "Statement" link that produces the same content as the printed slip (UC-57).

**No write affordance exists in this shell at all** — not disabled, not hidden behind a role check in a shared component. Different component tree.

### 7.10 The rest, in brief

| Flow | Level-1 fields | Note |
|---|---|---|
| F-2.2 collect rent | amount (pre-filled), date, received by | Odometer at level 2 with a "photo" affordance (UC-14). The route it arrived by is stored and shown |
| F-3.1 expense | amount, category, vehicle | `BorneByPaidBy` at level 2, both pre-filled |
| F-3.4 incident | date, description | A container that gathers costs and recoveries over weeks; shows spent / recovered / expected / **net cost to you** at the top, always |
| F-6.1 pay driver | amount | One tap on a trip's fee. A no-trip payment is the same sheet with the trip left blank and a category chosen |
| F-7.4 bank the cash | amount, date, destination | Never called "deposit" (§1.5). The shortfall path (W-37) offers the two choices explicitly and defaults to neither |
| F-8.2 reverse a receipt | new amount, reason | Partial by default. The shortfall destination is a required choice, never a silent default to the driver's arrears |
| F-8.5 fix a mistake | reason | Void and replace, never overwrite. The original stays visible with its correction attached |

### 7.11 Whole-app design refresh pass (M-31)

The 14 August 2026 QA pass found the app structurally usable but visually flatter than the product deserves: the login entry has almost no identity, Home has the right facts without enough priority, and desktop stretches mobile rows instead of becoming the §14 layout. This pass is therefore a route-wide design refresh, not a Home-only restyle.

**Principles.** These sit below the existing U/W/M rules, never above them:

1. **One focal job per screen.** The first viewport answers "what needs me now?" for Operate, "what changed?" for Review, and "what is my position?" for Mine.
2. **Semantic colour, not decorative colour.** Brand, status and direction tokens keep their meanings from §5.1. Any coloured surface ships with an icon and a word; money stays ink-coloured (M-15).
3. **Iconography clarifies category.** Use `lucide-react` icons beside alerts, queue headers, entity rows, tabs and quick actions where category recognition matters. Icons never replace labels on touch surfaces except below-`md` landscape, where accessible names remain.
4. **Surfaces create hierarchy.** Neutral surface area stays dominant. Use accent borders, badges, washes and type weight to separate critical alerts, today's work, queues and secondary history.
5. **Adaptive layout is part of the design.** At `lg`, the same routes gain the §14 left rail and a constrained or two-pane content layout; no 1200px-wide mobile row is acceptable.
6. **Every route has data / real nothing / failed read states.** The M-28 contract remains visible after the refresh; prettier empties must not hide a failed read or turn unknown into zero.
7. **Copy remains operational.** No marketing copy inside the app shell, no accounting vocabulary, no congratulations. The login entry may state the product promise; work screens stay factual.

**Route inventory for the refresh.** A design-refresh PR is not done until each row below is inspected at 390 x 844, 360 x 640 and `lg`, with light and dark where the surface materially changes.

| Route family | Routes | Required design modifications |
|---|---|---|
| **Auth entry** | unauthenticated `/`, `/auth/callback` loading | Branded FleetSettle entry: mark/wordmark, one value line, lock/shield icon, full-width primary CTA, short security line, and a loading state that keeps the same identity. Hosted Asgardeo branding is BR §5.5, not code-only. |
| **First-run setup** | post-auth no-membership state: create business, redeem invite | Treat this as setup, not marketing: two clear choices, business/invite icons, short helper copy, one-column forms, honest loading/error states, and the same FleetSettle identity as auth. It must still work for revoked members without revealing whether access was revoked. |
| **Operate home** | `/` | "Fleet operations cockpit": compact greeting/date, critical alert with icon/title/detail/action, top summary row (`Rent due`, `Trips in progress`, `Confirmed today`), labelled `Rs 0` facts, stronger work-queue headings, semantic row accents, and bottom breathing room above the tab bar. |
| **Vehicles** | `/vehicles`, `/vehicles/:id`, `/vehicles/:id/calendar`, `/vehicles/:id/lease/new`, `/vehicles/:id/daily-lease/new`, `/leases/:id`, `/leases/:id/close` | Vehicle rows use registration-first hierarchy, vehicle/status icons, arrangement/status badges, clear next actions, and calendar cells keep glyph + colour. Create/close routes keep one sticky primary action and level-2 disclosure hierarchy. |
| **Trips and incidents** | `/vehicles/:id/trip/new`, `/trips/:id`, `/incidents/:id` | Trip cards use vehicle/route/date chips and clear state badges. Detail screens lead with the financial summary and unresolved blockers, then actions, then history. Incident containers show spent/recovered/expected/net cost as a compact stat group before rows. |
| **People** | `/people`, `/people/drivers/:id`, `/people/customers/:id` | People rows use customer/driver icons and explicit role/category badges. Driver pages keep `TwoBalances` visually dominant without netting. Customer pages treat dues as work queues with due-age chips and clear collection actions. |
| **Cash, partners and administration** | `/cash`, `/partners/:userId`, `/vehicle-sharing`, `/members`, `/mileage-packages`, `/opening-balances`, `/period/close`, `/more` | More/Cash rows get icon + chevron consistency. Partner/cash screens use stat tiles and direction markers from §5.1. Ownership totals must say the state in words, not colour alone. Close-month checklist rows use warning structure, not a flat list. |
| **Review shell** | `/review`, `/review/vehicles`, `/review/vehicles/:id`, `/review/money` | Review uses higher-density owner reporting: top answer first, vehicle performance cards with unusual items surfaced inline, direction markers consistent with `TwoBalances`, no write affordances. |
| **Reports** | `/reports`, `/reports/*` | Catalogue grouped by owner question, not endpoint name. Report screens use stat tiles + chart/table pairs, direct labels for low-contrast chart colours, and consistent `NotAvailable`/empty/failure variants. |
| **Mine** | `/me` | One read-only statement-like screen. `TwoBalances` first, then days/trips/advances/deposit. No write-looking affordance, no tab bar, and the statement link reads as evidence, not marketing. |

**Overlay and form inventory.** Route inspection also covers flows mounted as sheets/forms rather than URL paths: Quick Add and quick payments, create vehicle, add driver/customer, collect payment, pay driver, advances/deposits/offsets, settle advance, banking, partner contribution/payout, opening-balance entry, renew vehicle document, renew/read/adjust/collect lease actions, daily "something else", incident report/off-road/insurance/recovery/settlement actions, member invite/role/revoke, sign-out confirmation, and expense/fuel/receipt/void cost sheets. These share one design rule: each sheet has a plain title, a category icon only where it improves recognition, one primary action, no nested cards, 44px targets, field-level errors, and a visible success/error path that preserves M-12/M-28 honesty.

**Implementation order.** The refresh should move from shared language to route families:

1. **Design primitives first:** `Section` header treatment, `EmptyState` variants, `NotAvailable` variants, row icon/accent conventions, `StatTile` usage, and desktop rail/content constraints.
2. **Auth + first-run setup + shell + Home:** the live QA pain points and the surfaces every user sees.
3. **Operate route families:** Vehicles, Trips/Incidents, People, Cash/More.
4. **Review, Reports and Mine:** reporting density and direction consistency.
5. **Verification:** browser route pass at 360 x 640 and 390 x 844, `lg` desktop, no horizontal body scroll, 44px targets, axe-core, console warnings, and text clipping at 200% text size.

---

## 8. Money and numbers

### 8.1 The type rule, restated for the client

TS §6 fixes it server-side; the client inherits it. **Money is a `string` on the wire, a `bigint` in logic, and never a `number` anywhere.** One codec module, used at both edges of the client too.

```ts
// money.ts — the only place minor units are parsed or formatted
export type Minor = bigint;

export const parse = (wire: string): Minor => BigInt(wire);

export const format = (v: Minor, opts?: { cents?: boolean }) => {
  const neg = v < 0n, abs = neg ? -v : v;
  const major = abs / 100n, cents = abs % 100n;
  const show = opts?.cents ?? cents !== 0n;           // M-16
  const body = new Intl.NumberFormat('en-LK').format(major)
    + (show ? '.' + String(cents).padStart(2, '0') : '');
  return (neg ? '−' : '') + body;                      // U+2212, not a hyphen
};
```

A value that has passed through `Number` is a bug even when the arithmetic happens to be right. LKR cents stay well inside `MAX_SAFE_INTEGER`, so it will never fail in testing — only in a rounding argument two years from now.

**The locale list is a fallback chain, and the grouping is asserted rather than trusted.** `en-LK` is a valid CLDR locale but not every engine on a mid-range Android WebView carries every locale's data, and the failure is silent — it falls back and formats slightly differently. Two defences: `['en-LK', 'en']` lets the runtime negotiate rather than guess, and a unit test asserts that `format(123456789n)` is `1,234,567.89`. That test is not paranoia — the South Asian alternative is `12,34,567.89`, which is a legitimate grouping for some locales in the region and is wrong for LKR. A silent switch to it would look plausible on screen and be wrong on every statement.

### 8.2 Presentation

| Rule | |
|---|---|
| Prefix | `Rs` with a non-breaking space. The currency is fixed per business (W-54) and shown, not chosen |
| Grouping | `en-LK` thousands |
| Negatives | Minus sign U+2212 and a word. Never parentheses, never colour alone (M-15) |
| Alignment | Right-aligned and tabular in any vertical list of amounts |
| Truncation | **Never.** If it does not fit, the layout is wrong. Wrap the label, not the number |
| Abbreviation | Never on a money screen. `86.5k` is allowed only on a chart axis |
| Zero vs unknown | `Rs 0` and `—` mean different things and must look different (M-13) |

### 8.3 Distance, litres, dates

- Whole kilometres. A reading lower than the last one **warns and does not block** (UC §6.16) — clusters get replaced and figures get mistyped.
- Litres to one decimal, always with the unit.
- Dates as `Tue 30 Jul` in the UI, `30 Jul 2026` where the year is ambiguous, ISO only in exports. Never `30/07` — the ordering is not universally read the same way.
- **"Today" is the business timezone's today** (`Asia/Colombo`), computed once in a provider and never from the device clock. A device set to another timezone must not shift the day card.

---

## 9. Forms, feedback and copy

### 9.1 Structure

One column, always. Top-aligned labels — they produce the fastest completion and fewest errors. Group into short named sections; multi-step for anything over ~8 level-1 fields, with a progress indicator.

### 9.2 Validation timing

| Moment | Behaviour |
|---|---|
| While typing | Nothing. Never mark a field invalid mid-entry |
| On blur | Validate that field, inline, below it |
| On submit | Validate all, move focus to the first error, announce the count via a live region |
| Server rejection | Map to the field where possible; otherwise an `AlertStrip` above the action with the exact reason |

Errors say what to do, not what happened: "Enter the amount he handed over" beats "Required field".

### 9.3 Warn, don't block (U-7)

Three tiers, and only three:

| Tier | Render | Examples |
|---|---|---|
| **Note** | Caption under the field | An odometer lower than the last reading |
| **Warn** | `AlertStrip` above the primary action; proceeding is recorded | Expired insurance at F-2.1/F-5.1; closing a period with an open trip |
| **Block** | `Dialog` with the fix offered inline | INV-1 double-booked vehicle-day; INV-17 unreconciled advance at trip close |

There are exactly two blocks in the product. If a third appears, it needs a decision entry, not a component.

### 9.4 Offline and the write queue (M-12)

| State | UI |
|---|---|
| Online, saved | Record shows its new state. No toast |
| Offline, queued | Record shows its new state plus a `SyncChip`. The app bar carries a count |
| Reconnected, syncing | Chip spins; count falls |
| Rejected on replay | The record reverts, an `AlertStrip` appears on it with the reason, and it stays at the top of Home until dealt with |

Never show a settled state for something the server has not accepted **without** the chip. The chip is the whole honesty mechanism.

### 9.5 Loading and failing

- **Cache-first.** Anything seen before renders instantly from cache and revalidates behind.
- Skeletons only where layout is knowable; otherwise a single centred spinner after 300ms. Never a spinner that appears and vanishes in 80ms.
- The day card renders from cache and is tappable before any request resolves.
- **A read that fails is never presented as loading, and never as empty.** M-28/`QueryState` (§6.4) is the mechanism. Concretely, this forbids the pattern that produced GAP-101: a query's `data` reads `undefined` in both the pending and the error case, so a guard written as `if (query.data === undefined) return <Loading/>` cannot tell them apart, and a fallback written as `query.data ?? []` or `?? 0` turns a failed read into a confident, wrong "nothing" — worse than the spinner, because it asserts something rather than merely stalling.
- The status a failed read shows is drawn from the request's own `ApiError.status`, not a generic sentence:

  | Status | Says | Offers |
  |---|---|---|
  | 401 | "You've been signed out." | Sign in |
  | 403 | "You don't have access to {what}." | — |
  | 404 | "{What} isn't here any more." | — |
  | other 4xx | "{What} couldn't be loaded." | Try again |
  | 5xx | "Something went wrong loading {what}." + the request ID, as a caption | Try again |
  | not an `ApiError` (offline, token getter failure) | "Couldn't reach the server. Check your connection." | Try again |

  `{what}` is mandatory — there is no bare failure message, the same discipline `NotAvailable`'s `reason` already holds — and where a reserved word applies (§9.6), it is used, never abbreviated.
- **Retrying a decided answer is not resilience.** A 4xx is the server's considered response, not a hiccup; retrying it three times with backoff before showing the failure (TanStack Query's own default) only makes the eternal-spinner problem last seven seconds longer. 5xx and network failures keep the retry ladder, because those genuinely do resolve themselves.

### 9.6 The vocabulary lock

The flows document reserves seven words (FL §1.5). The UI uses them and only them, and never abbreviates:

| Say | Never say |
|---|---|
| Daily lease amount (he pays you) | Rate, daily rate |
| Driver day fee / driver trip fee (you pay him) | Rate, wage |
| Deposit (security money held) | Deposit for banking — that is **banking** |
| Advance (road expenses, to be reconciled) | Payment, loan |
| Earned / Received | Amount, total |
| Waiver (you chose) / Write-off (you were handed) | Discount, adjustment for either |
| Lost day | Missed day, off day |
| Borne by / Paid by | Cost owner, funder |

And U-6 in one line: no "accrual", no "current account", no "allocation", no "recognition", no "receivable" in any user-facing string. "What you're owed." "Who owes you." "What the bus earned."

---

## 10. Accessibility

**Target: WCAG 2.2 Level AA**, verified per release. The criteria that actually bite in this product:

| SC | What it costs us if missed |
|---|---|
| **2.5.8 Target Size (AA, 24px)** | We commit to 44px (§4.3), so this passes by construction — but icon-only buttons and calendar cells need explicit padding |
| **2.4.11 Focus Not Obscured (AA, new in 2.2)** | The sticky bottom action hides the focused field. Fixed by `scroll-padding-bottom` (§4.2) |
| **2.5.7 Dragging Movements (AA, new in 2.2)** | Every swipe action needs a tap equivalent (M-23) |
| **3.3.7 Redundant Entry (A, new in 2.2)** | Catch-up flows must not re-ask for the vehicle and driver on each of five days |
| **1.4.10 Reflow** | 320px, no horizontal scroll except inside a table's own container |
| **1.4.11 Non-text Contrast** | Field borders, the focus ring, chart marks and calendar cell states all need 3:1 |
| **1.4.3 Contrast** | Every token in §5.1 is measured; `--color-ink-faint` is non-text only |
| **4.1.3 Status Messages** | Sync state, allocation results and error counts announce via `aria-live="polite"` |

**Non-negotiables beyond the standard:**

- Colour never carries meaning alone anywhere in the product (M-15), including the calendar and every chart.
- Focus is visible on every interactive element, and the ring is never removed for aesthetics.
- Every sheet traps focus, is escapable, and restores focus to its trigger.
- Text scales to 200% without loss; the day card is tested at 200%.
- Screen-reader labels use the reserved vocabulary, not the visual shorthand — a leading colour rule is `aria-hidden`, and the row reads "He owes you, 8,000 rupees".

---

## 11. Data visualisation

Charts appear in exactly one place in the Operate shell — a trip's own P&L — and everywhere in Review and Reports.

### 11.1 Form before colour

| Report | Form | Why not something else |
|---|---|---|
| UC-70 this month | **KPI row** of stat tiles + one horizontal bar per vehicle | The reader wants magnitudes and one comparison, not a time series |
| UC-71 trips that made money | Horizontal bar, ranked, direct-labelled | Long names, few items |
| UC-72 fuel efficiency | Line over time, single series | A trend, and it must render `NotAvailable` for lease days rather than a zero |
| UC-73 the year | Column per month + overheads as a separate block beneath | Never stacked into vehicle profit (W-32) |
| UC-74 who owes us | **Table**, not a chart | It is a work list; the reader acts on rows |
| UC-75 where is our cash | Stat tiles + a stacked bar of held vs ours, **plus a breakdown by bank account and by driver advance** | The liability split is the point — and "held" is not one number per partner, it is three: what's in his pocket, what's banked where, what's out with drivers |
| UC-76 lost days | Column per month + **weekday distribution** and **the reason breakdown** as two second-tier charts | "Four days lost" and "four Fridays lost" are different conversations — and "a bus that breaks down often" and "a driver who takes Fridays off" are a third |
| UC-77 goodwill given | Single number + a table by reason | And **never** summed with write-offs (W-28) |
| UC-78 ageing | Horizontal stacked bar of buckets + table | |
| UC-79 utilisation | Stacked bar of earning / idle / off-road per vehicle | |

**⚑ Both the UC-75 and UC-76 rows above were incomplete against their own use case, and this table is where the gap actually was.** UC-75's own text asks for held cash **"in each account"** and **"out with drivers as advances"** — this table named only the stacked bar (held vs. the deposits liability) and dropped both. UC-76's own text asks for **"the reason breakdown, and the weekday distribution"** together — this table named only the second. `DM §15` had the identical omission in its own SQL, which is not a coincidence: this row is very likely where DM's query was scoped from in the first place, so the two documents were incomplete in the same direction rather than disagreeing. Found by the `B4-REPORTS-DESIGN.md` verification pass (§8.1/§8.2, 7 August 2026), and confirmed a second time building Web-P9/B4 Wave 1 directly against this table: the lost-days screen that shipped from it has a column per driver and a real weekday chart, and nowhere to put a reason a manager might want to see. `DM §15` v1.1.2 carries the query side of both corrections; the chart/table implementation is separate work, scheduled as B4 Wave 2 in `Plan.md`.

### 11.2 Palette

Charts use the validated categorical order, unchanged, on the `--color-surface` colours in §5.1:

| Slot | Light | Dark |
|---|---|---|
| 1 | `#2A78D6` | `#3987E5` |
| 2 | `#EB6834` | `#D95926` |
| 3 | `#1BAF7A` | `#199E70` |
| 4 | `#EDA100` | `#C98500` |
| 5 | `#E87BA4` | `#D55181` |
| 6 | `#008300` | `#008300` |
| 7 | `#4A3AA7` | `#9085E9` |
| 8 | `#E34948` | `#E66767` |

Validated against our surfaces: worst adjacent CVD ΔE 9.1 light, worst adjacent normal-vision ΔE 19.6 — both clear. Three light-mode slots sit below 3:1 on the surface (aqua 2.72, yellow 2.09, magenta 2.60), which obligates **visible direct labels or a table view** on any chart using them, not an optional nicety. For scatter/bubble/small-multiple forms the series cap is **three**; past that, fold into "Other" or facet.

Sequential encoding is one hue (blue), light→dark. Diverging is blue↔red with a grey midpoint. Status colours are never reused as series colours.

### 11.3 Mobile chart rules

- **One chart per viewport.** A chart the reader has to scroll while reading is two charts.
- **No hover, so tap = tooltip.** Tap targets are larger than the marks; tapping outside dismisses.
- **Horizontal bars for anything with a name.** Vehicle registrations and customer names do not fit under a vertical column on a 360px screen.
- **Charts scroll inside their own container** with `overflow-x: auto`; the page body never scrolls horizontally.
- **A legend is always present for ≥2 series**; ≤4 series are also direct-labelled.
- **Never a dual axis.** Two measures of different scale are two charts.
- **Every chart has a table view**, one tap away. On the smallest screens the table is often the better default, and it is the accessibility relief for the low-contrast slots.
- **No pie charts.** Part-to-whole is a stacked bar.
- The chart library loads in the Reports route chunk only. Sparklines in stat tiles are ~30 lines of hand-written SVG and pull in nothing.

### 11.4 Degradation is a visual rule, not just a data rule

W-56 says reports degrade to "not available", never to zero. On screen that means the `NotAvailable` component *in place of the mark*, with the reason in the caption — a bar of height zero and a bar for missing data must never look the same.

**"Not available" and "failed to load" are two different facts and render as two different components (M-28).** `NotAvailable` means the report ran and this figure genuinely has no value — no closing odometer, no predecessor period. A report whose read *failed* — the request never came back — is `QueryState`'s error state (§6.4/§9.5), not `NotAvailable`: the chart does not render at all, rather than rendering with every bar reading "not available," which would claim the report ran and came back empty.

---

## 12. React implementation

### 12.1 Stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite + React 19 + TypeScript | Already fixed by TS §1 |
| Styling | **Tailwind CSS v4**, tokens in `@theme` | Utility-first is the current default and the token layer stays CSS-native, so the same variables serve charts and components |
| Components | **shadcn/ui** (Radix/Base UI primitives), copied in and resized to §4.3 | Copy-in means we own the touch targets; the primitives bring WAI-ARIA behaviour we would otherwise get wrong ([library comparison](https://www.builder.io/blog/react-component-libraries-2026)) |
| Sheets | `vaul` (shadcn `Drawer`) | Bottom sheet with drag, plus we add the visible close per M-23 |
| Routing | **TanStack Router** | Typed params and loader integration with Query; the alternative, React Router 7, is fine and the migration cost is one week |
| Server state | **TanStack Query v5** with persistence + paused mutations | Paused-and-resumed mutations are exactly M-12's queue, and they survive a reload via hydration ([offline mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)) |
| Auth | **`@asgardeo/auth-react`** ^5.6.2 | OIDC + PKCE + refresh, per TS §1. Settled 31 July 2026 against Neon Auth — `implementation-guidelines.md` §1.2 |
| Forms | react-hook-form + zod, schemas shared with the Worker | One definition of a valid payload |
| i18n | i18next + react-i18next | English + one local language (W-22) |
| Charts | Recharts, lazy, Reports chunk only | Sparklines hand-written |
| PWA | `vite-plugin-pwa` (Workbox) | §12.5 |
| Testing | Vitest + Testing Library + Playwright (mobile viewport project) | §12.6 |

**The client never talks to the database.** TS §1 names a driver and an ORM; both are Worker-side only. Every read and write goes through the Worker API, which is where `business_id` scoping and the W-49 capability checks live (TS §2). A frontend dependency on a database driver would put the multi-tenancy boundary in the browser, which is the one place it cannot be enforced.

**Auth and the offline queue meet in one place, and it needs handling.** A mutation queued while offline (M-12) may replay hours later against an access token that expired in the meantime — a manager confirms four days on a Sunday with no signal and the app reconnects on Monday morning. So the queue's replay fetches a **fresh token per attempt** rather than capturing one when the mutation was created, and a 401 on replay pauses the queue and re-authenticates instead of discarding the write. Discarding is the failure that matters: those four days exist nowhere else, and losing them silently is worse than any error message.

The token getter is injected rather than imported, so the API layer never depends on the auth SDK directly. That is what makes §1.2's reversal cheap on this side too.

### 12.2 Structure

```
web/src/
  app/            shell, routing, providers, role → shell selection
  design/         tokens.css, theme.ts, primitives (Button, Field, Sheet…)
  components/     DayCard, AmountPad, AllocationPreview, TwoBalances, …
  features/
    daily/        F-4.x — screens, hooks, schemas
    leases/       F-2.x
    trips/        F-5.x
    costs/        F-3.x
    people/       F-6.x
    cash/         F-7.x
    period/       F-9.x
    reports/      F-9.2 (lazy chunk)
  lib/            money.ts, dates.ts, api.ts, offline.ts, capabilities.ts
  i18n/           en.json, si.json
```

`features/` mirrors the flow groups and the Worker's `domain/` modules (TS §3), so a flow is one folder on each side.

### 12.3 Tokens as code

This is the **complete** set, not an excerpt. §5 is its documentation; this is its definition, and the names are identical in both (§5.1).

Dark mode has to be reachable two ways — the OS setting and the in-app toggle (M-20) — and CSS has no include. So the hex values live once as **palette constants** and the two mode blocks only remap semantic tokens onto them. That is what stops the toggle and the media query drifting apart, which is the failure mode where switching to dark manually does nothing.

```css
/* design/tokens.css — Tactile Ops Phase 1 palette (22 Aug 2026, §5D) */
@import "tailwindcss";

/* 1 — palette constants. The only place a hex appears. */
:root {
  --l-page:#EDEFF3; --l-surface:#FFFFFF; --l-ink1:#151A22; --l-ink2:#5B6472;
  --l-ink3:#646D7C; --l-faint:#8A93A3;  --l-strong:#DEDFE0;
  --l-brand:#0F2E63; --l-brandink:#0F2E63; --l-wash:#E2E6EC; --l-payable:#EB6834;
  --l-hair:rgba(21,26,34,.10); --l-surface-sunken:#DDE1E8;

  --d-page:#0B0E14; --d-surface:#12151C; --d-ink1:#F6F7FA; --d-ink2:#C2C3C7;
  --d-ink3:#94969B; --d-faint:#84868B;  --d-strong:#292C32;
  --d-brand:#1E3A6E; --d-brandink:#9CBAF7; --d-wash:#141C2C; --d-payable:#D95926;
  --d-hair:rgba(255,255,255,.10); --d-surface-sunken:#2A2C33;
}

/* Tactile Ops Phase 3: self-hosted, variable weight 400-700, latin
   subset only (25,284 bytes) — app-wide via --font-sans below, not
   scoped to a handful of elements. */
@font-face {
  font-family: Sora;
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/sora-variable-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}

/* 2 — the theme. Light is the :root default, so no [data-theme="light"] block
   is needed: the dark selectors simply never match. */
@theme {
  --color-page:            var(--l-page);
  --color-surface:         var(--l-surface);
  --color-ink-primary:     var(--l-ink1);
  --color-ink-secondary:   var(--l-ink2);
  --color-ink-muted:       var(--l-ink3);
  --color-ink-faint:       var(--l-faint);
  --color-line-hairline:   var(--l-hair);
  --color-line-strong:     var(--l-strong);
  --color-surface-sunken:  var(--l-surface-sunken);
  --color-brand:           var(--l-brand);
  --color-brand-ink:       var(--l-brandink);
  --color-brand-wash:      var(--l-wash);
  --color-focus-ring:      var(--l-brandink);
  --color-direction-payable: var(--l-payable);

  /* status — fixed, never themed except where the dark step differs */
  --color-good:     #0CA30C;  --color-good-ink:     #006300;
  --color-warning:  #FAB219;  --color-warning-ink:  #7A4A00;
  --color-serious:  #EC835A;  --color-serious-ink:  #8A3B12;
  --color-critical: #D03B3B;  --color-critical-ink: #B3231F;

  --spacing-tap: 44px;
  --radius-sm: 8px;  --radius-md: 18px;  --radius-lg: 20px;

  /* Tactile Ops Phase 3: introduces --font-sans (did not exist before this
     phase), overriding Tailwind's own default and — via --default-font-family
     in Tailwind's preflight.css — the whole app's body font in one line. */
  --font-sans: "Sora", ui-sans-serif, system-ui, sans-serif;

  /* Tactile Ops Phase 2 */
  --shadow-card: 0 10px 26px -14px rgb(21 26 34 / 28%);
  --shadow-sheet: 0 -8px 24px -10px rgb(21 26 34 / 25%);
  --shadow-btn-primary: 0 8px 16px -6px rgb(15 46 99 / 45%);
  /* dark mode overrides: --shadow-card 0 10px 26px -14px rgb(0 0 0 / 55%);
     --shadow-sheet 0 -8px 24px -10px rgb(0 0 0 / 50%);
     --shadow-btn-primary 0 4px 10px -4px rgb(30 58 110 / 35%) —
     a light-based/full-opacity shadow reads as a smudge or a halo on a near-black ground */

  --text-hero: 2.25rem;      --text-hero--line-height: 2.5rem;
  --text-title-lg: 1.375rem; --text-title-lg--line-height: 1.75rem;
  --text-title: 1.125rem;    --text-title--line-height: 1.5rem;
  --text-body: 1rem;         --text-body--line-height: 1.5rem;
  --text-body-sm: .875rem;   --text-body-sm--line-height: 1.25rem;
  --text-label: .8125rem;    --text-label--line-height: 1rem;
  --text-caption: .75rem;    --text-caption--line-height: 1rem;

  --ease-micro: 120ms cubic-bezier(0,0,.2,1);
  --ease-enter: 200ms cubic-bezier(0,0,.2,1);
  --ease-exit:  160ms cubic-bezier(.4,0,1,1);
}

/* 3 — dark. Two selectors, identical bodies: the media query covers the OS
   setting, the attribute covers the in-app toggle, and the :not() guard lets a
   manual light choice beat OS dark. */
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) {
  --color-page:var(--d-page); --color-surface:var(--d-surface);
  --color-ink-primary:var(--d-ink1); --color-ink-secondary:var(--d-ink2);
  --color-ink-muted:var(--d-ink3); --color-ink-faint:var(--d-faint);
  --color-line-hairline:var(--d-hair); --color-line-strong:var(--d-strong);
  --color-surface-sunken:var(--d-surface-sunken);
  --color-brand:var(--d-brand); --color-brand-ink:var(--d-brandink);
  --color-brand-wash:var(--d-wash); --color-focus-ring:var(--d-brandink);
  --color-direction-payable:var(--d-payable);
  --color-good:#3FBF57; --color-good-ink:#3FBF57;
  --color-warning-ink:#FAB219; --color-serious-ink:#EC835A;
  --color-critical:#F0736F; --color-critical-ink:#F0736F;
} }
:root[data-theme="dark"] {
  --color-page:var(--d-page); --color-surface:var(--d-surface);
  --color-ink-primary:var(--d-ink1); --color-ink-secondary:var(--d-ink2);
  --color-ink-muted:var(--d-ink3); --color-ink-faint:var(--d-faint);
  --color-line-hairline:var(--d-hair); --color-line-strong:var(--d-strong);
  --color-surface-sunken:var(--d-surface-sunken);
  --color-brand:var(--d-brand); --color-brand-ink:var(--d-brandink);
  --color-brand-wash:var(--d-wash); --color-focus-ring:var(--d-brandink);
  --color-direction-payable:var(--d-payable);
  --color-good:#3FBF57; --color-good-ink:#3FBF57;
  --color-warning-ink:#FAB219; --color-serious-ink:#EC835A;
  --color-critical:#F0736F; --color-critical-ink:#F0736F;
}

:lang(si) { font-family:"Noto Sans Sinhala",system-ui,sans-serif; line-height:1.72; }
:lang(ta) { font-family:"Noto Sans Tamil",system-ui,sans-serif;   line-height:1.72; }
```

Two notes a reader will otherwise trip on. The two dark blocks are byte-identical by design — extract them into a PostCSS mixin or a build step if you prefer, but **never let one be edited without the other**; a lint rule comparing them is cheaper than the bug. And there is deliberately no `[data-theme="light"]` block: light values are the `:root` defaults, and the `:not([data-theme="light"])` guard is what lets a manual light choice beat OS dark.

### 12.4 Capability gating (M-22)

```ts
// lib/capabilities.ts — mirrors W-49 exactly, one entry per row of the matrix
export const can = (role: Role, cap: Capability): boolean => MATRIX[role][cap];
```

```tsx
<Can cap="writeOff">           {/* absent for a manager   */}
  <Button variant="danger">Write off…</Button>
</Can>

<Button disabled={hasOpenTrip} reason="Trip #21 is still open">
  Close July permanently
</Button>                       {/* present, disabled, reason shown */}
```

The client copy of the matrix is **convenience only**. Every capability is re-checked in the Worker, and the driver boundary is enforced by `driver_id` scoping in the data layer (TS §2), never by the client.

### 12.5 PWA scope

Installable, offline-capable, and deliberately modest about it:

- Precache the shell and the design layer. Runtime-cache API reads with `stale-while-revalidate`; money reads get a short TTL and always revalidate.
- Writes go through Query's mutation queue, persisted, replayed on reconnect (M-12).
- **No background sync** — iOS does not have it, so the app never promises delivery while closed.
- Storage is treated as evictable. The app warns while the queue is non-empty, and the queue is never the only copy of a money record.
- iOS install has no prompt; a one-time "Add to Home Screen" hint on iOS Safari, dismissible forever.
- **The manifest itself lives in `brand-guidelines.md` §5.2**, with the icon set, because `theme_color`, `background_color` and the icons are identity decisions rather than layout ones. Two rules from here bind it: `background_color` is `--color-page` and never the brand colour — Android generates its splash from it, and a blue splash into a light-grey app is a visible flash on every cold start — and `orientation` is left unset per M-26.

### 12.6 The tests that encode the rules

| Test | Rule |
|---|---|
| **Every create form saves with level-1 fields only** — iterate the form registry, fill level 1, assert a successful write | U-2 / M-6. The flows document asks for this explicitly (FL §7) |
| Every interactive element ≥ 44 × 44 in a mobile-viewport Playwright pass | §4.3, SC 2.5.8 |
| No horizontal body scroll at 320px on every route | SC 1.4.10 |
| Focused field never intersects the sticky action bar | SC 2.4.11 |
| axe-core clean on every route, light and dark | §10 |
| `Number` never applied to a money value — lint rule on the money codec's types | §8.1 |
| Every report renders `NotAvailable`, not `0`, against the empty and partial fixtures | W-56 / M-13 |
| Reserved-vocabulary lint over `i18n/en.json` — the banned-word list from §9.6 | U-6 / M-25 |
| The §7.1–7.3 golden fixtures render their exact figures on screen | The regression suite already exists; the UI should assert against it too |
| A file calling `useQuery(` also references `useQueryState`/`QueryState`, or carries a reasoned `-- allow:` exemption — `scripts/check-forbidden.mjs`, in the `PostToolUse` hook | M-28. GAP-101 shipped inside a session that gate-passed twice, because a screen with no error branch passes every test that only mocks success — the lint rule is the mechanism that keeps the next screen from doing the same |

---

## 13. Performance budget

Measured on a mid-range Android over 4G — a Moto G-class device, not a flagship.

| Metric | Budget |
|---|---|
| LCP (home, warm cache) | < 1.5s |
| LCP (home, cold) | < 2.5s |
| INP | < 200ms |
| CLS | < 0.05 — the day card must not shift after load |
| Initial JS (gzip) | ≤ 180KB |
| Reports chunk | ≤ 120KB, lazy |
| Fonts | System sans only for `en`; Sinhala subset ≤ 60KB, `swap`, loaded on demand |
| Images | Photos are compressed client-side before upload; thumbnails served from R2, never full-size in lists |
| Day-card tap → visible state change | < 100ms, offline included (optimistic) |

The budget is a CI gate, not an aspiration. A PR that exceeds it fails.

---

## 14. Desktop and the analytical dashboard

Desktop is the same application at `lg` and `xl`. Three changes, no more:

1. **The tab bar becomes a persistent left rail** with the same destinations in the same order.
2. **List screens become two-pane** — list left, detail right — which is why routes are already `/people/drivers/:id` rather than nested state.
3. **Reports gain their full form**: the mobile card view becomes a real table with sortable columns, more series per chart, small multiples across vehicles, and side-by-side month comparison.

The 14 August 2026 QA pass makes the failure case concrete: a 1280px Home viewport still rendered the bottom tab bar and 1200px-wide mobile rows. That is not an acceptable desktop interpretation of this section. Until the analytical dashboard exists, `lg` still must at minimum render the left rail, constrain single-column content to a readable measure, and use a supporting-pane layout where a screen naturally has primary and secondary work.

| Screen shape | `lg` treatment |
|---|---|
| Home / cockpit | Left rail. Primary pane for alerts and today's work; secondary pane for rent due, trips and deposits. If content is sparse, constrain the stack rather than stretching rows. |
| List + detail | Two panes, list left and selected/detail route right. The URL remains the source of truth; resizing back to mobile shows the active pane only. |
| Forms and sheets | Forms stay one column with a readable max width. Quick Add opens the same action list in a 420px centred sheet, per §3.1. |
| Reports | Tables and charts may sit side by side, but every figure remains present on mobile in the narrower form. |

The analytical dashboard is the *only* screen in the product designed desktop-first, and it is additive: everything on it exists on mobile in a narrower form. A number that appears only on desktop is a number the owner-manager cannot check while standing next to the vehicle it concerns.

Print stylesheets matter more than usual here: the driver's slip (UC-57), the customer statement (UC-19) and the export (UC-99) all end up on paper or in a PDF, and all three are evidence in an argument three months later.

---

## 15. Phasing

Aligned with UC §9.1. The design work that must exist before a flow can be built:

| Phase | UI deliverables |
|---|---|
| **First** | Tokens and the design layer · `AppShell` + the Operate tab bar · `DayCard`, `AmountPad`, `MoneyField`, `AllocationPreview`, `TwoBalances` · home stack · F-2, F-3, F-4, F-5, F-6, F-7 screens · vehicle calendar · period close · `PhotoCapture` · offline queue · Review shell · phase-1 reports · **M-31 visual refresh across auth, Home, all phase-1 routes and the §14 desktop baseline** |
| **Second** | Write-off and post-closure flows · ageing and utilisation reports · **Mine shell** · export · side-by-side condition comparison · Sinhala localisation pass |
| **Third** | Desktop analytical dashboard beyond §14's three changes · depreciation and disposal screens · offline capture of photos |
| **Last** | Message log and failure strips — WhatsApp dispatch is sequenced last (UC §9.1) |

**Build order within phase one is not arbitrary.** The tokens and the five load-bearing components come first, because every screen after them is assembly. The day card is the first *screen*, because it is the one that proves U-1 is achievable — and if it is not, that is worth knowing in week two rather than month four.

---

## 16. What is still open

**The second language is closed: Sinhala**, chosen by the owner on 31 July 2026. `Noto Sans Sinhala` is the subset that ships and `:lang(si)` is the rule that matters. The `:lang(ta)` row in §5.2 and §12.3 stays — it costs two lines, it documents that the line-height rule is about South-Asian glyph extents rather than about Sinhala specifically, and removing it would have to be undone the first time a Tamil-speaking customer appears.

**Brand identity is now closed too — M-34 (21 Aug 2026).** This section used to read: *"the brand blue is the validated chart palette, so the two are one system — a different colour must be re-validated against the surfaces, the palette is not a matter of taste, it is a script that passes or fails."* That is exactly what happened: the owner-manager found the shipped system generic, a new accent was chosen, and it was run through `dataviz`'s `validate_palette.js` against every surface and against `--color-direction-payable` before it shipped — §5.1 carries the numbers. The one open sub-question that decision surfaced: dark mode cannot clear the strict swatch-alone distinguishability bar against `--d-payable` within the rust hue family, at any lightness dark mode's surfaces require. §5.1 records the accepted trade-off; a future reviewer who wants a cleaner separation there should read that note before proposing a third hex.

One remaining item is blocking nothing and is mine to have proposed rather than yours to have chosen:

| | |
|---|---|
| **The `＋` quick-add set** (M-4) | I chose fuel, expense, payment received, payment made, new trip. Worth a week of real use before fixing it |

---

## 17. What changed in v1.1

An independent review walked v1.0 against the companion documents and the stated mobile constraints. Twenty-six findings; **twenty-three were adopted**, two were adopted with a different fix, and one was rejected on a point of fact. Recorded here on the same principle FL §14 uses — a review is only absorbed if what was *not* taken is written down with the reason.

### Adopted as recommended

| Finding | Fix |
|---|---|
| Ambiguous `§` references — three documents have a §6 about different things | §0 now fixes a citation prefix (`UC` / `FL` / `DM` / `TS`); every cross-document reference carries one |
| `--serious` defined but absent from the code block | Present, with its dark step and its ink pair |
| The dark-mode toggle block was **empty** | §12.3 restructured: hex values live once as palette constants, two mode blocks remap onto them |
| No error-state visual spec | `FieldError` in §6.3, including the reserved 20px message slot and the scroll target that keeps a focused error clear of the sticky action |
| `#EB6834` used as a raw hex, breaking the document's own token rule | `--color-direction-payable`, matched to chart slot 2 in both modes |
| Owner-manager shell unspecified | §3.1 — Operate, with Review under **More → My share**. No sixth tab, no mode switch |
| `AmountPad` keyboard suppression unspecified | §6.2 — non-focusable `div role="textbox"`, and `keyboard-inset-height` explicitly does not apply |
| Photo pipeline had a target but no bounds | §6.3 — JPEG 0.75, 200KB hard cap with re-encode ladder, Web Worker with a 3s timeout, record saves before photos finish |
| Android edge-gesture conflict | M-23 — no horizontal swipe originates within 24dp of either edge |
| Bulk-confirm scroll strategy | §7.2 — list scrolls, summary and action sticky, `⋯` opens a sheet rather than expanding inline |
| Multi-vehicle home stack | §3.2 — 1 elevated, 2–3 stacked, 4+ collapses to a summary row |
| No touch-feedback spec | §5.3 — `:active` per element class, and haptics Android-only on money writes |
| `en-LK` locale reliability | §8.1 — `['en-LK','en']` fallback chain, formatter hoisted, and a test asserting `1,234,567.89` rather than the South Asian grouping |
| Offline banner undefined | `OfflineBanner` in §6.4 — 32px, below the app bar, inside the height calculation |
| Tamil line-height | §5.2 and §12.3 now carry `:lang(ta)`; §16's claim that Tamil changes "nothing structural" was wrong and is corrected |
| Sparkline, first-load, truncation, `Provisional` cost, quick-add at other sizes, manifest location, void rendering in `Timeline`, client-never-touches-the-DB | All added at the sections named |

### Adopted, but fixed differently

**Token naming.** The review found §5.1 and §12.3 using two different names for the same values — correct, and it matters. Its recommended fix was to rename the code block to match the spec table (`--bg-page`, `--ink-primary`). **That would have broken the build.** Tailwind v4's `@theme` is namespaced: only `--color-*` generates colour utilities, so `--ink-primary` would have produced no `text-ink-primary` class and failed silently — the worst possible failure for a token system. Unified the other way instead, onto `--color-ink-primary`, which keeps both the semantics and the namespace. §5.1 now states why the prefix is not negotiable.

**Landscape orientation.** The review proposed locking phase-1 flows to portrait via the manifest. Rejected as written on two grounds: **WCAG 2.1 SC 1.3.4** forbids restricting content to a single orientation unless it is essential, and `orientation` in the manifest is ignored outside standalone mode and on iOS — so the lock would fail the audit *and* not work. M-26 makes landscape supported instead, with the chrome giving back 24px.

### Rejected

**Restating UC §6.6–§6.8 inside this document.** The review's preferred fix for the reference ambiguity was to summarise those cross-cutting rules here. Declined: it creates a second copy of a rule that must stay in sync with the first, and every document in this repository is built on single-sourcing with traceability instead. Prefixed references solve the same problem without the duplicate. Recorded because it is a reasonable position and the next reviewer may raise it again.

### One correction the review got right about a measured value

§5.1 published `--color-ink-faint` at **3.5 : 1 in both modes**. Re-measured: `#898781` on the dark surface `#141413` is **5.13 : 1**. The dark figure had been assumed rather than measured, in a table whose entire value is that the numbers are measured. Corrected, and the lesson is the obvious one — a table of measurements is only trustworthy if every cell was actually measured, including the ones that look like they should match.

---

## 18. Change control

Same rule as the companion documents. **This document travels with them.** A change to a flow that alters what a screen must do is a change here; a change here that alters what a flow means is not allowed — the flow changes first.

The traceability that keeps that honest:

| Section here | Governed by |
|---|---|
| §3 navigation | FL §7 screen-to-flow map, U-1, U-4 |
| §6 components | U-2, U-3, UC §6.5, UC §6.8, W-2, W-48 |
| §7 flow specs | F-0 … F-10 |
| §8 money | W-54, INV-20, `tech-stack.md` §6 |
| §9.6 vocabulary | FL §1.5, U-6 |
| §11 reports | UC-70…UC-79, W-56 |
| §12.4 capabilities | W-49, FL §2.3 |

---

## Sources

Research consulted July 2026. Platform behaviour moves; re-check the PWA and viewport entries before relying on them.

- WCAG 2.2 SC 2.5.8 Target Size — [wcag.com](https://www.wcag.com/developers/2-5-8-target-size-minimum-level-aa/), [Appt](https://appt.org/en/guidelines/wcag/success-criterion-2-5-8)
- Thumb zones and one-handed use — [Parachute Design](https://parachutedesign.ca/blog/thumb-zone-ux/), [Upslide](https://upslidedesignstudio.com/blogs/one-handed-mobile-ux-design-best-practices-for-better-mobile-apps)
- Fintech mobile UX patterns — [ProCreator](https://procreator.design/blog/best-fintech-ux-practices-for-mobile-apps/), [Eleken](https://www.eleken.co/blog-posts/fintech-ux-best-practices)
- Money and numeric input — [CSS-Tricks on `inputmode`](https://css-tricks.com/finger-friendly-numerical-inputs-with-inputmode/), [UX Patterns currency input](https://uxpatterns.dev/patterns/forms/currency-input)
- Form design — [Design Studio](https://www.designstudiouiux.com/blog/form-ux-design-best-practices/), [Static Forms](https://www.staticforms.dev/blog/form-ux-best-practices)
- Responsive tables and card views — [Setproduct](https://www.setproduct.com/blog/data-table-ui-design), [Smashing Magazine](https://www.smashingmagazine.com/2022/12/accessible-front-end-patterns-responsive-tables-part1/)
- Viewport, `dvh` and the virtual keyboard — [OpenReplay](https://blog.openreplay.com/fix-100vh-mobile-viewport/), [Bram.us](https://www.bram.us/2021/09/13/prevent-items-from-being-hidden-underneath-the-virtual-keyboard-by-means-of-the-virtualkeyboard-api/)
- iOS PWA limits and camera — [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [STRICH on iOS PWA camera](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa)
- Offline mutations — [TanStack Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- React component libraries — [Builder.io](https://www.builder.io/blog/react-component-libraries-2026), [Untitled UI](https://www.untitledui.com/blog/react-component-libraries)
- Date pickers — [OpenReplay](https://blog.openreplay.com/custom-date-picker/), [Adrian Roselli](https://adrianroselli.com/2019/07/maybe-you-dont-need-a-date-picker.html)
- Gesture accessibility — [LogRocket](https://blog.logrocket.com/ux-design/accessible-swipe-contextual-action-triggers/), [NN/g](https://www.nngroup.com/articles/contextual-swipe/)
- Colour-blind safe palettes — [Tableau](https://www.tableau.com/blog/examining-data-viz-rules-dont-use-red-green-together), [Venngage](https://venngage.com/blog/color-blind-friendly-palette/)
- Multilingual typography — [Material language support](https://m2.material.io/design/typography/language-support.html), [Noto Sans Sinhala](https://fonts.google.com/noto/specimen/Noto+Sans+Sinhala)
- Sri Lanka device and network context — [ikman buying guide](https://blog.ikman.lk/en/mobile-phone-buying-guide-sri-lanka/), [Lanka Websites 2026](https://lankawebsites.com/blog/mobile-gadgets/best-phone-in-sri-lanka-under-50000-2026)
- 2026 platform design refresh references for M-31 — [Apple HIG design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles), [Apple HIG colour](https://developer.apple.com/design/human-interface-guidelines/color), [Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Material 3 theming and roles](https://developer.android.com/codelabs/m3-design-theming), [Material 3 adaptive layout](https://developer.android.com/develop/adaptive-apps/guides/get-started-with-adaptive-apps), [WCAG 2.2 new criteria](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)

Palette figures in §5.1 and §11.2 are measured, not estimated: contrast ratios computed against the surfaces in §5.1, and the categorical order run through the data-viz validator against those same surfaces.
