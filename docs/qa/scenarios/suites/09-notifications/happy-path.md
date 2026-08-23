# Suite 09 — Notifications: Happy Path

**Phase:** 2
**Depends on:** Suite 01, Suite 02
**Source:** UC-80–UC-87, F-10.2–F-10.4, W-14, W-21, W-22, W-23

**Confirmed still unbuilt, 22 Aug 2026 — this is the correct status, not drift.** Every case below describes UI that doesn't exist yet anywhere in `web/src` or `api/src`: no Settings → Messaging screen, no message log, no kill switch, no template configuration, no per-message send/status tracking. This matches `TRACKER.md`'s own record — P14/WhatsApp dispatch was deliberately deferred whole to phase 2 (owner decision, 31 July 2026: "the Queue binding and the kill switch are not needed at bootstrap"), pending Meta template approvals. **Unlike suites 00–08's corrections, nothing here needed rewriting** — these cases are correct as *design*, they're just not yet runnable. Don't "fix" the steps to match a screen that isn't there; re-check this note's own currency before running anything in this file, and only once messaging actually ships does this suite's content need the same UI-literal audit the others just got.

---

### HP-09-001: Configure messaging — sending window, language, opt-in

**Priority:** P1
**Source:** UC-86, F-10.2, W-23
**Preconditions:** Business and customer exist.

**Steps:**
1. ACTION: Navigate to Settings → Messaging
2. ACTION: Set sending window: 08:00 to 20:00 (business timezone)
3. ACTION: Navigate to a customer profile
4. ACTION: Check "Opt-in to automated messages"
5. ACTION: Select preferred language: "English" or "Sinhala"
6. ACTION: Save
   VERIFY: Settings applied

**Assertions (post-test):**
- [ ] Precedence rules: business default → rental override → recipient opt-in wins (Group I)
- [ ] Two templates exist for every message type (English/Sinhala)

---

### HP-09-002: Customer confirmation message on lease start

**Priority:** P1
**Source:** UC-80, F-10.3
**Preconditions:** New lease created (HP-01-001), condition photos captured.

**Steps:**
1. ACTION: Trigger the lease creation event
   VERIFY: Confirmation message queued and sent
2. ACTION: Check message log
   VERIFY: Message contains: terms, km PER DAY limit, and link to condition photos

**Assertions (post-test):**
- [ ] Mileage limits stated strictly "per day", never as a monthly total
- [ ] Confirmation messages are EXEMPT from the 08:00-20:00 sending window (F-10.2)
- [ ] Message logged against the lease record

---

### HP-09-003: Rent reminder sent automatically

**Priority:** P1
**Source:** UC-81, F-10.3
**Preconditions:** Rent due approaching in 3 days.

**Steps:**
1. ACTION: Simulate time passing to trigger point (e.g., 09:00 on trigger day)
   VERIFY: Rent reminder message sent
2. ACTION: Check message log
   VERIFY: Message contains payment amount and odometer photo request

**Assertions (post-test):**
- [ ] Odometer photo request included
- [ ] Respects sending window

---

### HP-09-004: Driver payment notification

**Priority:** P1
**Source:** UC-84, F-10.3
**Preconditions:** Driver paid for a trip.

**Steps:**
1. ACTION: Record driver payment
   VERIFY: Notification queued and sent
2. ACTION: Check message log
   VERIFY: Message sent to driver's number

**Assertions (post-test):**
- [ ] Message confirms the payment amount and the trip it relates to

---

### HP-09-005: Message log — append-only audit

**Priority:** P1
**Source:** UC-87, F-10.4, W-33
**Preconditions:** Messages have been sent.

**Steps:**
1. ACTION: Navigate to Message Log
   VERIFY: Shows recipient number *at the time*
   VERIFY: Shows template name, language, and final rendered text
   VERIFY: Shows transport (W-21), status, outcome
2. ACTION: Navigate to a specific rent due
   VERIFY: The messages related to THAT due are visible from there

**Assertions (post-test):**
- [ ] Message text is stored (what they were actually told)
- [ ] Log is append-only
- [ ] Link maintained between message and the record it concerned (§9.2)

---

### HP-09-006: Kill switch stops all messaging

**Priority:** P1
**Source:** UC-86, F-10.2
**Preconditions:** Messages queued for dispatch.

**Steps:**
1. ACTION: Navigate to Settings → Messaging
2. ACTION: Engage the "Kill Switch" (Global stop)
3. ACTION: Trigger an event that normally queues a message (e.g., payment receipt)
   VERIFY: Message is NOT sent
4. ACTION: Check queue
   VERIFY: Messages remain queued or are marked suppressed by kill switch

**Assertions (post-test):**
- [ ] Kill switch stops everything immediately
- [ ] Works globally or per-person
