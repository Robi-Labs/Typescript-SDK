export class RobiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConnectionError extends RobiError {}
export class TimeoutError extends ConnectionError {}

export class APIError extends RobiError {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
    readonly requestId?: string | null,
    /** Machine-readable code, when the API sends `detail` as an object (e.g. `model_deprecated`). */
    readonly code?: string,
    readonly type?: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
/** 402: no credit, or monthly spend limit reached. Not retryable. */
export class PaymentRequiredError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class PayloadTooLargeError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

interface Parsed { message: string; code?: string; type?: string }

/** Robi errors carry `detail` as a string or `{message,type,code}`; `error` is accepted as a fallback. */
export function parseDetail(body: unknown): Parsed | undefined {
  const b = body as { detail?: unknown; error?: unknown } | undefined;
  const d = b?.detail ?? b?.error;
  if (typeof d === "string") return { message: d };
  if (d && typeof d === "object") {
    const o = d as { message?: unknown; type?: unknown; code?: unknown };
    if (typeof o.message === "string")
      return { message: o.message, code: o.code != null ? String(o.code) : undefined, type: typeof o.type === "string" ? o.type : undefined };
  }
  if (Array.isArray(d)) return { message: JSON.stringify(d) }; // 422 validation list
  return undefined;
}

export function errorFor(status: number, body: unknown, requestId: string | null): APIError {
  const p = parseDetail(body);
  const Cls =
    status === 400 || status === 422 ? BadRequestError
    : status === 401 ? AuthenticationError
    : status === 402 ? PaymentRequiredError
    : status === 403 ? PermissionDeniedError
    : status === 404 ? NotFoundError
    : status === 413 ? PayloadTooLargeError
    : status === 429 ? RateLimitError
    : status >= 500 ? InternalServerError
    : APIError;
  return new Cls(p?.message ?? `Request failed with status ${status}`, status, body, requestId, p?.code, p?.type);
}
