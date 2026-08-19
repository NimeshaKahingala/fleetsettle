import type { PlatformAuditLogEntry } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { PlatformAuditLogScreen } from "./PlatformAuditLogScreen.js";

const APPROVED: PlatformAuditLogEntry = {
  id: "1",
  action: "request_approved",
  subjectId: "r1",
  actorId: "u1",
  actorName: "Nimal Perera",
  selfAction: false,
  createdAt: "2026-08-18T10:00:00.000Z",
};

const SELF_GRANT: PlatformAuditLogEntry = {
  id: "2",
  action: "admin_granted",
  subjectId: "u2",
  actorId: "u2",
  actorName: "Unnamed user",
  selfAction: true,
  createdAt: "2026-08-17T09:00:00.000Z",
};

test("renders every action in plain English, never the raw enum value", async () => {
  const get = vi.fn().mockResolvedValue([APPROVED]);
  renderWithProviders(<PlatformAuditLogScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Approved a business request")).toBeInTheDocument();
  expect(screen.queryByText("request_approved")).not.toBeInTheDocument();
  expect(screen.getByText(/Nimal Perera/)).toBeInTheDocument();
});

test("a self-action entry carries a visible marker", async () => {
  const get = vi.fn().mockResolvedValue([SELF_GRANT]);
  renderWithProviders(<PlatformAuditLogScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Granted admin access")).toBeInTheDocument();
  expect(screen.getByText("Self")).toBeInTheDocument();
});

test("GAP-142: the entry's date is formatted with its time, never the raw ISO/timestamptz text", async () => {
  const get = vi.fn().mockResolvedValue([APPROVED]);
  renderWithProviders(<PlatformAuditLogScreen onBack={vi.fn()} />, { get });

  // Gitar review, PR #79: the audit log keeps time-of-day — two admin
  // actions on the same day are common, and ordering is what an audit is for.
  expect(await screen.findByText(/18 Aug 2026, 15:30/)).toBeInTheDocument();
  expect(screen.queryByText(/2026-08-18T10:00/)).not.toBeInTheDocument();
});

test("a genuinely empty log is a real empty state, not a failure", async () => {
  const get = vi.fn().mockResolvedValue([]);
  renderWithProviders(<PlatformAuditLogScreen onBack={vi.fn()} />, { get });

  expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
});

test("a failed read shows a failure notice, never an eternal spinner (GAP-101)", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<PlatformAuditLogScreen onBack={vi.fn()} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the platform log."),
  ).toBeInTheDocument();
});
