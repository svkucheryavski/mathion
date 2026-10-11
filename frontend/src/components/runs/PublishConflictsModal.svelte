<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import type { PublishConflict } from '../../lib/types';

  // Pure-presentation modal: parent narrows the 409 publish-conflict body and
  // passes `conflicts` already typed. NO ApiError import here (spec §2 line
  // 225 / K2). NO empty-state branch (parent's J2 guard prevents `length === 0`
  // mounts). <Modal> mounts only while `open`, so the scroll lock is taken
  // only then.
  let { open, conflicts, onClose }: {
    open: boolean;
    conflicts: PublishConflict[];
    onClose: () => void;
  } = $props();

  // $props.id() may only initialise a top-level declaration.
  const uid = $props.id();
  const titleId = `${uid}-title`;

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
</script>

{#snippet head()}
  <h2 id={titleId} class="pc-heading">{headingText}</h2>
{/snippet}

{#snippet foot()}
  <span class="pc-foot-note">Nothing was published — the run is unchanged.</span>
  <Button variant="secondary" data-action="close" data-autofocus onclick={onClose}>Close</Button>
{/snippet}

{#snippet emailList(emails: string[])}
  <ul class="pc-emails">
    {#each emails as email (email)}
      <li title={email}>{email}</li>
    {/each}
  </ul>
{/snippet}

{#if open}
  <Modal
    labelledby={titleId}
    width={560}
    onRequestClose={onClose}
    header={head}
    footer={foot}
  >
    {#if layout === 'single-sentence'}
      <p class="pc-lead">{conflicts[0].email} is already active in <strong>{conflicts[0].run_title}</strong>.</p>
    {:else if layout === 'single-group'}
      <div class="pc-run">
        <p class="pc-lead">They are already active in <strong>{groupedByRun[0].run_title}</strong>:</p>
        {@render emailList(groupedByRun[0].emails)}
      </div>
    {:else}
      <!-- grouped: covers I4 single-user-multi-run AND N≥2 across distinct runs -->
      {#if studentCount === 1}
        <p class="pc-lead">{conflicts[0].email} is already active in:</p>
      {:else}
        <p class="pc-lead">They are already active in other runs:</p>
      {/if}
      <div class="pc-runs">
        {#each groupedByRun as group (group.run_id)}
          <div class="pc-run">
            <strong class="pc-title" title={group.run_title}>{group.run_title}</strong>
            {@render emailList(group.emails)}
          </div>
        {/each}
      </div>
    {/if}
    <p class="pc-note">A student can only be active in one run of a course at a time. Remove them from the other run, or take them off this roster, then publish again.</p>
  </Modal>
{/if}

<style>
  /* The × sits at the right edge of the header. */
  .pc-heading {
    margin-right: auto;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .pc-lead {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .pc-lead strong { font-weight: 600; color: var(--text); }
  .pc-runs {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pc-run {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .pc-title {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc-emails {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0 0 0 12px;
    list-style: none;
    border-left: 2px solid var(--border);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .pc-emails li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-note {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
  }
  .pc-foot-note {
    flex: 1;
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
