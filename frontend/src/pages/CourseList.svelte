<script lang="ts">
  import { api, ApiError } from '../lib/api';
  import { logout } from '../lib/auth.svelte';
  import { session } from '../stores/session.svelte';
  import { pushToast } from '../stores/toasts.svelte';
  import type { CourseListItem } from '../lib/types';
  import CourseCard from '../components/course/CourseCard.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import Button from '../components/ui/Button.svelte';

  let loading = $state(true);
  let courses = $state<CourseListItem[]>([]);
  let error = $state('');

  $effect(() => {
    loading = true;
    api.get<CourseListItem[]>('/api/my-courses')
      .then((cs) => { courses = cs; })
      .catch((e: unknown) => { error = e instanceof ApiError ? e.displayMessage : 'Failed to load courses.'; })
      .finally(() => { loading = false; });
  });
</script>

<div class="page">
  <header>
    <h1>Your courses</h1>
    <div class="user">
      {session.user?.full_name ?? session.user?.email}
      <Button variant="ghost" onclick={() => { void logout().catch((e) => pushToast(String(e), 'error')); }}>Sign out</Button>
    </div>
  </header>

  {#if loading}
    <Spinner />
  {:else if error}
    <p class="error">{error}</p>
  {:else if courses.length === 0}
    <p class="empty">You're not enrolled in any courses yet — ask your teacher for an invite.</p>
  {:else}
    <div class="grid">
      {#each courses as c (c.course.id)}
        <CourseCard course={c} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
  .user { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); }
  .grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .empty { color: var(--muted); padding: var(--space-6) 0; text-align: center; }
  .error { color: var(--danger); }
</style>
