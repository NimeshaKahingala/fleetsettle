import * as LabelPrimitive from "@radix-ui/react-label";
import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

/** §6.3 `Field`: the label is always visible, top-aligned — never a placeholder standing in for it. */
export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-label font-medium text-ink-secondary", className)}
    {...props}
  />
));
Label.displayName = "Label";
