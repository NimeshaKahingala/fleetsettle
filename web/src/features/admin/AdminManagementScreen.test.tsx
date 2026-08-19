import type { PlatformAdmin } from "@fleetsettle/shared/schemas";
import type * as ReactRouter from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AdminManagementScreen } from "./AdminManagementScreen.js";

// AdminManagementScreen's own "grant" affordance navigates to /admin/users
// (see the screen's doc comment) rather than opening a picker in place —
// no test here clicks it, so a no-op stand-in avoids the "useNavigate must
// be used inside a <RouterProvider>" noise the same way MoreScreen.test.tsx
// already does for the same reason.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const ADMIN_ONE: PlatformAdmin = {
  userId: "u1",
  email: "nimal@example.com",
  displayName: "Nimal Perera",
  grantedAt: "2026-08-18",
};

const ADMIN_TWO: PlatformAdmin = {
  userId: "u2",
  email: "unnamed@example.com",
  displayName: null,
  grantedAt: "2026-08-01",
};

test("decision 28: lists active admins, falling back displayName ?? email ?? 'Unnamed user'", async () => {
  const get = vi.fn().mockResolvedValue([ADMIN_ONE, { ...ADMIN_TWO, email: null }]);
  renderWithProviders(<AdminManagementScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Nimal Perera")).toBeInTheDocument();
  expect(screen.getByText("Unnamed user")).toBeInTheDocument();
});

test("GAP-142: 'Admin since' shows a formatted date, never the raw timestamptz text", async () => {
  const get = vi
    .fn()
    .mockResolvedValue([{ ...ADMIN_ONE, grantedAt: "2026-08-18 06:44:12.905112+00" }]);
  renderWithProviders(<AdminManagementScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Admin since 18 Aug 2026")).toBeInTheDocument();
  expect(screen.queryByText(/06:44:12/)).not.toBeInTheDocument();
});

test("a failed read shows a failure notice, never an eternal spinner (GAP-101)", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<AdminManagementScreen onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the admin list."),
  ).toBeInTheDocument();
});

test("revoking asks for confirmation before removing access", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([ADMIN_ONE, ADMIN_TWO]);
  const post = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<AdminManagementScreen onBack={vi.fn()} />, { get, post });

  await user.click(
    await screen.findByRole("button", { name: "Revoke admin access for Nimal Perera" }),
  );
  expect(await screen.findByText("Revoke admin access?")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Revoke access" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/admins/u1/revoke", {}));
});

test("INV-40: revoking the last admin shows the specific reason, not a generic failure", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([ADMIN_ONE]);
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiError(
        409,
        "LAST_PLATFORM_ADMIN_REQUIRED",
        "The platform must always have at least one active admin",
        "req-1",
      ),
    );
  renderWithProviders(<AdminManagementScreen onBack={vi.fn()} />, { get, post });

  await user.click(
    await screen.findByRole("button", { name: "Revoke admin access for Nimal Perera" }),
  );
  await user.click(screen.getByRole("button", { name: "Revoke access" }));

  expect(
    await screen.findByText("The platform must always have at least one active admin"),
  ).toBeInTheDocument();
});
