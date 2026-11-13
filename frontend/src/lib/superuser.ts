import { api, ApiError, OFFLINE_MESSAGE, REQUEST_ERROR_MESSAGE } from './api';
import type { BrandingPublic } from './branding.svelte';
import { setUploadLimit } from './uploadLimit.svelte';

// Every panel call passes skipAuthRedirect: the panel's shell handles 401 and
// 404 itself (panelError), instead of the app-wide onUnauthorized redirect.
const opts = { skipAuthRedirect: true };
const base = (token: string) => `/api/superuser/${token}`;

export type SuperuserStats = {
  total_users: number;
  total_courses: number;
  storage_bytes: number;
  active_users_24h: number;
  active_users_7d: number;
};

export function getSuperuserStats(token: string): Promise<SuperuserStats> {
  return api.get<SuperuserStats>(`${base(token)}/stats`, opts);
}

// --- Courses (spec D4-D13), mirroring backend/mathion/schemas.py ---

export type PanelAdmin = { id: number; email: string; full_name: string | null; is_disabled: boolean };

export type PanelCourse = {
  id: number;
  name: string;
  slug: string;
  admin: PanelAdmin | null;
  version_count: number;
  run_count: number;
  student_count: number;
};

/** D5a: what happened to the admin email; the first that applies wins. */
export type AdminEmail = 'queued' | 'email_off' | 'disabled' | 'unchanged';

export type AdminAssignResult = {
  course: PanelCourse;
  admin: PanelAdmin;
  admin_email: AdminEmail;
  pin_minutes: number;
  sign_in_url: string;
};

export type AccountLookup = { status: 'new' | 'existing' | 'disabled'; full_name: string | null };

export type CourseDeleteImpact = { progress_students: number };

export function listCourses(token: string): Promise<PanelCourse[]> {
  return api.get<PanelCourse[]>(`${base(token)}/courses`, opts);
}

export function createCourse(token: string, body: { name: string; slug: string; admin_email: string }): Promise<AdminAssignResult> {
  return api.post<AdminAssignResult>(`${base(token)}/courses`, body, opts);
}

export function updateCourse(token: string, id: number, body: { name?: string; slug?: string }): Promise<PanelCourse> {
  return api.patch<PanelCourse>(`${base(token)}/courses/${id}`, body, opts);
}

export function assignAdmin(token: string, id: number, email: string): Promise<AdminAssignResult> {
  return api.put<AdminAssignResult>(`${base(token)}/courses/${id}/admin`, { email }, opts);
}

export function removeAdmin(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/courses/${id}/admin`, opts);
}

export function getDeleteImpact(token: string, id: number): Promise<CourseDeleteImpact> {
  return api.get<CourseDeleteImpact>(`${base(token)}/courses/${id}/delete-impact`, opts);
}

export function deleteCourse(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/courses/${id}`, opts);
}

export function lookupAccount(token: string, email: string): Promise<AccountLookup> {
  return api.post<AccountLookup>(`${base(token)}/accounts/lookup`, { email }, opts);
}

/** The `mathion pin` command the email-off note gives (D5a); the page shows it as code. */
export const pinCommand = (email: string) => `mathion pin ${email}`;

/** D5a: how an admin signs in while email isn't set up; the Courses note's
 *  tail, and Set up D8's done view. */
export function emailOffSentence(signInUrl: string, email: string, pinMinutes: number): string {
  const minutes = `${pinMinutes} minute${pinMinutes === 1 ? '' : 's'}`;
  return `Email isn't set up on this server, so tell them yourself. They sign in at ${signInUrl} `
    + `with a PIN: run ${pinCommand(email)} on the server (the PIN lasts ${minutes}).`;
}

/** Set up D8: the admin is the signed-in superuser, compared lower-cased. */
export const adminIsMe = (adminEmail: string, me: string | null | undefined): boolean =>
  !!me && adminEmail.toLowerCase() === me.toLowerCase();

/**
 * D5a: the note after New course (`create`) or an admin assign (`assign`). It
 * opens with the result, naming the admin by name or, without one, by email
 * (Review Focus 4); "unchanged" says only that nothing changed. Set up D8:
 * when the admin is `me` the note is only that, with no email, PIN or
 * disabled sentence; a queued email adds Email's not-done reason after it.
 */
