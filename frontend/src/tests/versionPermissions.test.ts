import { describe, it, expect } from 'vitest';
import { versionPermissions } from '../lib/versionPermissions';

const cases: Array<[string, boolean, Partial<ReturnType<typeof versionPermissions>>]> = [
  ['created', false, {
    canEditVersionMeta: true, canEditStructure: true, canEditTextFields: true,
    canPublish: true, canArchive: false, canRevert: false,
    canDisable: true, canEnable: false, canDeleteVersion: true,
  }],
  ['published', false, {
    canEditVersionMeta: false, canEditStructure: false, canEditTextFields: true,
    canPublish: false, canArchive: true, canRevert: true,
    canDisable: true, canEnable: false, canDeleteVersion: false,
  }],
  ['archived', false, {
    canEditVersionMeta: false, canEditStructure: false, canEditTextFields: false,
    canPublish: false, canArchive: false, canRevert: false,
    canDisable: true, canEnable: false, canDeleteVersion: false,
  }],
];

describe('versionPermissions', () => {
  for (const [state, is_disabled, expected] of cases) {
    it(`state=${state}, is_disabled=${is_disabled}`, () => {
      const got = versionPermissions({ state, is_disabled });
      for (const k of Object.keys(expected) as Array<keyof typeof expected>) {
        expect(got[k]).toBe(expected[k]);
      }
    });
  }

  it('is_disabled overrides everything except canEnable', () => {
    for (const state of ['created', 'published', 'archived']) {
      const got = versionPermissions({ state, is_disabled: true });
      expect(got.canEnable).toBe(true);
      expect(got.canEditVersionMeta).toBe(false);
      expect(got.canEditStructure).toBe(false);
      expect(got.canEditTextFields).toBe(false);
      expect(got.canPublish).toBe(false);
      expect(got.canArchive).toBe(false);
      expect(got.canRevert).toBe(false);
      expect(got.canDisable).toBe(false);
      expect(got.canDeleteVersion).toBe(false);
    }
  });
});
