import type { MeResponse } from "@fleetsettle/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";

/**
 * B0b/UI §1.1: reads the `["me"]` cache entry `FirstRunGate` already
 * populated — a synchronous cache read, not a second `useQuery(["me"])`,
 * which would carry its own default `staleTime: 0` and refetch on every
 * mount. Safe to call unconditionally from anywhere inside
 * `renderOperate`/`renderReview`/`renderMine`: `FirstRunGate` never renders
 * those branches until `meQuery.data` is a real, non-null `MeResponse`.
 */
export function useMe(): MeResponse {
  const queryClient = useQueryClient();
  const me = queryClient.getQueryData<MeResponse>(["me"]);
  if (me === undefined) {
    throw new Error("useMe() called before FirstRunGate resolved a role — is it nested wrong?");
  }
  return me;
}
