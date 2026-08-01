import { cn } from "../lib/cn.js";

export interface ProvisionalProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * §6.4 / §5.3 `Provisional`: the striped-edge treatment for an estimated
 * figure (an apportioned mileage split, a pending insurance recovery, an
 * unsynced write) — one visual language for "this number is not final".
 * The stripe is a 4px pseudo-element on the leading edge only, **never a
 * full-element overlay**: a list of several provisional rows would
 * otherwise repaint a large gradient on every scroll frame, which is the
 * jank a mid-range GPU shows first (§5.3's performance caveat).
 */
export function Provisional({ children, className }: ProvisionalProps) {
  return (
    <span
      className={cn(
        "relative inline-flex py-0.5 pl-2",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        "before:[background-image:repeating-linear-gradient(45deg,var(--color-warning)_0,var(--color-warning)_2px,transparent_2px,transparent_4px)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
