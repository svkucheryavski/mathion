<script lang="ts">
  import { tick } from 'svelte';
  import { parseCsv } from '../../lib/csv';
  import type { CsvParseResult } from '../../lib/csv';
  import { ApiError } from '../../lib/api';
  import { batchAddRunStudents } from '../../lib/runRoster';
  import { buildBatchRow } from '../../lib/buildBatchRow';
  import { pushToast } from '../../stores/toasts.svelte';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
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

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const helpId = `${uid}-help`;
  const summaryId = `${uid}-summary`;
  const PREVIEW_ROWS = 10;

  let text = $state('');
  let parsed = $state<CsvParseResult | null>(null);
  let parseTimer: ReturnType<typeof setTimeout> | null = null;
  let submitError = $state<string | null>(null);

  type Stage = 'paste' | 'result';
  let stage = $state<Stage>('paste');
  let submitting = $state(false);
  // Done's refetch is running: Done, ×, Esc and Copy wait (spec §Import › Fixes).
  // × stays enabled, so it keeps focus (F10); closeForCurrentStage ignores it.
  let closing = $state(false);
  let resultRows = $state<RunStudentBatchResultRow[] | null>(null);
  // The roster and groups onRefetchBeforeSubmit returned for this import: the
  // "before" side of D15's re-bucketed Detail.
  let rosterAtSubmit: RunStudentResponse[] = [];
  let groupsAtSubmit: GroupResponse[] = [];
  let copyFallbackVisible = $state(false);
  let copyFallbackText = $state('');
  let doneEl = $state<HTMLButtonElement>();
  let copyFallbackEl = $state<HTMLTextAreaElement>();

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

  const validCount = $derived(parsed && parsed.ok ? parsed.validCount : 0);

  // D23: an enrolled student moves only when their pasted group names a group
  // other than their current one. Matched as the import matches: e-mails
  // lower-cased (parseCsv already lower-cases the paste), group names exactly
  // after parseCsv's trim. csv.ts's alreadyEnrolled keeps its wider meaning:
  // buildBatchRow resends the current group for an empty group cell.
  const realMoves = $derived.by((): string[] => {
    if (!parsed || !parsed.ok) return [];
    const groupIdByEmail = new Map(existingRoster.map((s) => [s.user_email.toLowerCase(), s.group_id]));
    const nameById = new Map(existingGroups.map((g) => [g.id, g.name]));
    const moves = new Set<string>();
    for (const row of parsed.rows) {
      if (!row.valid || !row.alreadyEnrolled || !row.parsed.group) continue;
      const gid = groupIdByEmail.get(row.parsed.email);
      const current = gid == null ? null : (nameById.get(gid) ?? null);
      if (current !== row.parsed.group) moves.add(row.parsed.email);
    }
    // In paste order, as the teacher pasted them.
    return [...moves];
  });

  // D22: skipped rows the 10-row preview does not show.
  const hiddenSkips = $derived(
    parsed && parsed.ok ? parsed.rows.slice(PREVIEW_ROWS).filter((r) => !r.valid).map((r) => r.rowIndex) : [],
  );

  function firstFive(list: (string | number)[]): string {
    if (list.length <= 5) return list.join(', ');
    return `${list.slice(0, 5).join(', ')}, +${list.length - 5} more`;
  }

  function skipLine(rows: number[]): string {
    return rows.length === 1 ? `Row ${rows[0]} will skip.` : `Rows ${firstFive(rows)} will skip.`;
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
    let switched = false;
    try {
      const fresh = await onRefetchBeforeSubmit();
      const rows = snapshot.rows
        .filter((r) => r.valid)
        .map((r) => buildBatchRow(r, fresh.students, fresh.groups));
      const response = await batchAddRunStudents(runId, rows);
      rosterAtSubmit = fresh.students;
      groupsAtSubmit = fresh.groups;
      resultRows = response.results;
      stage = 'result';
      switched = true;
    } catch (e) {
      // Surface submit-step errors via the separate submitError slot, NOT via
      // parsed.error (the client-side CSV parse-error channel).
      if (e instanceof ApiError) {
        submitError = e.displayMessage;
      } else {
        submitError = 'Import failed — please retry.';
        console.error(e);
      }
    } finally {
      submitting = false;
    }
    // The focused Import unmounted with the paste stage: Done takes focus.
    if (switched) {
      await tick();
      doneEl?.focus();
    }
  }

  // D15 / R25 / P9: what the Detail column says for one result row.
  function detailFor(r: RunStudentBatchResultRow): string {
    if (r.status === 'error') {
      if (!r.detail) return 'Not added';
      return r.detail === 'internal error' ? 'Server error — try again' : r.detail;
    }
    if (r.group_id === undefined) return '';
    const email = r.email.toLowerCase();
    const before = rosterAtSubmit.find((s) => s.user_email.toLowerCase() === email);
    if (!before || before.group_id === r.group_id) return '';
    if (before.group_id === null) return 're-bucketed from no group';
    const old = groupsAtSubmit.find((g) => g.id === before.group_id);
    return old ? `re-bucketed from ${old.name}` : '';
  }

  const added = $derived(resultRows ? resultRows.filter((r) => r.status === 'added').length : 0);
  const failed = $derived(resultRows ? resultRows.filter((r) => r.status === 'error').length : 0);

  function failedRowsAsText(): string {
    if (!resultRows) return '';
    return resultRows
      .filter((r) => r.status === 'error')
      .map((r) => `${r.email}\t${r.detail ?? ''}`)
      .join('\n');
  }

  async function onCopyFailed() {
    if (closing) return;
    const payload = failedRowsAsText();
    try {
      await navigator.clipboard.writeText(payload);
      pushToast(failed === 1 ? 'Copied 1 row' : `Copied ${failed} rows`, 'success');
    } catch {
      copyFallbackText = payload;
      copyFallbackVisible = true;
      await tick();
      copyFallbackEl?.focus();
      copyFallbackEl?.select();
    }
  }

  async function onDone() {
    if (closing) return;
    closing = true;
    try {
      await onRefetchBeforeSubmit();
    } catch {
      pushToast('Roster refresh failed — reload to see the latest.', 'error');
    } finally {
      onClose();
    }
  }

  function onCancel() {
    if (submitting) return;
    onClose();
  }

  function closeForCurrentStage() {
    if (submitting || closing) return;
    if (stage === 'paste') onClose();
    else void onDone();
  }
