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

  const client = createApiClient("https://api.example", getToken, () => null);
  await client.get("/api/vehicle");

  expect(getToken).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.example/api/vehicle");
  expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-1");
});

test("decision 23: attaches X-Business-Id when getBusinessId() returns a selection", async () => {
  const getBusinessId = vi.fn().mockReturnValue("b1");
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", () => Promise.resolve("t"), getBusinessId);
  await client.get("/api/vehicle");

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)["X-Business-Id"]).toBe("b1");
});

test("IG §7.5 step 4a: omits X-Business-Id entirely when getBusinessId() returns null — a single-membership identity, or one who hasn't picked yet, matches authMiddleware's own no-header resolution", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );
  await client.get("/api/vehicle");

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect("X-Business-Id" in (init.headers as Record<string, string>)).toBe(false);
});

test("getBusinessId is read fresh on every request, never a value captured at construction", async () => {
  let current = "b1";
  const getBusinessId = () => current;
  const fetchMock = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient("https://api.example", () => Promise.resolve("t"), getBusinessId);
  await client.get("/api/vehicle");
  current = "b2";
  await client.get("/api/vehicle");

  const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
  const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
  expect((firstInit.headers as Record<string, string>)["X-Business-Id"]).toBe("b1");
  expect((secondInit.headers as Record<string, string>)["X-Business-Id"]).toBe("b2");
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

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );
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

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );

  await expect(client.get("/api/vehicle/x")).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
    message: "No such vehicle in this business",
  });
});

test("GAP-44: a non-ok response's details reach the thrown ApiError, not just its message and code", async () => {
  const details = { conflict: { sourceType: "trip" }, nextFreeFrom: "2026-05-13" };
  const errorBody = {
    error: "This vehicle is already allocated for one or more of these dates",
    code: "VEHICLE_DOUBLE_BOOKED",
    requestId: "r-3",
    details,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 409 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );

  await expect(client.post("/api/trip", {})).rejects.toMatchObject({
    status: 409,
    code: "VEHICLE_DOUBLE_BOOKED",
    details,
  });
});

test("postBinary sends the caller's own Content-Type, not the JSON default", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: "att-1" }), { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );
  const blob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });
  await client.postBinary("/api/attachment?id=1", blob, "image/jpeg");

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.example/api/attachment?id=1");
  expect(init.method).toBe("POST");
  expect(init.body).toBe(blob);
  expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
  expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer t");
});

test("open question 8/decision 23: getBlob carries X-Business-Id too — requestBlob builds its own header object independently of request(), so this is not covered for free by the get()/post() tests above", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("fake-jpeg-bytes", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => "b1",
  );
  await client.getBlob("/api/attachment/1");

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)["X-Business-Id"]).toBe("b1");
});

test("getBlob omits X-Business-Id when getBusinessId() returns null, same as request()", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("fake-jpeg-bytes", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );
  await client.getBlob("/api/attachment/1");

  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect("X-Business-Id" in (init.headers as Record<string, string>)).toBe(false);
});

test("getBlob returns the bytes and content type, carrying the bearer token", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("fake-jpeg-bytes", {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("token-1"),
    () => null,
  );
  const result = await client.getBlob("/api/attachment/1");

  expect(result.contentType).toBe("image/jpeg");
  expect(result.blob.size).toBeGreaterThan(0);
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer token-1");
});

test("getBlob throws an ApiError from the JSON error body on a non-ok response", async () => {
  const errorBody = {
    error: "No such attachment in this business",
    code: "NOT_FOUND",
    requestId: "r-2",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );

  await expect(client.getBlob("/api/attachment/x")).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
    message: "No such attachment in this business",
  });
});

test("ApiError is a real Error subclass", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: "nope", code: "VALIDATION_ERROR" }), { status: 400 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const client = createApiClient(
    "https://api.example",
    () => Promise.resolve("t"),
    () => null,
  );
  try {
    await client.get("/api/x");
    throw new Error("expected rejection");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
  }
});
