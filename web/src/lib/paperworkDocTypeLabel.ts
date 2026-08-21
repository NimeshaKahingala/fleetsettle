import type { PaperworkWarningRow } from "@fleetsettle/shared/schemas";

export type PaperworkDocType = PaperworkWarningRow["docType"];

/**
 * F-10.1/UC-92: a home-screen paperwork warning is a vehicle document *or*
 * a driver's own licence (`paperworkDocTypeSchema`, `home.ts`) — one extra
 * value `licence` beyond `VEHICLE_DOC_TYPE_LABEL`'s five, which is why this
 * is its own map rather than that one reused: `vehicleWarning.docType` on a
 * vehicle-scoped screen can never actually be `licence` at runtime, but its
 * static type still carries all six, and `VEHICLE_DOC_TYPE_LABEL` has no
 * entry for it.
 */
export const PAPERWORK_DOC_TYPE_LABEL: Record<PaperworkDocType, string> = {
  insurance: "Insurance",
  registration: "Registration",
  revenue_licence: "Revenue licence",
  permit: "Permit",
  emissions: "Emissions",
  licence: "Licence",
};
