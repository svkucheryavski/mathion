// Shared types of the Open edX import: the bundle sent to the server, its plan and report lines.

export type Skipped = 'empty' | 'type' | 'size' | null;
export type StaticEntry = { path: string; size: number; skipped: Skipped };
export type ReportLine = { level: 'skipped' | 'changed' | 'note'; where: string; text: string };
export type CheckBody = { files: Record<string, string>; static: StaticEntry[]; apps: { name: string; size: number }[] };
export type BuildBody = CheckBody & { report: ReportLine[]; date: string };
export type PlannedUpload = { source: string; target: string; kind: 'static' | 'app'; size: number };
export type CheckResponse = {
  summary: Record<string, number>;
  report: ReportLine[];
  blockers: ReportLine[];
  uploads: PlannedUpload[];
  linked: string[];
  max_quiz_attempts: number;
  label: string;
  blocking: boolean;
};
export type ImportLimits = { maxFileBytes: number; maxTotalBytes: number };
/** A File, or a Node Blob in tests. */
export type ArchiveSource = { name: string; size: number; stream(): ReadableStream<Uint8Array> };
