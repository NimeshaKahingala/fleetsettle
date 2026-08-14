import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Mirrors `migrations/0001_initial_schema.sql`, which mirrors `data-model.md`
 * — that document owns the schema; this file exists only so `queries/` gets
 * typed query building (IG §1.6, §3.1). It is not the source of truth and it
 * does not generate migrations: the exclusion constraints, partial unique
 * indexes and CHECKs that carry the real invariants live in the migration
 * SQL and are not re-declared here.
 *
 * Grows one table at a time, as the phase that needs it is built — not a
 * transcription of all fifty-some tables up front.
 */

export const business = pgTable("business", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  currencyCode: char("currency_code", { length: 3 }).notNull(),
  timezone: text("timezone").notNull(),
  goLiveDate: date("go_live_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const businessSettings = pgTable("business_settings", {
  businessId: uuid("business_id").primaryKey(),
  autoWaiveThresholdMinor: bigint("auto_waive_threshold_minor", { mode: "bigint" })
    .notNull()
    .default(0n),
  depositHoldDays: integer("deposit_hold_days").notNull().default(30),
  holdExpiryDays: integer("hold_expiry_days").notNull().default(7), // D-13/GAP-7, migration 0020
  paperworkWarnDays: integer("paperwork_warn_days").notNull().default(30),
  secondLanguage: text("second_language"),
  messagingKillSwitch: boolean("messaging_kill_switch").notNull().default(false),
  sendWindowStart: time("send_window_start").notNull().default("08:00:00"),
  sendWindowEnd: time("send_window_end").notNull().default("20:00:00"),
});

export const accountingPeriod = pgTable("accounting_period", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  status: text("status").notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  closedBy: uuid("closed_by"),
});

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey(),
  asgardeoSub: text("asgardeo_sub").notNull(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const businessMember = pgTable("business_member", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
});

// A11/W-57, migration 0010.
export const businessMemberInvite = pgTable("business_member_invite", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  role: text("role").notNull(),
  codeHash: text("code_hash").notNull(),
  createdBy: uuid("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
  consumedBy: uuid("consumed_by"),
});

