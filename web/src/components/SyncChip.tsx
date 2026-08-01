import { RefreshCw } from "lucide-react";

export interface SyncChipProps {
  /** Once true, the chip renders nothing — a settled record needs no badge, only an unsynced one does. */
  synced: boolean;
}

/** §6.4 `SyncChip` (M-12): "Not yet saved" lives on the record itself, never in a global banner — see `OfflineBanner` for the connectivity-wide signal. */
export function SyncChip({ synced }: SyncChipProps) {
  if (synced) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-caption text-warning-ink">
      <RefreshCw className="size-3" aria-hidden />
      Not yet saved
    </span>
  );
}
