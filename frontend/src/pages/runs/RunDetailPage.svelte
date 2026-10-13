<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { deleteRun, getRun, listVersions, publishRun, unpublishRun } from '../../lib/runs';
  import { listRunTeachers } from '../../lib/runTeachers';
  import { listGroups } from '../../lib/runGroups';
  import { listRunStudents } from '../../lib/runRoster';
  import { runStatus } from '../../lib/runStatus';
  import { currentRoute, navigate } from '../../lib/router.svelte';
  import { pushToast } from '../../stores/toasts.svelte';
  import { session } from '../../stores/session.svelte';
  import LoadingPlaceholder from '../../components/ui/LoadingPlaceholder.svelte';
  import RunOverviewTab, {
    type DeleteOutcome, type PublishOutcome, type Readiness, type ReadinessRow, type UnpublishOutcome,
  } from '../../components/runs/RunOverviewTab.svelte';
  import RunTeachersTab from '../../components/runs/RunTeachersTab.svelte';
  import RunGroupsTab from '../../components/runs/RunGroupsTab.svelte';
  import RunRosterTab from '../../components/runs/RunRosterTab.svelte';
  import RosterImportModal from '../../components/runs/RosterImportModal.svelte';
  import RunMiniProjectsTab from '../../components/runs/RunMiniProjectsTab.svelte';
  import RunAssetsTab from '../../components/runs/RunAssetsTab.svelte';
  import RunProgressTab from '../../components/runs/RunProgressTab.svelte';
  import RunSubmissionTab from '../../components/runs/RunSubmissionTab.svelte';
  import PublishConflictsModal from '../../components/runs/PublishConflictsModal.svelte';
  import { listBlocks } from '../../lib/blocks';
  import { listMiniProjects } from '../../lib/miniProjects';
  import { listRunAssets } from '../../lib/runAssets';
  import { RUN_TABS, isRunPath, isTabKey, parseTab, rawTab, withTab, withoutTab, type ActiveTab } from '../../lib/runTabs';
  import ErrorState from '../../components/ui/ErrorState.svelte';
  import RunStatusChip from '../../components/runs/RunStatusChip.svelte';
  import TeachingCrumbs from '../../components/runs/TeachingCrumbs.svelte';
  import type {
    Course, Version, RunResponse, RunTeacherResponse, GroupResponse, RunStudentResponse,
    BlockResponse, MiniProjectResponse, RunAssetResponse, PublishConflict,
  } from '../../lib/types';

  let { courseSlug, runId }: { courseSlug: string; runId: string } = $props();

  const runIdInt = $derived.by(() => {
    const n = Number(runId);
    return Number.isInteger(n) && n > 0 ? n : null;
  });

  let course = $state<Course | null>(null);
  let run = $state<RunResponse | null>(null);
  let versions = $state<Version[] | null>(null);
  let teachers = $state<RunTeacherResponse[] | null>(null);
  let groups = $state<GroupResponse[] | null>(null);
  let students = $state<RunStudentResponse[] | null>(null);
  let blocks = $state<BlockResponse[] | null>(null);
  let miniProjects = $state<MiniProjectResponse[] | null>(null);
  let assets = $state<RunAssetResponse[] | null>(null);
  let pendingEditTarget = $state<MiniProjectResponse | null>(null);
  let loadError = $state<ApiError | null>(null);

  // R1/R10: the address is the one source of truth for the open tab.
  const activeTab = $derived(parseTab(currentRoute.search));
  const tabEls: Partial<Record<ActiveTab, HTMLButtonElement>> = {};

  // An unknown ?tab is rewritten once, dropping only `tab` (P11: force, since
  // nothing can be open on a tab that was never shown). A missing one is left.
  $effect(() => {
    const path = currentRoute.path;
    const search = currentRoute.search;
    if (!isRunPath(path)) return;
    const raw = rawTab(search);
    if (raw === null || isTabKey(raw)) return;
    untrack(() => {
      void navigate(path + withoutTab(search) + currentRoute.hash, { replace: true, force: true });
    });
  });

  // Every tab switch. The registered unsaved-changes guards may cancel the
  // navigate; the extras apply only when the address really shows `tab`.
  // focusTab is for jumps from inside a panel (the clicked control unmounts);
  // a tab-button click keeps its own focus. P10: focus first, then the edit
  // target, so the modal's FocusTrap returns focus to the tab.
  async function setTab(
    tab: ActiveTab,
    opts: { prefilter?: 'unassigned' | null; editTarget?: MiniProjectResponse; focusTab?: boolean } = {},
  ): Promise<void> {
    await navigate(currentRoute.path + withTab(currentRoute.search, tab) + currentRoute.hash, { replace: true });
    if (parseTab(currentRoute.search) !== tab) return;
    if (opts.prefilter !== undefined) rosterPrefilter = opts.prefilter;
    if (!opts.focusTab && !opts.editTarget) return;
    await tick();
    if (opts.focusTab) tabEls[tab]?.focus();
    if (opts.editTarget) pendingEditTarget = opts.editTarget;
  }
  const isAdmin = $derived(course?.is_admin === true);
  const isThisRunTeacher = $derived(
    session.user != null && (teachers ?? []).some((t) => t.user_id === session.user!.id),
  );
  let rosterPrefilter = $state<'unassigned' | null>(null);
  let showImportModal = $state(false);

  function onPrefilterClear() {
    rosterPrefilter = null;
  }

  let loadToken = 0;

  async function loadAll(slug: string, rid: number) {
    const myToken = ++loadToken;
    // R33: a run change, a course change or reloadRun() frees a stuck publish.
    publishing = false; unpublishing = false;
    course = null; run = null; versions = null; teachers = null;
    groups = null; students = null; blocks = null; miniProjects = null;
    assets = null; pendingEditTarget = null;
    loadError = null;
    try {
      const c = await api.get<Course>(`/api/courses/by-slug/${slug}`);
      if (myToken !== loadToken) return;
      const [r, vs, ts, gs, ss, as] = await Promise.all([
        getRun(rid),
        listVersions(c.id),
        listRunTeachers(rid),
        listGroups(rid),
        listRunStudents(rid),
        listRunAssets(rid),
      ]);
      if (myToken !== loadToken) return;
      // Compute pinned from LOCAL destructured values, NOT the `pinned` $derived
      // (which reads `versions`/`run` $state, still null at this point).
      const pinnedVersion = vs.find((v) => v.id === r.version_id) ?? null;
      let blocksResult: BlockResponse[] = [];
      let mpsResult: MiniProjectResponse[] = [];
      if (pinnedVersion != null) {
        [blocksResult, mpsResult] = await Promise.all([
          listBlocks(pinnedVersion.id),
          listMiniProjects(rid),
        ]);
        if (myToken !== loadToken) return;
      }
      course = c; run = r; versions = vs; teachers = ts; groups = gs; students = ss;
      blocks = blocksResult;
      miniProjects = mpsResult;
      assets = as;
    } catch (e) {
      if (myToken !== loadToken) return;
      if (e instanceof ApiError && e.status === 401) return;
      loadError = (e instanceof ApiError) ? e : new ApiError(500, 'Failed to load run.');
    }
  }

  async function refetchMiniProjects(): Promise<void> {
    if (runIdInt === null || !pinnedAvailable) return;
    const rid = runIdInt;
    const myToken = loadToken;
    const fetched = await listMiniProjects(rid);
    // Drop if a runId change or loadAll fired while we were in flight:
    // writing here would overwrite the new run's miniProjects with stale data.
    if (myToken !== loadToken || rid !== runIdInt || !pinnedAvailable) return;
    miniProjects = fetched;
  }

  // Run-scoped (no pinnedAvailable gate). Token + rid guards mirror
  // refetchMiniProjects so a runId change mid-fetch drops the stale write.
  async function refetchAssets(): Promise<void> {
    if (runIdInt === null) return;
    const rid = runIdInt;
    const myToken = loadToken;
    const fetched = await listRunAssets(rid);
    if (myToken !== loadToken || rid !== runIdInt) return;
    assets = fetched;
  }

  async function reloadRun(): Promise<void> {
    if (runIdInt === null) return;
    await loadAll(courseSlug, runIdInt);
  }

  async function refetchRosterData(): Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }> {
    if (runIdInt === null) return { students: [], groups: [] };
    const [ss, gs] = await Promise.all([listRunStudents(runIdInt), listGroups(runIdInt)]);
    students = ss;
    groups = gs;
    return { students: ss, groups: gs };
  }

  async function refetchTeachers(): Promise<void> {
    if (runIdInt === null) return;
    teachers = await listRunTeachers(runIdInt);
  }

  async function refetchGroups(): Promise<void> {
    if (runIdInt === null) return;
    groups = await listGroups(runIdInt);
  }

  async function refetchGroupsAndStudents(): Promise<void> {
    if (runIdInt === null) return;
    const [gs, ss] = await Promise.all([listGroups(runIdInt), listRunStudents(runIdInt)]);
    groups = gs;
    students = ss;
  }

  // R39: the import modal outlives a tab change. Closed while another tab is
  // open, its opener is gone and focus would fall to <body>: take the tab.
  async function closeImport(): Promise<void> {
    showImportModal = false;
    await tick();
    const active = document.activeElement;
    if (!active || active === document.body) tabEls[activeTab]?.focus();
  }

  $effect(() => {
    void courseSlug;
    if (runIdInt === null) return;
    loadAll(courseSlug, runIdInt);
  });

  $effect(() => {
    void runIdInt;
    rosterPrefilter = null;
    showImportModal = false;
    publishModalOpen = false;
    publishConflicts = [];
  });

  function gotoTab(tab: ActiveTab, prefilter?: 'unassigned' | null) {
    void setTab(tab, { prefilter: prefilter ?? null, focusTab: true });
  }

  const pinned = $derived(versions?.find((v) => v.id === run?.version_id));
  const showDisabledBanner = $derived(pinned?.is_disabled === true);
  const pinnedAvailable = $derived(versions == null || pinned != null);

  const metaLine = $derived.by(() => {
    if (!run || !students || !groups) return '';
    const parts = [`${students.length} ${students.length === 1 ? 'student' : 'students'}`];
    if (run.groups_enabled) parts.push(`${groups.length} ${groups.length === 1 ? 'group' : 'groups'}`);
    parts.push(`v. ${run.version_id}`);
    return parts.join(' · ');
  });

  // R34: the rows in the order of the server's publish checks (api/runs.py
  // publish_run): a teacher, an enabled version, no unassigned student, no
  // oversized group. No students and no groups are fine.
  const readiness = $derived.by((): Readiness => {
    if (!run || teachers === null || groups === null || students === null) return { checks: [] };
    const checks: ReadinessRow[] = [];
    const teacherLabel = 'At least one teacher assigned';
    checks.push(teachers.length > 0
      ? { id: 'teacher', label: teacherLabel, state: 'ok' }
      : { id: 'teacher', label: teacherLabel, state: 'violated', hint: 'Add a teacher — open Teachers', hintTab: 'teachers', reason: 'No teacher is assigned yet' });
    const versionLabel = 'Course version enabled';
    if (!pinned) checks.push({ id: 'version', label: versionLabel, state: 'na' });
    else if (pinned.is_disabled) {
      checks.push({
        id: 'version', label: versionLabel, state: 'violated',
        hint: isAdmin ? 'Re-enable it in the course editor' : 'Ask a course admin to re-enable it',
        reason: 'The course version is disabled',
      });
    } else checks.push({ id: 'version', label: versionLabel, state: 'ok' });
    const assignedLabel = 'Every student assigned to a group';
    const sizesLabel = 'No group over 10 students';
    if (!run.groups_enabled) {
      checks.push({ id: 'assigned', label: assignedLabel, state: 'na' }, { id: 'sizes', label: sizesLabel, state: 'na' });
      return { checks };
    }
    const unassigned = students.filter((s: RunStudentResponse) => s.group_id === null).length;
    if (unassigned === 0) checks.push({ id: 'assigned', label: assignedLabel, state: 'ok' });
    else {
      checks.push({
        id: 'assigned', label: assignedLabel, state: 'violated',
        hint: groups.length === 0 ? 'No groups yet — open Groups' : `${unassigned} unassigned — open Roster`,
        hintTab: groups.length === 0 ? 'groups' : 'roster',
        reason: unassigned === 1 ? '1 student is still unassigned to a group' : `${unassigned} students are still unassigned to a group`,
      });
    }
    const oversized = groups.filter((g: GroupResponse) => g.student_count > 10);
    if (oversized.length === 0) checks.push({ id: 'sizes', label: sizesLabel, state: 'ok' });
    else {
      const list = oversized.map((g: GroupResponse) => `${g.name} (${g.student_count})`).join(', ');
      checks.push({ id: 'sizes', label: sizesLabel, state: 'violated', hint: list, reason: `Groups over 10 students: ${list}` });
    }
    return { checks };
  });

  let publishConflicts: PublishConflict[] = $state([]);
  let publishModalOpen = $state(false);
  // R33: one publish / unpublish request at a time. Each flag clears only on
  // its own load token; loadAll resets both.
  let publishing = $state(false);
  let unpublishing = $state(false);

  // After a publish 409 the page may be stale: read back what the rows use.
  async function refetchReadiness(rid: number, myToken: number): Promise<void> {
    if (!course) return;
    try {
      const [r, vs, ts, gs, ss] = await Promise.all([
        getRun(rid), listVersions(course.id), listRunTeachers(rid), listGroups(rid), listRunStudents(rid),
      ]);
      if (myToken !== loadToken) return;
      run = r; versions = vs; teachers = ts; groups = gs; students = ss;
    } catch { /* the toast already said why; the page keeps what it had */ }
  }

  async function doPublish(): Promise<PublishOutcome> {
    if (runIdInt === null || publishing || unpublishing) return 'failed';
    const myToken = loadToken;
    const rid = runIdInt;
    publishing = true;
    try {
      const r = await publishRun(rid);
      if (myToken !== loadToken) return 'failed';
      run = r;
      return 'published';
    } catch (e) {
      if (myToken !== loadToken) return 'failed';
      if (e instanceof ApiError && e.errorCode === 'student_already_active_in_course') {
        const raw = (e.body as { conflicts?: unknown } | undefined)?.conflicts;
        const conflicts: PublishConflict[] = Array.isArray(raw) ? (raw as PublishConflict[]) : [];
        if (conflicts.length === 0) {
          pushToast(e.displayMessage, 'error');
          return 'failed';
        }
        publishConflicts = conflicts;
        publishModalOpen = true;
        return 'conflicts';
      }
      if (e instanceof ApiError) {
        pushToast(e.displayMessage, 'error');
        // Published elsewhere, or a check this page missed: read the run back.
        if (e.status === 409) {
          await refetchReadiness(rid, myToken);
          if (myToken === loadToken && run?.is_published) return 'published';
        }
      }
      return 'failed';
    } finally {
      if (myToken === loadToken) publishing = false;
    }
  }

  async function doUnpublish(): Promise<UnpublishOutcome> {
    if (runIdInt === null || publishing || unpublishing) return 'failed';
    const myToken = loadToken;
    const rid = runIdInt;
    unpublishing = true;
    try {
      const r = await unpublishRun(rid);
      if (myToken !== loadToken) return 'failed';
      run = r;
      return 'unpublished';
    } catch (e) {
      if (myToken !== loadToken) return 'failed';
      if (e instanceof ApiError) {
        pushToast(e.displayMessage, 'error');
        // 409 "Run is not published": another tab unpublished first.
        if (e.status === 409) {
          try {
            const r = await getRun(rid);
            if (myToken !== loadToken) return 'failed';
            run = r;
            if (!r.is_published) return 'draft-now';
          } catch { /* refetch failed; toast already shown */ }
        }
      }
      return 'failed';
    } finally {
      if (myToken === loadToken) unpublishing = false;
    }
  }

  // D24 / D28 / P24: a forced delete; a 409 means the run was published meanwhile.
  async function onDeleteRun(): Promise<DeleteOutcome> {
    if (runIdInt === null) return { kind: 'failed', message: 'Invalid run.' };
    const myToken = loadToken;
    const rid = runIdInt;
    try {
      await deleteRun(rid, { force: true });
      pushToast('Run deleted.', 'success');
      void navigate(`/teaching/${encodeURIComponent(courseSlug)}`);
      return { kind: 'deleted' };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const r = await getRun(rid);
          if (myToken === loadToken) run = r;
        } catch { /* keep the page as it is; the toast explains */ }
        pushToast('This run was published in the meantime. Unpublish it before deleting.', 'error');
        return { kind: 'published-now' };
      }
      return { kind: 'failed', message: e instanceof ApiError ? e.displayMessage : 'Could not delete the run.' };
    }
  }
