import { asBusinessDate } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ExpenseListRow,
  ExpenseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ApiClient } from "../../lib/api.js";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RecordExpenseSheet, type RecordExpenseSheetProps } from "./RecordExpenseSheet.js";

// PhotoCapture's own boundary mock (PhotoCapture.test.tsx) — createImageBitmap/
// OffscreenCanvas/Worker don't exist under jsdom.
vi.mock("../../lib/photo-pipeline.js", () => ({
  encodeWithWorkerTimeout: vi.fn((_file: File) =>
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
  odometerReadingId: null,
  odometerReadingKm: null,
  odometerReadingSource: null,
  replacesId: null,
};

const members: BusinessMemberResponse[] = [
  { id: "bm2", userId: "u2", displayName: "Nimal", role: "owner_manager" },
];

async function fillAmount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}

/** The three GAP-216 odometer tests below all reach the odometer field the same way — servicing is arbitrary, just a category the field is offered on. */
async function fillAmountAndChooseServicing(user: ReturnType<typeof userEvent.setup>) {
  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Servicing" }));
}

/**
 * Every test below renders the same sheet, open, against vehicle v1 —
 * differing only in which optional props (`tripId`/`incidentId`, or
 * `vehicleId` omitted for the overhead-cost path) and which API mocks it
 * needs. Extracted once all twelve call sites turned out to share this
 * exact shape (SonarCloud's new-code duplication gate, the same
 * setupDriverFixture/setupClosableLease precedent this repo already uses
 * for a test file's own repeated setup).
 */
interface SheetOverrides {
  // `| undefined` explicitly, unlike the component's own optional prop —
  // a couple of tests below pass `vehicleId: undefined` on purpose (the
  // overhead-cost path, INV-24), distinguished below from the key being
  // absent (which means "use the default v1") by `"vehicleId" in props`
  // rather than a destructuring default, which can't tell the two apart.
  vehicleId?: string | undefined;
  tripId?: RecordExpenseSheetProps["tripId"];
  incidentId?: RecordExpenseSheetProps["incidentId"];
  onRecorded?: RecordExpenseSheetProps["onRecorded"];
}

function renderSheet(props: SheetOverrides = {}, api: Partial<ApiClient> = {}) {
  const vehicleId = "vehicleId" in props ? props.vehicleId : "v1";
  return renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      today={today}
      onRecorded={props.onRecorded ?? vi.fn()}
      {...(vehicleId !== undefined ? { vehicleId } : {})}
      {...(props.tripId !== undefined ? { tripId: props.tripId } : {})}
      {...(props.incidentId !== undefined ? { incidentId: props.incidentId } : {})}
    />,
    api,
  );
}

test("saves with amount, category and a vehicle alone — U-2's level-1 fields, no borneBy or note sent", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const onRecorded = vi.fn();
  renderSheet({ onRecorded }, { post });

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

test("GAP-172: a tripId prop reaches the request alongside the vehicle, and invalidates the trip's own expense list", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, tripId: "t1" });
  const { queryClient } = renderSheet({ tripId: "t1" }, { post });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Repairs" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ vehicleId: "v1", tripId: "t1" }),
    ),
  );
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["trip", "t1", "expense"] });
});

test("GAP-172/Gitar review, PR 128: an incidentId prop reaches the request alongside the vehicle, and invalidates both the incident's expense list and its own detail query (the bottom line's home)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, incidentId: "i1" });
  const { queryClient } = renderSheet({ incidentId: "i1" }, { post });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await fillAmount(user);
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Repairs" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ vehicleId: "v1", incidentId: "i1" }),
    ),
  );
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["incident", "i1", "expense"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["incident", "i1"] });
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
      serviceIntervalKm: null,
      arrangement: "B",
    },
  ];
  const get = vi.fn().mockResolvedValue(vehicles);
  renderSheet({ vehicleId: undefined }, { post, get });

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
  renderSheet({ vehicleId: undefined }, { post, get });

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
  renderSheet({}, { post, get });

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
  renderSheet({}, { post, get });

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

test("GAP-216: an odometer reading and its source reach the request together", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  renderSheet({}, { post, get });

  await fillAmountAndChooseServicing(user);

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText("Odometer reading (km) (optional)"), "45200");
  await user.click(screen.getByRole("button", { name: "In person" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ odometerReadingKm: 45200, odometerSource: "in_person" }),
    ),
  );
});

test("GAP-216: neither odometer key is sent when the reading is left blank", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  renderSheet({}, { post, get });

  await fillAmountAndChooseServicing(user);
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalled());
  const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
  expect("odometerReadingKm" in body).toBe(false);
  expect("odometerSource" in body).toBe(false);
});

