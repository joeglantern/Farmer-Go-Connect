/** The API's one error shape: `{ error: { code, message, requestId?, details? } }`. */
export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
}

/** Codes the SDK itself produces (the API never sends these). */
export const SDK_ERROR_CODES = {
  /** fetch rejected: no connection, DNS failure, connection reset. */
  NETWORK: 'NETWORK',
  /** The request exceeded `timeoutMs`. */
  TIMEOUT: 'TIMEOUT',
  /** The response was not JSON in the API's error shape. */
  BAD_RESPONSE: 'BAD_RESPONSE',
} as const;

/**
 * Every failure thrown by the SDK. `status` is the HTTP status, or 0 when the request never
 * reached the server (`NETWORK`, `TIMEOUT`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }

  /** True when the request never got a response from the API. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** True when the same request may succeed later without changes (offline outbox uses this). */
  get retryable(): boolean {
    if (this.status === 0) return true;
    if (this.status >= 500) return true;
    if (this.status === 408 || this.status === 429) return true;
    // A repeat while the first attempt is still running on the server.
    if (this.status === 409 && this.code === 'IDEMPOTENCY_IN_PROGRESS') return true;
    return false;
  }

  /** Field-level issues from `VALIDATION_ERROR`, as `{ path, message }`, or an empty list. */
  get issues(): { path?: string; message: string }[] {
    const d = this.details as { issues?: { path?: string; message: string }[] } | undefined;
    return Array.isArray(d?.issues) ? d.issues : [];
  }

  static is(err: unknown): err is ApiError {
    return err instanceof ApiError || (err as { name?: string } | null)?.name === 'ApiError';
  }

  /** Build from a parsed response body; falls back to a generic message for unknown shapes. */
  static fromResponse(status: number, body: unknown, requestId?: string): ApiError {
    const wrapped = (body as Partial<ApiErrorBody> | null)?.error;
    if (wrapped && typeof wrapped === 'object' && typeof wrapped.code === 'string') {
      return new ApiError({
        status,
        code: wrapped.code,
        message: wrapped.message ?? `Request failed with status ${status}`,
        requestId: wrapped.requestId ?? requestId,
        details: wrapped.details,
      });
    }
    // Better Auth (/api/auth/*) answers `{ code?, message }` without the wrapper.
    const flat = body as { code?: string; message?: string } | null;
    if (flat && typeof flat === 'object' && typeof flat.message === 'string') {
      return new ApiError({
        status,
        code: typeof flat.code === 'string' && flat.code ? flat.code : httpCode(status),
        message: flat.message,
        requestId,
      });
    }
    return new ApiError({
      status,
      code: httpCode(status),
      message: typeof body === 'string' && body ? body : `Request failed with status ${status}`,
      requestId,
    });
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'HTTP_ERROR';
  }
}
