import type { SessionResponse } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { can, type Capability } from "../lib/capabilities.js";

export interface CanProps {
  cap: Capability;
  children: React.ReactNode;
}

/**
 * UI §12.4/M-22: renders nothing when the current role lacks the
 * capability — **absent, never disabled**. A disabled control tells a
 * manager the feature exists and he is untrusted, which is a different
 * message from the one this product intends. Never the security boundary
 * itself (`lib/capabilities.ts`'s own doc comment) — every write this gates
 * is re-checked in the Worker regardless of what rendered here.
 *
 * Reads the `["session"]` cache directly (Phase 2, 18 Aug 2026 — rebuilt off
 * `/api/session`, see `useMe.ts`) rather than through `useMe()`'s
 * throw-if-missing guard: sign-out (GAP-40) clears the query cache
 * *before* the real navigation completes, and in that narrow window a
 * still-mounted `<Can>` must degrade to "hide", not crash the screen it's
 * gating — the same fail-closed instinct M-22 already applies to the
 * capability check itself.
 */
export function Can({ cap, children }: CanProps) {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const role = session?.businesses[0]?.role;
  if (role === undefined || !can(role, cap)) return null;
  return <>{children}</>;
}
