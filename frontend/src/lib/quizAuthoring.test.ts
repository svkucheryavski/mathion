import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateNumericAnswer } from './quizAuthoring';

describe('validateNumericAnswer (§8.3)', () => {
  it('accepts plain decimals and integers', () => {
    expect(validateNumericAnswer('3.14')).toEqual({ ok: true, canonical: '3.14' });
    expect(validateNumericAnswer('-42')).toEqual({ ok: true, canonical: '-42' });
    expect(validateNumericAnswer('0')).toEqual({ ok: true, canonical: '0' });
  });

  it('expands scientific notation and judges the EXPANDED scale', () => {
    expect(validateNumericAnswer('1e3')).toEqual({ ok: true, canonical: '1000' });
    // 1.5e-20 has 21 fractional digits → over the ≤10-dp bound
    expect(validateNumericAnswer('1.5e-20')).toMatchObject({ ok: false });
  });

  it('rejects empty / unparseable', () => {
    expect(validateNumericAnswer('')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('  ')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('abc')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('1.2.3')).toMatchObject({ ok: false });
  });

  it('rejects > 10 fractional digits and |value| >= 10^10 on the expanded value', () => {
    expect(validateNumericAnswer('1.23456789012')).toMatchObject({ ok: false }); // 11 dp
    expect(validateNumericAnswer('10000000000')).toMatchObject({ ok: false });   // = 10^10
    expect(validateNumericAnswer('9999999999')).toMatchObject({ ok: true });     // 10 int digits ok
  });

  it('rejects > 15 significant digits (float round-trip safety)', () => {
    // 10 int + 6 frac = 16 sig (magnitude 1.23e9 < 10^10, so the sig bound fires).
    expect(validateNumericAnswer('1234567890.123456')).toMatchObject({ ok: false });
    // 5 int + 10 frac = 15 sig, and BOTH within the Numeric(20,10) bounds
    // (<10^10 magnitude, ≤10 dp). A 15-DIGIT INTEGER like 123456789012345 is NOT
    // a valid "15 sig" case — it is rejected first by the <10^10 magnitude bound
    // (DB column Numeric(precision=20, scale=10) → 10 integer digits max).
    expect(validateNumericAnswer('12345.1234567891')).toEqual({ ok: true, canonical: '12345.1234567891' });
  });

  it('rejects a huge exponent WITHOUT building an expanded string (sanity cap)', () => {
    expect(validateNumericAnswer('1e-1000000000')).toMatchObject({ ok: false });
    expect(validateNumericAnswer('1e40')).toMatchObject({ ok: false });
  });

  it('counts significant digits with fractional-only trailing zeros stripped', () => {
    // 0.0500 -> 5 sig (1), 1200 -> 4 sig (trailing integer zeros ARE significant)
    expect(validateNumericAnswer('0.0500')).toEqual({ ok: true, canonical: '0.05' });
    expect(validateNumericAnswer('1200')).toEqual({ ok: true, canonical: '1200' });
  });
});

import * as apiModule from './api';
import {
  listQuestions, createQuestion, updateQuestion, deleteQuestion,
  reorderQuestions, renameItem,
} from './quizAuthoring';

describe('quizAuthoring wrappers', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('listQuestions GETs the item questions path', async () => {
    const spy = vi.spyOn(apiModule.api, 'get').mockResolvedValue([]);
    await listQuestions(7);
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions');
  });

  it('createQuestion POSTs the body to the item path', async () => {
    const spy = vi.spyOn(apiModule.api, 'post').mockResolvedValue({} as never);
    await createQuestion(7, { text_md: 'Q?', type: 'numeric_answer', correct_numeric: 3, precision: 0 });
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions',
      { text_md: 'Q?', type: 'numeric_answer', correct_numeric: 3, precision: 0 });
  });

  it('updateQuestion PATCHes the question path', async () => {
    const spy = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({} as never);
    await updateQuestion(9, { text_md: 'new' });
    expect(spy).toHaveBeenCalledWith('/api/questions/9', { text_md: 'new' });
  });

  it('deleteQuestion DELETEs the question path', async () => {
    const spy = vi.spyOn(apiModule.api, 'delete').mockResolvedValue();
    await deleteQuestion(9);
    expect(spy).toHaveBeenCalledWith('/api/questions/9');
  });

  it('reorderQuestions POSTs {order} to the reorder path', async () => {
    const spy = vi.spyOn(apiModule.api, 'post').mockResolvedValue(undefined as never);
    await reorderQuestions(7, [{ id: 2, order: 1 }, { id: 1, order: 2 }]);
    expect(spy).toHaveBeenCalledWith('/api/items/7/questions/reorder',
      { order: [{ id: 2, order: 1 }, { id: 1, order: 2 }] });
  });

  it('renameItem PATCHes the item title', async () => {
    const spy = vi.spyOn(apiModule.api, 'patch').mockResolvedValue({ id: 7, title: 'T' } as never);
    await renameItem(7, 'T');
    expect(spy).toHaveBeenCalledWith('/api/items/7', { title: 'T' });
  });
});
