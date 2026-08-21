import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Drawer } from "vaul";
import { cn } from "../../lib/cn.js";
import { iconButton } from "../../lib/iconButton.js";
import { useCloseWatcherDismiss } from "../../lib/useCloseWatcherDismiss.js";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * §6.1 `Sheet`: bottom sheet, drag-to-dismiss **plus** a visible close
 * button (M-23) — a drag gesture alone is not discoverable, and a sheet
 * with no visible way out is a dead end for anyone who doesn't know to
 * swipe. Focus trap, `aria-modal` and focus restore come from vaul's
 * underlying Radix Dialog; the mobile history-back behaviour (§3.3) is
 * `useCloseWatcherDismiss`, layered on top rather than reimplemented here.
 *
 * `autoFocus` is **not** vaul's default and must not be removed (GAP-50).
 * vaul ships `autoFocus: false`, which calls `preventDefault()` on Radix's
 * open-auto-focus so that a drawer opening on a phone does not summon the
 * keyboard. The cost is that focus never enters the drawer: it stays on the
 * trigger, which Radix has just marked `aria-hidden` along with the rest of
 * the background, and Chrome refuses — *"Blocked aria-hidden on an element
 * because its descendant retained focus"* — leaving the whole background
 * exposed to a screen reader while a modal sheet is open. The claim above
 * about focus restore was untrue for the same reason: with focus never moved
 * in, there was nothing to move back, so closing dropped it to `<body>` and
 * a keyboard user lost their place. Both are covered by
 * `e2e/sheet-a11y.spec.ts`, which needs a real browser — jsdom has no
 * accessibility tree, and headless Chromium only computes one when asked.
 */
export function Sheet({ open, onOpenChange, title, description, children, className }: SheetProps) {
  useCloseWatcherDismiss(open, onOpenChange);

  // Where focus goes when this sheet closes. Radix's modal `DialogContent`
  // unconditionally preventDefaults close-auto-focus and focuses its own
  // `triggerRef` instead — which is only ever set by a `Dialog.Trigger`.
  // Every sheet in this product is opened by a button somewhere else driving
  // the `open` prop, so that ref is always null, nothing is focused, and a
  // keyboard user is returned to `<body>` at the top of the page.
  //
  // Recorded from a `focusin` listener rather than read once when `open`
  // flips: React runs a child's effects before its parent's, so by the time
  // this component's own effect fires, focus has already moved into the
  // drawer and the opener is gone. The listener is only attached while
  // closed, so it cannot capture anything inside the sheet itself.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return undefined;
    function remember(event: FocusEvent): void {
      if (event.target instanceof HTMLElement) openerRef.current = event.target;
    }
    document.addEventListener("focusin", remember);
    return () => {
      document.removeEventListener("focusin", remember);
    };
  }, [open]);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener !== null && opener.isConnected) opener.focus();
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[90svh] flex-col rounded-t-lg bg-surface outline-none",
            className,
          )}
        >
          <Drawer.Handle className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-line-strong" />
          <div className="flex items-start justify-between gap-4 px-4 pt-3">
            <div className="min-w-0">
              <Drawer.Title className="text-title text-ink-primary">{title}</Drawer.Title>
              {/* Radix Dialog expects a description for aria-describedby; an
                  empty, visually-hidden fallback satisfies that without
                  requiring every call site to write one (most don't need
                  visible supporting text per §6.1's spec) or duplicating
                  the title as its own description. */}
              {description !== undefined ? (
                <Drawer.Description className="text-body-sm text-ink-muted">
                  {description}
                </Drawer.Description>
              ) : (
                <Drawer.Description className="sr-only" />
              )}
            </div>
            <Drawer.Close aria-label="Close" className={iconButton}>
              <X className="size-5" aria-hidden />
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
