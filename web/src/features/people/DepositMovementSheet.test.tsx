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

  expect(screen.getByText("rent due 2026-08-01 - Rs 60,000")).toBeInTheDocument();
  expect(screen.queryByText(/6000000/)).not.toBeInTheDocument();
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
