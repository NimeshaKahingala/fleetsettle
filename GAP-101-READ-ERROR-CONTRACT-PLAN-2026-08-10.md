# GAP-101 · The read-error contract — implementation plan

**Date:** 10 August 2026 · **Branch:** `build/p0-foundation` (this queue) · **Item:** F2's client half, and the largest single thing inside B9
**Owning documents:** `docs/design/ui-ux-guidelines.md` (UI §6.4, §9.5, §11.4) — the doc-change goes first
**Status:** planned and decided, not started

---

## 0. What this item is

`TRACKER.md` GAP-101 and `Plan.md` row 12c/13 both name the same thing: **the client has no contract for a read that fails.** `Plan.md` 12c settles the sequencing — F2's server half shipped 9 Aug (the revoked-member 500), and its client half was deliberately *not* fixed on the one screen, because fixing one screen of thirty-two twice is not sequencing, it is churn. This is that client half, done as a shared primitive.

Every claim below was checked against source on 10 August 2026. Where the tracker's own figures turned out to be wrong, §2 says so.

---

## 1. What is actually broken — three failure modes, not one

GAP-101 is written as "a failed fetch renders as `Loading…` forever." That is the mode it was found through, and it is the *least* harmful of the three that are actually present.

### Mode 1 — the eternal spinner

```tsx
if (query.data === undefined) return <p>Loading…</p>;
```

`data` stays `undefined` on error as surely as it does while pending, so the guard cannot tell them apart. **17 screens**, including all six reports and all four Review tabs. A 401, 403, 404, 500 or dropped connection is indistinguishable from a slow network, forever.

Dishonest, but only by omission: nothing false is asserted.

### Mode 2 — the false empty, and the false zero

```tsx
const rentDue = (receivablesQuery.data ?? []).filter(…);
```

`?? []` collapses "the read failed" into "there is nothing." This is a **W-56 violation in the strict sense** — a confident wrong impression where an admitted gap was required — and it is worse than Mode 1, because the screen makes a claim.

