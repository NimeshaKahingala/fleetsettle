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
});

test("Retry re-fetches, and a complete blob on the second attempt renders the thumbnail", async () => {
  const user = userEvent.setup();
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
