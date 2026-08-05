import { z } from "zod";

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
});
export type CustomerResponse = z.infer<typeof customerResponseSchema>;
