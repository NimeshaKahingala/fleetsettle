import type { ReceivablesResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReceivablesReportScreen } from "./ReceivablesReportScreen.js";

test("renders every party, largest-outstanding first as given, with a name fallback", async () => {
  const rows: ReceivablesResponse = [
    {
      partyType: "customer",
      partyId: "c1",
      partyName: "Nimal Perera",
      outstandingMinor: "1500000",
      oldestDueOn: "2026-06-01",
    },
    {
      partyType: "driver",
      partyId: "d1",
      partyName: null,
      outstandingMinor: "300000",
      oldestDueOn: "2026-06-15",
    },
  ];
  const get = vi.fn().mockResolvedValue(rows);
  renderWithProviders(<ReceivablesReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Nimal Perera")).toBeInTheDocument();
  expect(await screen.findByText("Unnamed driver")).toBeInTheDocument();
  expect(screen.getByText("Rs 15,000")).toBeInTheDocument();
  expect(screen.getByText("Rs 3,000")).toBeInTheDocument();
});

test("an empty response reads as a real fact, not a loading state that never resolves", async () => {
  const get = vi.fn().mockResolvedValue([] satisfies ReceivablesResponse);
  renderWithProviders(<ReceivablesReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("No one owes us anything.")).toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice, never a false 'no one owes us anything'", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<ReceivablesReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Something went wrong loading who owes us.")).toBeInTheDocument();
  expect(screen.queryByText("No one owes us anything.")).not.toBeInTheDocument();
});
