import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * `public/_headers` is applied by Cloudflare and by nothing else — not
 * `vite dev`, not `vite preview`, not Playwright against either. So a CSP that
 * blocks sign-in fails **only** in QA and production, on a real login, with a
 * console error no test run would ever print. That is the whole reason this
 * file exists: it is the one place the policy can be checked before it ships.
 *
 * Read via fs rather than imported, for the same reason `tokens.test.ts` does:
 * the asset is the artefact, and a bundler transform between it and the
 * assertion would be a second thing that could disagree.
 */
const headers = readFileSync(join(import.meta.dirname, "../../public/_headers"), "utf8");

const csp =
  /^\s*Content-Security-Policy:\s*(.+)$/m.exec(headers)?.[1] ??
  (() => {
    throw new Error("No Content-Security-Policy line in public/_headers");
  })();

function directive(name: string): string {
  const match = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp);
  if (!match?.[1]) throw new Error(`No ${name} directive in the CSP`);
  return match[1].trim();
}

describe("the deployed Content-Security-Policy", () => {
  test("lets the auth SDK reach Asgardeo, or sign-in fails in QA and production only (B8)", () => {
    expect(directive("connect-src")).toContain("https://api.asgardeo.io");
  });

  test("still restricts connect-src — 'self' plus Asgardeo, and nothing wider", () => {
    const sources = directive("connect-src").split(/\s+/);
    expect(sources).toEqual(["'self'", "https://api.asgardeo.io"]);
    expect(sources).not.toContain("*");
  });

  test("needs no entry for the API, which is same-origin by routing (fleetsettle.com/api/*)", () => {
    // If this ever fails, the API moved to its own hostname — which also means
    // it now needs CORS. Both, or neither.
    expect(directive("connect-src")).toContain("'self'");
  });

  test("keeps the protections IG §10.9 asked for", () => {
    expect(directive("frame-ancestors")).toBe("'none'");
    expect(directive("default-src")).toBe("'self'");
    expect(directive("script-src")).toBe("'self'");
    expect(csp).not.toContain("unsafe-eval");
  });
});
