import { asBusinessDate } from "@fleetsettle/shared";
import type { ExpenseListRow, IncidentDetailResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { IncidentScreen } from "./IncidentScreen.js";

function closestButton(element: HTMLElement): HTMLElement {
  const button = element.closest("button");
  if (button === null) throw new Error("expected an ancestor <button>");
  return button;
}

function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`index ${index.toString()} out of bounds`);
  return item;
}

const today = asBusinessDate("2026-07-28");

const openIncident: IncidentDetailResponse = {
  id: "inc1",
  vehicleId: "v1",
  leaseId: "l1",
  status: "open",
  occurredOn: "2026-07-08",
  description: "Rear bumper damage",
  offRoadFrom: null,
  offRoadTo: null,
  rentTreatment: null,
  closedAt: null,
  bottomLine: {
    totalRepairCostMinor: "0",
    totalRecoveredMinor: "0",
    pendingRecoveryMinor: "0",
    netCostMinor: "0",
  },
  recoveries: [],
  insuranceClaim: null,
};

function baseGet(overrides: Record<string, unknown> = {}) {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path === "/api/incident/inc1") return Promise.resolve(openIncident);
    if (path === "/api/incident/inc1/expense") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  return get;
}

test("the bottom line always shows, real zeroes rather than a gap (UI §7.10)", async () => {
  const get = baseGet();
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Bottom line")).toBeInTheDocument();
  expect(screen.getByText("Total repairs")).toBeInTheDocument();
  expect(screen.getByText("Recovered")).toBeInTheDocument();
  expect(screen.getByText("Pending recovery")).toBeInTheDocument();
  expect(screen.getByText("Net cost to you")).toBeInTheDocument();
  expect(screen.getAllByText("Rs 0")).toHaveLength(4);
});

test("G-2's own figures render on the bottom line once repairs and recoveries exist", async () => {
  const withFigures: IncidentDetailResponse = {
    ...openIncident,
    bottomLine: {
      totalRepairCostMinor: "9500000",
      totalRecoveredMinor: "8000000",
      pendingRecoveryMinor: "0",
      netCostMinor: "1500000",
    },
  };
  const get = baseGet({ "/api/incident/inc1": withFigures });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Rs 95,000")).toBeInTheDocument();
  expect(screen.getByText("Rs 80,000")).toBeInTheDocument();
  expect(screen.getByText("Rs 15,000")).toBeInTheDocument();
});

test("Record off-road days is offered until it's set; once recorded, the window shows instead", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Incident actions" }));
  expect(screen.getByRole("button", { name: "Record off-road days" })).toBeInTheDocument();
});

test("GAP-172: Record repair cost is always offered, opens with the incident's own vehicle and this incident pre-filled, and reaches the request", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({
    id: "e1",
    vehicleId: "v1",
    tripId: null,
    incidentId: "inc1",
    category: "repairs",
    amountMinor: "800000",
    spentOn: today,
    borneBy: "us",
    borneByDriverId: null,
    borneByCustomerId: null,
    paidByUserId: null,
    litres: null,
    note: null,
    odometerReadingId: null,
    replacesId: null,
  });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Incident actions" }));
  await user.click(screen.getByRole("button", { name: "Record repair cost" }));
  // The vehicle is pre-filled from the incident, so no picker renders.
  expect(screen.queryByLabelText("Vehicle")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  await user.click(screen.getByRole("button", { name: "8" }));
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Choose category" }));
  await user.click(screen.getByRole("button", { name: "Repairs" }));
  await user.click(screen.getByRole("button", { name: "Record expense" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/expense",
      expect.objectContaining({ vehicleId: "v1", incidentId: "inc1", category: "repairs" }),
    ),
  );
});

test("once off-road is recorded, the window and treatment show and the action disappears", async () => {
  const user = userEvent.setup();
  const withOffRoad: IncidentDetailResponse = {
    ...openIncident,
    offRoadFrom: "2026-07-08",
    offRoadTo: "2026-07-19",
    rentTreatment: "extend",
  };
  const get = baseGet({ "/api/incident/inc1": withOffRoad });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Off-road")).toBeInTheDocument();
  expect(screen.getByText("Rental extended")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Incident actions" }));
  expect(screen.queryByRole("button", { name: "Record off-road days" })).not.toBeInTheDocument();
});

test("a customer recovery not yet fully received is tappable, opening Mark received", async () => {
  const user = userEvent.setup();
  const withRecovery: IncidentDetailResponse = {
    ...openIncident,
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "0",
        replacesId: null,
        belongsToPeriodStart: null,
        voidedAt: null,
        voidedReason: null,
      },
    ],
  };
  const get = baseGet({ "/api/incident/inc1": withRecovery });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Customer contributions · 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Mark received" }));
  expect(await screen.findByRole("heading", { name: "Mark received" })).toBeInTheDocument();
});

