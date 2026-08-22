import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { SignOutRow } from "./SignOutRow.js";

test("renders a Sign out row", () => {
  renderWithProviders(<SignOutRow />);
  expect(screen.getByText("Sign out")).toBeInTheDocument();
});

test("tapping the row asks for confirmation rather than signing out immediately", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  renderWithProviders(<SignOutRow />, {}, signOut);

  await user.click(screen.getByText("Sign out"));

  expect(await screen.findByText("Sign out?")).toBeInTheDocument();
  expect(signOut).not.toHaveBeenCalled();
});

test("cancelling the confirm sheet does not sign out", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  renderWithProviders(<SignOutRow />, {}, signOut);

  await user.click(screen.getByText("Sign out"));
  await user.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(signOut).not.toHaveBeenCalled();
  expect(screen.queryByText("Sign out?")).not.toBeInTheDocument();
});

test("confirming calls the injected sign-out", async () => {
  const user = userEvent.setup();
  const signOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  renderWithProviders(<SignOutRow />, {}, signOut);

  await user.click(screen.getByText("Sign out"));
  const buttons = await screen.findAllByRole("button", { name: "Sign out" });
  const confirmButton = buttons.at(-1);
  if (!confirmButton) throw new Error("expected a confirm button inside the sheet");
  await user.click(confirmButton);

  expect(signOut).toHaveBeenCalledTimes(1);
});
