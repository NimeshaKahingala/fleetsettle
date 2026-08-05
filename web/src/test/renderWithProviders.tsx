import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ApiClient } from "../lib/api.js";
import { ApiProvider } from "../lib/ApiContext.js";

/** Every screen/form test wraps its subject the same way — one query client per test, a partial mock ApiClient stood in for the Worker. */
export function renderWithProviders(ui: React.ReactElement, api: Partial<ApiClient> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api as ApiClient}>{ui}</ApiProvider>
    </QueryClientProvider>,
  );
}
