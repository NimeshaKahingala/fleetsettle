# P14 — WhatsApp message templates: draft for review

**Status: draft, 13 September 2026 — parked with P14 by the owner the same day. Nothing here has been submitted to Meta.** The Sinhala check can happen any time before P14 resumes. Track M step 3 of [the P14 plan](P14-MESSAGING-PLAN-2026-09-13.md): drafted by Claude in both languages, per the owner's decision; **every Sinhala template must be checked and approved by a Sinhala-reading partner before submission.**

The rules these templates serve are in `use-cases.md` Group I (UC-80 to UC-87, W-45, W-71, W-73) and `user-flows.md` F-10.3. Where this draft and those documents disagree, those documents are right, and the disagreement is a finding for §4.

---

## 1. How to review

For each template, the partner checks the Sinhala version and ticks one box:

- ☐ **Approved as written**
- ☐ **Approved with changes** — write the corrected Sinhala directly under the draft
- ☐ **Rejected** — say what is wrong

**Change the words freely. Never change the `{{numbers}}`.**

- Every `{{1}}`, `{{2}}` … must stay in the message, **in the same order** as in the English, with some words between any two of them.
- Meta rejects a template whose variables are missing, reordered or run together.
- A message may not **start or end** with a `{{number}}`. That is why every message starts with a greeting and ends with "Thank you".

What to look for, in order of importance:

1. **Could anyone misread an amount, a date, or who owes whom?** These messages are evidence in a disagreement months later.
2. **Does "you owe us" and "we owe you" read unmistakably** in the driver messages?
3. Does it sound like a real business talking to its customer, not a machine translation?

## 2. Conventions every template follows

| | Rule | Why |
|---|---|---|
| Category | **Utility**, every one | They confirm, remind or report on something already agreed. Nothing promotional, which Meta rejects |
| Money | `Rs.` / `රු.` is written in the template; the variable holds only the number. **Cents appear only when there are cents: `45,000`, but `1,157.33`** (owner decision, 13 Sept 2026). Never rounded | The app formats the amount from the money codec — never a floating-point number. Rounding would make the message state a different amount from the record, and a customer paying exactly what the message says would leave cents unpaid |
| Dates | The app writes each date in the recipient's language, in the business timezone: `12 Sep 2026` / `2026 සැප්තැම්බර් 12` | "Today" is always the business's today |
| Names | The recipient's name as recorded in FleetSettle | |
| Variables | No line breaks, tabs or long runs of spaces inside a variable | Meta rejects them at send time |
| Vocabulary | **"Daily lease amount"** (the driver pays the business) and **"driver day fee" / "driver trip fee"** (the business pays the driver) are always written in full. No accounting words | `use-cases.md` U-6 — opposite directions of money |
| Driver balances | **Always shown as two separate lines, never netted** into one figure | W-2 |
| What a payment covered | One rule, never free text: the dues it settled, **oldest first** — `rent for 12 Aug – 11 Sep and 12 Sep – 11 Oct`; **more than two periods become a count and a range** — `rent for 3 periods, 12 Jul – 11 Oct`; several kinds are each named once — `rent and extra kilometres for 12 Aug – 11 Oct`. **A payment that settled nothing** — made when nothing was owed, so all of it is credit — is written `credit for future rent` or `credit for future daily lease amounts`, and always uses the credit version (§3.7a, §3.14a). Rendered in the recipient's language | A payment across several dues must read the same way every time, and a variable cannot hold a list with line breaks (review, 13 Sept 2026) |
| Reasons typed by a person | E.g. what a kept deposit was for (§3.10c): one line, no line breaks, shortened if long | Meta rejects a variable with line breaks |
| Sender | The business's own display name shows at the top of the chat, so templates do not repeat it except in the verification message | W-74 |

Language codes: English `en`, Sinhala `si_LK`. Every template is submitted as a matched pair, for each business, under that business's own WhatsApp account.

---

## 3. The templates

**Twenty-two templates, so 44 submissions per business**, plus the auto-reply in §3.15, which is not a template and needs no approval. The plan estimated eight or nine; §5 explains the difference.

### 3.1 `number_verification`

| | |
|---|---|
| Sent when | A customer or driver opts in and their current number is not yet verified (W-71). Stage `number:<number>` |
| Carries money? | **No — by design.** Its delivery is what verifies the number, releasing any money message held for it |
| Variables | `{{1}}` recipient's name · `{{2}}` business name |

**English (`en`)**
```
Hello {{1}}, from now on {{2}} will send updates about your payments to this WhatsApp number. You do not need to reply. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, මෙතැන් සිට {{2}} ඔබේ ගෙවීම් පිළිබඳ යාවත්කාලීන තොරතුරු මෙම WhatsApp අංකයට එවනු ඇත. ඔබට පිළිතුරු දීමට අවශ්‍ය නැත. ස්තූතියි.
```

Sample values for Meta: `{{1}}` Kamal · `{{2}}` Perera Rentals

### 3.2 `lease_confirmation`

