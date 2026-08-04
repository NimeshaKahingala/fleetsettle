import { cn } from "../lib/cn.js";

export interface TimelineEntry {
  key: string;
  who: string;
  whenLabel: string;
  /** Pre-composed by the caller — "from Rs 5,000 to Rs 4,500", "created", etc. */
  description: string;
  /** Set only when this entry was voided — the label of what replaced it. */
  replacedByLabel?: string;
  /** Web-P6b: present only for an entry that has somewhere to go (a lease's own hub) — absent entries render as plain rows, the same convention `VehicleListScreen`'s own rows use for "nothing to tap yet." */
  onClick?: () => void;
}

export interface TimelineProps {
  /** Append-only — the order given is the order rendered, oldest or newest first is the caller's choice. */
  entries: TimelineEntry[];
}

/**
 * §6.4 `Timeline` (W-50, UC-97): append-only history on any money record —
 * who, when, from what to what. A voided entry renders struck through with
 * its replacement linked directly beneath, **never hidden and never
 * silently swapped** — F-8.5's whole point is that the original stays
 * visible with its correction attached.
 */
export function Timeline({ entries }: TimelineProps) {
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => {
        const voided = entry.replacedByLabel !== undefined;
        const body = (
          <>
            <p
              className={cn(
                "text-body",
                voided ? "text-ink-muted line-through" : "text-ink-primary",
              )}
            >
              {entry.description}
            </p>
            <p className="text-caption text-ink-muted">
              {entry.who} · {entry.whenLabel}
            </p>
            {voided ? (
              <p className="text-caption text-ink-secondary">
                → replaced by: {entry.replacedByLabel}
              </p>
            ) : null}
          </>
        );
        return (
          <li key={entry.key}>
            {entry.onClick !== undefined ? (
              <button
                type="button"
                onClick={entry.onClick}
                className="flex w-full flex-col gap-0.5 text-left"
              >
                {body}
              </button>
            ) : (
              <div className="flex flex-col gap-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
