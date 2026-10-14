// Disabled-reason strings for the authoring surfaces (Slice-5a spec §4), in one
// place. State is checked BEFORE is_disabled, so "Enable the version first"
// appears only when enabling would actually unlock the action.
import type { VersionLifecycleState } from './versionPermissions';

type V = { state: VersionLifecycleState; is_disabled: boolean };

/** Version info (label / info / attempts) — created versions only. */
export function metaReason(v: V): string | null {
  if (v.state !== 'created') return 'Only a created version can change its info';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** Create / reorder / delete of blocks, sequences and items. */
export function structureReason(v: V): string | null {
  if (v.state !== 'created') return 'Only a created version can change its structure';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** Block title/info and sequence title — published text stays editable. */
export function textReason(v: V): string | null {
  if (v.state === 'archived') return 'Archived versions are read-only';
  if (v.is_disabled) return 'Enable the version first';
  return null;
}

/** The Delete slot on a Versions-page row (ref 1498). */
export function deleteVersionReason(v: V): string | null {
  if (v.state !== 'created') return 'Delete — only for a created version';
  if (v.is_disabled) return 'Delete — enable the version first';
  return null;
}

/** The Duplicate slot on a Versions-page row (ref 1498). */
export function duplicateVersionReason(v: V): string | null {
  return v.is_disabled ? 'Duplicate — enable the version first' : null;
}

/** R51: every navigation question, and the D10 quiz-edit question. */
export const DISCARD_CONTINUE = 'Discard unsaved changes and continue?';
/** R51: every close or Esc question: closing is the action itself. */
export const DISCARD = 'Discard unsaved changes?';

/** D3: appended to the question of an action that can close or unmount a draft. */
export function unsavedSuffix(anyDirty: boolean): string {
  return anyDirty ? ' Unsaved edits may be lost.' : '';
}
