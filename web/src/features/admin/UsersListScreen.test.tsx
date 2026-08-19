import type { AdminUser } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { UsersListScreen } from "./UsersListScreen.js";

const NAMED_USER: AdminUser = {
  id: "u1",
  email: "nimal@example.com",
  displayName: "Nimal Perera",
  businessAllowance: 5,
  activeBusinessCount: 2,
  isPlatformAdmin: false,
};

const UNNAMED_USER: AdminUser = {
  id: "u2",
  email: null,
  displayName: null,
  businessAllowance: 5,
  activeBusinessCount: 0,
  isPlatformAdmin: false,
};

const ADMIN_USER: AdminUser = {
  id: "u3",
  email: "admin@example.com",
  displayName: null,
  businessAllowance: 5,
  activeBusinessCount: 1,
  isPlatformAdmin: true,
};

test("decision 28: falls back displayName ?? email ?? 'Unnamed user'", async () => {
  const get = vi.fn().mockResolvedValue([NAMED_USER, UNNAMED_USER]);
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Nimal Perera")).toBeInTheDocument();
  expect(screen.getByText("Unnamed user")).toBeInTheDocument();
});

test("shows the active count against the allowance, and a platform-admin badge where it applies", async () => {
  const get = vi.fn().mockResolvedValue([NAMED_USER, ADMIN_USER]);
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("2 of 5 businesses")).toBeInTheDocument();
  expect(screen.getByText("Platform admin")).toBeInTheDocument();
});

test("a failed read shows a failure notice, never an eternal spinner (GAP-101)", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the user list."),
  ).toBeInTheDocument();
});

test("decision 22: setting a user's business allowance", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([NAMED_USER]);
  const post = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByText("Nimal Perera"));
  await user.click(await screen.findByRole("button", { name: "Set business allowance" }));

  const input = await screen.findByLabelText("Allowance");
  expect(input).toHaveValue("5");
  await user.clear(input);
  await user.type(input, "8");
  await user.click(screen.getByRole("button", { name: "Save allowance" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/users/u1/allowance", { businessAllowance: 8 }),
  );
});

test("granting admin is reachable from a user row, and hidden for an existing admin", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([NAMED_USER, ADMIN_USER]);
  const post = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByText("Nimal Perera"));
  expect(await screen.findByRole("button", { name: "Grant admin access" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Grant admin access" }));
  await user.click(await screen.findByRole("button", { name: "Grant admin access" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/admins", { userId: "u1" }));
});

test("an already-admin user's row offers no grant action", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([ADMIN_USER]);
  renderWithProviders(<UsersListScreen onBack={vi.fn()} />, { get });

  await user.click(await screen.findByText("admin@example.com"));
  expect(screen.getByRole("button", { name: "Set business allowance" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Grant admin access" })).not.toBeInTheDocument();
});
