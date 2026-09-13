import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.js";

export interface DisclosureProps {
  /** Shown once opened, in place of the generic "More" label. */
  sectionName: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Forces the section open — for a validation error on a field this
   * section hides — and holds it open against a manual collapse for as
   * long as it stays `true`. A one-shot "open once" (setting state from an
   * effect) is not enough: the user can still close it again afterwards
   * while the error persists, and a second failed submit re-derives the
   * same `true` value rather than a fresh transition, so nothing would
   * reopen it (§9.2's validation-timing rules exist precisely so a
   * rejected save is never silent). Pass
   * `errors.someHiddenField !== undefined` from the form — OR together
   * every error this section hides, not just one of them.
   */
  forceOpen?: boolean;
}

/**
 * §6.3 `Disclosure`: the U-2 level-2 container (M-6). Labelled "More" on
 * first use, then the section's own name once opened. "Remembers per
 * form" means it doesn't collapse again just because the user looked
 * away — ordinary component state already gives that, as long as the
 * form doesn't remount this component; carrying the choice across a
 * fresh visit to the form is the form's own state to lift, not this
 * component's.
 */
export function Disclosure({
  sectionName,
  children,
  defaultOpen = false,
  forceOpen = false,
  onOpenChange,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          setOpen((o) => {
            // A manual close can never dismiss the error forcing this open —
            // only forceOpen clearing can do that (§9.2). Once it does, `open`
            // is already `true` from the effect above and stays that way,
            // same as any other manually-opened section (see the "stays open
            // once opened" behaviour below) — this only blocks the collapse
            // attempt itself, it doesn't re-derive `open` from `forceOpen`.
            if (forceOpen) return o;
            const next = !o;
            onOpenChange?.(next);
            return next;
          })
        }
        aria-expanded={open}
        className="flex min-h-tap items-center gap-1 text-body text-brand-ink"
      >
        <ChevronRight
          className={cn("size-4 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {open ? sectionName : "More"}
      </button>
      {open ? <div className="pt-2">{children}</div> : null}
    </div>
  );
}
