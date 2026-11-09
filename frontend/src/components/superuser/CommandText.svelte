<script lang="ts">
  // D5a, Set up D8: a note's text with its `mathion pin` command shown as code,
  // so the superuser can copy it. Shared by the Courses note and Set up's
  // First course step (its note and its done view).
  type Props = { text: string; command?: string };
  let { text, command }: Props = $props();

  const at = $derived(command ? text.indexOf(command) : -1);
</script>

{#if command && at >= 0}{text.slice(0, at)}<code>{command}</code>{text.slice(at + command.length)}{:else}{text}{/if}
