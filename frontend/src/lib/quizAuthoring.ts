import { api } from './api';

export type QuestionType =
  | 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer';

export interface AuthoringOption {
  id: number; question_id: number; text: string; is_correct: boolean; order: number;
}

// Mirrors the flat QuestionResponse — options are NOT embedded (§3.4). Each
// QuestionAccordion fetches/owns its own options (Plan B), not via this type.
export interface AuthoringQuestion {
  id: number; item_id: number; text_md: string; text_html: string;
  type: QuestionType; order: number;
  explanation_md: string | null; explanation_html: string | null;
  correct_numeric: number | null;   // JSON number on the wire (float-safe subset)
  precision: number | null; correct_text: string | null;
}

export interface QuestionCreateBody {
  text_md: string; type: QuestionType;
  explanation_md?: string | null;
  correct_numeric?: number | null; precision?: number | null; correct_text?: string | null;
}
export interface QuestionUpdateBody {
  text_md?: string; explanation_md?: string | null;
  correct_numeric?: number | null; precision?: number | null; correct_text?: string | null;
}
export interface OptionCreateBody { text: string; is_correct: boolean; }
export interface OptionUpdateBody { text?: string; is_correct?: boolean; }
export interface OrderEntry { id: number; order: number; }

// ---- API wrappers (thin; errors propagate as ApiError from lib/api) ----
export const listQuestions = (itemId: number) =>
  api.get<AuthoringQuestion[]>(`/api/items/${itemId}/questions`);
export const createQuestion = (itemId: number, body: QuestionCreateBody) =>
  api.post<AuthoringQuestion>(`/api/items/${itemId}/questions`, body);
export const updateQuestion = (qid: number, body: QuestionUpdateBody) =>
  api.patch<AuthoringQuestion>(`/api/questions/${qid}`, body);
export const deleteQuestion = (qid: number) =>
  api.delete(`/api/questions/${qid}`);
export const reorderQuestions = (itemId: number, order: OrderEntry[]) =>
  api.post<void>(`/api/items/${itemId}/questions/reorder`, { order });

export const listOptions = (qid: number) =>
  api.get<AuthoringOption[]>(`/api/questions/${qid}/options`);
export const createOption = (qid: number, body: OptionCreateBody) =>
  api.post<AuthoringOption>(`/api/questions/${qid}/options`, body);
export const updateOption = (oid: number, body: OptionUpdateBody) =>
  api.patch<AuthoringOption>(`/api/options/${oid}`, body);
export const deleteOption = (oid: number) =>
  api.delete(`/api/options/${oid}`);
export const reorderOptions = (qid: number, order: OrderEntry[]) =>
  api.post<void>(`/api/questions/${qid}/options/reorder`, { order });

export const renameItem = (itemId: number, title: string) =>
  api.patch<{ id: number; title: string }>(`/api/items/${itemId}`, { title });

// ---- Numeric-answer validation (§8.3) ----
// Validate the EXPANDED scale, computed arithmetically — never materialize a
// huge string for an extreme exponent. Returns a canonical plain-decimal string
// (≤ 20 digits) safe to send, or a rejection reason for inline display.
export type NumericValidation =
  | { ok: true; canonical: string }
  | { ok: false; reason: string };

const NUMERIC_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export function validateNumericAnswer(input: string): NumericValidation {
  const raw = input.trim();
  if (raw === '') return { ok: false, reason: 'Enter a number.' };
  // Up-front sanity cap before any expansion (DoS guard for 1e-1000000000).
  if (raw.length > 40) return { ok: false, reason: 'Number is too long.' };
  const m = NUMERIC_RE.exec(raw);
  if (!m) return { ok: false, reason: 'Not a valid number.' };
  const [, sign, intPartRaw, fracPartRaw = '', expRaw = ''] = m;
  const intPart = intPartRaw ?? '';
  if (intPart === '' && fracPartRaw === '') return { ok: false, reason: 'Not a valid number.' };
  const exp = expRaw === '' ? 0 : Number(expRaw);
  if (!Number.isFinite(exp) || Math.abs(exp) > 40) {
    return { ok: false, reason: 'Exponent is out of range.' };
  }

  // Combine digits and the decimal point position, then shift by exp — all on
  // digit strings, no Number() round-trip and no full expansion of huge exps.
  // allDigits: the raw concatenation of int + frac parts (no decimal point).
  const allDigits = (intPart + fracPartRaw);     // significant + placeholder digits, pre-strip
  // Build a normalized digit string with an explicit decimal index.
  // Work from allDigits (no point), with the point initially after intPart.length,
  // then shifted right by `exp`.
  const pointIndex = intPart.length + exp;        // digits before the point
  // Split into integer / fractional digit strings (pad with zeros as needed).
  let intDigits: string, fracDigits: string;
  if (pointIndex <= 0) {
    intDigits = '0';
    fracDigits = '0'.repeat(-pointIndex) + allDigits;
  } else if (pointIndex >= allDigits.length) {
    intDigits = allDigits + '0'.repeat(pointIndex - allDigits.length);
    fracDigits = '';
  } else {
    intDigits = allDigits.slice(0, pointIndex);
    fracDigits = allDigits.slice(pointIndex);
  }
  intDigits = intDigits.replace(/^0+(?=\d)/, '');     // canonical integer part
  fracDigits = fracDigits.replace(/0+$/, '');         // strip fractional trailing zeros

  // Bounds on the expanded value (§8.3).
  if (fracDigits.length > 10) return { ok: false, reason: 'At most 10 decimal places.' };
  if (intDigits.replace(/^0$/, '').length > 10) {
    return { ok: false, reason: 'Magnitude must be below 10,000,000,000.' };
  }
  // Significant digits: drop leading zeros (whole value) + fractional trailing
  // zeros (already done). Trailing INTEGER zeros stay significant for Numeric.
  const sig = (intDigits + fracDigits).replace(/^0+/, '');
  const sigCount = sig === '' ? 1 : sig.length;
  if (sigCount > 15) return { ok: false, reason: 'At most 15 significant digits.' };

  const isZero = intDigits === '0' && fracDigits === '';
  const body = fracDigits === '' ? intDigits : `${intDigits}.${fracDigits}`;
  const canonical = isZero ? '0' : (sign === '-' ? `-${body}` : body);
  return { ok: true, canonical };
}
