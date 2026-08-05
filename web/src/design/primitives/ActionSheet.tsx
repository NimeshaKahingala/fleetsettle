import type { LucideIcon } from "lucide-react";
import { Sheet } from "./Sheet.js";

export interface ActionSheetAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
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
        {actions.map(({ key, label, icon: Icon, onSelect }) => (
          <li key={key}>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onSelect();
              }}
              className="flex min-h-tap w-full items-center gap-3 rounded-sm px-2 text-body text-ink-primary active:bg-brand-wash"
            >
              <Icon className="size-5 text-ink-secondary" aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
