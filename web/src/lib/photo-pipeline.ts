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
 * retry ladder above. Called directly as the no-Worker fallback below, and
 * from `photo-pipeline.worker.ts` inside the real Worker.
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

export const PHOTO_WORKER_TIMEOUT_MS = 3000;

/** What `photo-pipeline.worker.ts` posts back on completion. */
export interface PhotoWorkerResult {
  ok: boolean;
  photo?: EncodedPhoto;
}

/**
 * §6.3's pipeline "Where" row, decoupled from what's actually racing — the
 * same reason `encodeWithCap` above takes an injectable `encodeAt`: a real
 * Worker doesn't exist under jsdom, so this is what makes the timeout
 * behaviour itself testable with fake timers rather than only trusted in a
 * real browser (`encodeWithWorkerTimeout` below is the untested, real-API
 * wiring, same split as `downscaleAndEncode` already has).
 */
export async function withWorkerTimeout(
  run: () => Promise<EncodedPhoto>,
  fallback: () => EncodedPhoto,
  timeoutMs: number = PHOTO_WORKER_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<EncodedPhoto> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EncodedPhoto>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve(fallback());
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `worker.terminate()` is idempotent — safe to call again from the timeout path even after `onmessage`/`onerror` already terminated it. */
function runInWorker(file: File): { promise: Promise<EncodedPhoto>; worker: Worker } {
  const worker = new Worker(new URL("./photo-pipeline.worker.ts", import.meta.url), {
    type: "module",
  });
  const promise = new Promise<EncodedPhoto>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const result = event.data as PhotoWorkerResult;
      worker.terminate();
      if (result.ok && result.photo !== undefined) resolve(result.photo);
      else reject(new Error("photo-pipeline worker failed to encode"));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("photo-pipeline worker crashed"));
    };
    worker.postMessage(file);
  });
  return { promise, worker };
}

/**
 * `PhotoCapture`'s own entry point (§6.3, GAP-17): a 12MP decode can block
 * the main thread for seconds on a low-end device, which the "record saves
 * first, photos follow" contract only holds if it never blocks that save.
 * Encodes in a Web Worker where available; past the timeout, the original
 * file goes up unresized (flagged) rather than making the caller wait
 * longer, and the worker is terminated on the way out so a stuck decode
 * doesn't keep a thread and its retained bitmap alive after the caller has
 * already moved on.
 */
export function encodeWithWorkerTimeout(
  file: File,
  timeoutMs: number = PHOTO_WORKER_TIMEOUT_MS,
): Promise<EncodedPhoto> {
  if (typeof Worker === "undefined") return downscaleAndEncode(file);
  const { promise, worker } = runInWorker(file);
  return withWorkerTimeout(
    () => promise,
    () => ({ blob: file, flagged: true }),
    timeoutMs,
    () => worker.terminate(),
  );
}
