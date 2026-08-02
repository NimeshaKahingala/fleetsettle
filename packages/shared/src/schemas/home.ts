import { z } from "zod";
import { uuidSchema } from "./common.js";

/** F-10.1/UC-92: a vehicle document (insurance, registration, revenue licence, permit, emissions) or a driver's own licence — the same home-screen alert either way (UI §3.2 item 2). */
export const paperworkWarningSubjectTypeSchema = z.enum(["vehicle", "driver"]);
export const paperworkDocTypeSchema = z.enum([
  "insurance",
  "registration",
  "revenue_licence",
  "permit",
  "emissions",
  "licence",
]);

/** Keeps warning past the expiry date too (Accept: "until the new date is entered") — `isExpired` is what lets the client style an overdue one as more urgent than a merely-approaching one. */
export const paperworkWarningRowSchema = z.object({
  subjectType: paperworkWarningSubjectTypeSchema,
  subjectId: uuidSchema,
  subjectLabel: z.string(),
  docType: paperworkDocTypeSchema,
  expiryDate: z.string(),
  isExpired: z.boolean(),
});
export type PaperworkWarningRow = z.infer<typeof paperworkWarningRowSchema>;

export const paperworkWarningsResponseSchema = z.array(paperworkWarningRowSchema);
export type PaperworkWarningsResponse = z.infer<typeof paperworkWarningsResponseSchema>;

/** F-2.7/UC-16 step 6, W-29: every deposit whose hold window has reached its release date — still a liability, still not income (§6.13), until released or applied against a charge (F-8.4). */
export const depositReleaseRowSchema = z.object({
  depositId: uuidSchema,
  partyType: z.enum(["customer", "driver"]),
  partyId: uuidSchema,
  partyName: z.string().nullable(),
  holdReleaseDate: z.string(),
  heldMinor: z.string(),
});
export type DepositReleaseRow = z.infer<typeof depositReleaseRowSchema>;

export const depositReleasesResponseSchema = z.array(depositReleaseRowSchema);
export type DepositReleasesResponse = z.infer<typeof depositReleasesResponseSchema>;
