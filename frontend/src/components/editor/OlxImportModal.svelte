<script lang="ts">
  // The Open edX import (spec: Flow): pick → reading → check → importing → done | failed | running.
  import { onDestroy, onMount, tick } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import AskSlot from '../ui/AskSlot.svelte';
  import { failureText } from '../../lib/api';
  import { getAuthConfig } from '../../lib/auth.svelte';
  import { navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import {
    focusAfter, InPlaceAsk, modalClose, modalPanel, refused, repairFocus, type Ask, type GuardAsk,
  } from '../../lib/askInPlace.svelte';
  import { readExport, ReadError, type ReadResult } from '../../lib/olx/readExport';
  import {
    assembleBuildBody, buildStatus, checkBuildSize, checkImport, createDraft, discardDraft, localDate, markPresent, reportText, runBuild,
    uploadAll, type BuildOutcome, type UploadProgress,
  } from '../../lib/olx/run';
  import type { CheckResponse, ImportLimits, ReportLine } from '../../lib/olx/types';
  import type { Version } from '../../lib/types';

  let { courseId, courseSlug, versions, onClose, onBusyChange, registerAsk }: {
    courseId: number;
    courseSlug: string;
    versions: Version[];
    onClose: () => void;
    onBusyChange: (busy: boolean) => void;
    registerAsk: (guard: (() => GuardAsk) | null) => void;
  } = $props();

  type Stage = 'pick' | 'reading' | 'check' | 'importing' | 'running' | 'done' | 'failed';
  type Failure = { message: string; canDiscard: boolean; retry: boolean };

  const MB = 1024 * 1024;
  const UNFINISHED = 'Open edX (unfinished):';
  const LIMITS_SENTENCE = "Could not read the site's file limits. Try again.";
  const UNKNOWN_REPORT = 'The draft was built, but its report could not be loaded.';
  const IMPORT_NAV_ASK: Ask = {
    warning: 'An import is running. Leaving stops it and leaves an unfinished draft.',
    confirmLabel: 'Leave', tone: 'danger', layout: 'row', confirmDataAction: 'confirm-leave-import',
  };
  const STOPPED = new Error('stopped');
  const GROUPS: [string, ReportLine['level']][] = [['Skipped', 'skipped'], ['Changed', 'changed'], ['Notes', 'note']];

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const navAsk = new InPlaceAsk();

  let stage = $state<Stage>('pick');
  let limits = $state.raw<ImportLimits | null>(null);
  let configFailed = $state(false);
  let exportFile = $state.raw<File | null>(null);
  let appFiles = $state.raw<File[]>([]);
  let readError = $state<string | null>(null);
  let read = $state.raw<ReadResult | null>(null);
  let check = $state.raw<CheckResponse | null>(null);
  let phase = $state<'create' | 'upload' | 'build'>('create');
  let done = $state(0);
  let total = $state(0);
  let failure = $state.raw<Failure | null>(null);
  let deleteError = $state<string | null>(null);
  let deleting = $state(false);
  let checking = $state(false);
  let result = $state.raw<{ report: ReportLine[] | null; label: string | null } | null>(null);
  // follows the page's list, which reloads after the window closes
  let removed = $state.raw(new Set<number>());
  const drafts = $derived(versions.filter((v) => v.state === 'created' && !v.is_disabled && v.label.startsWith(UNFINISHED) && !removed.has(v.id)));
  let draftsNote = $state('');
  let listBusy = $state<number | null>(null);
  let footEl = $state<HTMLElement>();
  let exportEl = $state<HTMLInputElement>();

  // Not reactive: the runner mutates it, and Retry must pass the same object.
  let vid: number | null = null;
  let progress: UploadProgress | null = null;
  let gone = false;

  const isBusy = (s: Stage) => s === 'reading' || s === 'importing';
  const busy = $derived(isBusy(stage));
  // Closing also waits for a Delete in flight.
  const locked = $derived(busy || deleting || listBusy !== null);
  const closeTitle = $derived(stage === 'reading' ? 'Wait until the export is checked'
    : busy ? 'Wait until the import finishes' : 'Wait until the draft is deleted');

  onMount(async () => {
    try {
      const c = await getAuthConfig();
      const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
      if (gone) return;
      if (!ok(c.max_file_mb) || !ok(c.max_total_mb)) { configFailed = true; return; }
      limits = { maxFileBytes: c.max_file_mb * MB, maxTotalBytes: c.max_total_mb * MB };
      await tick();
      // The field appears after the config, so the modal's autofocus went to ×.
      const a = document.activeElement;
      if (!gone && exportEl && (a === document.body || a === modalPanel(titleId) || a === modalClose(titleId))) exportEl.focus();
    } catch {
      if (!gone) configFailed = true;
    }
  });

  onDestroy(() => {
    gone = true;
    if (isBusy(stage)) onBusyChange(false);
    registerAsk(null);
    navAsk.dismiss();
  });

  /** The page guard's question, drawn in this footer while an import runs. */
  function guard(): GuardAsk {
    if (navAsk.open) { navAsk.focusCancel(); return refused(); }
    const promise = navAsk.ask(IMPORT_NAV_ASK).then((a) => {
      if (a === 'confirm') { navAsk.settle(); gone = true; onClose(); } // stop even if the page stays mounted
      else if (a === 'cancel') void focusAfter(() => modalPanel(titleId));
      return a === 'confirm';
    });
    return { promise, dismiss: () => navAsk.dismiss(), focusCancel: () => navAsk.focusCancel() };
  }

  function go(next: Stage) {
    const prev = stage;
    stage = next;
    if (isBusy(prev) !== isBusy(next)) onBusyChange(isBusy(next));
    if (next === 'importing' && prev !== 'importing') registerAsk(guard);
    if (prev === 'importing' && next !== 'importing') { registerAsk(null); navAsk.dismiss(); }
    void tick().then(() => {
      const first = next === 'check' ? footEl?.querySelector('[data-action="import"]') : next === 'pick' ? exportEl : null;
      return repairFocus(first, ...(footEl?.querySelectorAll('button') ?? []), exportEl);
    });
  }

  function fail(f: Failure) {
    failure = f;
    deleteError = null;
    go('failed');
  }

  function requestClose() {
    if (!locked) onClose();
  }

  function onExport(e: Event) {
    exportFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
    readError = null;
  }
  function onApps(e: Event) {
    appFiles = [...((e.currentTarget as HTMLInputElement).files ?? [])];
    readError = null;
  }

  async function runCheck() {
    if (stage !== 'pick' || !exportFile || !limits) return;
    readError = null;
    go('reading');
    try {
      const r = await readExport(exportFile, appFiles, limits);
      if (gone) return;
      const tooLarge = checkBuildSize(r.body, r.report);
      if (tooLarge) throw new ReadError(tooLarge);
      const c = await checkImport(courseId, r.body);
      if (gone) return;
      read = r;
      check = c;
      go('check');
    } catch (e) {
      if (gone) return;
      readError = e instanceof ReadError ? e.message : failureText(e, 'The export could not be checked.');
      go('pick');
    }
  }

  async function startImport() {
    if (stage !== 'check' || !check || !read || check.blocking) return;
    phase = 'create';
    go('importing');
    try {
      const v = await createDraft(courseId, check.label, check.max_quiz_attempts);
      if (gone) return;
      vid = v.id;
      progress = { outcome: new Map(), lines: [], uncertain: new Set() };
      await uploadAndBuild();
    } catch (e) {
      stopped(e);
    }
  }

  async function retry() {
    if (stage !== 'failed' || !failure?.retry || vid === null || !progress || !check) return;
    go('importing');
    try {
      await markPresent(vid, check.uploads, progress);
    } catch {
      if (!gone) fail({ message: 'Could not check which files are already in the draft. Press Retry.', canDiscard: true, retry: true });
      return;
    }
    try {
      await uploadAndBuild();
    } catch (e) {
      stopped(e);
    }
  }

  function stopped(e: unknown) {
    if (gone || e === STOPPED) return;
    fail({ message: failureText(e, 'The import stopped.'), canDiscard: vid !== null, retry: false });
  }

  async function uploadAndBuild() {
    if (vid === null || !progress || !check || !read) return;
    phase = 'upload';
    const halt = () => { if (gone) throw STOPPED; }; // a confirmed Leave sends no further request
    const res = await uploadAll(vid, check.uploads, read.blobs, new Set(check.linked), progress, (d, t) => {
      halt();
      done = d;
      total = t;
    }, undefined, halt);
    if (gone) return;
    if (res.kind !== 'done') { fail({ message: res.message, canDiscard: true, retry: res.kind === 'retry' }); return; }
    phase = 'build';
    const body = assembleBuildBody(read.body, read.report, progress, localDate());
    if (body.kind === 'too-large') { fail({ message: body.message, canDiscard: true, retry: false }); return; }
    const out = await runBuild(vid, body.body);
    if (!gone) apply(out);
  }

  function apply(out: BuildOutcome) {
    if (out.kind === 'done') { result = { report: out.report, label: out.label }; go('done'); }
    else if (out.kind === 'committed-unknown') { result = { report: null, label: null }; go('done'); }
    else if (out.kind === 'running') go('running');
    else fail({ message: out.message, canDiscard: out.canDiscard, retry: false });
  }

  async function checkAgain() {
    if (stage !== 'running' || vid === null || checking) return;
    checking = true;
    const out = await buildStatus(vid);
    checking = false;
    if (!gone) apply(out);
  }

  async function deleteDraft() {
    if (stage !== 'failed' || vid === null || deleting) return;
    deleting = true;
    deleteError = null;
    const r = await discardDraft(vid);
    deleting = false;
    if (gone) return;
    if (r === 'deleted') { pushToast('The unfinished draft was deleted.', 'success'); onClose(); }
    else if (r === 'built') { result = { report: null, label: null }; go('done'); }
    else deleteError = 'Could not delete the draft. Try again.';
  }

  async function deleteListed(v: Version) {
    if (listBusy !== null || busy) return;
    listBusy = v.id;
    const r = await discardDraft(v.id);
    listBusy = null;
    if (gone) return;
    const at = drafts.findIndex((x) => x.id === v.id);
    if (r === 'failed') { draftsNote = `Could not delete “${v.label}”. Try again.`; return; }
    removed = new Set([...removed, v.id]);
    draftsNote = r === 'built' ? `“${v.label}” was built meanwhile, so it was kept.` : `“${v.label}” was deleted.`;
    const next = drafts[at] ?? drafts[at - 1];
    void repairFocus(next ? document.getElementById(`${uid}-draft-${next.id}`)?.closest('button') : null, exportEl);
  }

  function openDraft() {
    if (vid !== null) navigate(`/courses/${courseSlug}/edit/v/${vid}`);
  }

  function saveReport() {
    if (!result?.report) return;
    const blob = new Blob([reportText(result.report, [])], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `open-edx-import-${localDate()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const count = (n: number | undefined, one: string, many: string) => `${n ?? 0} ${n === 1 ? one : many}`;
  function summaryLine(s: Record<string, number>): string {
    const bytes = s.bytes ?? 0;
    const kb = Math.round(bytes / 1024);
    const size = kb < 1024 ? `${bytes > 0 ? Math.max(1, kb) : 0} KB` : `${Math.round(bytes / MB)} MB`;
    return `${count(s.blocks, 'block', 'blocks')}, ${count(s.sequences, 'sequence', 'sequences')}, ${count(s.items, 'item', 'items')}: `
      + `${count(s.videos, 'video', 'videos')}, ${count(s.pages, 'page', 'pages')}, ${count(s.apps, 'app', 'apps')}, `
      + `${count(s.quizzes, 'quiz', 'quizzes')}; ${count(s.files, 'file', 'files')}, ${size}`;
  }

  const checkLines = $derived(read && check ? [...read.report, ...check.report] : []);
</script>

{#snippet head()}
  <h2 id={titleId} class="olx-heading">Import from Open edX</h2>
{/snippet}

{#snippet report(lines: ReportLine[])}
  <div class="olx-report">
    {#each GROUPS as [title, level] (level)}
      {@const ls = lines.filter((l) => l.level === level)}
      {#if ls.length}
        <section class="olx-group">
          <h3 class="olx-group-title">{title} <span class="olx-count">{ls.length}</span></h3>
          <ul class="olx-lines">
            {#each ls as l, i (i)}<li>{l.where ? `${l.where}: ` : ''}{l.text}</li>{/each}
          </ul>
        </section>
      {/if}
    {/each}
    {#if lines.length === 0}<p class="olx-muted">Nothing to report.</p>{/if}
  </div>
{/snippet}

{#snippet foot()}
  <div class="olx-foot" bind:this={footEl}>
    {#if navAsk.open}
      <AskSlot ask={navAsk} />
    {:else if stage === 'pick' || stage === 'reading'}
      <span class="olx-foot-note">Nothing is sent until you press Check.</span>
      <Button variant="ghost" data-action="cancel" disabled={locked} onclick={requestClose}>Cancel</Button>
      {#if limits}
        <Button data-action="check" loading={stage === 'reading'} disabled={!exportFile && stage === 'pick'} onclick={() => void runCheck()}>Check</Button>
      {/if}
    {:else if stage === 'check'}
      <span class="olx-foot-note">{check?.blocking ? 'Fix the problems above in Open edX, then export again.' : ''}</span>
      <Button variant="ghost" data-action="cancel" onclick={requestClose}>Cancel</Button>
      <Button data-action="import" disabled={!!check?.blocking} onclick={() => void startImport()}>Import</Button>
    {:else if stage === 'importing'}
      <span class="olx-foot-note">Keep this tab open until the import finishes.</span>
    {:else if stage === 'running'}
      <span class="olx-foot-note"></span>
      <Button variant="ghost" data-action="close" onclick={requestClose}>Close</Button>
      <Button data-action="check-again" loading={checking} onclick={() => void checkAgain()}>Check again</Button>
    {:else if stage === 'done'}
      <span class="olx-foot-note"></span>
      {#if result?.report}<Button variant="secondary" data-action="save-report" onclick={saveReport}>Save report</Button>{/if}
      <Button data-action="open-draft" onclick={openDraft}>Open the draft</Button>
    {:else if stage === 'failed' && failure}
      <span class="olx-foot-note"></span>
      {#if failure.retry}<Button variant="secondary" data-action="retry" disabled={deleting} onclick={() => void retry()}>Retry</Button>{/if}
      {#if failure.canDiscard}
        <Button variant="ghost" data-action="keep" disabled={deleting} onclick={onClose}>Keep it</Button>
        <Button variant="danger" data-action="delete-draft" loading={deleting} onclick={() => void deleteDraft()}>Delete the unfinished draft</Button>
      {:else}
        <Button variant="ghost" data-action="close" onclick={onClose}>Close</Button>
      {/if}
    {/if}
  </div>
{/snippet}

<Modal
  labelledby={titleId}
  width={720}
  maxHeight={720}
  onRequestClose={requestClose}
  closeDisabled={locked}
  closeOnBackdrop={false}
  {closeTitle}
  header={head}
  footer={foot}
>
  {#if stage === 'pick' || stage === 'reading'}
    {#if drafts.length}
      <section class="olx-drafts" aria-label="Unfinished imports">
        <h3 class="olx-group-title">Unfinished imports</h3>
        <p class="olx-muted">An import still running in another tab shows here too; deleting it stops that import.</p>
        <ul class="olx-draft-list">
          {#each drafts as v (v.id)}
            <li class="olx-draft">
              <span class="olx-draft-label">{v.label}</span>
              <Button variant="ghost" aria-label={`Delete ${v.label}`} disabled={busy || listBusy !== null} loading={listBusy === v.id}
                onclick={() => void deleteListed(v)}><span id={`${uid}-draft-${v.id}`}>Delete</span></Button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if draftsNote}<p class="olx-drafts-note olx-muted" role="status">{draftsNote}</p>{/if}
    {#if configFailed}
      <p class="olx-error" role="alert">{LIMITS_SENTENCE}</p>
    {:else if limits}
      <label class="olx-field">Open edX export (.tar.gz, .tgz or .tar)
        <input bind:this={exportEl} class="olx-file" type="file" data-role="export" data-autofocus accept=".tar.gz,.tgz,.tar,.gz"
          disabled={busy} onchange={onExport} />
      </label>
      <label class="olx-field">App files (.js), optional
        <input class="olx-file" type="file" data-role="apps" accept=".js" multiple disabled={busy} onchange={onApps} />
      </label>
      {#if stage === 'reading'}<p class="olx-status" role="status">Reading the export and checking it…</p>{/if}
      {#if readError}<p class="olx-error" role="alert">{readError}</p>{/if}
    {:else}
      <p class="olx-status" role="status">Reading the site's file limits…</p>
    {/if}
  {:else if stage === 'check' && check}
    <p class="olx-summary">{summaryLine(check.summary)}</p>
    {#if check.blockers.length}
      <section class="olx-blockers" role="alert">
        <h3 class="olx-group-title">Problems that stop the import</h3>
        <ul class="olx-lines">
          {#each check.blockers as l, i (i)}<li>{l.where ? `${l.where}: ` : ''}{l.text}</li>{/each}
        </ul>
      </section>
    {/if}
    {@render report(checkLines)}
  {:else if stage === 'importing'}
    <p class="olx-status" role="status">
      {#if phase === 'create'}Creating the draft…{:else if phase === 'upload'}Uploading files: {done} of {total}{:else}Building the course…{/if}
    </p>
  {:else if stage === 'running'}
    <p class="olx-running" role="status">The import is still being built. Check again in a moment.</p>
  {:else if stage === 'done' && result}
    {#if result.report}
      <p class="olx-done">Imported as “{result.label}”.</p>
      {@render report(result.report)}
    {:else}
      <p class="olx-done-note" role="status">{UNKNOWN_REPORT}</p>
    {/if}
  {:else if stage === 'failed' && failure}
    <p class="olx-failed" role="alert">{failure.message}</p>
    {#if failure.canDiscard}
      <p class="olx-keep-note olx-muted">Keep it leaves the draft in the list, but this import cannot be resumed.</p>
    {/if}
    {#if deleteError}<p class="olx-error" role="alert">{deleteError}</p>{/if}
  {/if}
</Modal>

<style>
  .olx-heading { font-size: 15px; font-weight: 600; color: var(--text); }
  .olx-foot { display: contents; }
  .olx-foot-note { flex: 1; font-size: 12.5px; color: var(--muted); }
  .olx-field { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--muted); }
  .olx-file { font-size: 13px; color: var(--text); }
  .olx-muted { margin: 0; font-size: 12.5px; color: var(--muted); }
  .olx-status { margin: 0; font-size: 13px; color: var(--text-2); }
  .olx-running { margin: 0; font-size: 13px; color: var(--text-2); }
  .olx-summary {
    margin: 0;
    padding: 9px 11px;
    background: var(--surface-2);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--text);
  }
  .olx-error,
  .olx-failed {
    margin: 0;
    padding: 8px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    font-size: 13px;
    color: var(--danger-panel-fg);
  }
  .olx-blockers {
    padding: 8px 12px;
    background: var(--danger-panel-bg);
    border-left: 3px solid var(--danger);
    border-radius: var(--radius);
    color: var(--danger-panel-fg);
  }
  .olx-done { margin: 0; font-size: 13px; color: var(--text); }
  .olx-done-note { margin: 0; font-size: 13px; color: var(--text-2); }
  .olx-report { display: flex; flex-direction: column; gap: 10px; }
  .olx-group-title { margin: 0 0 4px; font-size: 12.5px; font-weight: 600; color: var(--text-3); }
  .olx-count { font-weight: 400; color: var(--muted); }
  .olx-lines { margin: 0; padding: 0 0 0 16px; font-size: 12.5px; line-height: 1.5; color: var(--text); overflow-wrap: anywhere; }
  .olx-drafts { padding: 9px 11px; border: 1px solid var(--border); border-radius: var(--radius); }
  .olx-draft-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
  .olx-draft { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); }
  .olx-draft-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
