import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Card } from "./Card.js";

export interface StatTileDelta {
  /** Already signed and formatted by the caller (e.g. "+5,000", "-3") — this component doesn't know if the figure is money, a count or a percentage. */
  value: string;
  /** Drives the arrow; also the caller's own word, since an arrow and a sign are not the word M-15 requires alongside them. */
  direction: "up" | "down";
  /** e.g. "from last month" — the word §6.4's spec asks for beside the arrow and sign. */
  label: string;
  /**
   * Colour sentiment, entirely the caller's call — "up" is not always good
   * (lost days rising is bad, rent collected rising is good), so this is
   * never inferred from `direction`. Omitted renders in `--color-ink-secondary`.
   */
  sentiment?: "good" | "serious";
}

export interface StatTileProps {
  label: string;
  /** The figure itself — a `Money`, a plain number, whatever the caller already renders elsewhere; this component only sizes it. */
  value: React.ReactNode;
  /** §6.4: "value (hero or title)" — `hero` for the one number a screen leads with, `title` for a tile among several. Defaults to `title`. */
  size?: "hero" | "title";
  delta?: StatTileDelta;
  /**
   * Last 30 points, oldest first. Rendered as a single 1.5px
   * `--color-ink-muted` stroke with no axes, no dots, no fill and no
   * interaction — "it is a shape, not a chart" (§6.4). Fewer than 6 points
   * renders nothing rather than a near-straight line that would read as a
   * real trend it isn't (M-13).
   */
  sparkline?: number[];
  /** "Tapping the tile opens the full report" (§6.4) — omit for a tile that's read-only summary, not a link into anything. */
  onClick?: () => void;
  className?: string;
}

const SPARKLINE_MIN_POINTS = 6;
const SPARKLINE_WIDTH = 96;
const SPARKLINE_HEIGHT = 24;

function sparklinePoints(values: number[]): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = SPARKLINE_WIDTH / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      // A flat series (span === 0) draws a level line down the middle rather than dividing by zero.
      const y =
        span === 0
          ? SPARKLINE_HEIGHT / 2
          : SPARKLINE_HEIGHT - ((v - min) / span) * SPARKLINE_HEIGHT;
      // eslint-disable-next-line no-restricted-syntax -- svg coordinate pixels, not money
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** §6.4 `StatTile` (M-31/GAP-124a): label, a sized value slot, an optional signed delta, an optional sparkline. */
export function StatTile({
  label,
  value,
  size = "title",
  delta,
  sparkline,
  onClick,
  className,
}: StatTileProps) {
  const content = (
    <>
      <p className="text-label font-medium text-ink-secondary">{label}</p>
      <div className={cn(size === "hero" ? "text-hero" : "text-title", "text-ink-primary")}>
        {value}
      </div>
      {delta !== undefined ? (
        <p
          className={cn(
            "flex items-center gap-1 text-caption",
            delta.sentiment === "good"
              ? "text-good-ink"
              : delta.sentiment === "serious"
                ? "text-serious-ink"
                : "text-ink-secondary",
          )}
        >
          {delta.direction === "up" ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )}
          <span className="tabular-nums">{delta.value}</span>
          <span>{delta.label}</span>
        </p>
      ) : null}
      {sparkline !== undefined && sparkline.length >= SPARKLINE_MIN_POINTS ? (
        <svg
          viewBox={`0 0 ${SPARKLINE_WIDTH.toString()} ${SPARKLINE_HEIGHT.toString()}`}
          width={SPARKLINE_WIDTH}
          height={SPARKLINE_HEIGHT}
          aria-hidden
          className="mt-1"
        >
          <polyline
            points={sparklinePoints(sparkline)}
            fill="none"
            stroke="var(--color-ink-muted)"
            strokeWidth="1.5"
          />
        </svg>
      ) : null}
    </>
  );

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex min-h-tap w-full flex-col items-start gap-1 rounded-md border border-line-hairline bg-surface p-4 text-left active:bg-brand-wash",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return <Card className={cn("flex flex-col items-start gap-1", className)}>{content}</Card>;
}
