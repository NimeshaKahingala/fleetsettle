import type { BusinessMemberResponse, MeResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { MembersScreen } from "./MembersScreen.js";

const OWNER_MANAGER: MeResponse = { userId: "u1", businessId: "b1", role: "owner_manager" };

const members: BusinessMemberResponse[] = [
  { id: "bm1", userId: "u1", displayName: "Nimal", role: "owner" },
  { id: "bm2", userId: "u2", displayName: null, role: "manager" },
];

function baseGet() {
  return vi.fn().mockImplementation((path: string) => {
    if (path === "/api/business-member") return Promise.resolve(members);
    throw new Error(`unexpected path ${path}`);
  });
}

test("UI-8: lists active members with role labels", async () => {
  renderWithProviders(
    <MembersScreen onBack={vi.fn()} />,
    { get: baseGet() },
    undefined,
    OWNER_MANAGER,
  );

  expect(await screen.findByText("Active members · 2")).toBeInTheDocument();
  expect(screen.getByText("Nimal")).toBeInTheDocument();
  expect(screen.getByText("Owner")).toBeInTheDocument();
  expect(screen.getByText("Unnamed member")).toBeInTheDocument();
  expect(screen.getByText("Manager")).toBeInTheDocument();
});

test("GAP-115/GAP-1: all three roles appear in both the invite and change-role pickers, now that per-vehicle scoping (Wave 3) has lifted the manager-exclusion stopgap", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <MembersScreen onBack={vi.fn()} />,
    { get: baseGet() },
    undefined,
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: "Invite member" }));
  expect(screen.getByRole("button", { name: "Owner" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Owner-manager" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manager" })).toBeInTheDocument();
  await user.click(screen.getByLabelText("Close"));

  await user.click(await screen.findByRole("button", { name: /Nimal/ }));
  await user.click(await screen.findByRole("button", { name: "Change role" }));
  expect(screen.getByRole("button", { name: "Manager" })).toBeInTheDocument();
});

test("UI-8: owner creates an owner-manager invite and sees the one-time code", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    code: "ABC-123",
    role: "owner_manager",
    expiresAt: "2026-08-12T00:00:00.000Z",
  });
  renderWithProviders(
    <MembersScreen onBack={vi.fn()} />,
    { get: baseGet(), post },
    undefined,
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: "Invite member" }));
  await user.click(await screen.findByRole("button", { name: "Create invite" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/business-member/invite", { role: "owner_manager" }),
  );
  expect(await screen.findByText("ABC-123")).toBeInTheDocument();
});

test("UI-8: changing a member role targets the membership row id", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "bm3", userId: "u1", role: "owner_manager" });
  renderWithProviders(
    <MembersScreen onBack={vi.fn()} />,
    { get: baseGet(), post },
    undefined,
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: /Nimal/ }));
  await user.click(await screen.findByRole("button", { name: "Change role" }));
  await user.click(await screen.findByRole("button", { name: "Save role" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/business-member/bm1/change-role", {
      role: "owner_manager",
    }),
  );
});

test("UI-8: revoking access asks for confirmation and targets the membership row id", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ id: "bm1", revokedAt: "2026-08-11T00:00:00.000Z" });
  renderWithProviders(
    <MembersScreen onBack={vi.fn()} />,
    { get: baseGet(), post },
    undefined,
    OWNER_MANAGER,
  );

  await user.click(await screen.findByRole("button", { name: /Nimal/ }));
  await user.click(await screen.findByRole("button", { name: "Revoke access" }));
  await user.click(await screen.findByRole("button", { name: "Revoke access" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/business-member/bm1/revoke", {}));
});

test("GAP-101: failed member list read shows a scoped failure", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-members"));
  renderWithProviders(<MembersScreen onBack={vi.fn()} />, { get }, undefined, OWNER_MANAGER);

  expect(await screen.findByText("Something went wrong loading members.")).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});
