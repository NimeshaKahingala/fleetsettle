import { asBusinessDate } from "@fleetsettle/shared";
import type { PostClosureChargeResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { PostClosureChargeSheet } from "./PostClosureChargeSheet.js";

const today = asBusinessDate("2026-08-20");

async function enterAmount(user: ReturnType<typeof userEvent.setup>, digits: string) {
  await user.click(screen.getByRole("button", { name: "Enter amount" }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("F-8.4/GAP-148: records a lease-scoped post-closure charge", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const post = vi.fn().mockResolvedValue({
    obligationId: "o-late",
    partyType: "customer",
    amountMinor: "125000",
    dueOn: today,
    status: "pending",
    replacesId: null,
    deductedFromFeeOffsetId: null,
  } satisfies PostClosureChargeResponse);
  const { queryClient } = renderWithProviders(
    <PostClosureChargeSheet
      open
      onOpenChange={onOpenChange}
      source={{ type: "lease", id: "l1" }}
      customerId="c1"
      vehicleId="v1"
      today={today}
    />,
    { post },
  );
  queryClient.setQueryData(["lease", "l1", "obligation"], []);
  queryClient.setQueryData(["reports", "receivables"], []);

  await enterAmount(user, "125000");
  await user.type(screen.getByLabelText("Note"), "Parking ticket after return");
  await user.click(screen.getByRole("button", { name: "Record charge" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/post-closure-charge", {
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      sourceType: "lease",
      sourceId: "l1",
      amountMinor: "125000",
      dueOn: today,
      note: "Parking ticket after return",
    }),
  );
  expect(queryClient.getQueryState(["lease", "l1", "obligation"])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(["reports", "receivables"])?.isInvalidated).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("empty note is omitted from the post-closure charge request", async () => {
  const user = userEvent.setup();
  const postCalls: Array<{ path: string; body: unknown }> = [];
  const post = vi.fn().mockImplementation((path: string, body: unknown) => {
    postCalls.push({ path, body });
    return Promise.resolve({
      obligationId: "o-late",
      partyType: "customer",
      amountMinor: "25000",
      dueOn: today,
      status: "pending",
      replacesId: null,
      deductedFromFeeOffsetId: null,
    } satisfies PostClosureChargeResponse);
  });
  renderWithProviders(
    <PostClosureChargeSheet
      open
      onOpenChange={() => {}}
      source={{ type: "lease", id: "l1" }}
      customerId="c1"
      vehicleId="v1"
      today={today}
    />,
    { post },
  );

  await enterAmount(user, "25000");
  await user.click(screen.getByRole("button", { name: "Record charge" }));

  await vi.waitFor(() => expect(postCalls.length).toBeGreaterThan(0));
  const call = postCalls.find(({ path }) => path === "/api/post-closure-charge");
  if (call === undefined) throw new Error("expected post-closure charge request");
  expect(call.body).not.toHaveProperty("note");
});

test("GAP-148: records a trip-scoped post-closure charge", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const post = vi.fn().mockResolvedValue({
    obligationId: "o-trip-late",
    partyType: "customer",
    amountMinor: "50000",
    dueOn: today,
    status: "pending",
    replacesId: null,
    deductedFromFeeOffsetId: null,
  } satisfies PostClosureChargeResponse);
  const { queryClient } = renderWithProviders(
    <PostClosureChargeSheet
      open
      onOpenChange={onOpenChange}
      source={{ type: "trip", id: "t1" }}
      customerId="c1"
      vehicleId="v1"
      today={today}
    />,
    { post },
  );
  queryClient.setQueryData(["trip", "t1"], {});
  queryClient.setQueryData(["customer", "c1", "obligation"], []);

  await enterAmount(user, "50000");
  await user.type(screen.getByLabelText("Note"), "Toll arrived after the hire");
  await user.click(screen.getByRole("button", { name: "Record charge" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/post-closure-charge", {
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      sourceType: "trip",
      sourceId: "t1",
      amountMinor: "50000",
      dueOn: today,
      note: "Toll arrived after the hire",
    }),
  );
  expect(queryClient.getQueryState(["trip", "t1"])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(["customer", "c1", "obligation"])?.isInvalidated).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
