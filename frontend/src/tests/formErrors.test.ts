import { describe, it, expect } from 'vitest';
import { ApiError } from '../lib/api';
import { mapCreateError } from '../lib/formErrors';

describe('mapCreateError', () => {
  const known = ['title', 'slug'] as const;

  it('422 with single field error → fieldErrors keyed by last loc segment', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'slug'], msg: 'String should match pattern', type: 'string_pattern_mismatch' },
    ]);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({ slug: 'String should match pattern' });
    expect(r.globalMessage).toBe(null);
  });

  it('422 with multiple known-field errors maps each', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'title'], msg: 'Field required', type: 'missing' },
      { loc: ['body', 'slug'], msg: 'String should match pattern', type: 'string_pattern_mismatch' },
    ]);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({
      title: 'Field required',
      slug: 'String should match pattern',
    });
    expect(r.globalMessage).toBe(null);
  });

  it('422 with field NOT in knownFields falls into globalMessage', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'mystery_field'], msg: 'Some odd error', type: 'value_error' },
    ]);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({});
    // Use the unmapped error's msg in the global message so the user can act
    // on it; keep it concise rather than dumping the full Pydantic loc path.
    expect(r.globalMessage).toContain('Some odd error');
  });

  it('422 mixed: known field maps inline, unknown field accumulates into globalMessage', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'slug'], msg: 'bad slug', type: 'value_error' },
      { loc: ['body', 'unknown'], msg: 'unknown bad', type: 'value_error' },
    ]);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({ slug: 'bad slug' });
    expect(r.globalMessage).toContain('unknown bad');
  });

  it('409 whose body mentions "slug" or "title" → inline title error', () => {
    const e = new ApiError(409, 'A sequence with the same auto-generated slug already exists in this block — choose a different title.');
    const r = mapCreateError(e, known);
    expect(r.fieldErrors.title).toBe('A sequence with the same auto-generated slug already exists in this block — choose a different title.');
    expect(r.globalMessage).toBe(null);
  });

  it('409 (case-insensitive) without "slug" → globalMessage', () => {
    const e = new ApiError(409, 'Conflict: parent capacity reached');
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({});
    expect(r.globalMessage).toBe('Conflict: parent capacity reached');
  });

  it('409 with "Slug" or "Title" capitalized matches case-insensitively', () => {
    const e1 = new ApiError(409, 'Slug already exists');
    expect(mapCreateError(e1, known).fieldErrors.title).toBe('Slug already exists');
    const e2 = new ApiError(409, 'Title already taken');
    expect(mapCreateError(e2, known).fieldErrors.title).toBe('Title already taken');
  });

  it('422 with loc=["body","title"] maps inline on title field (knownFields=[title])', () => {
    const e = new ApiError(422, [
      { loc: ['body', 'title'], msg: 'Title must contain at least one Latin letter or digit', type: 'value_error' },
    ]);
    const r = mapCreateError(e, ['title']);
    expect(r.fieldErrors.title).toBe('Title must contain at least one Latin letter or digit');
    expect(r.globalMessage).toBe(null);
  });

  it('non-422/409 ApiError → globalMessage from displayMessage', () => {
    const e = new ApiError(403, 'forbidden');
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({});
    expect(r.globalMessage).toBe('forbidden');
  });

  it('plain Error → generic globalMessage', () => {
    const r = mapCreateError(new Error('network'), known);
    expect(r.fieldErrors).toEqual({});
    expect(r.globalMessage).toBe('Save failed');
  });

  it('null/undefined → generic globalMessage', () => {
    const r1 = mapCreateError(null, known);
    expect(r1.globalMessage).toBe('Save failed');
    const r2 = mapCreateError(undefined, known);
    expect(r2.globalMessage).toBe('Save failed');
  });

  it('422 with empty validationErrors falls back to globalMessage', () => {
    // Defensive: ApiError(422, []) shouldn't strand the user with no message.
    const e = new ApiError(422, []);
    const r = mapCreateError(e, known);
    expect(r.fieldErrors).toEqual({});
    // displayMessage on ApiError-array detail is the generic prompt.
    expect(r.globalMessage).toBe('Please correct the highlighted fields.');
  });
});
