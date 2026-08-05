import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusinessResponse } from "@fleetsettle/shared/schemas";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { CreateBusinessForm } from "./CreateBusinessForm.js";
import { NotBuiltYetScreen } from "../../app/NotBuiltYetScreen.js";

/**
 * `/api/me`'s actual shape (`api/src/routes/me.ts`) — a plain Hono route
 * with no `route-defs`/shared schema of its own yet, unlike every other
 * resource, so this stays local to the one screen that consumes it rather
 * than living in `@fleetsettle/shared` alongside schemas an unrelated
 * route-def actually validates against.
 */
interface MeResponse {
  userId: string;
  businessId: string;
  role: "owner" | "owner_manager" | "manager" | "driver";
  driverId?: string;
}

export interface FirstRunGateProps {
  /** Rendered once `/api/me` resolves to `owner_manager`/`manager` (UI §1.1). */
  renderOperate: () => React.ReactNode;
}

/**
 * F-0.1's own documented exception: a brand-new identity has no
 * `business_member` row yet, so `authMiddleware` throws the same 404 a
 * foreign business would (`api/src/middleware/auth.ts`). That 404 is the
 * signal this identity hasn't created a business yet — not an error to
 * surface, the expected first-run state.
 *
 * Role → shell per UI §1.1: `owner_manager`/`manager` get the Operate shell
 * (built this phase); `owner`/`driver` get Review/Mine, which render a
 * placeholder until Web-P9/P10 build them.
 */
export function FirstRunGate({ renderOperate }: FirstRunGateProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<MeResponse>("/api/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // The 404 first-run case is already handled above, inside the query
    // function itself — anything that still reaches `isError` is either a
    // real server error (won't fix itself within a few hundred
    // milliseconds) or the injected token getter throwing outright (not
    // wired yet — deterministic, will never succeed on retry). The default
    // QueryClient's 3-attempt exponential backoff would otherwise leave the
    // very first screen on "Loading…" for several seconds before ever
    // showing either state.
    retry: false,
  });

  // `isPending` (not `isLoading`, which stays `boolean` even inside the
  // pending variant to also cover a paused/offline fetch) is the field
  // TanStack Query v5 actually narrows `data`'s type on.
  if (meQuery.isPending) {
    return <p className="p-4 text-body-sm text-ink-muted">Loading…</p>;
  }

  if (meQuery.isError) {
    return (
      <p className="p-4 text-body-sm text-critical-ink">
        {meQuery.error instanceof Error ? meQuery.error.message : "Something went wrong."}
      </p>
    );
  }

  if (meQuery.data === null) {
    return (
      <div className="p-4">
        <CreateBusinessForm
          onCreated={(_business: BusinessResponse) => {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
        />
      </div>
    );
  }

  const { role } = meQuery.data;
  if (role === "owner_manager" || role === "manager") return <>{renderOperate()}</>;
  if (role === "owner") return <NotBuiltYetScreen title="Review" />;
  return <NotBuiltYetScreen title="Mine" />;
}
