import { asBusinessDate } from "@fleetsettle/shared";
import type { ExpenseResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RecordExpenseSheet } from "./RecordExpenseSheet.js";

const today = asBusinessDate("2026-08-04");

const created: ExpenseResponse = {
  id: "e1",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "fuel",
  amountMinor: "500",
  spentOn: "2026-08-04",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: "u1",
  litres: null,
  note: null,
};

async function fillAmount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Rs 0" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("saves with amount, category and a vehicle alone — U-2's level-1 fields, no borneBy or note sent", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const onRecorded = vi.fn();
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={onRecorded}
    />,
    { post },
  );

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Fuel" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/expense", {
      vehicleId: "v1",
      category: "fuel",
      amountMinor: "5",
      spentOn: today,
    }),
  );
  expect(onRecorded).toHaveBeenCalledWith(created);
});

test("no vehicleId prop shows a vehicle picker, and leaving it blank is a valid overhead cost (INV-24)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, vehicleId: null });
  const vehicles: VehicleResponse[] = [
    {
      id: "v1",
      registration: "NC-1234",
      vehicleType: "bus",
      lifecycle: "active",
      arrangement: "B",
    },
  ];
  const get = vi.fn().mockResolvedValue(vehicles);
  renderWithProviders(
    <RecordExpenseSheet open onOpenChange={() => {}} today={today} onRecorded={vi.fn()} />,
    { post, get },
  );

  expect(
    screen.getByText("Optional — leave blank for a cost with no vehicle (UC-66)"),
  ).toBeInTheDocument();

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Office" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalled());
  const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
  expect("vehicleId" in body).toBe(false);
});

test("overriding borne-by to Us reaches the request", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
    />,
    { post },
  );

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Fuel" }));

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("button", { name: "Borne by: Resolved automatically" }));
  await user.click(screen.getByRole("button", { name: "Us (the business)" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/expense", expect.objectContaining({ borneBy: "us" })),
  );
});
