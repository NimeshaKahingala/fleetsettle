import type { UseQueryResult } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { ApiError } from "../lib/api.js";
import { QueryState } from "./QueryState.js";

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

test("a disabled query renders the idle fallback, never the pending one — a query never asked must not spin forever", () => {
  renderWithProviders(
    <QueryState
      query={mockQuery({ isPending: true, fetchStatus: "idle" })}
      of="the cash position"
      idleFallback={<p>pick a vehicle first</p>}
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("pick a vehicle first")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  expect(screen.queryByText("ready")).not.toBeInTheDocument();
});

test("a query in flight renders the default Loading… text", () => {
  renderWithProviders(
    <QueryState
      query={mockQuery({ isPending: true, fetchStatus: "fetching" })}
      of="the cash position"
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("Loading…")).toBeInTheDocument();
});

test("a resolved query renders its children with data, never Loading…", () => {
  renderWithProviders(
    <QueryState query={mockQuery({ data: { name: "Sampath savings" } })} of="the cash position">
      {(data) => <p>{data.name}</p>}
    </QueryState>,
  );
  expect(screen.getByText("Sampath savings")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});

test("a 404 renders the status-mapped sentence, never Loading… and never the children", () => {
  renderWithProviders(
    <QueryState
      query={mockQuery({ isError: true, error: new ApiError(404, "NOT_FOUND", "gone", "req-1") })}
      of="this vehicle"
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("This vehicle isn't here any more.")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  expect(screen.queryByText("ready")).not.toBeInTheDocument();
});

test("a 403 states access, not existence, and offers no retry (retrying does not change a capability)", () => {
  renderWithProviders(
    <QueryState
      query={mockQuery({
        isError: true,
        error: new ApiError(403, "FORBIDDEN_CAPABILITY", "nope", "req-1"),
      })}
      of="this driver's balances"
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("You don't have access to this driver's balances.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("a 500 shows the request ID as a caption and a working Try again", async () => {
  const user = userEvent.setup();
  const refetch = vi.fn();
  renderWithProviders(
    <QueryState
      query={mockQuery({
        isError: true,
        error: new ApiError(500, "INTERNAL_ERROR", "boom", "req-abc123"),
        refetch,
      })}
      of="the cash position"
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("Something went wrong loading the cash position.")).toBeInTheDocument();
  expect(screen.getByText("req-abc123")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledOnce();
});

test("a 401 offers Sign in, which calls the injected signOut", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <QueryState
      query={mockQuery({
        isError: true,
        error: new ApiError(401, "INVALID_TOKEN", "no token", "req-1"),
      })}
      of="the cash position"
    >
      {() => <p>ready</p>}
    </QueryState>,
    {},
    signOut,
  );
  expect(screen.getByText("You've been signed out.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(signOut).toHaveBeenCalledOnce();
});

test("a network failure (not an ApiError) shows the connectivity sentence with a retry", () => {
  renderWithProviders(
    <QueryState
      query={mockQuery({ isError: true, error: new TypeError("Failed to fetch") })}
      of="the cash position"
    >
      {() => <p>ready</p>}
    </QueryState>,
  );
  expect(screen.getByText("Couldn't reach the server. Check your connection.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
