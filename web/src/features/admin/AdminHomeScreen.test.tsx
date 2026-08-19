import type * as ReactRouter from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { AdminHomeScreen } from "./AdminHomeScreen.js";

// AdminHomeScreen is a real route component (`router.tsx`'s own
// `component: AdminHomeScreen`, reached only via FirstRunGate's admin
// precedence check), so it calls `useNavigate()` directly — the same reason
// `MoreScreen.test.tsx` mocks it rather than pulling in a real router.
const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>();
  return { ...actual, useNavigate: () => navigate };
});

test("lists a row for every admin surface", () => {
  renderWithProviders(<AdminHomeScreen />);

  expect(screen.getByText("Request queue")).toBeInTheDocument();
  expect(screen.getByText("Businesses")).toBeInTheDocument();
  expect(screen.getByText("Users")).toBeInTheDocument();
  expect(screen.getByText("Admin management")).toBeInTheDocument();
  expect(screen.getByText("Platform log")).toBeInTheDocument();
});

test.each([
  ["Request queue", "/admin/requests"],
  ["Businesses", "/admin/businesses"],
  ["Users", "/admin/users"],
  ["Admin management", "/admin/admins"],
  ["Platform log", "/admin/audit-log"],
])("tapping %s navigates to %s", async (label, to) => {
  navigate.mockClear();
  const user = userEvent.setup();
  renderWithProviders(<AdminHomeScreen />);

  await user.click(screen.getByText(label));

  expect(navigate).toHaveBeenCalledWith({ to });
});
