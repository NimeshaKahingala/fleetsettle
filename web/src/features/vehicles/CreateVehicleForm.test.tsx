import { asBusinessDate } from "@fleetsettle/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CreateVehicleForm } from "./CreateVehicleForm.js";

const today = asBusinessDate("2026-07-30");

test("defaults to daily lease (B) and lets another arrangement be chosen", async () => {
  const user = userEvent.setup();
  renderWithProviders(<CreateVehicleForm today={today} onCreated={vi.fn()} />);

  expect(screen.getByRole("button", { name: "Daily lease" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Lease out" }));
  expect(screen.getByRole("button", { name: "Lease out" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Daily lease" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("saves with registration, type and arrangement alone — paperwork stays behind Disclosure, never required (U-2)", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
  });
  const onCreated = vi.fn();
  renderWithProviders(<CreateVehicleForm today={today} onCreated={onCreated} />, { post });

  await user.type(screen.getByLabelText("Registration"), "CAB-1234");
  await user.type(screen.getByLabelText("Vehicle type"), "Bus");
  await user.click(screen.getByRole("button", { name: "Add vehicle" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle", {
      registration: "CAB-1234",
      vehicleType: "Bus",
      defaultArrangement: "B",
    }),
  );
  await vi.waitFor(() => expect(onCreated).toHaveBeenCalled());
});

test("paperwork dates are optional and only reach the request once opened and touched", async () => {
  const user = userEvent.setup();
  const post = vi.fn().mockResolvedValue({
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
  });
  renderWithProviders(<CreateVehicleForm today={today} onCreated={vi.fn()} />, { post });

  await user.type(screen.getByLabelText("Registration"), "CAB-1234");
  await user.type(screen.getByLabelText("Vehicle type"), "Bus");
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("button", { name: "Add vehicle" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/vehicle", {
      registration: "CAB-1234",
      vehicleType: "Bus",
      defaultArrangement: "B",
    }),
  );
});
