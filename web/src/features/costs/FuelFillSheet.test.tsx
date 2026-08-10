import { asBusinessDate } from "@fleetsettle/shared";
import type { ExpenseResponse, VehicleResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { FuelFillSheet } from "./FuelFillSheet.js";

// PhotoCapture's own boundary mock (PhotoCapture.test.tsx) — createImageBitmap/
// OffscreenCanvas don't exist under jsdom.
vi.mock("../../lib/photo-pipeline.js", () => ({
  downscaleAndEncode: vi.fn((_file: File) =>
    Promise.resolve({ blob: new Blob(["fake"], { type: "image/jpeg" }), flagged: false }),
  ),
}));

const today = asBusinessDate("2026-08-04");

const vehicles: VehicleResponse[] = [
  { id: "v1", registration: "NC-1234", vehicleType: "bus", lifecycle: "active", arrangement: "B" },
];

const created: ExpenseResponse = {
  id: "e1",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "fuel",
  amountMinor: "500",
  spentOn: "2026-08-04",
  borneBy: "driver",
  borneByDriverId: "d1",
  borneByCustomerId: null,
  paidByUserId: "u1",
  litres: null,
  note: null,
};

test("pre-fills the first vehicle (U-3) and saves with vehicle + amount alone — litres stays optional (W-20)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const post = vi.fn().mockResolvedValue(created);
  const onRecorded = vi.fn();
  renderWithProviders(
    <FuelFillSheet open onOpenChange={() => {}} today={today} onRecorded={onRecorded} />,
    { get, post },
  );

  expect(await screen.findByRole("button", { name: "Vehicle: NC-1234" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Log fuel fill" }));

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

test("litres, when given, reaches the request as a plain number, never money", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const post = vi.fn().mockResolvedValue(created);
  renderWithProviders(
    <FuelFillSheet open onOpenChange={() => {}} today={today} onRecorded={vi.fn()} />,
    { get, post },
  );

  await screen.findByRole("button", { name: "Vehicle: NC-1234" });
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText("Litres"), "12.5");
  await user.click(screen.getByRole("button", { name: "Log fuel fill" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/expense", expect.objectContaining({ litres: 12.5 })),
  );
});

test("a photo captured before Save uploads after the expense exists, tagged with its own id (UI §6.3: the record saves first)", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(vehicles);
  const post = vi.fn().mockResolvedValue(created);
  const postBinary = vi.fn().mockResolvedValue({ id: "att-1" });
  renderWithProviders(
    <FuelFillSheet open onOpenChange={() => {}} today={today} onRecorded={vi.fn()} />,
    { get, post, postBinary },
  );

  await screen.findByRole("button", { name: "Vehicle: NC-1234" });
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.upload(
    screen.getByLabelText("Add a photo file input"),
    new File(["fake"], "receipt.jpg", { type: "image/jpeg" }),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument(),
  );

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Log fuel fill" }));

  await vi.waitFor(() => expect(postBinary).toHaveBeenCalled());
  const [path] = postBinary.mock.calls[0] as [string, Blob, string];
  expect(path).toContain("kind=expense_receipt");
  expect(path).toContain("subjectType=expense");
  expect(path).toContain(`subjectId=${created.id}`);
});
