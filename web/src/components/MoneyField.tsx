import { format, fromInput, type Minor } from "@fleetsettle/shared";
import { useEffect, useId, useState } from "react";
import { Input } from "../design/primitives/Input.js";
import { Label } from "../design/primitives/Label.js";
import { Sheet } from "../design/primitives/Sheet.js";
import { AmountPad } from "./AmountPad.js";
import { Money } from "./Money.js";

export interface MoneyFieldProps {
  label: string;
  valueMinor: Minor | null;
  onChange: (value: Minor) => void;
  expectedMinor?: Minor;
  /** "Where a native keyboard is genuinely better (a long expense form already using the keyboard)" (§6.2) — degrades to a plain text input instead of opening `AmountPad`. */
  degrade?: boolean;
}

/**
 * §6.2 `MoneyField`: the inline form variant, opening `AmountPad` in a
 * `Sheet` on tap. The degraded variant is `inputmode="decimal"` text —
 * never `type="number"`, which rejects locale separators — and formats
 * only on blur, never per keystroke, so a half-typed "5,00" isn't
 * reformatted out from under the user's thumb mid-entry.
 */
export function MoneyField({
  label,
  valueMinor,
  onChange,
  expectedMinor,
  degrade = false,
}: MoneyFieldProps) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const [text, setText] = useState(() => (valueMinor !== null ? format(valueMinor) : ""));

  useEffect(() => {
    setText(valueMinor !== null ? format(valueMinor) : "");
  }, [valueMinor]);

  if (degrade) {
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId}>{label}</Label>
        <div className="flex items-center gap-2">
          <span className="text-body text-ink-secondary">Rs</span>
          <Input
            id={inputId}
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const parsed = fromInput(text);
              if (parsed !== null) {
                onChange(parsed);
                setText(format(parsed));
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-tap w-full rounded-sm border border-line-strong bg-surface px-3 text-left text-body"
      >
        {valueMinor !== null ? (
          <Money value={valueMinor} />
        ) : (
          <span className="text-ink-faint">Enter {label.toLowerCase()}</span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={label}>
        <AmountPad
          title={label}
          {...(valueMinor !== null ? { initialValueMinor: valueMinor } : {})}
          {...(expectedMinor !== undefined ? { expectedMinor } : {})}
          onSave={(value) => {
            onChange(value);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}
