export type VersionPermissions = {
  canEditVersionMeta: boolean;
  canEditStructure:   boolean;
  canEditTextFields:  boolean;
  canPublish:         boolean;
  canArchive:         boolean;
  canRevert:          boolean;
  canDisable:         boolean;
  canEnable:          boolean;
  canDeleteVersion:   boolean;
};

export function versionPermissions(v: { state: string; is_disabled: boolean }): VersionPermissions {
  const created = v.state === 'created' && !v.is_disabled;
  const published = v.state === 'published' && !v.is_disabled;
  const archived = v.state === 'archived' && !v.is_disabled;
  return {
    canEditVersionMeta: created,
    canEditStructure:   created,
    canEditTextFields:  created || published,
    canPublish:         created,
    canArchive:         published,
    canRevert:          published,
    canDisable:         !v.is_disabled && (created || published || archived),
    canEnable:          v.is_disabled,
    canDeleteVersion:   created,
  };
}