export function adminNote(
  result: AdminAssignResult,
  kind: 'create' | 'assign',
  opts: { me?: string | null; emailReason?: string | null } = {},
): string {
  const { course, admin } = result;
  if (adminIsMe(admin.email, opts.me)) {
    if (result.admin_email === 'unchanged') return 'You are already its admin; nothing changed.';
    const found = "You'll find it on the Courses page of the main site.";
    return kind === 'create'
      ? `${course.name} is created; you are its admin. ${found}`
      : `You are now the admin of ${course.name}. ${found}`;
  }
  if (result.admin_email === 'unchanged') return 'They are already the admin; nothing changed.';
  const who = admin.full_name ?? admin.email;
  const opening = kind === 'create'
    ? `${course.name} is created; ${who} is its admin.`
    : `${who} is now the admin of ${course.name}.`;
  switch (result.admin_email) {
    case 'queued': {
      const sent = `${opening} An email with a link to the course is on its way to ${admin.email}.`;
      return opts.emailReason ? `${sent} ${opts.emailReason}` : sent;
    }
    case 'disabled':
      return `${opening} No email sent: this account is disabled. Enable it on the Users page so they can sign in.`;
    case 'email_off':
      return `${opening} ${emailOffSentence(result.sign_in_url, admin.email, result.pin_minutes)}`;
  }
}

/** D5a, Set up D8: the note and the `mathion pin` command it gives, which the
 *  page shows as code; none when the admin is `me` (that note has no PIN). */
export function adminNoteParts(
  result: AdminAssignResult,
  kind: 'create' | 'assign',
  opts: { me?: string | null; emailReason?: string | null } = {},
): { text: string; command?: string } {
  const text = adminNote(result, kind, opts);
  return result.admin_email === 'email_off' && !adminIsMe(result.admin.email, opts.me)
    ? { text, command: pinCommand(result.admin.email) }
    : { text };
}

// --- Users (spec D14-D21) ---

export type PanelUserRole = 'all' | 'admins' | 'teachers' | 'students' | 'disabled';

/** D14 rev 11: the address tells same-named courses apart in a tooltip. */
export type PanelCourseRef = { id: number; name: string; slug: string };
/** A run as a Users row lists it on hover: "<course> · <run title>" (D14 rev 8). */
export type PanelRunRef = { id: number; title: string; course_name: string };

export type PanelUser = {
  id: number;
  email: string;
  full_name: string | null;
  is_superuser: boolean;
  is_disabled: boolean;
  created_at: string;
  last_seen_at: string | null;
  admin_of: PanelCourseRef[];
  teacher_runs: PanelRunRef[];
  student_runs: PanelRunRef[];
  /** D20: any reference that blocks the delete. */
  has_data: boolean;
};

export type PanelUserCounts = Record<PanelUserRole, number>;

/** `users` is at most 20; `total` counts the pill and the search; `counts` never follow the search (D15a). */
export type PanelUserList = { users: PanelUser[]; total: number; counts: PanelUserCounts };

export function listUsers(token: string, q: string, role: PanelUserRole): Promise<PanelUserList> {
  return api.get<PanelUserList>(`${base(token)}/users?${new URLSearchParams({ q, role })}`, opts);
}

export function createUser(token: string, body: { email: string; full_name?: string | null }): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users`, body, opts);
}

/** Only the fields sent change; `full_name: null` clears the name. */
export function updateUser(token: string, id: number, body: { full_name?: string | null; email?: string }): Promise<PanelUser> {
  return api.patch<PanelUser>(`${base(token)}/users/${id}`, body, opts);
}

export function disableUser(token: string, id: number): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users/${id}/disable`, undefined, opts);
}

export function enableUser(token: string, id: number): Promise<PanelUser> {
  return api.post<PanelUser>(`${base(token)}/users/${id}/enable`, undefined, opts);
}

export function deleteUser(token: string, id: number): Promise<void> {
  return api.delete(`${base(token)}/users/${id}`, opts);
}

