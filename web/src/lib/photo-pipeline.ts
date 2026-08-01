/**
 * §6.3 `PhotoCapture`'s pipeline table: downscale to a 1600px longest edge,
 * encode as JPEG at quality 0.75, and if the first pass still exceeds the
 * 200KB hard cap, re-encode at 0.6, then 0.45, accepting whatever the third
 * pass gives and flagging it.
 */

export interface EncodedPhoto {
  blob: Blob;
  /** True only if the third (lowest-quality) pass still exceeded the cap. */
  flagged: boolean;
}

export const PHOTO_QUALITY_PASSES = [0.75, 0.6, 0.45] as const;
export const PHOTO_SIZE_CAP_BYTES = 200_000;
export const PHOTO_LONGEST_EDGE = 1600;

/**
 * The retry ladder, decoupled from how a single pass is actually encoded —
 * that's what makes it testable without a real `<canvas>`, which jsdom
 * doesn't implement. `encodeAt(quality)` does the real work in the browser
 * (see `downscaleAndEncode` below); a test injects a fake that returns
 * blobs of a chosen size.
 */
export async function encodeWithCap(
  encodeAt: (quality: number) => Promise<Blob>,
  passes: readonly number[] = PHOTO_QUALITY_PASSES,
  capBytes: number = PHOTO_SIZE_CAP_BYTES,
): Promise<EncodedPhoto> {
  let last: Blob | undefined;
  for (const quality of passes) {
    const blob = await encodeAt(quality);
    last = blob;
    if (blob.size <= capBytes) return { blob, flagged: false };
  }
  if (!last) throw new RangeError("encodeWithCap needs at least one quality pass");
  return { blob: last, flagged: true };
}

/**
 * The real browser pipeline: downscale to a 1600px longest edge via
 * `createImageBitmap`/`OffscreenCanvas` (both worker-safe APIs, chosen so
 * this can move into a Web Worker without rewriting it), then run the JPEG
 * retry ladder above.
 *
 * Not yet wrapped in an actual Worker + 3s timeout fallback (the pipeline
 * table's "where" row) — that needs a worker bundle and message-passing
 * this pass doesn't build; tracked in TRACKER.md rather than left silent.
 * Runs on the main thread for now, which is correct, just not resilient to
 * a slow decode blocking it.
 */
export async function downscaleAndEncode(file: File): Promise<EncodedPhoto> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PHOTO_LONGEST_EDGE / Math.max(bitmap.width, bitmap.height));
    // eslint-disable-next-line no-restricted-syntax -- pixel dimensions, not money
    const width = Math.round(bitmap.width * scale);
    // eslint-disable-next-line no-restricted-syntax -- pixel dimensions, not money
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, flagged: true };
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await encodeWithCap((quality) => canvas.convertToBlob({ type: "image/jpeg", quality }));
  } finally {
    bitmap.close();
  }
}
