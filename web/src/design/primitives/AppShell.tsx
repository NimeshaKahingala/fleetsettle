import { Home, MoreHorizontal, Plus, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { ToastViewport } from "./Toast.js";

export type OperateTabKey = "home" | "vehicles" | "people" | "more";
export type ReviewTabKey = "month" | "vehicles" | "money" | "reports";

interface TabDef {
  key: string;
  label: string;
  icon: LucideIcon;
}

/** §3.1: fixed order, never reordered or filtered — muscle memory is the point. */
const OPERATE_TABS: TabDef[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "vehicles", label: "Vehicles", icon: Truck },
  { key: "add", label: "Add", icon: Plus },
  { key: "people", label: "People", icon: Users },
  { key: "more", label: "More", icon: MoreHorizontal },
];

const REVIEW_TABS: TabDef[] = [
  { key: "month", label: "This month", icon: Home },
  { key: "vehicles", label: "Vehicles", icon: Truck },
  { key: "money", label: "My money", icon: Wallet },
  { key: "reports", label: "Reports", icon: MoreHorizontal },
];

export interface AppShellProps {
  /** §3.1: three shells, never a fourth — the owner-manager gets `operate`, not a mode switch (M-3). */
  shell: "operate" | "review" | "mine";
  activeTab?: OperateTabKey | ReviewTabKey;
  onTabChange?: (key: OperateTabKey | ReviewTabKey) => void;
  /** Operate's `＋` is a quick-add sheet trigger, not a destination — no route change (§3.1). */
  onQuickAdd?: () => void;
  children: React.ReactNode;
}

/**
 * §6.1 `AppShell`: safe areas, tab bar, toast host. Owns the outer `100svh`
 * frame that guarantees there is exactly one scrolling element on the page
 * — `Screen`'s, never a second one here — and renders the tab bar as a
 * true flex sibling below `children` rather than a fixed overlay (see
 * `Screen.tsx`'s note on the same trade-off).
 */
export function AppShell({ shell, activeTab, onTabChange, onQuickAdd, children }: AppShellProps) {
  const tabs = shell === "operate" ? OPERATE_TABS : shell === "review" ? REVIEW_TABS : null;

  return (
    <div className="flex h-[100svh] flex-col bg-page pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]">
      <div className="min-h-0 flex-1">{children}</div>
      {tabs !== null ? (
        <nav
          className="flex h-14 shrink-0 border-t border-line-hairline bg-surface pb-[env(safe-area-inset-bottom)] max-md:landscape:h-11"
          aria-label={shell === "operate" ? "Operate" : "Review"}
        >
          {tabs.map(({ key, label, icon: Icon }) => {
            const isAdd = key === "add";
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  if (isAdd) {
                    onQuickAdd?.();
                  } else {
                    onTabChange?.(key as OperateTabKey | ReviewTabKey);
                  }
                }}
                className={cn(
                  "relative flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 max-md:landscape:gap-0",
                  isActive
                    ? "text-brand-ink before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-brand"
                    : "text-ink-secondary",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="text-caption max-md:landscape:sr-only">{label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}
      <ToastViewport />
    </div>
  );
}
