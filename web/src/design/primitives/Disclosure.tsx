import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn.js";

export interface DisclosureProps {
  /** Shown once opened, in place of the generic "More" label. */
  sectionName: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
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
export function Disclosure({ sectionName, children, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
