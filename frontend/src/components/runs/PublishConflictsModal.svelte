<script lang="ts">
  import FocusTrap from '../ui/FocusTrap.svelte';
  import type { PublishConflict } from '../../lib/types';

  // Pure-presentation modal: parent narrows the 409 publish-conflict body and
  // passes `conflicts` already typed. NO ApiError import here (spec §2 line
  // 225 / K2). NO empty-state branch (parent's J2 guard prevents `length === 0`
  // mounts).
  let { open, conflicts, onClose }: {
    open: boolean;
    conflicts: PublishConflict[];
    onClose: () => void;
  } = $props();

  // Heading count dedupes on user_id (I4): a single student appearing in
  // multiple conflict rows counts once.
  const studentCount = $derived(new Set(conflicts.map((c) => c.user_id)).size);

  // Group by run_id, NOT run_title (G3): two runs may share a title; they must
  // render as separate groups.
  const groupedByRun = $derived.by(() => {
    const map = new Map<number, { run_title: string; emails: string[] }>();
    for (const c of conflicts) {
      const existing = map.get(c.run_id);
      if (existing) {
        if (!existing.emails.includes(c.email)) existing.emails.push(c.email);
      } else {
        map.set(c.run_id, { run_title: c.run_title, emails: [c.email] });
      }
    }
    return Array.from(map.entries()).map(([run_id, v]) => ({ run_id, ...v }));
  });

  // Layout selector mirrors spec §3.3 lines 546-548:
  //   'single-sentence' — exactly one student AND one conflict row.
  //   'single-group'    — N≥2 students all on the same run.
  //   'grouped'         — multi-group form (covers both N≥2 across runs AND
  //                       the I4 legacy single-user-multi-run dup case).
  const layout = $derived.by<'single-sentence' | 'single-group' | 'grouped'>(() => {
    if (studentCount === 1 && conflicts.length === 1) return 'single-sentence';
    if (studentCount >= 2 && groupedByRun.length === 1) return 'single-group';
    return 'grouped';
  });

  const headingText = $derived(
    studentCount === 1 ? "1 student can't be added" : `${studentCount} students can't be added`,
  );

  function onBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={onBackdrop}>
    <FocusTrap>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Cannot publish run">
        <header>
          <h2>{headingText}</h2>
        </header>

        <div class="modal-body">
          {#if layout === 'single-sentence'}
            <p>
              {conflicts[0].email} is already active in <strong>{conflicts[0].run_title}</strong>.
            </p>
          {:else if layout === 'single-group'}
            <p>
              They are already active in <strong>{groupedByRun[0].run_title}</strong>:
            </p>
            <ul>
              {#each groupedByRun[0].emails as email (email)}
                <li>{email}</li>
              {/each}
            </ul>
          {:else}
            <!-- grouped: covers I4 single-user-multi-run AND N≥2 across distinct runs -->
            {#if studentCount === 1}
              <p>{conflicts[0].email} is already active in:</p>
            {:else}
              <p>They are already active in other runs:</p>
            {/if}
            {#each groupedByRun as group (group.run_id)}
              <p class="group-heading"><strong>{group.run_title}</strong></p>
              <ul>
                {#each group.emails as email (email)}
                  <li>{email}</li>
                {/each}
              </ul>
            {/each}
          {/if}
        </div>

        <footer>
          <button type="button" onclick={onClose}>Close</button>
        </footer>
      </div>
    </FocusTrap>
  </div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: var(--surface, white); border-radius: var(--radius, 8px); padding: var(--space-4, 24px); min-width: 360px; max-width: 90vw; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3, 16px); }
  header h2 { margin: 0; }
  .modal-body p { margin: 0 0 var(--space-2, 8px); }
  .modal-body .group-heading { margin-top: var(--space-3, 16px); }
  .modal-body ul { margin: 0 0 var(--space-2, 8px); padding-left: var(--space-4, 24px); }
  .modal-body li { margin: 2px 0; }
  footer { display: flex; gap: var(--space-2, 8px); justify-content: flex-end; margin-top: var(--space-3, 16px); }
</style>