test("GAP-216: a reading with no source picked blocks save, and says why", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  renderSheet({}, { post, get });

  await fillAmountAndChooseServicing(user);

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText("Odometer reading (km) (optional)"), "45200");

  expect(screen.getByRole("button", { name: "Record expense" })).toBeDisabled();
  expect(screen.getByText("Choose how this reading was taken")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

/**
 * Copilot review, PR #180: `Number.parseInt("45200.5", 10)` returns `45200`
 * with no error — silently storing a reading eight-tenths of a kilometre
 * off from what was actually typed, since the wire schema only checks the
 * parsed result is a nonnegative integer, which a truncated value already
 * is. Blocked locally instead, before it ever reaches `parseInt`.
 */
test("GAP-216/Copilot review: a non-integer reading blocks save rather than silently truncating", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  renderSheet({}, { post, get });

  await fillAmountAndChooseServicing(user);

  await user.click(screen.getByRole("button", { name: "More" }));
  await user.type(screen.getByLabelText("Odometer reading (km) (optional)"), "45200.5");
  await user.click(screen.getByRole("button", { name: "In person" }));

  expect(screen.getByRole("button", { name: "Record expense" })).toBeDisabled();
  expect(screen.getByText("Enter a whole number of kilometres")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("GAP-216: the odometer field is absent from the overhead-cost path (no vehicle chosen)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...created, vehicleId: null });
  const get = vi.fn().mockResolvedValue([]);
  renderSheet({ vehicleId: undefined }, { post, get });

  await user.click(screen.getByRole("button", { name: "More" }));

  expect(screen.queryByLabelText("Odometer reading (km) (optional)")).not.toBeInTheDocument();
});

test("a photo captured before Save uploads after the expense exists, tagged with its own id (UI §6.3: the record saves first)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue(created);
  const get = vi.fn().mockResolvedValue([]);
  const postBinary = vi.fn().mockResolvedValue({ id: "att-1" });
  renderSheet({}, { post, get, postBinary });

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

const editingPaidByOther: ExpenseListRow = {
  id: "e2",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "fuel",
  amountMinor: "50000",
  spentOn: "2026-08-04",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: "u2",
  litres: null,
  note: null,
  odometerReadingId: null,
  odometerReadingKm: null,
  odometerReadingSource: null,
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

/**
 * Copilot review, PR #181/GAP-224: `paidBy` opens edit mode at its "…"
 * placeholder whenever the row being corrected named someone other than
 * "You" — real only once `membersQuery` resolves it. Saving in that
 * window would hit the mutation's own `paidBy.id !== "you"` check, omit
 * `paidByUserId` from the PATCH, and let the server default it to
 * whoever is editing now — silently reassigning who the expense is
 * recorded as paid by (W-48). A never-resolving `get` keeps the query
 * pending for the whole assertion window, the same technique
 * `ExpenseCostRow.test.tsx`'s GAP-130 case already uses.
 */
test("GAP-224/Copilot review: Save is blocked while the original payer is still resolving, not silently defaulted to the current actor", async () => {
  const get = vi.fn().mockImplementation(() => new Promise<never>(() => {}));
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
      editing={editingPaidByOther}
    />,
    { get },
  );

  expect(await screen.findByRole("button", { name: "Paid by: …" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("GAP-224/Copilot review: Save unblocks once the original payer resolves to their real name", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue(members);
  const patch = vi.fn().mockResolvedValue({ ...created, id: "e3", paidByUserId: "u2" });
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
      editing={editingPaidByOther}
    />,
    { get, patch },
  );

  expect(await screen.findByRole("button", { name: "Paid by: Nimal" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("Reason for the change"), "wrong amount");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  // Confirms the fix end to end: the resolved payer, not an omitted
  // paidByUserId defaulting server-side to whoever is editing now.
  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      "/api/expense/e2",
      expect.objectContaining({ paidByUserId: "u2" }),
    ),
  );
});

const editingNoVehicle: ExpenseListRow = {
  id: "e4",
  vehicleId: null,
  tripId: null,
  incidentId: null,
  category: "office",
  amountMinor: "20000",
  spentOn: "2026-08-04",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: null,
  litres: null,
  note: null,
  odometerReadingId: null,
  odometerReadingKm: null,
  odometerReadingSource: null,
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

/**
 * Copilot review, PR #182: `ExpenseCostRow` omits the `vehicleId` prop
 * entirely for a row with no vehicle (INV-24's overhead case) — the same
 * `undefined` a blank `vehicleId` prop has in create mode, which is when
 * this sheet shows a vehicle picker. Editing must never show it (this
 * sheet can't reassign the vehicle a cost is filed against), regardless of
 * whether `vehicleId` was omitted because there was none to lock, or
 * because there never was one at all.
 */
test("Copilot review, PR 182: editing an overhead (no-vehicle) expense never shows the vehicle picker", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      today={today}
      onRecorded={vi.fn()}
      editing={editingNoVehicle}
    />,
    { get },
  );

  expect(await screen.findByLabelText("Reason for the change")).toBeInTheDocument();
  expect(
    screen.queryByText("Optional — leave blank for a cost with no vehicle (UC-66)"),
  ).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith("/api/vehicle");
});

const editingDriverBorne: ExpenseListRow = {
  id: "e5",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "fuel",
  amountMinor: "50000",
  spentOn: "2026-08-04",
  borneBy: "driver",
  borneByDriverId: "d1",
  borneByCustomerId: null,
  paidByUserId: null,
  litres: null,
  note: null,
  odometerReadingId: null,
  odometerReadingKm: null,
  odometerReadingSource: null,
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

/**
 * Copilot review, PR #182: omitting `borneBy` here let the server
 * recompute its *current* default, which can differ from the original
 * fact (W-48) — correcting an unrelated field (here, nothing about
 * borne-by at all) must not silently reassign who a cost is borne by.
 */
test("Copilot review, PR 182: editing a driver-borne expense preserves the original borne-by unless overridden", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([]);
  const patch = vi.fn().mockResolvedValue({ ...created, id: "e6" });
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
      editing={editingDriverBorne}
    />,
    { get, patch },
  );

  await user.type(await screen.findByLabelText("Reason for the change"), "wrong amount");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      "/api/expense/e5",
      expect.objectContaining({ borneBy: "driver", borneByDriverId: "d1" }),
    ),
  );
  const [, body] = patch.mock.calls[0] as [string, Record<string, unknown>];
  expect(body).not.toHaveProperty("borneByCustomerId");
});

const editingFuelWithLitres: ExpenseListRow = {
  id: "e7",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "fuel",
  amountMinor: "50000",
  spentOn: "2026-08-04",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: null,
  litres: 12.5,
  note: null,
  odometerReadingId: null,
  odometerReadingKm: null,
  odometerReadingSource: null,
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

/**
 * Copilot review, PR #182: this sheet has no litres input at all (fuel
 * litres are only ever captured by `FuelFillSheet`) — without preserving
 * it explicitly, editing any field on a fuel expense silently dropped its
 * litres, since the domain stores whatever the PATCH omits as null.
 */
test("Copilot review, PR 182: editing a fuel expense preserves its litres even though this sheet has no litres field", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([]);
  const patch = vi.fn().mockResolvedValue({ ...created, id: "e8" });
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
      editing={editingFuelWithLitres}
    />,
    { get, patch },
  );

  await user.type(await screen.findByLabelText("Reason for the change"), "wrong amount");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      "/api/expense/e7",
      expect.objectContaining({ litres: 12.5 }),
    ),
  );
});

