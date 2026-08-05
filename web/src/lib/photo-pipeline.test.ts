import { expect, test, vi } from "vitest";
import { encodeWithCap, PHOTO_QUALITY_PASSES, PHOTO_SIZE_CAP_BYTES } from "./photo-pipeline.js";

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

test("accepts the first pass (quality 0.75) if it's already under the cap", async () => {
  const encodeAt = vi.fn((_quality: number) => Promise.resolve(blobOfSize(100_000)));
  const result = await encodeWithCap(encodeAt);

  expect(result.flagged).toBe(false);
  expect(result.blob.size).toBe(100_000);
  expect(encodeAt).toHaveBeenCalledTimes(1);
  expect(encodeAt).toHaveBeenCalledWith(PHOTO_QUALITY_PASSES[0]);
});

test("retries at 0.6 then 0.45 until under the 200KB cap", async () => {
  const encodeAt = vi
    .fn<(quality: number) => Promise<Blob>>()
    .mockResolvedValueOnce(blobOfSize(300_000))
    .mockResolvedValueOnce(blobOfSize(250_000))
    .mockResolvedValueOnce(blobOfSize(150_000));

  const result = await encodeWithCap(encodeAt);

  expect(result.flagged).toBe(false);
  expect(result.blob.size).toBe(150_000);
  expect(encodeAt.mock.calls.map((call) => call[0])).toEqual([0.75, 0.6, 0.45]);
});

test("accepts whatever the third pass gives and flags it, rather than looping forever", async () => {
  const encodeAt = vi.fn((_quality: number) => Promise.resolve(blobOfSize(300_000)));
  const result = await encodeWithCap(encodeAt);

  expect(result.flagged).toBe(true);
  expect(result.blob.size).toBe(300_000);
  expect(encodeAt).toHaveBeenCalledTimes(3);
});

test("the cap is exactly 200KB", () => {
  expect(PHOTO_SIZE_CAP_BYTES).toBe(200_000);
});