The flagship is [HomeScreen.tsx:134-152](web/src/features/home/HomeScreen.tsx#L134-L152). It runs **six** queries, guards **none** of them, and folds all six into one boolean:

```tsx
const anySectionHasContent = paperworkWarnings.length > 0 || … ;
{!anySectionHasContent ? <EmptyState message="Nothing needs you today" /> : null}
```

If the Worker is down, or the token is stale, or the connection drops, Home tells the manager **"Nothing needs you today"** while rent is overdue, a lease is unconfirmed and insurance has expired. U-4 makes Home the single place urgency lives; this makes Home lie about it. `PeopleListScreen` does the same in numeric form — `count={drivers?.length ?? 0}` renders a confident **0**.

### Mode 3 — the silently disabled safety warning

The sharpest instance in the codebase, and named nowhere:

```tsx
// StartLeaseScreen.tsx:145, BookTripScreen.tsx:128
const vehicleWarning = (paperworkWarningsQuery.data ?? []).find(
  (row) => row.subjectType === "vehicle" && row.subjectId === vehicleId,
);
```

UI §7.4 puts that `AlertStrip` **above the primary action** on the longest form in the product, and M-27's own rationale names it as the reason F-2.1 is a route and not a sheet — *"F-10.1's `AlertStrip` warning, specified as sitting above the primary action, would often sit below the fold."* The document argued about where the warning sits. **A failed read removes it entirely**, on both the start-a-rental and book-a-trip screens, and the form proceeds to its confirm button with nothing shown.

`VehicleCalendarScreen.tsx:119` is the same shape against INV-1: `new Map((days ?? []).map(…))` on a failed read renders **every day of the month as free**, on the screen whose entire job is to stop a double-booking.

**These three modes are one defect with one cause** — there is no place in the client where "this read did not succeed" is a state a component can be in. That is why the fix is a primitive and not thirty-two patches.

---

## 2. Corrections to GAP-101's own figures

The tracker row says **"50 of its 52 query-using screens."** Verified against source, that figure is built on a grep that counts every file importing anything from `@tanstack/react-query`:

| Measure | Tracker | Actual (10 Aug 2026) |
|---|---|---|
| Files importing from `react-query`, non-test | 52 | **59** |
| …of which contain a real `useQuery({` call | (assumed all) | **32** |
| …the other 27 | — | `useQueryClient` for post-mutation invalidation only, plus `App.tsx`/`main.tsx`. **No read to guard.** |
| `useQuery` **call sites** | — | **83** |
| Call sites branching on `isError` | 2 | **2** — `FirstRunGate`'s `meQuery`, `CloseMonthScreen`'s `checklistQuery` |

**So: 30 of 32 files, and 81 of 83 call sites.** Narrower than "50 screens" by file, and considerably worse by call site. The tracker's underlying point — *mutation* error handling is genuinely good and everywhere, which is exactly what hid this — survives intact; those 27 mutation-only files are the evidence for it, not for the defect.

**Action:** correct the GAP-101 row in `TRACKER.md` §4 and the tenth-pass entry in §6 item 24 to the verified figures, and add Modes 2 and 3 to the row. The row currently under-states the harm and over-states the surface.

---

## 3. Two things that must be settled before the primitive is written

### 3.1 `enabled:` is used at 23 call sites — a disabled query is pending forever

`enabled: current !== undefined` appears at 23 sites ([`ReviewThisMonthScreen`](web/src/features/review/ReviewThisMonthScreen.tsx#L89) ×3, [`BookTripScreen`](web/src/features/trips/BookTripScreen.tsx#L110) ×2, [`CloseLeaseScreen`](web/src/features/leases/CloseLeaseScreen.tsx#L102) ×3, the four sheet pickers gated on `open`, and others).

In TanStack Query v5 a disabled query sits in `status: "pending"` with `fetchStatus: "idle"` **indefinitely**. A primitive that keys on `isPending` alone would render "Loading…" forever for a query that was never asked — **reproducing the exact bug it exists to close, in a new place, on the ten screens with the most queries.**

The primitive must therefore distinguish four states, not three:

| State | Test | Renders |
|---|---|---|
| `idle` | `isPending && fetchStatus === "idle"` | **nothing** — the caller's own precondition copy, not a spinner |
| `pending` | `isPending && fetchStatus !== "idle"` | §9.5's loading treatment |
| `error` | `isError` | §4.3's failure block |
| `ready` | `isSuccess` | the caller's children, `data` narrowed non-`undefined` |

This is the single most likely way to get this item wrong, so it gets its own test in the primitive's suite and its own line in the doc-change.

### 3.2 The real `QueryClient` retries three times before `isError` is ever true

[main.tsx:38](web/src/main.tsx#L38) constructs the `QueryClient` with a `queryCache.onError` handler and **no `retry` override**, so v5's default applies: 3 retries, exponential backoff. A 403 or 404 — deterministic, will never succeed on retry — therefore spends roughly **seven seconds** in `isPending` before `isError` turns true.

`FirstRunGate` already discovered this and set `retry: false` locally, recording the reason in its own comment: *"would otherwise leave the very first screen on 'Loading…' for several seconds before ever showing either state."* Shipping the error branch without fixing this ships a slower spinner.

**Recommended:** a default `retry` predicate on the `QueryClient`, in one place:

```ts
retry: (failureCount, err) =>
  !(err instanceof ApiError && err.status >= 400 && err.status < 500) && failureCount < 3,
```

A 4xx `ApiError` is a decided answer — retrying it is a request the server has already refused. 5xx and network failures keep the default ladder, because those genuinely do fix themselves. `FirstRunGate`'s local `retry: false` then becomes redundant and can be removed with a note, or kept — see §9, decision 4.

---

## 4. The primitive

### 4.1 Shape: a hook *and* a component, the component built on the hook

Ten of the 32 files run 4–6 queries. A render-prop component alone forces either nesting four deep or a tuple generic that TypeScript narrows badly. So:

**`web/src/lib/useQueryState.ts`**

```ts
export type QueryState<T> =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; error: unknown; retry: () => void }
  | { kind: "ready"; data: T };

export function useQueryState<T>(query: UseQueryResult<T>): QueryState<T>;
export function combineQueryStates(...states: QueryState<unknown>[]): { kind: "idle" | "pending" | "error" | "ready"; … };
```

`combineQueryStates` resolves by precedence: **any `error` → error** (with a combined `retry` that refetches every failed member), else any `pending` → pending, else any `idle` → idle, else ready. Error wins over pending deliberately: a screen with one failed read and one still loading has already failed, and saying so at once beats saying so after the slower one lands.

**`web/src/components/QueryState.tsx`**

```tsx
<QueryState query={q} of="the cash position">
  {(data) => …}
</QueryState>
```

Covers the 22 single-query files as a one-line change each. `of` is the noun that goes into the failure sentence and the `aria-label` — mandatory, exactly as `NotAvailable`'s `reason` is mandatory and for the same reason: there is no bare failure message.

### 4.2 Where it sits — a sibling of `EmptyState`, not of `AlertStrip`

The obvious shortcut is to render failures through the existing `AlertStrip`. **Declined.** UI §3.2 is explicit that alert strips *"are not cards; they must not be mistaken for work"* — they are Home's items 1–2, the urgency channel. A read that failed is not work the manager can do; putting it in the same visual language as an expired insurance certificate devalues the channel that M-9 exists to protect.

A failed read is `EmptyState`'s sibling: the same centred block, the same `--color-ink-secondary` sentence, plus an icon and a **Try again** button. Colour never carries the meaning alone — the icon and the sentence do (UI §10).

### 4.3 Copy — status-mapped, and inside the vocabulary lock

`api.get` throws `ApiError` carrying `status`, `code` and `requestId` ([lib/api.ts:12](web/src/lib/api.ts#L12)), so the sentence can be specific rather than generic:

| Status | Sentence | Action |
|---|---|---|
| 401 | "You've been signed out." | **Sign in** |
| 403 | "You don't have access to {of}." | none |
| 404 | "{of} isn't here any more." | none |
| 409, other 4xx | "{of} couldn't be loaded." + `code` | **Try again** |
| 5xx | "Something went wrong loading {of}." | **Try again** |
| not an `ApiError` (network, token getter) | "Couldn't reach the server. Check your connection." | **Try again** |

The `requestId` renders as a `caption` under the sentence on 5xx only — it is the one string that makes a support conversation possible, and it is meaningless noise on a 404.

No accounting vocabulary, no "request failed", no status numbers in the sentence itself (U-6, FL §1.5, §9.6). **The `of` noun must come from the reserved vocabulary where one applies** — "the daily lease amount", never "the rate".

### 4.4 Mode 2 needs more than a wrapper

`<QueryState>` fixes Mode 1 mechanically. Modes 2 and 3 are `?? []` **inside a derived value**, and a wrapper does not reach them. Those call sites need the fallback deleted and the failure hoisted:

- **`HomeScreen`** — combine all six, and on error render the failure block **instead of** `EmptyState`. "Nothing needs you today" must be unreachable while any of the six is not `ready`. This is the single most important line in the item.
- **`StartLeaseScreen` / `BookTripScreen`** — the paperwork query cannot be allowed to fail silently. Recommended: on error, render an `AlertStrip severity="warning"` reading *"Couldn't check this vehicle's paperwork"* in the slot the real warning would occupy. Absent-because-clear and absent-because-unknown must not look the same on the screen where UI §7.4 put the warning above the primary action.
- **`VehicleCalendarScreen`** — on error the grid must not render. A calendar of uniformly-free days is a claim about INV-1 the client cannot make.
- **The six picker sheets** (`RecordExpense`, `FuelFill`, `QuickAdd`, `AddOpeningBalanceEntry`, `StartDailyLease`, `CorrectPayment`) — an empty picker reads as "you have no vehicles". `EntityPicker` needs a failure state, or the sheet blocks with the failure block. Decision 3 below.

---

## 5. The doc-change — this goes first

Per CLAUDE.md ("documents travel together") and the `doc-change` skill, `docs/design/ui-ux-guidelines.md` moves before the code. **The silence in that document is why GAP-101 was buildable**: §9.5 "Loading" specifies cache-first, skeletons and a 300ms spinner threshold, and says nothing whatever about a read that does not arrive. Every screen author followed the spec exactly.

| Section | Change |
|---|---|
| **§2 decisions log** | New rule, ⚑ (decided here, not by the user): **M-28 — every read has three visible outcomes: data, a real nothing, or a stated failure.** A screen that can only render "loading" and "data" is unfinished. Rationale column cites W-56 and this gap. |
| **§6.4 Display** | New `QueryState` row, beside `EmptyState` and `NotAvailable`, carrying the four states, the mandatory `of` noun, and the `idle ≠ pending` rule from §3.1 |
| **§9.5 Loading** | Renamed **§9.5 Loading and failing**. Adds the status→copy table (§4.3), the "Try again" affordance, and the explicit prohibition: **a fallback that turns a failed read into an empty list or a zero is forbidden** (this is the sentence that would have prevented HomeScreen) |
| **§11.4** | One cross-reference: the chart case already says `NotAvailable` in place of the mark; note that a *failed* read is `QueryState`'s error block, not `NotAvailable` — `NotAvailable` means "this number does not exist", not "we could not ask" |
| **§12.6** | Add the guard from §7 to the list of tests that encode the rules |
| Status line + `docs/README.md` | Bump to **v1.2.5**, date, one-line reason |

No other document changes. This is presentation of a failure, which UI §0's ownership table puts squarely here; nothing about the API contract, the data model or the flows moves.

---

## 6. Migration, in waves

32 files. One commit touching all of them is unreviewable, so it splits by **failure mode**, worst first — which is also the order in which each wave stands alone as a shipped improvement.

| Wave | Files | What |
|---|---|---|
| **W0** | 3 + docs | The doc-change · `useQueryState.ts` + `QueryState.tsx` + their tests · the `retry` predicate in `main.tsx` |
| **W1 — the lies** | 10 | `HomeScreen`, `PeopleListScreen`, `StartLeaseScreen`, `BookTripScreen`, `VehicleCalendarScreen`, `OpeningBalanceScreen`, and the four picker sheets that render an empty list on failure. **Every `?? []` and `?? 0` fed by a query is deleted or justified.** |
| **W2 — the spinners, money-facing** | 11 | The six report screens, the four Review screens, `ReviewMoneyScreen` included — this is where F2's client half formally closes — plus `DriverDetailScreen` |
| **W3 — the spinners, the rest** | 8 | `IncidentScreen`, `CloseLeaseScreen`, `LeaseHubScreen`, `TripDetailScreen`, `VehicleListScreen`, `VehicleOverviewScreen`, `ConfirmDayCard`, `StartDailyLeaseScreen` |
| **W4** | 3 | The guard (§7) · `FirstRunGate` and `CloseMonthScreen` adopt the primitive, retiring both hand-rolled branches · `TRACKER.md`/`Plan.md` |

W1 before W2 is not the tracker's order and is deliberate: **a screen that says "nothing is owed to you" when it does not know is a worse product than a screen that says nothing at all**, and Mode 2 is the one no review has named yet.

---

## 7. The guard — the part that keeps it closed

GAP-101's own post-mortem is the reason this section exists: *"a screen with no error branch passes every test that only ever mocks success, which is what all of them did."* Eight of the nine screens the audit named were built, gate-green and reviewed twice **in the session that shipped the defect**. A fix without a mechanism gets undone by the next screen.

**Recommended: a rule in `scripts/check-forbidden.mjs`** — a file containing `useQuery({` must also reference `useQueryState`, `QueryState` or carry `-- allow: <reason>`. That script is already the home for "the rules ESLint cannot see", is already wired into the `PostToolUse` hook so it blocks at the moment the file is written rather than in CI, and already takes the inline reasoned exemption CLAUDE.md prefers over deleting a rule. IG §16's table gains a row.

A second, narrower rule is worth having and is cheap: **`?? []` or `?? 0` on the same line as `.data`** is the Mode-2 signature, and it has no legitimate use once the primitive exists.

---

## 8. Tests

**The primitive** (`QueryState.test.tsx`, `useQueryState.test.ts`) — one test per state, and specifically:
- a **disabled** query renders nothing, not "Loading…" (§3.1 — the trap)
- each status in §4.3's table renders its own sentence
- **Try again** calls `refetch`
- `combineQueryStates` returns `error` when one of three has failed and another is still pending

**Per migrated file** — one test each, all in the same shape, since `renderWithProviders` already sets `retry: false`:

```tsx
const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
renderWithProviders(<Screen … />, { get });
expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
```

**Three that carry their own assertion beyond the shape:**
- `HomeScreen` — `expect(screen.queryByText("Nothing needs you today")).not.toBeInTheDocument()` when any of the six rejects. This is the test the item exists for.
- `StartLeaseScreen` / `BookTripScreen` — a failed paperwork read renders the "couldn't check" strip, so absent-because-clear and absent-because-unknown are distinguishable.
- `VehicleCalendarScreen` — a failed calendar read renders no day cells at all.

Roughly **35 new web tests**, against the current 418.

---

## 9. Decisions — confirmed 10 August 2026

All five taken as recommended, by the user, before implementation starts:

1. **Wave order — W1 (the lies) before W2 (the money-facing spinners).** Confirmed. A screen asserting a false fact outranks one that only spins; §6's wave table stands as written.
2. **`retry` changes here, not separately.** Confirmed. The predicate in §3.2 ships in W0, in `main.tsx`.
3. **The six picker sheets fail in place.** Confirmed. `EntityPicker` gains its own failure state (§4.4); the rest of each sheet stays usable while one picker's read has failed.
4. **`FirstRunGate`'s local `retry: false` is removed**, once the global predicate (decision 2) lands — its 404 case is already covered, and removing it leaves one statement of the retry policy instead of two to keep in sync. Part of W4.
5. **A failed read gets its own treatment, not `NotAvailable`.** Confirmed. `QueryState`'s error block is a distinct primitive, per §4.2/§5's §11.4 row — "this number does not exist" and "we could not ask" stay two different facts on screen.

No open decisions remain. §11's order of work is ready to execute as written.

---

## 10. Out of scope

- **B9's other seven items** — GAP-44, 45, 46, 47, 48, 55, 83, and the three added 9 Aug (GAP-89, 96, 97). GAP-101 is the largest thing in B9 and is separable; the rest stay in B9's own sitting.
- **Offline and the write queue** (M-12, §9.4) — a queued *write* is `SyncChip`'s job and is unrelated to a failed *read*. Nothing here touches it.
- **Mutation error handling** — already good everywhere, and the 27 mutation-only files are the evidence. Untouched.
- **Skeletons** (§9.5's first bullet) — the loading half of §9.5 is unchanged by this item; only the failing half is added.
- **A7 / GAP-16** — separate branch, separate plan.

---

## 11. Order of work

1. `doc-change`: UI §2 (M-28), §6.4, §9.5, §11.4, §12.6 → status v1.2.5 → `docs/README.md`
2. `TRACKER.md` GAP-101 row corrected to the verified figures, Modes 2 and 3 named
3. W0 — primitive, tests, `retry` predicate
4. W1 — the ten screens that render a falsehood
5. W2 — the eleven money-facing spinners (**F2's client half closes here**)
6. W3 — the remaining eight
7. W4 — guard rule + IG §16 row, the two hand-rolled branches retired, tracker and plan updated
8. `npm run check` clean, golden fixtures unmoved (this is client-only; 134,000 / 15,000 / 7,500 are not reachable from it, and that should be stated rather than assumed)

Steps 1–3 are one sitting. 4–7 are one each.

---

## Revision log

**10 August 2026 — written.** Source-verified throughout. Three things the tracker did not have: the file/call-site counts are wrong in `TRACKER.md` and are corrected in §2; **Modes 2 and 3 are new to this plan** — no review or audit has named the `?? []` family, and Mode 3 (a failed read silently removing a safety warning that UI §7.4 and M-27 both argued about the placement of) is the sharpest instance in the client; and the `enabled:`/`fetchStatus: "idle"` trap (§3.1) would have put the same bug back into the ten screens with the most queries.

**10 August 2026 — §9's five decisions confirmed**, all as recommended. Nothing implemented this pass; the next session starts at §11 step 1, the doc-change.