| | |
|---|---|
| Sent when | A car lease starts (UC-80), **straight away**, with no waiting for the send window. Stage `once` |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` start date · `{{4}}` rent amount · `{{5}}` when rent is due · `{{6}}` kilometres per day · `{{7}}` charge per extra km · `{{8}}` deposit held |
| Note | States the **daily** kilometre limit, never a monthly total (UC-80) |

**English (`en`)**
```
Hello {{1}}, your rental of {{2}} started on {{3}}. The agreed terms:
Rent: Rs. {{4}} for each rental period, due {{5}}.
Kilometres allowed: {{6}} km per day.
Extra kilometres: Rs. {{7}} per km.
Deposit held: Rs. {{8}}.
Please keep this message as your record of the agreement. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලී ගිවිසුම {{3}} දින ආරම්භ විය. එකඟ වූ කොන්දේසි:
කුලිය: සෑම කුලී කාලසීමාවකටම රු. {{4}}, ගෙවිය යුත්තේ {{5}}.
ඉඩ දෙන කිලෝමීටර්: දිනකට කි.මී. {{6}}.
අමතර කිලෝමීටර්: කි.මී. එකකට රු. {{7}}.
රඳවා ඇති තැන්පතුව: රු. {{8}}.
කරුණාකර මෙම පණිවිඩය ගිවිසුමේ වාර්තාවක් ලෙස තබා ගන්න. ස්තූතියි.
```

Sample values: `{{1}}` Kamal · `{{2}}` Toyota Aqua (CAB-1234) · `{{3}}` 12 Sep 2026 / 2026 සැප්තැම්බර් 12 · `{{4}}` 45,000 · `{{5}}` on the 12th of each month / සෑම මසකම 12 වන දින · `{{6}}` 100 · `{{7}}` 25 · `{{8}}` 50,000

### 3.3 `lease_confirmation_no_km_limit`

| | |
|---|---|
| Sent when | As §3.2, for a lease whose kilometre limit was left blank, meaning no limit (UC §8) |
| Why a separate template | Template text is fixed. A blank limit cannot be sent through §3.2 without printing "km per day" beside nothing |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` start date · `{{4}}` rent amount · `{{5}}` when rent is due · `{{6}}` deposit held |

**English (`en`)**
```
Hello {{1}}, your rental of {{2}} started on {{3}}. The agreed terms:
Rent: Rs. {{4}} for each rental period, due {{5}}.
Kilometres: no daily limit.
Deposit held: Rs. {{6}}.
Please keep this message as your record of the agreement. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලී ගිවිසුම {{3}} දින ආරම්භ විය. එකඟ වූ කොන්දේසි:
කුලිය: සෑම කුලී කාලසීමාවකටම රු. {{4}}, ගෙවිය යුත්තේ {{5}}.
කිලෝමීටර්: දෛනික සීමාවක් නැත.
රඳවා ඇති තැන්පතුව: රු. {{6}}.
කරුණාකර මෙම පණිවිඩය ගිවිසුමේ වාර්තාවක් ලෙස තබා ගන්න. ස්තූතියි.
```

### 3.4 `handover_photo`

| | |
|---|---|
| Sent when | Straight after the lease confirmation, **one message per photo** (owner decision). Stage `photo:<attachment id>` |
| Header | **Image** — the photo itself, uploaded from storage to Meta; never a link into FleetSettle |
| Variables | `{{1}}` this photo's number · `{{2}}` total photos · `{{3}}` vehicle · `{{4}}` date taken |
| At submission | Meta requires a sample image for the header |

**English (`en`)**
```
Handover photo {{1}} of {{2}} for {{3}}, taken on {{4}}. Please keep this photo with your rental record. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
භාර දීමේ ඡායාරූප අංක {{1}} (මුළු ඡායාරූප {{2}} න්) — {{3}} වාහනය, {{4}} දින ගන්නා ලදී. කරුණාකර මෙම ඡායාරූපය ඔබේ කුලී වාර්තාව සමඟ තබා ගන්න. ස්තූතියි.
```

### 3.5 `rent_reminder`

| | |
|---|---|
| Sent when | Before the due date — 3 days by default (UC-81), stage `before_<n>d`. On the due date itself §3.5a is sent instead. Waits for 08:00–20:00. **Cancelled if the rent is recorded as paid first** |
| If it cannot go before the due date | **Suppressed, never sent late** — a reminder still unsent on the due date is stopped with reason `stale`; §3.5a or §3.6 takes over (review, 13 Sept 2026) |
| Variables | `{{1}}` name · `{{2}}` rent amount · `{{3}}` vehicle · `{{4}}` due date |
| Odometer photo | **Not asked for here — owner decision, 13 Sept 2026** (§4, item 1). The reading is collected separately, however the customer pays |

**English (`en`)**
```
Hello {{1}}, a reminder that your rent of Rs. {{2}} for {{3}} is due on {{4}}. If you have already paid, please ignore this message. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක ඔබේ කුලිය ({{3}} සඳහා) {{4}} දිනට ගෙවිය යුතු බව කාරුණිකව සිහිපත් කරමු. ඔබ දැනටමත් ගෙවා ඇත්නම්, මෙම පණිවිඩය නොසලකා හරින්න. ස්තූතියි.
```

### 3.5a `rent_due_today`

