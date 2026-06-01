// frontend/src/lib/csvWrite.ts
// Spec: docs/superpowers/specs/2026-05-31-teacher-dashboards-design.md §6.7

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
}
// Booleans are serialized as the literal strings "true" / "false" before the
// formula-injection guard + RFC 4180 quoting pass. Used by Submission CSV
// columns like `is_late`, `is_resubmission`, `has_feedback_file`.

export interface CsvOptions {
  /** Prepend UTF-8 BOM for Excel compatibility. Default: true. */
  bom?: boolean;
  /** Line ending. Default: '\r\n' (RFC 4180). */
  newline?: '\n' | '\r\n';
}

export function sanitizeTitle(title: string, fallback: string): string {
  let s = title.replace(/[^A-Za-z0-9 \-_]/g, '_').replace(/\s+/g, '_').slice(0, 60);
  s = s.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
  return s || fallback;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const RFC_TRIGGER = /[",\r\n]/;

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  // Step 1: formula-injection guard — prepend apostrophe if value starts
  // with a trigger char.
  const guarded = FORMULA_TRIGGER.test(s) ? "'" + s : s;
  // Step 2: RFC 4180 quoting — quote if EITHER the apostrophe was prepended
  // (guarded values are ALWAYS quoted, matching the §13 test assertion) OR
  // the value contains comma / double-quote / CR / LF.
  const needsQuotes = guarded !== s || RFC_TRIGGER.test(guarded);
  if (!needsQuotes) return guarded;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

export function toCSV<Row>(
  rows: Row[],
  columns: CsvColumn<Row>[],
  opts: CsvOptions = {},
): string {
  const newline = opts.newline ?? '\r\n';
  const bom = opts.bom ?? true;
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row))).join(','),
  );
  const body = [headerLine, ...dataLines].join(newline);
  return bom ? '﻿' + body : body;
}

export function downloadCSV(csvText: string, filename: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
