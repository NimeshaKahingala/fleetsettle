import type { BusinessDate } from "@fleetsettle/shared";
import { NoteField } from "../design/primitives/NoteField.js";
import { DateField } from "./DateField.js";

export interface DateAndReasonFieldsProps {
  occurredOn: BusinessDate;
  onOccurredOnChange: (value: BusinessDate) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  today: BusinessDate;
}

/**
 * The "Date" + "Reason (optional)" pair every money-movement form ends
 * with — `DepositMovementSheet` and `ReleaseDepositSheet` (GAP-230) both
 * had it verbatim, which SonarCloud's new-code duplication gate caught on
 * the second copy. Plain value/onChange props rather than a react-hook-form
 * `Control<T>` — tried, and `Control`'s own generics stay invariant enough
 * under this project's `exactOptionalPropertyTypes` that no shape both
 * callers' differently-typed forms could unify with was found; each caller
 * wires its own two fields with `watch`/`setValue` instead of `Controller`
 * for just these two, which is what let the actual duplicated JSX collapse
 * to one shared component at all.
 */
export function DateAndReasonFields({
  occurredOn,
  onOccurredOnChange,
  reason,
  onReasonChange,
  today,
}: Readonly<DateAndReasonFieldsProps>) {
  return (
    <>
      <DateField label="Date" value={occurredOn} onChange={onOccurredOnChange} today={today} />
      <NoteField label="Reason (optional)" value={reason} onChange={onReasonChange} />
    </>
  );
}
