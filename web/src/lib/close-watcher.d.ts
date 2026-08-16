/**
 * TypeScript's `lib.dom` does not ship `CloseWatcher` yet (checked against
 * the TS 5.9 this repo pins) even though Chrome/Edge/Firefox/Chrome-Android
 * have shipped it since 2024 — see `useCloseWatcherDismiss.ts` for why this
 * project depends on it. https://wicg.github.io/close-watcher/
 */
interface CloseWatcher extends EventTarget {
  requestClose(): void;
  close(): void;
  destroy(): void;
  oncancel: ((this: CloseWatcher, ev: Event) => unknown) | null;
  onclose: ((this: CloseWatcher, ev: Event) => unknown) | null;
}

declare const CloseWatcher: {
  prototype: CloseWatcher;
  new (options?: { signal?: AbortSignal }): CloseWatcher;
};
