<script lang="ts">
  import FocusTrap from '../ui/FocusTrap.svelte';
  import { parseCsv } from '../../lib/csv';
  import type { CsvParseResult } from '../../lib/csv';
  import { ApiError } from '../../lib/api';
  import { batchAddRunStudents } from '../../lib/runRoster';
  import { buildBatchRow } from '../../lib/buildBatchRow';
  import type {
    GroupResponse, RunStudentResponse, RunStudentBatchResultRow,
  } from '../../lib/types';

  let {
    runId, existingRoster, existingGroups,
    onRefetchBeforeSubmit, onClose,
  }: {
    runId: number;
    existingRoster: RunStudentResponse[];
    existingGroups: GroupResponse[];
    onRefetchBeforeSubmit: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onClose: () => void;
  } = $props();

  let text = $state('');
  let parsed = $state<CsvParseResult | null>(null);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;
  let submitError = $state<string | null>(null);

  type Stage = 'paste' | 'result';
  let stage = $state<Stage>('paste');
  let submitting = $state(false);
  let resultRows = $state<RunStudentBatchResultRow[] | null>(null);
  let copyFallbackVisible = $state(false);
  let copyFallbackText = $state('');

  // Cancel any pending debounced parse on unmount so it can't fire and update
  // state after the component is gone.
  $effect(() => () => {
    if (parseTimer) clearTimeout(parseTimer);
  });

  function onTextInput(event: Event) {
    text = (event.currentTarget as HTMLTextAreaElement).value;
    submitError = null;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parsed = parseCsv(text, existingGroups.map((g) => g.name), existingRoster.map((r) => r.user_email));
    }, 200);
  }

  function truncatedAlreadyEnrolled(list: string[]): string {
    if (list.length <= 5) return list.join(', ');
    return `${list.slice(0, 5).join(', ')}, +${list.length - 5} more`;
  }

  async function onImport() {
    if (!parsed || !parsed.ok || parsed.validCount === 0 || submitting) return;
    submitError = null;
    // Snapshot parsed BEFORE the first await so a concurrent textarea edit
    // during in-flight submit can't mutate which rows we submit.
    const snapshot = parsed;
    // Cancel any pending debounce so it can't overwrite `parsed` mid-submit.
    if (parseTimer) { clearTimeout(parseTimer); parseTimer = null; }
    submitting = true;
    try {
      const fresh = await onRefetchBeforeSubmit();
      const rows = snapshot.rows
        .filter((r) => r.valid)
        .map((r) => buildBatchRow(r, fresh.students, fresh.groups));
      const response = await batchAddRunStudents(runId, rows);
      resultRows = response.results;
      stage = 'result';
    } catch (e) {
      // Surface submit-step errors via the separate submitError slot (above
      // .modal-actions), NOT via parsed.error (which is the client-side CSV
      // parse-error channel). This keeps the two error surfaces distinct per spec.
      if (e instanceof ApiError) {
        submitError = e.displayMessage;
        return;
      }
      submitError = 'Import failed — please retry.';
      console.error(e);
    } finally {
      submitting = false;
    }
  }

  function failedRowsAsText(): string {
    if (!resultRows) return '';
    return resultRows
      .filter((r) => r.status === 'error')
      .map((r) => `${r.email}\t${r.detail ?? ''}`)
      .join('\n');
  }

  async function onCopyFailed() {
    const payload = failedRowsAsText();
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      copyFallbackText = payload;
      copyFallbackVisible = true;
    }
  }

  async function onDone() {
    await onRefetchBeforeSubmit();
    onClose();
  }

  function closeForCurrentStage() {
    if (submitting) return;
    if (stage === 'paste') onClose();
    else onDone();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    closeForCurrentStage();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) closeForCurrentStage(); }}>
  <FocusTrap autofocusSelector="textarea">
    <div class="modal modal-roster-import" role="dialog" aria-modal="true" aria-label="Import roster">
      <header>
        <h2>Import roster from CSV</h2>
        <button type="button" aria-label="Close" onclick={closeForCurrentStage}>×</button>
      </header>

      {#if stage === 'paste'}
        <p class="helper">
          Paste rows from Excel or Google Sheets. Columns: <code>name</code> (optional),
          <code>email</code> (required), <code>group</code> (optional — group is auto-created
          if it does not exist). Tab or comma separated.
        </p>

        <textarea rows="10" value={text} oninput={onTextInput}></textarea>

        {#if parsed && parsed.ok}
          <table class="preview">
            <thead>
              <tr><th>#</th><th>Name</th><th>Email</th><th>Group</th><th>Status</th></tr>
            </thead>
            <tbody>
              {#each parsed.rows.slice(0, 10) as row}
                <tr>
                  <td>{row.rowIndex}</td>
                  <td>{row.parsed.name ?? '—'}</td>
                  <td>{row.parsed.email || '—'}</td>
                  <td>{row.parsed.group ?? '—'}</td>
                  <td>
                    {#if row.valid}✓{:else}✗ {row.errors.join('; ')}{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>

          <footer class="counts">
            <p>
              {parsed.rows.length} rows — {parsed.validCount} valid,
              {parsed.invalidCount} will skip ({parsed.invalidCount - parsed.duplicateInPasteCount} invalid,
              {parsed.duplicateInPasteCount} duplicate-in-paste).
            </p>
            {#if parsed.willCreateGroups.length > 0}
              <p>Will auto-create groups: {parsed.willCreateGroups.join(', ')}</p>
            {/if}
            {#if parsed.alreadyEnrolledEmails.length > 0}
              <p>Already-enrolled emails will be re-bucketed: {truncatedAlreadyEnrolled(parsed.alreadyEnrolledEmails)}</p>
            {/if}
          </footer>
        {:else if parsed && !parsed.ok}
          <p class="error">{parsed.error}</p>
        {/if}

        {#if submitError}
          <p class="error" role="alert">{submitError}</p>
        {/if}

        <div class="modal-actions">
          <button type="button" data-action="cancel" disabled={submitting} onclick={onClose}>Cancel</button>
          <button
            type="button"
            data-action="import"
            disabled={!parsed || !parsed.ok || parsed.validCount === 0 || submitting}
            onclick={onImport}
          >
            {submitting ? 'Importing…' : (parsed && parsed.ok ? `Import ${parsed.validCount} valid rows` : 'Import 0 valid rows')}
          </button>
        </div>
      {:else if stage === 'result' && resultRows}
        {@const added = resultRows.filter((r) => r.status === 'added').length}
        {@const failed = resultRows.filter((r) => r.status === 'error').length}
        <table class="result">
          <thead><tr><th>#</th><th>Email</th><th>Result</th></tr></thead>
          <tbody>
            {#each resultRows as r, i}
              <tr>
                <td>{i + 1}</td>
                <td>{r.email}</td>
                <td>
                  {#if r.status === 'added'}
                    <span class="badge badge-ok">added</span>
                  {:else}
                    <span class="badge badge-error" data-result="error" title={r.detail ?? ''}>error</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <footer class="counts">
          <p>{added} added, {failed} failed.</p>
        </footer>
        <div class="modal-actions">
          {#if failed > 0}
            <button type="button" data-action="copy-failed" onclick={onCopyFailed}>Copy failed rows</button>
          {/if}
          <button type="button" data-action="done" onclick={onDone}>Done</button>
        </div>
        {#if copyFallbackVisible}
          <textarea class="copy-fallback" readonly>{copyFallbackText}</textarea>
        {/if}
      {/if}
    </div>
  </FocusTrap>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal-roster-import { background: var(--surface, white); border-radius: var(--radius, 8px); padding: var(--space-4, 24px); min-width: 520px; max-width: 90vw; max-height: 90vh; overflow: auto; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3, 16px); }
  header h2 { margin: 0; }
  header button { background: transparent; border: 0; font-size: 1.5em; cursor: pointer; padding: 0 8px; }
  .helper { color: var(--muted, #666); font-size: 0.9em; margin: 0 0 var(--space-2, 8px); }
  .helper code { background: var(--surface-alt, #f5f5f5); padding: 1px 4px; border-radius: 3px; font-size: 0.95em; }
  textarea { width: 100%; box-sizing: border-box; font-family: var(--mono, ui-monospace, monospace); font-size: 0.9em; padding: 8px; margin-bottom: var(--space-3, 16px); }
  .preview, .result { width: 100%; border-collapse: collapse; margin-bottom: var(--space-3, 16px); max-height: 280px; display: block; overflow-y: auto; }
  .preview th, .preview td, .result th, .result td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border, #eee); font-size: 0.9em; }
  .preview th, .result th { background: var(--surface-alt, #f5f5f5); position: sticky; top: 0; }
  .counts { margin-bottom: var(--space-3, 16px); color: var(--muted, #555); font-size: 0.9em; }
  .counts p { margin: 4px 0; }
  .error { color: var(--danger, #c00); padding: 8px 12px; background: var(--danger-soft, #fee); border-radius: 4px; margin-bottom: var(--space-3, 16px); }
  .modal-actions { display: flex; gap: var(--space-2, 8px); justify-content: flex-end; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 0.85em; }
  .badge-ok { background: #e7f5ee; color: #0a6c3e; }
  .badge-error { background: #fdecea; color: #a8071a; cursor: help; }
  .copy-fallback { margin-top: var(--space-2, 8px); min-height: 80px; }
</style>