</script>

{#snippet check(size: number)}
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3.4,8.4 6.6,11.6 12.6,4.8" /></svg>
{/snippet}

{#snippet cross()}
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4.4" y1="4.4" x2="11.6" y2="11.6" /><line x1="11.6" y1="4.4" x2="4.4" y2="11.6" /></svg>
{/snippet}

{#snippet head()}
  <h2 id={titleId} class="ri-heading">Import roster from CSV</h2>
  <ol class="ri-steps">
    <li class="ri-step" class:ri-current={stage === 'paste'} aria-current={stage === 'paste' ? 'step' : undefined}>
      {#if stage === 'paste'}
        <span class="ri-dot ri-dot-on mono">1</span>
      {:else}
        <span class="ri-dot ri-dot-done">{@render check(10)}</span>
      {/if}
      <span>Paste</span>{#if stage === 'result'}<span class="vh"> (done)</span>{/if}
    </li>
    <li class="ri-step" class:ri-current={stage === 'result'} aria-current={stage === 'result' ? 'step' : undefined}>
      <span class="ri-rule" class:ri-rule-done={stage === 'result'} aria-hidden="true"></span>
      <span class="ri-dot mono" class:ri-dot-on={stage === 'result'}>2</span>
      <span>Result</span>
    </li>
  </ol>
{/snippet}

{#snippet foot()}
  {#if stage === 'paste'}
    <span class="ri-foot-note">Invalid rows are skipped, never guessed at.</span>
    <Button variant="ghost" data-action="cancel" onclick={onCancel}>Cancel</Button>
    <Button
      variant="primary"
      data-action="import"
      loading={submitting}
      disabled={!submitting && validCount === 0}
      title={!submitting && validCount === 0 ? 'No valid rows to import' : undefined}
      onclick={() => void onImport()}
    >{submitting ? 'Importing…' : validCount === 1 ? 'Import 1 valid row' : `Import ${validCount} valid rows`}</Button>
  {:else}
    <span class="ri-foot-note">{failed > 0 ? 'Failed rows can be copied as text and fixed in your sheet.' : ''}</span>
    {#if failed > 0}
      <Button variant="secondary" data-action="copy-failed" onclick={() => void onCopyFailed()}>Copy failed rows</Button>
    {/if}
    <Button variant="primary" data-action="done" aria-describedby={summaryId} bind:element={doneEl} onclick={() => void onDone()}>Done</Button>
  {/if}
{/snippet}

<Modal
  labelledby={titleId}
  width={760}
  maxHeight={720}
  onRequestClose={closeForCurrentStage}
  closeDisabled={submitting}
  header={head}
  footer={foot}
>
  {#if stage === 'paste'}
    <p class="ri-help" id={helpId}>Paste rows from Excel or Google Sheets, tab or comma separated. Columns: <code class="ri-col">name</code> optional, <code class="ri-col">email</code> required, <code class="ri-col">group</code> optional — a group that doesn't exist yet is created.</p>

    <textarea
      class="ri-paste"
      rows="7"
      aria-label="Rows to import"
      aria-describedby={helpId}
      data-autofocus
      readonly={submitting}
      value={text}
      oninput={onTextInput}
    ></textarea>

    {#if parsed && parsed.ok}
      <div class="ri-card">
        <table class="ri-table preview">
          <thead>
            <tr>
              <th scope="col" class="ri-num">#</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col" class="ri-group">Group</th>
              <th scope="col" class="ri-tile-col"><span class="vh">Status</span></th>
            </tr>
          </thead>
          <tbody>
            {#each parsed.rows.slice(0, PREVIEW_ROWS) as row (row.rowIndex)}
              {@const why = row.errors.join('; ')}
              <tr>
                <td class="ri-num mono">{row.rowIndex}</td>
                <td><span class="ri-line" title={row.parsed.name ?? undefined}>{#if row.parsed.name}{row.parsed.name}{:else}<span class="ri-none">—</span>{/if}</span></td>
                <td>
                  <span class="ri-line mono" title={row.parsed.email || undefined}>{#if row.parsed.email}{row.parsed.email}{:else}<span class="ri-none">—</span>{/if}</span>
                  {#if !row.valid}<span class="ri-why">{why}</span>{/if}
                </td>
                <td><span class="ri-line" title={row.parsed.group ?? undefined}>{#if row.parsed.group}{row.parsed.group}{:else}<span class="ri-none">—</span>{/if}</span></td>
                <td class="ri-tile-col">
                  {#if row.valid}
                    <span class="ri-tile ri-ok" role="img" aria-label="Valid" title="Valid">{@render check(11)}</span>
                  {:else}
                    <span class="ri-tile ri-skip" role="img" aria-label="Will skip" title={why}>{@render cross()}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="ri-counts">
        {#if parsed.rows.length > PREVIEW_ROWS}
          <p>Showing the first {PREVIEW_ROWS} of {parsed.rows.length} rows.{#if hiddenSkips.length > 0}{' '}{skipLine(hiddenSkips)}{/if}</p>
        {/if}
        <p>{parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`} — <span class="ri-key">{parsed.validCount} valid</span>, {parsed.invalidCount} will skip ({parsed.invalidCount - parsed.duplicateInPasteCount} invalid, {parsed.duplicateInPasteCount} duplicate in paste).</p>
        {#if parsed.willCreateGroups.length > 0}
          <p>Will create groups: {#each parsed.willCreateGroups as g, i (g)}{#if i > 0}, {/if}<span class="ri-key">{g}</span>{/each}.</p>
        {/if}
        {#if realMoves.length > 0}
          <p>Already enrolled, will be re-bucketed: {firstFive(realMoves)}.</p>
        {/if}
      </div>
    {:else if parsed && !parsed.ok}
      <p class="error ri-parse-error">{parsed.error}</p>
    {/if}

    {#if submitError}
      <p class="error ri-banner" role="alert">{submitError}</p>
    {/if}
  {:else if resultRows}
    <div class="ri-card">
      <table class="ri-table result">
        <thead>
          <tr>
            <th scope="col" class="ri-num">#</th>
            <th scope="col">Email</th>
            <th scope="col" class="ri-result">Result</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each resultRows as r, i (i)}
            {@const detail = detailFor(r)}
            <tr>
              <td class="ri-num mono">{i + 1}</td>
              <td><span class="ri-line mono" title={r.email}>{r.email}</span></td>
              <td>
                {#if r.status === 'added'}
                  <span class="badge badge-ok ri-chip ri-added">added</span>
                {:else}
                  <span class="badge badge-error ri-chip ri-failed" data-result="error" title={detail}>error</span>
                {/if}
              </td>
              <td>
                {#if r.status === 'error'}
                  <span class="ri-line ri-detail error-detail" title={detail}>{detail}</span>
                {:else if detail}
                  <span class="ri-line ri-detail" title={detail}>{detail}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="ri-summary" id={summaryId}><span class="ri-key">{added} added</span>, {failed} failed.</p>
    {#if copyFallbackVisible}
      <textarea class="copy-fallback ri-fallback" readonly aria-label="Failed rows" value={copyFallbackText} bind:this={copyFallbackEl}></textarea>
    {/if}
  {/if}
</Modal>

<style>
  .ri-heading { font-size: 15px; font-weight: 600; color: var(--text); }
  /* The step marker sits beside the title; the × keeps the right edge. */
  .ri-steps {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 auto 0 6px;
    padding: 0;
    list-style: none;
  }
  .ri-step { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .ri-current { font-weight: 500; color: var(--text); }
  .ri-rule {
    width: 14px;
    height: 1.5px;
    margin-right: 2px;
    background: var(--border-strong);
  }
  .ri-rule-done {
    background: var(--primary);
  }
  .ri-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: var(--border-soft);
    color: var(--muted);
    font-size: 9.5px;
    font-weight: 400;
  }
  .ri-dot-on {
    background: var(--primary);
    color: var(--primary-text);
    font-weight: 500;
  }
  .ri-dot-done {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-help { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--muted); }
  .ri-col { font-size: 12px; color: var(--text-3); }
  .ri-paste {
    box-sizing: border-box;
    width: 100%;
    min-height: 120px;
    padding: 8px 10px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--text-2);
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .ri-card { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .ri-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ri-table th {
    padding: 4px 5px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-3);
    text-align: left;
  }
  .ri-table td {
    padding: 4px 5px;
    border-bottom: 1px solid var(--border-soft);
    font-size: 12.5px;
    color: var(--text);
    vertical-align: middle;
  }
  .ri-table tr > :first-child { padding-left: 9px; }
  .ri-table tr > :last-child { padding-right: 9px; }
  .ri-table tbody tr:last-child td { border-bottom: 0; }
  .ri-num { width: 30px; font-size: 11px; color: var(--muted); }
  .ri-group { width: 110px; }
  /* The cells are border-box: the 18px tile plus the 5px / 9px padding. */
  .ri-tile-col { width: 32px; }
  .ri-result { width: 84px; }
  .ri-line { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ri-none { color: var(--muted); }
  .ri-why {
    display: block;
    font-size: 11.5px;
    color: var(--muted);
  }
  .ri-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }
  .ri-ok {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-skip {
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
  }
  .ri-counts { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .ri-counts p { margin: 0; }
  .ri-key { color: var(--text); }
  .ri-parse-error { margin: 0; font-size: 12.5px; color: var(--danger); }
  .ri-banner {
    margin: 0;
    padding: 8px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--danger-panel-fg);
  }
  .ri-chip {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .ri-added {
    background: var(--status-accepted-bg);
    color: var(--status-accepted-fg);
  }
  .ri-failed {
    background: var(--status-rejected-bg);
    color: var(--status-rejected-fg);
  }
  .ri-detail { font-size: 12px; color: var(--muted); }
  .ri-summary { margin: 0; font-size: 12.5px; color: var(--muted); }
  .ri-fallback {
    box-sizing: border-box;
    width: 100%;
    min-height: 80px;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
  }
  .ri-foot-note { flex: 1; font-size: 12.5px; color: var(--muted); }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
