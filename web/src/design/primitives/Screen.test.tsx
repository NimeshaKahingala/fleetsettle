import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { expect, test, vi } from "vitest";
import { Screen } from "./Screen.js";

test("renders the title and one contextual action in the app bar", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(
    <Screen title="Vehicles" action={{ label: "Add a vehicle", icon: Plus, onClick: onAction }}>
      <p>List</p>
    </Screen>,
  );

  expect(screen.getByRole("heading", { name: "Vehicles" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add a vehicle" }));
  expect(onAction).toHaveBeenCalledOnce();
});

test("the sticky primary action reserves scroll-padding-bottom so a focused field never hides behind it", () => {
  const { container } = render(
    <Screen title="Log a fuel fill" primaryAction={{ label: "Save", onClick: vi.fn() }}>
      <p>Amount</p>
    </Screen>,
  );

  const scrollRegion = container.querySelector(".overflow-y-auto");
  expect(scrollRegion).toHaveClass("scroll-pb-[88px]");
  expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
});

test("no primary action means no sticky CTA and a smaller reserved padding", () => {
  const { container } = render(
    <Screen title="Vehicles">
      <p>List</p>
    </Screen>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(container.querySelector(".overflow-y-auto")).toHaveClass("scroll-pb-4");
});

test("renders the offline banner slot between the app bar and the scroll region (§6.4)", () => {
  render(
    <Screen title="Vehicles" offlineBanner={<div data-testid="offline">Working offline</div>}>
      <p>List</p>
    </Screen>,
  );
  expect(screen.getByTestId("offline")).toBeInTheDocument();
});

test("no onBack means no back button (a tab's own top-level screen, §7's convention)", () => {
  render(
    <Screen title="Vehicles">
      <p>List</p>
    </Screen>,
  );
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
});

test('onBack renders a back button before the title and fires on click (§7.5/§7.2\'s "←" wireframes)', async () => {
  const user = userEvent.setup();
  const onBack = vi.fn();
  render(
    <Screen title="Vehicle" onBack={onBack}>
      <p>Detail</p>
    </Screen>,
  );

  const backButton = screen.getByRole("button", { name: "Back" });
  expect(backButton).toBeInTheDocument();
  await user.click(backButton);
  expect(onBack).toHaveBeenCalledOnce();
});

test("GAP-47: below-md landscape compacts the app bar and scroll padding", () => {
  const { container } = render(
    <Screen title="Log a fuel fill" primaryAction={{ label: "Save", onClick: vi.fn() }}>
      <p>Amount</p>
    </Screen>,
  );

  expect(container.querySelector("header")).toHaveClass("max-md:landscape:h-11");
  expect(screen.getByRole("heading", { name: "Log a fuel fill" })).toHaveClass(
    "max-md:landscape:text-title",
  );
  expect(container.querySelector(".overflow-y-auto")).toHaveClass("max-md:landscape:p-3");
  expect(container.querySelector(".overflow-y-auto")).toHaveClass(
    "max-md:landscape:scroll-pb-[76px]",
  );
});

test("GAP-124a/§14: at lg the scroll region caps at a readable measure and centres, the header stays full width", () => {
  const { container } = render(
    <Screen title="Cash">
      <p>Content</p>
    </Screen>,
  );

  expect(container.querySelector(".overflow-y-auto")).toHaveClass(
    "lg:mx-auto",
    "lg:w-full",
    "lg:max-w-2xl",
  );
  expect(container.querySelector("header")?.className).not.toMatch(/lg:max-w/);
});
