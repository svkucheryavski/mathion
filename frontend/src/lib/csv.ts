export type CsvRow = {
  rowIndex: number;
  raw: string[];
  parsed: { name: string | null; email: string; group: string | null };
  valid: boolean;
  errors: string[];
  alreadyEnrolled: boolean;
};

export type CsvParseResult =
  | {
      ok: true;
      delimiter: ',' | '\t';
      hasHeader: boolean;
      rows: CsvRow[];
      validCount: number;
      invalidCount: number;
      duplicateInPasteCount: number;
      alreadyEnrolledEmails: string[];
      willCreateGroups: string[];
    }
  | { ok: false; error: string };

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function normalize(text: string): string[] {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/\r\n?/g, '\n');
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function detectDelimiter(line: string): ',' | '\t' {
  const tabs = (line.match(/\t/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

type HeaderMap = { name: number | null; email: number | null; group: number | null };

function detectHeader(cells: string[]): HeaderMap | null {
  const lower = cells.map((c) => c.toLowerCase().trim());
  const hasEmailHeader = lower.some((c) => c === 'email' || c === 'e-mail' || c === 'mail');
  if (!hasEmailHeader) return null;
  const map: HeaderMap = { name: null, email: null, group: null };
  lower.forEach((c, idx) => {
    if (c === 'name' || c === 'full name' || c === 'fullname') map.name = idx;
    else if (c === 'email' || c === 'e-mail' || c === 'mail') map.email = idx;
    else if (c === 'group' || c === 'group name') map.group = idx;
  });
  return map;
}

export function parseCsv(
  text: string,
  existingGroupNames: string[],
  existingRosterEmails: string[],
): CsvParseResult {
  const lines = normalize(text);
  if (lines.length === 0) return { ok: false, error: 'Paste is empty.' };

  const delimiter = detectDelimiter(lines[0]);
  const split = lines.map((l) => l.split(delimiter).map((c) => c.trim()));
  const header = detectHeader(split[0]);
  const hasHeader = header !== null;
  const dataRows = hasHeader ? split.slice(1) : split;

  // Positional fallback: peek first row to decide [email, group?] vs [name, email, group?]
  let positional: 'email-first' | 'name-first' = 'name-first';
  if (!hasHeader && dataRows.length > 0) {
    positional = EMAIL_RE.test(dataRows[0][0] || '') ? 'email-first' : 'name-first';
  }

  // No email column → all rows blank? signal pre-row error.
  if (hasHeader && header.email !== null) {
    const allEmailsBlank = dataRows.every((r) => !(r[header.email!] || '').trim());
    if (allEmailsBlank && dataRows.length > 0) {
      return { ok: false, error: 'No email column found.' };
    }
  }

  const seenEmails = new Map<string, number>(); // lowercased → first row index
  const existingLower = new Set(existingRosterEmails.map((e) => e.toLowerCase()));
  const existingGroupSet = new Set(existingGroupNames);

  const rows: CsvRow[] = dataRows.map((raw, i) => {
    const cells = raw;
    let name: string | null = null;
    let email = '';
    let group: string | null = null;

    if (hasHeader) {
      if (header.name !== null) name = cells[header.name] || '';
      if (header.email !== null) email = cells[header.email] || '';
      if (header.group !== null) group = cells[header.group] || '';
    } else if (positional === 'email-first') {
      email = cells[0] || '';
      group = cells[1] ?? null;
    } else {
      if (cells.length === 1) {
        // Single-cell row in name-first mode: treat the cell as email if it matches.
        const only = cells[0] || '';
        if (EMAIL_RE.test(only)) email = only;
        else name = only;
      } else {
        name = cells[0] || '';
        email = cells[1] || '';
        group = cells[2] ?? null;
      }
    }

    name = name && name.trim() ? name.trim() : null;
    email = email.trim().toLowerCase();
    group = group && group.trim() ? group.trim() : null;

    const errors: string[] = [];
    let valid = true;
    if (!email) {
      errors.push('Missing email');
      valid = false;
    } else if (!EMAIL_RE.test(email)) {
      errors.push('Invalid email format');
      valid = false;
    }

    return {
      rowIndex: i + 1,
      raw: cells,
      parsed: { name, email, group },
      valid,
      errors,
      alreadyEnrolled: false,
    };
  });

  // In-paste duplicate detection.
  let duplicateInPasteCount = 0;
  for (const row of rows) {
    if (!row.valid) continue;
    const key = row.parsed.email;
    if (seenEmails.has(key)) {
      row.valid = false;
      row.errors.push('Duplicate in paste (will skip)');
      duplicateInPasteCount += 1;
    } else {
      seenEmails.set(key, row.rowIndex);
    }
  }

  // Already-enrolled detection (only against rows that are still valid).
  const alreadyEnrolledSet = new Set<string>();
  for (const row of rows) {
    if (!row.valid) continue;
    if (existingLower.has(row.parsed.email)) {
      row.alreadyEnrolled = true;
      alreadyEnrolledSet.add(row.parsed.email);
    }
  }

  // willCreateGroups: sorted unique group names from valid rows whose name is NOT existing.
  const willCreateSet = new Set<string>();
  for (const row of rows) {
    if (!row.valid) continue;
    const g = row.parsed.group;
    if (g && !existingGroupSet.has(g)) willCreateSet.add(g);
  }

  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;

  return {
    ok: true,
    delimiter,
    hasHeader,
    rows,
    validCount,
    invalidCount,
    duplicateInPasteCount,
    alreadyEnrolledEmails: Array.from(alreadyEnrolledSet).sort(),
    willCreateGroups: Array.from(willCreateSet).sort(),
  };
}
