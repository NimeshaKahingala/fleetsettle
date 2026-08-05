import { afterEach, expect, test, vi } from "vitest";
import { ApiError, createApiClient } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("attaches a freshly-fetched token to every request, never a captured one", async () => {
  const getToken = vi.fn().mockResolvedValue("token-1");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", getToken);
  await client.get("/api/vehicle");

  expect(getToken).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.example/api/vehicle");
  expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-1");
});

test("POST/PUT/PATCH send a JSON body with the right method", async () => {
  // A fresh Response per call — reusing one instance across calls throws on
  // the second `.json()`, since reading a Response's body consumes it.
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ id: "1" }), { status: 201 })),
    );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", () => Promise.resolve("t"));
  await client.post("/api/vehicle", { registration: "CAB-1234" });
  await client.put("/api/vehicle/1", { registration: "CAB-5678" });
  await client.patch("/api/lease/1/renew", { endDate: "2027-01-01" });

  const [, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(postInit.method).toBe("POST");
  expect(postInit.body).toBe(JSON.stringify({ registration: "CAB-1234" }));

  const [, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect(putInit.method).toBe("PUT");
  expect(putInit.body).toBe(JSON.stringify({ registration: "CAB-5678" }));

  const [, patchInit] = fetchMock.mock.calls[2] as [string, RequestInit];
  expect(patchInit.method).toBe("PATCH");
  expect(patchInit.body).toBe(JSON.stringify({ endDate: "2027-01-01" }));
});

test("a non-ok response throws an ApiError carrying the Worker's error shape", async () => {
  const errorBody = {
    error: "No such vehicle in this business",
    code: "NOT_FOUND",
    requestId: "r-1",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", () => Promise.resolve("t"));

  await expect(client.get("/api/vehicle/x")).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
    message: "No such vehicle in this business",
  });
});

test("ApiError is a real Error subclass", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: "nope", code: "VALIDATION_ERROR" }), { status: 400 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", () => Promise.resolve("t"));
  try {
    await client.get("/api/x");
    throw new Error("expected rejection");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
  }
});
