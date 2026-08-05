import { useEffect, useRef } from "react";

/**
 * §3.3: "Sheets never push history entries on desktop but do register a
 * history entry on mobile so the hardware back button closes them — this
 * is the single most-missed Android behaviour in web apps." There's no
 * direct way to detect "has a hardware/gesture back button"; `pointer:
 * coarse` (touch) is the documented stand-in here, since it is the class of
 * device the rule is actually about, unlike a viewport-width breakpoint
 * (a resized desktop window has no back gesture; a touch laptop does).
 *
 * While `open`, pushes one history entry so the back button fires
 * `popstate` instead of leaving the app. If the sheet closes some other way
 * (drag, the visible close button, overlay click, Escape) while that entry
 * is still live, this pops it — otherwise back would need pressing twice
 * next time. The `closingFromPopRef` guard exists so a real back-button
 * press doesn't get double-popped by that same cleanup.
 */
export function useMobileHistoryDismiss(
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void {
  const pushedRef = useRef(false);
  const closingFromPopRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) {
      return undefined;
    }

    history.pushState({ fleetsettleSheet: true }, "");
    pushedRef.current = true;

    function onPopState(): void {
      closingFromPopRef.current = true;
      onOpenChange(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onOpenChange is expected to be stable per open/close cycle
  }, [open]);

  useEffect(() => {
    if (open || !pushedRef.current) return;
    pushedRef.current = false;
    if (closingFromPopRef.current) {
      closingFromPopRef.current = false;
      return;
    }
    history.back();
  }, [open]);
}
