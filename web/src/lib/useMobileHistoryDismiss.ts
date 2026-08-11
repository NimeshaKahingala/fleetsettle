import { useEffect, useRef } from "react";

interface StackEntry {
  id: number;
  onOpenChange: (open: boolean) => void;
}

/**
 * GAP-104. `history.pushState` is synchronous; `history.back()`'s `popstate`
 * fires asynchronously. Every `Sheet` used to push/pop/listen independently,
 * so two sheets changing `open` in the same React commit — `ActionSheet`
 * closing itself and opening a target sheet in one click handler, or a
 * nested `Sheet` (`MoneyField`'s `AmountPad`) closing while its parent stays
 * open — raced on that shared, asynchronous browser resource with no
 * ownership, and the wrong sheet ended up closed.
 *
 * This singleton is the one place mobile-history side effects happen, for
 * every `Sheet` in the app (there is exactly one `window.history`, and only
 * one real hardware/gesture back button). It tracks *desired* depth
 * (`#stack`, one entry per currently-open sheet, outermost first) separately
 * from *pushed* depth (`#pushedCount`, entries actually sent to
 * `window.history`), and only reconciles the two in a microtask-deferred
 * flush — never synchronously inside `register`/`unregister`.
 *
 * That deferral is load-bearing, not an optimization. React runs every
 * effect for one commit synchronously, back to back, before any microtask
 * runs — so by flush time, a same-commit close-then-open (`ActionSheet`'s
 * handoff) has already netted to the same depth, and the flush never touches
 * `window.history` at all. Diffing synchronously inside each
 * register/unregister instead would depend on effect order: closing first
 * requests an async `back()`, then opening pushes a *new* entry on top of
 * the still-current (unconsumed) closing entry before that `back()`
 * resolves — so the eventual `back()` lands one entry short of where it
 * started, silently orphaning the just-pushed entry as an unreachable
 * forward entry. `pendingSelfBacks` bookkeeping would hide that at the
 * callback level, but the real browser stack would already be corrupted.
 */
class SheetHistoryStack {
  #stack: StackEntry[] = [];
  #pushedCount = 0;
  #pendingSelfBacks = 0;
  #nextId = 1;
  #flushScheduled = false;

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", this.#onPopState);
    }
  }

  register(onOpenChange: (open: boolean) => void): number {
    const id = this.#nextId++;
    this.#stack.push({ id, onOpenChange });
    this.#scheduleFlush();
    return id;
  }

  unregister(id: number): void {
    const index = this.#stack.findIndex((entry) => entry.id === id);
    if (index !== -1) this.#stack.splice(index, 1);
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      this.#flush();
    });
  }

  /** The only place `window.history` is touched — always the *net* change since the last flush, never a per-registration push/pop. */
  #flush(): void {
    const desired = this.#stack.length;
    if (desired === this.#pushedCount) return;

    if (desired > this.#pushedCount) {
      for (let i = this.#pushedCount; i < desired; i++) {
        history.pushState({ fleetsettleSheet: true }, "");
      }
      this.#pushedCount = desired;
      return;
    }

    // A programmatic close (Save, an ActionSheet selection that didn't hand
    // off to another sheet, ...) needs to unwind `delta` entries. Set the
    // final depth up front, not per-call: the `popstate`s this produces are
    // self-requested and only decrement `#pendingSelfBacks`, so nothing else
    // should react to them mid-unwind.
    const delta = this.#pushedCount - desired;
    this.#pushedCount = desired;
    this.#pendingSelfBacks += delta;
    for (let i = 0; i < delta; i++) {
      history.back();
    }
  }

  #onPopState = (): void => {
    if (this.#pendingSelfBacks > 0) {
      // This pop was requested by #flush() to unwind a programmatic close;
      // the relevant onOpenChange(false) already ran synchronously in React
      // when the user tapped Save/select. Nothing left to do.
      this.#pendingSelfBacks -= 1;
      return;
    }

    // A real hardware/gesture back-press: close whichever sheet is
    // currently topmost by stack position, not by "whichever popstate
    // listener happened to still be attached" — that positional lookup is
    // what fixes the nested-sheet-closes-its-parent shape of GAP-104.
    this.#pushedCount = Math.max(0, this.#pushedCount - 1);
    const top = this.#stack.pop();
    if (top !== undefined) top.onOpenChange(false);
  };

  __resetForTests(): void {
    this.#stack = [];
    this.#pushedCount = 0;
    this.#pendingSelfBacks = 0;
    this.#flushScheduled = false;
  }
}

const sheetHistoryStack = new SheetHistoryStack();

/** Test-only: module state outlives any one test within a file — see `useMobileHistoryDismiss.test.tsx`. */
export function __resetSheetHistoryStackForTests(): void {
  sheetHistoryStack.__resetForTests();
}

/**
 * §3.3: "Sheets never push history entries on desktop but do register a
 * history entry on mobile so the hardware back button closes them." There's
 * no direct way to detect "has a hardware/gesture back button"; `pointer:
 * coarse` (touch) is the documented stand-in here, since it is the class of
 * device the rule is actually about, unlike a viewport-width breakpoint (a
 * resized desktop window has no back gesture; a touch laptop does).
 *
 * Registers with the shared `SheetHistoryStack` while `open`, on coarse-
 * pointer devices only. The stack owns every `window.history` interaction
 * across every sheet — see its class doc for why that has to be centralized
 * rather than done independently per `Sheet` instance.
 */
export function useMobileHistoryDismiss(
  open: boolean,
  onOpenChange: (open: boolean) => void,
): void {
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;
    if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) {
      return undefined;
    }

    const id = sheetHistoryStack.register((next) => onOpenChangeRef.current(next));
    return () => {
      sheetHistoryStack.unregister(id);
    };
  }, [open]);
}
