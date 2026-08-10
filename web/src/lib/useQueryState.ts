import type { UseQueryResult } from "@tanstack/react-query";

/**
 * UI §6.4/M-28 (GAP-101): the state a single read is actually in — four
 * outcomes, not TanStack Query's own three. **`idle` is distinct from
 * `pending`**: a query built with `enabled: false` sits in
 * `isPending: true, fetchStatus: "idle"` forever, and a naive
 * `isPending ? <Loading/> : …` would spin on a read that was never asked —
 * reproducing GAP-101 in the twenty-three call sites that use `enabled`.
 */
export type QueryState<T> =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; error: unknown; retry: () => void }
  | { kind: "ready"; data: T };

export function useQueryState<T>(query: UseQueryResult<T>): QueryState<T> {
  if (query.isError) {
    return {
      kind: "error",
      error: query.error,
      retry: () => {
        void query.refetch();
      },
    };
  }
  if (query.isPending) {
    return query.fetchStatus === "idle" ? { kind: "idle" } : { kind: "pending" };
  }
  return { kind: "ready", data: query.data };
}

type CombinedQueryState =
  { kind: "idle" } | { kind: "pending" } | { kind: "error"; retry: () => void } | { kind: "ready" };

/**
 * Resolves several reads into one outcome for a screen that needs all of
 * them: **error beats pending beats idle beats ready**. A screen with one
 * failed read has already failed regardless of what else is in flight — GAP-
 * 101's `HomeScreen` instance ran six queries and let a single failure hide
 * behind five that were still loading. `retry` refetches every failed
 * member, not just the first.
 */
export function combineQueryStates(...states: QueryState<unknown>[]): CombinedQueryState {
  const errors = states.filter(
    (s): s is Extract<QueryState<unknown>, { kind: "error" }> => s.kind === "error",
  );
  if (errors.length > 0) {
    return {
      kind: "error",
      retry: () => {
        for (const e of errors) e.retry();
      },
    };
  }
  if (states.some((s) => s.kind === "pending")) return { kind: "pending" };
  if (states.some((s) => s.kind === "idle")) return { kind: "idle" };
  return { kind: "ready" };
}
