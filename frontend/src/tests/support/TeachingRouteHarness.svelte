<script lang="ts">
  // The app's page swap in small: the Teaching list, else a run page's crumb.
  import { currentRoute } from '../../lib/router.svelte';
  import TeacherRunListPage from '../../pages/teaching/TeacherRunListPage.svelte';
  import TeachingCrumbs from '../../components/runs/TeachingCrumbs.svelte';
</script>

{#if currentRoute.path === '/teaching'}
  <TeacherRunListPage />
{:else}
  <TeachingCrumbs course={{ slug: 'c', name: 'C' }} runTitle="Run" />
{/if}
