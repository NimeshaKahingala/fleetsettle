import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  SELECTED_BUSINESS_ID_KEY,
  clearSelectedBusinessId,
  getSelectedBusinessId,
  setSelectedBusinessId,
} from "./storage.js";

beforeEach(() => {
  localStorage.clear();
});

test("returns null when nothing has ever been selected", () => {
  expect(getSelectedBusinessId()).toBeNull();
});

test("setSelectedBusinessId persists under the dot-namespaced key, and getSelectedBusinessId reads it back", () => {
  setSelectedBusinessId("b1");
  expect(localStorage.getItem(SELECTED_BUSINESS_ID_KEY)).toBe("b1");
  expect(getSelectedBusinessId()).toBe("b1");
});

test("getSelectedBusinessId is a live read, not a cached one — a write in between is seen immediately", () => {
  expect(getSelectedBusinessId()).toBeNull();
  setSelectedBusinessId("b1");
  expect(getSelectedBusinessId()).toBe("b1");
  setSelectedBusinessId("b2");
  expect(getSelectedBusinessId()).toBe("b2");
});

test("clearSelectedBusinessId removes the key entirely, not just blanks it", () => {
  setSelectedBusinessId("b1");
  clearSelectedBusinessId();
  expect(getSelectedBusinessId()).toBeNull();
  expect(localStorage.getItem(SELECTED_BUSINESS_ID_KEY)).toBeNull();
});

// Fixes a review finding on PR #76 (gitar-bot): a storage-blocked
// environment (historically Safari private mode; any "block all site
// data" setting) throws a SecurityError on every localStorage access —
// and getSelectedBusinessId runs synchronously inside every single API
// request via api.ts's BusinessIdGetter, so an unguarded throw here would
// have failed every request in that environment, not just the switcher.
const SECURITY_ERROR = new DOMException("access denied", "SecurityError");

test("getSelectedBusinessId degrades to null when storage throws, rather than propagating", () => {
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw SECURITY_ERROR;
  });
  expect(() => getSelectedBusinessId()).not.toThrow();
  expect(getSelectedBusinessId()).toBeNull();
  spy.mockRestore();
});

test("setSelectedBusinessId and clearSelectedBusinessId no-op when storage throws, rather than propagating", () => {
  const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw SECURITY_ERROR;
  });
  expect(() => setSelectedBusinessId("b1")).not.toThrow();
  setSpy.mockRestore();

  const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw SECURITY_ERROR;
  });
  expect(() => clearSelectedBusinessId()).not.toThrow();
  removeSpy.mockRestore();
});

afterEach(() => {
  vi.restoreAllMocks();
});
