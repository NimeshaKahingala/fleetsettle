import type { AdminBusiness } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { BusinessesListScreen } from "./BusinessesListScreen.js";

const BUSINESSES: AdminBusiness[] = [
  // GAP-142: the raw Postgres `timestamptz` text form (19 Aug 2026 live QA
  // pass, F-5) — not the pre-fix fixture's bare `YYYY-MM-DD`, which never
  // would have caught the bug it's a regression test for.
  {
    id: "b1",
    name: "Perera Transport",
    createdAt: "2026-08-01 09:15:00.123456+00",
    memberCount: 3,
  },
  { id: "b2", name: "Solo Fleet", createdAt: "2026-08-10 14:30:00+00", memberCount: 1 },
];

test("INV-38: lists every business by name, created date and member count — never money", async () => {
  const get = vi.fn().mockResolvedValue(BUSINESSES);
  renderWithProviders(<BusinessesListScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Perera Transport")).toBeInTheDocument();
  // GAP-142: formatted, business-readable — never the raw wire timestamp.
  expect(screen.getByText("Created 1 Aug 2026")).toBeInTheDocument();
  expect(screen.queryByText(/09:15:00/)).not.toBeInTheDocument();
  expect(screen.getByText("3 members")).toBeInTheDocument();
  expect(screen.getByText("Solo Fleet")).toBeInTheDocument();
  expect(screen.getByText("1 member")).toBeInTheDocument();
});

test("a genuinely empty list is a real empty state, not a failure", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(<BusinessesListScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("No businesses yet.")).toBeInTheDocument();
});

test("a failed read shows a failure notice, never an eternal spinner (GAP-101)", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<BusinessesListScreen onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the business list."),
  ).toBeInTheDocument();
});
