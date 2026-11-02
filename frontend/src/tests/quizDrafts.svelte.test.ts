import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  holdsAnswers,
  getDraft,
  setDraft,
  clearDraft,
  clearAllDrafts,
  dropDraftsNotOwnedBy,
  hasUnsavedDrafts,
} from '../stores/quizDrafts.svelte';
import { session } from '../stores/session.svelte';
import { api } from '../lib/api';
import { logout, verifyPin, bootstrapSession } from '../lib/auth.svelte';
import type { User } from '../lib/types';

function user(id: number): User {
  return {
    id, email: `u${id}@x.test`, full_name: null, is_superuser: false, is_disabled: false,
    photo_url: null, has_course_admin: false, has_run_teacher: false,
  };
}

/** Fire a cancelable beforeunload and report whether a listener asked to warn. */
function unloadWarns(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  session.user = user(7);
});
afterEach(() => {
  clearAllDrafts();
  session.user = null;
  vi.restoreAllMocks();
});

describe('holdsAnswers (D83)', () => {
  it('counts a non-empty array or a non-blank string', () => {
    expect(holdsAnswers([2])).toBe(true);
    expect(holdsAnswers([])).toBe(false);
    expect(holdsAnswers(' x ')).toBe(true);
    expect(holdsAnswers('  ')).toBe(false);
    expect(holdsAnswers(undefined)).toBe(false);
  });
});

describe('quiz drafts (D83, C14)', () => {
  it('keeps a draft per item and returns a copy', () => {
    setDraft(5, { '11': [2] });
    const d = getDraft(5)!;
    expect(d).toEqual({ '11': [2] });
    (d['11'] as number[]).push(3);
    d['12'] = 'x';
    expect(getDraft(5)).toEqual({ '11': [2] });
    expect(getDraft(6)).toBeUndefined();
  });

  it('stores nothing while signed out', () => {
    session.user = null;
    setDraft(5, { '11': [2] });
    expect(getDraft(5)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  it('drops the draft when text typed and erased leaves nothing', () => {
    setDraft(5, { '11': 'a' });
    expect(hasUnsavedDrafts()).toBe(true);
    setDraft(5, { '11': '' });
    expect(getDraft(5)).toBeUndefined();
    expect(hasUnsavedDrafts()).toBe(false);
  });

  it('an emptied multi-choice answer drops the draft and the unload warning', () => {
    setDraft(5, { '11': [1] });
    expect(unloadWarns()).toBe(true);
    setDraft(5, { '11': [] });
    expect(getDraft(5)).toBeUndefined();
    expect(unloadWarns()).toBe(false);
  });

  it('warns on unload only while a draft holds answers', () => {
    expect(unloadWarns()).toBe(false);
    setDraft(5, { '11': [1] });
    expect(unloadWarns()).toBe(true);
    clearDraft(5);
    expect(unloadWarns()).toBe(false);
  });

  it('dropDraftsNotOwnedBy keeps the owner and drops the rest', () => {
    setDraft(5, { '11': [1] });
    session.user = user(8);
    setDraft(6, { '21': 'y' });
    dropDraftsNotOwnedBy(8);
    expect(getDraft(5)).toBeUndefined();
    expect(getDraft(6)).toEqual({ '21': 'y' });
  });

  it('logout clears every draft', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({});
    setDraft(5, { '11': [1] });
    await logout();
    expect(hasUnsavedDrafts()).toBe(false);
    expect(getDraft(5)).toBeUndefined();
  });

  it('a sign-in as another user drops the drafts; the same user keeps them', async () => {
    setDraft(5, { '11': [1] });
    vi.spyOn(api, 'post').mockResolvedValue({ user: user(7) });
    await verifyPin('u7@x.test', '123456', 7);
    expect(getDraft(5)).toEqual({ '11': [1] });
    vi.spyOn(api, 'post').mockResolvedValue({ user: user(9) });
    await verifyPin('u9@x.test', '123456', 7);
    expect(getDraft(5)).toBeUndefined();
  });

  it('a restored session for another user drops the drafts; the same user keeps them', async () => {
    setDraft(5, { '11': [1] });
    vi.spyOn(api, 'get').mockResolvedValue(user(7));
    await bootstrapSession();
    expect(getDraft(5)).toEqual({ '11': [1] });
    vi.spyOn(api, 'get').mockResolvedValue(user(9));
    await bootstrapSession();
    expect(getDraft(5)).toBeUndefined();
  });
});
