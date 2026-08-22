import { asBusinessDate } from "@fleetsettle/shared";
import type { LeaseObligationRow } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ToastProvider } from "../../design/primitives/Toast.js";
import type { ApiClient } from "../../lib/api.js";
import { ApiProvider } from "../../lib/ApiContext.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DepositMovementSheet } from "./DepositMovementSheet.js";

const today = asBusinessDate("2026-08-20");

const obligation: LeaseObligationRow = {
  id: "o1",
  kind: "rent",
  dueOn: "2026-08-01",
  effectiveDueOn: "2026-08-01",
  amountMinor: "6000000",
  settledMinor: "0",
  waivedMinor: "0",
  status: "pending",
};

test("shows the arrears option in Rs, not raw minor units", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <DepositMovementSheet
      open
      onOpenChange={vi.fn()}
      driverId="d1"
      depositId="dep1"
      obligations={[obligation]}
      today={today}
    />,
  );

  await user.selectOptions(screen.getByLabelText("Movement"), "applied");

  expect(screen.getByText("Rent due 2026-08-01 - Rs 60,000")).toBeInTheDocument();
  expect(screen.queryByText(/6000000/)).not.toBeInTheDocument();
});

test("every arrears kind this screen can actually show renders its plain-English label, never the raw snake_case kind", async () => {
  const user = userEvent.setup();
  // GAP-159 review: `obligations` here is a driver's own `owedToUsObligations`
  // (findOutstandingObligationsForDriver) — `daily_amount` (confirmDay.ts,
  // arrangement B's driver debt) is the *ordinary* case for this exact
  // screen, not an edge one, and was the one kind the first pass of this
  // fix missed entirely.
  const dailyAmount: LeaseObligationRow = {
    ...obligation,
    id: "o2",
    kind: "daily_amount",
  };
  const mileageExcess: LeaseObligationRow = {
    ...obligation,
    id: "o3",
    kind: "mileage_excess",
  };
  const postClosureCharge: LeaseObligationRow = {
    ...obligation,
    id: "o4",
    kind: "post_closure_charge",
  };
  renderWithProviders(
    <DepositMovementSheet
      open
      onOpenChange={vi.fn()}
      driverId="d1"
      depositId="dep1"
      obligations={[dailyAmount, mileageExcess, postClosureCharge]}
      today={today}
    />,
  );

  await user.selectOptions(screen.getByLabelText("Movement"), "applied");

  expect(screen.getByText("Daily lease amount due 2026-08-01 - Rs 60,000")).toBeInTheDocument();
  expect(screen.getByText("Mileage excess due 2026-08-01 - Rs 60,000")).toBeInTheDocument();
  expect(screen.getByText("Late charge due 2026-08-01 - Rs 60,000")).toBeInTheDocument();
  expect(screen.queryByText(/daily_amount/)).not.toBeInTheDocument();
  expect(screen.queryByText(/mileage_excess/)).not.toBeInTheDocument();
  expect(screen.queryByText(/post_closure_charge/)).not.toBeInTheDocument();
});

test("submitting 'Apply to arrears' with nothing chosen shows the friendly required message, not Zod's raw Invalid UUID", async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <DepositMovementSheet
      open
      onOpenChange={vi.fn()}
      driverId="d1"
      depositId="dep1"
      obligations={[obligation]}
      today={today}
    />,
  );

  await user.selectOptions(screen.getByLabelText("Movement"), "applied");
  expect(screen.getByLabelText("Arrears")).toHaveValue("");
  // amountMinor is its own required field (z.custom, no message of its own)
  // -- Zod skips the object-level .refine() below entirely when any sibling
  // field already failed its own check, so this must be valid first or the
  // refine (and the bug it fixes) never runs at all.
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of "5000") {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Record movement" }));

  expect(
    await screen.findByText("Choose the arrears this deposit is being applied to"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/invalid uuid/i)).not.toBeInTheDocument();
});

const apiClient = {} as unknown as ApiClient;

function tree(open: boolean, onOpenChange: (open: boolean) => void, queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={apiClient}>
        <ToastProvider>
          <DepositMovementSheet
            open={open}
            onOpenChange={onOpenChange}
            driverId="d1"
            depositId="dep1"
            obligations={[obligation]}
            today={today}
          />
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

test("cancelling without submitting does not leave a stale movement selected on reopen", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // The parent (DriverDetailScreen) mounts this sheet unconditionally and
  // toggles `open` -- it never unmounts on close -- so rerendering the same
  // tree with `open` flipped is what reproduces a real cancel-and-reopen
  // cycle, unlike a fresh `render` per case.
  const { rerender } = render(tree(true, onOpenChange, queryClient));

  await user.selectOptions(screen.getByLabelText("Movement"), "applied");
  await user.selectOptions(screen.getByLabelText("Arrears"), "o1");
  expect(screen.getByLabelText("Movement")).toHaveValue("applied");

  rerender(tree(false, onOpenChange, queryClient));
  rerender(tree(true, onOpenChange, queryClient));

  expect(screen.getByLabelText("Movement")).toHaveValue("topped_up");
  expect(screen.queryByLabelText("Arrears")).not.toBeInTheDocument();
});
