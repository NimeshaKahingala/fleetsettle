import type {
  DriverBalancesResponse,
  DriverResponse,
  DriverViewResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DriverDetailScreen } from "./DriverDetailScreen.js";

const owner = { userId: "u1", businessId: "b1", role: "owner" as const };
const manager = { userId: "u1", businessId: "b1", role: "manager" as const };

const emptyHistory: DriverViewResponse = {
  owedToUsMinor: "0",
  owedByUsMinor: "0",
  days: [],
  trips: [],
  advances: [],
  offsets: [],
  deposit: null,
  owedToUsObligations: [],
};

function isDriverHistoryPath(path: string): boolean {
  return path.startsWith("/api/driver/d1/view?");
}

test("renders the driver's name and both balances, never a signed net (W-2)", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "800000",
        owedByUsMinor: "1200000",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  // GAP-78: "Sunil Perera" appears once — Screen's own title, not repeated
  // as a bare unlabeled heading inside TwoBalances too. Distinct from
  // VehicleOverviewScreen's "Registration: CAB-1234" field, which is a
  // labeled data row alongside Type/Arrangement, not a duplicate heading.
  expect(await screen.findAllByText("Sunil Perera")).toHaveLength(1);
  expect(screen.getByText("He owes you")).toBeInTheDocument();
  expect(screen.getByText("Rs 8,000")).toBeInTheDocument();
  expect(screen.getByText("You owe him")).toBeInTheDocument();
  expect(screen.getByText("Rs 12,000")).toBeInTheDocument();
  expect(screen.getByText("Net: you owe him")).toBeInTheDocument();
});

test("GAP-101: a failed balances read shows a failure notice, never an eternal spinner", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading this driver's balances."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
});

test("Offset opens the offset sheet", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    return Promise.resolve({
      driverId: "d1",
      owedToUsMinor: "0",
      owedByUsMinor: "0",
    } satisfies DriverBalancesResponse);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  await user.click(await screen.findByRole("button", { name: "Offset…" }));

  expect(await screen.findByText("Offset")).toBeInTheDocument();
});

function baseGet() {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  return get;
}

test("A5: staff driver detail shows recent days, trips, advances, offsets and deposit", async () => {
  const history: DriverViewResponse = {
    owedToUsMinor: "200000",
    owedByUsMinor: "900000",
    days: [
      {
        businessDate: "2026-08-10",
        state: "paused_for_trip",
        earnedMinor: "0",
        receivedMinor: "0",
        lostReason: null,
      },
    ],
    trips: [
      {
        id: "t1",
        vehicleId: "v1",
        closingDate: "2026-08-09",
        agreedAmountMinor: "3000000",
        driverFeeMinor: "500000",
      },
    ],
    advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
    offsets: [
      {
        id: "o1",
        amountMinor: "50000",
        occurredOn: "2026-08-05",
        voidedAt: null,
        voidedReason: null,
      },
    ],
    deposit: {
      id: "dep1",
      heldMinor: "250000",
      movements: [
        {
          id: "dm1",
          movementType: "taken",
          amountMinor: "250000",
          occurredOn: "2026-08-01",
          reason: null,
          voidedAt: null,
          voidedReason: null,
        },
      ],
    },
    owedToUsObligations: [],
  };
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "200000",
        owedByUsMinor: "900000",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Recent days · 1")).toBeInTheDocument();
  expect(screen.getByText("Excused for trip")).toBeInTheDocument();
  expect(screen.getByText("Trips and fees · 1")).toBeInTheDocument();
  expect(screen.getByText("Driver fee")).toBeInTheDocument();
  expect(screen.getByText("Advances · 1")).toBeInTheDocument();
  expect(screen.getByText("Offsets · 1")).toBeInTheDocument();
  expect(screen.getByText("Held deposit")).toBeInTheDocument();
});

/** GAP-63/64/66 (B13) — the three actions found by the 8 Aug flow-inventory audit, each a write endpoint that existed with no caller until now. */
test("Driver money opens the action sheet with all three new actions", async () => {
  const user = userEvent.setup();
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get: baseGet() });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));

  expect(await screen.findByText("Pay the driver")).toBeInTheDocument();
  expect(screen.getByText("Record an advance")).toBeInTheDocument();
  expect(screen.getByText("Record a deposit")).toBeInTheDocument();
});

test("GAP-63 — Pay the driver posts a 'paid'-direction payment", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "p1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Pay the driver"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "50000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Pay driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/payment",
      expect.objectContaining({ direction: "paid", partyType: "driver", partyId: "d1" }),
    ),
  );
});

test("GAP-64 — Record an advance posts to /api/advance", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "a1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record an advance"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "10000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record advance" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/advance",
      expect.objectContaining({ driverId: "d1", amountMinor: "10000" }),
    ),
  );
});

