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

test("GAP-199: the primary action is a flex sibling below the scroll region, not a child inside it", () => {
  const { container } = render(
    <Screen title="Log a fuel fill" primaryAction={{ label: "Save", onClick: vi.fn() }}>
      <p>Amount</p>
    </Screen>,
  );

  const scrollRegion = container.querySelector(".overflow-y-auto");
  const saveButton = screen.getByRole("button", { name: "Save" });
  // Scrolled content can only ever overlap the CTA if they share a
  // coordinate system — asserting the button's nearest scrolling ancestor
  // is not the scroll region at all is what rules that out structurally,
  // rather than just checking a specific class name that happened to fix
  // the last, differently-shaped instance of this bug (GAP-171).
  expect(scrollRegion?.contains(saveButton)).toBe(false);
  expect(container.querySelector(".sticky")).toBeNull();
});

test("no primary action means no CTA row at all", () => {
  render(
    <Screen title="Vehicles">
      <p>List</p>
    </Screen>,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("GAP-199: children render directly in the scroll region, with no reserved-padding wrapper of any kind", () => {
  render(
    <Screen title="Book a trip" primaryAction={{ label: "Book trip", onClick: vi.fn() }}>
      <p data-testid="last-field">Agreed amount</p>
    </Screen>,
  );

  // GAP-171's `pb-[88px]` reservation existed only because the CTA shared
  // the scroll region's own coordinate system. Once it doesn't (GAP-199),
  // there is nothing left to reserve — the scroll region's own flex-1
  // height is already exactly "whatever the CTA row doesn't take", so the
  // last field's own parent is the scroll region itself, not an
  // intermediate padded wrapper div.
  const scrollRegion = document.querySelector(".overflow-y-auto");
  expect(screen.getByTestId("last-field").parentElement).toBe(scrollRegion);
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

test("the action badge's aria-label agrees in number: singular noun and verb together, plural noun and verb together", () => {
  const { rerender } = render(
    <Screen
      title="Home"
      action={{ label: "What needs attention", icon: Plus, onClick: vi.fn(), badge: 1 }}
    >
      <p>Content</p>
    </Screen>,
  );
  expect(
    screen.getByRole("button", { name: "What needs attention (1 item needs attention)" }),
  ).toBeInTheDocument();

  rerender(
    <Screen
      title="Home"
      action={{ label: "What needs attention", icon: Plus, onClick: vi.fn(), badge: 3 }}
    >
      <p>Content</p>
    </Screen>,
  );
  expect(
    screen.getByRole("button", { name: "What needs attention (3 items need attention)" }),
  ).toBeInTheDocument();
});

test("GAP-124b/§14: a route can opt into a wider canvas for its own two-pane layout", () => {
  const { container } = render(
    <Screen title="Home" contentWidth="wide">
      <p>Content</p>
    </Screen>,
  );

  expect(container.querySelector(".overflow-y-auto")).toHaveClass(
    "lg:mx-auto",
    "lg:w-full",
    "lg:max-w-6xl",
  );
});
