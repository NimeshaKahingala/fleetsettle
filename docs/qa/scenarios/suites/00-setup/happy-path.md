# Suite 00 — Setup & Onboarding: Happy Path

**Phase:** 1
**Depends on:** None (this is the foundation)
**Fixture:** `fixtures/seed-data.yaml`
**Source:** UC-01, UC-02, UC-03, UC-04, UC-05, UC-08, UC-09, UC-10, UC-92, F-0.1, F-0.2, F-1.1–F-1.9

---

### HP-00-001: Create a business

**Priority:** P0
**Source:** UC-08, F-0.1, W-39, W-54
**Preconditions:** Fresh app, no existing data.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to the app's root URL, signed in but with no business yet
   VERIFY: A "Get started" screen shows a Create-business card and a Join-business card together — not a separate "click through" step
2. ACTION: Click "Create business" (lowercase, as rendered)
   VERIFY: Business creation form appears
3. ACTION: Enter business name: "FleetSettle Test Business"
4. ACTION: Confirm "Currency" (LKR) and "Timezone" (Asia/Colombo) fields — both present, both defaulted, and fixed forever after this form (W-54, `CreateBusinessForm.tsx`'s own comment: "never asked again")
5. ACTION: Submit
   VERIFY: Redirected to Home
   VERIFY: Home shows its empty state ("Nothing needs you today") until a vehicle exists — not a single dedicated "Add a vehicle" prompt card

**Assertions (post-test):**
- [ ] `Business` record created with correct name, timezone, currency
- [ ] `User` record created with `owner` role
- [ ] `UserBusinessRole` linking user to business
- [ ] `BusinessSettings` row created with auto-waive threshold = 0 (W-43)
- [ ] First `AccountingPeriod` created and open (covering current month)
- [ ] Settings and first period created in the same transaction
- [ ] Currency and timezone are not editable from any operational screen

---

### HP-00-002: Add a vehicle (daily lease arrangement)

**Priority:** P0
**Source:** UC-01, F-1.1, UC-92
**Preconditions:** Business exists (HP-00-001 passed).

**Steps (corrected 22 Aug 2026):**
1. ACTION: From the vehicle list, click "Add a vehicle" (opens a sheet titled "Add a vehicle")
2. ACTION: Enter registration: "BUS-5678"
3. ACTION: Select type: "Bus" (native picker, closed choice — Bus/Car/Van)
4. ACTION: Select default arrangement: "Daily lease" (Arrangement B — the three options read "Lease out"/"Daily lease"/"Trips / charter")
5. ACTION: Open the "Paperwork" disclosure (level 2, U-2 — optional) and enter insurance expiry: "2027-03-15", registration expiry: "2027-01-10"
6. ACTION: Click "Add vehicle" (the form's own submit label, not "Save")
   VERIFY: Vehicle appears in vehicle list

**Assertions (post-test):**
- [ ] `Vehicle` record created with registration "BUS-5678", type "bus"
- [ ] Arrangement set to `daily_lease`
- [ ] `VehicleDocument` records for insurance and registration expiry
- [ ] Vehicle set to arrangement B will later produce daily confirm cards
- [ ] Blank expiry dates would produce a home-screen prompt, not an error

---

### HP-00-003: Add a vehicle (lease out arrangement)

**Priority:** P0
**Source:** UC-01, F-1.1
**Preconditions:** Business exists (HP-00-001 passed).

**Steps (corrected 22 Aug 2026):**
1. ACTION: Click "Add a vehicle"
2. ACTION: Enter registration: "CAR-1234"
3. ACTION: Select type: "Car"
4. ACTION: Select default arrangement: "Lease out" (Arrangement A)
5. ACTION: Open the "Paperwork" disclosure and enter insurance expiry: "2027-06-30", registration expiry: "2027-02-28"
6. ACTION: Click "Add vehicle"
   VERIFY: Vehicle appears in vehicle list

**Assertions (post-test):**
- [ ] Vehicle arrangement is `lease_out`
- [ ] Vehicle set to arrangement A does NOT produce daily confirm cards
- [ ] Expiry dates stored correctly

---

### HP-00-004: Add a vehicle (operated arrangement)

**Priority:** P0
**Source:** UC-01, F-1.1
**Preconditions:** Business exists.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Click "Add a vehicle"
2. ACTION: Enter registration: "CAR-9012"
3. ACTION: Select type: "Car"
4. ACTION: Select default arrangement: "Trips / charter" (Arrangement C — not "Operated", that label doesn't exist in current source)
5. ACTION: Click "Add vehicle"
   VERIFY: Vehicle appears in vehicle list

**Assertions (post-test):**
- [ ] Vehicle arrangement is `operated`

---

### HP-00-005: Record vehicle ownership and contributions

**Priority:** P1
**Source:** UC-02, F-1.3
**Preconditions:** Vehicle CAR-1234 exists (HP-00-003 passed).

**Steps (corrected 22 Aug 2026 — relocated off the vehicle detail page entirely):**
1. ACTION: Navigate to More → Vehicle sharing (`PartnerSetupScreen.tsx`) — **not** on CAR-1234's own detail page
2. ACTION: Open "Set ownership shares" for CAR-1234
3. ACTION: Add owner "Nimesha Perera" with 60% share
4. ACTION: Add owner "Chaminda Silva" with 40% share
   VERIFY: Total shows 100%
5. ACTION: Enter contribution for Nimesha: 1,800,000
6. ACTION: Enter contribution for Chaminda: 1,200,000
7. ACTION: Submit
   VERIFY: Ownership saved successfully

**Assertions (post-test):**
- [ ] `OwnershipShare` records with correct percentages, effective-dated
- [ ] `CapitalContribution` records with correct amounts
- [ ] Difference between contribution and share persists without nagging
- [ ] INV-16: Shares total exactly 100%

---

### HP-00-006: Share a vehicle with a manager

**Priority:** P1
**Source:** UC-03, F-1.4, W-49, W-53
**Preconditions:** Vehicle exists, manager user exists.

**Steps (corrected 22 Aug 2026 — same relocation as HP-00-005, not on vehicle detail):**
1. ACTION: Navigate to More → Vehicle sharing
2. ACTION: Open "Share vehicle" for the target vehicle
3. ACTION: Select user "Kamal Fernando"
4. ACTION: Grant manage rights
5. ACTION: Optionally set monthly management fee: 10,000
6. ACTION: Submit
   VERIFY: Manager now listed on vehicle

**Assertions (post-test):**
- [ ] Manager has operational access (daily cards, trips, expenses, collections)
- [ ] Manager CANNOT perform write-offs, reversals, or period closes (W-49)
- [ ] Management fee recorded as vehicle cost to owner, income to manager (W-53)

---

### HP-00-007: Add a driver with rates

**Priority:** P0
**Source:** UC-04, F-1.6
**Preconditions:** Business exists.

**Steps (corrected 22 Aug 2026 — "Drivers" is not its own top-level section, it's a section within the shared "People" screen):**
1. ACTION: Navigate to People (`PeopleListScreen.tsx` — title "People", with "Drivers" and "Customers" as sections on the same screen, not separate destinations)
2. ACTION: Click "Add" → "Add a driver"
3. ACTION: Enter name: "Ruwan Jayasinghe"
4. ACTION: Enter phone: "+94771234567" (field labelled "Mobile")
5. ACTION: Enter driver day fee: 3,000 (money WE pay HIM per day)
6. ACTION: Enter driver trip fee: 9,000 (money WE pay HIM per trip)
7. ACTION: **No licence-expiry field exists anywhere in `web/src` as of 22 Aug 2026** — not on this form, not on driver detail. `PaperworkWarningRow`'s `docType: "licence"` is real on the read side (Home's paperwork alerts can render one), but nothing in the client writes it — skip this step
8. ACTION: Click "Add driver"
   VERIFY: Driver appears in driver list

**Assertions (post-test):**
- [ ] `Driver` record created with correct rates
- [ ] Rates will pre-fill trips and daily cards (U-3)
- [ ] **Not built (as of 22 Aug 2026)**: no client screen writes a driver's licence expiry, though the read side is real (`listExpiringDriverLicences`, `api/src/queries/home.ts`, feeds `PaperworkWarningRow`'s `docType: "licence"`) — worth a GAP filing if this is confirmed live rather than assumed from source
- [ ] Driver record exists and works without any login linked

---

### HP-00-008: Set up the daily lease arrangement

**Priority:** P0
**Source:** UC-05, F-1.7, W-7
**Preconditions:** Vehicle BUS-5678 exists, driver Ruwan exists.

**Steps (corrected 22 Aug 2026 — labels mostly already matched; trigger and submit button were the only drift):**
1. ACTION: Navigate to vehicle BUS-5678 → "Start daily lease" (`StartDailyLeaseScreen.tsx`, screen title shows the registration)
2. ACTION: Select driver: "Ruwan Jayasinghe" (field label "Driver")
3. ACTION: Select pattern: "Every day" (exact label, unchanged)
4. ACTION: Enter "Daily lease amount": 5,000 (money HE pays US per day)
5. ACTION: Set "Effective from": "2026-07-01"
6. ACTION: Leave "Last day" blank (open-ended)
7. ACTION: Click "Start daily lease" (the screen's own primary action, not "Save")
   VERIFY: Daily lease arrangement confirmed

**Assertions (post-test):**
- [ ] `DailyLeaseArrangement` created
- [ ] `DailyRate` effective-dated from 2026-07-01
- [ ] Daily cards will generate from effective date, on pattern days only
- [ ] Borne-by defaults come from W-7 (fuel → driver, repairs → us) with no per-vehicle config
- [ ] Setting an end date later stops generation without deleting past cards

---

### HP-00-009: Create a mileage package

**Priority:** P1
**Source:** UC-18, F-1.9, W-19
**Preconditions:** Business exists.

**Steps (corrected 22 Aug 2026 — there is no "Settings" screen at all in current source):**
1. ACTION: Navigate to More → Mileage packages
2. ACTION: Click "Add mileage package"
3. ACTION: Enter name: "Standard 100km"
4. ACTION: Enter daily km limit: 100
5. ACTION: Enter excess rate per km: 25
6. ACTION: Submit
   VERIFY: Package appears in the list

**Assertions (post-test):**
- [ ] `MileagePackage` record created
- [ ] Package is selectable when starting a rental (F-2.1)
- [ ] Editing the package later NEVER reprices an existing lease

---

### HP-00-010: Go live with opening balances

**Priority:** P0
**Source:** UC-09, F-0.2, W-51
**Preconditions:** Business, vehicles, and drivers exist.

**Steps:**
1. ACTION: Navigate to More → Opening balances (screen title "Opening balances")
2. ACTION: Set go-live date: "2026-07-01"
3. ACTION: For BUS-5678: current arrangement = daily lease, odometer = 125000, daily lease terms with original start date 2026-01-15
4. ACTION: For driver Ruwan: opening arrears = 12,000, amount owed to him = 0, deposit = 25,000
5. ACTION: Opening cash held by Chaminda: 40,000
6. ACTION: Click "Confirm and go live" (the screen's own primary action; a "Go live?" confirm dialog follows, same label on its own confirm button)
   VERIFY: Opening balances recorded

**Assertions (post-test):**
- [ ] `OpeningBalanceBatch` created with go-live date
- [ ] Opening entries NEVER appear as income or expense in any P&L
- [ ] Driver statement before go-live shows "brought forward" line
- [ ] Billing periods land on the correct day (15th) because original start date preserved
- [ ] Corrections allowed until first accounting period is closed

---

### HP-00-011: Add a customer (person)

**Priority:** P0
**Source:** UC-10, W-15, W-55
**Preconditions:** Business exists.

**Steps:**
1. ACTION: Navigate to People → "Customers" section (same shared screen as HP-00-007, not a separate destination)
2. ACTION: Click "Add" → "Add a customer"
3. ACTION: Select type: "Person" (exact label, unchanged)
4. ACTION: Enter name: "Anil Rajapaksa"
5. ACTION: Enter NIC: "199812345678"
6. ACTION: Enter mobile: "+94761111111"
7. ACTION: Enter address: "45 Temple Road, Colombo 6"
8. ACTION: Click "Add customer" (not "Save")
   VERIFY: Customer appears in customer list

**Assertions (post-test):**
- [ ] `Customer` record with type `person`
- [ ] Customer reusable for future rentals

---

### HP-00-012: Add a customer (organisation)

**Priority:** P1
**Source:** UC-10, W-55
**Preconditions:** Business exists.

**Steps:**
1. ACTION: Navigate to People → "Customers" section
2. ACTION: Click "Add" → "Add a customer"
3. ACTION: Select type: "Organisation" (exact label, unchanged)
4. ACTION: Enter name: "Royal College"
5. ACTION: Enter registration number: "ORG-2026-001"
6. ACTION: Enter contact person: "Mr. Bandara"
7. ACTION: Enter mobile: "+94763333333"
8. ACTION: Click "Add customer" (not "Save")
   VERIFY: Customer appears in customer list

**Assertions (post-test):**
- [ ] `Customer` record with type `organisation`
- [ ] NIC is NOT required for organisations (W-55)

---

### HP-00-013: Record vehicle paperwork expiry dates

**Priority:** P1
**Source:** UC-92, F-10.1, W-31
**Preconditions:** Vehicle exists.

**Steps (corrected 22 Aug 2026 — insurance/registration are set once at vehicle creation, not here; this case is really about the "Renew paperwork" flow, which also covers revenue licence, permit and emissions):**
1. ACTION: Navigate to the vehicle → "Vehicle actions" → "Renew paperwork" (sheet title "Renew paperwork") — or tap an existing entry directly under the vehicle's own "Paperwork" section
2. ACTION: Choose doc type: "Revenue licence" (chip choice among Insurance/Registration/Revenue licence/Permit/Emissions)
3. ACTION: Enter expiry: "2027-01-15" (field label is dynamic — "Revenue licence expiry")
4. ACTION: Optionally enter a "Reference"
5. ACTION: Click "Save paperwork"
   VERIFY: Expiry date recorded; repeat for insurance ("2027-06-30") and registration ("2027-02-28") as separate renewals through the same sheet if they weren't already set at creation (HP-00-002/003/004)

**Assertions (post-test):**
- [ ] `VehicleDocument` records with correct expiry dates
- [ ] System will warn 30 days before each expiry on home screen
- [ ] Warning persists until new date entered
