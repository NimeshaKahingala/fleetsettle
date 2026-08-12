import { asBusinessDate } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ExpenseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RecordExpenseSheet } from "./RecordExpenseSheet.js";

// PhotoCapture's own boundary mock (PhotoCapture.test.tsx) — createImageBitmap/
// OffscreenCanvas don't exist under jsdom.
vi.mock("../../lib/photo-pipeline.js", () => ({
  downscaleAndEncode: vi.fn((_file: File) =>
    Promise.resolve({ blob: new Blob(["fake"], { type: "image/jpeg" }), flagged: false }),
  ),
}));

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

const members: BusinessMemberResponse[] = [
  { id: "bm2", userId: "u2", displayName: "Nimal", role: "owner_manager" },
];

async function fillAmount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
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

test("GAP-101: a failed vehicle-list read shows a notice, and amount/category still save (the picker fails in place)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, vehicleId: null });
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(
    <RecordExpenseSheet open onOpenChange={() => {}} today={today} onRecorded={vi.fn()} />,
    { post, get },
  );

  expect(
    await screen.findByText("Something went wrong loading the vehicle list."),
  ).toBeInTheDocument();

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Office" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalled());
});

test("overriding borne-by to Us reaches the request", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
    />,
    { post, get },
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

test("GAP-31: overriding paid-by to another member reaches the request", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, paidByUserId: "u2" });
  const get = vi.fn().mockResolvedValue(members);
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
    />,
    { post, get },
  );

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Fuel" }));

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("button", { name: "Paid by: You" }));
  await user.click(await screen.findByRole("button", { name: /Nimal/ }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ paidByUserId: "u2" }),
    ),
  );
});

test("a photo captured before Save uploads after the expense exists, tagged with its own id (UI §6.3: the record saves first)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  const postBinary = vi.fn().mockResolvedValue({ id: "att-1" });
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
    />,
    { post, get, postBinary },
  );

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.upload(
    screen.getByLabelText("Add a photo file input"),
    new File(["fake"], "receipt.jpg", { type: "image/jpeg" }),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument(),
  );
  // Never touches the network before the expense itself exists.
  expect(postBinary).not.toHaveBeenCalled();

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Fuel" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() => expect(postBinary).toHaveBeenCalled());
  const [path, blob, contentType] = postBinary.mock.calls[0] as [string, Blob, string];
  expect(path.startsWith("/api/attachment?")).toBe(true);
  expect(path).toContain("kind=expense_receipt");
  expect(path).toContain("subjectType=expense");
  expect(path).toContain(`subjectId=${created.id}`);
  expect(contentType).toBe("image/jpeg");
  expect(blob).toBeInstanceOf(Blob);
});
