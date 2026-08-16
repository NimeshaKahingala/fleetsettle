import { AlertCircle, Image as ImageIcon, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ATTACHMENT_CONTENT_TYPES } from "@fleetsettle/shared/schemas";
import { encodeWithWorkerTimeout, type EncodedPhoto } from "../lib/photo-pipeline.js";

export interface PhotoSlotDef {
  key: string;
  label: string;
}

export interface CapturedPhoto {
  blob: Blob;
  url: string;
  flagged: boolean;
}

export interface PhotoCaptureProps {
  /** A condition set's named slots (front, back, left, right, interior, existing marks) — omit for a free grid (receipts, odometer photos). */
  slots?: PhotoSlotDef[];
  /** Fires once a photo is captured and has been through the downscale/encode pipeline — the caller owns the actual upload from here (§6.3's pipeline table: presigned R2 PUT, not this component's concern). */
  onCapture: (key: string, photo: CapturedPhoto) => void;
  /** The caller's own per-photo upload progress — this component only displays it, never drives it. */
  uploadStatus?: Record<string, "uploading" | "uploaded" | "error" | undefined>;
  onRetryUpload?: (key: string) => void;
}

/**
 * §6.3 `PhotoCapture` (M-18, M-30): named slots for a condition set, or a
 * free grid for receipts/odometer photos. Capture is native
 * (`<input type="file" accept="image/*">`, deliberately no `capture`
 * attribute — M-30 found it was silently skipping the OS picker's own
 * choice between camera and photo library on many mobile browsers);
 * encoding runs through `lib/photo-pipeline.ts` (downscale, JPEG retry
 * ladder) as soon as a file is chosen, so "the record saves first and the
 * photos follow it" — this component never blocks on the eventual upload,
 * only on the local encode.
 */
