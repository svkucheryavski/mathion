<script lang="ts">
  import { daysLeft, type ComingDeadline } from '../../lib/courseDeadlines';
  import { formatShortDeadline } from '../../lib/datetime';
  import type { StudentMiniProjectListItem } from '../../lib/types';

  // D80 (user): the course page's "Coming deadlines" card -- what the student
  // must still act on, nearest first, each with its ONE deadline (the hard
  // one is a hidden grace window; lib/courseDeadlines has the rules). Each
  // line links to its mini-project page ("B2 · Practice", the course page's
  // block numbers) and takes its urgency colour from the shown date. The
  // caller renders it only when there is a line.
  type Line = ComingDeadline<StudentMiniProjectListItem>;
  let { courseSlug, lines, blockN }: {
    courseSlug: string;
    lines: Line[];
    blockN: (blockId: number) => number | undefined;
  } = $props();

  function when(l: Line): string {
    const date = formatShortDeadline(l.at);
    if (l.kind === 'overdue') return `Overdue since ${date}`;
    return `${l.kind === 'resubmit' ? 'Resubmit by' : 'Due'} ${date} · ${daysLeft(l.at)}`;
  }
  const href = (l: Line) =>
    `/courses/${encodeURIComponent(courseSlug)}/blocks/${encodeURIComponent(l.item.block_slug)}/mini-project`;
  function label(l: Line): string {
    const title = l.item.block_title.trim() || 'Untitled block';
    const n = blockN(l.item.block_id);
    return n === undefined ? title : `B${n} · ${title}`;
  }
</script>

<section class="cdl" aria-labelledby="cv-dl-h">
  <h2 id="cv-dl-h">Coming deadlines</h2>
  <ul>
    {#each lines as l (l.item.mp_id)}
      <li>
        <a href={href(l)}>{label(l)}</a>
        <p class="when" class:soon={l.urgency === 'soon'} class:near={l.urgency === 'near'}>{when(l)}</p>
      </li>
    {/each}
  </ul>
</section>

<style>
  /* The progress card's look (CourseProgress .summary): a small white card
     that fills the cell the course page gives it. */
  .cdl {
    box-sizing: border-box;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  /* The progress card's label, as a real heading. */
  h2 {
    margin: 0 0 6px;
    font-size: 11.5px;
    font-weight: 400;
    color: var(--muted);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li + li { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-soft); }
  /* A title, not a blue body link (MiniProjectLink's row reads the same). */
  a {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  a:hover { text-decoration: underline; }
  .when { margin: 2px 0 0; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  /* D80 (user): urgency by the shown date -- crimson 0-6 calendar days and
     overdue, orange 7-13, the muted grey from 14. The words carry it too. */
  .when.soon { color: var(--danger); }
  .when.near { color: var(--due-near); }
</style>
