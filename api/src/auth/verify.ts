import { createLocalJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import { InvalidTokenError, MissingTokenError } from "../errors/app-error.js";
import { getJwks } from "./jwks.js";

const BEARER = /^Bearer (.+)$/;

/** Every protected route needs a Bearer access token (IG §7.1 rule 2). */
export function extractBearerToken(authorizationHeader: string | undefined): string {
  const match = authorizationHeader !== undefined ? BEARER.exec(authorizationHeader) : null;
  const token = match?.[1];
  if (!token) throw new MissingTokenError();
  return token;
}

interface VerifyDeps {
  KV: KVNamespace;
  ASGARDEO_JWKS_URL: string;
  ASGARDEO_ISSUER: string;
  ASGARDEO_AUDIENCE: string;
}

/**
 * IG §7.1: `jwtVerify` against JWKS cached in KV, refetching once on a `kid`
 * that isn't in the cached set (a key rotation, not necessarily a forged
 * token) before giving up. Every other failure — bad signature, wrong
 * issuer/audience, expired — is one undifferentiated 401: none of those
 * distinctions are the caller's to learn from the error message (IG §10.6).
 */
export async function verifyAccessToken(token: string, env: VerifyDeps): Promise<JWTPayload> {
  const verifyWith = async (jwks: Awaited<ReturnType<typeof getJwks>>) => {
    const getKey = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, getKey, {
      issuer: env.ASGARDEO_ISSUER,
      audience: env.ASGARDEO_AUDIENCE,
    });
    return payload;
  };

  try {
    const jwks = await getJwks(env.KV, env.ASGARDEO_JWKS_URL);
    return await verifyWith(jwks);
  } catch (err) {
    if (err instanceof errors.JWKSNoMatchingKey) {
      try {
        const fresh = await getJwks(env.KV, env.ASGARDEO_JWKS_URL, { forceRefresh: true });
        return await verifyWith(fresh);
      } catch {
        throw new InvalidTokenError();
      }
    }
    throw new InvalidTokenError();
  }
}
