import { asBusinessDate } from "@fleetsettle/shared";
import type { CashPositionResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CashScreen } from "./CashScreen.js";

const today = asBusinessDate("2026-08-11");

const cash: CashPositionResponse = {
  partners: [{ userId: "u1", displayName: "Nimal", heldMinor: "800000" }],
  depositsHeldMinor: "300000",
  banked: [{ destination: "BOC", heldMinor: "1200000" }],
  driverAdvances: [],
};

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

test("B2: Cash shows partner-held cash, deposits and banked destinations", async () => {
  const get = vi.fn().mockResolvedValue(cash);
  const onSelectPartner = vi.fn();
  renderWithProviders(
    <CashScreen today={today} onSelectPartner={onSelectPartner} onBack={vi.fn()} />,
    { get },
  );

  expect(await screen.findByText("Partners holding cash · 1")).toBeInTheDocument();
  expect(screen.getByText("Nimal")).toBeInTheDocument();
  expect(screen.getByText("Held as deposits")).toBeInTheDocument();
  expect(screen.getByText("Banked · 1")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /Nimal/ }));
  expect(onSelectPartner).toHaveBeenCalledWith("u1");
});

test("B2: Cash records a banking event", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "b1",
    fromUserId: "u1",
    amountRecordedMinor: "50000",
    amountCountedMinor: "50000",
    bankedOn: today,
    destination: "BOC",
    reference: null,
    discrepancyMinor: "0",
    discrepancyBearer: null,
  });
  renderWithProviders(<CashScreen today={today} onSelectPartner={vi.fn()} onBack={vi.fn()} />, {
    get: vi.fn().mockResolvedValue(cash),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Record banking" }));
  await enterMoney(user, "Enter recorded amount", "50000");
  await enterMoney(user, "Enter counted amount", "50000");
  await user.type(screen.getByLabelText("Destination"), "BOC");
  await user.click(screen.getByRole("button", { name: "Save banking" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/api/banking-event",
      expect.objectContaining({
        amountRecordedMinor: "50000",
        amountCountedMinor: "50000",
        destination: "BOC",
      }),
    ),
  );
});
