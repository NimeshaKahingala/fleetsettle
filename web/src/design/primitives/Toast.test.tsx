import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ToastProvider, ToastViewport, useToast } from "./Toast.js";

function ToastHarness({
  durationMs,
  onAction,
}: {
  durationMs?: number | null;
  onAction?: () => void;
}) {
  const { showToast } = useToast();
  const toast = {
    title: "Saved",
    description: "The record is ready.",
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(onAction !== undefined
      ? {
          action: {
            label: "Undo",
            onClick: onAction,
          },
        }
      : {}),
  };
  return (
    <>
      <button type="button" onClick={() => showToast(toast)}>
        Show toast
      </button>
      <ToastViewport />
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

test("GAP-48: shows a toast in the host with polite live-region attributes", () => {
  render(
    <ToastProvider>
      <ToastHarness durationMs={null} />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));

  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  expect(screen.getByText("The record is ready.")).toBeInTheDocument();
  expect(document.querySelector("#toast-root")).toHaveAttribute("aria-live", "polite");
});

test("GAP-48: dismiss removes the toast", () => {
  render(
    <ToastProvider>
      <ToastHarness durationMs={null} />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Saved" }));

  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("GAP-48: action fires and dismisses the toast", () => {
  const onAction = vi.fn();
  render(
    <ToastProvider>
      <ToastHarness durationMs={null} onAction={onAction} />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

  expect(onAction).toHaveBeenCalledOnce();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("GAP-48: default timeout is M-11's 5 seconds", () => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
  expect(screen.getByRole("status")).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(screen.getByRole("status")).toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("ToastViewport keeps AppShell's reserved host when no provider is present", () => {
  render(<ToastViewport />);

  expect(document.querySelector("#toast-root")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
