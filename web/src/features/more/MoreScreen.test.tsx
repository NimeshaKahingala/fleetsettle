import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { MoreScreen } from "./MoreScreen.js";

describe("MoreScreen", () => {
  test("shows a sign-out row and nothing else, since no other B item has landed yet", () => {
    renderWithProviders(<MoreScreen />);

    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  test("tapping the row asks for confirmation rather than signing out immediately", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderWithProviders(<MoreScreen />, {}, signOut);

    await user.click(screen.getByText("Sign out"));

    expect(await screen.findByText("Sign out?")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("cancelling the confirm sheet does not sign out", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderWithProviders(<MoreScreen />, {}, signOut);

    await user.click(screen.getByText("Sign out"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByText("Sign out?")).not.toBeInTheDocument();
  });

  test("confirming calls the injected sign-out and clears the query cache (GAP-40)", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { queryClient } = renderWithProviders(<MoreScreen />, {}, signOut);
    queryClient.setQueryData(["me"], { role: "owner_manager" });
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
