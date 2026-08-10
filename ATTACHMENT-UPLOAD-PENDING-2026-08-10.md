# Attachment Upload (A7/GAP-16) — What's Left

Date: 10 August 2026
Branch: `feature/image-upload` (7 commits, pushed, PR not yet opened)
Source: [ATTACHMENT-UPLOAD-IMPLEMENTATION-PLAN-2026-08-09.md](ATTACHMENT-UPLOAD-IMPLEMENTATION-PLAN-2026-08-09.md) is
the design; `TRACKER.md`'s GAP-16 row and `Plan.md`'s A7 section carry the current status. This document exists
only to separate "what's left" from "what was built" — implementation status belongs in those two files and is
not repeated here beyond what's needed for context.

## Blocking — before this branch can be trusted or merged

1. **The PR is not open yet.** Compare link:
   `github.com/NimeshaKahingala/fleetsettle/compare/build/p0-foundation...feature/image-upload`

2. **The 26-case integration suite has never run.**
   `api/tests/integration/attachment.test.ts` typechecks and lints clean, but no `TEST_DATABASE_URL` was ever
   configured in the environment that built it, so it has never actually executed against a database. This is
   the single biggest open risk on the branch — a clean diff is not evidence these tests pass, particularly the
   two hardest cases in the file: the concurrent-same-id race and the row-exists/object-missing corruption path.
   **Action:** confirm CI's `integration.yml` (already carries `NEON_API_KEY`/`NEON_PROJECT_ID`) runs the suite
   green before merging.

3. **Golden fixtures (134,000 / 15,000 / 7,500) have not been re-verified.** Same root cause as #2 — no database
   access this session. Nothing in this branch should move them; confirm that's actually true rather than assumed.

4. **Manual QA is unchecked.** On a 360×640 viewport: record a fuel fill with two receipt photos, confirm the
   sheet closes before either upload finishes, reopen the expense via `ExpenseCostRow`'s new receipt indicator,
   confirm both thumbnails load, void one and confirm it disappears and 404s. Separately, by hand: confirm a
   linked-driver token gets 403 — not 404 — on both upload and read (decision 4's deliberate deviation from the
   usual cross-tenant-404 shape, worth eyes-on confirmation that it isn't accidentally 404).

5. **The branch is one commit behind its base.** `build/p0-foundation` gained `21c0a9d` (GAP-70/GAP-71 — cash-
   position and lost-days report work, unrelated to attachments) after `feature/image-upload` diverged. Not a
   conflict, and migration `0013` is still free — but a re-sync before merge is cleaner than one forced after.

## Left over from this branch, not fixed

- **`api/wrangler.jsonc:34`** — the local-dev `R2` binding still reads
  `"bucket_name": "todo-provision-before-deploy"`. Harmless (QA and production carry the real bucket names;
  `wrangler dev` simulates a local bucket regardless of the name), but it's a stale placeholder sitting in the
  file this whole branch is about. One-line rename (e.g. `fleetsettle-attachments-dev`), not urgent.

## Deliberately out of scope — the other four call sites

GAP-16 is closed in `TRACKER.md` for expense receipts only. Still unbuilt, unplanned in any detail, and
explicitly deferred to a second branch:

- Condition photos at lease start (F-2.1 step 6)
- Condition photos at lease close (F-2.6 step 5)
- Incident damage photos
- The side-by-side handover/return comparison — phase 3 regardless, per UC §9.1, independent of this branch
- **GAP-17** — the photo pipeline (`web/src/lib/photo-pipeline.ts`) still runs on the main thread, no Web
  Worker, no 3s timeout fallback. Untouched by this branch on purpose; `TRACKER.md` is worded so it cannot be
  mistaken for closed by association with GAP-16.

## Genuinely undecided — not even planned yet

- **Retention.** No document states how long an `attachment` row (or its R2 object) should live, and the table
  has no archival column. "Forever" may well be the right answer — these are dispute evidence — but nobody has
  actually decided that; it is an omission, not a decision. Worth its own GAP entry before anyone builds a purge
  job or an archival flag on the strength of an assumption.

## Priority order

1. Open the PR, get CI to actually run the integration suite, fix anything that surfaces.
2. Manual QA pass on a real viewport.
3. Merge.
4. Everything else here (`wrangler.jsonc`'s placeholder, retention, the four remaining call sites, GAP-17) is
   follow-up work, not a blocker to shipping expense receipts.
