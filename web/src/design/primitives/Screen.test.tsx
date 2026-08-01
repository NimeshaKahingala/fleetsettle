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
