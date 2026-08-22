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

**Steps:**
1. ACTION: Navigate to the app's root URL
   VERIFY: Sign-up / welcome screen is displayed
2. ACTION: Click "Create Business" or "Get Started"
   VERIFY: Business creation form appears
3. ACTION: Enter business name: "FleetSettle Test Business"
4. ACTION: Confirm timezone: "Asia/Colombo" (UTC+05:30)
5. ACTION: Confirm currency: "LKR"
6. ACTION: Click "Create" / "Confirm"
   VERIFY: Success notification displayed
   VERIFY: Redirected to empty home screen
   VERIFY: Home screen shows one action: "Add a vehicle" (or equivalent prompt)

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

**Steps:**
1. ACTION: From home screen, click "Add a vehicle"
   VERIFY: Vehicle creation form appears
2. ACTION: Enter registration: "BUS-5678"
3. ACTION: Select type: "Bus"
4. ACTION: Select default arrangement: "Daily lease" (Arrangement B)
5. ACTION: Enter insurance expiry: "2027-03-15"
6. ACTION: Enter registration expiry: "2027-01-10"
7. ACTION: Click "Save"
   VERIFY: Success notification
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

**Steps:**
1. ACTION: Navigate to "Add a vehicle"
2. ACTION: Enter registration: "CAR-1234"
3. ACTION: Select type: "Car"
4. ACTION: Select default arrangement: "Lease out" (Arrangement A)
5. ACTION: Enter insurance expiry: "2027-06-30"
6. ACTION: Enter registration expiry: "2027-02-28"
7. ACTION: Click "Save"
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

**Steps:**
1. ACTION: Navigate to "Add a vehicle"
2. ACTION: Enter registration: "CAR-9012"
3. ACTION: Select type: "Car"
4. ACTION: Select default arrangement: "Operated" (Arrangement C)
5. ACTION: Click "Save"
   VERIFY: Vehicle appears in vehicle list

**Assertions (post-test):**
- [ ] Vehicle arrangement is `operated`

---

### HP-00-005: Record vehicle ownership and contributions

**Priority:** P1
**Source:** UC-02, F-1.3
**Preconditions:** Vehicle CAR-1234 exists (HP-00-003 passed).

**Steps:**
1. ACTION: Navigate to vehicle CAR-1234 detail page
2. ACTION: Open "Ownership" section
3. ACTION: Add owner "Nimesha Perera" with 60% share
4. ACTION: Add owner "Chaminda Silva" with 40% share
   VERIFY: Total shows 100%
5. ACTION: Enter contribution for Nimesha: 1,800,000
6. ACTION: Enter contribution for Chaminda: 1,200,000
7. ACTION: Click "Save"
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

**Steps:**
1. ACTION: Navigate to vehicle detail page
2. ACTION: Click "Share with manager" or equivalent
3. ACTION: Select user "Kamal Fernando"
4. ACTION: Grant manage rights
5. ACTION: Optionally set monthly management fee: 10,000
6. ACTION: Click "Save"
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

**Steps:**
1. ACTION: Navigate to "Drivers" section
2. ACTION: Click "Add Driver"
3. ACTION: Enter name: "Ruwan Jayasinghe"
4. ACTION: Enter phone: "+94771234567"
5. ACTION: Enter driver day fee: 3,000 (money WE pay HIM per day)
6. ACTION: Enter driver trip fee: 9,000 (money WE pay HIM per trip)
7. ACTION: Enter licence expiry: "2027-12-31"
8. ACTION: Click "Save"
   VERIFY: Driver appears in driver list

**Assertions (post-test):**
- [ ] `Driver` record created with correct rates
- [ ] Rates will pre-fill trips and daily cards (U-3)
- [ ] Licence expiry joins paperwork warnings
- [ ] Driver record exists and works without any login linked

---

### HP-00-008: Set up the daily lease arrangement

**Priority:** P0
**Source:** UC-05, F-1.7, W-7
**Preconditions:** Vehicle BUS-5678 exists, driver Ruwan exists.

**Steps:**
1. ACTION: Navigate to vehicle BUS-5678
2. ACTION: Click "Set up daily lease" or equivalent
3. ACTION: Select driver: "Ruwan Jayasinghe"
4. ACTION: Select pattern: "Every day"
5. ACTION: Enter daily lease amount: 5,000 (money HE pays US per day)
6. ACTION: Set effective date: "2026-07-01"
7. ACTION: Leave end date blank (open-ended)
8. ACTION: Click "Save"
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

**Steps:**
1. ACTION: Navigate to Settings → Mileage Packages
2. ACTION: Click "Add Package"
3. ACTION: Enter name: "Standard 100km"
4. ACTION: Enter daily km limit: 100
5. ACTION: Enter excess rate per km: 25
6. ACTION: Click "Save"
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
1. ACTION: Navigate to "Go Live" / "Opening Balances" section
2. ACTION: Set go-live date: "2026-07-01"
3. ACTION: For BUS-5678: current arrangement = daily lease, odometer = 125000, daily lease terms with original start date 2026-01-15
4. ACTION: For driver Ruwan: opening arrears = 12,000, amount owed to him = 0, deposit = 25,000
5. ACTION: Opening cash held by Chaminda: 40,000
6. ACTION: Click "Confirm" / "Go Live"
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
1. ACTION: Navigate to "Customers" section
2. ACTION: Click "Add Customer"
3. ACTION: Select type: "Person"
4. ACTION: Enter name: "Anil Rajapaksa"
5. ACTION: Enter NIC: "199812345678"
6. ACTION: Enter mobile: "+94761111111"
7. ACTION: Enter address: "45 Temple Road, Colombo 6"
8. ACTION: Click "Save"
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
1. ACTION: Navigate to "Customers" section
2. ACTION: Click "Add Customer"
3. ACTION: Select type: "Organisation"
4. ACTION: Enter name: "Royal College"
5. ACTION: Enter registration number: "ORG-2026-001"
6. ACTION: Enter contact person: "Mr. Bandara"
7. ACTION: Enter mobile: "+94763333333"
8. ACTION: Click "Save"
   VERIFY: Customer appears in customer list

**Assertions (post-test):**
- [ ] `Customer` record with type `organisation`
- [ ] NIC is NOT required for organisations (W-55)

---

### HP-00-013: Record vehicle paperwork expiry dates

**Priority:** P1
**Source:** UC-92, F-10.1, W-31
**Preconditions:** Vehicle exists.

**Steps:**
1. ACTION: Navigate to vehicle detail page
2. ACTION: Open "Documents" / "Paperwork" section
3. ACTION: Enter insurance expiry: "2027-06-30"
4. ACTION: Enter registration expiry: "2027-02-28"
5. ACTION: Enter revenue licence expiry: "2027-01-15"
6. ACTION: Click "Save"
   VERIFY: Expiry dates recorded

**Assertions (post-test):**
- [ ] `VehicleDocument` records with correct expiry dates
- [ ] System will warn 30 days before each expiry on home screen
- [ ] Warning persists until new date entered
