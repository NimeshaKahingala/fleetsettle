import { describe, expect, test } from "vitest";
import { cn } from "./cn.js";

/**
 * tailwind-merge's default theme scale doesn't know FleetSettle's custom
 * font-size names — without the `theme.text` extension in cn.ts, a size
 * utility like `text-body` is misclassified into the *text-color* group and
 * silently dropped the moment a real colour class (`text-ink-primary`) sits
 * next to it. This test exists so that regression is loud, not quiet.
 */
describe("cn()", () => {
  test("a custom font-size token survives next to a custom colour token", () => {
    expect(cn("text-body", "text-ink-primary")).toBe("text-body text-ink-primary");
    expect(cn("text-title", "text-critical")).toBe("text-title text-critical");
  });

  test("a custom spacing token (tap) still participates in height conflict resolution", () => {
    expect(cn("min-h-tap", "min-h-20")).toBe("min-h-20");
  });

  test("still resolves a genuine conflict between two real colour utilities", () => {
    expect(cn("text-ink-primary", "text-critical")).toBe("text-critical");
  });
});
