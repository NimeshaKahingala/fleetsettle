import { z } from "zod";
import { businessDateSchema, moneyWireSchema, uuidSchema } from "./common.js";

export const incidentStatusSchema = z.enum([
  "open",
  "repairs_recorded",
  "recovery_pending",
  "closed",
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

/** W-9's three choices, "for this incident only" — `continue` is the default, the safe do-nothing path. */
export const rentTreatmentSchema = z.enum(["continue", "credit_days", "extend"]);
export type RentTreatment = z.infer<typeof rentTreatmentSchema>;

/** F-3.4 step 1/UC-12: the container, opened with its minimal fields — everything after is a separate edit (§6.6). */
export const openIncidentRequestSchema = z.object({
  vehicleId: uuidSchema,
  leaseId: uuidSchema.optional(),
  occurredOn: businessDateSchema,
  description: z.string().trim().max(1000).optional(),
});
export type OpenIncidentRequest = z.infer<typeof openIncidentRequestSchema>;

export const incidentResponseSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  leaseId: z.string().uuid().nullable(),
  status: incidentStatusSchema,
  occurredOn: z.string(),
  description: z.string().nullable(),
  offRoadFrom: z.string().nullable(),
  offRoadTo: z.string().nullable(),
  rentTreatment: rentTreatmentSchema.nullable(),
  closedAt: z.string().nullable(),
});
export type IncidentResponse = z.infer<typeof incidentResponseSchema>;

/** F-3.4 step 2/W-9: the off-road window and the rent treatment, entered together. */
export const recordOffRoadRequestSchema = z
  .object({
    offRoadFrom: businessDateSchema,
    offRoadTo: businessDateSchema,
    rentTreatment: rentTreatmentSchema,
  })
  .refine((v) => v.offRoadTo >= v.offRoadFrom, {
    message: "offRoadTo cannot be before offRoadFrom",
    path: ["offRoadTo"],
  });
export type RecordOffRoadRequest = z.infer<typeof recordOffRoadRequestSchema>;

export const recordOffRoadResponseSchema = z.object({
  incident: incidentResponseSchema,
  leaseExtensionId: z.string().uuid().optional(),
  adjustmentId: z.string().uuid().optional(),
});
export type RecordOffRoadResponse = z.infer<typeof recordOffRoadResponseSchema>;

export const incidentRecoverySourceSchema = z.enum(["customer", "insurer"]);
export type IncidentRecoverySource = z.infer<typeof incidentRecoverySourceSchema>;

export const incidentRecoveryResponseSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  source: incidentRecoverySourceSchema,
  agreedAmountMinor: z.string(),
  receivedAmountMinor: z.string(),
  // GAP-60/D-16/F-8.6: "what corrected this?", answered from the record.
  replacesId: z.string().uuid().nullable(),
  voidedAt: z.string().nullable(),
  voidedReason: z.string().nullable(),
});
export type IncidentRecoveryResponse = z.infer<typeof incidentRecoveryResponseSchema>;

/** F-3.4 step 4/W-10: negotiated after the repair cost is known — an agreed amount plus a note, entered whenever that agreement happens. */
export const recordCustomerContributionRequestSchema = z.object({
  agreedAmountMinor: moneyWireSchema,
  agreedOn: businessDateSchema,
  note: z.string().trim().max(500).optional(),
  // GAP-60/D-16/F-8.5: set when this contribution is the corrected
  // replacement for one already voided — the target must belong to this
  // business and already be voided, checked server-side.
  replacesId: uuidSchema.optional(),
});
export type RecordCustomerContributionRequest = z.infer<
  typeof recordCustomerContributionRequestSchema
>;

/** F-3.4 steps 4/5: the money actually arriving, against a customer's own recovery row. */
export const recordRecoveryReceivedRequestSchema = z.object({
  receivedAmountMinor: moneyWireSchema,
  receivedOn: businessDateSchema,
});
export type RecordRecoveryReceivedRequest = z.infer<typeof recordRecoveryReceivedRequestSchema>;