test("GAP-100 — an open advance can be settled from staff driver detail", async () => {
  const user = userEvent.setup();
  const history: DriverViewResponse = {
    ...emptyHistory,
    advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "a1",
    driverId: "d1",
    tripId: null,
    amountMinor: "100000",
    issuedOn: "2026-08-03",
    status: "part_settled",
    settledMinor: "25000",
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: /Settle advance from 3 Aug 2026/ }));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "25000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Save settlement" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/advance/a1/settle",
      expect.objectContaining({
        kind: "spent",
        amountMinor: "25000",
      }),
    ),
  );
});

test("GAP-147 — an open advance can be voided from staff driver detail", async () => {
  const user = userEvent.setup();
  const history: DriverViewResponse = {
    ...emptyHistory,
    advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "a1",
    voidedAt: "2026-08-20T00:00:00.000Z",
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: /Void advance from 3 Aug 2026/ }));
  await user.type(await screen.findByLabelText("Reason"), "Wrong driver");
  await user.click(screen.getByRole("button", { name: "Void advance" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/advance/a1/void", { reason: "Wrong driver" }),
  );
});

test("GAP-147 — an offset can be voided from staff driver detail", async () => {
  const user = userEvent.setup();
  const history: DriverViewResponse = {
    ...emptyHistory,
    offsets: [
      {
        id: "o1",
        amountMinor: "50000",
        occurredOn: "2026-08-05",
        voidedAt: null,
        voidedReason: null,
      },
    ],
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "o1",
    voidedAt: "2026-08-20T00:00:00.000Z",
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: /Void offset from 5 Aug 2026/ }));
  await user.type(await screen.findByLabelText("Reason"), "Offset entered twice");
  await user.click(screen.getByRole("button", { name: "Void offset" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/offset/o1/void", {
      reason: "Offset entered twice",
    }),
  );
});

test("GAP-147 — a voided offset stays visible with its reason", async () => {
  const history: DriverViewResponse = {
    ...emptyHistory,
    offsets: [
      {
        id: "o1",
        amountMinor: "50000",
        occurredOn: "2026-08-05",
        voidedAt: "2026-08-20T00:00:00.000Z",
        voidedReason: "Offset entered twice",
      },
    ],
  };
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Offsets · 1")).toBeInTheDocument();
  expect(screen.getByText("Voided · Offset entered twice")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Void offset/ })).toBeNull();
});

test("GAP-66 — Record a deposit posts to /api/deposit", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  const post = vi.fn().mockResolvedValue({ id: "dep1" });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record a deposit"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "25000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record deposit" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/deposit",
      expect.objectContaining({ driverId: "d1", amountMinor: "25000" }),
    ),
  );
});

test("UC-90/GAP-148: an owner can write off a vehicle-linked standalone driver balance from driver detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/vehicle") {
      return Promise.resolve([
        {
          id: "v1",
          registration: "CAB-1234",
          vehicleType: "Car",
          lifecycle: "active",
          arrangement: "A",
          serviceIntervalKm: null,
        },
      ]);
    }
    if (path.startsWith("/api/write-off?")) return Promise.resolve([]);
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  const postCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const post = vi.fn().mockImplementation((path: string, body: Record<string, unknown>) => {
    postCalls.push({ path, body });
    return Promise.resolve({
      id: "wo-driver",
      obligationId: null,
      partyType: "driver",
      partyCustomerId: null,
      partyDriverId: "d1",
      vehicleId: "v1",
      amountMinor: "50000",
      reason: "Unrecoverable shortage",
      writtenOffOn: "2026-08-20",
      voidedAt: null,
      voidedReason: null,
      replacesId: null,
    });
  });
  renderWithProviders(
    <DriverDetailScreen driverId="d1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Write off balance"));
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "50000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.type(screen.getByLabelText("Reason"), "Unrecoverable shortage");
  await user.click(await screen.findByRole("button", { name: "Choose vehicle" }));
  await user.click(await screen.findByText("CAB-1234"));
  await user.click(screen.getByRole("button", { name: "Write off" }));

  await vi.waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
  const writeOffCall = postCalls.find(({ path }) => path === "/api/write-off");
  if (writeOffCall === undefined) throw new Error("expected driver write-off request");
  expect(writeOffCall.body).toMatchObject({
    partyType: "driver",
    partyDriverId: "d1",
    vehicleId: "v1",
    amountMinor: "50000",
    reason: "Unrecoverable shortage",
  });
  expect(writeOffCall.body).toHaveProperty(
    "writtenOffOn",
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
  expect(writeOffCall.body).not.toHaveProperty("obligationId");
});

