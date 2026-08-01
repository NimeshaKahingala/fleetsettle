import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

/** DM §7's CHECK on `day_record.lost_reason` — `on_charter` is deliberately absent (FL §4.1). */
export const lostReasonSchema = z.enum([
  "breakdown",
  "driver_day_off",
  "driver_ill",
  "public_holiday",
  "no_passengers",
  "other",
]);
export type LostReason = z.infer<typeof lostReasonSchema>;

const confirmDayBase = z.object({
  dailyLeaseId: uuidSchema,
  businessDate: businessDateSchema,
  note: z.string().trim().max(500).optional(),
});

/** F-4.2's one-tap path: earned and received both equal the rate in force — resolved server-side, never sent by the client. */
const paidInFullSchema = confirmDayBase.extend({
  action: z.literal("paid_in_full"),
});

/**
 * F-4.2's "something else": earned and received are separate facts (CLAUDE.md
 * → Money) — a cheap day (`earnedMinor` below the rate) and an unpaid or
 * short-paid day (`receivedMinor` below `earnedMinor`) are two different
 * things and both are entered explicitly, never inferred from one figure.
 */
const somethingElseSchema = confirmDayBase.extend({
  action: z.literal("something_else"),
  earnedMinor: moneyWireSchema,
  receivedMinor: moneyWireSchema,
});

/** F-4.4 / INV-6: `earned = 0`, no configuration can change it. */
const didNotRunSchema = confirmDayBase.extend({
  action: z.literal("did_not_run"),
  lostReason: lostReasonSchema,
});

/**
 * The `refine` for "received cannot exceed earned" runs after the
 * discriminated union so each branch stays a plain `ZodObject` — `discriminatedUnion`
 * inspects the literal `action` key on each member to pick a branch before any
 * validation runs, and a `.refine()`-wrapped member stops being an object
 * schema it can inspect that way.
 */
export const confirmDayRequestSchema = z
  .discriminatedUnion("action", [paidInFullSchema, somethingElseSchema, didNotRunSchema])
  .refine(
    (value) => value.action !== "something_else" || value.receivedMinor <= value.earnedMinor,
    {
      message:
        "receivedMinor cannot exceed earnedMinor — an amount received beyond what was earned today is credit (F-4.5), not part of confirming this day",
      path: ["receivedMinor"],
    },
  );
export type ConfirmDayRequest = z.infer<typeof confirmDayRequestSchema>;

/**
 * F-4.2's response. `receivedMinor` is not a `day_record` column (DM §1.3 —
 * it lives on the day's `obligation.settled_minor`) but is assembled here
 * regardless, since a caller reading this response never needs to know that
 * `earned` and `received` live in two different tables to use them as the
 * two separate facts they are.
 */
export const dayRecordResponseSchema = z.object({
  id: z.string().uuid(),
  dailyLeaseId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  businessDate: z.string(),
  state: z.enum([
    "open",
    "ran_paid_full",
    "ran_paid_short",
    "ran_unpaid",
    "did_not_run",
    "paused_for_trip",
  ]),
  earnedMinor: z.string(),
  expectedMinor: z.string(),
  receivedMinor: z.string(),
  lostReason: lostReasonSchema.nullable(),
  note: z.string().nullable(),
});
export type DayRecordResponse = z.infer<typeof dayRecordResponseSchema>;
