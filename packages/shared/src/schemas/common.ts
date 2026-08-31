import { z } from "zod";
import { asBusinessDate } from "../dates.js";
import { parse as parseMoney } from "../money.js";

/**
 * The two wire shapes every resource schema is built from (IG §1.5, §4.4,
 * §4.5): money crosses as a decimal string and parses straight to `Minor`,
 * a business date crosses as `YYYY-MM-DD` and parses straight to
 * `BusinessDate` — so a schema that uses these never re-introduces `number`
 * or a bare `Date` one call site at a time.
 */
/**
 * L-1, 31 Aug 2026: the regex now matches `money.ts`'s own `WIRE` pattern
 * exactly (`(?!-0+$)`, GAP-180/B7's own negative-zero exclusion), not the
 * looser one this schema had drifted to. Before this, `"-0"` passed *this*
 * regex, reached `.transform(parseMoney)`, and `parseMoney` threw a raw
 * `TypeError` from inside the transform — an exception, not a zod issue, so
 * `safeParse` never got the chance to turn it into a clean validation
 * error and it reached the generic handler as a 500. Rejecting it here
 * means `parseMoney` is never called with a value it would have thrown on.
 */
export const moneyWireSchema = z
  .string()
  .regex(/^(?!-0+$)-?\d+$/, "Not a money value — whole minor units as a decimal string")
  .transform(parseMoney);

/**
 * GAP-177/B21. Money that must be a real amount, not merely a valid one.
 *
 * Zero passes `moneyWireSchema` — it is a well-formed money value — and that
 * is correct for an accumulator column starting empty. It is wrong for an
 * amount a person typed, because a charter given away free must be recorded
 * at its full price with an explicit waiver, so it reaches UC-77's annual
 * "goodwill given" total (FL §5.73: *"the month shows the 340 charged and the
 * 340 waived"*). Entering `0` bypasses the very report the feature exists to
 * produce, and does it silently.
 *
 * **This is an input rule, never a column constraint.** The DB `CHECK` on
 * these columns stays `>= 0`: `insurance_claim.received_amount_minor` and
 * `incident_recovery.received_amount_minor` legitimately start at zero before
 * any money has arrived, and tightening the column would break claim
 * creation. Two different questions, two different floors.
 *
 * Was four private copies before this (`adjustment`, `write-off`,
 * `driver-money` and, with its own better-worded message, `opening-balance`).
 * The first three are now this one; `opening-balance` keeps its own, because
 * "An opening balance entry must be a positive amount" says more than a
 * generic message would and losing it would be a silent regression.
 */
export const positiveMoneyWireSchema = moneyWireSchema.refine((v) => v > 0n, {
  message: "amountMinor must be greater than zero",
});

export const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Not a business date — expected YYYY-MM-DD")
  .transform(asBusinessDate);

export const uuidSchema = z.string().uuid();

/**
 * GAP-12/A9b: the `voidExpense` request/response shape (`schemas/expense.ts`
 * `voidExpenseRequestSchema`/`voidedExpenseResponseSchema`), generalised —
 * every void endpoint across the remaining twelve W-50 tables sends and
 * returns exactly this, so one pair is shared rather than twelve identical
 * copies. `expense`'s own two stay as they are; nothing depends on them
 * matching this one by reference, only by shape.
 */
export const voidRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type VoidRequest = z.infer<typeof voidRequestSchema>;

export const voidedResponseSchema = z.object({
  id: uuidSchema,
  voidedAt: z.string(),
});
export type VoidedResponse = z.infer<typeof voidedResponseSchema>;
