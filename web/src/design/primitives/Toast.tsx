import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  action?: ToastAction;
  /** Defaults to M-11's 5-second window. `null` keeps the toast until dismissed. */
  durationMs?: number | null;
}

interface ToastRecord extends ToastOptions {
  id: string;
  durationMs: number | null;
}

interface ToastContextValue {
  toasts: ToastRecord[];
  showToast: (toast: ToastOptions) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastSequence = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastOptions) => {
    toastSequence += 1;
    const id = `toast-${toastSequence.toString()}`;
    setToasts((current) => [
      ...current,
      {
        ...toast,
        id,
        durationMs: toast.durationMs === undefined ? 5000 : toast.durationMs,
      },
    ]);
    return id;
  }, []);

  const value = useMemo(
    () => ({ toasts, showToast, dismissToast }),
    [dismissToast, showToast, toasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast() called outside a ToastProvider");
  }
  return { showToast: context.showToast, dismissToast: context.dismissToast };
}

function ToastItem({
  toast,
  dismissToast,
}: {
  toast: ToastRecord;
  dismissToast: (id: string) => void;
}) {
  useEffect(() => {
    if (toast.durationMs === null) return;
    const timeout = window.setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => window.clearTimeout(timeout);
  }, [dismissToast, toast.durationMs, toast.id]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-3 rounded-sm border border-line-strong bg-surface px-3 py-2 shadow-lg"
    >
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-ink-primary">{toast.title}</p>
        {toast.description !== undefined ? (
          <p className="mt-1 text-caption text-ink-muted">{toast.description}</p>
        ) : null}
        {toast.action !== undefined ? (
          <button
            type="button"
            className="mt-2 min-h-tap rounded-sm text-body-sm font-medium text-brand-ink"
            onClick={() => {
              toast.action?.onClick();
              dismissToast(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Dismiss ${toast.title}`}
        className="flex size-tap shrink-0 items-center justify-center rounded-sm text-ink-secondary active:bg-brand-wash"
        onClick={() => dismissToast(toast.id)}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function ToastViewport() {
  const context = useContext(ToastContext);

  if (context === null) return <div id="toast-root" />;

  return (
    <div
      id="toast-root"
      aria-live="polite"
      aria-relevant="additions text"
      className={cn(
        "pointer-events-none shrink-0 px-4",
        context.toasts.length > 0 ? "pb-3 max-md:landscape:pb-2" : "p-0",
      )}
    >
      <div className="flex flex-col gap-2">
        {context.toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} dismissToast={context.dismissToast} />
        ))}
      </div>
    </div>
  );
}
