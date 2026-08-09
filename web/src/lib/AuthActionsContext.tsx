import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

export interface AuthActions {
  /**
   * Clears the query cache before the underlying sign-out call, never after
   * — the call is a real navigation in real auth mode, so anything queued
   * behind it would never run. TanStack Query holds one person's money on
   * screen; the next sign-in on the same device must not paint it before
   * the first fetch returns (GAP-40's trap).
   */
  signOut: () => Promise<void>;
}

const AuthActionsContext = createContext<AuthActions | null>(null);

/**
 * Mirrors `ApiContext.tsx`'s shape: the composition root (`main.tsx`) builds
 * the one real `signOut` function — stub or Asgardeo, decided once, the same
 * way `getToken` is — and every screen reaches it through this rather than
 * importing the SDK or the stub directly.
 */
export function AuthActionsProvider({
  queryClient,
  rawSignOut,
  children,
}: {
  queryClient: QueryClient;
  rawSignOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const signOut = async () => {
    queryClient.clear();
    await rawSignOut();
  };
  return <AuthActionsContext.Provider value={{ signOut }}>{children}</AuthActionsContext.Provider>;
}

export function useAuthActions(): AuthActions {
  const actions = useContext(AuthActionsContext);
  if (!actions)
    throw new Error(
      "useAuthActions() called outside an AuthActionsProvider — is the app root missing it?",
    );
  return actions;
}
