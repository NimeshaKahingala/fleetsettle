import { AlertCircle, Image as ImageIcon, Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { downscaleAndEncode, type EncodedPhoto } from "../lib/photo-pipeline.js";

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
 * §6.3 `PhotoCapture` (M-18): named slots for a condition set, or a free
 * grid for receipts/odometer photos. Capture is native
 * (`<input type="file" accept="image/*" capture="environment">`); encoding
 * runs through `lib/photo-pipeline.ts` (downscale, JPEG retry ladder) as
 * soon as a file is chosen, so "the record saves first and the photos
 * follow it" — this component never blocks on the eventual upload, only
 * on the local encode.
 */
export function PhotoCapture({ slots, onCapture, uploadStatus, onRetryUpload }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<Record<string, CapturedPhoto>>({});
  const [encoding, setEncoding] = useState<Record<string, boolean>>({});
  const [freeKeys, setFreeKeys] = useState<string[]>([]);

  async function handleFile(key: string, file: File): Promise<void> {
    setEncoding((e) => ({ ...e, [key]: true }));
    const encoded: EncodedPhoto = await downscaleAndEncode(file);
    const url = URL.createObjectURL(encoded.blob);
    const photo: CapturedPhoto = { blob: encoded.blob, url, flagged: encoded.flagged };
    setPhotos((p) => ({ ...p, [key]: photo }));
    setEncoding((e) => ({ ...e, [key]: false }));
    onCapture(key, photo);
  }

  const tiles =
    slots?.map((slot) => (
      <PhotoSlotTile
        key={slot.key}
        photoKey={slot.key}
        label={slot.label}
        photo={photos[slot.key]}
        encoding={encoding[slot.key] === true}
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
  status,
  onFile,
  onRetryUpload,
}: {
  photoKey: string;
  label: string;
  photo: CapturedPhoto | undefined;
  encoding: boolean;
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
        {status === "error" ? (
          <span className="absolute bottom-1 right-1 flex size-5 items-center justify-center rounded-full bg-critical text-white">
            <AlertCircle className="size-3" aria-hidden />
          </span>
        ) : null}
      </button>
      <span className="text-caption text-ink-muted">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={`${label} file input`}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(photoKey, file);
          e.target.value = "";
        }}
      />
      {status === "error" && onRetryUpload !== undefined ? (
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
        capture="environment"
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
