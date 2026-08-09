import type { MeResponse } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ApiClient } from "../lib/api.js";
import { ApiProvider } from "../lib/ApiContext.js";
import { AuthActionsProvider } from "../lib/AuthActionsContext.js";

/**
 * Every screen/form test wraps its subject the same way — one query client
 * per test, a partial mock ApiClient stood in for the Worker. `signOut`
 * defaults to a no-op: only `MoreScreen.test.tsx` needs a real one, and the
 * returned `queryClient` lets it assert `useAuthActions().signOut()` clears
 * it (GAP-40's trap). `me`, when given, seeds the `["me"]` cache entry
 * *before* the first render — B0b's `useMe()`/`<Can>` read it synchronously
 * with no observer, so seeding after `render()` (as a plain
 * `queryClient.setQueryData` call would) is too late for anything that
 * reads it during that first pass. Omitted by every caller that doesn't
 * render a `<Can>`-gated tree, which is most of them.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  api: Partial<ApiClient> = {},
  signOut: () => Promise<void> = () => Promise.resolve(),
  me?: MeResponse,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (me !== undefined) queryClient.setQueryData<MeResponse>(["me"], me);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api as ApiClient}>
        <AuthActionsProvider queryClient={queryClient} rawSignOut={signOut}>
          {ui}
        </AuthActionsProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