const NOUNS: Record<PanelUserRole, [string, string]> = {
  all: ['account', 'accounts'],
  admins: ['admin', 'admins'],
  teachers: ['teacher', 'teachers'],
  students: ['student', 'students'],
  disabled: ['disabled account', 'disabled accounts'],
};
const noun = (role: PanelUserRole, n: number) => NOUNS[role][n === 1 ? 0 : 1];
/** D15 rev 11: English digit grouping, "4,213". */
export const formatCount = (n: number): string => n.toLocaleString('en-US');
const runs = (n: number) => `${formatCount(n)} ${n === 1 ? 'run' : 'runs'}`;

/** D15: the line under the table, for the list as fetched with its pill and search. */
export function countLine(list: PanelUserList, role: PanelUserRole, searching: boolean): string {
  const shown = list.users.length;
  const total = list.total;
  if (searching) {
    if (total === 0) return `No ${noun(role, 0)} match`;
    return total > shown
      ? `${formatCount(shown)} of ${formatCount(total)} match. Keep typing to narrow.`
      : `${formatCount(total)} match`;
  }
  if (total === 0) return `No ${noun(role, 0)}`;
  return total > shown
    ? `Showing the ${formatCount(shown)} newest of ${formatCount(total)} ${noun(role, total)}. Search to find others.`
    : `${formatCount(total)} ${noun(role, total)}`;
}

/** A role chip: short text, the full list for a screen reader (D14 rev 8),
 *  and the capped hover text, '' for none (D14 rev 9). */
export type RoleChip = { kind: 'su' | 'ad' | 'role'; text: string; items: string[]; tip: string };

const TIP_LINES = 10;

// Cut by visible characters (graphemes), so a cut never splits a flag, an
// emoji sequence or a letter from its accent.
// Firefox before 125 has no Segmenter: there a cut counts code points, which
// can split a flag but never fails the panel's import.
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
function cut(s: string, max: number): string {
  const chars = graphemes ? Array.from(graphemes.segment(s), (g) => g.segment) : Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

// D14 rev 11: a line that would repeat another, in full or as cut for the
// tooltip, says which one it is, in the hidden list and the tooltip alike.
function told<T>(things: T[], full: (t: T) => string, short: (t: T) => string, which: (t: T) => string):
  { items: string[]; tips: string[] } {
  const repeats = (lines: string[]) => {
    const seen = new Map<string, number>();
    for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);
    return lines.map((l) => seen.get(l)! > 1);
  };
  const fulls = things.map(full);
  const shorts = things.map(short);
  const [a, b] = [repeats(fulls), repeats(shorts)];
  const tag = (l: string, i: number) => (a[i] || b[i] ? `${l} (${which(things[i])})` : l);
  return { items: fulls.map(tag), tips: shorts.map(tag) };
}

// D14 rev 9: "- " lines, at most ten, then "… and N more" with no bullet.
function tip(lines: string[]): string {
  const shown = lines.slice(0, TIP_LINES).map((l) => `- ${l}`);
  if (lines.length > TIP_LINES) shown.push(`… and ${lines.length - TIP_LINES} more`);
  return shown.join('\n');
}

/** D14 rev 8: one short chip per role, the count in brackets, in D14 order;
 *  [] for an account with no role. Disabled is not a chip: the row is greyed. */
export function roleChips(u: PanelUser): RoleChip[] {
  const chips: RoleChip[] = [];
  const named = (r: PanelRunRef) => `${r.course_name} · ${r.title}`;
  // Course and run are cut apart, so a long course never hides the run title.
  // The run id that tells two equal lines apart is added after the cut.
  const short = (r: PanelRunRef) => `${cut(r.course_name, 24)} · ${cut(r.title, 20)}`;
  const runId = (r: PanelRunRef) => `run ${r.id}`;
  const runChip = (role: string, runs: PanelRunRef[]): RoleChip => {
    const { items, tips } = told(runs, named, short, runId);
    return { kind: 'role', text: `${role} (${runs.length})`, items, tip: tip(tips) };
  };
  if (u.is_superuser) chips.push({ kind: 'su', text: 'Superuser', items: [], tip: '' });
  if (u.admin_of.length) {
    const { items, tips } = told(u.admin_of, (c) => c.name, (c) => cut(c.name, 30), (c) => c.slug);
    chips.push({ kind: 'ad', text: `Admin (${items.length})`, items, tip: tip(tips) });
  }
  if (u.teacher_runs.length) chips.push(runChip('Teacher', u.teacher_runs));
  if (u.student_runs.length) chips.push(runChip('Student', u.student_runs));
  return chips;
}

