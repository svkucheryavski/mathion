// The import's network steps: check, draft, uploads with retries, build, status and discard.
import { api, ApiError, failureText, REQUEST_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '../api';
import { listAssets, uploadAsset } from '../assets';
import { scanAppSource } from '../appSourceScan';
import type { Version } from '../types';
import { blobKey, type BuildBody, type CheckBody, type CheckResponse, type PlannedUpload, type ReportLine } from './types';

/** Upload statuses that refuse the file itself. */
export const REFUSAL = new Set([400, 413, 415, 422]);

/** Kept across Retry; `uncertain` holds targets an earlier attempt may have stored. */
export type UploadProgress = { outcome: Map<string, 'done' | 'refused'>; lines: ReportLine[]; uncertain: Set<string> };
export type UploadResult = { kind: 'done' } | { kind: 'retry'; message: string } | { kind: 'failed'; message: string };
export type BuildOutcome = { kind: 'done'; report: ReportLine[]; label: string } | { kind: 'committed-unknown' }
  | { kind: 'running' } | { kind: 'failed'; message: string; canDiscard: boolean };

export const BUILD_CAPS = { bytes: 40 * 1024 * 1024, lines: 20000, where: 600, text: 2000 };

const ATTEMPTS = 3;
const WAITS = [1000, 2000];
const TOO_LARGE = "This export's report is too large to build. Delete the draft and import fewer files.";
const TOO_LARGE_AT_CHECK = "This export's report is too large to import. Import fewer files.";
const NOT_BUILT = 'The import did not finish, and nothing was built.';
const GONE = 'The unfinished draft no longer exists.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function checkImport(courseId: number, body: CheckBody): Promise<CheckResponse> {
  return api.post<CheckResponse>(`/api/courses/${courseId}/olx-import/check`, body);
}

export function createDraft(courseId: number, label: string, maxQuizAttempts: number): Promise<Version> {
  return api.post<Version>(`/api/courses/${courseId}/versions`, { info_md: '', max_quiz_attempts: maxQuizAttempts, label });
}

function addOnce(progress: UploadProgress, line: ReportLine): void {
  if (!progress.lines.some((l) => l.level === line.level && l.where === line.where && l.text === line.text)) {
    progress.lines.push(line);
  }
}

const statusOf = (e: unknown): number => (e instanceof ApiError ? e.status : 0);
const detailOf = (e: unknown): string => failureText(e, SERVER_ERROR_MESSAGE);
const sentence = (s: string): string => (/[.!?]$/.test(s) ? s : `${s}.`);
// "Press Retry" follows, so a closing "Try again." would say it twice.
const withoutTryAgain = (s: string): string => s.replace(/\s*Try again\.$/, '') || s;

const REFUSAL_REASON: Record<number, string> = {
  400: 'the server refused it', 413: 'the file is too large for the server',
  415: 'the file type is not accepted', 422: 'the file was not accepted',
};

/** The server's own sentence, else a plain one for the status. */
function refusalReason(e: unknown, status: number): string {
  const own = e instanceof ApiError && typeof e.detail === 'string' && e.detail !== REQUEST_ERROR_MESSAGE ? e.detail : '';
  return own.replace(/\.$/, '') || REFUSAL_REASON[status]; // the line goes on after the brackets
}