| | |
|---|---|
| Sent when | On the due date (UC-81), stage `on_due`. Waits for 08:00–20:00. Cancelled if paid first. **Added by owner decision, 13 Sept 2026** (§4, item 4) |
| Why separate | "Due today" is read at a glance; "due on 12 Sep", received on 12 Sep, makes the reader check the date |
| If it cannot go that day | **Suppressed, never sent late** — held past the send window, by a verification hold or by the kill switch, it is stopped with reason `stale` at the end of the due date. Sent the next day it would say "today" about yesterday. §3.6 takes over, and `overdue` is one stage per due, so the overdue message goes **at most once** |
| Variables | `{{1}}` name · `{{2}}` rent amount · `{{3}}` vehicle |

**English (`en`)**
```
Hello {{1}}, your rent of Rs. {{2}} for {{3}} is due today. If you have already paid, please ignore this message. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක ඔබේ කුලිය ({{3}} සඳහා) අද ගෙවිය යුතු බව කාරුණිකව සිහිපත් කරමු. ඔබ දැනටමත් ගෙවා ඇත්නම්, මෙම පණිවිඩය නොසලකා හරින්න. ස්තූතියි.
```

### 3.6 `rent_overdue`

| | |
|---|---|
| Sent when | Once, when rent goes overdue (UC-81). Waits for 08:00–20:00. Cancelled if paid first |
| Variables | `{{1}}` name · `{{2}}` rent amount · `{{3}}` vehicle · `{{4}}` date it was due |
| Tone | Firm, not threatening. It is one reminder, and it points to a phone call because replies are not read (W-45) |

**English (`en`)**
```
Hello {{1}}, your rent of Rs. {{2}} for {{3}} was due on {{4}} and has not been received yet. Please pay as soon as you can, or call us if something is wrong. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක ඔබේ කුලිය ({{3}} සඳහා) {{4}} දිනට ගෙවිය යුතුව තිබූ අතර තවමත් ලැබී නැත. කරුණාකර හැකි ඉක්මනින් ගෙවන්න, නැතහොත් යම් ගැටලුවක් ඇත්නම් අපට කතා කරන්න. ස්තූතියි.
```

### 3.7 `payment_receipt`

| | |
|---|---|
| Sent when | A payment from a customer is recorded (UC-82), straight away. Optional per business |
| Variables | `{{1}}` name · `{{2}}` amount received · `{{3}}` date received · `{{4}}` what it was for · `{{5}}` balance still owed |
| Note | The balance is always stated, including `0`. **Used only when no credit is held** — an overpayment uses §3.7a, so the receipt never omits money held for the customer |

**English (`en`)**
```
Hello {{1}}, we received Rs. {{2}} from you on {{3}} for {{4}}. Balance still owed: Rs. {{5}}. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක මුදලක් {{3}} දින {{4}} සඳහා ඔබෙන් ලැබුණි. තවමත් ගෙවීමට ඇති ශේෂය: රු. {{5}}. ස්තූතියි.
```

Sample values: `{{4}}` rent for 12 Sep – 11 Oct 2026 / 2026 සැප්තැම්බර් 12 – ඔක්තෝබර් 11 කුලිය

### 3.7a `payment_receipt_with_credit`

| | |
|---|---|
| Sent when | As §3.7, when the payment was **more than was owed** and the surplus is held as credit (F-2.2). **Added by owner decision after review, 13 Sept 2026** |
| Variables | `{{1}}` name · `{{2}}` amount received · `{{3}}` date received · `{{4}}` what it covered · `{{5}}` balance still owed · `{{6}}` credit held |

**English (`en`)**
```
Hello {{1}}, we received Rs. {{2}} from you on {{3}} for {{4}}. Balance still owed: Rs. {{5}}. Credit held for your next payment: Rs. {{6}}. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක මුදලක් {{3}} දින {{4}} සඳහා ඔබෙන් ලැබුණි. තවමත් ගෙවීමට ඇති ශේෂය: රු. {{5}}. ඔබේ ඊළඟ ගෙවීම සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{6}}. ස්තූතියි.
```

### 3.8 `receipt_correction_owed`

| | |
|---|---|
| Sent when | A **customer's** payment that already had a receipt (UC-82) is corrected, and **the difference goes back onto what the customer owes** (W-73, bearer `back_to_arrears`), straight away |
| Credit | **The difference comes out of the payment's unallocated credit first** (F-8.2, review 13 Sept 2026); only the rest reopens settled dues or is absorbed. **Credit is always stated here, even when `0`** — unlike an everyday receipt (§3.7a), a correction is rare and about exact money, and a silent credit line would leave the reader unsure whether his credit survived. *Depends on GAP-229: today's correction code unwinds dues before credit* |
| Variables | `{{1}}` name · `{{2}}` date of the original receipt · `{{3}}` amount recorded · `{{4}}` amount actually received · `{{5}}` balance now owed · `{{6}}` credit still held, `0` if none |

