import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { clearSelectedBusinessId } from "./storage.js";

export interface AuthActions {
  /**
   * Clears the query cache before the underlying sign-out call, never after
   * — the call is a real navigation in real auth mode, so anything queued
   * behind it would never run. TanStack Query holds one person's money on
   * screen; the next sign-in on the same device must not paint it before
   * the first fetch returns (GAP-40's trap).
   *
   * Decision 25: also clears the stored business selection, here and only
   * here — this is the one path both `auth-asgardeo.ts`'s and
   * `auth-stub.ts`'s `signOut` route through, so neither can forget it.
   * **Not** `AuthGate.tsx`: that fires on every unauthenticated render,
   * including a transient token refresh, and would wipe the selection out
   * from under a still-live session.
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
    clearSelectedBusinessId();
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
