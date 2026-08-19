import { QueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthActionsProvider, useAuthActions } from "./AuthActionsContext.js";
import { getSelectedBusinessId, setSelectedBusinessId } from "./storage.js";

beforeEach(() => {
  localStorage.clear();
});

describe("useAuthActions", () => {
  it("throws when called outside a provider, the same as useApi does", () => {
    expect(() => renderHook(() => useAuthActions())).toThrow(/AuthActionsProvider/);
  });

  it("decision 25: clears the stored business selection on sign-out — the one path both auth-asgardeo.ts and auth-stub.ts route through", async () => {
    setSelectedBusinessId("b1");
    const queryClient = new QueryClient();
    const rawSignOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuthActions(), {
      wrapper: ({ children }) => (
        <AuthActionsProvider queryClient={queryClient} rawSignOut={rawSignOut}>
          {children}
        </AuthActionsProvider>
      ),
    });

    await result.current.signOut();

    expect(getSelectedBusinessId()).toBeNull();
  });

  it("clears the query cache before calling the raw sign-out (GAP-40's trap)", async () => {
    const order: string[] = [];
    const queryClient = new QueryClient();
    queryClient.setQueryData(["me"], { role: "owner_manager" });
    const rawSignOut = vi.fn<() => Promise<void>>().mockImplementation(() => {
      order.push("rawSignOut");
      return Promise.resolve();
    });
    const clearSpy = vi.spyOn(queryClient, "clear").mockImplementation(() => {
      order.push("clear");
    });

    const { result } = renderHook(() => useAuthActions(), {
      wrapper: ({ children }) => (
        <AuthActionsProvider queryClient={queryClient} rawSignOut={rawSignOut}>
          {children}
        </AuthActionsProvider>
      ),
    });

    await result.current.signOut();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(rawSignOut).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["clear", "rawSignOut"]);
  });
});
