import { forwardRef } from "react";
import { cn } from "../../lib/cn.js";

const ACCENT_CLASS = {
  brand: "border-l-[3px] border-l-brand",
  good: "border-l-[3px] border-l-good",
  warning: "border-l-[3px] border-l-warning",
  serious: "border-l-[3px] border-l-serious",
  critical: "border-l-[3px] border-l-critical",
  trip: "border-l-[3px] border-l-trip",
} as const;

export type CardAccent = keyof typeof ACCENT_CLASS;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The one elevated variant, used only by the day card (§5.3: "Shadow is reserved for things that genuinely float"). */
  elevated?: boolean;
  /**
   * A narrow left accent for a row whose category matters (e.g. a
   * vehicle's arrangement, an incident's status) — always paired with a
   * `Badge` or text carrying the same word, never the only signal (M-15).
   * Never a full saturated background; §5.3's radius scale is untouched.
   */
  accent?: CardAccent | undefined;
}

/**
 * §6.1 `Card`: a hairline surface — `--color-surface` on `--color-page`, 1px
 * `--color-line-hairline`, `shadow-card` by default (Tactile Ops Phase 2,
 * §5A.6's correction). **`elevated` replaces `shadow-card` with `shadow-md`
 * rather than stacking on top of it** — both set the same `box-shadow`
 * property, so only the later class in `cn()`'s output wins; there is no
 * layering. `elevated` is still the day card's own stronger tier, just not
 * an additive one — a two-tier switch between "flat" and "float", not
 * "float" plus "flatter float".
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated = false, accent, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-line-hairline bg-surface p-4 shadow-card",
        elevated && "shadow-md",
        accent !== undefined && ACCENT_CLASS[accent],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
