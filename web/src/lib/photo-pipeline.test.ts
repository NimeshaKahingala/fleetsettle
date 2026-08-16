import { expect, test, vi } from "vitest";
import {
  encodeWithCap,
  PHOTO_QUALITY_PASSES,
  PHOTO_SIZE_CAP_BYTES,
  PHOTO_WORKER_TIMEOUT_MS,
  withWorkerTimeout,
} from "./photo-pipeline.js";

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

// GAP-17: the §6.3 "Where" row's 3s race, decoupled from a real Worker
// (jsdom has none) so fake timers can exercise both outcomes directly.
test("GAP-17: resolves with the run() result when it settles before the timeout", async () => {
  vi.useFakeTimers();
  try {
    const photo = { blob: blobOfSize(50_000), flagged: false };
    const result = withWorkerTimeout(
      () => Promise.resolve(photo),
      () => {
        throw new Error("fallback must not run when run() already won");
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(photo);
  } finally {
    vi.useRealTimers();
  }
});

test("GAP-17: falls back once the timeout elapses, without waiting for run() to ever settle", async () => {
  vi.useFakeTimers();
  try {
    const fallbackPhoto = { blob: blobOfSize(1_000_000), flagged: true };
    const result = withWorkerTimeout(
      () => new Promise(() => {}), // never settles — the stuck-Worker case
      () => fallbackPhoto,
    );
    await vi.advanceTimersByTimeAsync(PHOTO_WORKER_TIMEOUT_MS);
    await expect(result).resolves.toBe(fallbackPhoto);
  } finally {
    vi.useRealTimers();
  }
});

test("GAP-17: a custom timeout overrides the 3s default", async () => {
  vi.useFakeTimers();
  try {
    const fallbackPhoto = { blob: blobOfSize(1_000_000), flagged: true };
    const result = withWorkerTimeout(
      () => new Promise(() => {}),
      () => fallbackPhoto,
      500,
    );
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(fallbackPhoto);
  } finally {
    vi.useRealTimers();
  }
});

test("falls back on timeout without terminating a run() that already settled", async () => {
  vi.useFakeTimers();
  try {
    const photo = { blob: blobOfSize(50_000), flagged: false };
    const onTimeout = vi.fn();
    const result = withWorkerTimeout(
      () => Promise.resolve(photo),
      () => {
        throw new Error("fallback must not run when run() already won");
      },
      PHOTO_WORKER_TIMEOUT_MS,
      onTimeout,
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(photo);
    expect(onTimeout).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("calls onTimeout so a stuck worker can be terminated once the fallback wins the race", async () => {
  vi.useFakeTimers();
  try {
    const fallbackPhoto = { blob: blobOfSize(1_000_000), flagged: true };
    const onTimeout = vi.fn();
    const result = withWorkerTimeout(
      () => new Promise(() => {}), // never settles — the stuck-Worker case
      () => fallbackPhoto,
      PHOTO_WORKER_TIMEOUT_MS,
      onTimeout,
    );
    await vi.advanceTimersByTimeAsync(PHOTO_WORKER_TIMEOUT_MS);
    await expect(result).resolves.toBe(fallbackPhoto);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("GAP-17: run() rejecting (worker fails to load, CSP block, construction throws) falls back immediately rather than rejecting the call", async () => {
  vi.useFakeTimers();
  try {
    const fallbackPhoto = { blob: blobOfSize(1_000_000), flagged: true };
    const result = withWorkerTimeout(
      () => Promise.reject(new Error("photo-pipeline worker crashed")),
      () => fallbackPhoto,
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(fallbackPhoto);
  } finally {
    vi.useRealTimers();
  }
});
