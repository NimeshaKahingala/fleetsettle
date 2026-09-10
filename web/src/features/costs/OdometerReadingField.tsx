import type { OdometerSource } from "@fleetsettle/shared/schemas";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { cn } from "../../lib/cn.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";

// GAP-216: only the readings an expense can plausibly carry — never
// `at_return`, which is "read when the vehicle came back at lease end" and
// means nothing on a cost record. `ReadOdometerSheet` carries its own copy
// of this same restricted set — a separate, later cleanup, not this
// component's job (recorded here rather than silently widened to cover it).
const ODOMETER_SOURCE_OPTIONS: { value: OdometerSource; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "in_person", label: "In person" },
  { value: "reported", label: "Reported" },
];

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * Copilot review, PR #180: both callers fed the raw typed string straight
 * to `Number.parseInt(value, 10)`, which silently truncates a non-integer
 * ("45200.5" → 45200) and accepts a leading-digits-then-garbage string
 * ("45200km" → 45200) — the wire schema requires a nonnegative integer, so
 * neither malformed input would 400; it would just store a reading the
 * manager never typed. Digits-only, checked before parsing rather than
 * left to whatever `parseInt` happens to tolerate.
 */
export function isValidOdometerReadingKm(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/** `undefined` for anything `isValidOdometerReadingKm` would reject — never a silently truncated number. */
export function parseOdometerReadingKm(value: string): number | undefined {
  return isValidOdometerReadingKm(value) ? Number.parseInt(value, 10) : undefined;
}

export interface OdometerReadingFieldProps {
  /** Distinguishes the two callers' own `id`/`htmlFor` pair (`"expense"`/`"fuel"`) so both can render on the same page without a DOM id collision. */
  idPrefix: string;
  readingKm: string;
  onReadingKmChange: (value: string) => void;
  source: OdometerSource | null;
  onSourceChange: (source: OdometerSource) => void;
  /** The schema's own both-or-neither refine, already evaluated by the caller (it also drives `canSave`/`forceOpen` there) — shown here as the field-level error. */
  sourceMissing: boolean;
}

/**
 * GAP-216/F-3.3/F-3.5: `RecordExpenseSheet` and `FuelFillSheet` both offer
 * this identical optional reading — a number field plus a source chip
 * picker, both-or-neither with the wire schema's own refine — extracted so
 * the two forms can't drift on what "reading source" even means (SonarCloud
 * flagged the two copies as new-code duplication; the shared component is
 * also just a smaller surface for the next reading-source value to land on
 * once instead of twice).
 */
export function OdometerReadingField({
  idPrefix,
  readingKm,
  onReadingKmChange,
  source,
  onSourceChange,
  sourceMissing,
}: OdometerReadingFieldProps) {
  const readingInvalid = readingKm.trim() !== "" && !isValidOdometerReadingKm(readingKm);
  const readingId = `${idPrefix}-odometer-reading`;
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Odometer reading (km)"
        htmlFor={readingId}
        optional
        error={readingInvalid ? "Enter a whole number of kilometres" : undefined}
      >
        <Input
          id={readingId}
          type="number"
          inputMode="numeric"
          min={0}
          value={readingKm}
          onChange={(e) => onReadingKmChange(e.target.value)}
          aria-invalid={readingInvalid}
          aria-describedby={fieldErrorId(readingId)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <Label>Reading source</Label>
        <div className="flex flex-wrap gap-2">
          {ODOMETER_SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={source === option.value}
              onClick={() => onSourceChange(option.value)}
              className={chipClass(source === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {sourceMissing ? (
          <p className="text-body-sm text-critical-ink">Choose how this reading was taken</p>
        ) : null}
      </div>
    </div>
  );
}
