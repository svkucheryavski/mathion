<script module lang="ts">
  // The answer-key question (Polish 1 R52), shared by the marker (#2) and the
  // Number / Text key (#6). It leads with its question in bold, then the
  // published-quiz warning; the group is named by the whole message. This
  // component renders nothing: import `keyAsk` from its module.
  import { KEY_CONFIRM } from '../../../lib/quizEdits.svelte';
  import type { Ask } from '../../../lib/askInPlace.svelte';

  export { keyMessage };

  export function keyAsk(): Ask {
    return { message: keyMessage, confirmLabel: 'Change key', tone: 'primary', layout: 'column', confirmDataAction: 'confirm-change-key' };
  }
</script>

{#snippet keyMessage()}<strong>Change the answer key?</strong> {KEY_CONFIRM}{/snippet}
