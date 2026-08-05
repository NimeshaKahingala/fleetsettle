import { X } from "lucide-react";
import { Drawer } from "vaul";
import { cn } from "../../lib/cn.js";
import { useMobileHistoryDismiss } from "../../lib/useMobileHistoryDismiss.js";

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
 * `useMobileHistoryDismiss`, layered on top rather than reimplemented here.
 */
export function Sheet({ open, onOpenChange, title, description, children, className }: SheetProps) {
  useMobileHistoryDismiss(open, onOpenChange);

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content
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
            <Drawer.Close
              aria-label="Close"
              className="flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash"
            >
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