export const insuranceClaimStatusSchema = z.enum([
  "submitted",
  "in_progress",
  "settled",
  "rejected",
]);
export type InsuranceClaimStatus = z.infer<typeof insuranceClaimStatusSchema>;

/** F-3.4 step 5/W-11: hidden unless enabled — major damage only. */
export const submitInsuranceClaimRequestSchema = z.object({
  claimedAmountMinor: moneyWireSchema,
  excessBorneMinor: moneyWireSchema.optional(),
  claimedOn: businessDateSchema,
  // GAP-60/D-16/F-8.5: set when the paired incident_recovery row (source
  // 'insurer') this submission opens is the corrected replacement for one
  // already voided — see recordCustomerContributionRequestSchema's own
  // comment. Not echoed on this route's own response: it names the
  // recovery row, and this response is the claim's own shape only.
  replacesId: uuidSchema.optional(),
});
export type SubmitInsuranceClaimRequest = z.infer<typeof submitInsuranceClaimRequestSchema>;

export const insuranceClaimResponseSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string().uuid(),
  claimedAmountMinor: z.string(),
  excessBorneMinor: z.string(),
  status: insuranceClaimStatusSchema,
  receivedAmountMinor: z.string().nullable(),
  receivedOn: z.string().nullable(),
});
export type InsuranceClaimResponse = z.infer<typeof insuranceClaimResponseSchema>;

/** F-3.4 step 5, later — until it arrives it is pending recovery, never income (W-10/W-11). */
export const settleInsuranceClaimRequestSchema = z.object({
  receivedAmountMinor: moneyWireSchema,
  receivedOn: businessDateSchema,
  status: z.enum(["settled", "rejected"]).optional(),
});
export type SettleInsuranceClaimRequest = z.infer<typeof settleInsuranceClaimRequestSchema>;

export const settledInsuranceClaimResponseSchema = z.object({
  claim: insuranceClaimResponseSchema,
  recovery: incidentRecoveryResponseSchema.optional(),
});
export type SettledInsuranceClaimResponse = z.infer<typeof settledInsuranceClaimResponseSchema>;

/** F-3.4 step 6/UC-12: "total repair cost, total recovered, still expected, and net cost to you" — a live snapshot, never the month-by-month report (P11's). */
export const incidentBottomLineSchema = z.object({
  totalRepairCostMinor: z.string(),
  totalRecoveredMinor: z.string(),
  pendingRecoveryMinor: z.string(),
  netCostMinor: z.string(),
});
export type IncidentBottomLine = z.infer<typeof incidentBottomLineSchema>;

/**
 * Web-P8a: found while building the incident screen — `computeIncidentBottomLine`
 * already fetches every recovery row and the bottom line already sums them,
 * but neither the recovery rows themselves nor the insurance claim (if one
 * was submitted) ever reached the wire. A container "opened once, edited
 * independently over weeks" (§6.6) means the *same* incident is revisited
 * many times — without these, a manager returning to mark a recovery
 * received, or settle a claim, would have no id to act on unless they'd
 * kept the original POST response around in memory.
 */
export const incidentDetailResponseSchema = incidentResponseSchema.extend({
  bottomLine: incidentBottomLineSchema,
  recoveries: z.array(incidentRecoveryResponseSchema),
  insuranceClaim: insuranceClaimResponseSchema.nullable(),
});
export type IncidentDetailResponse = z.infer<typeof incidentDetailResponseSchema>;

/** Web-P8a: vehicle overview's own Incidents section — every incident this vehicle has had, open and closed, newest first. No new row shape: the plain `incidentResponseSchema` already carries everything a list row needs. */
export const listIncidentsResponseSchema = z.array(incidentResponseSchema);
export type ListIncidentsResponse = z.infer<typeof listIncidentsResponseSchema>;
