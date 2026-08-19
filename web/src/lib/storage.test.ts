import { beforeEach, expect, test } from "vitest";
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
