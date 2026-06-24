<script lang="ts">
  import type { AuthoringQuestion } from '../../lib/quizAuthoring';
  import type { VersionPermissions } from '../../lib/versionPermissions';
  import type { AssetContext } from '../../lib/assetContext';

  let {
    question, vid, index, count, perms, assetContext, expanded, locked,
    onExpandToggle, onDelete, onMoveUp, onMoveDown,
  }: {
    question: AuthoringQuestion; vid: number; index: number; count: number;
    perms: VersionPermissions; assetContext: AssetContext; expanded: boolean; locked: boolean;
    onExpandToggle: () => void; onDelete: () => void; onMoveUp: () => void; onMoveDown: () => void;
  } = $props();

  // Strip tags for the header snippet (header renders from a local copy in T4;
  // for the stub we read the prop directly).
  const snippet = $derived(question.text_html.replace(/<[^>]*>/g, '').trim().slice(0, 80));
  const typeLabel: Record<AuthoringQuestion['type'], string> = {
    single_choice: 'Single choice', multiple_choice: 'Multiple choice',
    numeric_answer: 'Numeric', text_answer: 'Text',
  };
  // §7.2 shared lock: structural controls are disabled when there is no
  // structure perm OR an accordion-wide add/delete/reorder is in flight
  // (`locked`). T4 also ANDs in this question's own dirty-form state.
  const structureDisabled = $derived(!perms.canEditStructure || locked);
  void vid; void assetContext; // consumed in T4
</script>

<div class="question" class:expanded>
  <div class="header" data-testid="question-header">
    <button type="button" class="expand" aria-expanded={expanded} onclick={onExpandToggle}>
      {expanded ? '▾' : '▸'}
    </button>
    <span class="num">{index}.</span>
    <span class="badge">{typeLabel[question.type]}</span>
    <span class="snippet">{snippet || '(no text)'}</span>
    <span class="spacer"></span>
    <button type="button" aria-label="Move up" disabled={structureDisabled || index <= 1} onclick={onMoveUp}>↑</button>
    <button type="button" aria-label="Move down" disabled={structureDisabled || index >= count} onclick={onMoveDown}>↓</button>
    <button type="button" aria-label="Delete question" disabled={structureDisabled} onclick={onDelete}>🗑</button>
  </div>
  <!-- Body: built in Task 4. -->
</div>

<style>
  .question { border: 1px solid var(--border); border-radius: var(--radius); }
  .header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); }
  .spacer { flex: 1; }
  .badge { font-size: 0.85em; color: var(--text-muted, #666); }
</style>