/** An account as the panel names it: the name, or the email when there is none. */
export const personName = (u: PanelUser) => u.full_name ?? u.email;

/** D18 rev 11: what the person loses, without she or he (Mathion stores no
 *  gender). Commas between the parts; the last joiner is " and ", or ", and "
 *  when the part before it already has an "and" ("admin of A and B"). */
export function disableWarning(u: PanelUser): string {
  const who = personName(u);
  const parts: string[] = [];
  const courses = u.admin_of.map((c) => c.name);
  if (courses.length > 2) parts.push(`is the admin of ${formatCount(courses.length)} courses`);
  else if (courses.length > 0) parts.push(`is the admin of ${courses.join(' and ')}`);
  if (u.teacher_runs.length) parts.push(`teaches ${runs(u.teacher_runs.length)}`);
  if (u.student_runs.length) parts.push(`is a student in ${runs(u.student_runs.length)}`);
  const joined = parts.reduce((text, part, i) => {
    if (i === 0) return part;
    if (i < parts.length - 1) return `${text}, ${part}`;
    return `${text}${parts[i - 1].includes(' and ') ? ', and' : ' and'} ${part}`;
  }, '');
  const middle = parts.length ? `${who} ${joined}. ` : '';
  return `Disable ${who}? ${middle}They'll be signed out and can't sign in until enabled; tell them yourself.`;
}

// --- Settings (Settings spec D4-D12), mirroring backend/mathion/schemas.py ---

export type Encryption = 'starttls' | 'ssl' | 'none';

export type PanelEmailTest = { at: string; ok: boolean; message: string };
export type PanelSendFailure = { since: string; message: string };

export type PanelEmailSettings = {
  on: boolean;
  host: string;
  port: number;
  encryption: Encryption;
  skip_cert_check: boolean;
  username: string;
  /** D8: the password itself never reaches the browser. */
  password_saved: boolean;
  password_unreadable: boolean;
  from_address: string;
  /** D2c: a developer mode set in .env wins over the panel. */
  dev_mode: 'file' | 'memory' | null;
  /** D9a: the last test of the settings now saved. */
  card_test: PanelEmailTest | null;
  /** D9d: the queue is stuck on a server-side failure. */
  failing: PanelSendFailure | null;
};

export type PanelLimits = { max_file_mb: number; max_total_mb: number };

export type PanelSignIn = {
  pin_minutes: number;
  pin_requests_per_hour: number;
  pin_failures_per_hour: number;
  longest_sign_in_days: number;
};

export type PanelSettings = {
  email: PanelEmailSettings;
  limits: PanelLimits;
  sign_in: PanelSignIn;
  site: { base_url: string };
};

/** What a test sends: the form as it is now; no password means the saved one (D8a). */
export type EmailTestBody = {
  host: string;
  port: number;
  encryption: Encryption;
  skip_cert_check: boolean;
  username: string;
  password?: string;
  from_address: string;
};

/** D7c: an off save sends the switch alone, so nothing else is written. */
export type EmailSaveBody = { on: false } | ({ on: true } & EmailTestBody);

export type EmailTestResult = { ok: boolean; message: string };

export function getSettings(token: string): Promise<PanelSettings> {
  return api.get<PanelSettings>(`${base(token)}/settings`, opts);
}

export function saveEmail(token: string, body: EmailSaveBody): Promise<PanelSettings> {
  return api.patch<PanelSettings>(`${base(token)}/settings/email`, body, opts);
}

/** Settings D11b: the saved limit also reaches this tab's upload screens at
 *  once (the Settings page and Set up's step 4 both save through here). */
export async function saveLimits(token: string, body: PanelLimits): Promise<PanelSettings> {
  const s = await api.patch<PanelSettings>(`${base(token)}/settings/limits`, body, opts);
  setUploadLimit(s.limits.max_file_mb);
  return s;
}

