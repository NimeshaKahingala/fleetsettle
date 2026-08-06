import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAsgardeoTokenSource, createAsgardeoTokenGetter } from "../lib/auth-asgardeo.js";
import { AuthGate } from "./AuthGate.js";

const signIn = vi.fn<() => Promise<void>>();
const getAccessToken = vi.fn<() => Promise<string>>();
let authState = { isAuthenticated: false, isLoading: false };

vi.mock("@asgardeo/auth-react", () => ({
  useAuthContext: () => ({ state: authState, signIn, getAccessToken }),
}));

/** jsdom refuses a real navigation, so `location` is replaced with a plain object per test. Returns the `replace` spy so assertions never reach through `window` for it. */
function setLocation(href: string) {
  const url = new URL(href);
  const replace = vi.fn<(target: string) => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: url.pathname, search: url.search, origin: url.origin, replace },
  });
  return replace;
}

beforeEach(() => {
  signIn.mockReset().mockResolvedValue(undefined);
  getAccessToken.mockReset().mockResolvedValue("real-token");
  authState = { isAuthenticated: false, isLoading: false };
  setLocation("http://localhost:5173/");
});

afterEach(() => {
  clearAsgardeoTokenSource();
});

describe("AuthGate", () => {
  it("blocks the app and offers sign-in when there is no session", async () => {
    render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    expect(screen.queryByText("the app")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("never signs in on its own — a redirect nobody asked for is indistinguishable from a broken app", () => {
    render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    expect(signIn).not.toHaveBeenCalled();
  });

  it("renders the app once authenticated, and registers the token source for the API client", async () => {
    authState = { isAuthenticated: true, isLoading: false };
    render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    expect(screen.getByText("the app")).toBeInTheDocument();
    await waitFor(async () => {
      expect(await createAsgardeoTokenGetter()()).toBe("real-token");
    });
  });

  it("completes the code exchange on the callback path, then leaves it by real navigation", async () => {
    const replace = setLocation("http://localhost:5173/auth/callback?code=abc123&state=xyz");
    render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    expect(screen.getByText("Signing you in…")).toBeInTheDocument();
    await waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(1);
    });
    // A real navigation, not replaceState — the router is built at module
    // scope and would otherwise still be resolving the callback path.
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  it("does not exchange a code twice, because the code is single-use and StrictMode double-mounts", async () => {
    setLocation("http://localhost:5173/auth/callback?code=abc123");
    const { rerender } = render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );
    rerender(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledTimes(1);
    });
  });

  it("leaves the callback path rather than 404ing when already authenticated (a refresh, or a second tab)", async () => {
    authState = { isAuthenticated: true, isLoading: false };
    const replace = setLocation("http://localhost:5173/auth/callback");
    render(
      <AuthGate>
        <p>the app</p>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
    });
    expect(signIn).not.toHaveBeenCalled();
  });
});