test("GAP-147 — an unreceived customer recovery can be voided from the incident screen", async () => {
  const user = userEvent.setup();
  const withRecovery: IncidentDetailResponse = {
    ...openIncident,
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "0",
        replacesId: null,
        belongsToPeriodStart: null,
        voidedAt: null,
        voidedReason: null,
      },
    ],
  };
  const get = baseGet({ "/api/incident/inc1": withRecovery });
  const post = vi.fn().mockResolvedValue({ id: "rec1", voidedAt: "2026-08-20T12:00:00.000Z" });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
    post,
  });

  await screen.findByText("Customer contributions · 1");
  await user.click(screen.getByRole("button", { name: "Void" }));
  await user.type(screen.getByLabelText("Reason"), "entered against the wrong customer");
  await user.click(screen.getByRole("button", { name: "Void contribution" }));

  expect(post).toHaveBeenCalledWith("/api/incident/inc1/recovery/rec1/void", {
    reason: "entered against the wrong customer",
  });
});

test("GAP-147 — a voided customer recovery stays visible with its reason", async () => {
  const withRecovery: IncidentDetailResponse = {
    ...openIncident,
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "0",
        replacesId: null,
        belongsToPeriodStart: null,
        voidedAt: "2026-08-20T12:00:00.000Z",
        voidedReason: "entered against the wrong customer",
      },
    ],
  };
  const get = baseGet({ "/api/incident/inc1": withRecovery });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Customer contributions · 1")).toBeInTheDocument();
  expect(screen.getByText("Agreed")).toHaveClass("line-through");
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("entered against the wrong customer")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark received" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
});

test("a fully received customer recovery is a plain row, not a button", async () => {
  const withRecovery: IncidentDetailResponse = {
    ...openIncident,
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "2000000",
        replacesId: null,
        belongsToPeriodStart: null,
        voidedAt: null,
        voidedReason: null,
      },
    ],
  };
  const get = baseGet({ "/api/incident/inc1": withRecovery });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  const row = await screen.findByText("Agreed");
  expect(row.closest("button")).toBeNull();
  expect(screen.queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
});

test("a submitted insurance claim card is tappable, opening Settle insurance claim", async () => {
  const user = userEvent.setup();
  const withClaim: IncidentDetailResponse = {
    ...openIncident,
    insuranceClaim: {
      id: "claim1",
      incidentId: "inc1",
      claimedAmountMinor: "7500000",
      excessBorneMinor: "1500000",
      status: "submitted",
      receivedAmountMinor: null,
      receivedOn: null,
    },
  };
  const get = baseGet({ "/api/incident/inc1": withClaim });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Insurance claim")).toBeInTheDocument();
  expect(screen.getByText("Submitted")).toBeInTheDocument();

  await user.click(closestButton(screen.getByText("Claimed")));
  expect(await screen.findByText("Settle insurance claim")).toBeInTheDocument();
});

