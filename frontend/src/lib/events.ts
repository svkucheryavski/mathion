/// <reference types="vite/client" />
// Tiny callback registry, plain `.ts` (no runes). Lives outside both
// `lib/api.ts` and `lib/auth.svelte.ts` so neither imports the other —
// breaks the api↔auth↔router cycle that ESM partial-init would expose.

type UnauthorizedHandler = (path: string) => void;

let handler: UnauthorizedHandler | null = null;
let pendingUnauthorized: string | null = null;

export function onUnauthorized(cb: UnauthorizedHandler): void {
  handler = cb;
  if (pendingUnauthorized !== null) {
    const path = pendingUnauthorized;
    pendingUnauthorized = null;
    cb(path);
  }
}

export function emitUnauthorized(path: string): void {
  if (handler !== null) {
    handler(path);
    return;
  }
  // Coalescing single slot — multiple pre-wire emits collapse to the most
  // recent path. We never replay more than one redirect; the wired handler
  // clears the session and navigates on first replay.
  pendingUnauthorized = path;
  if (import.meta.env.DEV) {
    console.error(
      '[events] emitUnauthorized called before onUnauthorized was wired:',
      path,
    );
  }
}
