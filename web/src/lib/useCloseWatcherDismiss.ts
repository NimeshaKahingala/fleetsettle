import { useEffect, useRef } from "react";

/**
 * GAP-134. This used to be a hand-rolled `history.pushState`/`.back()`
 * scheme (`SheetHistoryStack`, GAP-104) — the same technique the
 * `CloseWatcher` spec's own explainer names as its motivating problem: *"a
 * shared component that attempts to use the history API to implement these
 * techniques can easily corrupt a web application's router,"* because
 * *"both moving forward and backward through history emit the same
 * `popstate` event."* That corruption was GAP-134 exactly: `ActionSheet`'s
 * `onOpenChange(false)` then `onSelect()` — a `navigate()` call — in one
 * handler raced the deferred history unwind against TanStack Router's own
 * `pushState`, and whichever won decided whether the navigation silently
 * reverted.
 *
 * `CloseWatcher` (https://wicg.github.io/close-watcher/) is the platform's
 * purpose-built replacement: it answers a close request — Android back
 * button/gesture, Esc — without ever touching `window.history`, so there is
 * nothing left for a navigation to race. Per spec, only the
 * most-recently-constructed watcher receives events, which is what used to
 * need `SheetHistoryStack`'s whole stack/flush bookkeeping to get right for
 * nested sheets (GAP-104's other half) — now free, and per-sheet, with no
 * cross-sheet coordination at all.
 *
 * No fallback for browsers without `CloseWatcher` (iOS Safari, as of August
 * 2026 — Baseline-blocked on Safari, still in Technology Preview). §3.3's
 * rule is about the hardware back button, which iOS has none of; iOS keeps
 * drag-to-dismiss and the visible close button (M-23).
 */
export function useCloseWatcherDismiss(open: boolean, onOpenChange: (open: boolean) => void): void {
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) {
      return undefined;
    }
    if (!("CloseWatcher" in window)) return undefined;

    const watcher = new CloseWatcher();
    watcher.onclose = () => {
      onOpenChangeRef.current(false);
    };
    return () => {
      watcher.destroy();
    };
  }, [open]);
}
