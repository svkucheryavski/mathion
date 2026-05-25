export function formatProgress(covered: number, total: number): string {
  return `${covered} / ${total}`;
}

// SI 1000-based (matches macOS Finder); 1 decimal place for kB+.
export function formatFileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
