export interface OfflineBannerProps {
  /** Number of writes still queued. Omitted or 0 reads "Working offline" alone. */
  queueCount?: number;
}

/**
 * §6.4 `OfflineBanner`: 32px, caption, rendered by `Screen` between the
 * app bar and the scroll region — never overlaying content, so the scroll
 * region's own height already accounts for it. Not dismissible; it is the
 * caller's job to stop rendering this once connectivity returns, since
 * `OfflineBanner` itself has no notion of network state. The only global
 * offline signal — per-record state is `SyncChip`.
 */
export function OfflineBanner({ queueCount }: OfflineBannerProps) {
  return (
    <div
      role="status"
      className="flex h-8 shrink-0 items-center justify-center bg-warning/15 text-caption text-warning-ink"
    >
      Working offline
      {queueCount !== undefined && queueCount > 0 ? ` · ${queueCount.toString()} waiting` : ""}
    </div>
  );
}
