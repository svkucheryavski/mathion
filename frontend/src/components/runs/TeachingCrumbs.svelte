<script lang="ts">
  // Teaching / Course [/ Run] (spec §The breadcrumb). The last item is plain
  // text with aria-current; the drawn "/" separators are hidden from AT.
  import { navigate } from '../../lib/router.svelte';

  let { course, runTitle = undefined }: {
    course: { slug: string; name: string };
    runTitle?: string;
  } = $props();

  const courseHref = $derived(`/teaching/${course.slug}`);

  function go(e: MouseEvent, href: string) {
    e.preventDefault();
    void navigate(href);
  }
</script>

<nav class="teach-crumbs" aria-label="Breadcrumb">
  <a href="/teaching" onclick={(e) => go(e, '/teaching')}>Teaching</a>
  <span class="tc-sep" aria-hidden="true">/</span>
  {#if runTitle !== undefined}
    <a href={courseHref} onclick={(e) => go(e, courseHref)}>{course.name}</a>
    <span class="tc-sep" aria-hidden="true">/</span>
    <span class="tc-current" aria-current="page">{runTitle}</span>
  {:else}
    <span class="tc-current" aria-current="page">{course.name}</span>
  {/if}
</nav>

<style>
  .teach-crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .teach-crumbs a { color: var(--muted); text-decoration: none; }
  .teach-crumbs a:hover { color: var(--text); text-decoration: underline; }
  .tc-sep { color: var(--faint); }
  .tc-current { color: var(--text-2); }
</style>
