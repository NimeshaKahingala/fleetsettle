import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Button } from "./Button.js";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Rendered bottom-anchored; the confirm action, then cancel below it — never side by side (§4.3: destructive never adjacent to confirm). */
  footer?: React.ReactNode;
}

/**
 * §6.1 `Dialog`: centre modal, reserved for **INV-1, INV-17 and M-10
 * confirms only** — three call sites in the whole app, never a general
 * "are you sure". Everything else is a `Sheet`.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2",
            "rounded-md border border-line-hairline bg-surface p-4 outline-none",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="text-title text-ink-primary">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash"
            >
              <X className="size-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          {description !== undefined ? (
            <DialogPrimitive.Description className="mt-1 text-body-sm text-ink-muted">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only" />
          )}
          {children !== undefined ? <div className="mt-3">{children}</div> : null}
          {footer !== undefined ? <div className="mt-4 flex flex-col gap-2">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The two-button footer shape every Dialog confirm uses: primary action on top, a plain cancel below — stacked, never side by side, so a mis-tap can't hit the destructive one (§4.3). */
export function DialogConfirmFooter({
  confirmLabel,
  onConfirm,
  onCancel,
  variant = "primary",
}: {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "primary" | "destructive";
}) {
  return (
    <>
      <Button size="cta" variant={variant} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
}
