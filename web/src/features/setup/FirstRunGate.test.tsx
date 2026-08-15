import type { MeResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { FirstRunGate } from "./FirstRunGate.js";

test("a 404 on /api/me — the documented first-run/revoked-member signal — renders the get-started form, not a failure notice", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(404, "NOT_FOUND", "not found", "req-1"));
  renderWithProviders(
    <FirstRunGate
      renderOperate={() => <p>Operate</p>}
      renderReview={() => <p>Review</p>}
      renderMine={() => <p>Mine</p>}
    />,
    { get },
  );

  expect(await screen.findByText("Get started")).toBeInTheDocument();
  expect(screen.getByLabelText("FleetSettle")).toBeInTheDocument();
  expect(screen.getByText("Create a business")).toBeInTheDocument();
  expect(screen.getByText("Join a business")).toBeInTheDocument();
  expect(screen.getByText("Enter the code you were given.")).toBeInTheDocument();
});

test("GAP-101: a real server error on /api/me shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <FirstRunGate
      renderOperate={() => <p>Operate</p>}
      renderReview={() => <p>Review</p>}
      renderMine={() => <p>Mine</p>}
    />,
    { get },
  );

  expect(await screen.findByText("Something went wrong loading your account.")).toBeInTheDocument();
  expect(screen.queryByText("Get started")).not.toBeInTheDocument();
});

test("a resolved role routes to the matching shell", async () => {
  const me: MeResponse = { userId: "u1", businessId: "b1", role: "owner" };
  const get = vi.fn().mockResolvedValue(me);
  renderWithProviders(
    <FirstRunGate
      renderOperate={() => <p>Operate</p>}
      renderReview={() => <p>Review</p>}
      renderMine={() => <p>Mine</p>}
    />,
    { get },
  );

  expect(await screen.findByText("Review")).toBeInTheDocument();
});
