import type {
  AttachmentSubjectType,
  ListAttachmentsResponse,
  VoidedAttachmentResponse,
} from "@fleetsettle/shared/schemas";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useLocalAttachmentUploads } from "../../lib/attachmentUploader.js";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useCloseWatcherDismiss } from "../../lib/useCloseWatcherDismiss.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { QueryStateFailure } from "../../components/QueryState.js";

function validateImageBlob(blob: Blob): Promise<void> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob).then((bitmap) => {
      bitmap.close();
    });
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    let previewUrl: string | null = URL.createObjectURL(blob);

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    };

    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Receipt image could not be decoded"));
    };
    image.src = previewUrl;
  });
}

function logReceiptThumbnailFailure({
  msg,
  attachmentId,
  expectedSizeBytes,
  actualSizeBytes,
  responseContentType,
  blobContentType,
}: {
  msg: string;
  attachmentId: string;
  expectedSizeBytes: number;
  actualSizeBytes: number;
  responseContentType: string | null;
  blobContentType: string;
}) {
  if (import.meta.env.MODE === "production") return;

  console.warn(
    JSON.stringify({
      level: "warn",
      msg,
      attachmentId,
      expectedSizeBytes,
      actualSizeBytes,
      responseContentType,
      blobContentType,
    }),
  );
}

/**
 * A7/GAP-16, commit 7. GAP-16 does not honestly close for expenses until a
 * user can see what they uploaded, not only until the API can accept it —
 * this is that surface. Thumbnails are fetched through the Worker, never a
 * public or presigned URL (decisions 1–2), and only once this sheet is
 * actually open (never eagerly per row in a list).
 */
export interface ReceiptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectType: AttachmentSubjectType;
  subjectId: string;
}

export function ReceiptSheet({ open, onOpenChange, subjectType, subjectId }: ReceiptSheetProps) {
  const api = useApi();
  const attachmentsQuery = useQuery({
    queryKey: ["attachments", subjectType, subjectId],
    queryFn: () =>
      api.get<ListAttachmentsResponse>(
        `/api/attachment?${new URLSearchParams({ subjectType, subjectId }).toString()}`,
      ),
    enabled: open,
  });
  // GAP-101: a failed read here is not "no receipts" — NotAvailable would
  // claim the read succeeded and found nothing, which is a different fact.
  const attachmentsState = useQueryState(attachmentsQuery);
  const { uploads: localUploads, retry } = useLocalAttachmentUploads(subjectType, subjectId);

  // The already-fetched blob URL for each loaded thumbnail, keyed by
  // attachment id — GAP-117-adjacent: the lightbox re-displays this same
  // blob bigger, never a second fetch (UI §13's "never full-size in lists"
  // is about not eagerly loading full-res images into a scrolling list; a
  // single photo a user explicitly tapped for isn't "in a list" anymore,
  // and costs nothing extra since the bytes are already in memory).
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // The thumbnails backing `urls`/`viewingId` live inside `<Sheet>` and
  // unmount (revoking their object URLs) when it closes — this state must
  // not outlive them, or a reopened sheet could hand the lightbox a
  // revoked URL.
  useEffect(() => {
    if (!open) {
      setUrls({});
      setViewingId(null);
      setRemovingId(null);
    }
  }, [open]);

  const confirmedIds = new Set((attachmentsQuery.data ?? []).map((a) => a.id));
  // "uploaded" locally but not yet in the list is the query not having
  // refetched since the upload finished — the confirmed list is still the
  // one shown for it. Only an id the server doesn't know about yet
  // (uploading, or failed and never became a row) needs its own tile.
  const unconfirmedLocalUploads = localUploads.filter((u) => !confirmedIds.has(u.id));

  const hasAnything =
    (attachmentsQuery.data?.length ?? 0) > 0 || unconfirmedLocalUploads.length > 0;

  const attachments = attachmentsQuery.data ?? [];
  const viewingUrl = viewingId !== null ? urls[viewingId] : undefined;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title="Receipts">
        <div className="flex flex-col gap-4">
          {attachmentsState.kind === "error" ? (
            <QueryStateFailure
              error={attachmentsState.error}
              retry={attachmentsState.retry}
              of="these receipts"
            />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {attachments.map((attachment, index) => (
                <ReceiptThumbnail
                  key={attachment.id}
                  attachmentId={attachment.id}
                  sizeBytes={attachment.sizeBytes}
                  label={`Receipt ${(index + 1).toString()} of ${attachments.length.toString()}`}
                  onLoaded={(url) => setUrls((u) => ({ ...u, [attachment.id]: url }))}
                  onView={() => setViewingId(attachment.id)}
                />
              ))}
              {unconfirmedLocalUploads.map((upload) => (
                <PendingReceiptTile
                  key={upload.id}
                  upload={upload}
                  onRetry={() => retry(upload.id)}
                />
              ))}
            </div>
          )}
          {!attachmentsQuery.isError && !attachmentsQuery.isPending && !hasAnything ? (
            <p className="text-body text-ink-muted">No receipts yet</p>
          ) : null}
        </div>
      </Sheet>
      {viewingId !== null && viewingUrl !== undefined ? (
        <ReceiptLightbox
          url={viewingUrl}
          onClose={() => setViewingId(null)}
          onRemove={() => {
            const id = viewingId;
            setViewingId(null);
            setRemovingId(id);
          }}
        />
      ) : null}
      <RemoveReceiptSheet
        open={removingId !== null}
        onOpenChange={(next) => {
          if (!next) setRemovingId(null);
        }}
        attachmentId={removingId ?? ""}
        subjectType={subjectType}
        subjectId={subjectId}
      />
    </>
  );
}

