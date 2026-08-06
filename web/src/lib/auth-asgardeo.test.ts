import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_CALLBACK_PATH,
  asgardeoConfig,
  clearAsgardeoTokenSource,
  createAsgardeoTokenGetter,
  registerAsgardeoTokenSource,
} from "./auth-asgardeo.js";

afterEach(() => {
  clearAsgardeoTokenSource();
  vi.unstubAllEnvs();
});

describe("asgardeoConfig", () => {
  it("derives the redirect URL from the origin it is given, so the hostname is typed once", () => {
    vi.stubEnv("VITE_ASGARDEO_CLIENT_ID", "test-client-id");
    vi.stubEnv("VITE_ASGARDEO_BASE_URL", "https://api.asgardeo.io/t/fleetsettle");

    expect(asgardeoConfig("https://qa.fleetsettle.com")).toMatchObject({
      signInRedirectURL: `https://qa.fleetsettle.com${AUTH_CALLBACK_PATH}`,
      signOutRedirectURL: "https://qa.fleetsettle.com",
      clientID: "test-client-id",
    });
  });

  it("keeps PKCE on — the client id is public, so it is the only thing protecting the code exchange", () => {
    vi.stubEnv("VITE_ASGARDEO_CLIENT_ID", "test-client-id");
    vi.stubEnv("VITE_ASGARDEO_BASE_URL", "https://api.asgardeo.io/t/fleetsettle");

    expect(asgardeoConfig("http://localhost:5173").enablePKCE).toBe(true);
  });

  it("requests openid, because the Worker resolves the business from the sub claim", () => {
    vi.stubEnv("VITE_ASGARDEO_CLIENT_ID", "test-client-id");
    vi.stubEnv("VITE_ASGARDEO_BASE_URL", "https://api.asgardeo.io/t/fleetsettle");

    expect(asgardeoConfig("http://localhost:5173").scope).toContain("openid");
  });

  it("throws naming the variable when config is missing, rather than building a half-valid client", () => {
    vi.stubEnv("VITE_ASGARDEO_CLIENT_ID", "");
    vi.stubEnv("VITE_ASGARDEO_BASE_URL", "https://api.asgardeo.io/t/fleetsettle");

    expect(() => asgardeoConfig("http://localhost:5173")).toThrow("VITE_ASGARDEO_CLIENT_ID");
  });
});

describe("the token getter", () => {
  it("asks the SDK on every call, so a refreshed token reaches the next request (M-12)", async () => {
    const getToken = createAsgardeoTokenGetter();
    const source = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    registerAsgardeoTokenSource(source);

    expect(await getToken()).toBe("first");
    expect(await getToken()).toBe("second");
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("throws a named error when a request is issued before the gate mounted", async () => {
    const getToken = createAsgardeoTokenGetter();
    await expect(getToken()).rejects.toThrow("not registered");
  });
});
