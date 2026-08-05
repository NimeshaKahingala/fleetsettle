import { newId } from "@fleetsettle/shared";
import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { NotFoundError } from "../errors/app-error.js";
import {
  findCustomerForBusiness,
  insertCustomer,
  listCustomersForBusiness,
  type CustomerRow,
} from "../queries/customer.js";
import type {
  createCustomerRoute,
  getCustomerRoute,
  listCustomersRoute,
} from "../route-defs/customer.js";
import type { Env } from "../types.js";

function toResponse(row: CustomerRow) {
  return {
    id: row.id,
    customerType: row.customerType,
    name: row.name,
    nic: row.nic,
    registrationNo: row.registrationNo,
    contactPerson: row.contactPerson,
    mobile: row.mobile,
    address: row.address,
  };
}

/** F-2.1 / UC-10 / W-55. STAFF only (W-3: a driver enters nothing). */
export const createCustomerHandler: RouteHandler<typeof createCustomerRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const body = c.req.valid("json");
  const id = newId();

  const row: CustomerRow =
    body.customerType === "person"
      ? {
          id,
          customerType: "person",
          name: body.name,
          nic: body.nic ?? null,
          registrationNo: null,
          contactPerson: null,
          mobile: body.mobile ?? null,
          address: body.address ?? null,
        }
      : {
          id,
          customerType: "organisation",
          name: body.name,
          nic: null,
          registrationNo: body.registrationNo,
          contactPerson: body.contactPerson ?? null,
          mobile: body.mobile ?? null,
          address: body.address ?? null,
        };

  await insertCustomer(c.get("writer"), {
    id,
    businessId,
    customerType: row.customerType,
    name: row.name,
    ...(row.nic !== null ? { nic: row.nic } : {}),
    ...(row.registrationNo !== null ? { registrationNo: row.registrationNo } : {}),
    ...(row.contactPerson !== null ? { contactPerson: row.contactPerson } : {}),
    ...(row.mobile !== null ? { mobile: row.mobile } : {}),
    ...(row.address !== null ? { address: row.address } : {}),
  });

  return c.json(toResponse(row), 201);
};

export const getCustomerHandler: RouteHandler<typeof getCustomerRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const { id } = c.req.valid("param");

  const row = await findCustomerForBusiness(c.get("reader"), businessId, id);
  if (!row) throw new NotFoundError();

  return c.json(toResponse(row), 200);
};

export const listCustomersHandler: RouteHandler<typeof listCustomersRoute, Env> = async (c) => {
  requireCapability(c, "manageEntities");

  const businessId = requireBusinessId(c);
  const rows = await listCustomersForBusiness(c.get("reader"), businessId);

  return c.json(rows.map(toResponse), 200);
};