</script>

{#snippet backToTeaching()}
  <a href="/teaching" onclick={(e) => { e.preventDefault(); void navigate('/teaching'); }}>Back to Teaching</a>
{/snippet}

<div class="run-page">
  {#if runIdInt === null}
    <ErrorState variant="page" title="Invalid run." action={backToTeaching} />
  {:else if loadError}
    <ErrorState variant="page" title={loadError.displayMessage} action={backToTeaching} />
  {:else if course === null || run === null || versions === null || teachers === null || groups === null || students === null || blocks === null || miniProjects === null || assets === null}
    <LoadingPlaceholder label="Loading run…" />
  {:else}
    <header class="run-head">
      <TeachingCrumbs course={course} runTitle={run.title} />
      <div class="run-title-row">
        <h1>{run.title}</h1>
        <RunStatusChip status={runStatus(run)} />
        <p class="run-meta">{metaLine}</p>
      </div>
    </header>

    {#if showDisabledBanner}
      <div class="run-banner-warn">
        {#if course.is_admin}
          This run's course version is disabled. Re-enable it under Course Editor before publishing.
        {:else}
          This run's course version is disabled. Some editing actions are locked until a course admin re-enables it.
        {/if}
      </div>
    {/if}

    <div class="run-tabs" role="tablist" aria-label="Run sections">
      {#each RUN_TABS as t (t.key)}
        <button
          type="button"
          class="run-tab"
          role="tab"
          id="run-tab-{t.key}"
          aria-selected={activeTab === t.key}
          aria-controls="run-panel"
          bind:this={tabEls[t.key]}
          onclick={() => void setTab(t.key)}
        >{t.label}</button>
      {/each}
    </div>

    <div class="run-panel" id="run-panel" role="tabpanel" aria-labelledby="run-tab-{activeTab}">
      {#if activeTab === 'overview'}
        <RunOverviewTab
          {run}
          setRun={(r) => (run = r)}
          {pinned}
          {isAdmin}
          {readiness}
          publishing={publishing || unpublishing}
          onNavigateTab={gotoTab}
          onPublish={doPublish}
          onUnpublish={doUnpublish}
          {onDeleteRun}
        />
      {:else if activeTab === 'progress'}
        <RunProgressTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} blocks={blocks ?? []} />
      {:else if activeTab === 'submissions'}
        <RunSubmissionTab runId={run.id} {isAdmin} isTeacher={isThisRunTeacher} blocks={blocks ?? []} />
      {:else if activeTab === 'roster'}
        <RunRosterTab
          runId={runIdInt!}
          runIsPublished={run.is_published}
          {isAdmin}
          {courseSlug}
          onNavigateToTab={(t) => void setTab(t, { focusTab: true })}
          {students}
          {groups}
          groupsEnabled={run.groups_enabled}
          {rosterPrefilter}
          {onPrefilterClear}
          onRefetchRosterData={refetchRosterData}
          onRefetchGroupsOnly={refetchGroups}
          onOpenImport={() => (showImportModal = true)}
        />
      {:else if activeTab === 'groups'}
        <RunGroupsTab
          runId={runIdInt!}
          {groups}
          groupsEnabled={run.groups_enabled}
          onRefetchGroups={refetchGroups}
          onRefetchGroupsAndStudents={refetchGroupsAndStudents}
          course={course!}
          runIsPublished={run.is_published}
          onGotoOverview={() => void setTab('overview', { focusTab: true })}
        />
      {:else if activeTab === 'mini-projects'}
        <RunMiniProjectsTab
          runId={runIdInt!}
          runIsPublished={run.is_published}
          runGroupsEnabled={run.groups_enabled}
          runEndDate={run.end_date}
          versionIsDisabled={showDisabledBanner}
          {pinnedAvailable}
          blocks={blocks ?? []}
          miniProjects={miniProjects ?? []}
          onRefetchMiniProjects={refetchMiniProjects}
          onRefetchAssets={refetchAssets}
          onNavigateToTab={(t) => void setTab(t, { focusTab: true })}
          pendingEditTarget={pendingEditTarget}
          onPendingEditConsumed={() => (pendingEditTarget = null)}
          course={course!}
        />
      {:else if activeTab === 'assets'}
        <RunAssetsTab
          runId={runIdInt!}
          assets={assets ?? []}
          miniProjects={miniProjects ?? []}
          course={course!}
          versionIsDisabled={showDisabledBanner}
          onRefetchAssets={refetchAssets}
          onRefetchMiniProjects={refetchMiniProjects}
          onEditMiniProject={(mp) => void setTab('mini-projects', { editTarget: mp, focusTab: true })}
          onReloadRun={reloadRun}
          blocks={blocks ?? []}
        />
      {:else if activeTab === 'teachers'}
        <RunTeachersTab runId={runIdInt!} {teachers} onRefetch={refetchTeachers} course={course!} />
      {/if}
    </div>
    {#if showImportModal}
      <RosterImportModal
        runId={runIdInt!}
        existingRoster={students}
        existingGroups={groups}
        onRefetchBeforeSubmit={refetchRosterData}
        onClose={closeImport}
      />
    {/if}
  {/if}
</div>

<PublishConflictsModal
  open={publishModalOpen}
  conflicts={publishConflicts}
  onClose={() => { publishModalOpen = false; publishConflicts = []; }}
/>

<style>
  /* Lines up with the header's own side padding (AppHeader: 0 var(--space-3)). */
  .run-page { max-width: var(--page-max); margin: 0 auto; padding: var(--space-3) var(--space-3) var(--space-4); }
  .run-head { display: flex; flex-direction: column; gap: 8px; }
  .run-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .run-title-row h1 { margin: 0; font-size: 18px; font-weight: 600; color: var(--text); }
  .run-meta { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
  .run-banner-warn {
    margin: 12px 0 0;
    padding: 10px 12px;
    background: var(--status-needs-revision-bg);
    color: var(--status-needs-revision-fg);
    border-left: 3px solid var(--gold);
    border-radius: var(--radius);
    font-size: 13px;
  }
  .run-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 16px; border-bottom: 1px solid var(--border); }
  .run-tab {
    padding: 9px 12px;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .run-tab:hover { color: var(--text); }
  .run-tab[aria-selected='true'] { color: var(--text); border-bottom-color: var(--primary); }
  .run-panel { padding: 16px 0; }
</style>
