import type { ErrorBody, ErrorCode } from "@fleetsettle/shared";

/**
 * §12.1: "the token getter is injected rather than imported, so the API
 * layer never depends on the auth SDK directly" — this is the whole point
 * of P1's Asgardeo decision being reversible on this side too. Nothing
 * here imports `@asgardeo/auth-react`.
 */
export type TokenGetter = () => Promise<string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string;
  /** GAP-44: the first error `details` a client actually reads — untyped here (the base wire shape), narrowed by the caller against the specific `code` it already checked (`VehicleDoubleBookedDetails`, for `VEHICLE_DOUBLE_BOOKED`). */
  readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    requestId: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface BlobResponse {
  blob: Blob;
  contentType: string;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  /** A7/GAP-16: the image is the request body, not JSON — `postBinary` sets the caller's own `Content-Type` and expects the usual JSON metadata response back. */
  postBinary<T>(path: string, blob: Blob, contentType: string): Promise<T>;
  /** Fetches an attachment's bytes through the Worker — never a public or presigned URL (A7's plan, decisions 1-2), so this always carries the bearer token. */
  getBlob(path: string): Promise<BlobResponse>;
}

/**
 * The client never talks to the database (§12.1) — every read and write
 * goes through this, to the Worker API. Retrying a request whose token
 * expired mid-flight, and pausing/resuming the offline mutation queue on a
 * 401, is M-12's job (P12) — this client only does the one request it was
 * asked for.
 */
export function createApiClient(baseUrl: string, getToken: TokenGetter): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
      throw new ApiError(
        res.status,
        body?.code ?? "INTERNAL_ERROR",
        body?.error ?? res.statusText,
        body?.requestId ?? "",
        body?.details,
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * `request<T>()`'s own error handling, for a blob body instead of a JSON
   * one — the two response shapes can't share one code path (`res.json()`
   * and `res.blob()` each consume the body once, and only one applies).
   */
  async function requestBlob(path: string): Promise<BlobResponse> {
    const token = await getToken();
    const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;
      throw new ApiError(
        res.status,
        body?.code ?? "INTERNAL_ERROR",
        body?.error ?? res.statusText,
        body?.requestId ?? "",
        body?.details,
      );
    }

    const blob = await res.blob();
    return { blob, contentType: res.headers.get("content-type") ?? blob.type };
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
    // The default header block sets Content-Type: application/json before
    // spreading init?.headers, so this override lands last and wins — the
    // JSON default is never actually sent for a binary body.
    postBinary: <T>(path: string, blob: Blob, contentType: string) =>
      request<T>(path, { method: "POST", body: blob, headers: { "Content-Type": contentType } }),
    getBlob: (path: string) => requestBlob(path),
  };
}
