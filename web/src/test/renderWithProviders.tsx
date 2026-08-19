import type { MeResponse, SessionResponse } from "@fleetsettle/shared/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { ToastProvider } from "../design/primitives/Toast.js";
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
 *
 * Phase 2 (18 Aug 2026): `useMe()`/`<Can>`/`ReportsCatalogueScreen` were
 * rebuilt onto the `["session"]` cache entry (see `useMe.ts`) rather than
 * `["me"]`, since `/api/session` — not a second `/api/me` fetch — is now
 * what `FirstRunGate` resolves a role from. `me`, when given, seeds
 * **both** keys: `["me"]` stays for anything that still reads it directly
 * (none of the client's own code does any more, but a caller-supplied mock
 * might), and the derived `["session"]` entry is what every real consumer
 * now reads. One `me` param, not two, so none of the ~70 existing call
 * sites needed to change. `isPlatformAdmin` (default `false`) is the one
 * session field with nothing in `MeResponse` to derive it from — needed only
 * by `MoreScreen.test.tsx`'s own admin-row test, which is why it is its own
 * trailing optional parameter rather than widening `me`'s shape.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  api: Partial<ApiClient> = {},
  signOut: () => Promise<void> = () => Promise.resolve(),
  me?: MeResponse,
  isPlatformAdmin = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (me !== undefined) {
    queryClient.setQueryData<MeResponse>(["me"], me);
    queryClient.setQueryData<SessionResponse>(["session"], {
      userId: me.userId,
      isPlatformAdmin,
      businesses: [
        {
          businessId: me.businessId,
          name: "",
          role: me.role,
          ...(me.driverId !== undefined ? { driverId: me.driverId } : {}),
        },
      ],
      pendingRequest: null,
      hadMembership: true,
    });
  }
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api as ApiClient}>
        <AuthActionsProvider queryClient={queryClient} rawSignOut={signOut}>
          <ToastProvider>{ui}</ToastProvider>
        </AuthActionsProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
