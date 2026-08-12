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
   * section hides. Without this, a collapsed level-2 section can swallow
   * the only feedback a failed submit produced (§9.2's validation-timing
   * rules exist precisely so a rejected save is never silent); pass
   * `errors.someHiddenField !== undefined` from the form.
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