const editingServicingWithReading: ExpenseListRow = {
  id: "e9",
  vehicleId: "v1",
  tripId: null,
  incidentId: null,
  category: "servicing",
  amountMinor: "50000",
  spentOn: "2026-08-04",
  borneBy: "us",
  borneByDriverId: null,
  borneByCustomerId: null,
  paidByUserId: null,
  litres: null,
  note: null,
  odometerReadingId: "or1",
  odometerReadingKm: 45200,
  odometerReadingSource: "photo",
  replacesId: null,
  voidedAt: null,
  voidedReason: null,
};

/**
 * Copilot review, PR #182: always resetting the odometer fields to blank
 * on open silently dropped a servicing expense's reading on any unrelated
 * correction — `findLastMaintenanceOdometerKm` inner-joins
 * `odometer_reading`, so a replacement with no reading vanished from the
 * maintenance prompt. Prefilled from the row being corrected instead.
 */
test("Copilot review, PR 182: editing a servicing expense preserves its odometer reading unless changed", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([]);
  const patch = vi.fn().mockResolvedValue({ ...created, id: "e10" });
  renderWithProviders(
    <RecordExpenseSheet
      open
      onOpenChange={() => {}}
      vehicleId="v1"
      today={today}
      onRecorded={vi.fn()}
      editing={editingServicingWithReading}
    />,
    { get, patch },
  );

  await user.type(await screen.findByLabelText("Reason for the change"), "wrong amount");
  await user.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByLabelText("Odometer reading (km) (optional)")).toHaveValue(45200);
  expect(screen.getByRole("button", { name: "Photo" })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Save changes" }));

  await vi.waitFor(() =>
    expect(patch).toHaveBeenCalledWith(
      "/api/expense/e9",
      expect.objectContaining({ odometerReadingKm: 45200, odometerSource: "photo" }),
    ),
  );
});
