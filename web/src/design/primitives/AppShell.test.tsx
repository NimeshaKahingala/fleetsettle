import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AppShell } from "./AppShell.js";

test("operate shell renders the 5 fixed tabs, in order, labels visible", () => {
  render(
    <AppShell shell="operate" activeTab="home">
      <p>Home content</p>
    </AppShell>,
  );
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Home",
    "Vehicles",
    "Add",
    "People",
    "More",
  ]);
});

test("review shell renders its 4 tabs and never a ＋", () => {
  render(
    <AppShell shell="review" activeTab="month">
      <p>This month</p>
    </AppShell>,
  );
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "This month",
    "Vehicles",
    "My money",
    "Reports",
  ]);
});

test("mine shell renders no tab bar at all (§3.1: nothing to navigate to)", () => {
  render(
    <AppShell shell="mine">
      <p>Statement</p>
    </AppShell>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText("Statement")).toBeInTheDocument();
});

test("tapping a tab fires onTabChange with its key; tapping ＋ fires onQuickAdd instead, never a tab change", async () => {
  const user = userEvent.setup();
  const onTabChange = vi.fn();
  const onQuickAdd = vi.fn();
  render(
    <AppShell shell="operate" activeTab="home" onTabChange={onTabChange} onQuickAdd={onQuickAdd}>
      <p>Home</p>
    </AppShell>,
  );

  await user.click(screen.getByRole("button", { name: "Vehicles" }));
  expect(onTabChange).toHaveBeenCalledWith("vehicles");

  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(onQuickAdd).toHaveBeenCalledOnce();
  expect(onTabChange).not.toHaveBeenCalledWith("add");
});

test("the active tab is marked aria-current for assistive tech", () => {
  render(
    <AppShell shell="operate" activeTab="people">
      <p>People</p>
    </AppShell>,
  );
  expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
});

test("the active tab carries a visual marker beyond text colour (UI-LF-03)", () => {
  render(
    <AppShell shell="operate" activeTab="people">
      <p>People</p>
    </AppShell>,
  );
  expect(screen.getByRole("button", { name: "People" }).className).toContain("before:bg-brand");
  expect(screen.getByRole("button", { name: "Home" }).className).not.toContain("before:bg-brand");
});

test("GAP-47: below-md landscape keeps the tab bar 44px high and icon-only visually", () => {
  const { container } = render(
    <AppShell shell="operate" activeTab="home">
      <p>Home content</p>
    </AppShell>,
  );

  expect(container.querySelector("nav")).toHaveClass("max-md:landscape:h-11");
  expect(screen.getByRole("button", { name: "Home" })).toHaveClass("max-md:landscape:gap-0");
  expect(screen.getByText("Home")).toHaveClass("max-md:landscape:sr-only");
});

test("GAP-124a/§14: at lg the tab bar becomes a left rail, ahead of the bottom bar in source order", () => {
  const { container } = render(
    <AppShell shell="operate" activeTab="vehicles">
      <p>Vehicles content</p>
    </AppShell>,
  );

  const outer = container.firstElementChild;
  expect(outer).toHaveClass("lg:flex-row");

  const nav = container.querySelector("nav");
  expect(nav).toHaveClass("lg:order-first", "lg:h-full", "lg:w-20", "lg:flex-col", "lg:border-r");

  const activeButton = screen.getByRole("button", { name: "Vehicles" });
  expect(activeButton).toHaveClass("lg:flex-none", "lg:w-full");
  expect(activeButton.className).toContain("lg:before:left-0");
  expect(activeButton.className).toContain("lg:before:w-0.5");
});
