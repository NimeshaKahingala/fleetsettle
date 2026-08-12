# Web Codex Instructions

Root `AGENTS.md` and root `CLAUDE.md` apply. This file adds React-client
guidance for everything under `web/`.

Before changing UI behavior, read `web/CLAUDE.md` and the owning design/product
section:

- Screens, primitives, responsive rules, and copy: `docs/design/ui-ux-guidelines.md`
- Brand, color, icons, and voice: `docs/design/brand-guidelines.md`
- Flow behavior and acceptance criteria: `docs/product/user-flows.md`
- Current open/closed gap state: `TRACKER.md`

## UI Rules

- Phase-1 flows must work at 360 x 640, one thumb, no horizontal scroll, and
  still reflow at 320px.
- Use existing primitives before adding new ones. If a behavior is shared, fix
  the primitive rather than patching each screen.
- Minimum tap target is 44 x 44 CSS px, with spacing rules from `web/CLAUDE.md`.
- Use `100svh`, not `100vh`.
- Sticky bottom actions need enough scroll padding so focused fields are not
  hidden.
- Text must fit its container at mobile and desktop sizes.
- Do not use raw hex values; use `--color-*` tokens.
- Color never carries meaning alone.
- Use reserved product vocabulary. Do not introduce accounting language in UI.
- One primary action per screen, named for the action; never use generic
  "Submit" copy.

## Data and State

- Money is `string` on the wire and `bigint` in client logic; never convert
  money to `number`.
- Zero and unknown are different. `Rs 0` is a fact; `NotAvailable` means the
  fact does not exist.
- Every read has visible data/loading/error/empty behavior through the shared
  query-state pattern.
- Do not hide failed reads behind `?? []`, `?? 0`, or confident empty states.
- Driver balances stay separate; never replace them with only a signed net.

## Testing and Browser Checks

- Add or update tests for changed screens, primitives, and shared hooks.
- For mobile-specific bugs, include touch/coarse-pointer coverage where possible
  and record whether real-device iPhone/Android verification was done.
- For sheet, date picker, navigation, keyboard, and layout changes, test the
  smallest affected primitive and at least one real call site.
- Browser-found bugs should be rechecked in the browser, not only by source
  review.
