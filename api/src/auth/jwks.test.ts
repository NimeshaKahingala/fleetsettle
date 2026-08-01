import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJwks, KV_KEY } from "./jwks.js";

const JWKS_URL = "https://issuer.example/jwks";

function fakeKV(seed?: Record<string, string>): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get: ((key: string, type?: unknown) => {
      const raw = store.get(key);
      if (raw === undefined) return Promise.resolve(null);
      return Promise.resolve(type === "json" ? (JSON.parse(raw) as unknown) : raw);
    }) as KVNamespace["get"],
    put: ((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }) as KVNamespace["put"],
  } as unknown as KVNamespace;
}

const A_JWKS = { keys: [{ kty: "EC", kid: "a" }] };
const B_JWKS = { keys: [{ kty: "EC", kid: "b" }] };

describe("getJwks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches over the network on a cache miss, and caches the result", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(A_JWKS)));
    const kv = fakeKV();

    const jwks = await getJwks(kv, JWKS_URL);

    expect(jwks).toEqual(A_JWKS);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(JWKS_URL);
    await expect(kv.get(KV_KEY, "json")).resolves.toEqual(A_JWKS);
  });

  it("does not touch the network on a cache hit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(A_JWKS) });

    const jwks = await getJwks(kv, JWKS_URL);

    expect(jwks).toEqual(A_JWKS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forceRefresh bypasses the cache even when one exists", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(B_JWKS)));
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(A_JWKS) });

    const jwks = await getJwks(kv, JWKS_URL, { forceRefresh: true });

    expect(jwks).toEqual(B_JWKS);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(JWKS_URL);
  });

  it("throws when the JWKS endpoint does not respond ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const kv = fakeKV();

    await expect(getJwks(kv, JWKS_URL)).rejects.toThrow(/JWKS fetch failed/);
  });
});
