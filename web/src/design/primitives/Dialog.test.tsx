import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Dialog, DialogConfirmFooter } from "./Dialog.js";

test("renders title/description and confirms via the footer's primary action", async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();

  render(
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Close July permanently?"
      description="Trip #21 is still open."
      footer={
        <DialogConfirmFooter
          confirmLabel="Close July"
          onConfirm={onConfirm}
          onCancel={() => {
            onOpenChange(false);
          }}
        />
      }
    />,
  );

  expect(screen.getByRole("dialog", { name: "Close July permanently?" })).toBeInTheDocument();
  expect(screen.getByText("Trip #21 is still open.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close July" }));
  expect(onConfirm).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("the confirm and cancel actions stack, never side by side (§4.3)", () => {
  render(
    <Dialog
      open
      onOpenChange={vi.fn()}
      title="Delete this record?"
      footer={
        <DialogConfirmFooter
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      }
    />,
  );

  const footer = screen.getByRole("button", { name: "Delete" }).parentElement;
  expect(footer).toHaveClass("flex-col");
});