**English (`en`)**
```
Hello {{1}}, a correction to your receipt of {{2}}: we recorded Rs. {{3}}, but the amount actually received was Rs. {{4}}. The difference comes out of any credit you had with us first, and any rest has been added back to what you owe. Balance still owed: Rs. {{5}}. Credit held for your next payment: Rs. {{6}}. We are sorry for the mistake. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබට {{2}} දින එවූ රිසිට්පතට නිවැරදි කිරීමක්: අප රු. {{3}} ලෙස සටහන් කළ නමුත්, සත්‍ය වශයෙන් ලැබුණු මුදල රු. {{4}} කි. වෙනස මුලින්ම ඔබ අප සමඟ තිබූ අතිරික්ත මුදලින් අඩු කරන ලද අතර, ඉතිරි කොටස ඔබ ගෙවිය යුතු මුදලට නැවත එකතු කර ඇත. තවමත් ගෙවීමට ඇති ශේෂය: රු. {{5}}. ඔබේ ඊළඟ ගෙවීම සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{6}}. සිදු වූ වැරැද්ද ගැන අපි කණගාටු වෙමු. ස්තූතියි.
```

### 3.9 `receipt_correction_not_owed`

| | |
|---|---|
| Sent when | As §3.8, but **the business absorbs the difference** (bearer `absorbed_loss`). The customer must not be told he owes it |
| Why a separate template | The two cases say opposite things about money. One template cannot say both honestly |
| Variables | Same as §3.8 |

**English (`en`)**
```
Hello {{1}}, a correction to your receipt of {{2}}: we recorded Rs. {{3}}, but the amount actually received was Rs. {{4}}. The difference comes out of any credit you had with us first, and you do not need to pay the rest. Balance still owed: Rs. {{5}}. Credit held for your next payment: Rs. {{6}}. We are sorry for the mistake. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබට {{2}} දින එවූ රිසිට්පතට නිවැරදි කිරීමක්: අප රු. {{3}} ලෙස සටහන් කළ නමුත්, සත්‍ය වශයෙන් ලැබුණු මුදල රු. {{4}} කි. වෙනස මුලින්ම ඔබ අප සමඟ තිබූ අතිරික්ත මුදලින් අඩු කරන ලද අතර, ඉතිරි කොටස ඔබට ගෙවීමට අවශ්‍ය නැත. තවමත් ගෙවීමට ඇති ශේෂය: රු. {{5}}. ඔබේ ඊළඟ ගෙවීම සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{6}}. සිදු වූ වැරැද්ද ගැන අපි කණගාටු වෙමු. ස්තූතියි.
```

### 3.9a `driver_receipt_correction_owed`

| | |
|---|---|
| Sent when | A **driver's** payment that already had a receipt (UC-110, §3.14) is corrected, and the difference goes back onto what he owes (W-73, bearer `back_to_arrears`), straight away |
| Why a separate template | Every driver message shows **both balances, never netted (W-2)**; §3.8 shows a customer's single balance. Added after review, 13 Sept 2026 |
| Variables | `{{1}}` name · `{{2}}` date of the original receipt · `{{3}}` amount recorded · `{{4}}` amount actually received · `{{5}}` what the driver owes now · `{{6}}` what the business owes now · `{{7}}` credit still held, `0` if none |
| Credit | As §3.8 — credit used first, always stated |

**English (`en`)**
```
Hello {{1}}, a correction to your receipt of {{2}}: we recorded Rs. {{3}}, but the amount actually received was Rs. {{4}}. The difference comes out of any credit you had with us first, and any rest has been added back to what you owe.
Your balances now:
You owe us (daily lease amounts): Rs. {{5}}.
We owe you (driver day fees and driver trip fees): Rs. {{6}}.
Credit held for your coming days: Rs. {{7}}.
We are sorry for the mistake. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබට {{2}} දින එවූ රිසිට්පතට නිවැරදි කිරීමක්: අප රු. {{3}} ලෙස සටහන් කළ නමුත්, සත්‍ය වශයෙන් ලැබුණු මුදල රු. {{4}} කි. වෙනස මුලින්ම ඔබ අප සමඟ තිබූ අතිරික්ත මුදලින් අඩු කරන ලද අතර, ඉතිරි කොටස ඔබ ගෙවිය යුතු මුදලට නැවත එකතු කර ඇත.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{5}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{6}}.
ඔබේ ඉදිරි දින සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{7}}.
සිදු වූ වැරැද්ද ගැන අපි කණගාටු වෙමු. ස්තූතියි.
```

### 3.9b `driver_receipt_correction_not_owed`

| | |
|---|---|
| Sent when | As §3.9a, but the business absorbs the difference (bearer `absorbed_loss`) — the driver must not be told he owes it |
| Variables | Same as §3.9a |

**English (`en`)**
```
Hello {{1}}, a correction to your receipt of {{2}}: we recorded Rs. {{3}}, but the amount actually received was Rs. {{4}}. The difference comes out of any credit you had with us first, and you do not need to pay the rest.
Your balances now:
You owe us (daily lease amounts): Rs. {{5}}.
We owe you (driver day fees and driver trip fees): Rs. {{6}}.
Credit held for your coming days: Rs. {{7}}.
We are sorry for the mistake. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබට {{2}} දින එවූ රිසිට්පතට නිවැරදි කිරීමක්: අප රු. {{3}} ලෙස සටහන් කළ නමුත්, සත්‍ය වශයෙන් ලැබුණු මුදල රු. {{4}} කි. වෙනස මුලින්ම ඔබ අප සමඟ තිබූ අතිරික්ත මුදලින් අඩු කරන ලද අතර, ඉතිරි කොටස ඔබට ගෙවීමට අවශ්‍ය නැත.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{5}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{6}}.
ඔබේ ඉදිරි දින සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{7}}.
සිදු වූ වැරැද්ද ගැන අපි කණගාටු වෙමු. ස්තූතියි.
```