/** Whether the target is listed with the planned size; 'unknown' when the listing fails. */
async function present(versionId: number, upload: PlannedUpload): Promise<'yes' | 'no' | 'unknown'> {
  try {
    const listed = await listAssets(versionId);
    return listed.some((a) => a.filename === upload.target && a.file_size === upload.size) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

async function uploadOne(versionId: number, upload: PlannedUpload, blob: Blob, linked: Set<string>, progress: UploadProgress,
                         wait: (ms: number) => Promise<void>, beforeAttempt: () => void): Promise<UploadResult | 'refused' | 'done'> {
  const file = new File([blob], upload.target);
  for (let attempt = 1; ; attempt++) {
    beforeAttempt(); // may throw to stop; outside the catch so it is never retried
    let stored: string;
    try {
      stored = (await uploadAsset(versionId, file)).filename;
    } catch (e) {
      const status = statusOf(e);
      if (status === 0 || status >= 500 || status === 429) {
        if (status !== 429) progress.uncertain.add(upload.target);
        if (attempt < ATTEMPTS) {
          await wait(WAITS[attempt - 1]);
          continue;
        }
        return { kind: 'retry', message: `The file “${upload.target}” could not be uploaded after ${ATTEMPTS} tries: ${sentence(withoutTryAgain(detailOf(e)))} Press Retry to go on.` };
      }
      const unchecked: UploadResult = { kind: 'retry', message: `Could not check whether “${upload.target}” is already in the draft. Press Retry.` };
      if (status === 409) {
        const found = await present(versionId, upload);
        if (found === 'yes') return 'done';
        return found === 'unknown' ? unchecked
          : { kind: 'retry', message: `A different file named “${upload.target}” is already in the draft. Press Retry to check again.` };
      }
      if (progress.uncertain.has(upload.target)) {
        const found = await present(versionId, upload);
        if (found === 'yes') return 'done';
        if (found === 'unknown' && REFUSAL.has(status)) return unchecked; // the refusal may be about our own earlier copy
      }
      if (REFUSAL.has(status) && upload.kind === 'static' && !linked.has(upload.target)) {
        addOnce(progress, { level: 'skipped', where: '',
          text: `The file “${upload.source}” was refused by the server (${refusalReason(e, status)}), so it was not uploaded; upload it by hand if a page needs it` });
        return 'refused';
      }
      return { kind: 'failed', message: `The file “${upload.target}” could not be uploaded: ${detailOf(e)}` };
    }
    if (stored !== upload.target) {
      return { kind: 'failed', message: `The file “${upload.target}” was stored as “${stored}”, so links to it would break.` };
    }
    return 'done';
  }
}

/** Upload the planned files in order, skipping targets already in progress.outcome. */
export async function uploadAll(versionId: number, plan: PlannedUpload[], blobs: Map<string, Blob>,
                                linked: Set<string>, progress: UploadProgress, onProgress: (done: number, total: number) => void,
                                wait: (ms: number) => Promise<void> = sleep, beforeAttempt: () => void = () => {}): Promise<UploadResult> {
  const total = plan.length;
  const count = () => plan.filter((u) => progress.outcome.has(u.target)).length;
  onProgress(count(), total);
  for (const upload of plan) {
    if (progress.outcome.has(upload.target)) continue;
    const blob = blobs.get(blobKey(upload.kind, upload.source));
    if (!blob) return { kind: 'failed', message: `The file “${upload.source}” was not found in the export.` };
    if (upload.kind === 'app') {
      let source: string;
      try {
        source = await blob.text();
      } catch {
        return { kind: 'failed', message: `The app file “${upload.source}” could not be read. Pick it again.` };
      }
      for (const warning of scanAppSource(source)) {
        addOnce(progress, { level: 'note', where: '', text: `${upload.target}: ${warning}` });
      }
    }
    const result = await uploadOne(versionId, upload, blob, linked, progress, wait, beforeAttempt);
    if (typeof result !== 'string') return result;
    progress.outcome.set(upload.target, result);
    onProgress(count(), total);
  }
  return { kind: 'done' };
}

/** Retry: files already listed with the planned size count as done. */
export async function markPresent(versionId: number, plan: PlannedUpload[], progress: UploadProgress): Promise<void> {
  const listed = await listAssets(versionId);
  for (const upload of plan) {
    if (progress.outcome.has(upload.target)) continue;
    if (listed.some((a) => a.filename === upload.target && a.file_size === upload.size)) progress.outcome.set(upload.target, 'done');
  }
}

export async function runBuild(versionId: number, body: BuildBody): Promise<BuildOutcome> {
  try {
    const res = await api.post<{ report?: unknown; label?: unknown } | null>(`/api/versions/${versionId}/olx-import/build`, body);
    if (!Array.isArray(res?.report) || typeof res.label !== 'string') return { kind: 'committed-unknown' }; // a 2xx means it committed
    return { kind: 'done', report: res.report as ReportLine[], label: res.label };
  } catch (e) {
    const status = statusOf(e);
    if (status === 0 || status >= 500) return buildStatus(versionId); // a timeout or proxy error: the build may have committed
    return { kind: 'failed', message: blockedText(e) ?? detailOf(e), canDiscard: status !== 404 && status !== 403 }; // gone, or discard refused too
  }
}

/** A blocked build's 409 names up to three blockers. */
function blockedText(e: unknown): string | null {
  const listed = e instanceof ApiError && e.status === 409 ? (e.body as { blockers?: unknown } | undefined)?.blockers : undefined;
  if (!Array.isArray(listed) || !listed.length) return null;
  const named = listed.slice(0, 3).map((b: Partial<ReportLine>) => `${b.where ? `${b.where}: ` : ''}${String(b.text ?? '')}`);
  const more = listed.length > 3 ? `; and ${listed.length - 3} more` : '';
  return sentence(`The import is blocked: ${named.join('; ')}${more}`);
}

export async function buildStatus(versionId: number): Promise<BuildOutcome> {
  try {
    const { state } = await api.get<{ state: string }>(`/api/versions/${versionId}/olx-import/status`);
    if (state === 'built') return { kind: 'committed-unknown' };
    if (state === 'empty') return { kind: 'failed', message: NOT_BUILT, canDiscard: true };
    return { kind: 'running' };
  } catch (e) {
    if (statusOf(e) === 404) return { kind: 'failed', message: GONE, canDiscard: false };
    if (statusOf(e) === 403) return { kind: 'failed', message: detailOf(e), canDiscard: false }; // discard would be refused too
    return { kind: 'running' }; // never offer Delete on a guess
  }
}

export async function discardDraft(versionId: number): Promise<'deleted' | 'built' | 'failed'> {
  try {
    await api.post<void>(`/api/versions/${versionId}/olx-import/discard`);
    return 'deleted';
  } catch (e) {
    const status = statusOf(e);
    if (status === 409) return 'built';
    return status === 404 ? 'deleted' : 'failed';
  }
}

/** YYYY-MM-DD in local time. */
export function localDate(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** Cut to `max` code points with … at the cut, never splitting a surrogate pair. */
function cut(text: string, max: number): string {
  const clean = text.replace(/\0/g, '?');
  const points = [...clean];
  return points.length <= max ? clean : points.slice(0, max - 1).join('') + '…';
}

export function assembleBuildBody(body: CheckBody, readerLines: ReportLine[], progress: UploadProgress, date: string):
  { kind: 'ok'; body: BuildBody } | { kind: 'too-large'; message: string } {
  const lines = [...readerLines, ...progress.lines];
  if (lines.length > BUILD_CAPS.lines) return { kind: 'too-large', message: TOO_LARGE };
  const report = lines.map((l) => ({ level: l.level, where: cut(l.where, BUILD_CAPS.where), text: cut(l.text, BUILD_CAPS.text) }));
  const build: BuildBody = { ...body, report, date };
  if (new TextEncoder().encode(JSON.stringify(build)).length > BUILD_CAPS.bytes) return { kind: 'too-large', message: TOO_LARGE };
  return { kind: 'ok', body: build };
}

/** At Check: the build body from the reader alone already over the caps, before any draft exists. */
export function checkBuildSize(body: CheckBody, readerLines: ReportLine[]): string | null {
  const empty: UploadProgress = { outcome: new Map(), lines: [], uncertain: new Set() };
  return assembleBuildBody(body, readerLines, empty, localDate()).kind === 'ok' ? null : TOO_LARGE_AT_CHECK;
}

const GROUPS: [string, (l: ReportLine) => boolean][] = [
  ['Skipped', (l) => l.level === 'skipped'],
  ['Changed', (l) => l.level === 'changed'],
  ['Notes', (l) => l.level === 'note'],
];

/** The saved .txt: blockers first, then lines grouped by level. */
export function reportText(lines: ReportLine[], blockers: ReportLine[]): string {
  const row = (l: ReportLine) => `- ${l.where ? `${l.where}: ` : ''}${l.text}`;
  const groups: [string, ReportLine[]][] = [['Problems that stop the import', blockers],
    ...GROUPS.map(([title, keep]): [string, ReportLine[]] => [title, lines.filter(keep)])];
  const parts = groups.filter(([, ls]) => ls.length).map(([title, ls]) => `${title}\n${ls.map(row).join('\n')}`);
  return parts.length ? `${parts.join('\n\n')}\n` : 'Nothing to report.\n';
}
