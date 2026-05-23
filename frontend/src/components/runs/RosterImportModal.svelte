<script lang="ts">
  import FocusTrap from '../ui/FocusTrap.svelte';
  import { parseCsv } from '../../lib/csv';
  import type { CsvParseResult } from '../../lib/csv';
  import type { GroupResponse, RunStudentResponse } from '../../lib/types';

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

  // T17 will consume these props (submit endpoint + post-submit refetch). For
  // Stage 1 they are unread; reference them in an $effect to keep ts-check
  // happy without adding a real reactive dependency.
  $effect(() => {
    void runId;
    void onRefetchBeforeSubmit;
  });

  let text = $state('');
  let parsed = $state<CsvParseResult | null>(null);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;

  // Cancel any pending debounced parse on unmount so it can't fire and update
  // state after the component is gone.
  $effect(() => () => {
    if (parseTimer) clearTimeout(parseTimer);
  });

  function onTextInput(event: Event) {
    text = (event.currentTarget as HTMLTextAreaElement).value;
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      parsed = parseCsv(text, existingGroups.map((g) => g.name), existingRoster.map((r) => r.user_email));
    }, 200);
  }

  function truncatedAlreadyEnrolled(list: string[]): string {
    if (list.length <= 5) return list.join(', ');
    return `${list.slice(0, 5).join(', ')}, +${list.length - 5} more`;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <FocusTrap>
    <div class="modal modal-roster-import" role="dialog" aria-modal="true" aria-label="Import roster">
      <header>
        <h2>Import roster from CSV</h2>
        <button type="button" aria-label="Close" onclick={onClose}>×</button>
      </header>

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

      <div class="modal-actions">
        <button type="button" data-action="cancel" onclick={onClose}>Cancel</button>
        <button
          type="button"
          data-action="import"
          disabled={!parsed || !parsed.ok || parsed.validCount === 0}
        >Import {parsed && parsed.ok ? parsed.validCount : 0} valid rows</button>
      </div>
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
  .preview { width: 100%; border-collapse: collapse; margin-bottom: var(--space-3, 16px); max-height: 280px; display: block; overflow-y: auto; }
  .preview th, .preview td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border, #eee); font-size: 0.9em; }
  .preview th { background: var(--surface-alt, #f5f5f5); position: sticky; top: 0; }
  .counts { margin-bottom: var(--space-3, 16px); color: var(--muted, #555); font-size: 0.9em; }
  .counts p { margin: 4px 0; }
  .error { color: var(--danger, #c00); padding: 8px 12px; background: var(--danger-soft, #fee); border-radius: 4px; margin-bottom: var(--space-3, 16px); }
  .modal-actions { display: flex; gap: var(--space-2, 8px); justify-content: flex-end; }
</style>
