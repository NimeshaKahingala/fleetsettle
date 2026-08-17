import type { LeaseResponse } from "@fleetsettle/shared/schemas";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useApi } from "../../lib/ApiContext.js";

/** `LeaseHubScreen` and `CloseLeaseScreen` both read the same lease by id, purely to feed their own `customerQuery`'s key/enabled — one query, not two independently-typed copies of the same fetch. */
export function useLeaseQuery(leaseId: string): UseQueryResult<LeaseResponse> {
  const api = useApi();
  return useQuery({
    queryKey: ["lease", leaseId],
    queryFn: () => api.get<LeaseResponse>(`/api/lease/${leaseId}`),
  });
}