test("UC-90/GAP-148: a driver write-off can be recovered from driver detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    if (path.startsWith("/api/write-off?")) {
      return Promise.resolve([
        {
          id: "wo1",
          obligationId: null,
          partyType: "driver",
          partyCustomerId: null,
          partyDriverId: "d1",
          vehicleId: "v1",
          amountMinor: "50000",
          reason: "Unrecoverable shortage",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]);
    }
    throw new Error(`unexpected path ${path}`);
  });
  const postCalls: Array<{ path: string; body: unknown }> = [];
  const post = vi.fn().mockImplementation((path: string, body: unknown) => {
    postCalls.push({ path, body });
    return Promise.resolve({
      id: "wor1",
      writeOffId: "wo1",
      paymentId: "p-recovery",
      amountMinor: "25000",
      replacesId: null,
    });
  });
  renderWithProviders(
    <DriverDetailScreen driverId="d1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  expect(await screen.findByText("Written off losses · 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Record recovery" }));
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "25000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  const recoveryButtons = screen.getAllByRole("button", { name: "Record recovery" });
  const recoverySubmit = recoveryButtons.at(-1);
  if (recoverySubmit === undefined) throw new Error("expected recovery submit button");
  await user.click(recoverySubmit);

  await vi.waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
  const recoveryCall = postCalls.find(({ path }) => path === "/api/write-off/wo1/recovery");
  if (recoveryCall === undefined) throw new Error("expected driver write-off recovery request");
  expect(recoveryCall.body).toMatchObject({ amountMinor: "25000" });
});

test("GAP-155: a manager sees the write-off section and can record a recovery, but not void", async () => {
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    // listWriteOffsHandler is dailyOperations (GAP-155) — the same gate as
    // recording the recovery it exists to serve for a manager — so unlike
    // the pre-GAP-155 shape this request now succeeds for a manager.
    if (path.startsWith("/api/write-off?")) {
      return Promise.resolve([
        {
          id: "wo1",
          obligationId: null,
          partyType: "driver",
          partyCustomerId: null,
          partyDriverId: "d1",
          vehicleId: "v1",
          amountMinor: "50000",
          reason: "Unrecoverable shortage",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]);
    }
    throw new Error(`unexpected path ${path}`);
  });

  renderWithProviders(
    <DriverDetailScreen driverId="d1" onBack={vi.fn()} />,
    { get },
    undefined,
    manager,
  );

  expect(await screen.findByText("Written off losses · 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record recovery" })).toBeInTheDocument();
  // Voiding stays writeOffOrWaiveAboveThreshold (owners only) — unaffected
  // by GAP-155, which only widened who can see, not who can void. Also the
  // regression case for the missing `canWriteOff` guard this same change
  // exposed: DriverDetailScreen's void button had no capability check at
  // all, moot only because a manager could never reach this section before.
  expect(screen.queryByRole("button", { name: "Void write-off" })).not.toBeInTheDocument();
});

test("GAP-147/GAP-148: a driver write-off can be voided from driver detail", async () => {
  const user = userEvent.setup();
  const get = baseGet();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    if (path.startsWith("/api/write-off?")) {
      return Promise.resolve([
        {
          id: "wo1",
          obligationId: null,
          partyType: "driver",
          partyCustomerId: null,
          partyDriverId: "d1",
          vehicleId: "v1",
          amountMinor: "50000",
          reason: "Unrecoverable shortage",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]);
    }
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "wo1",
    voidedAt: "2026-08-20T00:00:00.000Z",
  });
  renderWithProviders(
    <DriverDetailScreen driverId="d1" onBack={vi.fn()} />,
    { get, post },
    undefined,
    owner,
  );

  expect(await screen.findByText("Written off losses · 1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Void write-off" }));
  await user.type(screen.getByLabelText("Reason"), "Entered against the wrong driver");
  const voidButtons = screen.getAllByRole("button", { name: "Void write-off" });
  const voidSubmit = voidButtons.at(-1);
  if (voidSubmit === undefined) throw new Error("expected void submit button");
  await user.click(voidSubmit);

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/write-off/wo1/void", {
      reason: "Entered against the wrong driver",
    }),
  );
});

