import { ChevronLeft } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";

export interface ScreenAction {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export interface ScreenPrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "destructive";
}

export interface ScreenProps {
  title: string;
  /** A drill-down screen's own way back to its list (UI §7.5/§7.2 wireframes: "← Trip #21", "← 5 days to confirm") — absent on a tab's own top-level screen. */
  onBack?: () => void;
  /** One contextual action in the app bar (§4.2) — never more than one. */
  action?: ScreenAction;
  /** The 56px sticky CTA (M-24). Rendered as the last child inside the scroll region itself, `position: sticky`, so `scroll-padding-bottom` (below) keeps a focused field from landing behind it. */
  primaryAction?: ScreenPrimaryAction;
  /** Slot for `OfflineBanner`, rendered below the app bar and above the scroll region (§6.4) — Screen doesn't know what "offline" means, only where the banner goes. */
  offlineBanner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * §6.1 `Screen`: app bar + scroll region (the only scrolling element on the
 * screen) + optional sticky action. The tab bar is `AppShell`'s, a true
 * flex sibling below this whole block rather than a fixed overlay — that
 * trades a little of §4.2's under-bar parallax polish for a layout with no
 * way to miscalculate an overlap, which matters more here since every
 * later screen builds on this one.
 */
export function Screen({
  title,
  onBack,
  action,
  primaryAction,
  offlineBanner,
  children,
}: ScreenProps) {
  const ActionIcon = action?.icon;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line-hairline px-4">
        <div className="flex min-w-0 items-center gap-1">
          {onBack !== undefined ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
          ) : null}
          <h1 className="truncate text-title-lg text-ink-primary">{title}</h1>
        </div>
        {action !== undefined && ActionIcon !== undefined ? (
          <button
            type="button"
            onClick={action.onClick}
            aria-label={action.label}
            className="flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash"
          >
            <ActionIcon className="size-5" aria-hidden />
          </button>
        ) : null}
      </header>
      {offlineBanner}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto p-4",
          primaryAction !== undefined ? "scroll-pb-[88px]" : "scroll-pb-4",
        )}
      >
        {children}
        {primaryAction !== undefined ? (
          <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 bg-page px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
            <Button
              size="cta"
              variant={primaryAction.variant ?? "primary"}
              disabled={primaryAction.disabled ?? false}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
