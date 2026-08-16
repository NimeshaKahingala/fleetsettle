import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn.js";

/**
 * UI §6.1 `Badge`: a small semantic label for state that otherwise reads as
 * plain muted text (arrangement, incident status, voided/paid/due) — never
 * the only signal (CLAUDE.md → Interface: "Colour never carries meaning
 * alone"), so every use pairs this with the same word a screen already
 * shows. `full` radius per §5.3's own scale (chips/avatars), never `sm`
 * (controls) or `md` (cards) — this is neither.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-caption font-medium",
  {
    variants: {
      variant: {
        brand: "bg-brand-wash text-brand-ink",
        good: "bg-good/15 text-good-ink",
        warning: "bg-warning/15 text-warning-ink",
        serious: "bg-serious/15 text-serious-ink",
        critical: "bg-critical/15 text-critical-ink",
        trip: "bg-trip/15 text-trip-ink",
        neutral: "border border-line-hairline bg-surface text-ink-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