function ReceiptThumbnail({
  attachmentId,
  sizeBytes,
  label,
  onLoaded,
  onView,
}: {
  attachmentId: string;
  sizeBytes: number;
  label: string;
  onLoaded: (url: string) => void;
  onView: () => void;
}) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setFailed(false);
    api
      .getBlob(`/api/attachment/${attachmentId}`)
      .then(async ({ blob, contentType }) => {
        if (cancelled) return;
        if (blob.size !== sizeBytes) {
          // A network-truncated response resolves without fetch ever
          // throwing (GAP-112) — the only way to catch it is to check what
          // actually arrived against the size the server already told us.
          logReceiptThumbnailFailure({
            msg: "receipt thumbnail size mismatch",
            attachmentId,
            expectedSizeBytes: sizeBytes,
            actualSizeBytes: blob.size,
            responseContentType: contentType,
            blobContentType: blob.type,
          });
          setFailed(true);
          return;
        }

        try {
          await validateImageBlob(blob);
        } catch {
          if (cancelled) return;
          logReceiptThumbnailFailure({
            msg: "receipt thumbnail decode failed",
            attachmentId,
            expectedSizeBytes: sizeBytes,
            actualSizeBytes: blob.size,
            responseContentType: contentType,
            blobContentType: blob.type,
          });
          setFailed(true);
          return;
        }

        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        onLoaded(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onLoaded is a fresh closure every render; keying the fetch on it would re-fetch every render
  }, [api, attachmentId, sizeBytes, attempt]);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex size-20 items-center justify-center rounded-sm border border-transparent bg-surface-sunken text-critical">
          <AlertCircle className="size-5" aria-hidden />
        </div>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="flex min-h-11 min-w-11 items-center justify-center text-caption text-brand-ink"
        >
          Retry
        </button>
      </div>
    );
  }

  if (url === null) {
    return (
      <div className="flex size-20 items-center justify-center rounded-sm border border-transparent bg-surface-sunken">
        <RefreshCw className="size-5 animate-spin text-ink-secondary" aria-hidden />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onView}
      aria-label={label}
      className="size-20 overflow-hidden rounded-sm border border-transparent bg-surface-sunken"
    >
      <img src={url} alt="" className="size-full object-cover" />
    </button>
  );
}

/**
 * A full-screen view of the one photo just tapped — reuses the blob
 * `ReceiptThumbnail` already fetched, never a second request. Built
 * directly on `@radix-ui/react-dialog` (the same primitive `Sheet`/`Dialog`
 * wrap), not a plain `createPortal`: this can be open at the same time as
 * the outer `Sheet`, and only Radix's own dialog stack knows to keep *this*,
 * the topmost one, interactive while marking everything outside it inert —
 * a hand-rolled portal is just another sibling under `document.body` as far
 * as that stack is concerned, and gets marked inert (`pointer-events: none`)
 * right along with the real background. Registers a close-watcher the same
 * way `Sheet` does (§3.3), so the Android back button closes it rather than
 * leaving the app; Escape and the overlay click come free from Radix.
 */
function ReceiptLightbox({
  url,
  onClose,
  onRemove,
}: {
  url: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  useCloseWatcherDismiss(true, (next) => {
    if (!next) onClose();
  });

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col outline-none">
          <DialogPrimitive.Title className="sr-only">Receipt</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only" />
          <div className="flex justify-end p-4">
            <DialogPrimitive.Close
              aria-label="Close receipt view"
              className={cn(
                "flex size-tap items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20",
                rowButtonFocus,
              )}
            >
              <X className="size-6" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4">
            <img
              src={url}
              alt="Receipt, full size"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              size="cta"
              onClick={onRemove}
              className="border-white/30 text-white active:bg-white/10"
            >
              Remove receipt
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** W-50: void, never delete — mirrors `VoidExpenseSheet`'s exact reason/confirm shape. */
function RemoveReceiptSheet({
  open,
  onOpenChange,
  attachmentId,
  subjectType,
  subjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachmentId: string;
  subjectType: AttachmentSubjectType;
  subjectId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<VoidedAttachmentResponse>(`/api/attachment/${attachmentId}/void`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attachments", subjectType, subjectId] });
      onOpenChange(false);
    },
  });

  const canSave = reason.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Remove receipt">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This voids the receipt — it stops counting and stops showing here, but the fact that it
          was attached, and your reason, are kept.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Remove receipt
        </Button>
      </div>
    </Sheet>
  );
}

function PendingReceiptTile({
  upload,
  onRetry,
}: {
  upload: { id: string; status: "uploading" | "uploaded" | "error" };
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative flex size-20 items-center justify-center rounded-sm border border-transparent bg-surface-sunken">
        {upload.status === "uploading" ? (
          <RefreshCw className="size-5 animate-spin text-ink-secondary" aria-hidden />
        ) : (
          <AlertCircle className="size-5 text-critical" aria-hidden />
        )}
      </div>
      {upload.status === "error" ? (
        <button type="button" onClick={onRetry} className="text-caption text-brand-ink">
          Retry
        </button>
      ) : null}
    </div>
  );
}
