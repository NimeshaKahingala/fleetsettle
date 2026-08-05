import { Button } from "../design/primitives/Button.js";

export interface EmptyStateProps {
  /** e.g. "Nothing needs you today" (§3.2/§7.1) — a real, good state, not a blank screen. */
  message: string;
  action?: { label: string; onClick: () => void };
}

/** §6.4 `EmptyState`: a sentence in `--color-ink-secondary`, one button only where an action is genuinely the answer, no illustrations. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <p className="text-body text-ink-secondary">{message}</p>
      {action !== undefined ? (
        <Button variant="outline" size="default" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