### 3.10 `lease_closing`

| | |
|---|---|
| Sent when | A lease is closed (UC-83), straight away, **when no deposit is held**. A held deposit uses §3.10a instead |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` end date · `{{4}}` last rental period charged · `{{5}}` extra kilometres charged · `{{6}}` deposit refunded · `{{7}}` deposit used for amounts owed · `{{8}}` amount the customer owes · `{{9}}` amount the business owes |
| Note | Both closing amounts are always shown, one of them usually `0`, so it reads correctly whichever way the money goes |

**English (`en`)**
```
Hello {{1}}, your rental of {{2}} ended on {{3}}. Final figures:
Last rental period charged: Rs. {{4}}.
Extra kilometres: Rs. {{5}}.
Deposit: Rs. {{6}} refunded, Rs. {{7}} used for amounts owed.
Amount you owe us: Rs. {{8}}.
Amount we owe you: Rs. {{9}}.
Please keep this message as your record. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලී ගිවිසුම {{3}} දින අවසන් විය. අවසාන සංඛ්‍යා:
අවසාන කුලී කාලසීමාව සඳහා අය කළ මුදල: රු. {{4}}.
අමතර කිලෝමීටර්: රු. {{5}}.
තැන්පතුව: රු. {{6}} ආපසු ගෙවන ලදී, රු. {{7}} ගෙවිය යුතු මුදල් සඳහා යොදා ගන්නා ලදී.
ඔබ අපට ගෙවිය යුතු මුදල: රු. {{8}}.
අප ඔබට ගෙවිය යුතු මුදල: රු. {{9}}.
කරුණාකර මෙම පණිවිඩය ඔබේ වාර්තාව ලෙස තබා ගන්න. ස්තූතියි.
```

### 3.10a `lease_closing_deposit_held`

| | |
|---|---|
| Sent when | A lease is closed with its deposit **held** for the configured window (F-2.6 step 6), straight away. Added after review, 13 Sept 2026 |
| Why a separate template | §3.10 can only say refunded or used. A held deposit needs its amount **and the date the hold ends**, or the message implies nothing is still held |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` end date · `{{4}}` last rental period charged · `{{5}}` extra kilometres charged · `{{6}}` deposit used for amounts owed · `{{7}}` deposit held · `{{8}}` date the hold ends · `{{9}}` amount the customer owes · `{{10}}` amount the business owes |

**English (`en`)**
```
Hello {{1}}, your rental of {{2}} ended on {{3}}. Final figures:
Last rental period charged: Rs. {{4}}.
Extra kilometres: Rs. {{5}}.
Deposit used for amounts owed: Rs. {{6}}.
Deposit held: Rs. {{7}}, until {{8}}, in case late charges such as fines arrive. We will message you when it is released.
Amount you owe us: Rs. {{9}}.
Amount we owe you: Rs. {{10}}.
Please keep this message as your record. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලී ගිවිසුම {{3}} දින අවසන් විය. අවසාන සංඛ්‍යා:
අවසාන කුලී කාලසීමාව සඳහා අය කළ මුදල: රු. {{4}}.
අමතර කිලෝමීටර්: රු. {{5}}.
ගෙවිය යුතු මුදල් සඳහා යොදා ගත් තැන්පතුව: රු. {{6}}.
රඳවා ඇති තැන්පතුව: රු. {{7}}. එය රඳවා තබන්නේ {{8}} දක්වා, දඩ මුදල් වැනි පසුව එන ගාස්තු සඳහා. එය නිදහස් කළ විට අපි ඔබට පණිවිඩයක් එවන්නෙමු.
ඔබ අපට ගෙවිය යුතු මුදල: රු. {{9}}.
අප ඔබට ගෙවිය යුතු මුදල: රු. {{10}}.
කරුණාකර මෙම පණිවිඩය ඔබේ වාර්තාව ලෙස තබා ගන්න. ස්තූතියි.
```

### 3.10b `deposit_released_full`

