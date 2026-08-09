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
