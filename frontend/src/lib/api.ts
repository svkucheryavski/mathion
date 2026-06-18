import type { ValidationErrorDetail } from './types';
import { emitUnauthorized } from './events';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string | ValidationErrorDetail[],
    public readonly errorCode?: string,
    // Raw parsed JSON body from the non-2xx response (when the response had a
    // JSON content-type and parsed cleanly). Carries extra structured fields
    // like `conflicts` for 409 publish flows so callers can narrow at the
    // access site under strict TS. Stays `undefined` when the body wasn't JSON
    // (HTML error page, truncated payload) so callers can branch on presence
    // without distinguishing parse-failure from empty-body.
    public readonly body?: unknown,
  ) {
    super(typeof detail === 'string' ? detail : 'Validation error');
    this.name = 'ApiError';
  }

  /** Always-string message for toasts/panels. */
  get displayMessage(): string {
    return typeof this.detail === 'string'
      ? this.detail
      : 'Please correct the highlighted fields.';
  }

  /** Returns per-field validation errors on 422, null otherwise. */
  validationErrors(): ValidationErrorDetail[] | null {
    return Array.isArray(this.detail) ? this.detail : null;
  }
}

export type RequestOpts = RequestInit & { skipAuthRedirect?: boolean };

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { skipAuthRedirect, headers: callerHeaders, ...init } = opts;
  // Build via Headers class so X-Requested-With is set LAST and wins over any
  // caller-provided value (a regression in an earlier revision had spread
  // order reversed, allowing caller clobber).
  const headers = new Headers(callerHeaders ?? {});
  headers.set('X-Requested-With', 'mathion');

  const res = await fetch(path, { credentials: 'include', ...init, headers });

  if (res.status === 401 && !skipAuthRedirect) {
    // Preserve hash so e.g. /courses/foo/seq/12#item=87 survives the bounce.
    emitUnauthorized(location.pathname + location.search + location.hash);
    throw new ApiError(401, 'Not authenticated');
  }
  if (!res.ok) {
    let parsedBody: unknown = undefined;
    try {
      parsedBody = await res.json();
    } catch {
      // Non-JSON response (HTML error page, truncated payload) — body stays
      // undefined so callers can branch on presence without distinguishing
      // parse-failure from empty-body.
    }
    const detail = (parsedBody as { detail?: string } | undefined)?.detail ?? res.statusText;
    const errorCode = (parsedBody as { error_code?: string } | undefined)?.error_code;
    throw new ApiError(res.status, detail, errorCode, parsedBody);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const api = {
  get: <T>(path: string, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOpts) =>
    request<T>(path, {
      ...opts,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    }),
  patch: <T>(path: string, body: unknown, opts?: RequestOpts) =>
    request<T>(path, {
      ...opts,
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    }),
  delete: (path: string, opts?: RequestOpts) =>
    request<void>(path, { ...opts, method: 'DELETE' }),
};
