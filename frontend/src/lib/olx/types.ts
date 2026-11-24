// Shared types of the Open edX import: the bundle sent to the server, its plan and report lines.

export type Skipped = 'empty' | 'type' | 'size' | null;
export type StaticEntry = { path: string; size: number; skipped: Skipped };
export type ReportLine = { level: 'skipped' | 'changed' | 'note'; where: string; text: string };
export type CheckBody = { files: Record<string, string>; static: StaticEntry[]; apps: { name: string; size: number }[] };
export type BuildBody = CheckBody & { report: ReportLine[]; date: string };
export type PlannedUpload = { source: string; target: string; kind: 'static' | 'app'; size: number };
/** The counts of an import plan; the modal's summary line reads each one. */
export type CheckSummary = {
  blocks: number; sequences: number; items: number; videos: number; pages: number; apps: number; quizzes: number;
  files: number; bytes: number;
};
export type CheckResponse = {
  summary: CheckSummary;
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

/** Key of a file's bytes in ReadResult.blobs; the kind prefix keeps archive and picked files apart. */
export const blobKey = (kind: PlannedUpload['kind'], source: string): string => `${kind}:${source}`;
