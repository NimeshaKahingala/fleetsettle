import { z } from "zod";
import { moneyWireSchema } from "./common.js";

/**
 * F-1.9/UC-18: a saved rate package, picked at F-2.1 step 4 as one of its
 * named chips (`Standard 100` · `Long 150` · `Custom`). The lease that picks
 * one takes its own independent copy (`Lease.mileage_terms`) — editing or
 * archiving a package here never reprices or touches a lease already using
 * it (F-1.9's own Accept clause).
 */
export const createMileagePackageRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  dailyLimitKm: z.number().int().positive(),
  excessRateMinorPerKm: moneyWireSchema,
});
export type CreateMileagePackageRequest = z.infer<typeof createMileagePackageRequestSchema>;

export const mileagePackageResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
  dailyLimitKm: z.number().int(),
  excessRateMinorPerKm: z.string(),
  archivedAt: z.string().nullable(),
});
export type MileagePackageResponse = z.infer<typeof mileagePackageResponseSchema>;

/** Every package regardless of archived state — F-2.1's chip list filters to active ones itself; a lease already using an archived package still needs to be able to show its name elsewhere. */
export const listMileagePackagesResponseSchema = z.array(mileagePackageResponseSchema);
export type ListMileagePackagesResponse = z.infer<typeof listMileagePackagesResponseSchema>;
