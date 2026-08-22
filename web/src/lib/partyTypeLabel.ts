import type { ReportPartyType } from "@fleetsettle/shared/schemas";

/** U-6: no raw enum text on screen. Shared by every party-typed row that carries a `partyType` (UC-74/UC-75/UC-76's driver rows read as "Driver" too, via the same map) — moved out of `features/reports/` once `CloseMonthScreen`'s own recent-payments list needed it too, the same "shared rather than copied" reasoning `arrangementLabel.ts` already documents. */
export const PARTY_TYPE_LABEL: Record<ReportPartyType, string> = {
  customer: "Customer",
  driver: "Driver",
  partner: "Partner",
};
