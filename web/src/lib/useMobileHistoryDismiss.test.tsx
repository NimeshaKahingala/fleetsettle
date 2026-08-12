import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  __resetSheetHistoryStackForTests,
  useMobileHistoryDismiss,
} from "./useMobileHistoryDismiss.js";

function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

/** The manager's flush is deferred to a microtask (GAP-104 — see the class doc), so any assertion on `pushState`/`back` has to let one settle first. */
async function flush(): Promise<void> {
  await Promise.resolve();
}

beforeEach(() => {
  mockCoarsePointer(true);
  __resetSheetHistoryStackForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("pushes one history entry while open, on a coarse-pointer (touch) device", async () => {
  const pushStateSpy = vi.spyOn(history, "pushState");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: false },
  });
  await flush();
  expect(pushStateSpy).not.toHaveBeenCalled();

  rerender({ open: true });
  await waitFor(() => expect(pushStateSpy).toHaveBeenCalledTimes(1));
});

test("a real back-button press (popstate) calls onOpenChange without a double pop", async () => {
  const backSpy = vi.spyOn(history, "back");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });
  await flush(); // let the entry actually push before back is pressed on it

  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  // The consumer reacts to onOpenChange by setting open=false — the manager
  // must NOT call history.back() again, or back would need pressing twice.
  rerender({ open: false });
  await flush();
  expect(backSpy).not.toHaveBeenCalled();
});

test("closing by another means (drag, the visible close button) pops the pushed entry", async () => {
  const backSpy = vi.spyOn(history, "back");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: true },
  });
  await flush();

  rerender({ open: false });
  await waitFor(() => expect(backSpy).toHaveBeenCalledTimes(1));
});

test("never pushes history on a non-coarse (desktop mouse) pointer (§3.3)", async () => {
  mockCoarsePointer(false);
  const pushStateSpy = vi.spyOn(history, "pushState");
  const onOpenChange = vi.fn();

  const { rerender } = renderHook(({ open }) => useMobileHistoryDismiss(open, onOpenChange), {
    initialProps: { open: false },
  });
  rerender({ open: true });
  await flush();
  expect(pushStateSpy).not.toHaveBeenCalled();
});

test("GAP-104: an ActionSheet-style handoff (source closes, target opens, same commit) nets to zero history calls and leaves the target open", async () => {
  const pushStateSpy = vi.spyOn(history, "pushState");
  const backSpy = vi.spyOn(history, "back");
  const sourceOnOpenChange = vi.fn();
  const targetOnOpenChange = vi.fn();

  const source = renderHook(({ open }) => useMobileHistoryDismiss(open, sourceOnOpenChange), {
    initialProps: { open: true },
  });
  await waitFor(() => expect(pushStateSpy).toHaveBeenCalledTimes(1));

  const target = renderHook(({ open }) => useMobileHistoryDismiss(open, targetOnOpenChange), {
    initialProps: { open: false },
  });

  // ActionSheet.tsx: onOpenChange(false) then onSelect() in one handler —
  // both sheets' `open` change in the same synchronous burst, no await
  // between them, so both effects run before any microtask (the flush) does.
  source.rerender({ open: false });
  target.rerender({ open: true });
  await flush();
  await flush();

  expect(pushStateSpy).toHaveBeenCalledTimes(1); // still just the source's original push
  expect(backSpy).not.toHaveBeenCalled();
  expect(targetOnOpenChange).not.toHaveBeenCalledWith(false);

  // A real back-press now closes the target — the entry that's live is the
  // one from the handoff's net depth, and it belongs to whichever sheet is
  // topmost now (the target).
  window.dispatchEvent(new PopStateEvent("popstate"));
  expect(targetOnOpenChange).toHaveBeenCalledWith(false);
  expect(sourceOnOpenChange).not.toHaveBeenCalled();
});

/**
 * A manager-level invariant check (self-issued `back()`s are consumed by
 * `pendingSelfBacks` and never reach another sheet's `onOpenChange`), using
 * two independent `renderHook` roots rather than one real nested component
 * tree — that harness shape doesn't reliably reproduce the *old*
 * implementation's bug (verified: it stayed green against the pre-fix code
 * too), so it's not this repo's proof the fix was needed for the nested
 * case. `Sheet.test.tsx`'s "saving a nested sheet leaves its still-open
 * parent sheet open" test, with two real `Sheet`s in one tree, is — that one
 * reliably failed against the pre-fix code.
 */
test("GAP-104: a nested sheet closing (Save) leaves its still-open parent's onOpenChange uncalled", async () => {
  const backSpy = vi.spyOn(history, "back");
  const parentOnOpenChange = vi.fn();
  const childOnOpenChange = vi.fn();

  const parent = renderHook(({ open }) => useMobileHistoryDismiss(open, parentOnOpenChange), {
    initialProps: { open: true },
  });
  await flush();

  const child = renderHook(({ open }) => useMobileHistoryDismiss(open, childOnOpenChange), {
    initialProps: { open: false },
  });
  child.rerender({ open: true });
  await flush();

  // MoneyField's AmountPad: Save closes only the child, parent is untouched.
  child.rerender({ open: false });
  await waitFor(() => expect(backSpy).toHaveBeenCalledTimes(1));

  expect(parentOnOpenChange).not.toHaveBeenCalled();
  expect(childOnOpenChange).not.toHaveBeenCalledWith(false);

  parent.unmount();
});

test("GAP-104: a real back-press with two sheets open closes only the topmost", async () => {
  const parentOnOpenChange = vi.fn();
  const childOnOpenChange = vi.fn();

  renderHook(({ open }) => useMobileHistoryDismiss(open, parentOnOpenChange), {
    initialProps: { open: true },
  });
  await flush();

  const child = renderHook(({ open }) => useMobileHistoryDismiss(open, childOnOpenChange), {
    initialProps: { open: false },
  });
  child.rerender({ open: true });
  await flush();

  window.dispatchEvent(new PopStateEvent("popstate"));

  expect(childOnOpenChange).toHaveBeenCalledWith(false);
  expect(parentOnOpenChange).not.toHaveBeenCalled();
});