| | |
|---|---|
| Sent when | A held deposit's hold ends and **all of it** is refunded (F-2.7, through the held-deposit settlement GAP-230 adds — no such operation exists today), straight away. **Added by owner decision, 13 Sept 2026** — a message every time a hold ends. Stage `once`, subject the deposit |
| Why a separate template | Meta will not send a template with an empty variable, so "kept: Rs. 0, for —" cannot be sent. A full refund gets its own sentence |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` amount refunded |

**English (`en`)**
```
Hello {{1}}, the hold on your deposit for {{2}} has ended, and the full Rs. {{3}} has been refunded to you. Nothing was kept. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලිය සඳහා වූ තැන්පතුව රඳවා තැබීම අවසන් වූ අතර, සම්පූර්ණ රු. {{3}} ඔබට ආපසු ගෙවා ඇත. කිසිවක් රඳවා තබා ගත්තේ නැත. ස්තූතියි.
```

### 3.10c `deposit_released_part_kept`

| | |
|---|---|
| Sent when | A held deposit's hold ends and **any non-zero amount is kept** for a late charge — up to and including all of it, so `Refunded to you: Rs. 0` is valid (F-2.7 through GAP-230's settlement, UC-91) — straight away. Stage `once`, subject the deposit |
| Variables | `{{1}}` name · `{{2}}` vehicle · `{{3}}` amount refunded · `{{4}}` amount kept · `{{5}}` what it was kept for · `{{6}}` amount the customer still owes |
| Note | The reason is stated in writing. **It is required and never empty** — taken from the charge the deposit was applied to, or entered by the manager; without one the message is not sent (Meta refuses an empty variable) and the release surfaces for a reason to be added. "Still owes" covers a late charge larger than the deposit, and is `0` otherwise |

**English (`en`)**
```
Hello {{1}}, the hold on your deposit for {{2}} has ended.
Refunded to you: Rs. {{3}}.
Kept: Rs. {{4}}, for {{5}}.
Amount you still owe us: Rs. {{6}}.
Please keep this message as your record. Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, ඔබේ {{2}} කුලිය සඳහා වූ තැන්පතුව රඳවා තැබීම අවසන් විය.
ඔබට ආපසු ගෙවූ මුදල: රු. {{3}}.
රඳවා ගත් මුදල: රු. {{4}}, හේතුව: {{5}}.
තවමත් ඔබ අපට ගෙවිය යුතු මුදල: රු. {{6}}.
කරුණාකර මෙම පණිවිඩය ඔබේ වාර්තාව ලෙස තබා ගන්න. ස්තූතියි.
```

Sample values: `{{5}}` a traffic fine dated 12 Oct 2026 / 2026 ඔක්තෝබර් 12 දිනැති රථවාහන දඩයක්

### 3.11 `driver_paid`

| | |
|---|---|
| Sent when | The business pays a driver, including a deposit refund (UC-84), straight away |
| Variables | `{{1}}` name · `{{2}}` amount paid · `{{3}}` date · `{{4}}` what it was for · `{{5}}` what the driver owes (daily lease amounts) · `{{6}}` what the business owes the driver (driver day fees and driver trip fees) |
| Note | **Two balances, never netted (W-2).** UC-84 calls this "the message that prevents 'you never paid me for that trip'" |

**English (`en`)**
```
Hello {{1}}, we paid you Rs. {{2}} on {{3}} for {{4}}.
Your balances now:
You owe us (daily lease amounts): Rs. {{5}}.
We owe you (driver day fees and driver trip fees): Rs. {{6}}.
Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, අපි ඔබට රු. {{2}} ක් {{3}} දින {{4}} සඳහා ගෙවූවෙමු.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{5}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{6}}.
ස්තූතියි.
```

Sample values: `{{4}}` driver day fees for 1–7 Sep / සැප්තැම්බර් 1–7 රියදුරු දින ගාස්තු

### 3.12 `driver_offset`

| | |
|---|---|
| Sent when | An offset is recorded: what the business owes a driver is set against what he owes the business (UC-84, W-2), straight away |
| Variables | `{{1}}` name · `{{2}}` date · `{{3}}` amount set off · `{{4}}` what the driver owes now · `{{5}}` what the business owes now |
| Note | Says plainly that no cash changed hands. An offset is the one record that moves both balances |

**English (`en`)**
```
Hello {{1}}, on {{2}} we set Rs. {{3}} that we owed you against the same amount that you owed us. No cash changed hands.
Your balances now:
You owe us (daily lease amounts): Rs. {{4}}.
We owe you (driver day fees and driver trip fees): Rs. {{5}}.
Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, අපි {{2}} දින, ඔබට ගෙවිය යුතුව තිබූ රු. {{3}} ක මුදල, ඔබ අපට ගෙවිය යුතුව තිබූ එම මුදලම සමඟ හිලව් කළෙමු. මුදල් අතින් අතට ගෙවීමක් සිදු නොවීය.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{4}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{5}}.
ස්තූතියි.
```

### 3.13 `driver_settlement_summary`

| | |
|---|---|
| Sent when | At the end of each weekly or monthly period, per driver (UC-85). Waits for 08:00–20:00. Stage `summary:weekly:<end date>` or `summary:monthly:<month>` |
| Variables | `{{1}}` name · `{{2}}` period · `{{3}}` days run · `{{4}}` trips · `{{5}}` daily lease amounts for the period · `{{6}}` paid by the driver · `{{7}}` driver day fees and driver trip fees for the period · `{{8}}` paid to the driver · `{{9}}` what the driver owes now · `{{10}}` what the business owes now |
| Note | **Totals only.** A variable cannot contain line breaks, so a day-by-day list cannot fit. The printed slip (UC-57) keeps the detail |

**English (`en`)**
```
Hello {{1}}, your summary for {{2}}:
Days run: {{3}}. Trips: {{4}}.
Daily lease amounts for the period: Rs. {{5}}. Paid by you: Rs. {{6}}.
Driver day fees and driver trip fees for the period: Rs. {{7}}. Paid to you: Rs. {{8}}.
You owe us now: Rs. {{9}}.
We owe you now: Rs. {{10}}.
Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, මෙය {{2}} සඳහා ඔබේ සාරාංශයයි:
ධාවනය කළ දින: {{3}}. ගමන්: {{4}}.
කාලසීමාවේ දෛනික කුලී මුදල්: රු. {{5}}. ඔබ ගෙවූ මුදල: රු. {{6}}.
කාලසීමාවේ රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු: රු. {{7}}. ඔබට ගෙවූ මුදල: රු. {{8}}.
දැන් ඔබ අපට ගෙවිය යුතු මුදල: රු. {{9}}.
දැන් අප ඔබට ගෙවිය යුතු මුදල: රු. {{10}}.
ස්තූතියි.
```

### 3.14 `driver_payment_received`

| | |
|---|---|
| Sent when | A payment **from** a driver is recorded — usually his daily lease amount — straight away. **Added by owner decision, 13 Sept 2026** (§4, item 2) |
| Variables | `{{1}}` name · `{{2}}` amount received · `{{3}}` date received · `{{4}}` what it was for · `{{5}}` what the driver owes now (daily lease amounts) · `{{6}}` what the business owes now (driver day fees and driver trip fees) |
| Note | **Used only when no credit is held** — paying ahead uses §3.14a. The mirror of §3.11: **two balances, never netted (W-2)**. Settles "I paid you on Tuesday" the same evening. Specified as `use-cases.md` **UC-110** |

**English (`en`)**
```
Hello {{1}}, we received Rs. {{2}} from you on {{3}} for {{4}}.
Your balances now:
You owe us (daily lease amounts): Rs. {{5}}.
We owe you (driver day fees and driver trip fees): Rs. {{6}}.
Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක මුදලක් {{3}} දින {{4}} සඳහා ඔබෙන් ලැබුණි.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{5}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{6}}.
ස්තූතියි.
```

Sample values: `{{4}}` daily lease amounts for 9 Sep / සැප්තැම්බර් 9 දෛනික කුලී මුදල්

### 3.14a `driver_payment_received_with_credit`

| | |
|---|---|
| Sent when | As §3.14, when the driver paid **more than was owed** and the surplus is held as credit against his coming days (UC-31 variations). **Added by owner decision after review, 13 Sept 2026** |
| Variables | `{{1}}` name · `{{2}}` amount received · `{{3}}` date received · `{{4}}` what it covered · `{{5}}` credit held · `{{6}}` what the driver owes now · `{{7}}` what the business owes now |

**English (`en`)**
```
Hello {{1}}, we received Rs. {{2}} from you on {{3}} for {{4}}.
Credit held for your coming days: Rs. {{5}}.
Your balances now:
You owe us (daily lease amounts): Rs. {{6}}.
We owe you (driver day fees and driver trip fees): Rs. {{7}}.
Thank you.
```

**Sinhala (`si_LK`) — to check** ☐
```
ආයුබෝවන් {{1}}, රු. {{2}} ක මුදලක් {{3}} දින {{4}} සඳහා ඔබෙන් ලැබුණි.
ඔබේ ඉදිරි දින සඳහා රඳවා ඇති අතිරික්ත මුදල: රු. {{5}}.
දැනට ඔබේ ශේෂයන්:
ඔබ අපට ගෙවිය යුතු (දෛනික කුලී මුදල්): රු. {{6}}.
අප ඔබට ගෙවිය යුතු (රියදුරු දින ගාස්තු සහ රියදුරු ගමන් ගාස්තු): රු. {{7}}.
ස්තූතියි.
```

### 3.15 Auto-reply — not a template

| | |
|---|---|
| Sent when | Someone replies to any message, **at most once per sender number per 24 hours** (W-45) |
| Why not a template | It answers a message the person just sent, so WhatsApp allows free text without approval |
| `{{reply_phone}}` | The business's own number (owner decision) — filled in by the app, not by Meta |
| Language | The recipient's language when the sender is a known customer or driver. **An unknown sender gets both, Sinhala first then English, in one message** (owner decision, 13 Sept 2026 — §4, item 5) |

**English**
```
Thank you for your message. This WhatsApp number does not read replies. For anything about your rental or payments, please call us on {{reply_phone}}.
```

**Sinhala — to check** ☐
```
ඔබේ පණිවිඩයට ස්තූතියි. මෙම WhatsApp අංකයට ලැබෙන පිළිතුරු කියවනු නොලැබේ. ඔබේ කුලිය හෝ ගෙවීම් පිළිබඳ ඕනෑම දෙයක් සඳහා, කරුණාකර {{reply_phone}} අංකයට අපට කතා කරන්න.
```

**Unknown sender — Sinhala first, then English, in one message** ☐
```
ඔබේ පණිවිඩයට ස්තූතියි. මෙම WhatsApp අංකයට ලැබෙන පිළිතුරු කියවනු නොලැබේ. ඔබේ කුලිය හෝ ගෙවීම් පිළිබඳ ඕනෑම දෙයක් සඳහා, කරුණාකර {{reply_phone}} අංකයට අපට කතා කරන්න.

