import { createRoute } from "@hono/zod-openapi";
import {
  createVehicleLoanRequestSchema,
  listLoanPaymentsResponseSchema,
  recordLoanPaymentRequestSchema,
  loanPaymentResponseSchema,
  settleVehicleLoanRequestSchema,
  vehicleLoanResponseSchema,
  voidedResponseSchema,
  voidRequestSchema,
} from "@fleetsettle/shared/schemas";
import { z } from "zod";

const loanIdParams = z.object({ id: z.string().uuid() });
const loanPaymentIdParams = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() });

/** F-12.1/UC-106. `manageVehicleLoans` — owners only, a capital commitment. */
export const recordVehicleLoanRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: { content: { "application/json": { schema: createVehicleLoanRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: vehicleLoanResponseSchema } },
      description: "The loan",
    },
    400: { description: "downPaymentByUserId or liabilityOwnerUserId is not an owner" },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a vehicle loan" },
    404: {
      description: "No such vehicle, downPaymentByUserId or liabilityOwnerUserId in this business",
    },
    409: { description: "That accounting period is closed (only reachable with a down payment)" },
  },
});

/** F-12.4. `viewReports` (STAFF) — a manager sees this too (W-70). */
export const getVehicleLoanRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: { params: loanIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: vehicleLoanResponseSchema } },
      description: "The loan, with remaining-to-pay and behind-by derived on read",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view vehicle loans" },
    404: { description: "No such loan in this business" },
  },
});

/** F-12.2/UC-107, INV-43/44/45. `dailyOperations` — the manager pays it. */
export const recordLoanPaymentRoute = createRoute({
  method: "post",
  path: "/{id}/payment",
  request: {
    params: loanIdParams,
    body: { content: { "application/json": { schema: recordLoanPaymentRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: loanPaymentResponseSchema } },
      description: "The payment",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot record a loan payment" },
    404: { description: "No such loan or replacesId payment in this business" },
    409: {
      description:
        "That accounting period is closed, this loan is already closed, or the payment exceeds what is left to pay",
    },
  },
});

/** F-12.2/F-12.4: every payment ever recorded against one loan, oldest first — the read a manager needs to find one to void. */
export const listLoanPaymentsRoute = createRoute({
  method: "get",
  path: "/{id}/payment",
  request: { params: loanIdParams },
  responses: {
    200: {
      content: { "application/json": { schema: listLoanPaymentsResponseSchema } },
      description: "Every payment against this loan, oldest first",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot view loan payments" },
    404: { description: "No such loan in this business" },
  },
});

/** F-12.3/UC-108, W-69. `dailyOperations` — owner or manager, per F-12.3's own actor line. */
export const settleVehicleLoanRoute = createRoute({
  method: "post",
  path: "/{id}/settle",
  request: {
    params: loanIdParams,
    body: { content: { "application/json": { schema: settleVehicleLoanRequestSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: loanPaymentResponseSchema } },
      description: "The closing payment; the loan's closedOn is now set",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot settle a vehicle loan" },
    404: { description: "No such loan in this business" },
    409: { description: "That accounting period is closed, or this loan is already closed" },
  },
});

/** F-12.3's own void: clears closedOn and reopens the loan, voiding its finance expense/payout with it (INV-43). Also voids an ordinary payment. `dailyOperations` — the same gate recording one uses. */
export const voidLoanPaymentRoute = createRoute({
  method: "post",
  path: "/{id}/payment/{paymentId}/void",
  request: {
    params: loanPaymentIdParams,
    body: { content: { "application/json": { schema: voidRequestSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: voidedResponseSchema } },
      description: "The voided payment",
    },
    401: { description: "Missing or invalid access token" },
    403: { description: "This role cannot void a loan payment" },
    404: { description: "No such payment in this business" },
    409: {
      description:
        "This payment has already been undone, or its finance cost sits in a closed period",
    },
  },
});
