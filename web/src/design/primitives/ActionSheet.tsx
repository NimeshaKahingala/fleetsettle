import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { Sheet } from "./Sheet.js";

export interface ActionSheetAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** §7.11/TwoBalances direction marker — "in" (money received) or "out" (a cost or money paid). Omit for an action that moves no money. */
  tone?: "in" | "out";
  /** Critical-ink treatment for a destructive action (e.g. archive). */
  variant?: "destructive";
  /** Renders a hairline divider before this action — for setting a destructive action apart from the rest of a long list, without reordering anything (this component still "never reorders or filters what it's given"). */
  groupStart?: boolean;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions: ActionSheetAction[];
}

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
        {actions.map(({ key, label, icon: Icon, onSelect, tone, variant, groupStart }) => (
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
                "flex min-h-tap w-full items-center gap-3 rounded-sm border-l-[3px] px-2 text-body active:bg-brand-wash",
                rowButtonFocus,
                tone === "in" && "border-l-brand",
                tone === "out" && "border-l-direction-payable",
                tone === undefined && "border-l-transparent",
                variant === "destructive" ? "text-critical-ink" : "text-ink-primary",
              )}
            >
              <Icon
                className={cn(
                  "size-5",
                  variant === "destructive" ? "text-critical-ink" : "text-ink-secondary",
                )}
                aria-hidden
              />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
