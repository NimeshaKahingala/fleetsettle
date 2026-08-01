import { EntityPicker, type EntityOption } from "./EntityPicker.js";

export interface BorneByPaidByProps {
  paidBy: EntityOption;
  paidByOptions: EntityOption[];
  onPaidByChange: (party: EntityOption) => void;
  /** Why `paidBy` defaulted the way it did — shown as caption text so the default is auditable at a glance. */
  paidByDerivation: string;

  borneBy: EntityOption;
  borneByOptions: EntityOption[];
  onBorneByChange: (party: EntityOption) => void;
  borneByDerivation: string;
}

/**
 * §6.3 `BorneByPaidBy` (W-48): the one control that must never collapse
 * two fields. "The manager buying the driver's fuel out of his own
 * pocket" is *borne by* the driver and *paid by* the manager — one field
 * cannot say both. Two independent rows, both pre-filled, both editable,
 * each with its own derivation caption.
 */
export function BorneByPaidBy({
  paidBy,
  paidByOptions,
  onPaidByChange,
  paidByDerivation,
  borneBy,
  borneByOptions,
  onBorneByChange,
  borneByDerivation,
}: BorneByPaidByProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <EntityPicker
          label="Paid by"
          options={paidByOptions}
          value={paidBy}
          onChange={onPaidByChange}
        />
        <p className="text-caption text-ink-muted">{paidByDerivation}</p>
      </div>
      <div className="flex flex-col gap-1">
        <EntityPicker
          label="Borne by"
          options={borneByOptions}
          value={borneBy}
          onChange={onBorneByChange}
        />
        <p className="text-caption text-ink-muted">{borneByDerivation}</p>
      </div>
    </div>
  );
}
