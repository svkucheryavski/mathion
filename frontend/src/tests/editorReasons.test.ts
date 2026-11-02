import { describe, it, expect } from 'vitest';
import {
  metaReason, structureReason, textReason, deleteVersionReason, duplicateVersionReason, unsavedSuffix,
} from '../lib/editorReasons';

type S = 'created' | 'published' | 'archived';
const v = (state: S, is_disabled: boolean) => ({ state, is_disabled });

// Every function × all six state × disabled combinations (spec §Testing T1).
// State is checked BEFORE is_disabled: "Enable … first" only where enabling unlocks.
const CASES: [S, boolean, { meta: string | null; structure: string | null; text: string | null; del: string | null; dup: string | null }][] = [
  ['created', false, { meta: null, structure: null, text: null, del: null, dup: null }],
  ['created', true, {
    meta: 'Enable the version first', structure: 'Enable the version first', text: 'Enable the version first',
    del: 'Delete — enable the version first', dup: 'Duplicate — enable the version first',
  }],
  ['published', false, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: null, del: 'Delete — only for a created version', dup: null,
  }],
  ['published', true, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Enable the version first', del: 'Delete — only for a created version', dup: 'Duplicate — enable the version first',
  }],
  ['archived', false, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Archived versions are read-only', del: 'Delete — only for a created version', dup: null,
  }],
  ['archived', true, {
    meta: 'Only a created version can change its info', structure: 'Only a created version can change its structure',
    text: 'Archived versions are read-only', del: 'Delete — only for a created version', dup: 'Duplicate — enable the version first',
  }],
];

describe('editorReasons', () => {
  for (const [state, dis, want] of CASES) {
    it(`${state}${dis ? ' + disabled' : ''}`, () => {
      expect(metaReason(v(state, dis))).toBe(want.meta);
      expect(structureReason(v(state, dis))).toBe(want.structure);
      expect(textReason(v(state, dis))).toBe(want.text);
      expect(deleteVersionReason(v(state, dis))).toBe(want.del);
      expect(duplicateVersionReason(v(state, dis))).toBe(want.dup);
    });
  }

  it('unsavedSuffix appends only when something is dirty', () => {
    expect(unsavedSuffix(true)).toBe(' Unsaved edits may be lost.');
    expect(unsavedSuffix(false)).toBe('');
  });
});
