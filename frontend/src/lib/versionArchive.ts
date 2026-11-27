// Download a course version as a .tar.gz: ask the server first, then let the browser download it.
import { api } from './api';

export function archiveUrl(versionId: number): string {
  return `/api/versions/${versionId}/archive`;
}

/** Resolves when the version can be downloaded; throws the server's refusal otherwise. */
export async function checkArchive(versionId: number): Promise<void> {
  await api.get<{ filename: string }>(`${archiveUrl(versionId)}/check`);
}

/** Hands the address to the browser's own download, in the same tab. */
export function startDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
