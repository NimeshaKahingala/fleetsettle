import {
  ArrowLeft,
  ChevronsUpDown,
  Home,
  MoreHorizontal,
  Plus,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { createContext } from "react";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { ToastViewport } from "./Toast.js";

/**
 * M-36 (21 Aug 2026): lets `Screen` know it's rendering directly beneath
 * the merged business-name line rather than under its own detached strip,
 * so its header can pick up `bg-surface` and read as the second line of
 * one bar instead of a separately-grounded block. A context, not a prop
 * threaded through `ScreenProps`, because the decision is made here from
 * the route (`topLevel` below) and every one of `Screen`'s ~40 call sites
 * would otherwise need to learn and forward a value that has nothing to
 * do with what any of them individually render. Defaults `false`, so a
 * `Screen` rendered with no `AppShell` above it (tests, Storybook-style
 * usage) is unaffected.
 */
export const AppBarMergeContext = createContext(false);

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
  /**
   * §3.1: three shells, never a fourth — the owner-manager gets `operate`,
   * not a mode switch (M-3). `"admin"` (added 18 Aug 2026, decision/UI §3.1
   * "The admin panel is not a fourth shell") is not a fourth business role
   * shell — it is the platform surface, and behaves identically to `"mine"`
   * below: the 100svh frame and toast host, no tab bar, since a role held
   * by very few identities does not earn permanent navigation real estate.
   */
  shell: "operate" | "review" | "mine" | "admin";
  activeTab?: OperateTabKey | ReviewTabKey;
  onTabChange?: (key: OperateTabKey | ReviewTabKey) => void;
  /** Operate's `＋` is a quick-add sheet trigger, not a destination — no route change (§3.1). */
  onQuickAdd?: () => void;
  /**
   * UI §3.1/M-33 (decided 18 Aug 2026): shell-level chrome, the same one
   * line whichever screen is open — never `Screen`'s own `title`, which
   * names the screen, not the business. `undefined` for a shell with
   * nothing to name (the admin surface has no business selected).
   */
  businessName?: string;
  /**
   * Turns the business strip into the business hub. It still switches when
   * several memberships exist, but also houses "Create a business", so a
   * single-membership identity can open it too (GAP-149).
   */
  onSwitchBusiness?: () => void;
  /** Platform surface escape hatch (GAP-151): the admin shell has no tab bar. */
  onExit?: { label: string; onClick: () => void };
  /**
   * M-36 (21 Aug 2026): true on the screens `Screen` renders with no
   * `onBack` — collapses the business-name strip's own border and padding
   * so it reads as line 1 of one bar with `Screen`'s title as line 2,
   * instead of two separately bordered bars. The caller (a router layout,
   * which already knows the exact pathname) decides this — `AppShell`
   * itself only has `activeTab`, and several non-top-level pathnames map
   * to the same tab as a top-level one (`/more` and `/cash` are both
   * "more"), so `activeTab` alone can't tell them apart. Omit or `false`
   * for every other screen; the strip renders exactly as before M-36.
   */
  topLevel?: boolean;
  children: React.ReactNode;
}

/**
 * §6.1 `AppShell`: safe areas, tab bar, toast host. Owns the outer `100svh`
 * frame that guarantees there is exactly one scrolling element on the page
 * — `Screen`'s, never a second one here — and renders the tab bar as a
 * true flex sibling below `children` rather than a fixed overlay (see
 * `Screen.tsx`'s note on the same trade-off).
 *
 * **The business-name strip (UI §3.1/M-33, 19 Aug 2026)** sits above
 * `children`, its own flex sibling — a second, slimmer app bar rather than
 * a slot inside `Screen`'s, since it names the *business*, the same one
 * line regardless of which screen is open, where `Screen`'s own `title`
 * names the screen and changes on every route. **M-36 (21 Aug 2026):** on
 * `topLevel` screens the strip drops its own border and bottom padding so
 * it reads as line 1 of one bar with `Screen`'s title as line 2 — the
 * strip's *content* doesn't change, only whether it's visually detached
 * from what `Screen` renders directly beneath it.
 *

 * §14/M-31 (GAP-124a, Wave 5 Step 0): at `lg`, the same tab bar becomes a
 * persistent left rail — same destinations, same order, `lg:order-first`
 * rather than a JSX reorder, since the DOM position (after `children`)
 * still matters for the mobile bottom-bar case. The active indicator moves
 * from a top strip to a left-edge strip at that breakpoint; a strip on the
 * wrong edge of a vertical rail would read as broken, not merely unstyled.
 */
export function AppShell({
  shell,
  activeTab,
  onTabChange,
  onQuickAdd,
  businessName,
  onSwitchBusiness,
  onExit,
  topLevel = false,
  children,
}: AppShellProps) {
  const tabs = shell === "operate" ? OPERATE_TABS : shell === "review" ? REVIEW_TABS : null;

  return (
    <div className="flex h-[100svh] flex-col bg-page pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        {businessName !== undefined || onExit !== undefined ? (
          onSwitchBusiness !== undefined ? (
            <button
              type="button"
              onClick={onSwitchBusiness}
              className={cn(
                "flex min-h-tap shrink-0 items-center gap-1.5 bg-surface px-4 py-1.5 text-left active:bg-brand-wash",
                topLevel ? "pb-0.5" : "border-b border-line-hairline",
                rowButtonFocus,
              )}
            >
              <span className="min-w-0 flex-1">
                <span aria-hidden className="block text-caption text-ink-muted">
                  Business
                </span>
                <span className="block min-w-0 flex-1 truncate text-label font-medium text-ink-primary">
                  {businessName}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-ink-secondary" aria-hidden />
            </button>
          ) : onExit !== undefined ? (
            <button
              type="button"
              onClick={onExit.onClick}
              className={cn(
                "flex h-tap shrink-0 items-center gap-2 border-b border-line-hairline bg-surface px-4 text-left active:bg-brand-wash",
                rowButtonFocus,
              )}
            >
              <ArrowLeft className="size-4 shrink-0 text-ink-secondary" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-caption font-medium text-ink-secondary">
                {onExit.label}
              </span>
            </button>
          ) : (
            <div
              className={cn(
                "flex h-tap shrink-0 items-center bg-surface px-4",
                topLevel ? "pb-0.5" : "border-b border-line-hairline",
              )}
            >
              <span className="truncate text-caption font-medium text-ink-secondary">
                {businessName}
              </span>
            </div>
          )
        ) : null}
        <div className="min-h-0 flex-1">
          <AppBarMergeContext.Provider value={topLevel}>{children}</AppBarMergeContext.Provider>
        </div>
      </div>
      {tabs !== null ? (
        <nav
          className="flex h-14 shrink-0 border-t border-line-hairline bg-surface pb-[env(safe-area-inset-bottom)] max-md:landscape:h-11 lg:order-first lg:h-full lg:w-20 lg:flex-col lg:justify-start lg:gap-1 lg:border-t-0 lg:border-r lg:pb-4 lg:pt-4"
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
                  "relative flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 max-md:landscape:gap-0 lg:flex-none lg:w-full lg:py-3",
                  isActive
                    ? "text-brand-ink before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-brand lg:before:inset-y-2 lg:before:left-0 lg:before:h-auto lg:before:w-0.5"
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
