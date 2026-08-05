import { parse, type Minor } from "@fleetsettle/shared";
import { Delete } from "lucide-react";
import { useState } from "react";
import { Button } from "../design/primitives/Button.js";
import { Checkbox } from "../design/primitives/Checkbox.js";
import { Label } from "../design/primitives/Label.js";
import { cn } from "../lib/cn.js";
import { Money } from "./Money.js";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const;

export interface AmountPadProps {
  title: string;
  initialValueMinor?: Minor;
  /** The caption below the hero figure — "expected 5,000" (M-7). */
  expectedMinor?: Minor;
  /** UC-32: absent for a pad that isn't about a recurring daily amount. */
  showMakeNewDailyAmount?: boolean;
  /** F-4.3's editable effective date — `DateField` isn't built yet, so the call site supplies whatever date control it has. */
  effectiveDateControl?: React.ReactNode;
  onSave: (valueMinor: Minor, options: { makeNewDailyAmount: boolean }) => void;
}

/**
 * §6.2 `AmountPad`: the money keypad (M-7). Digits build minor units from
 * the right — `value = value * 10 + digit` — so there is never a decimal-
 * point state machine to get wrong; the "." key exists only because a
 * numeric keypad's 12-key grid is what a thumb expects to see, and is
 * inert here rather than reintroducing that state machine.
 *
 * The display is a non-focusable `role="textbox"`, never an `<input>` —
 * an `<input readonly>` still summons the OS keyboard on some Android
 * builds and always draws the iOS accessory bar.
 */
export function AmountPad({
  title,
  initialValueMinor,
  expectedMinor,
  showMakeNewDailyAmount = false,
  effectiveDateControl,
  onSave,
}: AmountPadProps) {
  const [rawMinor, setRawMinor] = useState<bigint>(initialValueMinor ?? 0n);
  const [makeNewDailyAmount, setMakeNewDailyAmount] = useState(false);
  const valueMinor = parse(rawMinor.toString());

  function pressDigit(digit: string): void {
    setRawMinor((v) => v * 10n + BigInt(digit));
  }

  function pressBackspace(): void {
    setRawMinor((v) => v / 10n);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-label text-ink-secondary">{title}</p>
        <div role="textbox" aria-readonly="true" aria-label={title} className="select-none py-2">
          <Money value={valueMinor} className="text-hero" />
        </div>
        {expectedMinor !== undefined ? (
          <p className="text-caption text-ink-muted">
            expected <Money value={expectedMinor} />
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key) => {
          const isBackspace = key === "⌫";
          const isInert = key === ".";
          return (
            <button
              key={key}
              type="button"
              disabled={isInert}
              aria-label={isBackspace ? "Backspace" : isInert ? undefined : key}
              onClick={isBackspace ? pressBackspace : isInert ? undefined : () => pressDigit(key)}
              className={cn(
                "flex h-14 items-center justify-center rounded-sm text-title text-ink-primary",
                "active:brightness-90",
                isInert && "text-ink-faint",
              )}
            >
              {isBackspace ? <Delete className="size-5" aria-hidden /> : key}
            </button>
          );
        })}
      </div>

      {showMakeNewDailyAmount ? (
        <div className="flex min-h-tap flex-col gap-2">
          <label className="flex min-h-tap items-center gap-3">
            <Checkbox
              checked={makeNewDailyAmount}
              onCheckedChange={(checked) => setMakeNewDailyAmount(checked === true)}
            />
            <span className="text-body text-ink-primary">Make this the new daily amount</span>
          </label>
          {makeNewDailyAmount && effectiveDateControl !== undefined ? (
            <div className="flex items-center gap-2 pl-8">
              <Label>from</Label>
              {effectiveDateControl}
            </div>
          ) : null}
        </div>
      ) : null}

      <Button size="cta" onClick={() => onSave(valueMinor, { makeNewDailyAmount })}>
        Save
      </Button>
    </div>
  );
}
