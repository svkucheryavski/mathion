// The item-body contract (Slice-5b §2). ItemEditorModal owns the Title and the
// footer; each type body (PageBody, VideoBody, AppBody, quiz/QuizBody) implements
// this API, exported from the component and reached via bind:this.
import { api, ApiError } from './api';
import { loadAdminTree } from '../stores/currentEditorVersion.svelte';
import { pushToast } from '../stores/toasts.svelte';
import type { QuizEdits } from './quizEdits.svelte';

export type SaveOutcome = {
  outcome: 'ok' | 'partial' | 'failed';
  // The server's echo of the title, when this save sent it and that part succeeded.
  savedTitle?: string;
};

export type ItemBodyApi = {
  // Send everything dirty (the title too, when titleDraft is defined). Never throws.
  save(titleDraft: string | undefined): Promise<SaveOutcome>;
  // Reset save drafts only (footer Discard).
  discard(): void;
  // Reset save drafts AND collapse typed create forms (a confirmed close, D5).
  discardAll(): void;
  // D10: check only what this Save would send; show inline errors; focus the first.
  validate(): boolean;
  // Slice-5d (R3): the quiz body's one open-edit slot. The modal's inline title
  // takes it too. Page, Video and App leave it out.
  edits?: QuizEdits;
};

// PATCH /api/items/{id} → ItemResponse (the fields the editor reads back).
export type ItemEcho = {
  id: number;
  title: string;
  content_md: string | null;
  video_url: string | null;
  script_url: string | null;
};

export const patchItem = (id: number, body: Record<string, unknown>) =>
  api.patch<ItemEcho>(`/api/items/${id}`, body);

// The failure half of every body's save: toast the server's message; on 403/409
// (the version changed state under us) force a tree reload so perms catch up.
export function reportSaveFailure(e: unknown, vid: number, stillOnVid: (v: number) => boolean): void {
  pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
  if (e instanceof ApiError && (e.status === 403 || e.status === 409) && stillOnVid(vid)) {
    void loadAdminTree(vid, { force: true });
  }
}
