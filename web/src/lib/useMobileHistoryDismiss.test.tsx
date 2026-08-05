import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useMobileHistoryDismiss } from "./useMobileHistoryDismiss.js";

function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

beforeEach(() => {
  mockCoarsePointer(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("pushes one history entry while open, on a coarse-pointer (touch) device", () => {
  const pushStateSpy = vi.spyOn(history, "pushState");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: false },
  });
  expect(pushStateSpy).not.toHaveBeenCalled();

  rerender({ open: true });
  expect(pushStateSpy).toHaveBeenCalledTimes(1);
});

test("a real back-button press (popstate) calls onOpenChange without a double pop", () => {
  const backSpy = vi.spyOn(history, "back");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  // The consumer reacts to onOpenChange by setting open=false — the hook
  // must NOT call history.back() again, or back would need pressing twice.
  rerender({ open: false });
  expect(backSpy).not.toHaveBeenCalled();
});

test("closing by another means (drag, the visible close button) pops the pushed entry", () => {
  const backSpy = vi.spyOn(history, "back");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });

  rerender({ open: false });
  expect(backSpy).toHaveBeenCalledTimes(1);
});

test("never pushes history on a non-coarse (desktop mouse) pointer (§3.3)", () => {
  mockCoarsePointer(false);
  const pushStateSpy = vi.spyOn(history, "pushState");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: false },
  });
  rerender({ open: true });
  expect(pushStateSpy).not.toHaveBeenCalled();
});
