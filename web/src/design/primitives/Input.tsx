import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * §5.2: `body` (16px) is the floor for inputs (M-19) — smaller triggers
 * iOS Safari's zoom-on-focus. §6.3 `FieldError` reserves the 2px error
 * border from the start (`border` not `border-0`) so the 1px→2px swap on
 * error never shifts layout.
 */
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "min-h-tap w-full rounded-sm border border-line-strong bg-surface px-3 text-body text-ink-primary",
        "placeholder:text-ink-muted",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-[invalid=true]:border-2 aria-[invalid=true]:border-critical",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
