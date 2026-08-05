import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JSONWebKeySet } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KV_KEY } from "./jwks.js";
import { verifyAccessToken } from "./verify.js";

const ISSUER = "https://issuer.example";
const AUDIENCE = "test-aud";
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

async function keypair(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk["alg"] = "ES256";
  jwk["kid"] = kid;
  const jwks: JSONWebKeySet = { keys: [jwk] };
  return { privateKey, jwks };
}

async function sign(
  privateKey: unknown,
  kid: string,
  claims: { sub?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(claims.sub ?? "test-sub")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey as CryptoKey);
}

describe("verifyAccessToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies a token against a warm cache with no network call", async () => {
    const { privateKey, jwks } = await keypair("k1");
    const token = await sign(privateKey, "k1", { sub: "alice" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(jwks) });

    const payload = await verifyAccessToken(token, {
      KV: kv,
      ASGARDEO_JWKS_URL: JWKS_URL,
      ASGARDEO_ISSUER: ISSUER,
      ASGARDEO_AUDIENCE: AUDIENCE,
    });

    expect(payload.sub).toBe("alice");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refetches once on a kid the cached JWKS does not have — a key rotation, not a forgery", async () => {
    const old = await keypair("old-key");
    const fresh = await keypair("new-key");
    const token = await sign(fresh.privateKey, "new-key", { sub: "bob" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(fresh.jwks)));
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(old.jwks) });

    const payload = await verifyAccessToken(token, {
      KV: kv,
      ASGARDEO_JWKS_URL: JWKS_URL,
      ASGARDEO_ISSUER: ISSUER,
      ASGARDEO_AUDIENCE: AUDIENCE,
    });

    expect(payload.sub).toBe("bob");
  });

  it("rejects a token whose kid is in neither the cache nor a fresh fetch", async () => {
    const cached = await keypair("k1");
    const forged = await keypair("forged");
    const token = await sign(forged.privateKey, "forged", { sub: "mallory" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(cached.jwks)));
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(cached.jwks) });

    await expect(
      verifyAccessToken(token, {
        KV: kv,
        ASGARDEO_JWKS_URL: JWKS_URL,
        ASGARDEO_ISSUER: ISSUER,
        ASGARDEO_AUDIENCE: AUDIENCE,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects a validly-signed token with the wrong issuer", async () => {
    const { privateKey, jwks } = await keypair("k1");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject("carol")
      .setIssuer("https://not-the-real-issuer.example")
      .setAudience(AUDIENCE)
      .setExpirationTime("1h")
      .sign(privateKey);
    const kv = fakeKV({ [KV_KEY]: JSON.stringify(jwks) });

    await expect(
      verifyAccessToken(token, {
        KV: kv,
        ASGARDEO_JWKS_URL: JWKS_URL,
        ASGARDEO_ISSUER: ISSUER,
        ASGARDEO_AUDIENCE: AUDIENCE,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});
