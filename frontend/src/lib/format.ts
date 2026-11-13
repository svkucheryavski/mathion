export function formatProgress(covered: number, total: number): string {
  return `${covered} / ${total}`;
}

// 1024-based, like the upload limits beside them (the user's call,
// 2026-11-12): a file of exactly 20 MB (20 × 1024 × 1024 bytes), which a
// 20 MB limit takes, no longer reads "21.0 MB" beside it. 1 decimal place for
// kB and up; a size that would round to "1024.0" of one unit shows in the
// next. GB is the last unit (the user's call, 2026-11-13: a site's storage).
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const fits = (v: number): boolean => v < 1024 && v.toFixed(1) !== '1024.0';
  const kb = bytes / 1024;
  if (fits(kb)) return `${kb.toFixed(1)} kB`;
  const mb = kb / 1024;
  if (fits(mb)) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
