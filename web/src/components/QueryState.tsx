import type { UseQueryResult } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { Button } from "../design/primitives/Button.js";
import { ApiError } from "../lib/api.js";
import { useAuthActions } from "../lib/AuthActionsContext.js";
import { useQueryState, type QueryState as QueryStateValue } from "../lib/useQueryState.js";

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

interface FailureMessage {
  title: string;
  caption?: string;
  action: "sign-in" | "retry" | "none";
}

/** UI §9.5's status table. `of` is the mandatory noun — "the cash position", "this vehicle's paperwork" — the same discipline `NotAvailable`'s `reason` already holds: there is no bare failure message. */
function messageFor(error: unknown, of: string): FailureMessage {
  if (error instanceof ApiError) {
    if (error.status === 401) return { title: "You've been signed out.", action: "sign-in" };
    if (error.status === 403) return { title: `You don't have access to ${of}.`, action: "none" };
    if (error.status === 404)
      return { title: `${capitalize(of)} isn't here any more.`, action: "none" };
    if (error.status >= 500) {
      return {
        title: `Something went wrong loading ${of}.`,
        ...(error.requestId !== "" ? { caption: error.requestId } : {}),
        action: "retry",
      };
    }
    return { title: `${capitalize(of)} couldn't be loaded.`, action: "retry" };
  }
  return { title: "Couldn't reach the server. Check your connection.", action: "retry" };
}

/**
 * UI §6.4/M-28 (GAP-101): `EmptyState`'s sibling for a read that failed —
 * never `AlertStrip` (§3.2: alert strips are Home's urgency channel, "not
 * cards, must not be mistaken for work"; a failed read is not work the
 * manager can do) and never `NotAvailable` (§11.4: "this number does not
 * exist" and "we could not ask" are different facts).
 */
export function QueryStateFailure({
  error,
  retry,
  of,
}: {
  error: unknown;
  retry: () => void;
  of: string;
}) {
  const { signOut } = useAuthActions();
  const message = messageFor(error, of);
  return (
    <div
      className="flex flex-col items-center gap-3 px-4 py-8 text-center"
      role="alert"
      aria-label={`Couldn't load ${of}`}
    >
      <CircleAlert className="size-6 text-critical-ink" aria-hidden />
      <p className="text-body text-ink-secondary">{message.title}</p>
      {message.caption !== undefined ? (
        <p className="text-caption text-ink-muted">{message.caption}</p>
      ) : null}
      {message.action === "sign-in" ? (
        <Button variant="outline" onClick={() => void signOut()}>
          Sign in
        </Button>
      ) : message.action === "retry" ? (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  /** The noun for the failure sentence and its `aria-label` — mandatory, lower-case ("the cash position"), from the reserved vocabulary where one applies (§9.6). */
  of: string;
  children: (data: T) => React.ReactNode;
  /** Rendered while `idle` — a disabled query never yet asked. Defaults to nothing: the caller's own precondition copy usually already covers this case. */
  idleFallback?: React.ReactNode;
  /** Rendered while `pending`. Defaults to the plain "Loading…" text every screen already used before this component existed. */
  pendingFallback?: React.ReactNode;
}

/** One read, wrapped. For several reads on one screen, resolve each with `useQueryState` and combine with `combineQueryStates`, then render this screen's own failure/pending block once. */
export function QueryState<T>({
  query,
  of,
  children,
  idleFallback = null,
  pendingFallback = <p className="text-body text-ink-muted">Loading…</p>,
}: QueryStateProps<T>) {
  const state: QueryStateValue<T> = useQueryState(query);
  if (state.kind === "idle") return <>{idleFallback}</>;
  if (state.kind === "pending") return <>{pendingFallback}</>;
  if (state.kind === "error")
    return <QueryStateFailure error={state.error} retry={state.retry} of={of} />;
  return <>{children(state.data)}</>;
}
