import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { Sheet } from "./Sheet.js";

export interface ActionSheetAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** §7.11/TwoBalances direction marker — "in" (money received) or "out" (a cost or money paid). Omit for an action that moves no money. Colours the icon chip (Tactile Ops Phase 6); no longer a separate left border. */
  tone?: "in" | "out";
  /** Critical-ink treatment for a destructive action (e.g. archive) — both the icon chip and the label, since unlike money direction ("Payment received"/"Payment made" already say it in the word), "Archive" doesn't say destructive on its own. */
  variant?: "destructive";
  /** Renders a hairline divider before this action — for setting a destructive action apart from the rest of a long list, without reordering anything (this component still "never reorders or filters what it's given"). */
  groupStart?: boolean;
  /**
   * Tactile Ops Phase 6: one line of supporting text under the label.
   * Scoped to `QuickAddSheet.tsx`'s 5 fixed actions only (§3.2's per-file
   * review) — omit everywhere else; today's single-line row is unchanged
   * (backward compatible).
   */
  caption?: string;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions: ActionSheetAction[];
}

/**
 * Tactile Ops Phase 6 (§5C.8, decided): the mockup's `.action-row` carries
 * no left border — the icon chip's own tone colour is the direction
 * signal now, and money-direction actions already name their own
 * direction in the label ("Payment received"/"Payment made"), so a
 * border repeating what the chip (and the word) already say is a second
 * copy of one fact, not a second fact. Dropped, not kept alongside.
 */
const CHIP_TONE_CLASS = {
  in: "bg-brand-wash text-brand-ink",
  out: "bg-direction-payable/15 text-direction-payable-ink",
  neutral: "bg-surface-sunken text-ink-secondary",
  destructive: "bg-critical/15 text-critical-ink",
} as const;

/**
 * §6.1 `ActionSheet` / §3.1's `＋` quick-add target: a fixed list of
 * actions, same order everywhere it appears (base/sm full-width, md
 * centred, lg+ a left-rail button) — "muscle memory for 'fuel is the first
 * one' is the point," so this component never reorders or filters what it's
 * given.
 */
export function ActionSheet({ open, onOpenChange, title, actions }: ActionSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      <ul className="flex flex-col gap-1 pb-2">
        {actions.map(({ key, label, icon: Icon, onSelect, tone, variant, groupStart, caption }) => {
          const chipTone =
            variant === "destructive" ? "destructive" : tone === undefined ? "neutral" : tone;
          return (
            <li key={key}>
              {groupStart === true ? (
                <div role="separator" className="my-1 border-t border-line-hairline" />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onSelect();
                }}
                className={cn(
                  "flex min-h-tap w-full items-center gap-3 rounded-sm px-2 text-body active:bg-brand-wash",
                  rowButtonFocus,
                  variant === "destructive" ? "text-critical-ink" : "text-ink-primary",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    CHIP_TONE_CLASS[chipTone],
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="flex flex-col items-start">
                  {label}
                  {caption !== undefined ? (
                    <span className="text-caption text-ink-muted">{caption}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
