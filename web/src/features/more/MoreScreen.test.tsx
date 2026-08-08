import type { MeResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { MoreScreen } from "./MoreScreen.js";

const OWNER_MANAGER: MeResponse = { userId: "u1", businessId: "b1", role: "owner_manager" };
const MANAGER: MeResponse = { userId: "u2", businessId: "b1", role: "manager" };

describe("MoreScreen", () => {
  test("an owner_manager sees Opening balances, Close the month and Sign out — every row a real B item has built so far", () => {
    renderWithProviders(<MoreScreen />, {}, () => Promise.resolve(), OWNER_MANAGER);

    expect(screen.getByText("Opening balances")).toBeInTheDocument();
    expect(screen.getByText("Close the month")).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  test("a manager never sees Opening balances or Close the month — absent, not disabled (M-22)", () => {
    renderWithProviders(<MoreScreen />, {}, () => Promise.resolve(), MANAGER);

    expect(screen.queryByText("Opening balances")).not.toBeInTheDocument();
    expect(screen.queryByText("Close the month")).not.toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  test("tapping the row asks for confirmation rather than signing out immediately", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderWithProviders(<MoreScreen />, {}, signOut, OWNER_MANAGER);

    await user.click(screen.getByText("Sign out"));

    expect(await screen.findByText("Sign out?")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("cancelling the confirm sheet does not sign out", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderWithProviders(<MoreScreen />, {}, signOut, OWNER_MANAGER);

    await user.click(screen.getByText("Sign out"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByText("Sign out?")).not.toBeInTheDocument();
  });

  test("confirming calls the injected sign-out and clears the query cache (GAP-40)", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { queryClient } = renderWithProviders(<MoreScreen />, {}, signOut, OWNER_MANAGER);
    expect(queryClient.getQueryData(["me"])).toBeDefined();

    await user.click(screen.getByText("Sign out"));
    // Two "Sign out" buttons exist once the sheet is open — the row behind
    // it and the sheet's own confirm — so the row (rendered first) and the
    // confirm (rendered last, inside the sheet's portal) are told apart by
    // position rather than a second accessible name.
    const buttons = await screen.findAllByRole("button", { name: "Sign out" });
    const confirmButton = buttons.at(-1);
    if (!confirmButton) throw new Error("expected a confirm button inside the sheet");
    await user.click(confirmButton);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });
});
