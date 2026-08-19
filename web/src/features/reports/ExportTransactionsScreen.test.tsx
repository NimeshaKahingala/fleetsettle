import { asBusinessDate } from "@fleetsettle/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ExportTransactionsScreen } from "./ExportTransactionsScreen.js";

const FROM = asBusinessDate("2026-01-01");
const TO = asBusinessDate("2026-12-31");

test("GAP-18/UC-99: tapping Export CSV fetches the blob through the Worker (bearer token intact) and saves it", async () => {
  const blob = new Blob(["Date,Vehicle,Type,Direction,Amount (Rs)\r\n"], { type: "text/csv" });
  const getBlob = vi.fn().mockResolvedValue({ blob, contentType: "text/csv" });
  renderWithProviders(
    <ExportTransactionsScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { getBlob },
  );

  await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));

  expect(getBlob).toHaveBeenCalledWith(`/api/reports/export?from=${FROM}&to=${TO}`);
  expect(await screen.findByText("Saved to your downloads.")).toBeInTheDocument();
});

test("a failed export shows the error, never a silent no-op", async () => {
  const getBlob = vi
    .fn()
    .mockRejectedValue(new ApiError(403, "FORBIDDEN_CAPABILITY", "boom", "req-1"));
  renderWithProviders(
    <ExportTransactionsScreen
      from={FROM}
      to={TO}
      today={TO}
      onParamsChange={() => {}}
      onBack={() => {}}
    />,
    { getBlob },
  );

  await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));

  expect(await screen.findByText("boom")).toBeInTheDocument();
});
