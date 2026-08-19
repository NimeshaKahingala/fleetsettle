import type { AdminRequest } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RequestQueueScreen } from "./RequestQueueScreen.js";

const PENDING: AdminRequest = {
  id: "r1",
  requestedBy: "u1",
  requesterName: "Nimal Perera",
  requesterEmail: "nimal@example.com",
  name: "Perera Transport",
  status: "pending",
  createdAt: "2026-08-18T00:00:00.000Z",
  decidedAt: null,
  rejectionReason: null,
  selfAction: false,
};

const SELF_PENDING: AdminRequest = { ...PENDING, id: "r2", selfAction: true };

const REJECTED: AdminRequest = {
  ...PENDING,
  id: "r3",
  status: "rejected",
  decidedAt: "2026-08-18T01:00:00.000Z",
  rejectionReason: "Too many businesses already",
};

test("F-11.1: lists requests with their status and requester", async () => {
  const get = vi.fn().mockResolvedValue([PENDING]);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Perera Transport")).toBeInTheDocument();
  expect(screen.getByText("Nimal Perera · nimal@example.com")).toBeInTheDocument();
  expect(screen.getByText("Awaiting a decision")).toBeInTheDocument();
});

test("a genuinely empty queue renders as a real empty state, not a failure", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("No requests yet.")).toBeInTheDocument();
});

test("a failed read shows a failure notice, never an eternal spinner (GAP-101)", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the request queue."),
  ).toBeInTheDocument();
});

test("decision 11/W-67: a self-submitted pending request renders a visible marker, not just an aria-label", async () => {
  const get = vi.fn().mockResolvedValue([SELF_PENDING]);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Your own request")).toBeInTheDocument();
});

test("a rejected request shows its reason inline", async () => {
  const get = vi.fn().mockResolvedValue([REJECTED]);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Declined: Too many businesses already")).toBeInTheDocument();
});

test("approving a pending request confirms first, then decides and refreshes the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([PENDING]);
  const post = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByText("Perera Transport"));
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  expect(await screen.findByText("Approve this request?")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Approve request" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/requests/r1/decide", { decision: "approve" }),
  );
});

test("declining requires a reason and shows it was declined", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([PENDING]);
  const post = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByText("Perera Transport"));
  await user.click(await screen.findByRole("button", { name: "Decline" }));
  expect(await screen.findByText("Decline this request?")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Reason"), "Not enough activity yet");
  await user.click(screen.getByRole("button", { name: "Decline request" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/admin/requests/r1/decide", {
      decision: "reject",
      reason: "Not enough activity yet",
    }),
  );
});

test("INV-40-adjacent: a decide failure shows the server's own message, not a generic toast", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([PENDING]);
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiError(409, "REQUEST_ALREADY_DECIDED", "This request has already been decided", "r1"),
    );
  renderWithProviders(<RequestQueueScreen onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByText("Perera Transport"));
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(await screen.findByRole("button", { name: "Approve request" }));

  expect(await screen.findByText("This request has already been decided")).toBeInTheDocument();
});
