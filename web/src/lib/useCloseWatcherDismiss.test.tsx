import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCloseWatcherDismiss } from "./useCloseWatcherDismiss.js";

function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

/**
 * jsdom has no `CloseWatcher` at all — this stands in for the browser's
 * own implementation, tracking every instance the hook constructs so a
 * test can drive its `onclose` the way a real back-press would, or assert
 * `destroy()` was called the way a programmatic close should.
 */
class MockCloseWatcher extends EventTarget implements CloseWatcher {
  onclose: ((this: CloseWatcher, ev: Event) => unknown) | null = null;
  oncancel: ((this: CloseWatcher, ev: Event) => unknown) | null = null;
  destroyed = false;

  requestClose(): void {
    this.close();
  }

  close(): void {
    this.onclose?.call(this, new Event("close"));
  }

  destroy(): void {
    this.destroyed = true;
  }
}

let instances: MockCloseWatcher[];
let constructorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCoarsePointer(true);
  instances = [];
  constructorSpy = vi.fn();
  vi.stubGlobal(
    "CloseWatcher",
    class extends MockCloseWatcher {
      constructor() {
        super();
        constructorSpy();
        instances.push(this);
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("constructs a CloseWatcher while open on a coarse-pointer (touch) device, and destroys it on close", () => {
  const onOpenChange = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ open }) => useCloseWatcherDismiss(open, onOpenChange),
    {
      initialProps: { open: false },
    },
  );
  expect(constructorSpy).not.toHaveBeenCalled();

  rerender({ open: true });
  expect(constructorSpy).toHaveBeenCalledTimes(1);
  expect(instances[0]?.destroyed).toBe(false);

  unmount();
  expect(instances[0]?.destroyed).toBe(true);
});

test("a close request (the watcher's own onclose — Android back button/gesture) calls onOpenChange(false)", () => {
  const onOpenChange = vi.fn();
  renderHook(({ open }) => useCloseWatcherDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });

  instances[0]?.close();

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("closing by another means (drag, the visible close button, Save) destroys the watcher without a second onOpenChange call", () => {
  const onOpenChange = vi.fn();
  const { rerender } = renderHook(({ open }) => useCloseWatcherDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });

  rerender({ open: false });

  expect(instances[0]?.destroyed).toBe(true);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("never constructs a CloseWatcher on a non-coarse (desktop mouse) pointer (§3.3)", () => {
  mockCoarsePointer(false);
  const onOpenChange = vi.fn();
  renderHook(({ open }) => useCloseWatcherDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });

  expect(constructorSpy).not.toHaveBeenCalled();
});

test("does not throw when CloseWatcher is unsupported (iOS Safari) — falls back to no mechanism at all", () => {
  vi.unstubAllGlobals();
  expect("CloseWatcher" in window).toBe(false);

  const onOpenChange = vi.fn();
  expect(() => {
    renderHook(({ open }) => useCloseWatcherDismiss(open, onOpenChange), {
      initialProps: { open: true },
    });
  }).not.toThrow();
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("two sheets open at once each get their own independent watcher — nesting needs no shared bookkeeping (GAP-104)", () => {
  const parentOnOpenChange = vi.fn();
  const childOnOpenChange = vi.fn();

  renderHook(({ open }) => useCloseWatcherDismiss(open, parentOnOpenChange), {
    initialProps: { open: true },
  });
  const child = renderHook(({ open }) => useCloseWatcherDismiss(open, childOnOpenChange), {
    initialProps: { open: false },
  });
  child.rerender({ open: true });

  expect(instances).toHaveLength(2);

  // Save on the child destroys only its own watcher; the parent's stays live.
  child.rerender({ open: false });
  expect(instances[1]?.destroyed).toBe(true);
  expect(instances[0]?.destroyed).toBe(false);
  expect(parentOnOpenChange).not.toHaveBeenCalled();
});
