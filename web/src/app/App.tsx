import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type AnyRouter } from "@tanstack/react-router";
import type { ApiClient } from "../lib/api.js";
import { ApiProvider } from "../lib/ApiContext.js";
import { AuthActionsProvider } from "../lib/AuthActionsContext.js";
import { ToastProvider } from "../design/primitives/Toast.js";

export interface AppProps {
  router: AnyRouter;
  queryClient: QueryClient;
  apiClient: ApiClient;
  /** Stub or Asgardeo, decided once in `main.tsx` — see `AuthActionsContext.tsx`. */
  signOut: () => Promise<void>;
}

/**
 * The composition root: `main.tsx` builds the real `router`/`queryClient`/
 * `apiClient`/`signOut` (the real `createApiClient` against the deployed
 * Worker) and renders this; `App.test.tsx` builds a test `QueryClient`
 * (retries off), a mock `ApiClient`, a no-op `signOut`, and a router over
 * `createMemoryHistory` instead — the same inject-a-fake-instance pattern
 * `renderWithProviders` already uses for every screen test, lifted one
 * level up so navigation itself is covered too.
 */
export function App({ router, queryClient, apiClient, signOut }: AppProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={apiClient}>
        <AuthActionsProvider queryClient={queryClient} rawSignOut={signOut}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </AuthActionsProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