export function saveSignIn(token: string, body: PanelSignIn): Promise<PanelSettings> {
  return api.patch<PanelSettings>(`${base(token)}/settings/sign-in`, body, opts);
}

export function testEmail(token: string, body: EmailTestBody): Promise<EmailTestResult> {
  return api.post<EmailTestResult>(`${base(token)}/settings/email/test`, body, opts);
}

// --- Branding (Branding D1-D10, D14), mirroring backend/mathion/schemas.py ---

export type PanelImageSize = { width: number; height: number };
export type PanelThemeVar = { name: string; default: string; heading: string };
/** D9, D10: what the Colours card and the download need. */
export type PanelColours = { vars: PanelThemeVar[]; changes: Record<string, string>; warnings: string[] };
export type PanelBranding = {
  name: string;
  logo: PanelImageSize | null;
  icon: PanelImageSize | null;
  colours: PanelColours;
  public: BrandingPublic; // D14: the panel shows a save at once
};
/** D10: the check that saves nothing. */
export type ThemeCheck = {
  changes: Record<string, string>;
  problems: string[];
  more: number;
  warnings: string[];
  blocked: string | null;
};
/** A file's bytes, or Reset to default (D2: one save per item). */
export type BrandingPart = Uint8Array<ArrayBuffer> | 'reset';

export function getBranding(token: string): Promise<PanelBranding> {
  return api.get<PanelBranding>(`${base(token)}/branding`, opts);
}

export function saveSiteName(token: string, body: { name: string } | { reset: true }): Promise<PanelBranding> {
  return api.put<PanelBranding>(`${base(token)}/branding/name`, body, opts);
}

// D5: a file part or reset=true, never both. The bytes are the ones the
// dialog read and checked when the file was chosen.
function brandingForm(part: BrandingPart, type: string, filename: string): FormData {
  const form = new FormData();
  if (part === 'reset') form.append('reset', 'true');
  else form.append('file', new Blob([part], { type }), filename);
  return form;
}

export function saveImage(token: string, kind: 'logo' | 'icon', part: BrandingPart, filename = `${kind}.png`): Promise<PanelBranding> {
  return api.postForm<PanelBranding>(`${base(token)}/branding/${kind}`, brandingForm(part, 'image/png', filename), opts);
}

export function checkTheme(token: string, bytes: Uint8Array<ArrayBuffer>, filename: string): Promise<ThemeCheck> {
  return api.postForm<ThemeCheck>(`${base(token)}/branding/theme/check`, brandingForm(bytes, 'text/css', filename), opts);
}

export function saveTheme(token: string, part: BrandingPart, filename = 'theme.css'): Promise<PanelBranding> {
  return api.postForm<PanelBranding>(`${base(token)}/branding/theme`, brandingForm(part, 'text/css', filename), opts);
}

// --- The shell (D23, D25) ---

/** The panel's pages, Set up included (Set up D1); the shell reads it from the route. */
export type PanelPage = 'setup' | 'dashboard' | 'users' | 'courses' | 'settings' | 'branding';

// --- Errors (D25) ---

/** The shell's handler for the guard's answers: 401 → sign in, 404 → the link expired. */
export type PanelOnAuth = (kind: 'signin' | 'expired') => void;

/**
 * What a panel page shows for a failed call. The guard's 401 and 404 go to
 * `onAuth` and show nothing here (null). Otherwise the server's sentence as it
 * is (D25): a 409's detail, or a 422's first msg without pydantic's
 * "Value error, " prefix (the backend validators raise plain sentences).
 */
export function panelError(err: unknown, onAuth: PanelOnAuth): string | null {
  if (err instanceof ApiError) {
    if (err.status === 401) { onAuth('signin'); return null; }
    if (err.status === 404) { onAuth('expired'); return null; }
    const first = err.validationErrors()?.[0]?.msg;
    if (first) return first.replace(/^Value error, /, '');
    return err.displayMessage;
  }
  if (err instanceof TypeError) return OFFLINE_MESSAGE;
  return REQUEST_ERROR_MESSAGE;
}