export const vehicle = pgTable("vehicle", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  registration: text("registration").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  lifecycle: text("lifecycle").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const vehicleArrangement = pgTable("vehicle_arrangement", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  arrangement: char("arrangement", { length: 1 }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
});

export const vehicleDocument = pgTable("vehicle_document", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  docType: text("doc_type").notNull(),
  expiryDate: date("expiry_date", { mode: "string" }).notNull(),
  reference: text("reference"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const customer = pgTable("customer", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  customerType: text("customer_type").notNull(),
  name: text("name").notNull(),
  nic: text("nic"),
  registrationNo: text("registration_no"),
  contactPerson: text("contact_person"),
  mobile: text("mobile"),
  address: text("address"),
  language: text("language").notNull().default("en"),
  optedInAt: timestamp("opted_in_at", { withTimezone: true, mode: "string" }),
  numberVerifiedAt: timestamp("number_verified_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  // GAP-36/W-58, migration 0023. No endpoint writes these yet (Wave 5/A9b).
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

export const driver = pgTable("driver", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  name: text("name").notNull(),
  mobile: text("mobile"),
  driverDayFeeMinor: bigint("driver_day_fee_minor", { mode: "bigint" }),
  driverTripFeeMinor: bigint("driver_trip_fee_minor", { mode: "bigint" }),
  licenceExpiry: date("licence_expiry", { mode: "string" }),
  linkedUserId: uuid("linked_user_id"),
  language: text("language").notNull().default("en"),
  optedInAt: timestamp("opted_in_at", { withTimezone: true, mode: "string" }),
  numberVerifiedAt: timestamp("number_verified_at", { withTimezone: true, mode: "string" }),
  settlementRhythm: text("settlement_rhythm").notNull().default("daily"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  // GAP-36/W-58, migration 0023. No endpoint writes these yet (Wave 5/A9b).
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

// W-42, migration 0001 — existed unused until A11 gave it a writer.
export const driverLinkInvite = pgTable("driver_link_invite", {
  id: uuid("id").primaryKey(),
  driverId: uuid("driver_id").notNull(),
  codeHash: text("code_hash").notNull(),
  createdBy: uuid("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
  consumedBy: uuid("consumed_by"),
});

export const mileagePackage = pgTable("mileage_package", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  name: text("name").notNull(),
  dailyLimitKm: integer("daily_limit_km").notNull(),
  excessRateMinorPerKm: bigint("excess_rate_minor_per_km", { mode: "bigint" }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "string" }),
});

export const lease = pgTable("lease", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  status: text("status").notNull().default("draft"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  billingDay: integer("billing_day").notNull(),
  rentAmountMinor: bigint("rent_amount_minor", { mode: "bigint" }).notNull(),
  mileageDailyLimitKm: integer("mileage_daily_limit_km"),
  mileageExcessRateMinor: bigint("mileage_excess_rate_minor", { mode: "bigint" }),
  reminderDaysBefore: integer("reminder_days_before").notNull().default(3),
  closingDate: date("closing_date", { mode: "string" }),
  finalPeriodTreatment: text("final_period_treatment"),
  closureSummaryShownAt: timestamp("closure_summary_shown_at", {
    withTimezone: true,
    mode: "string",
  }),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const billingPeriod = pgTable("billing_period", {
  id: uuid("id").primaryKey(),
  leaseId: uuid("lease_id").notNull(),
  seq: integer("seq").notNull(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  // GENERATED ALWAYS AS (period_end - period_start + 1) STORED — the DB
  // computes this; not part of P2, first written by P5, which is a better
  // point to model Drizzle's generated-column support against a real insert.
  daysCount: integer("days_count"),
  rentAmountMinor: bigint("rent_amount_minor", { mode: "bigint" }).notNull(),
  allowanceKm: integer("allowance_km"),
});

export const odometerReading = pgTable("odometer_reading", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  readingKm: integer("reading_km").notNull(),
  readOn: date("read_on", { mode: "string" }).notNull(),
  source: text("source").notNull(),
  leaseId: uuid("lease_id"),
  tripId: uuid("trip_id"),
  attachmentId: uuid("attachment_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const mileageAssessment = pgTable("mileage_assessment", {
  id: uuid("id").primaryKey(),
  leaseId: uuid("lease_id").notNull(),
  businessId: uuid("business_id").notNull(),
  fromReadingId: uuid("from_reading_id"),
  toReadingId: uuid("to_reading_id").notNull(),
  drivenKm: integer("driven_km").notNull(),
  combinedAllowanceKm: integer("combined_allowance_km").notNull(),
  excessKm: integer("excess_km").notNull(),
  excessAmountMinor: bigint("excess_amount_minor", { mode: "bigint" }).notNull(),
  isEstimated: boolean("is_estimated").notNull().default(false),
  status: text("status").notNull().default("final"),
  supersededById: uuid("superseded_by_id"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
});

export const mileageAssessmentSplit = pgTable("mileage_assessment_split", {
  id: uuid("id").primaryKey(),
  assessmentId: uuid("assessment_id").notNull(),
  billingPeriodId: uuid("billing_period_id").notNull(),
  apportionedKm: integer("apportioned_km").notNull(),
  apportionedExcessMinor: bigint("apportioned_excess_minor", { mode: "bigint" }).notNull(),
});

export const dailyLease = pgTable("daily_lease", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  driverId: uuid("driver_id").notNull(),
  patternType: text("pattern_type").notNull(),
  patternWeekdays: smallint("pattern_weekdays").array(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
});

export const dailyLeaseRate = pgTable("daily_lease_rate", {
  id: uuid("id").primaryKey(),
  dailyLeaseId: uuid("daily_lease_id").notNull(),
  dailyLeaseAmountMinor: bigint("daily_lease_amount_minor", { mode: "bigint" }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
});

export const trip = pgTable("trip", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  customerId: uuid("customer_id"),
  driverId: uuid("driver_id"),
  status: text("status").notNull().default("hold"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  destination: text("destination"),
  agreedAmountMinor: bigint("agreed_amount_minor", { mode: "bigint" }).notNull().default(0n),
  driverFeeMinor: bigint("driver_fee_minor", { mode: "bigint" }).notNull().default(0n),
  openingOdometerId: uuid("opening_odometer_id"),
  closingOdometerId: uuid("closing_odometer_id"),
  closingDate: date("closing_date", { mode: "string" }),
  cancelReason: text("cancel_reason"),
  advanceDisposition: text("advance_disposition"),
  holdExpiresOn: date("hold_expires_on", { mode: "string" }), // D-13/GAP-7, migration 0020
  postedPeriodId: uuid("posted_period_id"),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const vehicleDayAllocation = pgTable("vehicle_day_allocation", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  arrangement: char("arrangement", { length: 1 }).notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  isHold: boolean("is_hold").notNull().default(false),
  // D-11/W-58, migration 0022: voided, never deleted.
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

/** F-1.10/GAP-26, migration 0019. Vehicle-level and arrangement-agnostic — see the migration's own header for why it does not duplicate `incident.off_road_from/to` or re-partition `day_record`'s own states. */
export const vehicleUnavailability = pgTable("vehicle_unavailability", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  reason: text("reason").notNull(),
  unavailableFrom: date("unavailable_from", { mode: "string" }).notNull(),
  unavailableTo: date("unavailable_to", { mode: "string" }),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

export const openingBalanceBatch = pgTable("opening_balance_batch", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  goLiveDate: date("go_live_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("draft"),
  committedAt: timestamp("committed_at", { withTimezone: true, mode: "string" }),
});

export const openingBalanceEntry = pgTable("opening_balance_entry", {
  id: uuid("id").primaryKey(),
  batchId: uuid("batch_id").notNull(),
  kind: text("kind").notNull(),
  partyCustomerId: uuid("party_customer_id"),
  partyDriverId: uuid("party_driver_id"),
  partyUserId: uuid("party_user_id"),
  vehicleId: uuid("vehicle_id"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  originalDueDate: date("original_due_date", { mode: "string" }),
  // D-11/W-58, migration 0022: voided, never deleted — "replaced wholesale"
  // now means every live entry is voided, then the corrected set inserted.
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

// GAP-103/migration 0014: the only durable link between one opening_balance_entry
// and whatever it materialised elsewhere (obligation/deposit_movement/advance/
// payment) — not itself a money table (see the migration's own header).
export const openingBalancePosting = pgTable("opening_balance_posting", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  batchId: uuid("batch_id").notNull(),
  entryKind: text("entry_kind").notNull(),
  targetTable: text("target_table").notNull(),
  targetId: uuid("target_id").notNull(),
  depositId: uuid("deposit_id"),
  reversedAt: timestamp("reversed_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const dayRecord = pgTable("day_record", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  dailyLeaseId: uuid("daily_lease_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  driverId: uuid("driver_id").notNull(),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  state: text("state").notNull().default("open"),
  earnedMinor: bigint("earned_minor", { mode: "bigint" }).notNull().default(0n),
  expectedMinor: bigint("expected_minor", { mode: "bigint" }).notNull(),
  lostReason: text("lost_reason"),
  tripId: uuid("trip_id"),
  note: text("note"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  // D-11/W-58, migration 0022: voided, never deleted — a stale future card
  // (a driver or arrangement change) is voided rather than mutated in place.
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

/** GAP-20, migration 0018. An excepted date never becomes a day_record — its absence is the record, the same convention an off-pattern day already uses (§1.2 B). */
export const leaseDayException = pgTable("lease_day_exception", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  dailyLeaseId: uuid("daily_lease_id").notNull(),
  exceptionDate: date("exception_date", { mode: "string" }).notNull(),
  reason: text("reason"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

export const obligation = pgTable("obligation", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  direction: text("direction").notNull(),
  partyType: text("party_type").notNull(),
  partyCustomerId: uuid("party_customer_id"),
  partyDriverId: uuid("party_driver_id"),
  partyUserId: uuid("party_user_id"),
  kind: text("kind").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id"),
  vehicleId: uuid("vehicle_id"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  settledMinor: bigint("settled_minor", { mode: "bigint" }).notNull().default(0n),
  waivedMinor: bigint("waived_minor", { mode: "bigint" }).notNull().default(0n),
  dueOn: date("due_on", { mode: "string" }).notNull(),
  effectiveDueOn: date("effective_due_on", { mode: "string" }).notNull(),
  status: text("status").notNull().default("pending"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const payment = pgTable("payment", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  direction: text("direction").notNull(),
  partyType: text("party_type").notNull(),
  partyCustomerId: uuid("party_customer_id"),
  partyDriverId: uuid("party_driver_id"),
  partyUserId: uuid("party_user_id"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  method: text("method"),
  handledByUserId: uuid("handled_by_user_id"),
  reference: text("reference"),
  status: text("status").notNull().default("active"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const paymentAllocation = pgTable("payment_allocation", {
  id: uuid("id").primaryKey(),
  paymentId: uuid("payment_id").notNull(),
  obligationId: uuid("obligation_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  allocatedOn: date("allocated_on", { mode: "string" }).notNull(),
  // D-11/W-58, migration 0022: voided, never deleted.
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

export const expense = pgTable("expense", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id"),
  tripId: uuid("trip_id"),
  incidentId: uuid("incident_id"),
  category: text("category").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  spentOn: date("spent_on", { mode: "string" }).notNull(),
  borneBy: text("borne_by").notNull(),
  borneByDriverId: uuid("borne_by_driver_id"),
  borneByCustomerId: uuid("borne_by_customer_id"),
  paidByUserId: uuid("paid_by_user_id"),
  litres: numeric("litres", { precision: 8, scale: 2, mode: "number" }),
  odometerReadingId: uuid("odometer_reading_id"),
  attachmentId: uuid("attachment_id"),
  note: text("note"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const adjustment = pgTable("adjustment", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  obligationId: uuid("obligation_id").notNull(),
  adjustmentType: text("adjustment_type").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  sign: smallint("sign").notNull(),
  reason: text("reason"),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(), // GAP-73, migration 0017
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const offsetRecord = pgTable("offset_record", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  driverId: uuid("driver_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  note: text("note"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const offsetAllocation = pgTable("offset_allocation", {
  id: uuid("id").primaryKey(),
  offsetId: uuid("offset_id").notNull(),
  obligationId: uuid("obligation_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  // GAP-12/W-58, migration 0024: structurally identical to payment_allocation
  // (§10.2), which got this trio in 0022 — this table never had.
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});

export const deposit = pgTable("deposit", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  partyType: text("party_type").notNull(),
  partyCustomerId: uuid("party_customer_id"),
  partyDriverId: uuid("party_driver_id"),
  leaseId: uuid("lease_id"),
  dailyLeaseId: uuid("daily_lease_id"),
  status: text("status").notNull().default("held"),
  holdReleaseDate: date("hold_release_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const depositMovement = pgTable("deposit_movement", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  depositId: uuid("deposit_id").notNull(),
  movementType: text("movement_type").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  reason: text("reason"),
  obligationId: uuid("obligation_id"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const advance = pgTable("advance", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  driverId: uuid("driver_id").notNull(),
  tripId: uuid("trip_id"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  issuedOn: date("issued_on", { mode: "string" }).notNull(),
  issuedByUserId: uuid("issued_by_user_id"),
  status: text("status").notNull().default("open"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

export const advanceSettlement = pgTable("advance_settlement", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  advanceId: uuid("advance_id").notNull(),
  kind: text("kind").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  expenseId: uuid("expense_id"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** UC-02/INV-16: no `business_id` — scoped via `vehicle_id` → `vehicle.business_id`, the same as `vehicle_arrangement`. Effective-dated; `assert_shares_total()` (a deferred constraint trigger, migration 0001) is the truth that every date's shares sum to 10000 bp, not application code. */
export const ownershipShare = pgTable("ownership_share", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  userId: uuid("user_id").notNull(),
  shareBp: integer("share_bp").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
});

/** UC-02/W-52: what a partner PAID, distinct from what he OWNS (`ownership_share`) — the gap between the two is a claim, never a bigger slice. */
export const capitalContribution = pgTable("capital_contribution", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id"),
  userId: uuid("user_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  contributedOn: date("contributed_on", { mode: "string" }).notNull(),
  note: text("note"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** UC-03/W-53: a vehicle cost to the owner, income to the manager. No `business_id` — scoped via `vehicle_id`, the same as `ownership_share`. Effective-dated; revoke sets `effective_to` rather than deleting the row (F-1.4: "a revoked manager's records remain attributed to them"). */
export const managementFeeAgreement = pgTable("management_fee_agreement", {
  id: uuid("id").primaryKey(),
  vehicleId: uuid("vehicle_id").notNull(),
  managerUserId: uuid("manager_user_id").notNull(),
  monthlyAmountMinor: bigint("monthly_amount_minor", { mode: "bigint" }).notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
});

/** F-7.4/UC-65/INV-23: `discrepancy_minor` is a generated column (`recorded - counted`) — never computed twice. A pooled shortfall belongs here, on the banking event itself, never guessed onto a specific receipt. */
export const bankingEvent = pgTable("banking_event", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  fromUserId: uuid("from_user_id").notNull(),
  amountRecordedMinor: bigint("amount_recorded_minor", { mode: "bigint" }).notNull(),
  amountCountedMinor: bigint("amount_counted_minor", { mode: "bigint" }).notNull(),
  bankedOn: date("banked_on", { mode: "string" }).notNull(),
  destination: text("destination").notNull(),
  reference: text("reference"),
  // GENERATED ALWAYS AS (amount_recorded_minor - amount_counted_minor) STORED
  // (migration 0001) — read-only; never set through an insert/update here.
  discrepancyMinor: bigint("discrepancy_minor", { mode: "bigint" }),
  discrepancyBearer: text("discrepancy_bearer"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** F-7.2/UC-63: never a cost of the vehicle — a payout to a partner, or a settlement between them. */
export const partnerPayout = pgTable("partner_payout", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  userId: uuid("user_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  kind: text("kind").notNull(),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** F-3.4/UC-12/§6.6: the container. No `posted_period_id` of its own — it is not money, the `expense`/`incident_recovery` rows attached to it are. */
export const incident = pgTable("incident", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  vehicleId: uuid("vehicle_id").notNull(),
  leaseId: uuid("lease_id"),
  status: text("status").notNull().default("open"),
  occurredOn: date("occurred_on", { mode: "string" }).notNull(),
  description: text("description"),
  offRoadFrom: date("off_road_from", { mode: "string" }),
  offRoadTo: date("off_road_to", { mode: "string" }),
  rentTreatment: text("rent_treatment"),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
});

/** D-7/W-9 'extend': its own record rather than inferred from two timestamps — "why does this lease run 12 days long" needs exactly one answer. */
export const leaseExtension = pgTable("lease_extension", {
  id: uuid("id").primaryKey(),
  leaseId: uuid("lease_id").notNull(),
  incidentId: uuid("incident_id").notNull(),
  daysAdded: integer("days_added").notNull(),
  appliedOn: date("applied_on", { mode: "string" }).notNull(),
  previousEndDate: date("previous_end_date", { mode: "string" }),
  newEndDate: date("new_end_date", { mode: "string" }).notNull(),
  createdBy: uuid("created_by"),
});

/** W-11: optional, off by default. `businessId` added by migration 0004 — `write_audit_log()` reads `NEW.business_id` unconditionally on every table carrying `posted_period_id`. */
export const insuranceClaim = pgTable("insurance_claim", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  incidentId: uuid("incident_id").notNull(),
  claimedAmountMinor: bigint("claimed_amount_minor", { mode: "bigint" }).notNull(),
  excessBorneMinor: bigint("excess_borne_minor", { mode: "bigint" }).notNull().default(0n),
  status: text("status").notNull(),
  receivedAmountMinor: bigint("received_amount_minor", { mode: "bigint" }).default(0n),
  receivedOn: date("received_on", { mode: "string" }),
  postedPeriodId: uuid("posted_period_id").notNull(),
  receivedPeriodId: uuid("received_period_id"),
});

/** W-10/W-11: money EXPECTED until it arrives, never earned. Two period columns (`posted`/`received`) because the month agreed and the month it lands routinely differ (§7.2) — one column cannot say both. `businessId` added by migration 0004, same reason as `insurance_claim`. */
export const incidentRecovery = pgTable("incident_recovery", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  incidentId: uuid("incident_id").notNull(),
  source: text("source").notNull(),
  agreedAmountMinor: bigint("agreed_amount_minor", { mode: "bigint" }).notNull(),
  receivedAmountMinor: bigint("received_amount_minor", { mode: "bigint" }).notNull().default(0n),
  obligationId: uuid("obligation_id"),
  note: text("note"),
  postedPeriodId: uuid("posted_period_id").notNull(),
  receivedPeriodId: uuid("received_period_id"),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** W-50/INV-28/UC-97, migration 0002's writer. Read-only from the app's side — every row is written by `write_audit_log()`, never by a query in this codebase. `id` is `bigserial`, the one place this schema uses it rather than a uuid, since an audit row never appears in a URL (DM §12). */
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  businessId: uuid("business_id").notNull(),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id").notNull(),
  action: text("action").notNull(),
  changedBy: uuid("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
});

/** UC-93/W-36/W-37: a correction references the original payment; it never edits it away (INV-21) — `payment.amount_minor`/`status` are what actually change (see `updatePaymentAfterCorrection`), this row is the recorded reason and decision behind that change. */
export const paymentCorrection = pgTable("payment_correction", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  differenceMinor: bigint("difference_minor", { mode: "bigint" }).notNull(),
  bearer: text("bearer").notNull(),
  reason: text("reason").notNull(),
  receiptMessageId: uuid("receipt_message_id"),
  correctedOn: date("corrected_on", { mode: "string" }).notNull(),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
});

/** F-8.3/UC-90/W-28: a loss you were handed, never pooled with a waiver (INV-14). `obligation_id` is nullable — most write-offs clear a specific outstanding due, but a standalone loss with no matching obligation row is real too (an opening-balance-derived figure, for one). */
export const writeOff = pgTable("write_off", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  obligationId: uuid("obligation_id"),
  partyType: text("party_type").notNull(),
  partyCustomerId: uuid("party_customer_id"),
  partyDriverId: uuid("party_driver_id"),
  vehicleId: uuid("vehicle_id"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(),
  writtenOffOn: date("written_off_on", { mode: "string" }).notNull(),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  createdBy: uuid("created_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** INV-15: a later payment nets against the write-off it recovers — never fresh income. `paymentId` is the actual money arriving (recorded through the ordinary payment mechanism, deliberately never allocated against any obligation — see domain/write-off.ts); this row is what marks that payment as a recovery rather than new revenue. `businessId` added by migration 0004, same reason as several of P8's tables. */
export const writeOffRecovery = pgTable("write_off_recovery", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  writeOffId: uuid("write_off_id").notNull(),
  paymentId: uuid("payment_id").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  postedPeriodId: uuid("posted_period_id").notNull(),
  belongsToPeriodId: uuid("belongs_to_period_id"),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
  replacesId: uuid("replaces_id"), // GAP-60/D-16, migration 0021
});

/** A7/GAP-16, migration 0013. Not a money table (no posted_period_id) — deliberately outside assert_period_open() and write_audit_log(), see 0013's header. subject_type/subject_id is polymorphic and carries no FK; the kind/subject_type pair and content_type are constrained in SQL, not here. */
export const attachment = pgTable("attachment", {
  id: uuid("id").primaryKey(),
  businessId: uuid("business_id").notNull(),
  kind: text("kind").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  uploadedBy: uuid("uploaded_by"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  voidedAt: timestamp("voided_at", { withTimezone: true, mode: "string" }),
  voidedReason: text("voided_reason"),
  voidedBy: uuid("voided_by"),
});