test("once a claim exists, Submit insurance claim is no longer offered", async () => {
  const user = userEvent.setup();
  const withClaim: IncidentDetailResponse = {
    ...openIncident,
    insuranceClaim: {
      id: "claim1",
      incidentId: "inc1",
      claimedAmountMinor: "7500000",
      excessBorneMinor: "1500000",
      status: "submitted",
      receivedAmountMinor: null,
      receivedOn: null,
    },
  };
  const get = baseGet({ "/api/incident/inc1": withClaim });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  await user.click(await screen.findByRole("button", { name: "Incident actions" }));
  expect(screen.queryByRole("button", { name: "Submit insurance claim" })).not.toBeInTheDocument();
});

test("repair costs list, and a voided one stays struck through (W-50)", async () => {
  const expenses: ExpenseListRow[] = [
    {
      id: "e1",
      vehicleId: "v1",
      tripId: null,
      incidentId: "inc1",
      category: "repairs",
      amountMinor: "7000000",
      spentOn: "2026-07-28",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: null,
      voidedReason: null,
      odometerReadingId: null,
      replacesId: null,
    },
    {
      id: "e2",
      vehicleId: "v1",
      tripId: null,
      incidentId: "inc1",
      category: "repairs",
      amountMinor: "2500000",
      spentOn: "2026-08-05",
      borneBy: "us",
      borneByDriverId: null,
      borneByCustomerId: null,
      paidByUserId: null,
      litres: null,
      note: null,
      voidedAt: "2026-08-06T00:00:00.000Z",
      voidedReason: "wrong invoice",
      odometerReadingId: null,
      replacesId: null,
    },
  ];
  const get = baseGet({ "/api/incident/inc1/expense": expenses });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Repair costs · 2")).toBeInTheDocument();
  const voidedRow = nth(screen.getAllByText("Repairs"), 1);
  expect(voidedRow).toHaveClass("line-through");
  expect(screen.getByText("Voided")).toBeInTheDocument();
  expect(screen.getByText("wrong invoice")).toBeInTheDocument();
});

test("Close incident is offered on an open incident", async () => {
  const get = baseGet();
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByRole("button", { name: "Close incident" })).toBeInTheDocument();
});

test("a closed incident does not offer Close incident again", async () => {
  const closedIncident: IncidentDetailResponse = { ...openIncident, status: "closed" };
  const get = baseGet({ "/api/incident/inc1": closedIncident });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Rear bumper damage")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close incident" })).not.toBeInTheDocument();
});

test("GAP-101: a failed incident read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(
    await screen.findByText("Something went wrong loading this incident."),
  ).toBeInTheDocument();
});

test("GAP-101: a failed repair-costs read shows a failure notice rather than a silently empty list", async () => {
  const get = baseGet({
    "/api/incident/inc1/expense": Promise.reject(
      new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"),
    ),
  });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Something went wrong loading repair costs.")).toBeInTheDocument();
});

test("GAP-173/F-8.1: a late-posted recovery is flagged with the month it belongs to", async () => {
  const lateRecovery: IncidentDetailResponse = {
    ...openIncident,
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "0",
        replacesId: null,
        // Agreed in July, posted into the open month because July had closed.
        belongsToPeriodStart: asBusinessDate("2026-07-01"),
        voidedAt: null,
        voidedReason: null,
      },
    ],
  };
  const get = baseGet({ "/api/incident/inc1": lateRecovery });
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  expect(await screen.findByText("Belongs to July 2026")).toBeInTheDocument();
});

test("GAP-173: an ordinary recovery carries no belongs-to flag at all", async () => {
  const get = baseGet();
  renderWithProviders(<IncidentScreen incidentId="inc1" today={today} onBack={() => {}} />, {
    get,
  });

  await screen.findByText("Bottom line");
  expect(screen.queryByText(/Belongs to/)).not.toBeInTheDocument();
});
