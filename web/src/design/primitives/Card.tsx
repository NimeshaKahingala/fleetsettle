import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The one elevated variant, used only by the day card (§5.3: "Shadow is reserved for things that genuinely float"). */
  elevated?: boolean;
}

/** §6.1 `Card`: a hairline surface — `--color-surface` on `--color-page`, 1px `--color-line-hairline`. Elevation is the exception, not the default. */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-line-hairline bg-surface p-4",
        elevated && "shadow-md",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
