import { z } from "zod";

/**
 * UC-08: name, currency and timezone, fixed here and never asked again
 * (W-54) — no operational screen ever edits these. `goLiveDate` is
 * deliberately absent: DM §3 sets `business.go_live_date` from UC-09's
 * opening-balance flow, not from creation.
 */
export const createBusinessRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  currencyCode: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1),
});
export type CreateBusinessRequest = z.infer<typeof createBusinessRequestSchema>;

export const businessResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  currencyCode: z.string(),
  timezone: z.string(),
  accountingPeriodId: z.string().uuid(),
});
export type BusinessResponse = z.infer<typeof businessResponseSchema>;
