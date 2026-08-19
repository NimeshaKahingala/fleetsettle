import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CreateBusinessForm } from "./CreateBusinessForm.js";

test("defaults currency and timezone to the one real market this product serves, both still editable", () => {
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={vi.fn()} />);
  expect(screen.getByLabelText("Currency")).toHaveValue("LKR");
  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Colombo");
});

test("GAP-55: Business name carries an autocomplete token", () => {
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={vi.fn()} />);
  expect(screen.getByLabelText("Business name")).toHaveAttribute("autocomplete", "organization");
});

test("saves with the name field alone (level 1 only, U-2) — currency/timezone already default", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    kind: "created",
    id: "b1",
    name: "Perera Transport",
    currencyCode: "LKR",
    timezone: "Asia/Colombo",
    accountingPeriodId: "p1",
  });
  const onCreated = vi.fn();
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={onCreated} />, { post });

  await user.type(screen.getByLabelText("Business name"), "Perera Transport");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/business", {
      name: "Perera Transport",
      currencyCode: "LKR",
      timezone: "Asia/Colombo",
    }),
  );
  // React Query's onSuccess passes (data, variables, context, mutation) —
  // onCreated only declares one parameter and ignores the rest, so check
  // just the first argument rather than the full call signature.
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ id: "b1" });
});

test("Phase 2 (18 Aug 2026): a pending response (at/over the allowance) never calls onCreated, and hides the form", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ kind: "pending", requestId: "r1" });
  const onCreated = vi.fn();
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={onCreated} />, { post });

  await user.type(screen.getByLabelText("Business name"), "Perera Transport");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  await vi.waitFor(() =>
    expect(screen.getByText("Your request is being reviewed.")).toBeInTheDocument(),
  );
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
});

test("decision 17: a pending request already on /api/session at page load renders the same reviewing state, with no submit needed", () => {
  renderWithProviders(
    <CreateBusinessForm
      pendingRequest={{ status: "pending", rejectionReason: null }}
      onCreated={vi.fn()}
    />,
  );

  expect(screen.getByText("Your request is being reviewed.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
});

test("decision 12: a rejected request shows the reason and lets the requester submit a new one", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ kind: "pending", requestId: "r2" });
  renderWithProviders(
    <CreateBusinessForm
      pendingRequest={{ status: "rejected", rejectionReason: "Too many businesses already" }}
      onCreated={vi.fn()}
    />,
    { post },
  );

  expect(screen.getByText("Request declined: Too many businesses already")).toBeInTheDocument();
  const nameField = screen.getByLabelText("Business name");
  expect(nameField).toBeInTheDocument();

  await user.type(nameField, "Perera Transport Two");
  await user.click(screen.getByRole("button", { name: "Request again" }));

  await vi.waitFor(() =>
    expect(screen.getByText("Your request is being reviewed.")).toBeInTheDocument(),
  );
});

test("a blank name is rejected client-side before ever reaching the API", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={vi.fn()} />, { post });

  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText(/have >=1 character/i)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("surfaces an API error as visible text", async () => {
  // Phase 1 (18 Aug 2026): a second business is now legal under the
  // allowance (W-63/W-64), so this can no longer assert the specific
  // "already belongs to a business" 409 the old one_active_business_per_user
  // index used to produce — that scenario doesn't exist any more. Kept as a
  // generic error-renders check.
  const user = userEvent.setup();
  const post = vi.fn().mockRejectedValue(new Error("Something went wrong"));
  renderWithProviders(<CreateBusinessForm pendingRequest={null} onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Business name"), "Perera Transport");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
});
