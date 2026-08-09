import type { ReportPartyType } from "@fleetsettle/shared/schemas";
import { PARTY_TYPE_LABEL } from "./lib/partyTypeLabel.js";

export interface PartyNameProps {
  value: string | null;
  type: ReportPartyType;
  className?: string;
}

/**
 * B4/§6: every `partyName`/`displayName`/`driverName` across
 * `packages/shared/src/schemas/reports.ts` is nullable — one shared
 * fallback rather than nine inline `?? "…"`s scattered across report
 * screens. Falls back to the party **type**, not a bare dash: this
 * component doubles as a chart direct-label (§11.2 makes direct labels
 * mandatory on three of the eight palette slots), where there is no
 * adjacent type column to carry the meaning a bare "—" would lose. The
 * row still renders either way — a receivable with no name on file is
 * still money owed, and dropping it because a join found no name would be
 * worse than showing "Unnamed customer".
 */
export function PartyName({ value, type, className }: PartyNameProps) {
  if (value !== null) return <span className={className}>{value}</span>;
  return <span className={className}>{`Unnamed ${PARTY_TYPE_LABEL[type].toLowerCase()}`}</span>;
}
