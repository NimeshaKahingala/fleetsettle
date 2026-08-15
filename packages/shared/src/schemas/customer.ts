import { z } from "zod";
import { leaseObligationRowSchema } from "./lease-billing.js";

/**
 * UC-10 / W-55: a person has an NIC; an organisation chartering the bus does
 * not — forcing one would put a fake number in the field that identifies
 * people. Mirrors DM §5's two CHECK constraints exactly: a person needs an
 * NIC or a mobile, an organisation needs a registration number.
 */
const baseCustomerFields = {
  name: z.string().trim().min(1).max(200),
  mobile: z.string().trim().min(1).max(30).optional(),
  address: z.string().trim().max(500).optional(),
};

export const createCustomerRequestSchema = z
  .discriminatedUnion("customerType", [
    z.object({
      customerType: z.literal("person"),
      ...baseCustomerFields,
      nic: z.string().trim().min(1).max(30).optional(),
    }),
    z.object({
      customerType: z.literal("organisation"),
      ...baseCustomerFields,
      registrationNo: z.string().trim().min(1).max(50),
      contactPerson: z.string().trim().min(1).max(200).optional(),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.customerType === "person" && !value.nic && !value.mobile) {
      ctx.addIssue({
        code: "custom",
        message: "A person needs an NIC or a mobile number",
        path: ["nic"],
      });
    }
  });
export type CreateCustomerRequest = z.infer<typeof createCustomerRequestSchema>;

export const customerResponseSchema = z.object({
  id: z.string().uuid(),
  customerType: z.enum(["person", "organisation"]),
  name: z.string(),
  nic: z.string().nullable(),
  registrationNo: z.string().nullable(),
  contactPerson: z.string().nullable(),
  mobile: z.string().nullable(),
  address: z.string().nullable(),
  // Optional, not just nullable: every screen built before F-1.11 mocks this
  // response with no knowledge of archiving at all, and none of them needs
  // to be taught the field just to keep compiling.
  archivedAt: z.string().nullable().optional(),
});
export type CustomerResponse = z.infer<typeof customerResponseSchema>;

/** F-1.11/UC-100/W-50: a reason is required — migration 0023's own CHECK on `customer` refuses `voided_at` with an empty or absent `voided_reason`, the same audit requirement every other void table in this schema carries. */
export const archiveCustomerRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ArchiveCustomerRequest = z.infer<typeof archiveCustomerRequestSchema>;

/**
 * A4/GAP-22: the same row shape as a lease's obligation hub — `obligation`
 * carries `party_customer_id` directly, so this is a customer's outstanding
 * dues, oldest due first, reusing the identical fields rather than a
 * near-duplicate schema.
 */
export const listCustomerObligationsResponseSchema = z.array(leaseObligationRowSchema);
export type ListCustomerObligationsResponse = z.infer<typeof listCustomerObligationsResponseSchema>;
