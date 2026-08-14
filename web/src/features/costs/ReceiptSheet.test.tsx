import type { AttachmentResponse, ListAttachmentsResponse } from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ReceiptSheet } from "./ReceiptSheet.js";

const receipt: AttachmentResponse = {
  id: "att-1",
  kind: "expense_receipt",
  subjectType: "expense",
  subjectId: "e1",
  contentType: "image/jpeg",
  sizeBytes: 5,
  uploadedAt: "2026-08-08T10:00:00Z",
};

// The thumbnail's alt is deliberately "" (decorative) — that gives it
// accessibility role "none", not "img", so these tests query the DOM
// directly rather than through `getByRole("img")`.

test("renders the thumbnail once the fetched blob matches the listed size", async () => {
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  const getBlob = vi.fn().mockResolvedValue({
    blob: new Blob(["fake!"], { type: "image/jpeg" }), // 5 bytes, matches sizeBytes
    contentType: "image/jpeg",
  });
  renderWithProviders(
    <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
    { get, getBlob },
  );

  await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
});

test("GAP-112 — a network-truncated download (fetch resolves short of the listed size) shows the failed tile, not a broken image", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
    const getBlob = vi.fn().mockResolvedValue({
      blob: new Blob(["fa"], { type: "image/jpeg" }), // 2 bytes, short of sizeBytes: 5
      contentType: "image/jpeg",
    });
    renderWithProviders(
      <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
      { get, getBlob },
    );

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  } finally {
    warnSpy.mockRestore();
  }
});

test("a right-sized blob that the browser cannot decode shows the failed tile, not a blank thumbnail", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error("decode failed"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
    const getBlob = vi.fn().mockResolvedValue({
      blob: new Blob(["fake!"], { type: "image/jpeg" }),
      contentType: "image/jpeg",
    });
    renderWithProviders(
      <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
      { get, getBlob },
    );

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("receipt thumbnail decode failed"),
    );
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    warnSpy.mockRestore();
  }
});

test("Retry re-fetches, and a complete blob on the second attempt renders the thumbnail", async () => {
  const user = userEvent.setup();
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
    const getBlob = vi
      .fn()
      .mockResolvedValueOnce({
        blob: new Blob(["fa"], { type: "image/jpeg" }),
        contentType: "image/jpeg",
      })
      .mockResolvedValueOnce({
        blob: new Blob(["fake!"], { type: "image/jpeg" }),
        contentType: "image/jpeg",
      });
    renderWithProviders(
      <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
      { get, getBlob },
    );

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
    expect(getBlob).toHaveBeenCalledTimes(2);
  } finally {
    warnSpy.mockRestore();
  }
});

test("a hard fetch failure still shows the failed tile with a Retry affordance", async () => {
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  const getBlob = vi.fn().mockRejectedValue(new Error("network error"));
  renderWithProviders(
    <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
    { get, getBlob },
  );

  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("a loaded thumbnail is a real control with an accessible name, not a bare decorative image", async () => {
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  const getBlob = vi.fn().mockResolvedValue({
    blob: new Blob(["fake!"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
  });
  renderWithProviders(
    <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
    { get, getBlob },
  );

  expect(await screen.findByRole("button", { name: "Receipt 1 of 1" })).toBeInTheDocument();
});

test("tapping a thumbnail opens a full-size view of the same photo, reusing the already-fetched blob (no second getBlob call), and Close dismisses it", async () => {
  const user = userEvent.setup();
  const get = vi.fn().mockResolvedValue([receipt] satisfies ListAttachmentsResponse);
  const getBlob = vi.fn().mockResolvedValue({
    blob: new Blob(["fake!"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
  });
  renderWithProviders(
    <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
    { get, getBlob },
  );

  await user.click(await screen.findByRole("button", { name: "Receipt 1 of 1" }));

  expect(await screen.findByRole("dialog", { name: "Receipt" })).toBeInTheDocument();
  expect(screen.getByAltText("Receipt, full size")).toBeInTheDocument();
  expect(getBlob).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Close receipt view" }));
  expect(screen.queryByRole("dialog", { name: "Receipt" })).toBeNull();
});

test("Remove receipt in the lightbox opens a reason-required confirm sheet; confirming voids the attachment and the thumbnail disappears", async () => {
  const user = userEvent.setup();
  const get = vi
    .fn()
    .mockResolvedValueOnce([receipt] satisfies ListAttachmentsResponse)
    .mockResolvedValueOnce([] satisfies ListAttachmentsResponse);
  const getBlob = vi.fn().mockResolvedValue({
    blob: new Blob(["fake!"], { type: "image/jpeg" }),
    contentType: "image/jpeg",
  });
  const post = vi.fn().mockResolvedValue({ id: "att-1", voidedAt: "2026-08-12T10:00:00Z" });
  renderWithProviders(
    <ReceiptSheet open onOpenChange={vi.fn()} subjectType="expense" subjectId="e1" />,
    { get, getBlob, post },
  );

  await user.click(await screen.findByRole("button", { name: "Receipt 1 of 1" }));
  await user.click(screen.getByRole("button", { name: "Remove receipt" }));

  // The lightbox closes and the confirm sheet takes over — only one "Remove
  // receipt" control on screen at a time (the sheet's own destructive CTA).
  const confirmButton = await screen.findByRole("button", { name: "Remove receipt" });
  expect(confirmButton).toBeDisabled();

  await user.type(screen.getByLabelText("Reason"), "Wrong photo attached");
  expect(confirmButton).toBeEnabled();
  await user.click(confirmButton);

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/attachment/att-1/void", {
      reason: "Wrong photo attached",
    }),
  );
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
