import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { RedeemInviteForm } from "./RedeemInviteForm.js";

test("saves with the code field alone — F-1.4's own accept clause: redeeming never lets the invitee pick a role", async () => {
  const user = userEvent.setup();
  const post = vi
    .fn()
    .mockResolvedValue({ kind: "business_member", businessId: "b1", role: "manager" });
  const onRedeemed = vi.fn();
  renderWithProviders(<RedeemInviteForm onRedeemed={onRedeemed} />, { post });

  await user.type(screen.getByLabelText("Invite code"), "ABCDE-FGHJK");
  await user.click(screen.getByRole("button", { name: "Join" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/invite/redeem", { code: "ABCDE-FGHJK" }),
  );
  await vi.waitFor(() => expect(onRedeemed).toHaveBeenCalled());
  expect(onRedeemed.mock.calls[0]?.[0]).toMatchObject({ kind: "business_member" });
});

test("a blank code is rejected client-side before ever reaching the API", async () => {
  const user = userEvent.setup();
  const post = vi.fn();
  renderWithProviders(<RedeemInviteForm onRedeemed={vi.fn()} />, { post });

  await user.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText(/have >=1 character/i)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

test("surfaces a 400 (invalid or expired code) from the API as a visible error, one message regardless of the reason", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockRejectedValue(new Error("This code is invalid or has expired"));
  renderWithProviders(<RedeemInviteForm onRedeemed={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Invite code"), "NOTREAL-CODEXX");
  await user.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText("This code is invalid or has expired")).toBeInTheDocument();
});
