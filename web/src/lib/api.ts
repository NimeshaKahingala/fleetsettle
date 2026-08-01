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

  constructor(status: number, code: ErrorCode, message: string, requestId: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
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
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  };
}
