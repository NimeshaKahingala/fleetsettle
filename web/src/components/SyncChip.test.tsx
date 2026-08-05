import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SyncChip } from "./SyncChip.js";

test('shows "Not yet saved" when unsynced', () => {
  render(<SyncChip synced={false} />);
  expect(screen.getByText("Not yet saved")).toBeInTheDocument();
});

test("renders nothing once synced — no separate settled chip", () => {
  const { container } = render(<SyncChip synced />);
  expect(container).toBeEmptyDOMElement();
});
