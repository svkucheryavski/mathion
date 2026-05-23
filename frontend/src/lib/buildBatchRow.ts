import type { CsvRow } from './csv';
import type { GroupResponse, RunStudentBatchRow, RunStudentResponse } from './types';

/**
 * F1=A: derive the wire row a batch submit should send for a parsed CSV row.
 *
 * Rules:
 * - email is always sent (lowercased upstream by parseCsv).
 * - name is sent only when the CSV row provided a non-empty name.
 * - group: if the CSV cell is non-empty, send it as-is (server resolves /
 *   auto-creates). If the cell is empty AND the email is already in the run
 *   roster, send the student's CURRENT group name so the server does not
 *   "un-group" them. If the cell is empty and the student is brand-new, omit
 *   group entirely (server treats this as "no group").
 * - Race fallback: if alreadyEnrolled was true at preview time but the email
 *   has since vanished from the fresh roster, omit group rather than throw.
 */
export function buildBatchRow(
  parsed: CsvRow,
  existingRoster: RunStudentResponse[],
  groups: GroupResponse[],
): RunStudentBatchRow {
  let groupName: string | null = parsed.parsed.group;

  if (!groupName && parsed.alreadyEnrolled) {
    const existing = existingRoster.find(
      (r) => r.user_email.toLowerCase() === parsed.parsed.email,
    );
    if (existing && existing.group_id !== null) {
      const g = groups.find((gg) => gg.id === existing.group_id);
      if (g) groupName = g.name;
    }
  }

  const row: RunStudentBatchRow = { email: parsed.parsed.email };
  if (parsed.parsed.name) row.name = parsed.parsed.name;
  if (groupName) row.group = groupName;
  return row;
}
