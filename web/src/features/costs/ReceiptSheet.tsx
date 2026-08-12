import type { AttachmentSubjectType, ListAttachmentsResponse } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useLocalAttachmentUploads } from "../../lib/attachmentUploader.js";
import { useQueryState } from "../../lib/useQueryState.js";

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

  const confirmedIds = new Set((attachmentsQuery.data ?? []).map((a) => a.id));
  // "uploaded" locally but not yet in the list is the query not having
  // refetched since the upload finished — the confirmed list is still the
  // one shown for it. Only an id the server doesn't know about yet
  // (uploading, or failed and never became a row) needs its own tile.
  const unconfirmedLocalUploads = localUploads.filter((u) => !confirmedIds.has(u.id));

  const hasAnything =
    (attachmentsQuery.data?.length ?? 0) > 0 || unconfirmedLocalUploads.length > 0;

  return (
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
            {(attachmentsQuery.data ?? []).map((attachment) => (
              <ReceiptThumbnail
                key={attachment.id}
                attachmentId={attachment.id}
                sizeBytes={attachment.sizeBytes}
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
  );
}

function ReceiptThumbnail({
  attachmentId,
  sizeBytes,
}: {
  attachmentId: string;
  sizeBytes: number;
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
      .then(({ blob }) => {
        if (cancelled) return;
        if (blob.size !== sizeBytes) {
          // A network-truncated response resolves without fetch ever
          // throwing (GAP-112) — the only way to catch it is to check what
          // actually arrived against the size the server already told us.
          setFailed(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [api, attachmentId, sizeBytes, attempt]);

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex size-20 items-center justify-center rounded-sm border border-line-strong bg-surface text-critical">
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
      <div className="flex size-20 items-center justify-center rounded-sm border border-line-strong bg-surface">
        <RefreshCw className="size-5 animate-spin text-ink-secondary" aria-hidden />
      </div>
    );
  }

  return (
    <img src={url} alt="" className="size-20 rounded-sm border border-line-strong object-cover" />
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
      <div className="relative flex size-20 items-center justify-center rounded-sm border border-line-strong bg-surface">
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