Thank you for your message. This WhatsApp number does not read replies. For anything about your rental or payments, please call us on {{reply_phone}}.
```

---

## 4. Questions drafting surfaced — for the owner, not the translator

Writing the exact words exposed five things the specification did not settle, and a review of the draft found two more (rows 6–7). **The owner decided all seven on 13 Sept 2026**; each row keeps its original question beneath the answer.

| # | Question | Why it matters |
|---|---|---|
| 1 | ✅ **Decided 13 Sept 2026: removed from the reminder.** The reading is collected separately (a call, or when the car is seen), so the message never asks for something nobody will receive. `use-cases.md` UC-81, W-18 and UC-14's route table updated to match; the code's `odometer_reading.source` values (`photo`, `in_person`, `reported`, `at_return`) needed no change. *Original question:* **How does a customer send the odometer photo the rent reminder asks for?** UC-81 says the reminder is "where you ask for the odometer photo" (UC-14), but W-45 says WhatsApp replies are not read. The draft says "show a clear photo when you pay", but that only works if payment is in person | Asking for a photo nobody will receive breaks a promise in the one message about money. The alternatives are dropping the sentence or naming where to send it |
| 2 | ✅ **Decided 13 Sept 2026: yes, a receipt for every payment from a driver** — template §3.14. Now `use-cases.md` **UC-110**. *Original question:* **A driver who pays his daily lease amount gets no receipt.** Group I gives customers a receipt (UC-82) and tells drivers when *they* are paid (UC-84), but nothing covers a driver paying the business | Arrangement B's whole flow is a driver handing over cash. If a receipt is wanted, it is a fourteenth template and a use-case change first |
| 3 | ✅ **Decided 13 Sept 2026: cents only when there are cents** — `45,000` and `1,157.33`, never `.00` on a whole amount and never rounded (§2). *Original question:* **Are amounts written with cents?** The draft shows `45,000`. Money is stored to the cent, so a cash amount of `45,000.50` would need `.50` shown | Hiding a nonzero cents part would misstate the amount. Showing `.00` on every whole amount looks machine-made |
| 4 | ✅ **Decided 13 Sept 2026: yes** — template §3.5a on the due date; §3.5 is now only the reminder before it. No spec change needed, since UC-81 already asks for a reminder on the day. *Original question:* **Should the due-date reminder say "today"?** §3.5 serves both the reminder three days before and the one on the day, so on the day it reads "due on 12 Sep" | A separate "due today" template is clearer and adds two submissions |
| 5 | ✅ **Decided 13 Sept 2026: yes, Sinhala first then English, in one message** (§3.15). Nobody gets an answer they cannot read, and it happens at most once per person per day. *Original question:* **Should the auto-reply to an unknown number be bilingual?** Someone not recorded in FleetSettle has no language setting | Bilingual is safe and a little long. English only could reach someone who cannot read it |
| 6 | ✅ **Decided 13 Sept 2026: a message every time a held deposit is released** — refunded in full (§3.10b), or part kept with the reason (§3.10c). The closing message states the amount held and the date the hold ends (§3.10a). UC-83 and F-2.6 updated. *Raised by review:* the closing template could not represent a held deposit | F-2.6 allows holding a deposit for a window after closing. Without this, the written record of the deposit stopped at closing, while the money was still held |
| 7 | ✅ **Decided 13 Sept 2026: a separate receipt, used only when credit is held** — §3.7a for customers, §3.14a for drivers. UC-82, UC-110 and F-2.2 updated. *Raised by review:* a receipt saying "balance still owed: Rs. 0" could omit money held as credit | F-2.2 holds an overpayment as credit; a receipt silent about it is incomplete about money, in writing |

## 5. Why twenty-two, not "eight or nine"

The plan's estimate was the six Group I messages plus verification, the receipt correction and a condition photo. **Template text is fixed, so a message that must say different things in different situations needs a template for each.** Writing the wording, answering its questions and absorbing a review added:

| Added | Why |
|---|---|
| A lease with no kilometre limit (§3.3) | "km per day" cannot be printed beside nothing |
| A due-today reminder (§3.5a) | Owner decision — "today" is read at a glance |
| An overdue reminder (§3.6) | A late reminder means something different from an early one |
| A receipt with credit held (§3.7a), and its driver version (§3.14a) | Review and owner decision — a receipt must not omit money held for the payer |
| A correction the business absorbs (§3.9) | Says the opposite of one the customer owes |
| Driver corrections, owed and absorbed (§3.9a, §3.9b) | Review — a driver message always shows both balances |
| A closing with the deposit held (§3.10a) | Review — without the amount and release date, the message implies nothing is still held |
| Deposit released in full, or part kept (§3.10b, §3.10c) | Owner decision; and Meta will not send an empty "kept for" reason |
| A driver offset (§3.12) | Moves two balances with no cash |
| A driver payment received (§3.14) | Owner decision — Group I never specified it |

**Twenty-two templates, 44 submissions per business.** Each business's WhatsApp account may hold 250 templates.

## 6. After the review

1. The partner's corrections are written into this document. §4's questions are already answered.
2. The final wording is submitted for the live business, in both languages, under its own WhatsApp account.
3. Approved template names, language codes, variable counts and the exact approved text are recorded into `message_template` by the build (W3) — **the approved text, not this draft**, since Meta may ask for changes.
