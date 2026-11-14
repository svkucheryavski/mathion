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

/** Polish 3: what a write that never reached the server (a fetch TypeError) says. */
export const OFFLINE_MESSAGE = 'Could not reach server. Check your connection.';

/** A failed write's sentence: the server's, OFFLINE_MESSAGE for a fetch TypeError, else `fallback`. */
export function failureText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.displayMessage;
  return e instanceof TypeError ? OFFLINE_MESSAGE : fallback;
}

/** What a 5xx with no sentence of its own (a crash's plain-text page, a
 *  proxy's 502) says, never the raw status text. */
export const SERVER_ERROR_MESSAGE = 'Something went wrong on the server. Try again.';

/** What a 4xx with no sentence and no status text (HTTP/2 has none) says,
 *  never a blank line. */
export const REQUEST_ERROR_MESSAGE = 'Something went wrong. Try again.';

/** A non-2xx answer's detail: the server's own (an empty one is none), else
 *  the server sentence for a 5xx, else `fallback`. */
export function errorDetail(res: Response, body: unknown, fallback: string): string | ValidationErrorDetail[] {
  return (body as { detail?: string | ValidationErrorDetail[] | null } | undefined)?.detail
    || (res.status >= 500 ? SERVER_ERROR_MESSAGE : fallback);
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
    const detail = errorDetail(res, parsedBody, res.statusText || REQUEST_ERROR_MESSAGE);
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
  put: <T>(path: string, body: unknown, opts?: RequestOpts) =>
    request<T>(path, {
      ...opts,
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    }),
  delete: (path: string, opts?: RequestOpts) =>
    request<void>(path, { ...opts, method: 'DELETE' }),
  /** A multipart POST; no Content-Type, so the browser sets the boundary. */
  postForm: <T>(path: string, form: FormData, opts?: RequestOpts) =>
    request<T>(path, { ...opts, method: 'POST', body: form }),
};
