import { newId } from "@fleetsettle/shared";
import type { AttachmentKind, AttachmentSubjectType } from "@fleetsettle/shared/schemas";
import { useCallback, useEffect, useReducer, useState } from "react";
import type { CapturedPhoto } from "../components/PhotoCapture.js";
import { useApi } from "./ApiContext.js";
import type { ApiClient } from "./api.js";

export type UploadStatus = "uploading" | "uploaded" | "error";

interface QueuedUpload {
  /** Client-minted (UUIDv7, the same `newId()` the Worker uses) and reused unchanged on every retry — the whole client half of the server's idempotency contract (A7's plan, "Idempotency"). A fresh id per attempt would defeat it. */
  id: string;
  blob: Blob;
  contentType: string;
  kind: AttachmentKind;
  subjectType: AttachmentSubjectType;
  subjectId: string;
}

interface TrackedUpload {
  request: QueuedUpload;
  status: UploadStatus;
}

type Listener = () => void;

const subjectKey = (subjectType: string, subjectId: string): string =>
  `${subjectType}:${subjectId}`;

/**
 * A7/GAP-16. A module-level singleton, not a react-query mutation (UI §6.3
 * line 524 says so explicitly) and not component state: both
 * `RecordExpenseSheet` and `FuelFillSheet` close on success, before their
 * photos can possibly have finished uploading, so the upload must outlive
 * the component that queued it. Survives the sheet closing and the user
 * navigating elsewhere while the tab stays open; does not survive a reload
 * or the app closing — there is no IndexedDB-backed resume in this branch
 * (A7's plan, decision 6).
 *
 * Indexed by subject as well as by id, because the receipt-viewing surface
 * (`ExpenseCostRow`, A7 commit 7) that shows a failed-after-close upload is
 * never the sheet that queued it — that sheet is long unmounted by the time
 * anyone reopens the expense to look. The full request (not only its
 * status) is kept for exactly as long as a retry might need it.
 */
class AttachmentUploader {
  readonly #uploads = new Map<string, TrackedUpload>();
  readonly #bySubject = new Map<string, Set<string>>();
  readonly #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getStatus(id: string): UploadStatus | undefined {
    return this.#uploads.get(id)?.status;
  }

  /** Every id this session has queued for one subject, uploading/uploaded/error alike — the caller decides what to do with each (A `"uploaded"` entry is redundant with the server's own list; `"error"` is the one a failed-after-close retry surface exists for). */
  idsForSubject(subjectType: AttachmentSubjectType, subjectId: string): string[] {
    return [...(this.#bySubject.get(subjectKey(subjectType, subjectId)) ?? [])];
  }

  enqueue(api: ApiClient, request: QueuedUpload): void {
    this.#uploads.set(request.id, { request, status: "uploading" });
    const key = subjectKey(request.subjectType, request.subjectId);
    const ids = this.#bySubject.get(key) ?? new Set<string>();
    ids.add(request.id);
    this.#bySubject.set(key, ids);
    this.#notify();
    void this.#send(api, request);
  }

  /** Resends the exact request originally enqueued under this id — the server's own pre-read makes a duplicate attempt a no-op rather than a second row. A no-op if this id was never enqueued (nothing to retry). */
  retry(api: ApiClient, id: string): void {
    const tracked = this.#uploads.get(id);
    if (!tracked) return;
    tracked.status = "uploading";
    this.#notify();
    void this.#send(api, tracked.request);
  }

  async #send(api: ApiClient, request: QueuedUpload): Promise<void> {
    const query = new URLSearchParams({
      id: request.id,
      kind: request.kind,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
    });
    const tracked = this.#uploads.get(request.id);
    try {
      await api.postBinary(
        `/api/attachment?${query.toString()}`,
        request.blob,
        request.contentType,
      );
      if (tracked) tracked.status = "uploaded";
    } catch {
      if (tracked) tracked.status = "error";
    }
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

const attachmentUploader = new AttachmentUploader();

/** Re-renders the calling component whenever any upload's status changes — the bridge between the singleton's own state and React's, since nothing about the singleton is React state. */
function useUploaderTick(): void {
  const [, forceRender] = useReducer((c: number) => c + 1, 0);
  useEffect(() => attachmentUploader.subscribe(forceRender), []);
}

interface PendingPhoto {
  id: string;
  blob: Blob;
  contentType: string;
}

/**
 * The shape `PhotoCapture` already consumes (`onCapture`/`uploadStatus`/
 * `onRetryUpload`), plus `flush`. Photos are held locally, keyed by
 * `PhotoCapture`'s own slot key, until the record they belong to actually
 * exists — "the record saves first and the photos follow it" (UI §6.3) — at
 * which point the caller's mutation `onSuccess` calls `flush(subjectId)`
 * and every captured photo is handed to the uploader at once.
 */
export function usePhotoUpload(kind: AttachmentKind, subjectType: AttachmentSubjectType) {
  useUploaderTick();
  const api = useApi();
  const [pending, setPending] = useState<Record<string, PendingPhoto>>({});

  const onCapture = useCallback((key: string, photo: CapturedPhoto) => {
    setPending((p) => ({
      ...p,
      [key]: { id: newId(), blob: photo.blob, contentType: photo.blob.type },
    }));
  }, []);

  const flush = useCallback(
    (subjectId: string) => {
      for (const photo of Object.values(pending)) {
        attachmentUploader.enqueue(api, {
          id: photo.id,
          blob: photo.blob,
          contentType: photo.contentType,
          kind,
          subjectType,
          subjectId,
        });
      }
    },
    [pending, api, kind, subjectType],
  );

  const onRetryUpload = useCallback(
    (key: string) => {
      const photo = pending[key];
      if (!photo) return;
      attachmentUploader.retry(api, photo.id);
    },
    [pending, api],
  );

  const uploadStatus: Record<string, UploadStatus | undefined> = {};
  for (const [key, photo] of Object.entries(pending)) {
    uploadStatus[key] = attachmentUploader.getStatus(photo.id);
  }

  // The sheet stays mounted and is reused across records (RecordExpenseSheet
  // and FuelFillSheet both reset their own form state on reopen, the same
  // "sync on open, not close" convention) — without this, a second record's
  // flush() would re-walk the first record's already-flushed `pending`
  // entries too and re-upload them under the new subjectId.
  const reset = useCallback(() => {
    setPending({});
  }, []);

  return { onCapture, uploadStatus, onRetryUpload, flush, reset };
}

export interface LocalUpload {
  id: string;
  status: UploadStatus;
}

/**
 * The receipt-viewing surface's own read (`ExpenseCostRow`, A7 commit 7):
 * everything this session's uploader knows about one subject, regardless of
 * which now-unmounted sheet queued it. An attachment already confirmed by
 * the server (a `GET /api/attachment` list) does not need this — it exists
 * whether or not the current tab remembers uploading it — so callers
 * typically use this only to find the `"uploading"`/`"error"` entries the
 * server list cannot know about yet, and `retry` to act on one.
 */
export function useLocalAttachmentUploads(
  subjectType: AttachmentSubjectType,
  subjectId: string,
): { uploads: LocalUpload[]; retry: (id: string) => void } {
  useUploaderTick();
  const api = useApi();
  const uploads = attachmentUploader.idsForSubject(subjectType, subjectId).map((id) => ({
    id,
    status: attachmentUploader.getStatus(id) ?? "error",
  }));
  const retry = useCallback((id: string) => attachmentUploader.retry(api, id), [api]);
  return { uploads, retry };
}
