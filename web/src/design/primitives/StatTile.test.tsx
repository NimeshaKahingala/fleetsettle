import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StatTile } from "./StatTile.js";

test("renders a label and value, size defaulting to title", () => {
  render(<StatTile label="Rent due" value="Rs 45,000" />);
  expect(screen.getByText("Rent due")).toBeInTheDocument();
  expect(screen.getByText("Rs 45,000")).toHaveClass("text-title");
});

test("size=hero renders the value at hero size", () => {
  render(<StatTile label="Confirmed today" value="Rs 12,000" size="hero" />);
  expect(screen.getByText("Rs 12,000")).toHaveClass("text-hero");
});

test("renders a delta with its arrow, sign and word — never colour alone (M-15)", () => {
  render(
    <StatTile
      label="Rent due"
      value="Rs 45,000"
      delta={{ value: "+5,000", direction: "up", label: "from last week", sentiment: "serious" }}
    />,
  );
  expect(screen.getByText("+5,000")).toBeInTheDocument();
  expect(screen.getByText("from last week")).toBeInTheDocument();
});

test("delta with no sentiment renders in secondary ink, not a status colour", () => {
  render(
    <StatTile
      label="Trips in progress"
      value="3"
      delta={{ value: "+1", direction: "up", label: "from yesterday" }}
    />,
  );
  expect(screen.getByText("+1").closest("p")).toHaveClass("text-ink-secondary");
});

test("fewer than 6 sparkline points renders nothing rather than a misleading near-straight line (M-13)", () => {
  const { container } = render(
    <StatTile label="Utilisation" value="82%" sparkline={[1, 2, 3, 4, 5]} />,
  );
  expect(container.querySelector("svg")).not.toBeInTheDocument();
});

test("6 or more sparkline points render a single aria-hidden polyline, no axes or dots", () => {
  const { container } = render(
    <StatTile label="Utilisation" value="82%" sparkline={[1, 2, 3, 4, 5, 6, 7]} />,
  );
  const svg = container.querySelector("svg");
  expect(svg).toHaveAttribute("aria-hidden");
  expect(container.querySelectorAll("polyline")).toHaveLength(1);
  expect(container.querySelectorAll("circle")).toHaveLength(0);
});

test("a flat series (no variance) draws a level line instead of dividing by zero", () => {
  const { container } = render(
    <StatTile label="Steady" value="5" sparkline={[5, 5, 5, 5, 5, 5]} />,
  );
  const points = container.querySelector("polyline")?.getAttribute("points");
  expect(points).toBeDefined();
  expect(points).not.toContain("NaN");
});

test("onClick renders the tile as a button naming itself, for tapping into the full report", async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  render(<StatTile label="Cash position" value="Rs 100,000" onClick={onClick} />);

  const button = screen.getByRole("button", { name: "Cash position" });
  await user.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test("without onClick, renders as a plain (non-interactive) tile", () => {
  render(<StatTile label="Cash position" value="Rs 100,000" />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
