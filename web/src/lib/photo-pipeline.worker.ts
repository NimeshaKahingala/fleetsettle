import { downscaleAndEncode } from "./photo-pipeline.js";
import type { PhotoWorkerResult } from "./photo-pipeline.js";

/**
 * §6.3's pipeline "Where" row (GAP-17): the same `downscaleAndEncode` the
 * main thread used to run directly, now off it. `self` types as `Window`
 * under this project's single (DOM-lib) tsconfig rather than a real
 * `DedicatedWorkerGlobalScope` — a second, "webworker"-lib tsconfig project
 * is a bigger build change than one small file justifies, and `self` really
 * is the worker global at runtime regardless of what it type-checks as
 * here. `MessageEvent` (not `MessageEvent<File>`) on the handler sidesteps
 * that mismatch rather than fighting it.
 */
self.onmessage = (event: MessageEvent) => {
  const file = event.data as File;
  downscaleAndEncode(file)
    .then((photo) => {
      self.postMessage({ ok: true, photo } satisfies PhotoWorkerResult);
    })
    .catch(() => {
      self.postMessage({ ok: false } satisfies PhotoWorkerResult);
    });
};
