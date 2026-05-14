// Maps API errors raised by create-form POSTs into per-field inline errors
// + an optional global message, matching spec §6 line 327:
//   "Create (sub-entity). … 409 (slug collision in same parent) → inline error
//    on the slug field. 422 → inline."
//
// Why a helper rather than inline mapping in each create flow: the three
// editor create flows (VersionEditPage createBlock, BlockAccordion
// createSequence, SequenceAccordion createItem) all need the same shape,
// and a copy-pasted mapper would drift. Pure function — no runes — so
// it's trivially unit-testable in isolation.
//
// Behavior:
//   - 422: walk `validationErrors()`, key each entry by its last `loc` segment
//     (FastAPI / Pydantic shape). Entries whose key is in `knownFields` land
//     in `fieldErrors`; others fall into `globalMessage` joined by `; `.
//   - 409: if the body message mentions "slug" (case-insensitive), set
//     `fieldErrors.slug = displayMessage`; otherwise `globalMessage`.
//   - All other errors: `globalMessage = displayMessage` (or 'Save failed').

import { ApiError } from './api';

export type FieldErrors = Record<string, string>;
export type CreateError = { fieldErrors: FieldErrors; globalMessage: string | null };

export function mapCreateError(e: unknown, knownFields: readonly string[]): CreateError {
  if (e instanceof ApiError) {
    if (e.status === 422) {
      const details = e.validationErrors();
      if (!details || details.length === 0) {
        return { fieldErrors: {}, globalMessage: e.displayMessage };
      }
      const fieldErrors: FieldErrors = {};
      const unmapped: string[] = [];
      for (const d of details) {
        // FastAPI loc shape: ['body', 'slug'] or ['body', 'options', 0, 'value'].
        // We key by the last string segment — for create forms that's the
        // top-level field. Numeric indices are ignored (they'd indicate a
        // nested structure no create form currently exposes; future nested
        // forms can extend `knownFields` to include nested paths).
        const key = [...d.loc].reverse().find((seg) => typeof seg === 'string');
        if (typeof key === 'string' && knownFields.includes(key)) {
          fieldErrors[key] = d.msg;
        } else {
          unmapped.push(d.msg);
        }
      }
      const globalMessage = unmapped.length > 0 ? unmapped.join('; ') : null;
      return { fieldErrors, globalMessage };
    }
    if (e.status === 409 && /slug/i.test(typeof e.detail === 'string' ? e.detail : '')) {
      return { fieldErrors: { slug: e.displayMessage }, globalMessage: null };
    }
    return { fieldErrors: {}, globalMessage: e.displayMessage };
  }
  return { fieldErrors: {}, globalMessage: 'Save failed' };
}
