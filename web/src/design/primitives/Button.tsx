import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/**
 * UI §4.3 / §5.3: 44px is the floor for every variant; `cta` is the 56px,
 * full-width primary action §4.2's frame reserves the bottom of the screen
 * for. `:active` carries the press feedback (never a JS handler — it must
 * survive scroll cancellation) per §5.3's touch-feedback table.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm text-body font-medium " +
    "transition-[transform,background-color] duration-[120ms] ease-[cubic-bezier(0,0,0.2,1)] " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-focus-ring",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white shadow-btn-primary active:scale-[0.98] active:brightness-90",
        outline:
          "border border-transparent bg-surface-sunken text-ink-primary active:bg-brand-wash",
        destructive: "bg-critical text-white active:brightness-90",
        ghost: "bg-transparent text-ink-primary active:bg-brand-wash",
      },
      size: {
        // The 56px, full-width primary action (§4.2's sticky action bar).
        cta: "h-14 w-full px-6 text-title",
        // Every other button: the 44px floor, never smaller.
        default: "min-h-tap px-4",
        // Icon-only: 44x44 hit area even at a 20px glyph — pad, don't grow the icon.
        icon: "size-tap",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";
