import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * Native select styling, beside `Input` because it is the same level-1 form
 * control: visible label from `Field`, 44px minimum target, iOS-safe 16px
 * text, and no custom picker for a simple closed vocabulary.
 */
export const NativeSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "min-h-tap w-full rounded-sm border border-transparent bg-surface-sunken px-3 text-body text-ink-primary",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      "disabled:pointer-events-none disabled:opacity-50",
      "aria-[invalid=true]:border-2 aria-[invalid=true]:border-critical",
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
