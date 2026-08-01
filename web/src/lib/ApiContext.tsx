import { createContext, useContext } from "react";
import type { ApiClient } from "./api.js";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({
  client,
  children,
}: {
  client: ApiClient;
  children: React.ReactNode;
}) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

/** Every screen reaches the Worker through this — never a direct `fetch`, so `business_id` scoping and the W-49 checks stay entirely server-side (§12.1). */
export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client)
    throw new Error("useApi() called outside an ApiProvider — is the app root missing it?");
  return client;
}
