<script lang="ts">
  // D80 (user): the course page's "Teachers" card -- the names of the teachers
  // of the student's run, names only (a teacher's email is their sign-in
  // name; the endpoint never sends it). The caller renders it only when there
  // is a name.
  let { names }: { names: string[] } = $props();
</script>

<section class="ctch" aria-labelledby="cv-tch-h">
  <h2 id="cv-tch-h">Teachers</h2>
  <ul>
    {#each names as name, i (i)}
      <li>{name}</li>
    {/each}
  </ul>
</section>

<style>
  /* The deadlines card's look (CourseDeadlines), itself the progress card's. */
  .ctch {
    box-sizing: border-box;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 11.5px;
    font-weight: 400;
    color: var(--muted);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li { font-size: 13px; overflow-wrap: anywhere; }
  li + li { margin-top: 4px; }
</style>
