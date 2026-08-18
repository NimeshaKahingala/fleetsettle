import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CreateBusinessForm } from "./CreateBusinessForm.js";

test("defaults currency and timezone to the one real market this product serves, both still editable", () => {
  renderWithProviders(<CreateBusinessForm onCreated={vi.fn()} />);
  expect(screen.getByLabelText("Currency")).toHaveValue("LKR");
  expect(screen.getByLabelText("Timezone")).toHaveValue("Asia/Colombo");
});

test("GAP-55: Business name carries an autocomplete token", () => {
  renderWithProviders(<CreateBusinessForm onCreated={vi.fn()} />);
  expect(screen.getByLabelText("Business name")).toHaveAttribute("autocomplete", "organization");
});

test("saves with the name field alone (level 1 only, U-2) — currency/timezone already default", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "b1",
    name: "Perera Transport",
    currencyCode: "LKR",
    timezone: "Asia/Colombo",
    accountingPeriodId: "p1",
  });
  const onCreated = vi.fn();
  renderWithProviders(<CreateBusinessForm onCreated={onCreated} />, { post });

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

test("a blank name is rejected client-side before ever reaching the API", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<CreateBusinessForm onCreated={vi.fn()} />, { post });

  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText(/have >=1 character/i)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("surfaces an API error as visible text", async () => {
  // Phase 1 (18 Aug 2026): a second business is now legal under the
  // allowance (W-63/W-64), so this can no longer assert the specific
  // "already belongs to a business" 409 the old one_active_business_per_user
  // index used to produce — that scenario doesn't exist any more. Kept as a
  // generic error-renders check; Phase 2 gives this form its pending/rejected
  // branches (design doc decision 17), which get their own test then.
  const user = userEvent.setup();
  const post = vi.fn().mockRejectedValue(new Error("Something went wrong"));
  renderWithProviders(<CreateBusinessForm onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Business name"), "Perera Transport");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
});
