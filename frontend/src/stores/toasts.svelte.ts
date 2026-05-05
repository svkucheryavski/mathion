import type { Toast } from '../lib/types';

const AUTO_DISMISS_MS = 5000;

export const toasts = $state<{ list: Toast[] }>({ list: [] });

let nextId = 1;

export function pushToast(message: string, kind: Toast['kind'] = 'info'): void {
  const id = nextId++;
  toasts.list.push({ id, message, kind });
  setTimeout(() => {
    const idx = toasts.list.findIndex((t) => t.id === id);
    if (idx !== -1) toasts.list.splice(idx, 1);
  }, AUTO_DISMISS_MS);
}

export function clearToasts(): void {
  toasts.list.splice(0, toasts.list.length);
}
