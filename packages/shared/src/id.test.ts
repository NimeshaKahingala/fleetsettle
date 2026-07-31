import { describe, expect, it } from "vitest";
import { newId } from "./id.js";

describe("newId", () => {
  it("returns distinct ids", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is time-ordered — the point of choosing v7 over v4 (DM §2)", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("is a valid UUID, version 7", () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
