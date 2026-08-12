import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Fuel } from "lucide-react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { __resetSheetHistoryStackForTests } from "../../lib/useMobileHistoryDismiss.js";
import { ActionSheet, type ActionSheetAction } from "./ActionSheet.js";
import { Sheet } from "./Sheet.js";

test("renders its title and children when open, and closes via the visible close button (M-23)", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  render(
    <Sheet open onOpenChange={onOpenChange} title="Log a fuel fill">
      <p>Amount</p>
    </Sheet>,
  );

  expect(screen.getByText("Log a fuel fill")).toBeInTheDocument();
  expect(screen.getByText("Amount")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("renders nothing when closed", () => {
  render(
    <Sheet open={false} onOpenChange={vi.fn()} title="Log a fuel fill">
      <p>Amount</p>
    </Sheet>,
  );
  expect(screen.queryByText("Amount")).not.toBeInTheDocument();
});

/**
 * GAP-104: MP-07-style primitive-level coverage, on a real touch device
 * (`pointer: coarse`) rather than the desktop default the tests above run
 * under — this is the class of device the bug only reproduces on, and the
 * two tests below are close to real usage rather than a unit test of the
 * manager in isolation (`useMobileHistoryDismiss.test.tsx` has that).
 */
function mockCoarsePointer(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as typeof window.matchMedia;
}

beforeEach(() => {
  mockCoarsePointer(true);
  __resetSheetHistoryStackForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `ActionSheet`'s own handler: `onOpenChange(false)` then `onSelect()`, same shape as `QuickAddSheet` → Fuel/Expense/New trip. */
function ActionSheetHandoffHarness() {
  const [actionsOpen, setActionsOpen] = useState(true);
  const [targetOpen, setTargetOpen] = useState(false);
  const actions: ActionSheetAction[] = [
    { key: "fuel", label: "Fuel", icon: Fuel, onSelect: () => setTargetOpen(true) },
  ];
  return (
    <>
      <ActionSheet open={actionsOpen} onOpenChange={setActionsOpen} title="Add" actions={actions} />
      <Sheet open={targetOpen} onOpenChange={setTargetOpen} title="Log a fuel fill">
        <p>Fuel amount</p>
      </Sheet>
    </>
  );
}

test("GAP-104: on a touch device, selecting an ActionSheet action opens the target sheet and it stays open", async () => {
  const user = userEvent.setup();
  render(<ActionSheetHandoffHarness />);

  await user.click(screen.getByRole("button", { name: "Fuel" }));

  expect(await screen.findByText("Fuel amount")).toBeInTheDocument();
  // A basic sanity check, not this repo's primary regression coverage for
  // the handoff race: verified against the pre-fix implementation that
  // jsdom's history.back()/popstate never reproduces this specific
  // interleaving the way real Chromium does, no matter how long this waits
  // — the manager-level assertion in useMobileHistoryDismiss.test.tsx
  // ("nets to zero history calls") and the touch-emulated Playwright spec
  // (e2e/mobile-sheet-history.touch.spec.ts) are what actually catch it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.getByText("Fuel amount")).toBeInTheDocument();
});

/** A `MoneyField`-style nested sheet: an inner `Sheet` opened from inside an already-open outer `Sheet`, closing on its own "Save" without touching the outer one. */
function NestedSheetHarness() {
  const [parentOpen, setParentOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(false);
  return (
    <Sheet open={parentOpen} onOpenChange={setParentOpen} title="Add a starting figure">
      <p>Party selection</p>
      <button type="button" onClick={() => setChildOpen(true)}>
        Open amount
      </button>
      <Sheet open={childOpen} onOpenChange={setChildOpen} title="Amount">
        <button type="button" onClick={() => setChildOpen(false)}>
          Save
        </button>
      </Sheet>
    </Sheet>
  );
}

test("GAP-104: on a touch device, saving a nested sheet leaves its still-open parent sheet open", async () => {
  const user = userEvent.setup();
  render(<NestedSheetHarness />);

  await user.click(screen.getByRole("button", { name: "Open amount" }));
  expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Save" }));

  // The parent's own content — entered before the nested sheet was even
  // opened — must still be there: this is the shape that discarded a whole
  // in-progress opening-balance entry.
  expect(await screen.findByText("Party selection")).toBeInTheDocument();
});
