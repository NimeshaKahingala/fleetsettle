import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * The visual box is intentionally smaller than 44px (matching every native
 * checkbox convention) — §4.3's 44px floor applies to the *tappable row*,
 * not this glyph. Wrap it in a `min-h-tap` label/row at the call site (the
 * `AmountPad` checkbox row does this).
 */
export const Checkbox = forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "size-5 shrink-0 rounded-[4px] border border-line-strong bg-surface",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus-ring",
      "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      <Check className="size-4" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
