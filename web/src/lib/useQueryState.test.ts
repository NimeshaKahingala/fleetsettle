import type { UseQueryResult } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { combineQueryStates, useQueryState } from "./useQueryState.js";

/** A minimal stand-in for `UseQueryResult` — only the fields `useQueryState` reads. */
function mockQuery<T>(partial: {
  isError?: boolean;
  isPending?: boolean;
  fetchStatus?: "idle" | "fetching" | "paused";
  error?: unknown;
  data?: T;
  refetch?: () => void;
}): UseQueryResult<T> {
  return {
    isError: partial.isError ?? false,
    isPending: partial.isPending ?? false,
    fetchStatus: partial.fetchStatus ?? "idle",
    error: partial.error ?? null,
    data: partial.data,
    refetch: partial.refetch ?? vi.fn(),
  } as unknown as UseQueryResult<T>;
}

test("a disabled query (isPending, fetchStatus idle) resolves to idle, not pending — the trap this hook exists to avoid", () => {
  const { result } = renderHook(() =>
    useQueryState(mockQuery({ isPending: true, fetchStatus: "idle" })),
  );
  expect(result.current.kind).toBe("idle");
});

test("a query actually in flight (isPending, fetchStatus fetching) resolves to pending", () => {
  const { result } = renderHook(() =>
    useQueryState(mockQuery({ isPending: true, fetchStatus: "fetching" })),
  );
  expect(result.current.kind).toBe("pending");
});

test("a failed query resolves to error and carries a working retry", () => {
  const refetch = vi.fn();
  const boom = new Error("boom");
  const { result } = renderHook(() =>
    useQueryState(mockQuery({ isError: true, error: boom, refetch })),
  );
  expect(result.current.kind).toBe("error");
  if (result.current.kind !== "error") throw new Error("expected error");
  expect(result.current.error).toBe(boom);
  result.current.retry();
  expect(refetch).toHaveBeenCalledOnce();
});

test("a resolved query carries its data, narrowed non-undefined", () => {
  const { result } = renderHook(() => useQueryState(mockQuery({ data: { id: "v1" } })));
  expect(result.current.kind).toBe("ready");
  if (result.current.kind !== "ready") throw new Error("expected ready");
  expect(result.current.data).toEqual({ id: "v1" });
});

test("combineQueryStates: one error among a pending and a ready still resolves to error — a screen with one failed read has already failed", () => {
  const retry = vi.fn();
  const combined = combineQueryStates(
    { kind: "ready", data: 1 },
    { kind: "pending" },
    { kind: "error", error: new Error("boom"), retry },
  );
  expect(combined.kind).toBe("error");
  if (combined.kind !== "error") throw new Error("expected error");
  combined.retry();
  expect(retry).toHaveBeenCalledOnce();
});

test("combineQueryStates: two errors both refetch on one combined retry", () => {
  const retryA = vi.fn();
  const retryB = vi.fn();
  const combined = combineQueryStates(
    { kind: "error", error: new Error("a"), retry: retryA },
    { kind: "error", error: new Error("b"), retry: retryB },
  );
  if (combined.kind !== "error") throw new Error("expected error");
  combined.retry();
  expect(retryA).toHaveBeenCalledOnce();
  expect(retryB).toHaveBeenCalledOnce();
});

test("combineQueryStates: pending beats idle when nothing has failed", () => {
  const combined = combineQueryStates({ kind: "idle" }, { kind: "pending" });
  expect(combined.kind).toBe("pending");
});

test("combineQueryStates: idle when nothing has failed, nothing is pending, and at least one is idle", () => {
  const combined = combineQueryStates({ kind: "ready", data: 1 }, { kind: "idle" });
  expect(combined.kind).toBe("idle");
});

test("combineQueryStates: ready only when every state is ready", () => {
  const combined = combineQueryStates({ kind: "ready", data: 1 }, { kind: "ready", data: 2 });
  expect(combined.kind).toBe("ready");
});
