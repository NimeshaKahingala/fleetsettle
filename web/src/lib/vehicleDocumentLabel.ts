import type { VehicleDocumentResponse } from "@fleetsettle/shared/schemas";

export type VehicleDocType = VehicleDocumentResponse["docType"];

export const VEHICLE_DOC_TYPE_OPTIONS: Array<{ code: VehicleDocType; label: string }> = [
  { code: "insurance", label: "Insurance" },
  { code: "registration", label: "Registration" },
  { code: "revenue_licence", label: "Revenue licence" },
  { code: "permit", label: "Permit" },
  { code: "emissions", label: "Emissions" },
];

export const VEHICLE_DOC_TYPE_LABEL: Record<VehicleDocType, string> = {
  insurance: "Insurance",
  registration: "Registration",
  revenue_licence: "Revenue licence",
  permit: "Permit",
  emissions: "Emissions",
};