export function PhotoCapture({ slots, onCapture, uploadStatus, onRetryUpload }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<Record<string, CapturedPhoto>>({});
  const [encoding, setEncoding] = useState<Record<string, boolean>>({});
  const [captureError, setCaptureError] = useState<Record<string, boolean>>({});
  const [freeKeys, setFreeKeys] = useState<string[]>([]);

  const photosRef = useRef(photos);
  photosRef.current = photos;
  // Every object URL this component has ever created and never released
  // (finding C) — revokes whatever is still live when the sheet closes.
  // Deliberately does not touch an in-flight `handleFile`: encoding is a
  // plain async function, not tied to this component's lifetime, so a
  // photo picked just before Save still reaches `onCapture` and the
  // caller's upload queue even if this component has since unmounted (A7's
  // plan, finding C item 5 — "the record saves first and the photos follow
  // it" holds only if a photo mid-encode is never silently dropped).
  useEffect(() => {
    return () => {
      for (const photo of Object.values(photosRef.current)) URL.revokeObjectURL(photo.url);
    };
  }, []);

  async function handleFile(key: string, file: File): Promise<void> {
    setEncoding((e) => ({ ...e, [key]: true }));
    setCaptureError((e) => ({ ...e, [key]: false }));
    try {
      const encoded: EncodedPhoto = await encodeWithWorkerTimeout(file);
      // photo-pipeline always re-encodes to image/jpeg, except its own
      // no-2D-context fallback, which returns the original file untouched —
      // still possibly a format the server allowlist rejects (HEIC, for
      // one). Catching that here, before `onCapture` ever fires, beats a
      // background upload failing with no sheet left to show it in.
      if (!(ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(encoded.blob.type)) {
        setCaptureError((e) => ({ ...e, [key]: true }));
        return;
      }
      const url = URL.createObjectURL(encoded.blob);
      const photo: CapturedPhoto = { blob: encoded.blob, url, flagged: encoded.flagged };
      setPhotos((p) => {
        // A retake replaces this slot's photo — its old object URL is never
        // referenced again, so it must be revoked here, not only at unmount.
        const previous = p[key];
        if (previous !== undefined) URL.revokeObjectURL(previous.url);
        return { ...p, [key]: photo };
      });
      onCapture(key, photo);
    } catch {
      // createImageBitmap rejects on a corrupt file, an unsupported format
      // on this browser, or memory pressure — previously unhandled, so the
      // tile spun forever and `onCapture` never fired (finding C).
      setCaptureError((e) => ({ ...e, [key]: true }));
    } finally {
      setEncoding((e) => ({ ...e, [key]: false }));
    }
  }

  const tiles =
    slots?.map((slot) => (
      <PhotoSlotTile
        key={slot.key}
        photoKey={slot.key}
        label={slot.label}
        photo={photos[slot.key]}
        encoding={encoding[slot.key] === true}
        captureError={captureError[slot.key] === true}
        status={uploadStatus?.[slot.key]}
        onFile={(key, file) => void handleFile(key, file)}
        {...(onRetryUpload !== undefined ? { onRetryUpload } : {})}
      />
    )) ??
    freeKeys.map((key) => (
      <PhotoSlotTile
        key={key}
        photoKey={key}
        label="Photo"
        photo={photos[key]}
        encoding={encoding[key] === true}
        captureError={captureError[key] === true}
        status={uploadStatus?.[key]}
        onFile={(slotKey, file) => void handleFile(slotKey, file)}
        {...(onRetryUpload !== undefined ? { onRetryUpload } : {})}
      />
    ));

  return (
    <div className="grid grid-cols-3 gap-3">
      {tiles}
      {slots === undefined ? (
        <AddTile
          onFile={(file) => {
            const key = crypto.randomUUID();
            setFreeKeys((keys) => [...keys, key]);
            void handleFile(key, file);
          }}
        />
      ) : null}
    </div>
  );
}

function PhotoSlotTile({
  photoKey,
  label,
  photo,
  encoding,
  captureError,
  status,
  onFile,
  onRetryUpload,
}: {
  photoKey: string;
  label: string;
  photo: CapturedPhoto | undefined;
  encoding: boolean;
  /** A local capture failure (bad decode, or a format the server won't take) — distinct from `status === "error"`, which is the caller's own upload failure. Same visual state, a different affordance: there is no blob to retry uploading, only a new photo to pick. */
  captureError: boolean;
  status: "uploading" | "uploaded" | "error" | undefined;
  onFile: (key: string, file: File) => void;
  onRetryUpload?: (key: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={
          photo !== undefined
            ? `Retake ${label.toLowerCase()} photo`
            : `Capture ${label.toLowerCase()} photo`
        }
        className="relative flex size-20 items-center justify-center overflow-hidden rounded-sm border border-line-strong bg-surface"
      >
        {photo !== undefined ? (
          <img src={photo.url} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-ink-faint" aria-hidden />
        )}
        {encoding ? (
          <span className="absolute inset-0 flex items-center justify-center bg-page/70">
            <RefreshCw className="size-5 animate-spin text-ink-secondary" aria-hidden />
          </span>
        ) : null}
        {status === "error" || captureError ? (
          <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-critical text-white">
            <AlertCircle className="size-3" aria-hidden />
          </span>
        ) : null}
        {photo !== undefined && photo.flagged ? (
          <span
            title="Larger than usual — may take longer to upload"
            className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-warning text-warning-ink"
          >
            <TriangleAlert className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>
      <span className="text-caption text-ink-muted">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label={`${label} file input`}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(photoKey, file);
          e.target.value = "";
        }}
      />
      {captureError ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-caption text-brand-ink"
        >
          Try again
        </button>
      ) : status === "error" && onRetryUpload !== undefined ? (
        <button
          type="button"
          onClick={() => onRetryUpload(photoKey)}
          className="text-caption text-brand-ink"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function AddTile({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="Add a photo"
        className="flex size-20 items-center justify-center rounded-sm border border-dashed border-line-strong text-ink-faint"
      >
        <Plus className="size-6" aria-hidden />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label="Add a photo file input"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
