import { ApiError } from './api';
import { getAuthConfig } from './auth.svelte';

// Settings D11b: the largest file the server takes, in whole MB (1 MB =
// 1,048,576 bytes), as the panel saved it. Read once per page load from the
// public /api/auth/config; null until it arrives or if it fails, and then the
// browser skips its own size check and the help text leaves the number out.
// The browser's check is a convenience; the server's sentence is the rule.
export const uploadLimit = $state<{ mb: number | null }>({ mb: null });

let loading: Promise<void> | null = null;

export function loadUploadLimit(): Promise<void> {
  loading ??= getAuthConfig()
    .then((c) => { uploadLimit.mb = c.max_file_mb; })
    .catch(() => {});
  return loading;
}

/** True only when the limit is known and the file is over it. */
export function overUploadLimit(bytes: number): boolean {
  return uploadLimit.mb !== null && bytes > uploadLimit.mb * 1024 * 1024;
}

/** Tests only: forget the loaded limit. */
export function resetUploadLimit(): void {
  uploadLimit.mb = null;
  loading = null;
}

/**
 * Settings D11a: what a 413 says. The server's own sentence when it sent one
 * (a file or a total over the saved limit); with none, the 413 came from a
 * proxy in front of Mathion.
 */
export function tooLargeSentence(err: unknown): string {
  const detail = err instanceof ApiError ? (err.body as { detail?: unknown } | undefined)?.detail : undefined;
  return typeof detail === 'string' ? detail : "This file is over the server's upload limit.";
}
