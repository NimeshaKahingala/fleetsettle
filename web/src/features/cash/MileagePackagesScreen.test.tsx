import type { ListMileagePackagesResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { MileagePackagesScreen } from "./MileagePackagesScreen.js";

const packages: ListMileagePackagesResponse = [
  {
    id: "mp1",
    name: "Standard 100",
    dailyLimitKm: 100,
    excessRateMinorPerKm: "2500",
    archivedAt: null,
  },
  {
    id: "mp2",
    name: "Old package",
    dailyLimitKm: 80,
    excessRateMinorPerKm: "3000",
    archivedAt: "2026-08-01T00:00:00.000Z",
  },
];

async function enterMoney(
  user: ReturnType<typeof userEvent.setup>,
  buttonName: string,
  digits: string,
) {
  await user.click(screen.getByRole("button", { name: buttonName }));
  for (const digit of digits) {
    await user.click(screen.getByRole("button", { name: digit }));
  }
  await user.click(screen.getByRole("button", { name: "Save" }));
}

test("GAP-67: Mileage packages lists active and archived packages", async () => {
  renderWithProviders(<MileagePackagesScreen onBack={vi.fn()} />, {
    get: vi.fn().mockResolvedValue(packages),
  });

  expect(await screen.findByText("Saved packages · 2")).toBeInTheDocument();
  expect(screen.getByText("Standard 100")).toBeInTheDocument();
  expect(screen.getByText("100 km/day")).toBeInTheDocument();
  expect(screen.getByText("Old package")).toBeInTheDocument();
  expect(screen.getByText("Archived")).toBeInTheDocument();
});

test("GAP-67: Mileage packages creates a new package", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "mp3",
    name: "Long run",
    dailyLimitKm: 150,
    excessRateMinorPerKm: "3500",
    archivedAt: null,
  });
  renderWithProviders(<MileagePackagesScreen onBack={vi.fn()} />, {
    get: vi.fn().mockResolvedValue(packages),
    post,
  });

  await user.click(await screen.findByRole("button", { name: "Add package" }));
  await user.type(screen.getByLabelText("Name"), "Long run");
  await user.type(screen.getByLabelText("Daily limit"), "150");
  await enterMoney(user, "Enter excess fee per km", "3500");
  await user.click(screen.getByRole("button", { name: "Save package" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/mileage-package", {
      name: "Long run",
      dailyLimitKm: 150,
      excessRateMinorPerKm: "3500",
    }),
  );
});

test("GAP-67: Mileage packages archives an active package", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({ ...packages[0], archivedAt: "2026-08-11T00:00:00Z" });
  renderWithProviders(<MileagePackagesScreen onBack={vi.fn()} />, {
    get: vi.fn().mockResolvedValue(packages),
    post,
  });

  await user.click(await screen.findByRole("button", { name: /Standard 100/ }));
  await user.click(screen.getByRole("button", { name: "Archive package" }));

  await vi.waitFor(() => expect(post).toHaveBeenCalledWith("/api/mileage-package/mp1/archive", {}));
});
