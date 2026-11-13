import { ApiError } from './api';
import { getAuthConfig, type AuthConfig } from './auth.svelte';

// Settings D11b: the largest file the server takes, in whole MB (1 MB =
// 1,048,576 bytes), as the panel saved it. Read once per page load from the
// public /api/auth/config; null until it arrives or if it fails, and then the
// browser skips its own size check and the help text leaves the number out.
// main.ts hands in its one startup config request (Branding D13).
// The browser's check is a convenience; the server's sentence is the rule.
export const uploadLimit = $state<{ mb: number | null }>({ mb: null });

let loading: Promise<void> | null = null;
/** A limits save set the number: a late startup answer must not undo it. */
let set = false;

export function loadUploadLimit(config?: Promise<AuthConfig>): Promise<void> {
  loading ??= (config ?? getAuthConfig())
    .then((c) => { if (!set) uploadLimit.mb = c.max_file_mb; })
    .catch(() => {});
  return loading;
}

/** Settings D11b: a limits save in the panel reaches this tab's upload
 *  screens at once, also after a failed startup read. */
export function setUploadLimit(mb: number): void {
  set = true;
  uploadLimit.mb = mb;
}

/** True only when the limit is known and the file is over it. */
export function overUploadLimit(bytes: number): boolean {
  return uploadLimit.mb !== null && bytes > uploadLimit.mb * 1024 * 1024;
}

/** The browser's over-the-limit sentence, in the server's words (the user's
 *  call, 2026-11-12): the file's name where the screen knows it. Only for a
 *  known limit (overUploadLimit). */
export function overLimitSentence(name?: string): string {
  return `${name || 'This file'} is over the ${uploadLimit.mb} MB limit.`;
}

/** Tests only: forget the loaded limit. */
export function resetUploadLimit(): void {
  uploadLimit.mb = null;
  loading = null;
  set = false;
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