test("GAP-146 — a held driver deposit can record a later movement", async () => {
  const user = userEvent.setup();
  const history: DriverViewResponse = {
    ...emptyHistory,
    deposit: { id: "dep1", heldMinor: "250000", movements: [] },
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "dep1",
    partyDriverId: "d1",
    status: "held",
    heldMinor: "225000",
    movementId: "m1",
    movementReplacesId: null,
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record deposit movement"));
  await user.selectOptions(await screen.findByLabelText("Movement"), "reduced");
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "25000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.type(screen.getByLabelText(/Reason/), "Returned early");
  await user.click(screen.getByRole("button", { name: "Record movement" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/deposit/dep1/movement",
      expect.objectContaining({
        movementType: "reduced",
        amountMinor: "25000",
        reason: "Returned early",
      }),
    ),
  );
});

test("GAP-146 — a held driver deposit can be applied against selected arrears", async () => {
  const user = userEvent.setup();
  const obligationId = "11111111-1111-4111-8111-111111111111";
  const history: DriverViewResponse = {
    ...emptyHistory,
    deposit: { id: "dep1", heldMinor: "250000", movements: [] },
    owedToUsObligations: [
      {
        id: obligationId,
        kind: "daily_amount",
        dueOn: "2026-08-01",
        effectiveDueOn: "2026-08-01",
        amountMinor: "75000",
        settledMinor: "25000",
        waivedMinor: "0",
        status: "part_paid",
      },
    ],
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "50000",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "dep1",
    partyDriverId: "d1",
    status: "held",
    heldMinor: "200000",
    movementId: "m1",
    movementReplacesId: null,
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Driver money" }));
  await user.click(await screen.findByText("Record deposit movement"));
  await user.selectOptions(await screen.findByLabelText("Movement"), "applied");
  await user.selectOptions(await screen.findByLabelText("Arrears"), obligationId);
  await user.click(await screen.findByRole("button", { name: "Enter amount" }));
  for (const digit of "50000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.type(screen.getByLabelText(/Reason/), "Apply deposit to short days");
  await user.click(screen.getByRole("button", { name: "Record movement" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/deposit/dep1/movement",
      expect.objectContaining({
        movementType: "applied",
        amountMinor: "50000",
        obligationId,
        reason: "Apply deposit to short days",
      }),
    ),
  );
});

test("GAP-146 — a held driver deposit movement can be voided from driver detail", async () => {
  const user = userEvent.setup();
  const history: DriverViewResponse = {
    ...emptyHistory,
    deposit: {
      id: "dep1",
      heldMinor: "250000",
      movements: [
        {
          id: "dm1",
          movementType: "taken",
          amountMinor: "250000",
          occurredOn: "2026-08-01",
          reason: null,
          voidedAt: null,
          voidedReason: null,
        },
      ],
    },
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(history);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "dm1",
    voidedAt: "2026-08-20T10:00:00.000Z",
    deposit: { id: "dep1", partyDriverId: "d1", status: "held", heldMinor: "0" },
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: /Void deposit movement/ }));
  await user.type(await screen.findByLabelText("Reason"), "Duplicate deposit entry");
  await user.click(screen.getByRole("button", { name: "Void movement" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/deposit/dep1/movement/dm1/void", {
      reason: "Duplicate deposit entry",
    }),
  );
});

test("F-1.8: Driver actions creates a link invite code", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    code: "DRV-123",
    expiresAt: "2026-08-12T00:00:00.000Z",
  });
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Driver actions" }));
  await user.click(await screen.findByRole("button", { name: "Create account link" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/driver/d1/link-invite", {}));
  expect(await screen.findByText("DRV-123")).toBeInTheDocument();
});

test("F-1.8: Driver actions unlinks after confirmation", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  } satisfies DriverResponse);
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Driver actions" }));
  await user.click(await screen.findByRole("button", { name: "Unlink account" }));
  await user.click(await screen.findByRole("button", { name: "Unlink account" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/driver/d1/unlink", {}));
});

test("GAP-146: a driver can be archived from driver detail with a reason", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
    archivedAt: "2026-08-20T00:00:00.000Z",
  } satisfies DriverResponse);
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, {
    get: baseGet(),
    post,
  });

  expect(await screen.findByText("Active")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Driver actions" }));
  await user.click(await screen.findByRole("button", { name: "Archive driver" }));
  expect(await screen.findByText("Archive driver?")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Reason"), "Duplicate driver");
  await user.click(screen.getByRole("button", { name: "Archive driver" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/driver/d1/archive", { reason: "Duplicate driver" }),
  );
});

test("GAP-146: an archived driver can be unarchived from driver detail", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/driver/d1") {
      return Promise.resolve({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
        archivedAt: "2026-08-20T00:00:00.000Z",
      } satisfies DriverResponse);
    }
    if (path === "/api/driver/d1/balances") {
      return Promise.resolve({
        driverId: "d1",
        owedToUsMinor: "0",
        owedByUsMinor: "0",
      } satisfies DriverBalancesResponse);
    }
    if (isDriverHistoryPath(path)) return Promise.resolve(emptyHistory);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn().mockResolvedValue({
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
    archivedAt: null,
  } satisfies DriverResponse);
  renderWithProviders(<DriverDetailScreen driverId="d1" onBack={vi.fn()} />, { get, post });

  expect(await screen.findByText("Archived")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Driver actions" }));
  await user.click(await screen.findByRole("button", { name: "Unarchive driver" }));
  expect(await screen.findByText("Unarchive driver?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Unarchive driver" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/driver/d1/unarchive", {}));
});
