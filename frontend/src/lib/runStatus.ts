export type RunStatus = 'draft' | 'upcoming' | 'active' | 'ended';

function startOfDayLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfDayLocal(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

export function runStatus(
  run: { is_published: boolean; start_date: string; end_date: string },
  now: Date = new Date(),
): RunStatus {
  if (!run.is_published) return 'draft';
  if (now < startOfDayLocal(run.start_date)) return 'upcoming';
  if (now > endOfDayLocal(run.end_date)) return 'ended';
  return 'active';
}
