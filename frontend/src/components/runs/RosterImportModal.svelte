<script lang="ts">
  // T12 scaffold — T16 replaces this with the full Roster Import modal.
  // Kept as a typed placeholder so Vite's dynamic-import static analysis can
  // resolve `import('./RosterImportModal.svelte')` from RunDetailPage.
  import type { GroupResponse, RunStudentResponse } from '../../lib/types';

  let {
    runId,
    existingRoster,
    existingGroups,
    onRefetchBeforeSubmit,
    onClose,
  }: {
    runId: number;
    existingRoster: RunStudentResponse[];
    existingGroups: GroupResponse[];
    onRefetchBeforeSubmit: () => Promise<{ students: RunStudentResponse[]; groups: GroupResponse[] }>;
    onClose: () => void;
  } = $props();

  // Reference props so the unused-prop check passes; the real wiring lands in T16.
  $effect(() => {
    void runId;
    void existingRoster;
    void existingGroups;
    void onRefetchBeforeSubmit;
  });
</script>

<div class="roster-import-modal-placeholder" role="dialog">
  <p>Roster import modal is not yet implemented.</p>
  <button type="button" onclick={onClose}>Close</button>
</div>
