import { exportJWK, generateKeyPair, type JSONWebKeySet } from "jose";

// IG §8.1: "Mocks the verifier" — a real keypair signs real JWTs shaped like
// Asgardeo's, verified by the real `jwtVerify` call in auth/verify.ts. Only
// the IdP is faked; nothing about verification is.
const ALG = "ES256";
export const TEST_KID = "test-key-1";

const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });

const publicJwk = await exportJWK(publicKey);
publicJwk["alg"] = ALG;
publicJwk["use"] = "sig";
publicJwk["kid"] = TEST_KID;

/** Seed a fake KV with this (support/env.ts) so verify.ts never needs the network. */
export const TEST_JWKS: JSONWebKeySet = { keys: [publicJwk] };

export const TEST_SIGNING_KEY = privateKey;
export const TEST_ALG = ALG;
