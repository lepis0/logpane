export const API_BASE_PATH = "/api/v1";

export class ApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** True for "backend unreachable" style failures (network/DNS/refused), as opposed to a real HTTP error status. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

type QueryValue = string | number | boolean | undefined;

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, QueryValue>;
}

function buildPath(path: string, query?: Record<string, QueryValue>): string {
  const base = `${API_BASE_PATH}${path}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;
  const init: RequestInit = {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildPath(path, query), init);
  } catch (err) {
    // fetch() itself threw: backend unreachable, offline, DNS failure, etc.
    throw new ApiError(
      err instanceof Error ? err.message : "Network request failed",
      0,
      undefined,
    );
  }

  if (!response.ok) {
    let message = response.statusText || `Request failed with status ${response.status}`;
    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
      if (parsedBody && typeof parsedBody === "object" && "message" in parsedBody) {
        const m = (parsedBody as { message?: unknown }).message;
        if (typeof m === "string" && m.trim()) message = m;
      }
    } catch {
      // No/invalid JSON body - fall back to the status text message above.
    }
    throw new ApiError(message, response.status, parsedBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
