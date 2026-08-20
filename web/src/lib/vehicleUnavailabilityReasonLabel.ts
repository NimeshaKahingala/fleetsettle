import type { VehicleUnavailabilityResponse } from "@fleetsettle/shared/schemas";

export type VehicleUnavailabilityReason = VehicleUnavailabilityResponse["reason"];

export const VEHICLE_UNAVAILABILITY_REASON_LABEL: Record<VehicleUnavailabilityReason, string> = {
  service: "Service",
  sale_preparation: "Sale prep",
  other: "Other",
};
