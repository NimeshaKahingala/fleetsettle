import { asBusinessDate } from "@fleetsettle/shared";
import type {
  BusinessMemberResponse,
  ManagementFeeAgreementResponse,
  MeResponse,
  OwnershipShareResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { PartnerSetupScreen } from "./PartnerSetupScreen.js";

const today = asBusinessDate("2026-08-11");
const ownerManager: MeResponse = { userId: "u1", businessId: "b1", role: "owner_manager" };
const manager: MeResponse = { userId: "u3", businessId: "b1", role: "manager" };

const vehicles: VehicleResponse[] = [
  {
    id: "v1",
    registration: "NB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "B",
  },
  {
    id: "v2",
    registration: "CAR-4567",
    vehicleType: "Car",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "A",
  },
];

const members: BusinessMemberResponse[] = [
  { id: "bm1", userId: "u1", displayName: "Nimal", role: "owner_manager" },
  { id: "bm2", userId: "u2", displayName: "Amal", role: "owner" },
  { id: "bm3", userId: "u3", displayName: "Ravi", role: "manager" },
];

const shares: OwnershipShareResponse[] = [
  {
    id: "s1",
    vehicleId: "v1",
    userId: "u1",
    shareBp: 6000,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
  },
  {
    id: "s2",
    vehicleId: "v1",
    userId: "u2",
    shareBp: 4000,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
  },
];

const agreements: ManagementFeeAgreementResponse[] = [
  {
    id: "mfa1",
    vehicleId: "v1",
    managerUserId: "u3",
    monthlyFeeMinor: "150000",
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
  },
];

function makeGet(overrides: Partial<Record<string, unknown>> = {}) {
  const responses: Record<string, unknown> = {
    "/api/vehicle": vehicles,
    "/api/business-member": members,
    "/api/ownership-share": shares,
    "/api/management-fee-agreement": agreements,
    ...overrides,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path in responses) return Promise.resolve(responses[path]);
    throw new Error(`unexpected path ${path}`);
  });
  return get;
}

async function enterMoney(
  user: ReturnType<typeof userEvent.setup>,
  buttonName: string,
  digits: string,
) {
  await user.click(screen.getByRole("button", { name: buttonName }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("B2 remainder: shows ownership shares and active management agreements", async () => {
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    { get: makeGet() },
    undefined,
    ownerManager,
  );

  expect(await screen.findByText("Ownership shares · 1")).toBeInTheDocument();
  expect(screen.getAllByText("NB-1234")).toHaveLength(2);
  expect(screen.getByText("Nimal 60% · Amal 40%")).toBeInTheDocument();
  expect(screen.getByText("Management agreements · 1")).toBeInTheDocument();
  expect(screen.getByText(/Ravi/)).toBeInTheDocument();
  expect(screen.getByText("Rs 1,500")).toBeInTheDocument();
});

test("B2 remainder: records an ownership split for a vehicle without one", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue([]);
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    {
      get: makeGet(),
      post,
    },
    undefined,
    ownerManager,
  );

  await user.click(await screen.findByRole("button", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: "Set ownership shares" }));
  await user.selectOptions(await screen.findByLabelText("Vehicle"), "v2");
  await user.clear(screen.getByLabelText("Nimal share"));
  await user.type(screen.getByLabelText("Nimal share"), "70");
  await user.type(screen.getByLabelText("Amal share"), "30");
  await user.click(screen.getByRole("button", { name: "Save shares" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/ownership-share", {
      vehicleId: "v2",
      effectiveFrom: today,
      shares: [
        { userId: "u1", shareBp: 7000 },
        { userId: "u2", shareBp: 3000 },
      ],
    }),
  );
});

test("GAP-113: the ownership total states pass/fail in words, never colour alone", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    { get: makeGet() },
    undefined,
    ownerManager,
  );

  await user.click(await screen.findByRole("button", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: "Set ownership shares" }));
  await user.selectOptions(await screen.findByLabelText("Vehicle"), "v2");

  await user.clear(screen.getByLabelText("Nimal share"));
  await user.type(screen.getByLabelText("Nimal share"), "70");
  await user.type(screen.getByLabelText("Amal share"), "20");
  expect(screen.getByText(/must total 100%/)).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Amal share"));
  await user.type(screen.getByLabelText("Amal share"), "30");
  expect(screen.getByText(/totals 100%/)).toBeInTheDocument();
});

test("B2 remainder: grants vehicle sharing with an optional management fee", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "mfa2",
    vehicleId: "v2",
    managerUserId: "u3",
    monthlyFeeMinor: "250000",
    effectiveFrom: today,
    effectiveTo: null,
  } satisfies ManagementFeeAgreementResponse);
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    {
      get: makeGet(),
      post,
    },
    undefined,
    ownerManager,
  );

  await user.click(await screen.findByRole("button", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: "Share vehicle" }));
  await user.selectOptions(await screen.findByLabelText("Vehicle"), "v2");
  await user.selectOptions(screen.getByLabelText("Manager"), "u3");
  await enterMoney(user, "Enter monthly management fee (optional)", "250000");
  await user.click(screen.getByRole("button", { name: "Save sharing" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/management-fee-agreement", {
      vehicleId: "v2",
      managerUserId: "u3",
      monthlyFeeMinor: "250000",
      effectiveFrom: today,
    }),
  );
});

test("B2 remainder: revokes an active management agreement from its row", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "mfa1",
    vehicleId: "v1",
    managerUserId: "u3",
    monthlyFeeMinor: "150000",
    effectiveFrom: "2026-08-01",
    effectiveTo: today,
  } satisfies ManagementFeeAgreementResponse);
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    {
      get: makeGet(),
      post,
    },
    undefined,
    ownerManager,
  );

  await user.click(await screen.findByRole("button", { name: /NB-1234/ }));
  await user.click(await screen.findByRole("button", { name: "Revoke sharing" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/management-fee-agreement/mfa1/revoke", {}),
  );
});

test("M-22: a direct manager visit sees no owner-only Setup action", async () => {
  const responses: Record<string, unknown> = {
    "/api/vehicle": vehicles,
    "/api/business-member": members,
    "/api/management-fee-agreement": agreements,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) =>
    path === "/api/ownership-share"
      ? Promise.reject(new ApiError(403, "FORBIDDEN_CAPABILITY", "forbidden", "req-1"))
      : Promise.resolve(responses[path]),
  );
  renderWithProviders(
    <PartnerSetupScreen today={today} onBack={vi.fn()} />,
    { get },
    undefined,
    manager,
  );

  expect(await screen.findByText("You don't have access to vehicle sharing.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Setup" })).not.toBeInTheDocument();
});
