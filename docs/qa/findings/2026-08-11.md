# QA findings — 11 August 2026

Fresh browser QA against `https://qa.fleetsettle.com` on 11 August 2026.
Default viewport for user-facing checks was 360 x 640 unless noted.

## Scope

Covered the currently reachable signed-in staff/owner-manager session:

- GAP-70 cash position report.
- GAP-71 lost days report.
- GAP-101 read-error state.
- A7/GAP-16 expense receipt upload surface.
- Expense void flow for the receipt test row.
- Opening-balance/report cross-check for GAP-103, using existing committed QA data.

Not covered: linked-driver 403 live check. No linked-driver credentials were available in this session, so this remains blocked for live QA.

## Passes

- Sign-in recovered cleanly after the Asgardeo callback; QA landed on Home.
- Home, More, and Reports catalogue render at 360 x 640 with no page-level horizontal overflow.
- Reports catalogue shows the expected six reports: How was this month, Which trips made money, Is the bus drinking fuel, Who owes us, Where is our cash, Lost days.
- Cash position report loads as `Where is our cash`.
- Cash position chart view shows partner-held cash, deposit liability wording, the banked empty state, and driver advances.
- Cash position table view shows partner-held cash and driver advances. Live data showed Sunil Perera with Rs 500 outstanding.
- Lost days report loads with the GAP-71 structure: month chart first, then By weekday and By reason sections.
- Lost days invalid window (`from=2026-08-12&to=2026-08-11`) renders a real read failure: `role="alert"`, "Lost days couldn't be loaded.", and Try again. It did not spin forever or render a fake zero.
- Quick Add -> Fuel opened on mobile, prefilled NC-1234, and the amount pad saved Rs 1.
- Receipt local validation rejected a tiny invalid/unsupported generated PNG and showed Try again.
- Retaking with a normal generated PNG cleared Try again and allowed save.
- Saving the fuel fill created a new NC-1234 cost row for Rs 1 on 11 Aug 2026 with `1 receipt`.
- Voiding that test row with reason `QA fresh receipt void test 2026-08-11` worked. The row stayed visible, gained Voided plus the reason, retained `1 receipt`, and the Costs total decreased by Rs 1.

## Findings

### QA-2026-08-11-01 — Committed opening balances are still absent from money reports

Severity: high.

Opening balances currently shows a committed batch:

- `A customer owes us` — QA2 Customer 0808155856 — Rs 2,000.
- `A driver's deposit we're holding` — QA2 Driver 0808155856 — Rs 5,000.

The reports do not reflect those committed figures:

- `Who owes us` showed only QA Customer 0808052656, Rs 1,450. It did not show QA2 Customer 0808155856 / Rs 2,000.
- `Where is our cash` showed `Held as deposits: Rs 1,000`. It did not include the additional Rs 5,000 driver deposit from opening balances.

This is the same business symptom GAP-103 was meant to close. It may be stale pre-fix QA data that was never backfilled, but the live application still presents the committed starting figures and the reports disagree with them.

### QA-2026-08-11-02 — Opening balance confirm sheet is unusable at 360 x 640

Severity: high for mobile.

At 360 x 640, `Opening balances` renders the `Confirm and go live` button below the viewport and the fixed `Save as draft` action overlaps the lower content area. After opening `Go live?`, the sheet content is present in the DOM but not visible in the viewport screenshot, so the confirm action could not be completed on mobile.

### QA-2026-08-11-03 — Lost days date controls clip horizontally at 360 x 640

Severity: medium.

On `Lost days`, the From/To date controls are in one row. The To group extends past the right edge at 360 px, clipping `Yesterday` and the date button. The document width still reports 360 px, so this is visible clipping rather than body-level horizontal scroll.

### QA-2026-08-11-04 — Cash table view renders an empty banked section as a header-only table

Severity: low.

Cash chart view correctly says `Nothing banked yet.` when no banked rows exist. Table view instead renders:

`Account | Held`

with no row or empty-state copy.

### QA-2026-08-11-05 — Cash stacked-bar deposit label is cramped on mobile

Severity: low.

At 360 px, the stacked-bar label for deposits wraps/cramps into the narrow segment. The section is still understandable because the caption below says `Rs 1,000 held as deposits — a liability, not partner cash.`

### QA-2026-08-11-06 — Receipt count is correct, but thumbnail preview renders broken

Severity: medium; retest with a real phone photo.

After uploading a generated PNG receipt, the cost row showed `1 receipt`. Opening Receipts produced an 80 x 80 image slot from a blob URL, but the image rendered as a broken icon and DOM inspection reported `naturalWidth: 0`, `naturalHeight: 0`.

The browser automation environment blocked deeper byte inspection of the blob, so this should be retested with a normal camera/photo file before deciding whether the bug is in upload, retrieval, content type, or the generated fixture.

13 Aug follow-up: the current hosted QA failure is now narrowed to CSP, not upload, DB, R2, or the Worker read path. Browser console showed:

`Loading the image 'blob:https://qa.fleetsettle.com/...' violates the following Content Security Policy directive: "img-src 'self'".`

Root cause: `ReceiptThumbnail` downloads the same-origin `/api/attachment/{id}` response, creates a local `blob:` URL with `URL.createObjectURL(blob)`, and renders that URL in `<img>`. The deployed Cloudflare asset header allowed only `img-src 'self'`, so the browser blocked the local blob image before it could render. Required modification: keep same-origin image loading but add `blob:` to `img-src`; keep `connect-src` unchanged.

## Test Data Changes

- Created one QA fuel fill on NC-1234 for Rs 1 on 11 Aug 2026.
- Attached one generated PNG receipt to that fuel fill.
- Voided that fuel fill with reason `QA fresh receipt void test 2026-08-11`.
- No linked-driver account was used.
- Opening balance re-confirm was attempted but not completed because the mobile confirmation sheet was not visible and browser-control clicks timed out.

## Test Limitations

- No linked-driver credentials were available, so the live linked-driver 403 boundary remains untested.
- The in-app browser page scope did not expose `fetch`/`XMLHttpRequest` for response capture, so report API payloads were verified through visible UI and source/schema cross-checks, not by intercepting live JSON.
- After several sheet interactions, the in-app browser occasionally timed out dispatching clicks. Testing stopped before any ambiguous additional write.
