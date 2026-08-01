# Suite 09 — Notifications: Edge Cases

**Phase:** 2
**Source:** INV-11, INV-12, INV-13, F-10.2, F-10.4

---

### EC-09-001: Reminder cancelled when payment recorded (INV-12)

**Priority:** P1
**Source:** INV-12, UC-81
**Preconditions:** Rent reminder queued to send tomorrow.

**Steps:**
1. ACTION: Record payment for the due amount today
2. ACTION: Check the queued reminder
   VERIFY: Status changed from `queued` to `suppressed`
3. VERIFY: Reason logged: "Condition re-checked at dispatch (paid)"

**Assertions (post-test):**
- [ ] INV-12: Condition re-checked at dispatch time
- [ ] Sending a reminder for a paid bill is worse than sending nothing

---

### EC-09-002: One send per trigger enforced (INV-11)

**Priority:** P1
**Source:** INV-11
**Preconditions:** Rent reminder due to send.

**Steps:**
1. ACTION: Trigger the dispatch process TWICE concurrently
   VERIFY: Database constraint prevents duplicate inserts
2. ACTION: Check message log
   VERIFY: Exactly ONE message sent for that (trigger, record, stage)

**Assertions (post-test):**
- [ ] INV-11: Enforced by unique constraint, not application logic
- [ ] No double-sends on system restart

---

### EC-09-003: Failed message retry via another channel

**Priority:** P2
**Source:** UC-87, F-10.4
**Preconditions:** WhatsApp dispatch failed.

**Steps:**
1. ACTION: Simulate WhatsApp send failure
   VERIFY: Message status = `failed`
   VERIFY: Error appears on manager's home screen
2. ACTION: From home screen, tap the failed message
3. ACTION: Select "Send via SMS" (or retry)
   VERIFY: New attempt logged, sent via new channel

**Assertions (post-test):**
- [ ] The record never depended on WhatsApp
- [ ] Failed messages surface on home screen (they are silently getting worse)

---

### EC-09-004: Sending window — reminder waits, confirmation exempt

**Priority:** P2
**Source:** F-10.2
**Preconditions:** Current time is 23:00 (outside 08:00-20:00 window).

**Steps:**
1. ACTION: Create a new lease at 23:00
   VERIFY: Confirmation message sends IMMEDIATELY (exempt)
2. ACTION: System generates a reminder at 23:00
   VERIFY: Reminder stays `queued` until 08:00 next morning

**Assertions (post-test):**
- [ ] Confirmations exempt — "confirming money that just moved is worth nothing an hour later"
- [ ] Reminders wait for business hours

---

### EC-09-005: Message log append-only — no update no delete (INV-13)

**Priority:** P1
**Source:** INV-13
**Preconditions:** Sent message in the log.

**Steps:**
1. ACTION: Attempt to modify the message text or status directly
   VERIFY: System refuses
2. ACTION: Attempt to delete the message
   VERIFY: System refuses

**Assertions (post-test):**
- [ ] Append-only enforced at database level

---

### EC-09-006: Only failed messages on home screen — success invisible

**Priority:** P2
**Source:** F-10.4, §7
**Preconditions:** 5 messages sent successfully, 1 failed.

**Steps:**
1. ACTION: Navigate to home screen
   VERIFY: Only the 1 failed message is visible (at the very top)
   VERIFY: The 5 successful ones do NOT clutter the screen

**Assertions (post-test):**
- [ ] Success is invisible by design
- [ ] Failed messages are top priority on home screen
